// natally — R.4 verify, vitest half. Pins the SW strategy map as EXACT and the
// fetch-handler routing decisions derived from it. Runs under the node
// environment: importing sw.ts here proves it is import-safe outside a service
// worker (its guarded `if` must not fire). The other accept half — the printed
// artifact name — is proven by `bash scripts/build-web.sh --dry-run` in the
// same Verify command.
import { describe, expect, it } from "vitest";

import {
  matchStrategy,
  routeRequest,
  SW_STRATEGIES,
  type SwStrategyMap,
} from "./sw";

const ORIGIN = "https://natally.robin.mba";

function url(pathname: string): URL {
  return new URL(pathname, ORIGIN);
}

describe("web: artifact name printed; SW strategy map exact", () => {
  it("declares the exact strategy map", () => {
    expect(SW_STRATEGIES).toEqual<SwStrategyMap>({
      cacheFirst: [
        // vite build output: /assets/<name>-<content-hash>.<ext>
        /\/assets\/[^/?#]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/,
        // explicit ".hashed." naming (task sketch)
        /\/assets\/.+\.hashed\./,
        // self-hosted fonts
        /\/fonts\//,
      ],
      networkOnly: [/\/mirror\//, /\/bridge\//],
      networkOnlyMethods: ["POST"],
      navigationFallback: "/index.html",
    });
  });

  it("routes hashed build assets and self-hosted fonts cache-first", () => {
    expect(matchStrategy(url("/assets/index-Bo1LQ0X9.js"), "GET")).toBe(
      "cacheFirst",
    );
    expect(
      matchStrategy(url("/assets/natally-icon-1024-rgba-DoFq1ZHa.png"), "GET"),
    ).toBe("cacheFirst");
    // vite output with a query string: the strategy is pathname-only.
    expect(
      matchStrategy(url("/assets/index-Bo1LQ0X9.js?v=1"), "GET"),
    ).toBe("cacheFirst");
    expect(matchStrategy(url("/fonts/fraunces-semibold-latin.woff2"), "GET")).toBe(
      "cacheFirst",
    );
    expect(
      matchStrategy(url("/fonts/nunito/nunitosans-bold.woff2"), "GET"),
    ).toBe("cacheFirst");
  });

  it("accepts the sketch's explicit .hashed. naming as cache-first", () => {
    expect(matchStrategy(url("/assets/main.hashed.a1b2c3d4.css"), "GET")).toBe(
      "cacheFirst",
    );
  });

  it("routes the mirror and bridge lanes network-only", () => {
    expect(matchStrategy(url("/mirror/v1/models"), "GET")).toBe("networkOnly");
    expect(matchStrategy(url("/bridge/license/consume"), "GET")).toBe(
      "networkOnly",
    );
    expect(matchStrategy(url("/mirror/v1/models/echo-small"), "GET")).toBe(
      "networkOnly",
    );
  });

  it("routes any POST network-only regardless of URL", () => {
    expect(matchStrategy(url("/bridge/license/consume"), "POST")).toBe(
      "networkOnly",
    );
    expect(matchStrategy(url("/mirror/v1/chat"), "POST")).toBe("networkOnly");
    // POST beats a cacheFirst URL: the method check runs first.
    expect(matchStrategy(url("/assets/index-Bo1LQ0X9.js"), "POST")).toBe(
      "networkOnly",
    );
    expect(matchStrategy(url("/fonts/fraunces-regular.woff2"), "POST")).toBe(
      "networkOnly",
    );
    expect(matchStrategy(url("/"), "POST", "navigate")).toBe("networkOnly");
  });

  it("routes navigations network-first with the /index.html fallback", () => {
    const root = routeRequest(url("/"), "GET", "navigate");
    expect(root.strategy).toBe("networkFirst-nav");
    expect(root.navigationFallback).toBe("/index.html");

    const deep = routeRequest(url("/atlas/plate-12"), "GET", "navigate");
    expect(deep.strategy).toBe("networkFirst-nav");
    expect(deep.navigationFallback).toBe("/index.html");

    const people = routeRequest(url("/people/42"), "GET", "navigate");
    expect(people.strategy).toBe("networkFirst-nav");
    expect(people.navigationFallback).toBe("/index.html");
  });

  it("keeps undeclared traffic off the cache path (network-only default)", () => {
    expect(matchStrategy(url("/manifest.webmanifest"), "GET")).toBe(
      "networkOnly",
    );
    // A /assets/ path without a content-hash segment is not declared
    // immutable: only what the map declares cacheable touches the cache.
    expect(matchStrategy(url("/assets/logo.png"), "GET")).toBe("networkOnly");
    // The same document request without navigate mode is not a navigation.
    expect(routeRequest(url("/"), "GET").strategy).toBe("networkOnly");
    expect(routeRequest(url("/"), "GET").navigationFallback).toBeNull();
  });

  it("gives the fetch handler a complete plan per strategy", () => {
    expect(
      routeRequest(url("/assets/index-Bo1LQ0X9.js"), "GET", "same-origin"),
    ).toEqual({
      strategy: "cacheFirst",
      navigationFallback: null,
    });
    expect(
      routeRequest(url("/bridge/license/consume"), "POST", "same-origin"),
    ).toEqual({
      strategy: "networkOnly",
      navigationFallback: null,
    });
    expect(routeRequest(url("/"), "GET", "navigate")).toEqual({
      strategy: "networkFirst-nav",
      navigationFallback: "/index.html",
    });
  });
});
