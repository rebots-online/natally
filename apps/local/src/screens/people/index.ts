// natally — people module (U.4). Registers the two frozen routes this screen
// serves (U.1 router; I.1 consolidates the app's import list against this
// module). Importing this module is what registers the routes:
//
//   /people      — the library (PeopleRoute; wiring mounts PeopleScreen with
//                  the real X.1 repo, chart-fact resolver and J8 export seam)
//   /people/:id  — the prefilled first-light intake (PersonEditRoute; J3 edit)

import { registerRoute } from "../../ui/router";

export { PeopleScreen, type PeopleScreenProps } from "./people-screen";

registerRoute({
  path: "/people",
  load: () => import("./people-route"),
});

registerRoute({
  path: "/people/:id",
  load: () => import("./person-edit-route"),
});
