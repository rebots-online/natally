import { describe, expect, it } from "vitest";
import {
  applyLifecycleEvent,
  assertNoMixing,
  assertRocheUnits,
  canApply,
  emptyLedgerState,
  FUNGIBILITY_MATRIX,
  fungibilityOf,
  InMemoryGrantLedger,
  isRocheUnits,
  type LifecycleEvent,
  ROCHE_MAX_UNITS,
  ROCHE_MIN_UNITS,
  ROCHE_UNIT_PRECISION,
  type RocheBalanceSource,
  RocheInsufficientError,
  RocheLifecycleError,
  RocheMixingError,
  RocheUnitsError,
} from "../src/roche.js";

const T0 = 1_000_000;

const purchase = (
  overrides: Partial<Extract<LifecycleEvent, { type: "purchase" }>> = {},
): Extract<LifecycleEvent, { type: "purchase" }> => ({
  type: "purchase",
  grantId: "g1",
  account: "acct",
  origin: "hosted-web-pwa",
  purchaseRef: "rc-purchase-1",
  units: 100,
  at: T0,
  ...overrides,
});

const renewal = (
  overrides: Partial<Extract<LifecycleEvent, { type: "renewal-grant" }>> = {},
): Extract<LifecycleEvent, { type: "renewal-grant" }> => ({
  type: "renewal-grant",
  grantId: "g2",
  account: "acct",
  origin: "hosted-web-pwa",
  subscriptionId: "sub-1",
  purchaseRef: "rc-period-1",
  periodKey: "2026-09",
  units: 50,
  at: T0 + 1,
  ...overrides,
});

describe("$ROCHE unit contract (§21.3)", () => {
  it("defines unit precision exactly once", () => {
    expect(ROCHE_UNIT_PRECISION).toBe(0);
  });

  it("accepts the inclusive bounds 0 and 2e9", () => {
    expect(isRocheUnits(0)).toBe(true);
    expect(isRocheUnits(ROCHE_MAX_UNITS)).toBe(true);
    expect(() => assertRocheUnits(0, "min")).not.toThrow();
    expect(() => assertRocheUnits(2_000_000_000, "max")).not.toThrow();
  });

  it("rejects -1 and 2e9+1 and non-integers", () => {
    for (const bad of [-1, 2_000_000_001, 1.5, Number.NaN]) {
      expect(isRocheUnits(bad)).toBe(false);
      expect(() => assertRocheUnits(bad, "bad")).toThrow(RocheUnitsError);
    }
  });
});

describe("fungibility matrix (§21.3)", () => {
  it("routes common-pool origins to the common pool, fungible", () => {
    for (const origin of ["windows-msix", "direct-msi-linux", "hosted-web-pwa"] as const) {
      const row = fungibilityOf(origin);
      expect(row.pool).toBe("common");
      expect(row.fungible).toBe(true);
      expect(canApply(origin, "common")).toBe(true);
      expect(canApply(origin, "google-play-app")).toBe(false);
    }
  });

  it("restricts google-play to its app pool", () => {
    const row = fungibilityOf("google-play");
    expect(row.fungible).toBe(false);
    expect(canApply("google-play", "google-play-app")).toBe(true);
    expect(canApply("google-play", "common")).toBe(false);
    expect(canApply("google-play", "direct-android")).toBe(false);
  });

  it("keeps direct-android distinct from the play origin", () => {
    const row = fungibilityOf("direct-android");
    expect(row.fungible).toBe(false);
    expect(row.pool).toBe("direct-android");
    expect(canApply("direct-android", "google-play-app")).toBe(false);
    expect(canApply("direct-android", "common")).toBe(false);
  });

  it("keeps future-apple restricted pending StoreKit/RC rules", () => {
    const row = fungibilityOf("future-apple");
    expect(row.fungible).toBe(false);
    expect(canApply("future-apple", "common")).toBe(false);
    expect(canApply("future-apple", "future-apple")).toBe(true);
  });

  it("is a closed matrix: one row per origin, no extras", () => {
    expect(FUNGIBILITY_MATRIX.map((row) => row.origin)).toEqual([
      "windows-msix",
      "direct-msi-linux",
      "hosted-web-pwa",
      "google-play",
      "direct-android",
      "future-apple",
    ]);
  });

  it("assertNoMixing throws when origin sets span pools", () => {
    expect(() => assertNoMixing(["windows-msix", "hosted-web-pwa"])).not.toThrow();
    expect(() => assertNoMixing(["google-play"])).not.toThrow();
    expect(() => assertNoMixing(["windows-msix", "google-play"])).toThrow(RocheMixingError);
    expect(() => assertNoMixing(["google-play", "direct-android"])).toThrow(RocheMixingError);
    expect(() => assertNoMixing(["future-apple", "direct-msi-linux"])).toThrow(RocheMixingError);
  });
});

