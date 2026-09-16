// natally — Paywall screen module (U.6). Registers the /paywall route (frozen
// route set, U.1 router); I.1 consolidates the app's import list against this
// module. Importing this module is what registers the route.

import { registerRoute } from "../../ui/router";

export { default as PaywallRoute } from "./paywall-route";
export { derivePaywallVariant, PaywallScreen, trialPlateRows } from "./paywall-screen";
export {
  type EmberSource,
  formatDay,
  PAYMENT_LABELS,
  PAYMENT_ORDER,
  type PaymentRail,
  type PaywallRegistry,
  type PaywallScreenProps,
  type PaywallVariant,
  paymentsAvailable,
  type RedeemCodeFn,
  type RedeemOutcome,
  type RedeemResult,
  redeemReason,
  type TrialGate,
  type TrialGateState,
  type TrialReadout,
} from "./types";

registerRoute({
  path: "/paywall",
  load: () => import("./paywall-route"),
});
