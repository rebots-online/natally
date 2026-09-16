// natally — trial gate (ARCHITECTURE §9.1–§9.2; TEST_RUBRIC §TR-3, task B.1).
//
// Pure evaluation of exactly one gate — the one the baked `TrialPolicy.mode`
// selects — against the append-only `readings` ledger. No I/O, no clock
// reads (`now` is injected), no mutation of the caller's rows: the result is
// a deterministic function of (policy, ledgerRows, now, licensed).
//
// Ledger rules (§9.2 stores the install timestamp inside the same
// append-only `readings` table, so its handling is pinned here):
//   * The row with id `install` is the install-time bootstrap. It is
//     metadata, never a consumed reading: count mode does not count it,
//     rate mode does not treat it as the last reading, time mode reads it.
//   * Rows may arrive in any order ("sorted or sortable"); a sorted copy is
//     used internally and the input is never reordered.
//
// Mode semantics (epoch milliseconds; one day = 86_400_000, fixed-length):
//   count — trial-active while consumption rows < policy.readings
//           (remaining = readings − used); else trial-exhausted.
//   time  — window = installTs + policy.days·day. trial-active while
//           now < expiry (strict `<`: exactly-at-expiry is exhausted);
//           remaining = whole days left, floored, so 0 means "less than a
//           full day remains" while still active. installTs = ts of the
//           `install` row, else the first-seen (earliest) ts in the ledger,
//           else the current evaluation instant (empty ledger ⇒ the window
//           opens at first check).
//   rate  — rate-limited while now < lastReadingTs + policy.cooldownDays·day
//           (nextReadingAt = that instant; strict `<`: exactly-at-cooldown
//           is allowed); else trial-active. No consumption rows ⇒ active.
//   licensed (option) — a verified license (§9.3) short-circuits every rule
//           above and yields exactly { state: "licensed" }.

import type { Reading, TrialPolicy } from "./types";

/** The `readings` bootstrap row id carrying the install timestamp (§9.2). */
export const INSTALL_ROW_ID = "install";

/** One day in epoch milliseconds (fixed-length days; epoch math has no DST). */
export const DAY_MS = 86_400_000;

/** The designed gate states (§9.2 TrialIdle / TrialExhausted / rate-limited
 * next-date aside, plus the unlocked state once a license verifies, §9.3). */
export type GateState = "trial-active" | "trial-exhausted" | "rate-limited" | "licensed";

/**
 * One gate outcome. `remaining` appears only on `trial-active` (count mode:
 * readings left; time mode: whole days left, floored). `nextReadingAt`
 * appears only on `rate-limited`.
 */
export interface GateResult {
  readonly state: GateState;
  readonly remaining?: number;
  readonly nextReadingAt?: number;
}

/** Optional gate inputs. */
export interface GateOptions {
  /** A verified license token (§9.3) short-circuits all trial logic. */
  readonly licensed?: boolean;
}

/**
 * Total over `TrialPolicy`'s optional fields: the config transform
 * (`config.ts`) always populates the field its mode selects, so anything
 * else is a policy bug and fails loudly instead of silently unlocking.
 */
function requiredField(value: number | undefined, field: string): number {
  if (value === undefined) {
    throw new RangeError(`trial: policy field "${field}" is unset for the selected mode`);
  }
  return value;
}

/** Consumed readings only — the install bootstrap is metadata, not usage. */
function consumptionRows(sorted: readonly Reading[]): readonly Reading[] {
  return sorted.filter((row) => row.id !== INSTALL_ROW_ID);
}

/** Install timestamp: `install` row, else first-seen (earliest) ts, else now. */
function installTimestamp(sorted: readonly Reading[], nowMs: number): number {
  const bootstrap = sorted.find((row) => row.id === INSTALL_ROW_ID);
  if (bootstrap !== undefined) {
    return bootstrap.ts;
  }
  const first = sorted.at(0);
  if (first !== undefined) {
    return first.ts;
  }
  return nowMs;
}

/**
 * Evaluate the trial gate (§9.1–§9.2). Pure: the ledger is copied before
 * sorting, `now` supplies every instant, and nothing is read outside the
 * arguments. See the module header for the exact per-mode semantics.
 */
export function evaluateGate(
  policy: TrialPolicy,
  ledgerRows: readonly Reading[],
  now: () => number,
  options: GateOptions = {},
): GateResult {
  if (options.licensed === true) {
    return { state: "licensed" };
  }
  const sorted = [...ledgerRows].sort((a, b) => a.ts - b.ts);
  const nowMs = now();
  switch (policy.mode) {
    case "count": {
      const limit = requiredField(policy.readings, "readings");
      const used = consumptionRows(sorted).length;
      return used < limit
        ? { state: "trial-active", remaining: limit - used }
        : { state: "trial-exhausted" };
    }
    case "time": {
      const days = requiredField(policy.days, "days");
      const expiryMs = installTimestamp(sorted, nowMs) + days * DAY_MS;
      return nowMs < expiryMs
        ? { state: "trial-active", remaining: Math.floor((expiryMs - nowMs) / DAY_MS) }
        : { state: "trial-exhausted" };
    }
    case "rate": {
      const cooldownDays = requiredField(policy.cooldownDays, "cooldownDays");
      const last = consumptionRows(sorted).at(-1);
      if (last === undefined) {
        return { state: "trial-active" };
      }
      const nextReadingAt = last.ts + cooldownDays * DAY_MS;
      return nowMs < nextReadingAt
        ? { state: "rate-limited", nextReadingAt }
        : { state: "trial-active" };
    }
  }
}
