import { type Reading, ReadingSchema } from "./types.js";

/** Reserved namespace: a credit repeats its debit's fields and request timestamp. */
export const CREDIT_ID_PREFIX = "credit:";
export const INSTALL_READING_ID = "install";

type Awaitable<T> = T | Promise<T>;
type SqlValue = string | number | null;

export interface ReadingSqlExecutor {
  all(sql: string, parameters: readonly SqlValue[]): Awaitable<readonly Record<string, unknown>[]>;
  run(sql: string, parameters: readonly SqlValue[]): Awaitable<unknown>;
}

/**
 * Adapters must serialize writers, use one connection for the callback, and commit
 * only on success (rollback on rejection). SQLite adapters must acquire the write
 * reservation BEFORE invoking work, e.g. BEGIN IMMEDIATE, not a deferred read.
 */
export interface ReadingStorage {
  transaction<T>(work: (sql: ReadingSqlExecutor) => Promise<T>): Promise<T>;
}

/** Structural subset shared by node:sqlite and better-sqlite3. */
export interface SQLiteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...parameters: SqlValue[]): Record<string, unknown>[];
    run(...parameters: SqlValue[]): unknown;
  };
}

const transactionQueues = new WeakMap<SQLiteDatabase, Promise<void>>();

/** Real SQL adapter; separate wrappers sharing a connection share its queue. */
export function createSQLiteStorage(db: SQLiteDatabase): ReadingStorage {
  const sql: ReadingSqlExecutor = {
    all: (statement, parameters) => db.prepare(statement).all(...parameters),
    run: (statement, parameters) => db.prepare(statement).run(...parameters),
  };
  return {
    transaction<T>(work: (sql: ReadingSqlExecutor) => Promise<T>): Promise<T> {
      const previous = transactionQueues.get(db) ?? Promise.resolve();
      const result = previous.then(async () => {
        // A failed BEGIN must not roll back somebody else's existing transaction.
        db.exec("BEGIN IMMEDIATE");
        try {
          const value = await work(sql);
          db.exec("COMMIT");
          return value;
        } catch (error) {
          try {
            db.exec("ROLLBACK");
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "Reading transaction and rollback failed",
            );
          }
          throw error;
        }
      });
      transactionQueues.set(
        db,
        result.then(
          () => undefined,
          () => undefined,
        ),
      );
      return result;
    },
  };
}

function sameReading(left: Reading, right: Reading): boolean {
  return (
    left.id === right.id &&
    left.ts === right.ts &&
    left.personId === right.personId &&
    left.chartId === right.chartId
  );
}

function debit(reading: Reading): Reading {
  const parsed = ReadingSchema.parse(reading);
  if (parsed.id.startsWith(CREDIT_ID_PREFIX)) {
    throw new Error(`Reading IDs beginning with ${CREDIT_ID_PREFIX} are reserved for credits`);
  }
  return parsed;
}

function creditFor(reading: Reading): Reading {
  return { ...reading, id: CREDIT_ID_PREFIX + reading.id };
}

/**
 * Public projection for EVERY evaluateGate caller: retain the install bootstrap
 * row and uncompensated debits; exclude credit rows AND their original debits.
 * Supply the complete ledger, then apply time filters, so refunds cannot be lost
 * at a query boundary. No durable row is changed. Corrupt credits fail closed.
 */
export function projectGateRows(rows: readonly Readonly<Reading>[]): Reading[] {
  const readings = rows.map((row) => ReadingSchema.parse(row));
  const byId = new Map<string, Reading>();
  for (const reading of readings) {
    if (byId.has(reading.id)) throw new Error(`Duplicate reading ID: ${reading.id}`);
    byId.set(reading.id, reading);
  }
  const refunded = new Set<string>();
  for (const credit of readings) {
    if (!credit.id.startsWith(CREDIT_ID_PREFIX)) continue;
    const originalId = credit.id.slice(CREDIT_ID_PREFIX.length);
    const original = byId.get(originalId);
    if (
      !original ||
      originalId === INSTALL_READING_ID ||
      originalId.startsWith(CREDIT_ID_PREFIX) ||
      !sameReading(creditFor(original), credit)
    ) {
      throw new Error(`Invalid reading credit: ${credit.id}`);
    }
    refunded.add(originalId);
  }
  return readings.filter((row) => !row.id.startsWith(CREDIT_ID_PREFIX) && !refunded.has(row.id));
}

