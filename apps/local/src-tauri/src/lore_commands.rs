//! natally — LoreStore native commands over `rusqlite` (task L.1, ARCHITECTURE §8).
//!
//! # Registration (house protocol)
//!
//! `src/registry_generated.rs` is a GENERATED file owned by task I.2. This
//! module is deliberately self-contained: it declares plain `#[tauri::command]`
//! fns and does NOT invoke `natally_plugin!` (only `registry_generated.rs` may,
//! per the contract documented in `lib.rs`). I.2 joins these commands to the
//! IPC surface by declaring `pub mod lore_commands;` at the crate root and
//! listing `lore_commands::lore_upsert_turn, lore_commands::lore_query,
//! lore_commands::lore_export, lore_commands::lore_delete_all,
//! lore_commands::lore_stats` in the macro. `lib.rs` and `main.rs` are never
//! touched.
//!
//! # Wire contract
//!
//! Consumed by `packages/lore/src/store/native.ts` (the injected-invoke shell).
//! Each command takes a single camelCase `payload` argument and returns a
//! JSON-serializable value; errors are surfaced as `String` (the shell
//! re-validates every response against the package's zod contracts, so the
//! Rust side is the storage worker and the TS side holds the schema law).
//!
//! Storage (§8.1): `rusqlite` (bundled SQLite) at `<app data dir>/natally.db`.
//! The sqlite-vec extension is not bundled with rusqlite, so the native leg
//! always migrates vec-off (mirroring `migrate(db, { vec: false })`); cosine
//! over the stored Float32 BLOBs is computed here in Rust, mirroring
//! `packages/lore/src/store/common.ts`. Keep both implementations in lockstep:
//! same DDL ids, same `turn:<id>` node namespacing, same `ceil(chars/4)` token
//! budget, same session-stub and export rules.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tauri::Manager;

// ---------------------------------------------------------------------------
// DDL — mirrors `packages/lore/src/ddl.ts` MIGRATIONS (ids and SQL in lockstep).
// ---------------------------------------------------------------------------

const PEOPLE_SQL: &str = "
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  birth_time TEXT,
  time_known INTEGER NOT NULL,
  place TEXT NOT NULL,
  created_at INTEGER
);";

const SESSIONS_TURNS_SQL: &str = "
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  person_id TEXT REFERENCES people,
  started_at INTEGER
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions,
  person_id TEXT,
  role TEXT CHECK (role IN ('you', 'her', 'tool')),
  text TEXT NOT NULL,
  ts INTEGER,
  tool_ops TEXT
);";

const CHARTS_READINGS_SQL: &str = "
CREATE TABLE IF NOT EXISTS charts (
  id TEXT PRIMARY KEY,
  inputs_json TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  computed_at INTEGER
);
CREATE TABLE IF NOT EXISTS readings (
  id TEXT PRIMARY KEY,
  ts INTEGER,
  person_id TEXT,
  chart_id TEXT
);";

const LICENSE_SQL: &str = "
CREATE TABLE IF NOT EXISTS consumed_codes (
  code_hash TEXT PRIMARY KEY,
  redeemed_at INTEGER
);
CREATE TABLE IF NOT EXISTS license_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT,
  verified_at INTEGER
);";

const LORE_GRAPH_SQL: &str = "
CREATE TABLE IF NOT EXISTS lore_nodes (
  id TEXT PRIMARY KEY,
  kind TEXT,
  summary TEXT,
  embedding BLOB,
  refs_json TEXT
);
CREATE TABLE IF NOT EXISTS lore_edges (
  from_id TEXT,
  to_id TEXT,
  rel TEXT,
  weight REAL,
  source_turn_id TEXT,
  PRIMARY KEY (from_id, to_id, rel, source_turn_id)
);";

/// Ordered migration ledger, mirroring `ddl.ts` MIGRATIONS.
const MIGRATIONS: &[(&str, &str)] = &[
    ("0001-people", PEOPLE_SQL),
    ("0002-sessions-turns", SESSIONS_TURNS_SQL),
    ("0003-charts-readings", CHARTS_READINGS_SQL),
    ("0004-license-ledgers", LICENSE_SQL),
    ("0005-lore-graph", LORE_GRAPH_SQL),
];

