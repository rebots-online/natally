import { describe, expect, it, vi } from "vitest";
import { loadConfig, type RuntimeConfig } from "../src/config.js";
import { evaluateGate, type GateResult } from "../src/trial.js";
import type { Reading } from "../src/types.js";

const DAY_MS = 86_400_000;
const INSTALL_TS = 1_800_000_000_000;
const TRIAL_MODEL = "trial-model";

function row(id: string, ts: number): Reading {
  return { id, ts, personId: "person-1", chartId: "chart-1" };
}

const install = row("install", INSTALL_TS);
const first = row("first", INSTALL_TS + DAY_MS);
const second = row("second", INSTALL_TS + 2 * DAY_MS);
const third = row("third", INSTALL_TS + 3 * DAY_MS);
const count: RuntimeConfig["trial"] = { mode: "count", readings: 3, trialModel: TRIAL_MODEL };
const time: RuntimeConfig["trial"] = { mode: "time", days: 7, trialModel: TRIAL_MODEL };
const rate: RuntimeConfig["trial"] = { mode: "rate", cooldownDays: 2, trialModel: TRIAL_MODEL };

interface GateCase {
  name: string;
  policy: RuntimeConfig["trial"];
  rows: readonly Reading[];
  at: number;
  expected: GateResult;
}

const cases: GateCase[] = [
  {
    name: "count: empty ledger has the entire allowance",
    policy: count,
    rows: [],
    at: INSTALL_TS,
    expected: { state: "trial-active", remaining: 3 },
  },
  {
    name: "count: install bootstrap never consumes a reading",
    policy: count,
    rows: [install],
    at: INSTALL_TS,
    expected: { state: "trial-active", remaining: 3 },
  },
  {
    name: "count: one reading reduces the allowance",
    policy: count,
    rows: [install, first],
    at: first.ts,
    expected: { state: "trial-active", remaining: 2 },
  },
  {
    name: "count: the last allowed reading remains available",
    policy: count,
    rows: [first, install, second],
    at: second.ts,
    expected: { state: "trial-active", remaining: 1 },
  },
  {
    name: "count: exact limit is exhausted",
    policy: count,
    rows: [install, first, second, third],
    at: third.ts,
    expected: { state: "trial-exhausted", remaining: 0 },
  },
  {
    name: "count: over-limit remaining clamps to zero",
    policy: count,
    rows: [install, first, second, third, row("fourth", third.ts + 1)],
    at: third.ts + 1,
    expected: { state: "trial-exhausted", remaining: 0 },
  },
  {
    name: "count: passage of time does not consume allowance",
    policy: count,
    rows: [install, first],
    at: INSTALL_TS + 365 * DAY_MS,
    expected: { state: "trial-active", remaining: 2 },
  },
  {
    name: "time: active at installation",
    policy: time,
    rows: [install],
    at: INSTALL_TS,
    expected: { state: "trial-active" },
  },
  {
    name: "time: days are converted to milliseconds",
    policy: time,
    rows: [install],
    at: INSTALL_TS + DAY_MS,
    expected: { state: "trial-active" },
  },
  {
    name: "time: active one millisecond before expiry",
    policy: time,
    rows: [install],
    at: INSTALL_TS + 7 * DAY_MS - 1,
    expected: { state: "trial-active" },
  },
  {
    name: "time: exhausted exactly at expiry",
    policy: time,
    rows: [install],
    at: INSTALL_TS + 7 * DAY_MS,
    expected: { state: "trial-exhausted" },
  },
  {
    name: "time: exhausted after expiry",
    policy: time,
    rows: [install],
    at: INSTALL_TS + 7 * DAY_MS + 1,
    expected: { state: "trial-exhausted" },
  },
  {
    name: "time: reading count does not end a time trial",
    policy: time,
    rows: [install, first, second, third],
    at: third.ts,
    expected: { state: "trial-active" },
  },
  {
    name: "time: bootstrap ID determines install time regardless of row order",
    policy: time,
    rows: [row("older", INSTALL_TS - 30 * DAY_MS), first, install],
    at: INSTALL_TS + 7 * DAY_MS - 1,
    expected: { state: "trial-active" },
  },
  {
    name: "time: a later reading does not renew the deadline",
    policy: time,
    rows: [first, install, row("late", INSTALL_TS + 6 * DAY_MS)],
    at: INSTALL_TS + 7 * DAY_MS,
    expected: { state: "trial-exhausted" },
  },
  {
    name: "time: epoch zero is a valid install timestamp",
    policy: time,
    rows: [row("install", 0)],
    at: 7 * DAY_MS - 1,
    expected: { state: "trial-active" },
  },
  {
    name: "rate: an empty ledger allows the first reading",
    policy: rate,
    rows: [],
    at: INSTALL_TS,
    expected: { state: "trial-active" },
  },
  {
    name: "rate: install bootstrap does not trigger cooldown",
    policy: rate,
    rows: [install],
    at: INSTALL_TS,
    expected: { state: "trial-active" },
  },
  {
    name: "rate: cooldown starts at a real reading",
    policy: rate,
    rows: [install, first],
    at: first.ts,
    expected: { state: "rate-limited", nextReadingAt: first.ts + 2 * DAY_MS },
  },
  {
    name: "rate: days are converted to milliseconds",
    policy: rate,
    rows: [install, first],
    at: first.ts + DAY_MS,
    expected: { state: "rate-limited", nextReadingAt: first.ts + 2 * DAY_MS },
  },
  {
    name: "rate: limited one millisecond before cooldown ends",
    policy: rate,
    rows: [install, first],
    at: first.ts + 2 * DAY_MS - 1,
    expected: { state: "rate-limited", nextReadingAt: first.ts + 2 * DAY_MS },
  },
  {
    name: "rate: allowed exactly when cooldown ends",
    policy: rate,
    rows: [install, first],
    at: first.ts + 2 * DAY_MS,
    expected: { state: "trial-active" },
  },
  {
    name: "rate: allowed after cooldown ends",
    policy: rate,
    rows: [install, first],
    at: first.ts + 2 * DAY_MS + 1,
    expected: { state: "trial-active" },
  },
  {
    name: "rate: latest timestamp wins in an unsorted ledger",
    policy: rate,
    rows: [third, install, first, second],
    at: third.ts + DAY_MS,
    expected: { state: "rate-limited", nextReadingAt: third.ts + 2 * DAY_MS },
  },
  {
    name: "rate: bootstrap timestamp never determines cooldown",
    policy: rate,
    rows: [first, row("install", first.ts + 100 * DAY_MS)],
    at: first.ts + 2 * DAY_MS,
    expected: { state: "trial-active" },
  },
  {
    name: "rate: many readings do not create a count gate",
    policy: rate,
    rows: [install, first, second, third],
    at: third.ts + 2 * DAY_MS,
    expected: { state: "trial-active" },
  },
  {
    name: "rate: a real reading at epoch zero still starts cooldown",
    policy: rate,
    rows: [row("first", 0)],
    at: 1,
    expected: { state: "rate-limited", nextReadingAt: 2 * DAY_MS },
  },
  {
    name: "rate: clock rollback does not bypass cooldown",
    policy: rate,
    rows: [install, first],
    at: first.ts - 1,
    expected: { state: "rate-limited", nextReadingAt: first.ts + 2 * DAY_MS },
  },
];

