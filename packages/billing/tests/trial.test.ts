// natally — B.1 trial-gate matrices (TEST_RUBRIC §TR-3). Table-driven and
// pure: every case fixes an absolute epoch instant and the clock is injected
// (a plain closure — no Date.now, no timers, no mocks).

import { describe, expect, it } from "vitest";
import { DAY_MS, INSTALL_ROW_ID, evaluateGate } from "../src/trial";
import type { GateResult } from "../src/trial";
import type { Reading, TrialPolicy } from "../src/types";

/** Arbitrary fixed epoch (2023-11-14T22:13:20Z); nothing reads the wall clock. */
const T0 = 1_700_000_000_000;

function row(id: string, ts: number): Reading {
  return { id, ts, personId: "person-1", chartId: "chart-1" };
}

function clockAt(nowMs: number): () => number {
  return () => nowMs;
}

const countPolicy: TrialPolicy = { mode: "count", readings: 3, trialModel: "trial-model" };
const timePolicy: TrialPolicy = { mode: "time", days: 14, trialModel: "trial-model" };
const ratePolicy: TrialPolicy = { mode: "rate", cooldownDays: 3, trialModel: "trial-model" };
const rateZeroPolicy: TrialPolicy = { mode: "rate", cooldownDays: 0, trialModel: "trial-model" };

interface GateCase {
  readonly name: string;
  readonly policy: TrialPolicy;
  readonly rows: readonly Reading[];
  readonly nowMs: number;
  readonly licensed?: boolean;
  readonly expected: GateResult;
}

const cases: readonly GateCase[] = [
  // -- count (limit 3) ------------------------------------------------------
  {
    name: "count: empty ledger ⇒ active with the full remaining",
    policy: countPolicy,
    rows: [],
    nowMs: T0,
    expected: { state: "trial-active", remaining: 3 },
  },
  {
    name: "count: one reading ⇒ remaining decremented",
    policy: countPolicy,
    rows: [row("r1", T0)],
    nowMs: T0 + 1,
    expected: { state: "trial-active", remaining: 2 },
  },
  {
    name: "count: one below the limit ⇒ remaining 1",
    policy: countPolicy,
    rows: [row("r1", T0), row("r2", T0 + DAY_MS)],
    nowMs: T0 + 2 * DAY_MS,
    expected: { state: "trial-active", remaining: 1 },
  },
  {
    name: "count: exactly at the limit ⇒ exhausted (0-remaining boundary)",
    policy: countPolicy,
    rows: [row("r1", T0), row("r2", T0 + DAY_MS), row("r3", T0 + 2 * DAY_MS)],
    nowMs: T0 + 2 * DAY_MS,
    expected: { state: "trial-exhausted" },
  },
  {
    name: "count: over the limit (append-only history) ⇒ exhausted",
    policy: countPolicy,
    rows: [
      row("r1", T0),
      row("r2", T0 + DAY_MS),
      row("r3", T0 + 2 * DAY_MS),
      row("r4", T0 + 3 * DAY_MS),
    ],
    nowMs: T0 + 3 * DAY_MS,
    expected: { state: "trial-exhausted" },
  },
  {
    name: "count: install bootstrap is metadata, never a consumed reading",
    policy: countPolicy,
    rows: [row(INSTALL_ROW_ID, T0), row("r1", T0 + DAY_MS), row("r2", T0 + 2 * DAY_MS)],
    nowMs: T0 + 2 * DAY_MS,
    expected: { state: "trial-active", remaining: 1 },
  },
  {
    name: "count: license short-circuits even with an exhausted ledger",
    policy: countPolicy,
    rows: [row("r1", T0), row("r2", T0 + 1), row("r3", T0 + 2), row("r4", T0 + 3)],
    nowMs: T0 + 4,
    licensed: true,
    expected: { state: "licensed" },
  },

  // -- time (window 14 days) ------------------------------------------------
  {
    name: "time: empty ledger ⇒ window opens at first check, remaining = days",
    policy: timePolicy,
    rows: [],
    nowMs: T0,
    expected: { state: "trial-active", remaining: 14 },
  },
  {
    name: "time: install row, one day before rollover ⇒ remaining 1",
    policy: timePolicy,
    rows: [row(INSTALL_ROW_ID, T0)],
    nowMs: T0 + 13 * DAY_MS,
    expected: { state: "trial-active", remaining: 1 },
  },
  {
    name: "time: exactly at expiry ⇒ exhausted (day-rollover boundary)",
    policy: timePolicy,
    rows: [row(INSTALL_ROW_ID, T0)],
    nowMs: T0 + 14 * DAY_MS,
    expected: { state: "trial-exhausted" },
  },
  {
    name: "time: one ms before expiry ⇒ active with 0 whole days left",
    policy: timePolicy,
    rows: [row(INSTALL_ROW_ID, T0)],
    nowMs: T0 + 14 * DAY_MS - 1,
    expected: { state: "trial-active", remaining: 0 },
  },
  {
    name: "time: no install row ⇒ first-seen (earliest) ledger ts anchors the window",
    policy: timePolicy,
    rows: [row("r1", T0)],
    nowMs: T0 + 14 * DAY_MS,
    expected: { state: "trial-exhausted" },
  },
  {
    name: "time: unsorted rows ⇒ the earliest ts is the anchor",
    policy: timePolicy,
    rows: [row("r2", T0 + 2 * DAY_MS), row("r1", T0 + DAY_MS)],
    nowMs: T0 + 14 * DAY_MS,
    expected: { state: "trial-active", remaining: 1 },
  },
  {
    name: "time: license short-circuits past expiry",
    policy: timePolicy,
    rows: [row(INSTALL_ROW_ID, T0)],
    nowMs: T0 + 30 * DAY_MS,
    licensed: true,
    expected: { state: "licensed" },
  },

  // -- rate (cooldown 3 days unless noted) ----------------------------------
  {
    name: "rate: no readings yet ⇒ active, nothing pending",
    policy: ratePolicy,
    rows: [],
    nowMs: T0,
    expected: { state: "trial-active" },
  },
  {
    name: "rate: only the install row ⇒ active (bootstrap is not a reading)",
    policy: ratePolicy,
    rows: [row(INSTALL_ROW_ID, T0)],
    nowMs: T0,
    expected: { state: "trial-active" },
  },
  {
    name: "rate: one ms before cooldown expiry ⇒ rate-limited with nextReadingAt",
    policy: ratePolicy,
    rows: [row("r1", T0)],
    nowMs: T0 + 3 * DAY_MS - 1,
    expected: { state: "rate-limited", nextReadingAt: T0 + 3 * DAY_MS },
  },
  {
    name: "rate: exactly at cooldown ⇒ allowed (strict-< boundary)",
    policy: ratePolicy,
    rows: [row("r1", T0)],
    nowMs: T0 + 3 * DAY_MS,
    expected: { state: "trial-active" },
  },
  {
    name: "rate: past cooldown ⇒ active",
    policy: ratePolicy,
    rows: [row("r1", T0)],
    nowMs: T0 + 3 * DAY_MS + 1,
    expected: { state: "trial-active" },
  },
  {
    name: "rate: cooldown is measured from the latest of unsorted rows",
    policy: ratePolicy,
    rows: [row("r2", T0 + DAY_MS), row("r1", T0)],
    nowMs: T0 + 3 * DAY_MS,
    expected: { state: "rate-limited", nextReadingAt: T0 + 4 * DAY_MS },
  },
  {
    name: "rate: zero-day cooldown never limits",
    policy: rateZeroPolicy,
    rows: [row("r1", T0)],
    nowMs: T0,
    expected: { state: "trial-active" },
  },
  {
    name: "rate: license short-circuits inside the cooldown",
    policy: ratePolicy,
    rows: [row("r1", T0)],
    nowMs: T0 + DAY_MS,
    licensed: true,
    expected: { state: "licensed" },
  },
];

