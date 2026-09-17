// @vitest-environment node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleRequest,
  strategyFor,
  strategyMap,
  type WorkerPolicy,
  type WorkerRuntime,
} from "./sw";

let server: Server;
let origin: string;
let policy: WorkerPolicy;
let offline = false;
const hits = new Map<string, number>();
const bodies = new Map<string, string>();
const root = fileURLToPath(new URL("../../../", import.meta.url));

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const key = `${request.method} ${request.url}`;
    hits.set(key, (hits.get(key) ?? 0) + 1);
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    bodies.set(key, body);
    if (request.url?.includes("missing")) response.statusCode = 404;
    if (request.url?.includes("partial")) response.statusCode = 206;
    if (request.url?.includes("private"))
      response.setHeader("Cache-Control", "private, max-age=60");
    if (request.url?.includes("no-store")) response.setHeader("Cache-Control", "no-store");
    if (request.url?.includes("no-cache")) response.setHeader("Cache-Control", "no-cache");
    if (request.url?.includes("vary-all")) response.setHeader("Vary", "*");
    if (request.url?.includes("redirect")) {
      response.statusCode = 302;
      response.setHeader("Location", "/api/private-data");
    }
    response.end(`${key} response ${hits.get(key)} ${body}`);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP test server did not bind");
  origin = `http://127.0.0.1:${address.port}`;
  policy = { scope: `${origin}/`, mirror: `${origin}/mirror`, bridge: `${origin}/bridge` };
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
});

beforeEach(() => {
  hits.clear();
  bodies.clear();
  offline = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Cache API boundary implemented in memory; HTTP, Request, Response and body cloning are real.
function runtime() {
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, response.clone());
    }),
  };
  const open = vi.fn(async () => cache as unknown as Cache);
  const network = vi.fn(async (request: Request) => {
    if (offline) throw new TypeError("Network offline");
    return fetch(request);
  });
  const value: WorkerRuntime = { caches: { open }, fetch: network, cacheName: "r4-observed-cache" };
  return { value, entries, cache, open, network };
}

const request = (path: string, init?: RequestInit) => new Request(`${origin}${path}`, init);

describe("R.4 exact strategy map", () => {
  it("defines only cache-first static content and network-only data", () => {
    expect(strategyMap).toEqual({
      hashedAssets: "cache-first",
      fonts: "cache-first",
      mirror: "network-only",
      bridge: "network-only",
      nonGet: "network-only",
      default: "network-only",
    });
  });

  it.each([
    "/assets/app-B7x_a2Q9.js",
    "/assets/style.012345ab.css",
    "/fonts/inter.woff2",
    "/fonts/local/font.ttf",
  ])("caches %s", (path) => {
    expect(strategyFor(request(path), policy)).toBe("cache-first");
  });

  it.each([
    "/",
    "/index.html",
    "/sw.js",
    "/manifest.webmanifest",
    "/assets/app.js",
    "/fonts/private.json",
    "/assets/app-abcd.js",
    "/assets/app-abcdefgh.js?token=private",
    "/mirror/assets/app-abcdefgh.js",
    "/bridge/fonts/font.woff2",
    "/api/user",
    "/assets/%2fbridge/app-abcdefgh.js",
  ])("never caches %s", (path) => {
    expect(strategyFor(request(path), policy)).toBe("network-only");
  });

  it("prioritizes configured endpoints even when they overlap static paths", () => {
    expect(
      strategyFor(request("/assets/model-abcdefgh.wasm"), { ...policy, mirror: "/assets" }),
    ).toBe("network-only");
    expect(
      strategyFor(request("/fonts/license.woff2"), { ...policy, bridge: "/fonts/license.woff2" }),
    ).toBe("network-only");
    expect(strategyFor(request("/assets/app-abcdefgh.js"), { ...policy, mirror: "http://[" })).toBe(
      "network-only",
    );
  });

  it("limits caches to this origin and deployment scope", () => {
    expect(strategyFor(new Request("https://other.example/fonts/font.woff2"), policy)).toBe(
      "network-only",
    );
    expect(strategyFor(request("/assets/app-abcdefgh.js"), { scope: `${origin}/app/` })).toBe(
      "network-only",
    );
    expect(strategyFor(request("/app/assets/app-abcdefgh.js"), { scope: `${origin}/app/` })).toBe(
      "cache-first",
    );
  });

  it.each(["POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])("never caches %s", (method) => {
    expect(strategyFor(request("/assets/app-abcdefgh.js", { method }), policy)).toBe(
      "network-only",
    );
  });

  it.each<RequestInit>([
    { headers: { Authorization: "Bearer private" } },
    { headers: { Range: "bytes=0-5" } },
    { cache: "no-store" as const },
  ])("bypasses caching for sensitive or partial requests %j", (init) => {
    expect(strategyFor(request("/assets/app-abcdefgh.js", init), policy)).toBe("network-only");
  });
});

