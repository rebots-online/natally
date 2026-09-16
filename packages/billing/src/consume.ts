// natally — billing.consume, the local half of the §9.6 seam (task B.2).
//
// THE SEAM — this exact function shape is frozen:
//
//     consume(reading: Reading, deps: ConsumeDeps): Promise<ConsumeResult>
//
// The hosted edition (D10, R2's clause) re-implements the same shape as a
// per-reading debit over Lightning/x402 rails; the local edition never
// re-architects around it. Everything the implementation needs is injected
// through `deps`, so the swap is a different deps/impl, not a new call shape.
//
// Local flow (§9.1–§9.3): a verified license short-circuits everything and the
// reading is allowed; otherwise the build-baked trial policy is evaluated
// against the append-only readings ledger and the gate state maps exactly:
//
//   licensed (short-circuit, before the gate) -> { allowed: true }
//   trial-active                              -> { allowed: true }
//   trial-exhausted                           -> { allowed: false, reason: "trial-exhausted" }
//   rate-limited                              -> { allowed: false, reason: "rate-limited" }
//
// The gate's `nextReadingAt` is deliberately not carried: `ConsumeResult`
// (§9.6) is frozen without it, and the UI's rate-limited "next date" aside
// re-derives the instant from the same ledger when it renders (§9.2).
//
// PURE OF WRITES. The gate check runs pre-inference (§9.2): consume() returns
// the decision and nothing else. Appending the reading row is the CALLER's
// duty — the call site appends exactly when the reading actually happens (the
// companion's first Tier-1-grounded turn), so a denied candidate never lands
// in the ledger and an allowed one is appended after, not during, the check.
// The `reading` argument is validated here as the unit of account (it is what
// the hosted debit will price), but the local gate consults ledger history
// only and never writes it.

import type { ReadingLedger } from "./ledger";
import { evaluateGate, type GateResult } from "./trial";
import { type ConsumeResult, type Reading, ReadingSchema, type TrialPolicy } from "./types";

/** Injected collaborators of the frozen seam. No I/O and no clock reads inside this module. */
export interface ConsumeDeps {
  /** The append-only readings ledger (§9.2). Read here; written only by callers. */
  readonly ledger: ReadingLedger;
  /** The build-baked trial policy (§9.1). */
  readonly policy: TrialPolicy;
  /** Injected clock (epoch ms) — every instant the gate needs (§9.2). */
  readonly now: () => number;
  /**
   * The B.3 verified-token check, injected: resolves true only when a license
   * token verified against the build-baked public key (§9.3).
   */
  readonly isLicensed: () => Promise<boolean>;
}

/**
 * Gate state -> frozen ConsumeResult (the exact mapping of §9.6). Exhaustive:
 * the `licensed` arm is unreachable locally because consume() checks the
 * license itself before evaluating the gate and never passes `licensed` into
 * evaluateGate — reaching it means a gate bug, which fails loudly instead of
 * silently unlocking (INC-19).
 */
function gateToResult(gate: GateResult): ConsumeResult {
  switch (gate.state) {
    case "licensed":
      throw new Error("billing.consume: gate reported licensed without a verified license");
    case "trial-active":
      return { allowed: true };
    case "trial-exhausted":
      return { allowed: false, reason: "trial-exhausted" };
    case "rate-limited":
      return { allowed: false, reason: "rate-limited" };
  }
}

/**
 * The §9.6 seam (frozen — see the module header). Decision only; never writes.
 * The candidate `reading` is not yet in the ledger when the gate runs, so a
 * count-mode denial at the limit is exact: N rows in, the (N+1)-th reading is
 * the one this call decides about.
 */
export async function consume(reading: Reading, deps: ConsumeDeps): Promise<ConsumeResult> {
  ReadingSchema.parse(reading);
  if (await deps.isLicensed()) {
    return { allowed: true };
  }
  return gateToResult(evaluateGate(deps.policy, deps.ledger.allRows(), deps.now));
}