describe("trial: count/time/rate/licensed matrices pass (≥14 cases)", () => {
  it.each<GateCase>(cases)("$name", (c) => {
    expect(evaluateGate(c.policy, c.rows, clockAt(c.nowMs), { licensed: c.licensed })).toEqual(
      c.expected,
    );
  });

  it("matrix covers at least 14 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(14);
  });

  it("is pure: works from a sorted copy and never touches the input ledger", () => {
    const rows = [row("r2", T0 + DAY_MS), row(INSTALL_ROW_ID, T0), row("r1", T0 + 2 * DAY_MS)];
    const snapshot = rows.map((r) => ({ ...r }));
    evaluateGate(ratePolicy, rows, clockAt(T0 + 4 * DAY_MS));
    expect(rows.map((r) => r.id)).toEqual(["r2", INSTALL_ROW_ID, "r1"]);
    expect(rows).toEqual(snapshot);
  });

  it("count policy without a readings limit fails loudly (policy bug, not unlock)", () => {
    const bad: TrialPolicy = { mode: "count", trialModel: "trial-model" };
    expect(() => evaluateGate(bad, [], clockAt(T0))).toThrow(RangeError);
  });

  it("time policy without days fails loudly (policy bug, not unlock)", () => {
    const bad: TrialPolicy = { mode: "time", trialModel: "trial-model" };
    expect(() => evaluateGate(bad, [], clockAt(T0))).toThrow(RangeError);
  });

  it("rate policy without cooldownDays fails loudly (policy bug, not unlock)", () => {
    const bad: TrialPolicy = { mode: "rate", trialModel: "trial-model" };
    expect(() => evaluateGate(bad, [], clockAt(T0))).toThrow(RangeError);
  });
});
