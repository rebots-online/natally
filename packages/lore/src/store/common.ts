// natally — LoreStore core over the shared SqliteDb seam (ARCHITECTURE §8.1–§8.4).
// ALL store SQL and row mapping lives here; the platform adapters (web.ts,
// native.ts) are thin shells that supply an opened `SqliteDb` (ddl.ts seam) and
// delegate to `createSqliteLoreStore`.
//
// Vec policy (§8.1): this core keeps `lore_nodes` (canonical rows) and — when
// the host loaded the sqlite-vec extension — the `vec_nodes` mirror table is
// created by `migrate` at adapter level and cleared by `deleteAll`. Retrieval
// itself scores the canonical rows in JS (cosine over the stored BLOBs) so
// behaviour is identical with and without the extension; the vec-on kNN
// MATCH path is a later task and must not ship untested SQL.
//
// Embeddings are stored as little-endian Float32 BLOBs; `refs` is
// JSON-encoded; `toolOps` is JSON-encoded. The Rust twin of this mapping lives
// in `apps/local/src-tauri/src/lore_commands.rs` — keep the two in lockstep.

import { type SqliteDb, STORE_TABLES, VEC_NODES_TABLE } from "../ddl";
import type { LoreFragment, LoreStats, LoreStore } from "../store";
import {
  ChartInputsSchema,
  ConsumedCodeSchema,
  DomWriteOpSchema,
  type ExportDocument,
  ExportDocumentSchema,
  LoreEdgeSchema,
  type LoreNode,
  type Turn,
} from "../types";

/** Host-provided embedding function (§8.1: the embedding model is injected, never bundled here). */
export type EmbedFn = (text: string) => Promise<readonly number[]>;

export interface SqliteLoreStoreOptions {
  /**
   * `true` only when the host loaded the sqlite-vec extension (§8.1): makes
   * `deleteAll` also clear the `vec_nodes` mirror. Retrieval behaviour is
   * identical either way (see the file header).
   */
  readonly vec: boolean;
  /** Storage/embedding runtime label for `stats()` (§8.4), e.g. `wa-sqlite/OPFS`, `rusqlite`. */
  readonly runtime: string;
  /** Query embedder. Absent ⇒ `query()` throws (honest absence) — upsert/export/delete still work. */
  readonly embed?: EmbedFn;
  /** Declared embedding dimension (e.g. `VITE_LORE_EMBED_DIM`); enforced on `upsertTurn` when set. */
  readonly embedDim?: number;
}

// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------

/** Serialize an embedding as little-endian Float32 bytes (BLOB column value). */
export function embeddingToBlob(embedding: readonly number[]): Uint8Array {
  const f32 = new Float32Array(embedding.length);
  f32.set(embedding);
  return new Uint8Array(f32.buffer);
}

/** Read a Float32 BLOB back into a plain number vector; unreadable blobs score as zero vectors. */
export function blobToEmbedding(blob: unknown): number[] {
  if (blob instanceof Uint8Array) {
    return Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
  }
  if (blob instanceof ArrayBuffer) {
    return Array.from(new Float32Array(blob));
  }
  return [];
}

/** Cosine similarity; mismatched or zero vectors score 0 (never NaN). */
function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Deterministic token estimate for the §8.3 budget: ceil(chars / 4), minimum 1. */
function tokenCost(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("lore store: expected a row object from the SQLite driver");
  }
  return value as Record<string, unknown>;
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error("lore store: expected a row array from the SQLite driver");
  }
  return value.map(asRow);
}

// ---------------------------------------------------------------------------
// Core store
// ---------------------------------------------------------------------------

/**
 * Build the platform-neutral `LoreStore` over an opened `SqliteDb`.
 *
 * The core does NOT migrate: adapters (and the test harness) call
 * `migrate(db, { vec })` first — the re-run is an idempotent no-op.
 */
