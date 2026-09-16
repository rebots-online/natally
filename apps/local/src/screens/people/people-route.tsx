// natally — the /people route adapter (U.4).
//
// The shell mounts this screen with route params only; the X.1 data handle,
// the chart-fact resolver and the J8 export delivery live behind the wiring
// layer (I.1), which mounts `PeopleScreen` directly with the real bindings.
// Until then the honest render is the labelled absence — no fabricated
// library, ever (INC-19).

import type { ReactElement } from "react";
import type { RouteScreenProps } from "../../ui/router";

export default function PeopleRoute(_props: RouteScreenProps): ReactElement {
  return (
    <div className="natally-absence" data-absence="data-layer-unbound">
      <p className="m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[14px] leading-[20px] text-[var(--color-vellum-muted)]">
        The people library opens once the local data layer is bound.
      </p>
    </div>
  );
}