describe("trial: count/time/rate/licensed matrices", () => {
  it.each(cases)("$name", ({ policy, rows, at, expected }) => {
    expect(evaluateGate(policy, rows, () => at)).toEqual(expected);
  });

  it.each(cases)("licensed overrides $name", ({ policy, rows, at }) => {
    expect(evaluateGate(policy, rows, () => at, true)).toEqual({ state: "licensed" });
  });

  it.each(cases)("unlicensed preserves $name", ({ policy, rows, at, expected }) => {
    expect(evaluateGate(policy, rows, () => at, false)).toEqual(expected);
  });
});

describe("RuntimeConfig trial parsing", () => {
  const env = {
    VITE_APP_NAME: "natally",
    VITE_APP_ID: "mba.robin.natally",
    VITE_APP_SLUG: "mba.robin.natally",
    VITE_MODEL_MIRROR_BASE: "https://models.example.test/natally",
    VITE_APP_URL: "https://app.example.test",
    VITE_LANDING_URL: "https://example.test",
    VITE_TRIAL_MODEL: TRIAL_MODEL,
    VITE_REVENUECAT_OFFERING_ID: "unlimited",
    VITE_LORE_ENABLED: "0",
    VITE_LORE_EMBED_DIM: "384",
  };

  it.each([
    {
      mode: "count",
      field: "VITE_TRIAL_READINGS",
      value: "3",
      expected: { state: "trial-active", remaining: 2 },
    },
    { mode: "time", field: "VITE_TRIAL_DAYS", value: "7", expected: { state: "trial-active" } },
    {
      mode: "rate",
      field: "VITE_TRIAL_RATE_COOLDOWN_DAYS",
      value: "2",
      expected: { state: "rate-limited", nextReadingAt: first.ts + 2 * DAY_MS },
    },
  ])("evaluates loadConfig's $mode block directly", ({ mode, field, value, expected }) => {
    const config = loadConfig({ ...env, VITE_TRIAL_MODE: mode, [field]: value });
    expect(evaluateGate(config.trial, [install, first], () => first.ts)).toEqual(expected);
  });

  it.each([
    { mode: "count", trialModel: TRIAL_MODEL },
    { mode: "time", trialModel: TRIAL_MODEL },
    { mode: "rate", trialModel: TRIAL_MODEL },
    { ...count, readings: 0 },
    { ...count, readings: -1 },
    { ...count, readings: 1.5 },
    { ...time, days: 0 },
    { ...rate, cooldownDays: -1 },
    { ...count, days: 7 },
    { ...time, cooldownDays: 2 },
    { ...rate, readings: 3 },
    { ...count, trialModel: "" },
    { ...count, readings: Number.NaN },
    { ...time, days: Number.POSITIVE_INFINITY },
    { ...rate, cooldownDays: 0.5 },
  ] satisfies RuntimeConfig["trial"][])("rejects invalid trial policy %j", (policy) => {
    expect(() => evaluateGate(policy, [install], () => INSTALL_TS)).toThrow();
  });
});

