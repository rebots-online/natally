// NatallyApp — today the app shell is the loading absence: midnight ground,
// static wordmark, nothing else. It is honest (INC-19: fakes no progress) and
// stands in until U-phase screens mount inside the router shell (U.1).
import type { ReactElement } from "react";

export function NatallyApp(): ReactElement {
  return (
    <div className="natally-absence">
      <p className="natally-wordmark">natally</p>
    </div>
  );
}
