// natally web PWA service worker (task R.4). Hand-rolled TypeScript compiled
// by vite — no workbox, no new dependencies (task law).
//
// The exact strategy map (SW_STRATEGIES) and the pure routing decision
// (matchStrategy / routeRequest) live here so sw.test.ts can pin them; the
// imperative fetch handler is a thin dispatch over routeRequest.
//
// Strategy map shape — the task sketch
// `{cacheFirst: [...], networkOnly: [..., method POST]}` realized exactly:
//
//   cacheFirst         URL pathname patterns for immutable responses:
//                      vite's content-hashed build output under /assets/
//                      (convention: everything vite emits under assetsDir is
//                      <name>-<content-hash>.<ext>, and public/ files — icons,
//                      manifest — never land there), the sketch's explicit
//                      `.hashed.` naming if a build config ever adopts it, and
//                      the self-hosted fonts under /fonts/ (public/fonts,
//                      re-versioned per release). A match reads the cache; on
//                      a miss the network response is fetched and put into the
//                      cache (network-put).
//   networkOnly        URL pathname patterns that are never served from
//                      cache: the /mirror/ lane (ARCHITECTURE.md §13 model
//                      mirror) and the /bridge/ lane (§9.4 license bridge).
//                      The fetch handler does not even respondWith for these —
//                      the browser's own network fetch proceeds untouched and
//                      the SW never sees or stores the response.
//   networkOnlyMethods HTTP methods that bypass the cache regardless of URL.
//                      POST is absolute: the task law "never caches POSTs"
//                      wins over every URL pattern (checked first).
//   navigationFallback "/index.html": navigations (request.mode "navigate")
//                      are network-first; a successful navigation response is
//                      kept under this cache key, and when the network fails
//                      the last good shell is served from it.
//
// Honest naming note: vite never emits a literal ".hashed." pathname segment —
// its default output is "<name>-<hash>.<ext>". The sketch's literal
// `/\/assets\/.+\.hashed\./` would match nothing in a real build, so the map
// realizes it alongside the vite shape instead of shipping a dead pattern as
// the only asset rule.
//
// Matching order (exact, asserted by sw.test.ts):
//   1. method in networkOnlyMethods      -> networkOnly
//   2. pathname matches networkOnly      -> networkOnly
//   3. mode is "navigate"                -> networkFirst-nav
//   4. pathname matches cacheFirst       -> cacheFirst
//   5. anything undeclared               -> networkOnly (only what the map
//      declares cacheable ever touches the cache; the cache cannot silently
//      grow around the documented surface)
//
// Wiring boundary: registration is I.1/I.3's. This module exports
// registerNatallyServiceWorker() for the entry to call with the compiled
// script URL, and attaches its own install/activate/fetch listeners under a
// guarded `if` that is true only when the compiled file actually runs as a
// service worker — false in the window, false under node/vitest, which is what
// makes this module import-safe for the test suite. main.tsx is intentionally
// NOT modified here.

/** The three routing outcomes the fetch handler can act on. */
export type SwStrategy = "cacheFirst" | "networkOnly" | "networkFirst-nav";

export interface SwStrategyMap {
  /** Pathname patterns served cache-first (immutable, fingerprinted). */
  readonly cacheFirst: readonly RegExp[];
  /** Pathname patterns never served from cache (live backend lanes). */
  readonly networkOnly: readonly RegExp[];
  /** Methods that bypass the cache regardless of URL (POST is absolute). */
  readonly networkOnlyMethods: readonly string[];
  /** Navigation fallback document, fetched network-first and kept cached. */
  readonly navigationFallback: string;
}

