// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRouteRegistry,
  matchRoute,
  ROUTE_PATHS,
  type RoutePath,
  type RouteRegistration,
  registerRoute,
} from "../router";

const unregister: Array<() => void> = [];
function register(route: RouteRegistration) {
  unregister.push(registerRoute(route));
}
afterEach(() => {
  unregister.splice(0).forEach((dispose) => {
    dispose();
  });
});

describe("closed hash router contract", () => {
  it("accepts exactly the eight patterns, decodes dynamic IDs and rejects extra path segments", () => {
    expect(ROUTE_PATHS).toEqual([
      "/",
      "/atlas/:plate",
      "/people",
      "/people/:id",
      "/settings",
      "/paywall",
      "/checkout",
      "/about",
    ]);
    for (const path of ["/", "/people", "/settings", "/paywall", "/checkout", "/about"]) {
      expect(matchRoute(`#${path}`)).toMatchObject({ path, pathname: path, params: {} });
    }
    expect(matchRoute("#")).toMatchObject({ path: "/" });
    expect(matchRoute("#/atlas/a%2Fb")).toMatchObject({
      path: "/atlas/:plate",
      params: { plate: "a/b" },
    });
    expect(matchRoute("#/people/Jos%C3%A9")).toMatchObject({
      path: "/people/:id",
      params: { id: "José" },
    });
    expect(matchRoute("#/checkout?reference=123")).toMatchObject({ path: "/checkout" });
    for (const invalid of [
      "/atlas",
      "/atlas/",
      "/people/",
      "/people/a/b",
      "/settings/more",
      "/unknown",
      "/people/%E0%A4%A",
      "people",
    ]) {
      expect(matchRoute(invalid), invalid).toBeNull();
    }
    // This expectation is also checked by the U.1 TypeScript validation command.
    // @ts-expect-error RoutePath is a closed union; /atlas is not a registered pattern.
    const disallowed: RoutePath = "/atlas";
    expect(ROUTE_PATHS).not.toContain(disallowed);
  });

  it("keeps ownership private, prevents ambiguous duplicate registration and supports cleanup", () => {
    const load = vi.fn(async () => ({ default: () => null }));
    register({ path: "/", load });
    expect(load).not.toHaveBeenCalled();
    expect(() => registerRoute({ path: "/", load })).toThrow("Route already registered: /");
    const snapshot = getRouteRegistry() as Map<RoutePath, RouteRegistration>;
    snapshot.clear();
    expect(getRouteRegistry().has("/")).toBe(true);
    unregister.pop()?.();
    expect(getRouteRegistry().has("/")).toBe(false);
  });
});