describe("grant/refund lifecycle (§21.6)", () => {
  it("grants a purchase once; replay of the same purchaseRef is rejected", () => {
    const state = applyLifecycleEvent(emptyLedgerState(), purchase());
    expect(() => applyLifecycleEvent(state, purchase({ grantId: "g9" }))).toThrow(
      RocheLifecycleError,
    );
    expect(() => applyLifecycleEvent(state, purchase())).toThrow(RocheLifecycleError);
  });

  it("rejects double grants within the same paid period", () => {
    const state = applyLifecycleEvent(emptyLedgerState(), renewal());
    expect(() =>
      applyLifecycleEvent(state, renewal({ grantId: "g3", purchaseRef: "rc-period-1b" })),
    ).toThrow(/one grant per paid period/);
  });

  it("cancel stops future grants but keeps paid-through benefit", () => {
    let state = applyLifecycleEvent(emptyLedgerState(), renewal({ periodKey: "2026-08" }));
    state = applyLifecycleEvent(state, {
      type: "cancel",
      account: "acct",
      subscriptionId: "sub-1",
      paidThroughPeriodKey: "2026-08",
      at: T0 + 2,
    });
    // Paid-through period retained (its grant was already issued).
    expect(state.grants).toHaveLength(1);
    // Future period beyond paid-through is stopped.
    expect(() =>
      applyLifecycleEvent(state, renewal({ grantId: "g4", periodKey: "2026-09" })),
    ).toThrow(/no grants past paid-through/);
  });

  it("refund revokes only that purchase's benefit", () => {
    let state = applyLifecycleEvent(emptyLedgerState(), purchase({ grantId: "g1", units: 100 }));
    state = applyLifecycleEvent(
      state,
      purchase({ grantId: "g2", purchaseRef: "rc-purchase-2", units: 200 }),
    );
    state = applyLifecycleEvent(state, {
      type: "refund",
      grantId: "g1",
      account: "acct",
      reason: "chargeback",
      at: T0 + 3,
    });
    expect(state.grants.map((grant) => grant.grantId)).toEqual(["g2"]);
    const ledger = new InMemoryGrantLedger(state);
    expect(ledger.balanceOf("acct", "common")).toBe(200);
  });

  it("restore reconciles without re-issuing initial credits", () => {
    let state = applyLifecycleEvent(emptyLedgerState(), purchase({ units: 100 }));
    const before = new InMemoryGrantLedger(state).balanceOf("acct", "common");
    state = applyLifecycleEvent(state, { type: "restore", account: "acct", at: T0 + 4 });
    const ledger = new InMemoryGrantLedger(state);
    expect(ledger.balanceOf("acct", "common")).toBe(before);
    expect(ledger.grantsFor("acct")).toHaveLength(1);
    expect(state.events.at(-1)?.type).toBe("restore");
  });
});

describe("no-negative invariant under every mutation", () => {
  it("spend beyond balance throws and leaves state untouched", () => {
    const state = applyLifecycleEvent(emptyLedgerState(), purchase({ units: 50 }));
    expect(() =>
      applyLifecycleEvent(state, {
        type: "spend",
        account: "acct",
        pool: "common",
        units: 51,
        at: T0 + 5,
      }),
    ).toThrow(RocheInsufficientError);
  });

  it("every mutation on the ledger keeps balances within 0..2e9", () => {
    const ledger = new InMemoryGrantLedger();
    ledger.apply(purchase({ units: ROCHE_MAX_UNITS }));
    expect(ledger.balanceOf("acct", "common")).toBe(ROCHE_MAX_UNITS);
    ledger.apply({
      type: "spend",
      account: "acct",
      pool: "common",
      units: ROCHE_MAX_UNITS,
      at: T0 + 6,
    });
    expect(ledger.balanceOf("acct", "common")).toBe(ROCHE_MIN_UNITS);
    expect(() =>
      ledger.apply({
        type: "spend",
        account: "acct",
        pool: "common",
        units: 1,
        at: T0 + 7,
      }),
    ).toThrow(RocheInsufficientError);
    ledger.apply({
      type: "refund",
      grantId: "g1",
      account: "acct",
      reason: "test",
      at: T0 + 8,
    });
    expect(ledger.balanceOf("acct", "common")).toBe(ROCHE_MIN_UNITS);
  });

  it("spend deducts FIFO across grants within a pool only", () => {
    const ledger = new InMemoryGrantLedger();
    ledger.apply(purchase({ units: 30 }));
    ledger.apply(purchase({ grantId: "g2", purchaseRef: "rc-purchase-2", units: 20 }));
    ledger.apply(renewal({ grantId: "g3", units: 10 }));
    ledger.apply({ type: "spend", account: "acct", pool: "common", units: 40, at: T0 + 9 });
    expect(ledger.balanceOf("acct", "common")).toBe(20);
    // A restricted-origin grant never contributes to the common pool.
    ledger.apply(
      purchase({ grantId: "g4", purchaseRef: "rc-play-1", origin: "google-play", units: 500 }),
    );
    expect(ledger.balanceOf("acct", "common")).toBe(20);
    expect(ledger.balanceOf("acct", "google-play-app")).toBe(500);
  });
});

describe("authority split (§21.3)", () => {
  it("the ledger is itself a RocheBalanceSource: balances read only through that seam", () => {
    const source: RocheBalanceSource = new InMemoryGrantLedger();
    const ledger = new InMemoryGrantLedger();
    ledger.apply(purchase({ units: 7 }));
    // The service-facing view is the balance query, never a recomputation.
    expect(source.balanceOf("acct", "common")).toBe(0);
    expect(ledger.balanceOf("acct", "common")).toBe(7);
  });
});
