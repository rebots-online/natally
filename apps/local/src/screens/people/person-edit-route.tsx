// natally — the /people/:id route adapter (U.4): the prefilled intake.
//
// `:id` names an existing person; the surface is the SAME four-question
// first-light intake, prefilled (J3's edit branch — SCREEN.md screen-people:
// "add a person (same intake as first light), edit"). The wiring layer (I.1)
// resolves the id through the X.1 PeopleRepo and mounts `FirstLightScreen`
// with `initial`; until then the honest render is the labelled absence — the
// route never invents a person to prefill (INC-19).

import type { ReactElement } from "react";
import type { RouteScreenProps } from "../../ui/router";

export default function PersonEditRoute({ params }: RouteScreenProps): ReactElement {
  return (
    <div
      className="natally-absence"
      data-absence="data-layer-unbound"
      data-person-id={params.id ?? ""}
    >
      <p className="m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[14px] leading-[20px] text-[var(--color-vellum-muted)]">
        This person&apos;s intake opens once the local data layer is bound.
      </p>
    </div>
  );
}
