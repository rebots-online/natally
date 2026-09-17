import type { RuntimeConfig } from "./config.js";
import { type Reading, TrialPolicySchema } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const trialFields = {
  count: "readings",
  time: "days",
  rate: "cooldownDays",
} as const;

const trialPolicySchema = TrialPolicySchema.superRefine((policy, context) => {
  const activeField = trialFields[policy.mode];
  for (const field of Object.values(trialFields)) {
    if (field === activeField && policy[field] === undefined) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `Required for trial mode ${policy.mode}`,
      });
    } else if (field !== activeField && policy[field] !== undefined) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `Must be absent for trial mode ${policy.mode}`,
      });
    }
  }
});

export type GateResult =
  | { state: "trial-active"; remaining?: number }
  | { state: "trial-exhausted"; remaining?: number }
  | { state: "rate-limited"; nextReadingAt: number }
  | { state: "licensed" };

function timestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Trial timestamps must be nonnegative epoch milliseconds");
  }
  return value;
}

function deadline(start: number, days: number): number {
  return timestamp(timestamp(start) + days * DAY_MS);
}

/**
 * Evaluate the parsed RuntimeConfig trial block against a readings-table snapshot.
 * All timestamps, including now() and nextReadingAt, are epoch milliseconds.
 * verifiedLicensed must come from the license controller's already verified state;
 * token parsing, signature verification, and entitlement acquisition belong there.
 */
export function evaluateGate(
  policy: RuntimeConfig["trial"],
  ledgerRows: readonly Readonly<Reading>[],
  now: () => number,
  verifiedLicensed: boolean = false,
): GateResult {
  if (verifiedLicensed === true) return { state: "licensed" };

  const trial = trialPolicySchema.parse(policy);
  const readings = ledgerRows.filter((row) => row.id !== "install");

  switch (trial.mode) {
    case "count": {
      // The schema requires this mode's field before evaluation.
      const remaining = Math.max(0, trial.readings! - readings.length);
      return {
        state: remaining > 0 ? "trial-active" : "trial-exhausted",
        remaining,
      };
    }
    case "time": {
      const installs = ledgerRows.filter((row) => row.id === "install");
      const install = installs[0];
      if (installs.length !== 1 || !install) {
        throw new Error("Time trials require exactly one install bootstrap row");
      }
      const expiresAt = deadline(install.ts, trial.days!);
      return {
        state: timestamp(now()) < expiresAt ? "trial-active" : "trial-exhausted",
      };
    }
    case "rate": {
      if (readings.length === 0) return { state: "trial-active" };
      const lastReadingAt = readings.reduce(
        (latest, row) => Math.max(latest, timestamp(row.ts)),
        0,
      );
      const nextReadingAt = deadline(lastReadingAt, trial.cooldownDays!);
      return timestamp(now()) < nextReadingAt
        ? { state: "rate-limited", nextReadingAt }
        : { state: "trial-active" };
    }
  }
}
