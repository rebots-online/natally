// natally — hash-router contract (U.1, ARCHITECTURE.md §3, DESIGN.md "Layout").
// Exactly the eight routes in DESIGN.md; hash-based so Android back works.
// Screens register themselves from their own modules via registerRoute();
// I.1 later consolidates their import list. The registry is module-owned
// state — the single navigation system (no second router, no tabs).

import type { ComponentType } from "react";

/** Props the shell hands a mounted screen. Static routes receive none. */
export type RouteScreenProps = {
  readonly params: Readonly<Record<string, string>>;
};

/** A screen module's lazy contract (what `load` must resolve to). */
export type RouteModule = {
  default: ComponentType<RouteScreenProps>;
};

export type RouteLoader = () => Promise<RouteModule>;

/** The eight path patterns, verbatim from DESIGN.md / ARCHITECTURE.md §3. */
export const ROUTE_PATHS = [
  "/",
  "/atlas/:plate",
  "/people",
  "/people/:id",
  "/settings",
  "/paywall",
  "/checkout",
  "/about",
] as const;

export type RoutePath = (typeof ROUTE_PATHS)[number];

/** A route pattern plus the screen that serves it. */
export type RouteDefinition = {
  readonly path: RoutePath;
  readonly load: RouteLoader;
};

/** A successful match: the pattern and the concrete params. */
export type RouteMatch = {
  readonly path: RoutePath;
  readonly params: Readonly<Record<string, string>>;
};

export type RouteRegistry = ReadonlyMap<RoutePath, RouteDefinition>;

const REGISTRY: Map<RoutePath, RouteDefinition> = new Map();

const PARAM = ":";
const SEGMENTS: ReadonlyMap<RoutePath, readonly string[]> = new Map(
  ROUTE_PATHS.map((path) => [path, path.split("/").filter((s) => s.length > 0)]),
);

function isRoutePath(candidate: string): candidate is RoutePath {
  return (ROUTE_PATHS as readonly string[]).includes(candidate);
}

/** Extract the hash route: strip the leading "#", normalise to "/"-rooted. */
function hashPath(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw.length === 0 || raw === "/") {
    return "/";
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/**
 * Register a screen for one of the eight paths. Throws on an unknown path
 * (the route set is frozen) or on double registration (a screen bug, never a
 * legitimate rebind).
 */
export function registerRoute(route: RouteDefinition): void {
  if (!isRoutePath(route.path)) {
    throw new Error(`registerRoute: unknown path ${route.path}`);
  }
  if (REGISTRY.has(route.path)) {
    throw new Error(`registerRoute: path already registered ${route.path}`);
  }
  REGISTRY.set(route.path, route);
}

/** The module-owned registry (I.1 consolidates imports against this). */
export function routeRegistry(): RouteRegistry {
  return REGISTRY;
}

/** Test-only reset: the registry is module state and must not leak across files. */
export function resetRoutes(): void {
  REGISTRY.clear();
}

/**
 * Match a location hash against the frozen route set. Static segments match
 * exactly; `:param` segments capture one concrete segment. Returns null for
 * everything else (the shell renders honest absence — INC-19).
 */
export function matchRoute(hash: string): RouteMatch | null {
  const parts = hashPath(hash)
    .split("/")
    .filter((s) => s.length > 0);

  for (const path of ROUTE_PATHS) {
    const segments = SEGMENTS.get(path);
    if (segments === undefined || segments.length !== parts.length) {
      continue;
    }
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < segments.length; i += 1) {
      const pattern = segments[i];
      const actual = parts[i];
      if (actual === undefined || pattern === undefined) {
        matched = false;
        break;
      }
      if (pattern.startsWith(PARAM)) {
        params[pattern.slice(PARAM.length)] = decodeURIComponent(actual);
      } else if (pattern !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { path, params };
    }
  }
  return null;
}
