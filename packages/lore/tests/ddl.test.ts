// natally — T0.9 verify: the shared store DDL + migration runner.
// Vec-off path only: in-memory better-sqlite3, no sqlite-vec extension in tests.
// The vec-on path stays typechecked (vecNodesMigration is exercised as a string
// builder) but is deliberately never executed here.
import Database from "better-sqlite3";
import { expect, test } from "vitest";
import {
  MIGRATIONS,
  type SqliteDb,
  STORE_TABLES,
  VEC_NODES_MIGRATION_ID,
  vecNodesMigration,
} from "../src/ddl";
import { migrate } from "../src/migrate";

function openMemory(): SqliteDb {
  return new Database(":memory:");
}

function tableNames(db: SqliteDb): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => String(row["name"])).sort();
}

function columnNames(db: SqliteDb, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => String(row["name"]));
}

function ledgerIds(db: SqliteDb): string[] {
  const rows = db.prepare("SELECT id FROM _migrations").all() as Array<Record<string, unknown>>;
  return rows.map((row) => String(row["id"]));
}

/** Column order per the DDL in src/ddl.ts (ARCHITECTURE §5/§8/§9). */
const EXPECTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  people: ["id", "name", "birth_date", "birth_time", "time_known", "place", "created_at"],
  sessions: ["id", "person_id", "started_at"],
  turns: ["id", "session_id", "person_id", "role", "text", "ts", "tool_ops"],
  charts: ["id", "inputs_json", "facts_json", "computed_at"],
  readings: ["id", "ts", "person_id", "chart_id"],
  consumed_codes: ["code_hash", "redeemed_at"],
  license_state: ["id", "token", "verified_at"],
  lore_nodes: ["id", "kind", "summary", "embedding", "refs_json"],
  lore_edges: ["from_id", "to_id", "rel", "weight", "source_turn_id"],
};

test("migrations: fresh + re-run both OK (10 tables)", () => {
  const db = openMemory();

  // Fresh run: every migration applied in order and recorded in the ledger.
  expect(migrate(db, { vec: false })).toEqual(MIGRATIONS.map((migration) => migration.id));
  expect(ledgerIds(db)).toEqual(MIGRATIONS.map((migration) => migration.id));

  // Exactly the 10 store tables (9 concrete + _migrations); no vec_nodes on vec-off.
  expect(tableNames(db)).toEqual([...STORE_TABLES].sort());
  expect(tableNames(db)).not.toContain("vec_nodes");

  // All columns per table, per the DDL.
  for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
    expect(columnNames(db, table), table).toEqual(columns);
  }

  // turns.role CHECK and license_state single-row CHECK are part of the schema.
  db.prepare("INSERT INTO sessions (id) VALUES ('s1')").run();
  expect(() =>
    db
      .prepare("INSERT INTO turns (id, session_id, role, text) VALUES ('t1', 's1', 'system', 'x')")
      .run(),
  ).toThrow();
  db.prepare("INSERT INTO license_state (id) VALUES (1)").run();
  expect(() => db.prepare("INSERT INTO license_state (id) VALUES (2)").run()).toThrow();

  // Re-run: idempotent no-op — nothing applied, ledger untouched.
  const before = ledgerIds(db);
  expect(() => migrate(db, { vec: false })).not.toThrow();
  expect(migrate(db, { vec: false })).toEqual([]);
  expect(ledgerIds(db)).toEqual(before);
});

test("partial ledger resumes from the first missing id", () => {
  const db = openMemory();
  migrate(db, { vec: false });

  // Simulate an interrupted history: the tables already exist, the ledger lost
  // the last two ids — the runner must re-apply exactly those, in order.
  const del = db.prepare("DELETE FROM _migrations WHERE id = ?");
  const tail = MIGRATIONS[MIGRATIONS.length - 1];
  const prev = MIGRATIONS[MIGRATIONS.length - 2];
  if (!tail || !prev) {
    throw new Error("MIGRATIONS must hold at least two entries");
  }
  del.run(tail.id);
  del.run(prev.id);
  expect(ledgerIds(db)).toHaveLength(MIGRATIONS.length - 2);

  expect(migrate(db, { vec: false })).toEqual([prev.id, tail.id]);
  expect(ledgerIds(db)).toHaveLength(MIGRATIONS.length);
  // Re-executing the IF NOT EXISTS DDL over existing tables is harmless.
  expect(tableNames(db)).toEqual([...STORE_TABLES].sort());
});

test("vec migration builder emits the sqlite-vec virtual table (typechecked, unexecuted)", () => {
  const migration = vecNodesMigration(384);
  expect(migration.id).toBe(VEC_NODES_MIGRATION_ID);
  expect(migration.sql).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0");
  expect(migration.sql).toContain("embedding FLOAT[384]");
  expect(() => vecNodesMigration(0)).toThrow();
});