describe("R.4 observed fetch behavior", () => {
  it.each(["/assets/app-abcdefgh.js", "/fonts/local.woff2"])(
    "serves %s offline after a single real network fetch",
    async (path) => {
      const r = runtime();
      const first = await handleRequest(request(path), policy, r.value);
      const body = await first.text();
      expect(body).toContain("response 1");
      expect(r.open).toHaveBeenCalledWith("r4-observed-cache");
      offline = true;
      const second = await handleRequest(request(path), policy, r.value);
      expect(await second.text()).toBe(body);
      expect(r.network).toHaveBeenCalledTimes(1);
      expect(hits.get(`GET ${path}`)).toBe(1);
    },
  );

  it.each(["/mirror/model.bin", "/bridge/entitlements", "/api/profile", "/index.html"])(
    "fetches %s each time and has no offline fallback",
    async (path) => {
      const r = runtime();
      await handleRequest(request(path), policy, r.value);
      expect(r.network.mock.calls[0][0].cache).toBe("no-store");
      expect(await (await handleRequest(request(path), policy, r.value)).text()).toContain(
        "response 2",
      );
      offline = true;
      await expect(handleRequest(request(path), policy, r.value)).rejects.toThrow(
        "Network offline",
      );
      expect(r.open).not.toHaveBeenCalled();
    },
  );

  it("forwards repeated POST bodies unchanged without consulting even a populated cache", async () => {
    const r = runtime();
    const path = "/assets/app-abcdefgh.js";
    await handleRequest(request(path), policy, r.value);
    r.open.mockClear();
    for (const body of ["first reading", "second reading"]) {
      expect(
        await (
          await handleRequest(request(path, { method: "POST", body }), policy, r.value)
        ).text(),
      ).toContain(body);
      expect(bodies.get(`POST ${path}`)).toBe(body);
    }
    expect(hits.get(`POST ${path}`)).toBe(2);
    expect(r.open).not.toHaveBeenCalled();
    expect(r.cache.put).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "partial", "private", "no-store", "no-cache", "vary-all", "redirect"])(
    "does not store %s responses",
    async (kind) => {
      const r = runtime();
      const path = `/assets/${kind}-abcdefgh.js`;
      await handleRequest(request(path), policy, r.value);
      await handleRequest(request(path), policy, r.value);
      expect(hits.get(`GET ${path}`)).toBe(2);
      expect(r.cache.put).not.toHaveBeenCalled();
    },
  );

  it("keeps network failures as failures without manufacturing cached content", async () => {
    const r = runtime();
    offline = true;
    await expect(
      handleRequest(request("/assets/app-abcdefgh.js"), policy, r.value),
    ).rejects.toThrow("Network offline");
    expect(r.entries.size).toBe(0);
  });

  it("returns a real successful response when CacheStorage is unavailable", async () => {
    const r = runtime();
    r.open.mockRejectedValue(new Error("CacheStorage unavailable"));
    expect(
      await (await handleRequest(request("/fonts/font.woff2"), policy, r.value)).text(),
    ).toContain("response 1");
  });

  it("returns a readable body after a quota failure", async () => {
    const r = runtime();
    r.cache.put.mockRejectedValue(new Error("QuotaExceededError"));
    expect(
      await (await handleRequest(request("/fonts/font.woff2"), policy, r.value)).text(),
    ).toContain("response 1");
  });

  it("registers a fetch listener that uses the declared runtime strategy", async () => {
    const r = runtime();
    const listener = vi.fn();
    vi.stubGlobal("registration", { scope: `${origin}/` });
    vi.stubGlobal("caches", r.value.caches);
    vi.stubGlobal("addEventListener", listener);
    vi.stubEnv("VITE_MODEL_MIRROR_BASE", `${origin}/mirror`);
    vi.stubEnv("VITE_LICENSE_BRIDGE_URL", `${origin}/bridge`);
    vi.resetModules();
    await import("./sw");
    expect(listener).toHaveBeenCalledWith("fetch", expect.any(Function));
    const respondWith = vi.fn();
    listener.mock.calls[0][1]({ request: request("/bridge/entitlements"), respondWith });
    expect(await (await respondWith.mock.calls[0][0]).text()).toContain(
      "GET /bridge/entitlements response 1",
    );
    expect(r.open).not.toHaveBeenCalled();
  });
});

