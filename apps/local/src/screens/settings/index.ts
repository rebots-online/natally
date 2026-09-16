// natally — U.5 route module for the settings screen (router.ts contract:
// screens register themselves from their own modules; I.1 consolidates the
// import list). Path "/settings" (DESIGN.md "Layout").
//
// Default-injected instances (structural seams, ./types.ts). Each is the
// documented default binding until the wiring task rebinds the real one:
//   * catalogue  — a real M.1 Catalogue over a module-owned in-memory KV:
//                  honest (no rows are claimed); I.3/I.1 rebind the
//                  SQLite/IndexedDB-backed KV.
//   * license    — `isLicensed: false`, no payload: the conservative §9.3
//                  posture. It never pretends to be licensed; B.3's offline
//                  verify result (keychain / storage-web + verify-web) rebinds it.
//   * gate       — `{ state: "trial-active" }`: the conservative §9.2 posture
//                  (same default the conversation screen carries); B.1's
//                  evaluateGate result rebinds it.
//   * restore    — resolves `absent` (no restore source bound): the honest
//                  "no purchases found on this device" line; B.5c rebinds.
//   * voice      — no voices claimed, no selection, unmuted; V-phase wiring
//                  rebinds the Kokoro mirror's voice list and controls.
//   * exportAll / importDocument — reject with an unbound-seam error the
//                  screen renders as an honest failure line; X.1 rebinds.
//   * destroyEverything — resolves the plate, then reports the honest zero
//                  deletions of an unbound seam (nothing was deleted); X.2
//                  rebinds the real store/file/keychain destroyer.
//   * loreStats  — zeros under the honest `unbound` runtime label; L.5's
//                  store rebinds it.
//   * onHouseSystemChange / onVoiceSelect / onPreview / onMuteToggle — no-ops:
//                  the persistence and audio seams are unbound at this layer.
//   * onUnlock / onEnterCode / onAbout — real hash navigation over the frozen
//                  route set (/paywall, /about) — the one navigation system.
//                  `/paywall` is the unlock route (J6 amended); its enter-code
//                  state is the paywall screen's concern — the frozen router
//                  pattern carries no query params, so the wiring rebinds
//                  `onEnterCode` if the paywall contract needs an explicit
//                  state marker.

import { createElement, type ReactElement } from "react";
import { Catalogue, type KvStore } from "../../mirror/catalogue";
import { type RouteModule, type RouteScreenProps, registerRoute } from "../../ui/router";
import { SettingsScreen } from "./SettingsScreen";
import type {
  CatalogueView,
  DestroyReportView,
  GateView,
  LoreStatsView,
  SettingsScreenProps,
} from "./types";

/** The documented default catalogue KV: an honest empty in-memory store. */
export const defaultCatalogueKv: KvStore = {
  async get(): Promise<string | null> {
    return null;
  },
  async set(): Promise<void> {
    // Unbound wiring: rows land only once the real KV is injected (I.3).
  },
  async delete(): Promise<void> {
    // Unbound wiring: nothing to delete in an empty store.
  },
  async keys(): Promise<readonly string[]> {
    return [];
  },
};

/** The documented default catalogue for this route (see module header). */
export const defaultCatalogue: CatalogueView = new Catalogue(defaultCatalogueKv);

/** The documented default gate: conservative trial-active, no fabricated count. */
export const defaultGate: GateView = Object.freeze({ state: "trial-active" });

function defaultProps(): SettingsScreenProps {
  return {
    catalogue: defaultCatalogue,
    isLicensed: false,
    gate: defaultGate,
    restoreLicense: () => Promise.resolve({ status: "absent" }),
    onEnterCode: () => {
      window.location.hash = "/paywall";
    },
    onUnlock: () => {
      window.location.hash = "/paywall";
    },
    voices: [],
    onVoiceSelect: () => undefined,
    onPreview: () => undefined,
    muted: false,
    onMuteToggle: () => undefined,
    exportAll: () =>
      Promise.reject(new Error("natally: export seam unbound (the wiring layer rebinds X.1)")),
    importDocument: () =>
      Promise.reject(new Error("natally: import seam unbound (the wiring layer rebinds X.1)")),
    destroyEverything: (confirm: () => Promise<boolean>) =>
      // Unbound seam: the plate still rules — a declined confirm aborts with
      // nothing touched; an accepted one yields the honest zero deletions.
      Promise.resolve(confirm()).then(
        (accepted): DestroyReportView =>
          accepted
            ? { aborted: false, tablesCleared: [], filesDeleted: [], tokenCleared: false }
            : { aborted: true },
      ),
    loreStats: (): Promise<LoreStatsView> =>
      Promise.resolve({ turns: 0, nodes: 0, edges: 0, runtime: "unbound" }),
    onHouseSystemChange: () => undefined,
    onAbout: () => {
      window.location.hash = "/about";
    },
  };
}

function SettingsRoute(_props: RouteScreenProps): ReactElement {
  // createElement, not JSX: the default props are built in one call and the
  // .ts route module stays a plain module (the screen carries the markup).
  return createElement(SettingsScreen, defaultProps());
}

/** The lazy contract the router holds for "/settings" (RouteLoader). */
export async function load(): Promise<RouteModule> {
  return { default: SettingsRoute };
}

registerRoute({ path: "/settings", load });
