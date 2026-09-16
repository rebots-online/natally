// natally — U.6 injected seams for the paywall screen (ARCHITECTURE.md §9,
// SCREEN.md screen-paywall, normative). Everything the screen needs that
// another task owns arrives as a structural prop: the wiring layer (I.1)
// binds the real instances later, the screen never imports their modules.
// Shapes are mirrors, not re-exports — `@natally/billing`'s public export map
// exposes only its types + config surfaces, and a screen must not reach past
// a package's public exports (the same ruling U.2 recorded for the B.1 gate).
//
// Commerce law (DESIGN.md "Commerce surfaces"): the one gilt primary per
// screen is the unlock CTA; offerings, prices, trial counters, processor
// lists and failure reasons are runtime data; no pressure copy anywhere.

import type { CheckoutSession, Offering } from "@natally/billing";
import type { CompanionBus } from "../../companion/bus";

// ---------------------------------------------------------------------------
// B.1 trial gate mirror (packages/billing/src/trial.ts, `evaluateGate`)
// ---------------------------------------------------------------------------

/**
 * The designed gate states (§9.2): B.1's `GateState` union, mirrored
 * structurally — `@natally/billing` does not export its `trial.ts` surface.
 */
export type TrialGateState = "trial-active" | "trial-exhausted" | "rate-limited" | "licensed";

/**
 * One B.1 `GateResult`, mirrored: `remaining` appears only on `trial-active`
 * (count mode: readings left; time mode: whole days left), `nextReadingAt`
 * only on `rate-limited` (the plate's next-reading date, §9.2).
 */
export interface TrialGate {
  readonly state: TrialGateState;
  readonly remaining?: number;
  readonly nextReadingAt?: number;
}

// ---------------------------------------------------------------------------
// B.4 redeem mirror (packages/billing/src/codes.ts, `verifyCode`)
// ---------------------------------------------------------------------------

/** The four redeem outcomes, mapped 1:1 to the paywall's code-error variant. */
export type RedeemOutcome = "valid" | "invalid" | "already-used" | "expired";

/** `{outcome, tier?, exp?}` — tier/exp present only on `valid` (B.4). */
export interface RedeemResult {
  readonly outcome: RedeemOutcome;
  readonly tier?: "unlimited";
  readonly exp?: number;
}

/** B.4's redeem seam, with the wiring's baked dependencies injected. */
export type RedeemCodeFn = (code: string) => Promise<RedeemResult>;

/**
 * The ember line for a bad code — the SCREEN.md `[reason · runtime]` line
 * states the real outcome, never a generic shrug (INC-19; J11).
 */
export function redeemReason(result: RedeemResult): string {
  switch (result.outcome) {
    case "valid":
      return "";
    case "already-used":
      return "That code was already used.";
    case "expired":
      return result.exp === undefined
        ? "That code has expired."
        : `That code expired on ${formatDay(result.exp)}.`;
    case "invalid":
      return "That code isn't a natally code — check it and try again.";
  }
}

/** An epoch-ms instant as the computed `YYYY-MM-DD` fact (Plex Mono material). */
export function formatDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// B.5c registry mirror (packages/billing/src/adapters/registry.ts)
// ---------------------------------------------------------------------------

/** The six §9.4 processor rails; presence driven by the wiring's `.env` read. */
export type PaymentRail = "stripe" | "revenuecat" | "polar" | "lemonsqueezy" | "paypal" | "square";

/** Canonical rail order — the registry's output order for every readout (B.5c). */
export const PAYMENT_ORDER: readonly PaymentRail[] = [
  "stripe",
  "revenuecat",
  "polar",
  "lemonsqueezy",
  "paypal",
  "square",
];

/**
 * Authored labels for the paywall's honest "Ways to pay" line — mirrored from
 * B.5c's `PAYMENT_LABELS` (adapters/registry.ts is not on the public export
 * surface). A label names exactly the rail it belongs to; nothing else.
 */
export const PAYMENT_LABELS: Readonly<Record<PaymentRail, string>> = {
  stripe: "Card — Stripe",
  revenuecat: "RevenueCat",
  polar: "Card — Polar",
  lemonsqueezy: "Card — Lemon Squeezy",
  paypal: "PayPal",
  square: "Card — Square",
};

/**
 * The honest availability readout (B.5c `paymentsAvailable`): authored labels
 * for exactly the present rails, in canonical order. An empty install yields
 * an empty list — the line renders the absence, never an invented rail.
 */
export function paymentsAvailable(availableIds: readonly PaymentRail[]): string[] {
  return PAYMENT_ORDER.filter((rail) => availableIds.includes(rail)).map(
    (rail) => PAYMENT_LABELS[rail],
  );
}

/**
 * The structural seam the wiring injects in place of the B.5c registry: the
 * present rails, the one purchase entry, the one redeem entry.
 */
export interface PaywallRegistry {
  readonly availableIds: readonly PaymentRail[];
  readonly purchase: (rail: PaymentRail, offering: Offering) => Promise<CheckoutSession>;
  readonly redeem: RedeemCodeFn;
}

// ---------------------------------------------------------------------------
// Screen props
// ---------------------------------------------------------------------------

/** The trial plate's computed readout (§9.1/§9.2): usage counter + model. */
export interface TrialReadout {
  readonly used: number;
  readonly limit: number;
  readonly trialModel: string;
}

/** The seven frozen variant names (SCREEN.md `Variants`), kebab-cased. */
export type PaywallVariant =
  | "trial-active"
  | "trial-exhausted"
  | "rate-limited"
  | "already-unlocked"
  | "enter-code"
  | "code-error"
  | "desktop";

/** Which real source an ember line states (redeem outcomes are the frozen
 * code-error variant; a purchase-rail rejection states itself inline). */
export type EmberSource = "redeem" | "purchase";

export interface PaywallScreenProps {
  /** The B.1 gate result (§9.2) — the variant's primary real input. */
  readonly gate: TrialGate;
  /** The trial plate's computed readout (counter + trial model, §9.1). */
  readonly trial: TrialReadout;
  /** The runtime offering; absent ⇒ the honest absence marker, CTA disabled. */
  readonly offering?: Offering;
  /** The B.5c registry seam: ways-to-pay line, purchase, redeem. */
  readonly registry: PaywallRegistry;
  /** The C.4 bus — a valid code publishes `unlock` (Delighted, §10). */
  readonly bus: CompanionBus;
  /** Handoff: the wiring receives the session and routes to /checkout (J10). */
  readonly onHandoff: (session: CheckoutSession) => void;
  /** A valid code redeemed — wiring refreshes the gate / routes home. */
  readonly onUnlocked?: () => void;
  /** Quiet "Restore purchases" — the B.5a/§9.4 restore seam. */
  readonly onRestore?: () => void;
  /** The already-unlocked back CTA — wiring returns to the conversation. */
  readonly onBack?: () => void;
  /** Layout frame: desktop is the 430 column centred (SCREEN.md `desktop`). */
  readonly layout?: "mobile" | "desktop";
}