/// Every user-owned table, mirrored from `ddl.ts` STORE_TABLES (minus the
/// `_migrations` ledger, which survives deletion so the schema stays current).
const DATA_TABLES: &[&str] = &[
    "people",
    "sessions",
    "turns",
    "charts",
    "readings",
    "consumed_codes",
    "license_state",
    "lore_nodes",
    "lore_edges",
];

// ---------------------------------------------------------------------------
// Wire DTOs (serde camelCase — must match src/store/native.ts exactly)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomOpDto {
    selector: String,
    op: String,
    value: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnDto {
    id: String,
    session_id: String,
    person_id: Option<String>,
    role: String,
    text: String,
    ts: i64,
    tool_ops: Option<Vec<DomOpDto>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertTurnPayload {
    turn: TurnDto,
    embedding: Vec<f32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryPayload {
    person_id: Option<String>,
    /// Raw query text — kept on the wire for the future Tier-2 lexical leg;
    /// current scoring uses `embed` only, hence the dead-code allowance.
    #[allow(dead_code)]
    q: String,
    k: usize,
    budget: usize,
    embed: Vec<f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FragmentDto {
    node_id: String,
    kind: String,
    summary: String,
    score: f64,
    source_turn_id: String,
    hops: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsDto {
    turns: i64,
    nodes: i64,
    edges: i64,
    runtime: String,
}

#[derive(Debug, Serialize)]
pub struct OkDto {
    ok: bool,
}

const OK: OkDto = OkDto { ok: true };

// ---------------------------------------------------------------------------
// Database plumbing
// ---------------------------------------------------------------------------

fn err<E: std::fmt::Display>(e: E) -> String {
    format!("natally lore: {e}")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(err)?
        .join("natally.db");
    Ok(dir)
}

fn open(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(err)?;
    }
    Connection::open(path).map_err(err)
}

/// Idempotent migration runner, mirroring `migrate.ts` (ledger + per-migration
/// transaction). Native is always vec-off: rusqlite does not bundle sqlite-vec.
fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);",
    )
    .map_err(err)?;
    let done: HashSet<String> = {
        let mut stmt = conn.prepare("SELECT id FROM _migrations").map_err(err)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(err)?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };
    for (id, sql) in MIGRATIONS {
        if done.contains(*id) {
            continue;
        }
        let tx = conn.unchecked_transaction().map_err(err)?;
        conn.execute_batch(sql).map_err(err)?;
        conn.execute(
            "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)",
            params![id, now_ms()],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
    }
    Ok(())
}

/// Little-endian Float32 BLOB encoding, matching `embeddingToBlob` in common.ts.
fn f32_to_le_bytes(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

/// Inverse of `f32_to_le_bytes`; truncated/garbled blobs become empty vectors
/// (which score 0, mirroring `blobToEmbedding`'s zero-vector behaviour).
fn le_bytes_to_f32(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

/// Cosine similarity with the same edge rules as common.ts: length mismatch or
/// a zero vector scores 0, never NaN.
fn cosine(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f64;
    let mut na = 0.0f64;
    let mut nb = 0.0f64;
    for (x, y) in a.iter().zip(b.iter()) {
        let (x, y) = (f64::from(*x), f64::from(*y));
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

/// Deterministic §8.3 budget cost, mirroring `tokenCost`: ceil(chars / 4), min 1.
fn token_cost(text: &str) -> usize {
    usize::max(1, text.chars().count().div_ceil(4))
}

struct NodeRow {
    id: String,
    kind: String,
    summary: String,
    vector: Vec<f32>,
    refs: Vec<String>,
}

fn load_nodes(conn: &Connection) -> Result<Vec<NodeRow>, String> {
    let mut stmt = conn
        .prepare("SELECT id, kind, summary, embedding, refs_json FROM lore_nodes")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<Vec<u8>>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .collect::<Vec<_>>();
    let mut nodes = Vec::with_capacity(rows.len());
    for (id, kind, summary, embedding, refs_json) in rows {
        let refs = refs_json
            .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
            .unwrap_or_default();
        nodes.push(NodeRow {
            id,
            kind: kind.unwrap_or_default(),
            summary: summary.unwrap_or_default(),
            vector: le_bytes_to_f32(embedding.as_deref().unwrap_or(&[])),
            refs,
        });
    }
    Ok(nodes)
}

struct EdgeRow {
    from: String,
    to: String,
    rel: String,
    weight: f64,
    source_turn_id: String,
}

fn load_edges(conn: &Connection) -> Result<Vec<EdgeRow>, String> {
    let mut stmt = conn
        .prepare("SELECT from_id, to_id, rel, weight, source_turn_id FROM lore_edges")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<f64>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .map(
            |(from, to, rel, weight, source_turn_id)| EdgeRow {
                from,
                to,
                rel: rel.unwrap_or_default(),
                weight: weight.unwrap_or(0.0),
                source_turn_id: source_turn_id.unwrap_or_default(),
            },
        )
        .collect();
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Append one conversation turn + its raw `turn:<id>` lore node (§8.3
/// write-every-turn; extraction/merge is the pipeline's concern). The session
/// stub carries NO person linkage — `sessions.person_id` references `people`
/// and the store cannot fabricate a person (mirrors common.ts).
#[tauri::command]
pub async fn lore_upsert_turn(
    app: tauri::AppHandle,
    payload: UpsertTurnPayload,
) -> Result<OkDto, String> {
    if payload.embedding.is_empty() {
        return Err("natally lore: upsertTurn needs a non-empty embedding".into());
    }
    let conn = open(&app)?;
    ensure_schema(&conn)?;
    let tx = conn.unchecked_transaction().map_err(err)?;
    conn.execute(
        "INSERT OR IGNORE INTO sessions (id, person_id, started_at) VALUES (?, ?, ?)",
        params![payload.turn.session_id, Option::<String>::None, payload.turn.ts],
    )
    .map_err(err)?;
    let tool_ops = payload
        .turn
        .tool_ops
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(err)?;
    conn.execute(
        "INSERT INTO turns (id, session_id, person_id, role, text, ts, tool_ops) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            payload.turn.id,
            payload.turn.session_id,
            payload.turn.person_id,
            payload.turn.role,
            payload.turn.text,
            payload.turn.ts,
            tool_ops,
        ],
    )
    .map_err(err)?;
    let node_id = format!("turn:{}", payload.turn.id);
    let refs = serde_json::to_string(&vec![payload.turn.id.clone()]).map_err(err)?;
    conn.execute(
        "INSERT INTO lore_nodes (id, kind, summary, embedding, refs_json) VALUES (?, ?, ?, ?, ?)",
        params![
            node_id,
            "event",
            payload.turn.text,
            f32_to_le_bytes(&payload.embedding),
            refs,
        ],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(OK)
}

/// Tier-2 retrieval primitive (§8.3): top-k cosine matches over the stored
/// BLOBs, person-scoped via refs → turns, then a 2-hop neighbourhood expansion
/// over `lore_edges`, budgeted with `ceil(chars/4)` tokens.
#[tauri::command]
pub async fn lore_query(
    app: tauri::AppHandle,
    payload: QueryPayload,
) -> Result<Vec<FragmentDto>, String> {
    let conn = open(&app)?;
    ensure_schema(&conn)?;

    // turn id → person id (scoping basis; NULL persons are out of every scope).
    let mut turn_person: HashMap<String, Option<String>> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, person_id FROM turns").map_err(err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(err)?
            .filter_map(|r| r.ok());
        for (id, person) in rows {
            turn_person.insert(id, person);
        }
    }
    let in_scope = |refs: &[String]| -> bool {
        payload.person_id.as_ref().is_none_or(|person| {
            refs.iter()
                .any(|r| turn_person.get(r).is_some_and(|p| p.as_deref() == Some(person.as_str())))
        })
    };

    let nodes = load_nodes(&conn)?;
    let by_id: HashMap<&str, &NodeRow> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    let mut out: Vec<FragmentDto> = Vec::new();
    let mut used_tokens: usize = 0;
    let mut seen: HashSet<String> = HashSet::new();

    let mut push = |fragment: FragmentDto| -> bool {
        let cost = token_cost(&fragment.summary);
        if used_tokens + cost > payload.budget {
            return false;
        }
        used_tokens += cost;
        out.push(fragment);
        true
    };

    // Direct vector hits (hops 0), capped at k.
    let mut scored: Vec<(&NodeRow, f64)> = nodes
        .iter()
        .filter(|n| in_scope(&n.refs))
        .map(|n| (n, cosine(&payload.embed, &n.vector)))
        .filter(|(_, score)| *score > 0.0)
        .collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));

    let mut frontier: Vec<String> = Vec::new();
    for (node, score) in scored.into_iter().take(payload.k) {
        seen.insert(node.id.clone());
        frontier.push(node.id.clone());
        if !push(FragmentDto {
            node_id: node.id.clone(),
            kind: node.kind.clone(),
            summary: node.summary.clone(),
            score,
            source_turn_id: node
                .refs
                .first()
                .cloned()
                .unwrap_or_else(|| node.id.clone()),
            hops: 0,
        }) {
            return Ok(out);
        }
    }

    // 2-hop expansion (§8.3), both edge directions, score 0.
    let edges = load_edges(&conn)?;
    let neighbours = |id: &str| -> Vec<(String, String)> {
        let mut result = Vec::new();
        for edge in &edges {
            if edge.from == id {
                result.push((edge.to.clone(), edge.source_turn_id.clone()));
            }
            if edge.to == id {
                result.push((edge.from.clone(), edge.source_turn_id.clone()));
            }
        }
        result
    };
    for hops in [1u8, 2] {
        let mut next: Vec<String> = Vec::new();
        for id in &frontier {
            for (neighbour_id, source_turn) in neighbours(id) {
                if seen.contains(&neighbour_id) {
                    continue;
                }
                let Some(node) = by_id.get(neighbour_id.as_str()) else {
                    continue;
                };
                if !in_scope(&node.refs) {
                    continue;
                }
                seen.insert(neighbour_id.clone());
                next.push(neighbour_id.clone());
                if !push(FragmentDto {
                    node_id: node.id.clone(),
                    kind: node.kind.clone(),
                    summary: node.summary.clone(),
                    score: 0.0,
                    source_turn_id: if source_turn.is_empty() {
                        node.id.clone()
                    } else {
                        source_turn
                    },
                    hops,
                }) {
                    return Ok(out);
                }
            }
        }
        frontier = next;
    }
    Ok(out)
}

/// Full user-owned export (§5, J8): chart INPUTS only — `facts_json` is never
/// serialized. Chart inputs are passed through as stored JSON (written by the
/// chart layer); the TS shell re-validates the whole document with zod.
#[tauri::command]
pub async fn lore_export(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let conn = open(&app)?;
    ensure_schema(&conn)?;
    use serde_json::json;

    let mut people = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, name, birth_date, birth_time, time_known, place FROM people")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .map_err(err)?
            .filter_map(|r| r.ok());
        for (id, name, date, time, time_known, place) in rows {
            let mut birth = serde_json::Map::new();
            birth.insert("date".into(), json!(date));
            birth.insert("place".into(), json!(place));
            birth.insert("timeKnown".into(), json!(time_known != 0));
            if let Some(t) = time {
                birth.insert("time".into(), json!(t));
            }
            people.push(json!({ "id": id, "name": name, "birth": birth }));
        }
    }

    let mut sessions = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, person_id, started_at FROM sessions WHERE person_id IS NOT NULL")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            })
            .map_err(err)?
            .filter_map(|r| r.ok());
        for (id, person_id, started_at) in rows {
            sessions.push(json!({
                "id": id,
                "personId": person_id,
                "startedAt": started_at.unwrap_or(0),
            }));
        }
    }

    let mut turns = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, session_id, person_id, role, text, ts, tool_ops FROM turns")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(err)?
            .filter_map(|r| r.ok());
        for (id, session_id, person_id, role, text, ts, tool_ops) in rows {
            let mut turn = serde_json::Map::new();
            turn.insert("id".into(), json!(id));
            turn.insert("sessionId".into(), json!(session_id));
            if let Some(p) = person_id {
                turn.insert("personId".into(), json!(p));
            }
            turn.insert("role".into(), json!(role.unwrap_or_default()));
            turn.insert("text".into(), json!(text.unwrap_or_default()));
            turn.insert("ts".into(), json!(ts.unwrap_or(0)));
            if let Some(ops_json) = tool_ops {
                let ops: serde_json::Value = serde_json::from_str(&ops_json).map_err(err)?;
                turn.insert("toolOps".into(), ops);
            }
            turns.push(serde_json::Value::Object(turn));
        }
    }

    // Export law (§5): inputs only, never facts.
    let mut charts = Vec::new();
    {
        let mut stmt = conn.prepare("SELECT inputs_json FROM charts").map_err(err)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(err)?
            .filter_map(|r| r.ok());
        for inputs_json in rows {
            let inputs: serde_json::Value = serde_json::from_str(&inputs_json).map_err(err)?;
            charts.push(inputs);
        }
    }

    let mut lore_nodes = Vec::new();
    for node in load_nodes(&conn)? {
        let embedding: Vec<f64> = node.vector.iter().map(|v| f64::from(*v)).collect();
        lore_nodes.push(json!({
            "id": node.id,
            "kind": node.kind,
            "summary": node.summary,
            "embedding": embedding,
            "refs": node.refs,
        }));
    }

    let mut lore_edges = Vec::new();
    for edge in load_edges(&conn)? {
        lore_edges.push(json!({
            "from": edge.from,
            "to": edge.to,
            "rel": edge.rel,
            "weight": edge.weight,
            "sourceTurnId": edge.source_turn_id,
        }));
    }

    let mut consumed_codes = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT code_hash, redeemed_at FROM consumed_codes")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                ))
            })
            .map_err(err)?
            .filter_map(|r| r.ok());
        for (code_hash, redeemed_at) in rows {
            consumed_codes.push(json!({
                "codeHash": code_hash,
                "redeemedAt": redeemed_at.unwrap_or(0),
            }));
        }
    }

    Ok(json!({
        "exportVersion": 1,
        "people": people,
        "sessions": sessions,
        "turns": turns,
        "charts": charts,
        "loreNodes": lore_nodes,
        "loreEdges": lore_edges,
        "consumedCodes": consumed_codes,
    }))
}