export interface ReadingLedgerTransaction {
  /** Rejects reuse of an ID with different fields, including after a refund. */
  has(reading: Reading): Promise<boolean>;
  append(reading: Reading): Promise<void>;
  compensate(reading: Reading): Promise<void>;
  /** Raw, durable rows, inclusive of ts; includes credits. */
  rowsSince(ts: number): Promise<Reading[]>;
  /** Complete normalized snapshot, including the install row for time trials. */
  gateRows(): Promise<Reading[]>;
}

function fromSql(row: Record<string, unknown>): Reading {
  return ReadingSchema.parse({
    id: row.id,
    ts: row.ts,
    personId: row.person_id,
    chartId: row.chart_id,
  });
}

class Transaction implements ReadingLedgerTransaction {
  constructor(private readonly sql: ReadingSqlExecutor) {}

  private async find(id: string): Promise<Reading | undefined> {
    const rows = await this.sql.all(
      "SELECT id, ts, person_id, chart_id FROM readings WHERE id = ?",
      [id],
    );
    return rows[0] === undefined ? undefined : fromSql(rows[0]);
  }

  async has(reading: Reading): Promise<boolean> {
    const parsed = debit(reading);
    const existing = await this.find(parsed.id);
    if (existing && !sameReading(existing, parsed)) {
      throw new Error(`Reading ID already belongs to a different request: ${parsed.id}`);
    }
    return existing !== undefined;
  }

  private async insert(reading: Reading): Promise<void> {
    await this.sql.run("INSERT INTO readings (id, ts, person_id, chart_id) VALUES (?, ?, ?, ?)", [
      reading.id,
      reading.ts,
      reading.personId,
      reading.chartId,
    ]);
  }

  async append(reading: Reading): Promise<void> {
    const parsed = debit(reading);
    if (!(await this.has(parsed))) await this.insert(parsed);
  }

  async compensate(reading: Reading): Promise<void> {
    const parsed = debit(reading);
    if (parsed.id === INSTALL_READING_ID) throw new Error("The install row cannot be refunded");
    if (!(await this.has(parsed)))
      throw new Error(`Cannot refund an unknown reading: ${parsed.id}`);
    const credit = creditFor(parsed);
    const existing = await this.find(credit.id);
    if (existing && !sameReading(existing, credit)) {
      throw new Error(`Invalid reading credit: ${credit.id}`);
    }
    if (!existing) await this.insert(credit);
  }

  async rowsSince(ts: number): Promise<Reading[]> {
    if (!Number.isSafeInteger(ts) || ts < 0) {
      throw new RangeError("Ledger timestamps must be nonnegative epoch milliseconds");
    }
    const rows = await this.sql.all(
      "SELECT id, ts, person_id, chart_id FROM readings WHERE ts >= ? ORDER BY ts, id COLLATE BINARY",
      [ts],
    );
    return rows.map(fromSql);
  }

  async gateRows(): Promise<Reading[]> {
    return projectGateRows(await this.rowsSince(0));
  }
}

/** Append-only SQLite ledger. Migrations and connection lifetime belong to the caller. */
export class ReadingLedger implements ReadingLedgerTransaction {
  constructor(private readonly storage: ReadingStorage) {}

  /** Use this to keep a quota decision and its debit in the same transaction. */
  transaction<T>(work: (ledger: ReadingLedgerTransaction) => Promise<T>): Promise<T> {
    return this.storage.transaction((sql) => work(new Transaction(sql)));
  }

  has(reading: Reading): Promise<boolean> {
    return this.transaction((ledger) => ledger.has(reading));
  }

  append(reading: Reading): Promise<void> {
    return this.transaction((ledger) => ledger.append(reading));
  }

  compensate(reading: Reading): Promise<void> {
    return this.transaction((ledger) => ledger.compensate(reading));
  }

  rowsSince(ts: number): Promise<Reading[]> {
    return this.transaction((ledger) => ledger.rowsSince(ts));
  }

  gateRows(): Promise<Reading[]> {
    return this.transaction((ledger) => ledger.gateRows());
  }
}