export function createSqliteLoreStore(db: SqliteDb, opts: SqliteLoreStoreOptions): LoreStore {
  const runtime = opts.runtime;

  function requireEmbed(text: string): Promise<readonly number[]> {
    const embed = opts.embed;
    if (!embed) {
      throw new Error(
        "lore store: no embedder configured — query() needs the host-injected embedding model (ARCHITECTURE §8.1)",
      );
    }
    return embed(text);
  }

  function transaction<T>(body: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = body();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Rollback itself failed (transaction already closed) — surface the
        // original error below instead of masking it.
      }
      throw error;
    }
  }

  return {
    async upsertTurn(turn: Turn, embedding: number[]): Promise<void> {
      if (embedding.length === 0) {
        throw new Error("lore store: upsertTurn needs a non-empty embedding");
      }
      if (opts.embedDim !== undefined && embedding.length !== opts.embedDim) {
        throw new Error(
          `lore store: embedding dimension ${String(embedding.length)} != declared ${String(opts.embedDim)}`,
        );
      }
      transaction(() => {
        // Safety net, normally a no-op: the conversation layer creates the real
        // session row before the first turn; an append must never strand the
        // turn on a missing session (turns.session_id REFERENCES sessions). The
        // stub carries NO person linkage — sessions.person_id REFERENCES people
        // and the store cannot fabricate a person row; §8.3 scoping reads
        // turns.person_id, not sessions, so scoping is unaffected.
        db.prepare(
          "INSERT OR IGNORE INTO sessions (id, person_id, started_at) VALUES (?, ?, ?)",
        ).run(turn.sessionId, null, turn.ts);
        db.prepare(
          "INSERT INTO turns (id, session_id, person_id, role, text, ts, tool_ops) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(
          turn.id,
          turn.sessionId,
          turn.personId ?? null,
          turn.role,
          turn.text,
          turn.ts,
          turn.toolOps ? JSON.stringify(turn.toolOps) : null,
        );
        // Write-every-turn raw append (§8.3): one node per turn, id-namespaced
        // `turn:<id>`, kind "event", text as summary, the turn id as its only
        // ref. Extraction / ≥ 0.92 merge is the pipeline's concern, not the
        // store's — this row is the evidence anchor (§8.3 sourceTurnId).
        db.prepare(
          "INSERT INTO lore_nodes (id, kind, summary, embedding, refs_json) VALUES (?, ?, ?, ?, ?)",
        ).run(
          `turn:${turn.id}`,
          "event",
          turn.text,
          embeddingToBlob(embedding),
          JSON.stringify([turn.id]),
        );
      });
    },

    async query(
      personId: string | undefined,
      q: string,
      k: number,
      budget: number,
    ): Promise<LoreFragment[]> {
      const queryVector = await requireEmbed(q);

      // Person scoping (§8.3): a node is in scope when any of its ref turns
      // carries the person id. No JSON1 dependency — the refs are resolved in
      // JS against a turn → person map (full scan is acceptable at
      // client-side store sizes; the vec-on kNN path replaces candidate
      // selection in a later task).
      const turnPerson = new Map<string, string | null>();
      for (const row of asRows(db.prepare("SELECT id, person_id FROM turns").all())) {
        turnPerson.set(
          String(row["id"]),
          row["person_id"] === null ? null : String(row["person_id"]),
        );
      }

      const nodes = new Map<
        string,
        { kind: string; summary: string; vector: number[]; refs: string[] }
      >();
      for (const row of asRows(
        db.prepare("SELECT id, kind, summary, embedding, refs_json FROM lore_nodes").all(),
      )) {
        const id = String(row["id"]);
        let refs: string[] = [];
        try {
          const parsed: unknown = JSON.parse(String(row["refs_json"] ?? "[]"));
          if (Array.isArray(parsed)) {
            refs = parsed.map((ref) => String(ref));
          }
        } catch {
          throw new Error(`lore store: malformed refs_json on lore node ${id}`);
        }
        nodes.set(id, {
          kind: String(row["kind"]),
          summary: String(row["summary"] ?? ""),
          vector: blobToEmbedding(row["embedding"]),
          refs,
        });
      }

      const inScope = (refs: readonly string[]): boolean =>
        personId === undefined || refs.some((ref) => turnPerson.get(ref) === personId);

      const used = { tokens: 0 };
      const out: LoreFragment[] = [];
      const seen = new Set<string>();
      const push = (fragment: LoreFragment): boolean => {
        const cost = tokenCost(fragment.summary);
        if (used.tokens + cost > budget) {
          return false;
        }
        used.tokens += cost;
        out.push(fragment);
        return true;
      };

      // Direct vector hits (hops 0), capped at k.
      const scored: Array<{ id: string; score: number }> = [];
      for (const [id, node] of nodes) {
        if (!inScope(node.refs)) {
          continue;
        }
        const score = cosine(queryVector, node.vector);
        if (score > 0) {
          scored.push({ id, score });
        }
      }
      scored.sort((a, b) => b.score - a.score);

      const directIds: string[] = [];
      for (const hit of scored.slice(0, Math.max(0, k))) {
        const node = nodes.get(hit.id);
        if (!node) {
          continue;
        }
        directIds.push(hit.id);
        seen.add(hit.id);
        if (
          !push({
            nodeId: hit.id,
            kind: nodeKind(node.kind),
            summary: node.summary,
            score: hit.score,
            sourceTurnId: node.refs[0] ?? hit.id,
            hops: 0,
          })
        ) {
          return out;
        }
      }

      // 2-hop graph expansion (§8.3), both edge directions, score 0. Edges are
      // indexed once per query; the budget accumulator caps the whole result.
      const edgesByFrom = new Map<string, Array<{ to: string; sourceTurnId: string }>>();
      const edgesByTo = new Map<string, Array<{ to: string; sourceTurnId: string }>>();
      for (const row of asRows(
        db.prepare("SELECT from_id, to_id, weight, source_turn_id FROM lore_edges").all(),
      )) {
        const edge = {
          to: String(row["to_id"]),
          sourceTurnId: String(row["source_turn_id"] ?? ""),
        };
        const from = String(row["from_id"]);
        const fromList = edgesByFrom.get(from) ?? [];
        fromList.push(edge);
        edgesByFrom.set(from, fromList);
        const toList = edgesByTo.get(edge.to) ?? [];
        toList.push({ to: from, sourceTurnId: edge.sourceTurnId });
        edgesByTo.set(edge.to, toList);
      }

      let frontier = directIds;
      for (const hops of [1, 2] as const) {
        const next: string[] = [];
        for (const nodeId of frontier) {
          const neighbours = [...(edgesByFrom.get(nodeId) ?? []), ...(edgesByTo.get(nodeId) ?? [])];
          for (const neighbour of neighbours) {
            if (seen.has(neighbour.to)) {
              continue;
            }
            const node = nodes.get(neighbour.to);
            if (!node || !inScope(node.refs)) {
              continue;
            }
            seen.add(neighbour.to);
            next.push(neighbour.to);
            if (
              !push({
                nodeId: neighbour.to,
                kind: nodeKind(node.kind),
                summary: node.summary,
                score: 0,
                sourceTurnId: neighbour.sourceTurnId || neighbour.to,
                hops,
              })
            ) {
              return out;
            }
          }
        }
        frontier = next;
      }
      return out;
    },

    async exportAll(): Promise<ExportDocument> {
      const people = asRows(
        db.prepare("SELECT id, name, birth_date, birth_time, time_known, place FROM people").all(),
      ).map((row) => {
        const time = row["birth_time"];
        return {
          id: String(row["id"]),
          name: String(row["name"]),
          birth: {
            date: String(row["birth_date"]),
            ...(typeof time === "string" ? { time } : {}),
            place: String(row["place"]),
            timeKnown: Number(row["time_known"]) !== 0,
          },
        };
      });

      const sessions = asRows(db.prepare("SELECT id, person_id, started_at FROM sessions").all())
        .filter((row) => row["person_id"] !== null)
        .map((row) => ({
          id: String(row["id"]),
          personId: String(row["person_id"]),
          startedAt: Number(row["started_at"] ?? 0),
        }));

      const turns = asRows(
        db.prepare("SELECT id, session_id, person_id, role, text, ts, tool_ops FROM turns").all(),
      ).map((row) => {
        let toolOps: Turn["toolOps"];
        if (typeof row["tool_ops"] === "string") {
          const parsed: unknown = JSON.parse(String(row["tool_ops"]));
          toolOps = (Array.isArray(parsed) ? parsed : []).map((op) => DomWriteOpSchema.parse(op));
        }
        return {
          id: String(row["id"]),
          sessionId: String(row["session_id"]),
          ...(row["person_id"] === null ? {} : { personId: String(row["person_id"]) }),
          role: roleOf(String(row["role"])),
          text: String(row["text"] ?? ""),
          ts: Number(row["ts"] ?? 0),
          ...(toolOps ? { toolOps } : {}),
        };
      });

      // Export law (§5): chart INPUTS only — facts_json is never serialized.
      const charts = asRows(db.prepare("SELECT inputs_json FROM charts").all()).map((row) =>
        ChartInputsSchema.parse(JSON.parse(String(row["inputs_json"]))),
      );

      const loreNodes = asRows(
        db.prepare("SELECT id, kind, summary, embedding, refs_json FROM lore_nodes").all(),
      ).map((row) => {
        const refs: unknown = JSON.parse(String(row["refs_json"] ?? "[]"));
        return {
          id: String(row["id"]),
          kind: nodeKind(String(row["kind"])),
          summary: String(row["summary"] ?? ""),
          embedding: blobToEmbedding(row["embedding"]),
          refs: Array.isArray(refs) ? refs.map((ref) => String(ref)) : [],
        };
      });

      const loreEdges = asRows(
        db.prepare("SELECT from_id, to_id, rel, weight, source_turn_id FROM lore_edges").all(),
      ).map((row) =>
        LoreEdgeSchema.parse({
          from: String(row["from_id"]),
          to: String(row["to_id"]),
          rel: String(row["rel"]),
          weight: Number(row["weight"] ?? 0),
          sourceTurnId: String(row["source_turn_id"] ?? ""),
        }),
      );

      const consumedCodes = asRows(
        db.prepare("SELECT code_hash, redeemed_at FROM consumed_codes").all(),
      ).map((row) =>
        ConsumedCodeSchema.parse({
          codeHash: String(row["code_hash"]),
          redeemedAt: Number(row["redeemed_at"] ?? 0),
        }),
      );

      // The export is validated against the contract before it leaves the
      // store — a shape bug fails loudly instead of exporting a lie (INC-19).
      return ExportDocumentSchema.parse({
        exportVersion: 1,
        people,
        sessions,
        turns,
        charts,
        loreNodes,
        loreEdges,
        consumedCodes,
      });
    },

    async deleteAll(): Promise<void> {
      // Real deletion (§8.4): rows + vectors, every user-owned table. The
      // `_migrations` ledger survives so the schema stays current — the data
      // is gone, not the shape.
      transaction(() => {
        for (const table of [...STORE_TABLES].reverse()) {
          if (table === "_migrations") {
            continue;
          }
          db.exec(`DELETE FROM ${String(table)}`);
        }
        if (opts.vec) {
          db.exec(`DELETE FROM ${VEC_NODES_TABLE}`);
        }
      });
    },

    async stats(): Promise<LoreStats> {
      const count = (table: string): number => {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
        return row === undefined ? 0 : Number(asRow(row)["n"]);
      };
      return {
        turns: count("turns"),
        nodes: count("lore_nodes"),
        edges: count("lore_edges"),
        runtime,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Enum coercion (row TEXT → contract union; unknown values fail loudly)
// ---------------------------------------------------------------------------

function nodeKind(value: string): LoreNode["kind"] {
  switch (value) {
    case "person":
    case "fact":
    case "event":
    case "thread":
    case "place":
      return value;
    default:
      throw new Error(`lore store: unknown lore node kind ${JSON.stringify(value)}`);
  }
}

function roleOf(value: string): Turn["role"] {
  switch (value) {
    case "you":
    case "her":
    case "tool":
      return value;
    default:
      throw new Error(`lore store: unknown turn role ${JSON.stringify(value)}`);
  }
}
