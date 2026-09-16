// natally — reading ledger (ARCHITECTURE §9.2; task B.2).
//
// Append-only SQLite store for the `readings` table, over a minimal structural
// db seam (prepare/run — the same shape as the shared store DDL's `SqliteDb`,
// so in-memory better-sqlite3 in tests and rusqlite-backed adapters later both
// satisfy it; this module never imports a driver).
//
// The house never-delete rule (I-0) and §9.2 make this ledger append-only by
// law: "corrections are compensating rows, never updates". The public surface
// is therefore exactly { append, rowsSince, allRows } — no UPDATE or DELETE
// statement exists in this module and the returned type makes a mutation path
// unrepresentable: a caller holding a `ReadingLedger` cannot rewrite history
// even by mistake. The `id` column is the table's PRIMARY KEY, so a replayed
// append fails loudly instead of duplicating a reading.
//
// Schema ownership: the `readings(id, ts, person_id, chart_id)` table is
// created by the shared DDL migration runner (`@natally/lore/migrate`,
// migration `0003-charts-readings`) — the host migrates, this module only
// reads and appends.

import { type Reading, ReadingSchema } from "./types";

// ---------------------------------------------------------------------------
// Structural db seam (no vendor types — see the module header)
// ---------------------------------------------------------------------------

/** Minimal prepared-statement surface the ledger needs. */
export interface LedgerStatement {
  /** Execute a mutating (INSERT) statement; returns the affected row count. */
  run(...params: readonly unknown[]): { readonly changes: number | bigint };
  /** All rows for the bound parameters. */
  all(...params: readonly unknown[]): unknown[];
}

/** Minimal database surface the ledger needs (structural, no vendor types). */
export interface LedgerDb {
  /** Prepare a statement for parameterized run/all. */
  prepare(sql: string): LedgerStatement;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/** The append-only readings ledger (§9.2). Writes: `append` — that is all. */
export interface ReadingLedger {
  /** INSERT the row (§9.2: consumed when the companion's first Tier-1-grounded turn references a plate). */
  append(reading: Reading): void;
  /** Rows with `ts >= since`, ordered by `ts` ascending ("since" is inclusive). */
  rowsSince(since: number): Reading[];
  /** Every row, ordered by `ts` ascending. The trial gate's input (§9.1–§9.2). */
  allRows(): Reading[];
}

const INSERT_SQL = "INSERT INTO readings (id, ts, person_id, chart_id) VALUES (?, ?, ?, ?)";
const SELECT_ALL_SQL = "SELECT id, ts, person_id, chart_id FROM readings ORDER BY ts ASC";
const SELECT_SINCE_SQL =
  "SELECT id, ts, person_id, chart_id FROM readings WHERE ts >= ? ORDER BY ts ASC";

/** A store row that is not an object means a driver/contract bug — fail loudly (INC-19). */
function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("ledger: expected a row object from the SQLite driver");
  }
  return value as Record<string, unknown>;
}

/** Strict column reader: NULL/absent contract columns are corruption, not defaults. */
function column(row: Record<string, unknown>, name: string): string | number {
  const value = row[name];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`ledger: readings row is missing the ${name} column (corrupt store)`);
  }
  return value;
}

/** Rehydrate one contract row; a shape bug fails loudly instead of lying to the gate. */
function toReading(value: unknown): Reading {
  const row = asRow(value);
  return ReadingSchema.parse({
    id: column(row, "id"),
    ts: column(row, "ts"),
    personId: column(row, "person_id"),
    chartId: column(row, "chart_id"),
  });
}

/**
 * Build the append-only reading ledger over an opened, migrated db. The host
 * owns opening and migrating (`@natally/lore/migrate`); this constructor
 * assumes the `readings` table exists and validates every row it returns
 * against the contract.
 */
export function createReadingLedger(db: LedgerDb): ReadingLedger {
  return {
    append(reading: Reading): void {
      // Validate before it touches the store: garbage never enters the ledger.
      const valid = ReadingSchema.parse(reading);
      db.prepare(INSERT_SQL).run(valid.id, valid.ts, valid.personId, valid.chartId);
    },
    rowsSince(since: number): Reading[] {
      return db.prepare(SELECT_SINCE_SQL).all(since).map(toReading);
    },
    allRows(): Reading[] {
      return db.prepare(SELECT_ALL_SQL).all().map(toReading);
    },
  };
}
