import { type ComponentType, useSyncExternalStore } from "react";

/** U.1 / DESIGN.md: this is the complete hash-route vocabulary. */
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
export interface RouteMatch {
  readonly path: RoutePath;
  readonly pathname: string;
  readonly params: Readonly<Record<string, string>>;
}
export type RouteScreenProps = RouteMatch;
export type RouteLoad = () => Promise<{ default: ComponentType<RouteScreenProps> }>;
export interface RouteRegistration {
  readonly path: RoutePath;
  readonly load: RouteLoad;
}
export type RouteRegistry = ReadonlyMap<RoutePath, RouteRegistration>;

const registry = new Map<RoutePath, RouteRegistration>();
const listeners = new Set<() => void>();
let revision = 0;

function notifyRegistry() {
  revision += 1;
  for (const listener of listeners) listener();
}

/** Screens register at module evaluation; I.1 owns importing those modules. */
export function registerRoute(route: RouteRegistration): () => void {
  if (!ROUTE_PATHS.includes(route.path) || typeof route.load !== "function") {
    throw new Error("Invalid route registration.");
  }
  if (registry.has(route.path)) throw new Error(`Route already registered: ${route.path}`);
  const entry = Object.freeze({ ...route });
  registry.set(entry.path, entry);
  notifyRegistry();
  return () => {
    if (registry.get(entry.path) === entry) {
      registry.delete(entry.path);
      notifyRegistry();
    }
  };
}

/** A snapshot prevents consumers from mutating the module-owned registry. */
export function getRouteRegistry(): RouteRegistry {
  return new Map(registry);
}

export function getRegisteredRoute(path: RoutePath): RouteRegistration | undefined {
  return registry.get(path);
}

export function subscribeRoutes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRegistryRevision(): number {
  return revision;
}

/** Match segments before decoding parameters, preserving encoded IDs as one segment. */
export function matchRoute(hashOrPath: string): RouteMatch | null {
  const path = hashOrPath.startsWith("#") ? hashOrPath.slice(1) : hashOrPath;
  const pathname = path.split("?")[0] || "/";
  const segments = pathname.split("/");
  for (const candidate of ROUTE_PATHS) {
    const pattern = candidate.split("/");
    if (segments.length !== pattern.length) continue;
    const params: Record<string, string> = {};
    const matches = pattern.every((part, index) => {
      const segment = segments[index];
      if (!part.startsWith(":")) return part === segment;
      if (!segment) return false;
      try {
        params[part.slice(1)] = decodeURIComponent(segment);
        return true;
      } catch {
        return false;
      }
    });
    if (matches) return { path: candidate, pathname, params: Object.freeze(params) };
  }
  return null;
}

function subscribeHash(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}

export function useHashPath(): string {
  return useSyncExternalStore(
    subscribeHash,
    () => window.location.hash || "#/",
    () => "#/",
  );
}

export function useRoute(): RouteMatch | null {
  return matchRoute(useHashPath());
}
