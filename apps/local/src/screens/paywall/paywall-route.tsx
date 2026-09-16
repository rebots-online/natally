// natally — the /paywall route adapter (U.6, J9/J10).
//
// The route set is frozen (U.1 router) and this module registers it, but the
// paywall's every dep is an injected seam (./types.ts): gate, registry, bus,
// handoff. Until the wiring layer (I.1) hands this adapter those instances,
// the honest render is the labelled absence — no invented gate, no fake
// registry, no sample offering (INC-19). I.1 replaces this body with the
// wired <PaywallScreen/>.

import type { ReactElement } from "react";
import type { RouteScreenProps } from "../../ui/router";

export default function PaywallRoute(_props: RouteScreenProps): ReactElement {
  return (
    <div className="mx-auto w-full max-w-[430px] px-4 pb-16 pt-4">
      <p
        data-absence="wiring-pending"
        className="m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[14px] leading-[20px] text-[var(--color-vellum-muted)]"
      >
        This page is not wired into this build yet.
      </p>
    </div>
  );
}
