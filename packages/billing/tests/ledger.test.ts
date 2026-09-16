// natally — B.2 verify: the append-only reading ledger + the frozen
// billing.consume seam (ARCHITECTURE §9.2, §9.6).
//
// Real storage, nothing mocked: in-memory better-sqlite3 behind the structural
// seam, migrated by the shared DDL runner (T0.9 — migration
// `0003-charts-readings` creates the `readings` table). The licensed check is
// a plain closure over fixture state, the clock is an injected closure, and
// the gate under consume() is B.1's real evaluateGate. Every instant is a
// fixed epoch constant — no wall-clock reads.

import type { SqliteDb } from "@natally/lore/ddl";
import { migrate } from "@natally/lore/migrate";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { type ConsumeDeps, consume } from "../src/consume";
import { createReadingLedger, type ReadingLedger } from "../src/ledger";
import { DAY_MS, evaluateGate, INSTALL_ROW_ID } from "../src/trial";
import type { Reading, TrialPolicy } from "../src/types";

/** Arbitrary fixed epoch (2023-11-14T22:13:20Z); nothing reads the wall clock. */
const T0 = 1_700_000_000_000;

function reading(id: string, ts: number): Reading {
  return { id, ts, personId: "person-1", chartId: "chart-1" };
}

/** Real in-memory SQLite behind the structural seam, migrated by T0.9's shared runner. */
function openLedgerDb(): { db: SqliteDb; ledger: ReadingLedger } {
  const db = new Database(":memory:");
  migrate(db, { vec: false });
  return { db, ledger: createReadingLedger(db) };
}

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("expected a row object from the SQLite driver");
  }
  return value as Record<string, unknown>;
}

/** Raw insertion-order snapshot of the readings table — the append-only proof. */
function rawRows(db: SqliteDb): Array<Record<string, unknown>> {
  return db
    .prepare("SELECT id, ts, person_id, chart_id FROM readings ORDER BY rowid")
    .all()
    .map(asRow);
}

function rowCount(db: SqliteDb): number {
  return Number(asRow(db.prepare("SELECT COUNT(*) AS n FROM readings").get()).n);
}

/** deps over fixture state — plain closures, no mock library. */
function deps(
  ledger: ReadingLedger,
  policy: TrialPolicy,
  nowMs: number,
  licensed: boolean,
): ConsumeDeps {
  return {
    ledger,
    policy,
    now: () => nowMs,
    isLicensed: async () => licensed,
  };
}

/** Count-mode fixture: `limit` consumption rows already in the ledger. */
function seedCountReadings(ledger: ReadingLedger, limit: number): void {
  for (let i = 1; i <= limit; i += 1) {
    ledger.append(reading(`r${String(i)}`, T0 + i * DAY_MS));
  }
}

