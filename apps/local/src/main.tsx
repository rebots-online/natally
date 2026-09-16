// natally local frontend entry. Paints the honest loading absence immediately,
// then lazily mounts the U.1 router shell when its module resolves.
import { type ComponentType, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { NatallyApp } from "./app";
// R.4/I.1: the entry-side service-worker registration hook. Import-safe (its
// install/activate/fetch listeners attach only when the file runs as an
// actual service worker), so this static import is inert in the window.
import { registerNatallyServiceWorker } from "./sw";
import "./styles/global.css";

/** Contract with U.1 (src/ui/router): the module must export `RouterShell`. */
interface RouterModule {
  readonly RouterShell: ComponentType;
}

function exportsRouterShell(module: unknown): module is RouterModule {
  if (typeof module !== "object" || module === null) {
    return false;
  }
  const shell: unknown = (module as Record<string, unknown>).RouterShell;
  return typeof shell === "function";
}

const mountPoint = document.getElementById("root");
if (!(mountPoint instanceof HTMLElement)) {
  throw new Error("natally: #root mount point missing from index.html");
}

const root = createRoot(mountPoint);

// Real loading absence (INC-19): midnight ground + static wordmark, faking no
// progress. It stands in until the router shell takes over — and until the
// U-phase lands, it remains the entire UI.
root.render(
  <StrictMode>
    <NatallyApp />
  </StrictMode>,
);

// Web PWA leg (R.4/I.1): best-effort registration of the compiled worker.
// Guarded by the hook itself — a no-op where serviceWorker is unsupported,
// and on registration failure the app continues network-only on the next
// load. "/sw.js" is the compiled worker URL the web leg serves; its emission
// is the web build's concern (I.3/I.4), not the entry's.
registerNatallyServiceWorker("/sw.js");

void import("./ui/router")
  .then((module: unknown) => {
    if (!exportsRouterShell(module)) {
      throw new Error('natally: "./ui/router" must export component RouterShell');
    }
    const { RouterShell } = module;
    root.render(
      <StrictMode>
        <RouterShell />
      </StrictMode>,
    );
  })
  .catch(() => {
    // The router module failed to resolve or rejected: the honest absence stays
    // on screen. No invented progress, no invented error UI — the absence of
    // the app is the truthful state until it is genuinely fixed.
  });
