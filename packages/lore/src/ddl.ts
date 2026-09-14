export interface Migration {
  id: number;
  sql: string;
}

/** Append migrations in order; never edit SQL that has already been applied. */
export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    sql: `
      CREATE TABLE people (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        birth_date TEXT NOT NULL,
        birth_time TEXT,
        time_known INTEGER NOT NULL,
        place TEXT NOT NULL,
        created_at INTEGER
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        person_id TEXT REFERENCES people(id),
        started_at INTEGER
      );

      CREATE TABLE turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        person_id TEXT,
        role TEXT CHECK(role IN ('you', 'her', 'tool')),
        text TEXT NOT NULL,
        ts INTEGER,
        tool_ops TEXT
      );

      CREATE TABLE charts (
        id TEXT PRIMARY KEY,
        inputs_json TEXT NOT NULL,
        facts_json TEXT NOT NULL,
        computed_at INTEGER
      );

      CREATE TABLE readings (
        id TEXT PRIMARY KEY,
        ts INTEGER,
        person_id TEXT,
        chart_id TEXT
      );

      CREATE TABLE consumed_codes (
        code_hash TEXT PRIMARY KEY,
        redeemed_at INTEGER
      );

      CREATE TABLE license_state (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        token TEXT,
        verified_at INTEGER
      );

      CREATE TABLE lore_nodes (
        id TEXT PRIMARY KEY,
        kind TEXT,
        summary TEXT,
        embedding BLOB,
        refs_json TEXT
      );

      CREATE TABLE lore_edges (
        from_id TEXT,
        to_id TEXT,
        rel TEXT,
        weight REAL,
        source_turn_id TEXT,
        PRIMARY KEY(from_id, to_id, rel, source_turn_id)
      );
    `,
  },
];

/** Kept separate so an extension-free run never records the optional migration. */
export const VEC_MIGRATION_ID = 2;

/** The embedding model's width must be supplied when first enabling sqlite-vec. */
export function vecMigration(dimensions: number): Migration {
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0) {
    throw new RangeError("vecDimensions must be a positive safe integer");
  }

  return {
    id: VEC_MIGRATION_ID,
    sql: `CREATE VIRTUAL TABLE vec_nodes USING vec0(
      id TEXT PRIMARY KEY,
      embedding float[${dimensions}]
    );`,
  };
}
