// natally — the /atlas/:plate route adapter (U.3, J9 deep links).
//
// Deep-linked plates resolve through the app data provider: the shell mounts
// this screen with route params only, and the plate id (`:plate`) is a
// content-addressed chart id (§5) that only the wiring layer can look up.
// Until that provider hands this module its records, the honest render is the
// labelled absence — no fabricated chart, ever (INC-19). The conversation
// mounts `AtlasScreen` directly with computed props when a plate is laid.

import type { ReactElement } from "react";
import type { RouteScreenProps } from "../../ui/router";
import { AtlasScreen } from "./atlas-screen";

export default function AtlasRoute({ params }: RouteScreenProps): ReactElement {
  return <AtlasScreen params={params} view="natal" />;
}
