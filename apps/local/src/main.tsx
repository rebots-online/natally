// natally local frontend entry. Paints the honest loading absence immediately,
// then lazily mounts the U.1 router shell when its module resolves.
import { type ComponentType, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { NatallyApp } from "./app";
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
