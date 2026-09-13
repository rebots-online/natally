// R.4: application data, mirror traffic and bridge traffic never enter this cache.
declare const __NATALLY_SW_CACHE__: string;

export const strategyMap = Object.freeze({
  hashedAssets: "cache-first",
  fonts: "cache-first",
  mirror: "network-only",
  bridge: "network-only",
  nonGet: "network-only",
  default: "network-only",
} as const);

export interface WorkerPolicy {
  scope: string;
  mirror?: string;
  bridge?: string;
}

function isEndpoint(url: URL, endpoint: string | undefined, base: URL): boolean {
  if (!endpoint) return false;
  try {
    const target = new URL(endpoint, base);
    const prefix = target.pathname.replace(/\/+$/, "");
    return (
      url.origin === target.origin &&
      (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))
    );
  } catch {
    // Invalid endpoint configuration never expands the static cache allowlist.
    return true;
  }
}

export function strategyFor(
  request: Request,
  policy: WorkerPolicy,
): "cache-first" | "network-only" {
  if (request.method !== "GET") return strategyMap.nonGet;
  const url = new URL(request.url);
  const scope = new URL(policy.scope);
  if (isEndpoint(url, policy.mirror, scope)) return strategyMap.mirror;
  if (isEndpoint(url, policy.bridge, scope)) return strategyMap.bridge;
  if (
    url.origin !== scope.origin ||
    !/^https?:$/.test(url.protocol) ||
    url.search ||
    request.headers.has("authorization") ||
    request.headers.has("range") ||
    request.cache === "no-store" ||
    request.mode === "navigate"
  )
    return strategyMap.default;
  const prefix = scope.pathname.replace(/\/?$/, "/");
  if (!url.pathname.startsWith(prefix)) return strategyMap.default;
  const path = url.pathname.slice(prefix.length);
  // Encoded separators/dot segments must not disguise an API path as static content.
  if (path.includes("%")) return strategyMap.default;
  if (/^assets\/(?:[^/]+\/)*[^/]+[-.][A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$/.test(path)) {
    return strategyMap.hashedAssets;
  }
  if (/^fonts\/(?:[^/]+\/)*[^/]+\.(?:woff2?|ttf|otf)$/i.test(path)) return strategyMap.fonts;
  return strategyMap.default;
}

export interface WorkerRuntime {
  caches: Pick<CacheStorage, "open">;
  fetch: (request: Request) => Promise<Response>;
  cacheName: string;
}

export async function handleRequest(
  request: Request,
  policy: WorkerPolicy,
  runtime: WorkerRuntime,
): Promise<Response> {
  if (strategyFor(request, policy) === "network-only") {
    // Bypass the browser HTTP cache as well as CacheStorage for mirror/bridge/data.
    return runtime.fetch(new Request(request, { cache: "no-store" }));
  }
  let cache: Cache;
  try {
    cache = await runtime.caches.open(runtime.cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    return runtime.fetch(request);
  }
  const response = await runtime.fetch(request);
  const directives = response.headers.get("cache-control") ?? "";
  if (
    response.ok &&
    response.status === 200 &&
    !response.redirected &&
    response.type !== "opaque" &&
    !/(?:^|,)\s*(?:no-store|private|no-cache)\b/i.test(directives) &&
    response.headers.get("vary") !== "*"
  ) {
    try {
      await cache.put(request, response.clone());
    } catch {
      /* Storage pressure must not turn a successful fetch into an app failure. */
    }
  }
  return response;
}

// Structural worker types keep the shared DOM TypeScript project free of lib conflicts.
interface WorkerScope {
  registration: { scope: string };
  caches: CacheStorage;
  fetch(request: Request): Promise<Response>;
  addEventListener(
    type: "fetch",
    listener: (event: { request: Request; respondWith(response: Promise<Response>): void }) => void,
  ): void;
}

const worker = globalThis as unknown as Partial<WorkerScope>;
if (worker.registration && worker.caches && worker.fetch && worker.addEventListener) {
  const scope = worker as WorkerScope;
  const policy: WorkerPolicy = {
    scope: scope.registration.scope,
    mirror: import.meta.env?.VITE_MODEL_MIRROR_BASE,
    bridge: import.meta.env?.VITE_LICENSE_BRIDGE_URL,
  };
  const runtime: WorkerRuntime = {
    caches: scope.caches,
    fetch: scope.fetch.bind(scope),
    cacheName:
      typeof __NATALLY_SW_CACHE__ === "string" ? __NATALLY_SW_CACHE__ : "natally-static-v1",
  };
  scope.addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event.request, policy, runtime));
  });
}
