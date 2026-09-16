// natally — U.2 route module for the conversation screen (router.ts contract:
// screens register themselves from their own modules; I.1 consolidates the
// import list). Path "/" — the conversation is home (DESIGN.md "Layout").
//
// Default-injected instances (structural seams, ./types.ts). Each is the
// documented default binding until the wiring task rebinds the real one:
//   * bus      — one module-owned C.4 bus (createCompanionBus). I.1 may pass
//                the app-wide instance through the screen's props instead.
//   * gate     — `{ state: "trial-active" }`: the conservative §9.2 posture.
//                It fabricates no `remaining` and never pretends to be
//                licensed; B.1's evaluateGate result rebinds it.
//   * sink     — an empty in-memory transcript view: honest (no persisted
//                turns are claimed); X.1's store rebinds it.
//   * onSend   — records nothing beyond the composer clearing: the inference
//                seam (§7.1) is unbound at this layer; the wiring task binds
//                the pipeline (which then publishes both turn events).
//   * presentPlate / onUnlock / onEnterCode — real hash navigation over the
//                frozen route set (/atlas/:plate, /paywall, /checkout) — the
//                one navigation system.
//   * onDownloadModel / onRetry — no-ops: the mirror (M.1) and engine seams
//                are unbound here; the controls render honestly until wired.

import type { ReactElement } from "react";
import { type CompanionBus, createCompanionBus } from "../../companion/bus";
import { type RouteModule, type RouteScreenProps, registerRoute } from "../../ui/router";
import { ConversationScreen } from "./ConversationScreen";
import type { TranscriptSink, TrialGateResult } from "./types";

/** The documented default C.4 bus for this route (see module header). */
export const defaultBus: CompanionBus = createCompanionBus();

/** The documented default gate: conservative trial-active, no fabricated count. */
export const defaultGate: TrialGateResult = Object.freeze({ state: "trial-active" });

/** The documented default transcript view: empty, honest. */
export const defaultSink: TranscriptSink = { list: () => [] };

function ConversationRoute(_props: RouteScreenProps): ReactElement {
  return (
    <ConversationScreen
      bus={defaultBus}
      gate={defaultGate}
      sink={defaultSink}
      onSend={() => undefined}
      presentPlate={(plateId) => {
        window.location.hash = `/atlas/${encodeURIComponent(plateId)}`;
      }}
      onUnlock={() => {
        window.location.hash = "/paywall";
      }}
      onEnterCode={() => {
        window.location.hash = "/checkout";
      }}
      onDownloadModel={() => undefined}
      onRetry={() => undefined}
    />
  );
}

/** The lazy contract the router holds for "/" (RouteLoader). */
export async function load(): Promise<RouteModule> {
  return { default: ConversationRoute };
}

registerRoute({ path: "/", load });