describe("trial clock, ledger, and license boundaries", () => {
  it.each([time, rate])("reads only the injected clock once in $mode mode", (policy) => {
    const now = vi.fn(() => first.ts);
    evaluateGate(policy, [install, first], now);
    expect(now).toHaveBeenCalledTimes(1);
  });

  it("observes changes to the injected clock on subsequent evaluations", () => {
    let currentTime = first.ts;
    const now = () => currentTime;
    expect(evaluateGate(rate, [install, first], now)).toEqual({
      state: "rate-limited",
      nextReadingAt: first.ts + 2 * DAY_MS,
    });
    currentTime = first.ts + 2 * DAY_MS;
    expect(evaluateGate(rate, [install, first], now)).toEqual({ state: "trial-active" });
  });

  it.each([count, time, rate])("does not mutate frozen inputs in $mode mode", (policy) => {
    const frozenPolicy = Object.freeze({ ...policy });
    const frozenRows = Object.freeze(
      [third, install, first].map((reading) => Object.freeze({ ...reading })),
    );
    const snapshot = frozenRows.map((reading) => ({ ...reading }));
    const expected = evaluateGate(frozenPolicy, frozenRows, () => third.ts);
    expect(evaluateGate(frozenPolicy, frozenRows, () => third.ts)).toEqual(expected);
    expect(frozenRows).toEqual(snapshot);
    expect(frozenPolicy).toEqual(policy);
  });

  it.each([
    { name: "empty ledger", rows: [] },
    { name: "reading without bootstrap", rows: [first] },
    { name: "duplicate bootstrap", rows: [install, { ...install }] },
  ])("rejects a missing or ambiguous time-trial bootstrap: $name", ({ rows }) => {
    expect(() => evaluateGate(time, rows, () => INSTALL_TS)).toThrow(
      "exactly one install bootstrap row",
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, INSTALL_TS + 0.5])(
    "rejects invalid injected timestamps: %s",
    (at) => {
      expect(() => evaluateGate(time, [install], () => at)).toThrow(RangeError);
      expect(() => evaluateGate(rate, [first], () => at)).toThrow(RangeError);
    },
  );

  it.each([time, rate])("rejects millisecond deadline overflow in $mode mode", (policy) => {
    const overflowPolicy = {
      ...policy,
      ...(policy.mode === "time"
        ? { days: Number.MAX_SAFE_INTEGER }
        : { cooldownDays: Number.MAX_SAFE_INTEGER }),
    };
    expect(() => evaluateGate(overflowPolicy, [install, first], () => INSTALL_TS)).toThrow();
  });

  it("requires a verified boolean rather than trusting a raw token or parsed payload", () => {
    for (const unverified of [
      "raw-license-token",
      { tier: "unlimited" },
      { state: "licensed" },
      1,
    ]) {
      expect(
        evaluateGate(
          count,
          [install, first, second, third],
          () => third.ts,
          unverified as unknown as boolean,
        ),
      ).toEqual({ state: "trial-exhausted", remaining: 0 });
    }
  });

  it("does not inspect trial history or invoke the clock for an already verified license", () => {
    const now = vi.fn(() => {
      throw new Error("Clock is unavailable");
    });
    expect(evaluateGate(time, [], now, true)).toEqual({ state: "licensed" });
    expect(now).not.toHaveBeenCalled();
  });
});
