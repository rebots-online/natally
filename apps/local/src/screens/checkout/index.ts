// natally — Checkout screen module (U.6). Registers the /checkout route
// (frozen route set, U.1 router); I.1 consolidates the app's import list
// against this module. Importing this module is what registers the route.

import { registerRoute } from "../../ui/router";

export { default as CheckoutRoute } from "./checkout-route";
export { CheckoutScreen } from "./checkout-screen";
export {
  type CheckoutOutcome,
  type CheckoutScreenProps,
  type CheckoutVariant,
  deriveCheckoutVariant,
} from "./types";

registerRoute({
  path: "/checkout",
  load: () => import("./checkout-route"),
});
