import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../lore/src/ddl.js";
import { type ConsumeDeps, consume } from "../src/consume.js";
import {
  CREDIT_ID_PREFIX,
  createSQLiteStorage,
  projectGateRows,
  ReadingLedger,
  type ReadingStorage,
} from "../src/ledger.js";
import { evaluateGate } from "../src/trial.js";
import type { Reading, TrialPolicy } from "../src/types.js";

const DAY = 86_400_000;
const databases: DatabaseSync[] = [];
const count: TrialPolicy = { mode: "count", readings: 1, trialModel: "local-trial" };
const rate: TrialPolicy = { mode: "rate", cooldownDays: 2, trialModel: "local-trial" };
const time: TrialPolicy = { mode: "time", days: 2, trialModel: "local-trial" };
const reading = (id = "r1", ts = DAY): Reading => ({
  id,
  ts,
  personId: "person",
  chartId: "chart",
});
const credit = (row: Reading): Reading => ({ ...row, id: CREDIT_ID_PREFIX + row.id });

function fixture(policy = count, now = DAY) {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  for (const migration of MIGRATIONS) db.exec(migration.sql);
  // Enforce append-only behavior in every test, including failure handling.
  db.exec(`
    CREATE TRIGGER no_reading_update BEFORE UPDATE ON readings
    BEGIN SELECT RAISE(ABORT, 'readings are append-only'); END;
    CREATE TRIGGER no_reading_delete BEFORE DELETE ON readings
    BEGIN SELECT RAISE(ABORT, 'readings are append-only'); END;
  `);
  const storage = createSQLiteStorage(db);
  const ledger = new ReadingLedger(storage);
  const deps: ConsumeDeps = { ledger, policy, now: () => now };
  return { db, storage, ledger, deps };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("ReadingLedger durable accounting", () => {
  it("stores exact SQL fields, orders rowsSince inclusively, and binds parameters", async () => {
    const { db, ledger } = fixture();
    const row = {
      ...reading("quote' ; DROP TABLE readings; --", 20),
      personId: "person'",
      chartId: "chart'",
    };
    await ledger.append(row);
    await ledger.append(reading("earlier", 10));
    await ledger.append(reading("later", 30));
    expect(db.prepare("SELECT * FROM readings WHERE id = ?").get(row.id)).toEqual({
      id: row.id,
      ts: 20,
      person_id: row.personId,
      chart_id: row.chartId,
    });
    expect(await ledger.rowsSince(20)).toEqual([row, reading("later", 30)]);
    expect(await ledger.rowsSince(31)).toEqual([]);
  });

  it("appends and compensates idempotently without changing the debit", async () => {
    const { ledger } = fixture();
    const row = reading();
    await Promise.all(Array.from({ length: 8 }, () => ledger.append(row)));
    await Promise.all(Array.from({ length: 8 }, () => ledger.compensate(row)));
    await ledger.append(row);
    expect(await ledger.rowsSince(0)).toEqual([credit(row), row]);
    expect(await ledger.gateRows()).toEqual([]);
  });

  it.each(["ts", "personId", "chartId"] as const)(
    "rejects conflicting %s without mutating history",
    async (field) => {
      const { ledger } = fixture();
      const row = reading();
      await ledger.append(row);
      const conflicting = { ...row, [field]: field === "ts" ? row.ts + 1 : "different" };
      await expect(ledger.append(conflicting)).rejects.toThrow("different request");
      await expect(ledger.compensate(conflicting)).rejects.toThrow("different request");
      expect(await ledger.rowsSince(0)).toEqual([row]);
    },
  );

  it("reserves credit IDs, forbids orphan/install refunds, and rejects invalid readings", async () => {
    const { ledger, deps } = fixture();
    await expect(ledger.append(credit(reading()))).rejects.toThrow("reserved");
    await expect(ledger.compensate(reading())).rejects.toThrow("unknown reading");
    await ledger.append(reading("install", 0));
    await expect(ledger.compensate(reading("install", 0))).rejects.toThrow("cannot be refunded");
    await expect(consume(reading("install", 0), deps)).rejects.toThrow("reserved");
    await expect(ledger.append({ ...reading(), chartId: "" })).rejects.toThrow();
    await expect(ledger.rowsSince(-1)).rejects.toThrow("timestamps");
    expect(await ledger.rowsSince(0)).toEqual([reading("install", 0)]);
  });

  it("exports a pure net-usage projection preserving install for all gate consumers", async () => {
    const { ledger } = fixture();
    const install = reading("install", 0);
    const refunded = reading("refunded", DAY);
    const live = reading("live", DAY - 1);
    await ledger.append(install);
    await ledger.append(refunded);
    await ledger.append(live);
    await ledger.compensate(refunded);
    const raw = await ledger.rowsSince(0);
    const before = structuredClone(raw);
    expect(projectGateRows(raw)).toEqual([install, live]);
    expect(await ledger.gateRows()).toEqual([install, live]);
    expect(evaluateGate({ ...count, readings: 2 }, projectGateRows(raw), () => DAY)).toEqual({
      state: "trial-active",
      remaining: 1,
    });
    expect(raw).toEqual(before);
    expect(await ledger.rowsSince(DAY)).toEqual([credit(refunded), refunded]);
  });

  it("rejects corrupt credit projections instead of silently granting quota", () => {
    const row = reading();
    expect(() => projectGateRows([credit(row)])).toThrow("Invalid reading credit");
    expect(() => projectGateRows([row, { ...credit(row), chartId: "different" }])).toThrow(
      "Invalid reading credit",
    );
    expect(() => projectGateRows([reading("install"), credit(reading("install"))])).toThrow(
      "Invalid reading credit",
    );
    expect(() => projectGateRows([row, row])).toThrow("Duplicate reading ID");
  });

  it("rolls back real SQL writes when a transaction rejects and recovers its queue", async () => {
    const { ledger } = fixture();
    await expect(
      ledger.transaction(async (transaction) => {
        await transaction.append(reading());
        await transaction.compensate(reading());
        throw new Error("abort operation");
      }),
    ).rejects.toThrow("abort operation");
    expect(await ledger.rowsSince(0)).toEqual([]);
    await ledger.append(reading());
    expect(await ledger.rowsSince(0)).toEqual([reading()]);
  });

  it("shares connection serialization across separately injected adapters", async () => {
    const { db, ledger, deps } = fixture();
    const other = new ReadingLedger(createSQLiteStorage(db));
    const results = await Promise.all([
      consume(reading("a"), deps),
      consume(reading("b"), { ...deps, ledger: other }),
    ]);
    expect(results).toEqual([{ allowed: true }, { allowed: false, reason: "trial-exhausted" }]);
    expect(await ledger.rowsSince(0)).toEqual([reading("a")]);
  });

  it("supports an asynchronous injected SQL adapter over real SQLite", async () => {
    const { storage, deps } = fixture();
    const asynchronous: ReadingStorage = {
      transaction: (work) =>
        storage.transaction((sql) =>
          work({
            all: async (statement, parameters) => sql.all(statement, parameters),
            run: async (statement, parameters) => sql.run(statement, parameters),
          }),
        ),
    };
    const ledger = new ReadingLedger(asynchronous);
    expect(await consume(reading(), { ...deps, ledger })).toEqual({ allowed: true });
    await ledger.compensate(reading());
    expect(await ledger.rowsSince(0)).toEqual([credit(reading()), reading()]);
    expect(await ledger.gateRows()).toEqual([]);
  });
});

describe("consume: licensed/trial/exhausted/rate paths exact", () => {
  it.each([count, rate, time])(
    "allows a verified license in $mode mode and records its charge",
    async (policy) => {
      const { deps, ledger } = fixture(policy);
      await ledger.append(reading("previous"));
      expect(
        await consume(reading(), {
          ...deps,
          verifiedLicensed: async () => true,
          now: () => {
            throw new Error("Licensed access must bypass trial evaluation");
          },
        }),
      ).toEqual({ allowed: true });
      expect(await ledger.rowsSince(0)).toEqual([reading("previous"), reading()]);
    },
  );

  it("charges an active trial once and rejects an exhausted trial without appending", async () => {
    const { deps, ledger } = fixture();
    expect(await consume(reading(), { ...deps, verifiedLicensed: () => false })).toEqual({
      allowed: true,
    });
    expect(await consume(reading("next"), deps)).toEqual({
      allowed: false,
      reason: "trial-exhausted",
    });
    expect(await consume(reading(), deps)).toEqual({ allowed: true });
    expect(await ledger.rowsSince(0)).toEqual([reading()]);
  });

  it("deduplicates concurrent retries and admits only one concurrent count debit", async () => {
    const { deps, ledger } = fixture();
    expect(await Promise.all(Array.from({ length: 12 }, () => consume(reading(), deps)))).toEqual(
      Array.from({ length: 12 }, () => ({ allowed: true })),
    );
    await ledger.compensate(reading());
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => consume(reading(`new-${i}`), deps)),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed)).toEqual(
      Array.from({ length: 11 }, () => ({ allowed: false, reason: "trial-exhausted" })),
    );
    expect(await ledger.gateRows()).toEqual([reading("new-0")]);
    expect(await ledger.rowsSince(0)).toHaveLength(3);
  });

  it("a zero-Tier-1 refund restores count quota without letting an old ID charge again", async () => {
    const { deps, ledger } = fixture();
    await consume(reading(), deps);
    await ledger.compensate(reading());
    expect(await consume(reading(), deps)).toEqual({ allowed: true });
    expect(await ledger.gateRows()).toEqual([]);
    expect(await consume(reading("next"), deps)).toEqual({ allowed: true });
    expect(await ledger.rowsSince(0)).toEqual([credit(reading()), reading("next"), reading()]);
  });

  it("rejects retry ID collisions, including after compensation", async () => {
    const { deps, ledger } = fixture();
    await consume(reading(), deps);
    await ledger.compensate(reading());
    await expect(consume({ ...reading(), chartId: "other-plate" }, deps)).rejects.toThrow(
      "different request",
    );
    expect(await ledger.rowsSince(0)).toEqual([credit(reading()), reading()]);
  });

  it("limits rate before the boundary and allows exactly at the next reading time", async () => {
    const { deps, ledger } = fixture(rate);
    expect(await consume(reading(), deps)).toEqual({ allowed: true });
    expect(
      await consume(reading("next", 3 * DAY - 1), { ...deps, now: () => 3 * DAY - 1 }),
    ).toEqual({ allowed: false, reason: "rate-limited" });
    expect(await consume(reading("next", 3 * DAY), { ...deps, now: () => 3 * DAY })).toEqual({
      allowed: true,
    });
    expect(await ledger.gateRows()).toEqual([reading(), reading("next", 3 * DAY)]);
  });

  it("a zero-Tier-1 refund removes the rate cooldown rather than starting another", async () => {
    const { deps, ledger } = fixture(rate);
    await consume(reading(), deps);
    await ledger.compensate(reading());
    expect(evaluateGate(rate, await ledger.gateRows(), () => DAY)).toEqual({
      state: "trial-active",
    });
    expect(await consume(reading("next"), deps)).toEqual({ allowed: true });
    expect(await consume(reading("blocked"), deps)).toEqual({
      allowed: false,
      reason: "rate-limited",
    });
    expect(await ledger.rowsSince(0)).toHaveLength(3);
  });

  it("rate refunds preserve any earlier uncompensated cooldown", async () => {
    const { deps, ledger } = fixture(rate);
    const earlier = reading("earlier", 0);
    await ledger.append(earlier);
    await ledger.append(reading());
    await ledger.compensate(reading());
    expect(evaluateGate(rate, await ledger.gateRows(), () => DAY)).toEqual({
      state: "rate-limited",
      nextReadingAt: 2 * DAY,
    });
    expect(await consume(reading("blocked"), deps)).toEqual({
      allowed: false,
      reason: "rate-limited",
    });
    expect(await consume(reading("next", 2 * DAY), { ...deps, now: () => 2 * DAY })).toEqual({
      allowed: true,
    });
  });

  it("admits only one of multiple concurrent requests at a rate boundary", async () => {
    const { deps, ledger } = fixture(rate);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => consume(reading(`rate-${i}`), deps)),
    );
    expect(results).toEqual([
      { allowed: true },
      ...Array.from({ length: 7 }, () => ({ allowed: false, reason: "rate-limited" })),
    ]);
    expect(await ledger.gateRows()).toEqual([reading("rate-0")]);
  });

  it("preserves install time and expires a time trial exactly at its boundary", async () => {
    const { deps, ledger } = fixture(time);
    await ledger.append(reading("install", 0));
    expect(await consume(reading(), deps)).toEqual({ allowed: true });
    await ledger.compensate(reading());
    expect(await ledger.gateRows()).toEqual([reading("install", 0)]);
    expect(await consume(reading("next", 2 * DAY), { ...deps, now: () => 2 * DAY })).toEqual({
      allowed: false,
      reason: "trial-exhausted",
    });
    expect(await ledger.rowsSince(0)).toHaveLength(3);
  });

  it.each([count, rate, time])(
    "allows no-plate free chat with zero accounting or license effects in $mode mode",
    async (policy) => {
      const { deps, ledger } = fixture(policy);
      await ledger.append(reading("previous"));
      expect(
        await consume(reading(), {
          ...deps,
          plateInScope: false,
          verifiedLicensed: () => {
            throw new Error("Free chat does not consult licensing");
          },
          now: () => {
            throw new Error("Free chat does not evaluate a gate");
          },
        }),
      ).toEqual({ allowed: true });
      expect(await ledger.rowsSince(0)).toEqual([reading("previous")]);
    },
  );

  it("does not grant or debit when verification or trial configuration fails", async () => {
    const { deps, ledger } = fixture();
    await expect(
      consume(reading(), {
        ...deps,
        verifiedLicensed: async () => {
          throw new Error("verification failed");
        },
      }),
    ).rejects.toThrow("verification failed");
    await expect(
      consume(reading(), { ...deps, policy: { mode: "count", trialModel: "local-trial" } }),
    ).rejects.toThrow();
    expect(await ledger.rowsSince(0)).toEqual([]);
  });

  it("propagates an actual SQL failure, rolls back, and permits a later retry", async () => {
    const { db, deps, ledger } = fixture();
    db.exec(`CREATE TRIGGER reject_debit BEFORE INSERT ON readings WHEN NEW.id = 'r1'
      BEGIN SELECT RAISE(ABORT, 'disk write refused'); END;`);
    await expect(consume(reading(), deps)).rejects.toThrow("disk write refused");
    expect(await ledger.rowsSince(0)).toEqual([]);
    db.exec("DROP TRIGGER reject_debit");
    expect(await consume(reading(), deps)).toEqual({ allowed: true });
    expect(await ledger.rowsSince(0)).toEqual([reading()]);
  });
});