/// Real deletion (§8.4): every user-owned table emptied, ledger kept so the
/// schema stays current. Mirrors common.ts `deleteAll` (the vec mirror table
/// never exists on the native leg — see `ensure_schema`).
#[tauri::command]
pub async fn lore_delete_all(app: tauri::AppHandle) -> Result<OkDto, String> {
    let conn = open(&app)?;
    ensure_schema(&conn)?;
    let tx = conn.unchecked_transaction().map_err(err)?;
    for table in DATA_TABLES {
        let sql = format!("DELETE FROM {table}");
        conn.execute_batch(&sql).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(OK)
}

/// Settings › Data summary inputs (§8.4): `[turns · nodes · runtime]`.
#[tauri::command]
pub async fn lore_stats(app: tauri::AppHandle) -> Result<StatsDto, String> {
    let conn = open(&app)?;
    ensure_schema(&conn)?;
    let count = |table: &str| -> Result<i64, String> {
        let sql = format!("SELECT COUNT(*) FROM {table}");
        conn.query_row(&sql, [], |row| row.get::<_, i64>(0))
            .map_err(err)
    };
    Ok(StatsDto {
        turns: count("turns")?,
        nodes: count("lore_nodes")?,
        edges: count("lore_edges")?,
        runtime: "rusqlite".into(),
    })
}
