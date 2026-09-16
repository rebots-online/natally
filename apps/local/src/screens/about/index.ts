// natally — About screen module (U.7). Registers the /about route (frozen
// route set, U.1 router); I.1 consolidates the app's import list against
// this module. Importing this module is what registers the route.

import { registerRoute } from "../../ui/router";

export { AboutScreen, type AboutScreenProps } from "./AboutScreen";

registerRoute({
  path: "/about",
  load: () => import("./about-route"),
});