export const SW_STRATEGIES: SwStrategyMap = {
  cacheFirst: [
    // vite build output: /assets/<name>-<content-hash>.<ext>
    /\/assets\/[^/?#]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/,
    // explicit ".hashed." naming (task sketch), should a build config use it
    /\/assets\/.+\.hashed\./,
    // self-hosted fonts (public/fonts, versioned per release)
    /\/fonts\//,
  ],
  networkOnly: [
    // model mirror lane (ARCHITECTURE.md §13)
    /\/mirror\//,
    // license bridge lane (ARCHITECTURE.md §9.4)
    /\/bridge\//,
  ],
  networkOnlyMethods: ["POST"],
  navigationFallback: "/index.html",
};

/**
 * Pure routing decision. Patterns run against the URL pathname only (query
 * strings never change a strategy). `mode` mirrors `request.mode`; pass
 * "navigate" for navigation requests — it is not derivable from URL+method.
 */
export function matchStrategy(url: URL, method: string, mode = ""): SwStrategy {
  if (SW_STRATEGIES.networkOnlyMethods.includes(method.toUpperCase())) {
    return "networkOnly";
  }
  if (SW_STRATEGIES.networkOnly.some((pattern) => pattern.test(url.pathname))) {
    return "networkOnly";
  }
  if (mode === "navigate") {
    return "networkFirst-nav";
  }
  if (SW_STRATEGIES.cacheFirst.some((pattern) => pattern.test(url.pathname))) {
    return "cacheFirst";
  }
  return "networkOnly";
}

export interface FetchRoute {
  readonly strategy: SwStrategy;
  /** Set only for networkFirst-nav: the document to fall back to. */
  readonly navigationFallback: string | null;
}

/** The fetch handler's full plan for a request, as one pure value. */
export function routeRequest(url: URL, method: string, mode = ""): FetchRoute {
  const strategy = matchStrategy(url, method, mode);
  return {
    strategy,
    navigationFallback: strategy === "networkFirst-nav" ? SW_STRATEGIES.navigationFallback : null,
  };
}

/** Versioned runtime cache; cleaned of predecessors on activate. */
const SW_CACHE_NAME = "natally-web-v1";

async function cacheFirstResponse(request: Request): Promise<Response> {
  const cache = await caches.open(SW_CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) {
    return hit;
  }
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function navigationFirstResponse(request: Request): Promise<Response> {
  const cache = await caches.open(SW_CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Keep the last good shell under the fallback key for offline use.
      await cache.put(SW_STRATEGIES.navigationFallback, response.clone());
    }
    return response;
  } catch (error) {
    const shell = await cache.match(SW_STRATEGIES.navigationFallback);
    if (shell) {
      return shell;
    }
    // No shell cached yet and no network: the absence is real — propagate the
    // failure (the browser renders its own offline state). No invented page.
    throw error;
  }
}

// Minimal structural typings for the service-worker global scope. TypeScript's
// DOM lib does not ship ServiceWorkerGlobalScope/FetchEvent/ExtendableEvent
// (they live in lib.webworker, which the app's DOM-lib tsconfig does not
// include), so the worker-side handlers below type against these local shapes.
// The `declare const` is module-scoped — it shadows no global; at runtime the
// instanceof guard resolves to the real constructor, and its typeof check
// makes the whole worker branch inert under node/vitest and in the window.
interface NatallyExtendableEvent {
  waitUntil(promise: Promise<void>): void;
}

interface NatallyFetchEvent {
  readonly request: Request;
  respondWith(response: Promise<Response> | Response): void;
}

interface NatallyServiceWorkerScope {
  addEventListener(
    type: "install" | "activate",
    listener: (event: NatallyExtendableEvent) => void,
  ): void;
  addEventListener(type: "fetch", listener: (event: NatallyFetchEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
}

declare const ServiceWorkerGlobalScope: new () => unknown;

function isServiceWorkerRuntime(): boolean {
  return (
    typeof self !== "undefined" &&
    typeof ServiceWorkerGlobalScope !== "undefined" &&
    self instanceof ServiceWorkerGlobalScope
  );
}

if (isServiceWorkerRuntime()) {
  const swSelf = self as unknown as NatallyServiceWorkerScope;

  swSelf.addEventListener("install", () => {
    // No precache: build assets are runtime-cached cache-first on first use;
    // the shell cache entry appears on the first successful navigation.
    void swSelf.skipWaiting();
  });

  swSelf.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(
          names.filter((name) => name !== SW_CACHE_NAME).map((name) => caches.delete(name)),
        );
        await swSelf.clients.claim();
      })(),
    );
  });

  swSelf.addEventListener("fetch", (event) => {
    const request = event.request;
    const route = routeRequest(new URL(request.url), request.method, request.mode);
    switch (route.strategy) {
      case "cacheFirst":
        event.respondWith(cacheFirstResponse(request));
        return;
      case "networkFirst-nav":
        event.respondWith(navigationFirstResponse(request));
        return;
      case "networkOnly":
        // No respondWith: the browser's own network fetch runs untouched and
        // nothing is ever stored — POSTs included, regardless of URL.
        return;
    }
  });
}

/**
 * Entry-side registration hook (called by I.1/I.3, NOT here). `scriptUrl` is
 * the compiled service worker URL as served by the web leg. Best-effort and
 * honest: if registration fails, the app continues network-only on the next
 * load — no retry UI, no invented state.
 */
export function registerNatallyServiceWorker(scriptUrl: string): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  void navigator.serviceWorker.register(scriptUrl).catch(() => {
    // Registration failure is honest absence: the app simply keeps working
    // network-only (no offline shell). House law: no console in src. (sw)
  });
}
