// natally — Atlas screen module (U.3). Registers the /atlas/:plate route
// (frozen route set, U.1 router); I.1 consolidates the app's import list
// against this module. Importing this module is what registers the route.

import { registerRoute } from "../../ui/router";

export { AtlasScreen, type AtlasScreenProps, type AtlasView } from "./atlas-screen";
export {
  chartMomentIso,
  degreeInSign,
  formatDegree,
  formatPlace,
  formatSpeed,
  houseOf,
  isRetrograde,
  signOf,
} from "./chart-math";

registerRoute({
  path: "/atlas/:plate",
  load: () => import("./atlas-route"),
});
