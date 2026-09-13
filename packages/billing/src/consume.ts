import { INSTALL_READING_ID, type ReadingLedger } from "./ledger.js";
import { evaluateGate } from "./trial.js";
import type { ConsumeResult, Reading, TrialPolicy } from "./types.js";

export interface ConsumeDeps {
  ledger: ReadingLedger;
  policy: TrialPolicy;
  now: () => number;
  /** Only B.3's verified entitlement state; never raw token presence or parsing. */
  verifiedLicensed?: () => boolean | Promise<boolean>;
  /** A Reading normally carries a plate. Explicit false is the free-chat path. */
  plateInScope?: boolean;
}

/**
 * §9.6 local implementation. Resolve B.3's verified state, then atomically check
 * committed net usage and charge a plate-scoped request. A retry of an accepted
 * ID stays accepted (also after compensation) and never incurs a second debit.
 * After a zero-Tier-1 fence result the caller awaits ledger.compensate(reading).
 */
export async function consume(reading: Reading, deps: ConsumeDeps): Promise<ConsumeResult> {
  if (deps.plateInScope === false) return { allowed: true };
  if (reading.id === INSTALL_READING_ID)
    throw new Error("The install ID is reserved for bootstrap");
  const licensed = deps.verifiedLicensed ? await deps.verifiedLicensed() : false;
  return deps.ledger.transaction(async (ledger) => {
    if (await ledger.has(reading)) return { allowed: true };
    const gate =
      licensed === true
        ? ({ state: "licensed" } as const)
        : evaluateGate(deps.policy, await ledger.gateRows(), deps.now);
    switch (gate.state) {
      case "licensed":
      case "trial-active":
        await ledger.append(reading);
        return { allowed: true };
      case "trial-exhausted":
        return { allowed: false, reason: "trial-exhausted" };
      case "rate-limited":
        return { allowed: false, reason: "rate-limited" };
    }
  });
}
