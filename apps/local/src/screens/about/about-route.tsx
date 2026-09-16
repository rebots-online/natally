// natally — the /about route adapter (U.7). Static route (frozen route set,
// U.1 router): the shell hands route params only; none are read.

import type { ReactElement } from "react";
import type { RouteScreenProps } from "../../ui/router";
import { AboutScreen } from "./AboutScreen";

export default function AboutRoute({ params }: RouteScreenProps): ReactElement {
  return <AboutScreen params={params} />;
}