describe("R.4 web plan and source manifest", () => {
  it("retains the approved source defaults", () => {
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(
        readFileSync(resolve(root, "apps/local/public/manifest.webmanifest"), "utf8"),
      );
    } catch (cause) {
      throw new Error("Invalid source manifest", { cause });
    }
    expect(manifest).toMatchObject({
      name: "natally",
      id: "mba.robin.natally",
      theme_color: "#120C1C",
      display: "standalone",
    });
  });

  it("prints the artifact and staging plan without changing release inputs or outputs", {
    timeout: 30_000,
  }, () => {
    function snapshot() {
      const entries: Record<string, string> = {};
      const visit = (path: string) => {
        if (!existsSync(path)) {
          entries[path] = "absent";
          return;
        }
        const info = lstatSync(path);
        entries[path] = `${info.mode}:${info.size}:${info.mtimeMs}`;
        if (info.isDirectory())
          for (const child of readdirSync(path).sort()) visit(resolve(path, child));
        else if (info.isFile())
          entries[path] += `:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
      };
      for (const path of [
        ".env",
        "release.lock",
        "version.txt",
        "version.json",
        "package.json",
        "pnpm-lock.yaml",
        "apps/local/package.json",
        "apps/local/src-tauri/tauri.conf.json",
        "apps/local/src-tauri/Cargo.toml",
        "apps/local/src-tauri/Cargo.lock",
        "apps/local/public/manifest.webmanifest",
        "apps/local/dist",
        "dist",
      ])
        visit(resolve(root, path));
      return entries;
    }
    const before = snapshot();
    // The dry-run script is deterministic; under full-suite load the child's IPC
    // channel can die from environment pressure (ERR_IPC_CHANNEL_CLOSED), which is
    // not the property under test — one bounded retry covers exactly that failure.
    let output = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        output = execFileSync("bash", [resolve(root, "scripts/build-web.sh"), "--dry-run"], {
          cwd: root,
          encoding: "utf8",
        });
        break;
      } catch (error) {
        if (attempt === 1 || !String(error).includes("ERR_IPC_CHANNEL_CLOSED")) throw error;
      }
    }
    expect(output).toMatch(/web: artifact name [\w.-]+-v\d+\.\d+\.\d+-web-[\w.-]+\.tar\.gz/);
    expect(output).toContain("apps/local/dist (emptyOutDir: false)");
    expect(output).toContain("stage dist/web");
    expect(output).toContain("scripts/update-version.sh");
    expect(output).not.toContain("HF_TOKEN");
    expect(snapshot()).toEqual(before);
  });
});