describe("billing ledger + consume (B.2)", () => {
  it("ledger: append inserts only; rowsSince is inclusive and ts-ascending; replayed ids fail loudly", () => {
    const { db, ledger } = openLedgerDb();
    // Rows may arrive in any order; reads come back ts-ascending.
    ledger.append(reading("r2", T0 + 2 * DAY_MS));
    ledger.append(reading(INSTALL_ROW_ID, T0));
    ledger.append(reading("r1", T0 + DAY_MS));

    expect(ledger.allRows().map((row) => row.id)).toEqual([INSTALL_ROW_ID, "r1", "r2"]);
    expect(ledger.rowsSince(T0 + DAY_MS).map((row) => row.id)).toEqual(["r1", "r2"]);
    expect(ledger.rowsSince(T0 + DAY_MS + 1).map((row) => row.id)).toEqual(["r2"]);
    expect(ledger.rowsSince(0)).toHaveLength(3);

    expect(rowCount(db)).toBe(3);
    // Append-only law (§9.2): the PRIMARY KEY turns a replayed id into a loud
    // failure — corrections are compensating rows, never updates.
    expect(() => ledger.append(reading("r1", T0 + 9 * DAY_MS))).toThrow();
    expect(rowCount(db)).toBe(3);
  });

  it("ledger: the public surface has no mutation path — reads leave rows untouched", () => {
    const { db, ledger } = openLedgerDb();
    ledger.append(reading("r1", T0));
    ledger.append(reading("r2", T0 + DAY_MS));
    const before = rawRows(db);
    // Type-level: `ReadingLedger` exposes exactly append/rowsSince/allRows —
    // there is no update or delete member to call, so mutation is
    // unrepresentable at the call site. Runtime mirror of that contract:
    expect(Object.keys(ledger).sort()).toEqual(["allRows", "append", "rowsSince"]);
    void ledger.rowsSince(0);
    void ledger.allRows();
    expect(rawRows(db)).toEqual(before);
  });

  it("consume: licensed/trial/exhausted/rate paths exact", async () => {
    const countPolicy: TrialPolicy = { mode: "count", readings: 3, trialModel: "trial-model" };
    const ratePolicy: TrialPolicy = { mode: "rate", cooldownDays: 3, trialModel: "trial-model" };
    const candidate = reading("r-new", T0 + 9 * DAY_MS);

    // licensed — the B.3 check short-circuits the gate: allowed even with an
    // exhausted ledger (the §9.3 unlock outranks trial state).
    {
      const { db, ledger } = openLedgerDb();
      seedCountReadings(ledger, 3); // count limit 3 already reached
      const licensed: ConsumeDeps = deps(ledger, countPolicy, T0 + 9 * DAY_MS, true);
      const before = rawRows(db);
      await expect(consume(candidate, licensed)).resolves.toEqual({ allowed: true });
      expect(rawRows(db)).toEqual(before); // pure of writes
    }

    // trial-active (count mode, headroom left) — allowed, and the candidate is
    // NOT appended: appending is the caller's X-phase duty (§9.2, pre-inference).
    {
      const { db, ledger } = openLedgerDb();
      ledger.append(reading("r1", T0 + DAY_MS));
      ledger.append(reading("r2", T0 + 2 * DAY_MS));
      const active: ConsumeDeps = deps(ledger, countPolicy, T0 + 9 * DAY_MS, false);
      const before = rawRows(db);
      await expect(consume(candidate, active)).resolves.toEqual({ allowed: true });
      expect(rawRows(db)).toEqual(before);
      expect(rowCount(db)).toBe(2);
    }

    // trial-exhausted (count mode exactly at the limit) — the (N+1)-th reading
    // is the one this call decides about.
    {
      const { db, ledger } = openLedgerDb();
      seedCountReadings(ledger, 3);
      const exhausted: ConsumeDeps = deps(ledger, countPolicy, T0 + 9 * DAY_MS, false);
      const before = rawRows(db);
      await expect(consume(candidate, exhausted)).resolves.toEqual({
        allowed: false,
        reason: "trial-exhausted",
      });
      expect(rawRows(db)).toEqual(before);
    }

    // rate-limited — the gate carries nextReadingAt; the frozen §9.6
    // ConsumeResult maps it away (the UI's next-date aside re-derives the
    // instant from the same ledger when it renders).
    {
      const { db, ledger } = openLedgerDb();
      ledger.append(reading(INSTALL_ROW_ID, T0)); // install bootstrap: metadata, not usage
      ledger.append(reading("r1", T0 + DAY_MS));
      const nowMs = T0 + 2 * DAY_MS; // one day into the 3-day cooldown
      // Fixture sanity: the gate really is rate-limited, with a next date.
      expect(evaluateGate(ratePolicy, ledger.allRows(), () => nowMs)).toEqual({
        state: "rate-limited",
        nextReadingAt: T0 + 4 * DAY_MS,
      });
      const limited: ConsumeDeps = deps(ledger, ratePolicy, nowMs, false);
      const before = rawRows(db);
      // Exact: toEqual fails if nextReadingAt leaked into the result.
      await expect(consume(candidate, limited)).resolves.toEqual({
        allowed: false,
        reason: "rate-limited",
      });
      expect(rawRows(db)).toEqual(before);
      // The cooldown boundary is strict — exactly-at-cooldown is allowed again.
      const atCooldown: ConsumeDeps = deps(ledger, ratePolicy, T0 + 4 * DAY_MS, false);
      await expect(consume(candidate, atCooldown)).resolves.toEqual({ allowed: true });
    }
  });
});
