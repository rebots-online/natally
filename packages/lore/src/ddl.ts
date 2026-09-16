// natally — shared store DDL (ARCHITECTURE §5 entities, §8.1 storage, §9 ledgers).
// Single ownership: this schema serves BOTH lore and app tables so parallel
// tasks never collide on schema files. Client-side SQLite everywhere (§8.1:
// rusqlite behind Tauri natively, wa-sqlite on OPFS in the browser), with the
// sqlite-vec extension for embeddings when the host loads it.
//
// The `SqliteDb` seam is a minimal STRUCTURAL interface (exec/prepare) so the
// same DDL + migration runner work against better-sqlite3 (tests) and
// rusqlite-backed adapters later — this file never imports better-sqlite3.

/** Minimal prepared-statement surface the runner needs (structural, no vendor types). */
export interface SqliteStatement {
  /** First row (if any) for the bound parameters. */
  get(...params: readonly unknown[]): unknown;
  /** All rows for the bound parameters. */
  all(...params: readonly unknown[]): unknown[];
  /** Execute a mutating statement; returns the affected row count. */
  run(...params: readonly unknown[]): { readonly changes: number | bigint };
}

/** Minimal database surface the runner needs (structural, no vendor types). */
export interface SqliteDb {
  /** Execute one or more raw SQL statements. */
  exec(sql: string): void;
  /** Prepare a statement for parameterized get/all/run. */
  prepare(sql: string): SqliteStatement;
}

/** One ordered, recorded migration. */
export interface Migration {
  /** Stable, ordered id — the ledger key in `_migrations`. */
  readonly id: string;
  /** SQL executed once, inside a transaction, when the id is absent from the ledger. */
  readonly sql: string;
}

/** Every concrete table in the store, plus the `_migrations` ledger (§5/§8/§9). */
export const STORE_TABLES = [
  "people",
  "sessions",
  "turns",
  "charts",
  "readings",
  "consumed_codes",
  "license_state",
  "lore_nodes",
  "lore_edges",
  "_migrations",
] as const;

/** The sqlite-vec virtual mirror of `lore_nodes` — emitted only when vec loads (§8.1). */
export const VEC_NODES_TABLE = "vec_nodes";

/** Ledger id of the conditional sqlite-vec migration. */
export const VEC_NODES_MIGRATION_ID = "0006-vec-nodes";

// ---------------------------------------------------------------------------
// MIGRATIONS — executed in order; every id is recorded in `_migrations`.
// The conditional `vec_nodes` migration (sqlite-vec) is appended by the runner
// only when the vec extension is available.
// ---------------------------------------------------------------------------

/**
 * Person (§5). Birth data is quasi-PII (§12). `time_known` is 0/1; a false
 * value drives the honest-absence branches (§6: solar chart, no Ascendant).
 */
const PEOPLE_SQL = `
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  birth_time TEXT,
  time_known INTEGER NOT NULL,
  place TEXT NOT NULL,
  created_at INTEGER
);`;

/** Session (§5): one conversation thread. */
const SESSIONS_TURNS_SQL = `
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
);`;

/**
 * ChartFacts store (§5): immutable, computed from the EphemerisEngine only;
 * content-addressed by the chart id (input hash). Also the append-only reading
 * ledger (§9.2) — corrections are compensating rows, never updates.
 */
const CHARTS_READINGS_SQL = `
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
);`;

/** Licensing ledgers (§9.5): single-use consumed codes (hash only) + local license state. */
const LICENSE_SQL = `
CREATE TABLE IF NOT EXISTS consumed_codes (
  code_hash TEXT PRIMARY KEY,
  redeemed_at INTEGER
);
CREATE TABLE IF NOT EXISTS license_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT,
  verified_at INTEGER
);`;

/** Lore graph (§8.2): nodes mirror the virtual `vec_nodes` rows; edges accumulate weight. */
const LORE_GRAPH_SQL = `
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
);`;

/** The canonical, unconditional migration list (vec tail is appended by the runner). */
export const MIGRATIONS: readonly Migration[] = [
  { id: "0001-people", sql: PEOPLE_SQL },
  { id: "0002-sessions-turns", sql: SESSIONS_TURNS_SQL },
  { id: "0003-charts-readings", sql: CHARTS_READINGS_SQL },
  { id: "0004-license-ledgers", sql: LICENSE_SQL },
  { id: "0005-lore-graph", sql: LORE_GRAPH_SQL },
];

/**
 * The `vec_nodes` virtual table (sqlite-vec, §8.1) — mirror of `lore_nodes` for
 * kNN retrieval. Built only when the vec extension is loaded; `embedDim` is
 * `VITE_LORE_EMBED_DIM` (default 384).
 */
export function vecNodesMigration(embedDim: number): Migration {
  if (!Number.isInteger(embedDim) || embedDim < 1) {
    throw new Error(`embedDim must be a positive integer, got ${String(embedDim)}`);
  }
  return {
    id: VEC_NODES_MIGRATION_ID,
    sql: `
CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_NODES_TABLE} USING vec0 (
  node_id TEXT PRIMARY KEY,
  embedding FLOAT[${String(embedDim)}] distance_metric=cosine
);`,
  };
}
