// natally — order-stable purchase-adapter registry (ARCHITECTURE §9.4,
// TEST_RUBRIC TR-3/B.5c).
//
// One seam between the paywall and the six §9.4 rails. The wiring (I-phase)
// constructs the B.5a hosted adapters and the B.5b RevenueCat adapter from
// `.env` and hands the instances here; the registry filters them by their own
// honest `available()` readout and keeps the canonical rail order
//
//     stripe, revenuecat, polar, lemonsqueezy, paypal, square
//
// so the paywall's "Ways to pay" line is deterministic regardless of wiring
// order. Absent rails (blank `.env` keys) simply do not appear — the honest
// availability readout is INC-19 discipline: `paymentsAvailable(registry)`
// returns the authored labels for exactly the rails that are present, and a
// purchase against an absent rail is a typed `RegistryError('rail-absent')`,
// never a fake success.
//
// The redeem entry delegates to B.4: the wiring bakes `verifyCode`'s
// dependencies (baked public key, local consumed ledger, verification
// instant) into a `redeemCode(code)` function and injects it here; the
// registry passes the `{outcome, tier?, exp?}` result through verbatim.

import type { VerifyCodeResult } from "../codes";
import type { CheckoutSession, Offering, PurchaseAdapter, PurchaseAdapterId } from "../types";

// ---------------------------------------------------------------------------
// Canonical order + authored labels (the paywall's honest line, INC-19)
// ---------------------------------------------------------------------------

/** Canonical rail order; the registry's output order for every readout. */
export const PAYMENT_ORDER: readonly PurchaseAdapterId[] = [
  "stripe",
  "revenuecat",
  "polar",
  "lemonsqueezy",
  "paypal",
  "square",
];

/**
 * Authored-static labels for the paywall's "Ways to pay" honest line — every
 * label is a computed fact (this constant), never generated prose (INC-19).
 */
export const PAYMENT_LABELS: Readonly<Record<PurchaseAdapterId, string>> = {
  stripe: "Card — Stripe",
  revenuecat: "RevenueCat",
  polar: "Card — Polar",
  lemonsqueezy: "Card — Lemon Squeezy",
  paypal: "PayPal",
  square: "Card — Square",
};

// ---------------------------------------------------------------------------
// Typed failures
// ---------------------------------------------------------------------------

export type RegistryErrorReason = "rail-absent";

/** Purchasing on a rail that is not wired or not available on this install. */
export class RegistryError extends Error {
  readonly reason: RegistryErrorReason;
  readonly adapterId: PurchaseAdapterId;

  constructor(adapterId: PurchaseAdapterId) {
    super(
      `natally.billing: payment rail "${adapterId}" is absent on this install (no wired adapter or blank .env keys)`,
    );
    this.name = "RegistryError";
    this.reason = "rail-absent";
    this.adapterId = adapterId;
  }
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * B.4's redeem seam, baked at wiring time: the constructed wrapper closes over
 * `verifyCode`'s dependencies (public key, consumed ledger, clock); the
 * registry passes codes through and returns its `{outcome, tier?, exp?}`.
 */
export type RedeemCodeFn = (code: string) => Promise<VerifyCodeResult>;

export interface AdapterRegistryOptions {
  /** The wired §9.4 adapter instances (B.5a hosted + B.5b RevenueCat). */
  readonly adapters: readonly PurchaseAdapter[];
  /** B.4 `verifyCode` wrapper with its deps injected at wiring time. */
  readonly redeemCode: RedeemCodeFn;
}

export interface AdapterRegistry {
  /** The present rails, in canonical `PAYMENT_ORDER` order. */
  readonly availableIds: readonly PurchaseAdapterId[];
  /** The one purchase entry: delegates to the rail's `checkout`. */
  readonly purchase: (adapterId: PurchaseAdapterId, offering: Offering) => Promise<CheckoutSession>;
  /** The one redeem entry: delegates to the injected B.4 wrapper. */
  readonly redeem: (code: string) => Promise<VerifyCodeResult>;
}

/**
 * Build the registry: instances are filtered by their own `available()`
 * (absent rails are hidden, not stored) and keyed by id in canonical order —
 * the first present instance per id wins, so the readout is order-stable no
 * matter how the wiring array is ordered.
 */
export function createAdapterRegistry(options: AdapterRegistryOptions): AdapterRegistry {
  const present = new Map<PurchaseAdapterId, PurchaseAdapter>();
  for (const adapter of options.adapters) {
    if (!adapter.available()) continue; // honest absence: the rail is hidden
    if (present.has(adapter.id)) continue; // order-stable: first present instance wins
    present.set(adapter.id, adapter);
  }
  const availableIds: readonly PurchaseAdapterId[] = PAYMENT_ORDER.filter((id) => present.has(id));

  return {
    availableIds,

    async purchase(adapterId, offering): Promise<CheckoutSession> {
      const adapter = present.get(adapterId);
      if (adapter === undefined) throw new RegistryError(adapterId);
      return adapter.checkout(offering);
    },

    redeem(code: string): Promise<VerifyCodeResult> {
      return options.redeemCode(code);
    },
  };
}

/**
 * The paywall's honest "Ways to pay" readout: authored labels for exactly the
 * present rails, in canonical order. An empty install yields an empty list —
 * the line renders the absence, never an invented rail.
 */
export function paymentsAvailable(registry: AdapterRegistry): string[] {
  return registry.availableIds.map((id) => PAYMENT_LABELS[id]);
}
