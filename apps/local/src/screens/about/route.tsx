import type { ComponentType } from "react";
import type { RouteScreenProps } from "../../ui/router.js";
import { AboutScreen } from "./index.js";

/**
 * Route adapter for the About screen (`/about`). Static content only: no
 * composition root services are needed. Registered through the generated route
 * registry (I.1) — W3-S2 note: apps/local/scripts/gen-routes.mjs ROUTE_MAP needs
 * its `about: "/about"` line uncommented and a regeneration run when the
 * verbatim-wiring pass lands; until then this adapter is unused by the registry.
 */

const AboutRouteScreen: ComponentType<RouteScreenProps> = () => <AboutScreen />;

export default AboutRouteScreen;
