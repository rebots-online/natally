// natally — U.6 injected seams for the checkout screen (ARCHITECTURE.md §9.4,
// SCREEN.md screen-checkout, normative; J10). Everything the screen needs that
// another task owns arrives as a structural prop — the wiring layer (I.1)
// binds the real instances (B.5a hosted poll, B.5b RC entitlement, B.3
// license verify) later; the screen never imports their modules. The
// `CheckoutSession` shape IS public (`@natally/billing` root, §9.4) and is
// imported directly; the redeem seam is the B.4 mirror from the paywall
// screen's owned types (same task, one shape).
//
// Commerce law (DESIGN.md "Commerce surfaces"): one gilt primary per screen;
// checkout links and failure reasons are runtime data (Plex Mono markers,
// never sample prose); no fake payment states — the honest-absence frame
// carries the truth instead.

import type { CheckoutSession } from "@natally/billing";
import type { CompanionBus } from "../../companion/bus";
import type { RedeemCodeFn } from "../paywall/types";

/** The in-flight outcome, as the wiring's B.5a poll / B.3 verify reports it. */
export type CheckoutOutcome =
  | { readonly kind: "waiting" }
  | { readonly kind: "success" }
  | { readonly kind: "failure"; readonly reason: string };

/** The six frozen variant names (SCREEN.md `Variants`), kebab-cased. */
export type CheckoutVariant =
  | "handoff"
  | "iap-waiting"
  | "success"
  | "failure"
  | "offline"
  | "enter-license-key";

export interface CheckoutScreenProps {
  /** The real session from the rail's `checkout` (§9.4); null ⇒ nothing is in
   * flight (only honest alongside `offline` or the key-entry path). */
  readonly session: CheckoutSession | null;
  /** No connection — the honest-absence frame ("checkout needs the internet once"). */
  readonly offline: boolean;
  /** The wiring's live outcome for the in-flight session. */
  readonly outcome: CheckoutOutcome;
  /** The manual license-key entry path (§9.4 desktop). */
  readonly keyEntry: boolean;
  /** The C.4 bus — success publishes `unlock` (Delighted, §10). */
  readonly bus: CompanionBus;
  /** failure / offline "Try again" — the wiring restarts the checkout. */
  readonly onRetry: () => void;
  /** iap-waiting "Cancel" — the wiring returns to the paywall. */
  readonly onCancel: () => void;
  /** handoff "Open the page again" — the wiring re-opens the hosted URL. */
  readonly onOpenCheckout: () => void;
  /** success "Back to our conversation" — the wiring routes home. */
  readonly onUnlock: () => void;
  /** Enters / leaves the key-entry path (the handoff's license-key note). */
  readonly onToggleKeyEntry: (keyEntry: boolean) => void;
  /** The B.4 redeem seam for the license-key path (keys share the code shape). */
  readonly redeemKey: RedeemCodeFn;
  /** A valid key redeemed — wiring refreshes the gate / routes home. */
  readonly onUnlocked?: () => void;
  /** Layout frame: desktop is the 430 column centred (DESIGN.md "Layout"). */
  readonly layout?: "mobile" | "desktop";
}

/**
 * The frozen variant as a pure function of the real inputs. `offline` wins
 * (no network, no states to show), then the key-entry path, then the live
 * outcome, then the session's rail kind: `redirect` ⇒ handoff, `iap` store
 * sheet and `rc` paywall-presented are both the iap-waiting frame (the
 * frozen set names states, not per-rail frames — the runtime line names the
 * rail truthfully). A null session outside those is the screen's
 * honest-absence frame: nothing is in flight, and the screen says so.
 */
export function deriveCheckoutVariant(inputs: {
  readonly offline: boolean;
  readonly keyEntry: boolean;
  readonly outcome: CheckoutOutcome;
  readonly session: CheckoutSession | null;
}): CheckoutVariant {
  if (inputs.offline) {
    return "offline";
  }
  if (inputs.keyEntry) {
    return "enter-license-key";
  }
  if (inputs.outcome.kind === "success") {
    return "success";
  }
  if (inputs.outcome.kind === "failure") {
    return "failure";
  }
  if (inputs.session === null) {
    return "offline";
  }
  return inputs.session.kind === "redirect" ? "handoff" : "iap-waiting";
}
