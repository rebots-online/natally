"use strict";
(() => {
  // src/sw.ts
  var SW_STRATEGIES = {
    cacheFirst: [
      // vite build output: /assets/<name>-<content-hash>.<ext>
      /\/assets\/[^/?#]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/,
      // explicit ".hashed." naming (task sketch), should a build config use it
      /\/assets\/.+\.hashed\./,
      // self-hosted fonts (public/fonts, versioned per release)
      /\/fonts\//
    ],
    networkOnly: [
      // model mirror lane (ARCHITECTURE.md §13)
      /\/mirror\//,
      // license bridge lane (ARCHITECTURE.md §9.4)
      /\/bridge\//
    ],
    networkOnlyMethods: ["POST"],
    navigationFallback: "/index.html"
  };
  function matchStrategy(url, method, mode = "") {
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
  function routeRequest(url, method, mode = "") {
    const strategy = matchStrategy(url, method, mode);
    return {
      strategy,
      navigationFallback: strategy === "networkFirst-nav" ? SW_STRATEGIES.navigationFallback : null
    };
  }
  var SW_CACHE_NAME = "natally-web-v1";
  async function cacheFirstResponse(request) {
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
  async function navigationFirstResponse(request) {
    const cache = await caches.open(SW_CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(SW_STRATEGIES.navigationFallback, response.clone());
      }
      return response;
    } catch (error) {
      const shell = await cache.match(SW_STRATEGIES.navigationFallback);
      if (shell) {
        return shell;
      }
      throw error;
    }
  }
  function isServiceWorkerRuntime() {
    return typeof self !== "undefined" && typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope;
  }
  if (isServiceWorkerRuntime()) {
    const swSelf = self;
    swSelf.addEventListener("install", () => {
      void swSelf.skipWaiting();
    });
    swSelf.addEventListener("activate", (event) => {
      event.waitUntil(
        (async () => {
          const names = await caches.keys();
          await Promise.all(
            names.filter((name) => name !== SW_CACHE_NAME).map((name) => caches.delete(name))
          );
          await swSelf.clients.claim();
        })()
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
          return;
      }
    });
  }
  function registerNatallyServiceWorker(scriptUrl) {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    void navigator.serviceWorker.register(scriptUrl).catch(() => {
    });
  }
})();
