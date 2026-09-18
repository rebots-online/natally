// @vitest-environment node
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSpaceAdapter } from "../cache.js";
import { StreamingSha256 } from "../download.js";
import {
  fetchManifest,
  type ManifestAsset,
  MirrorNetwork,
  parseManifest,
  requiredSpace,
  validateAsset,
} from "../manifest.js";
import { FixtureBrowser } from "./browser.js";

const fixture = Uint8Array.from({ length: 32_768 }, (_, index) => (index * 71 + 19) % 256);
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const asset: ManifestAsset = {
  id: "trial-model",
  kind: "llm",
  file: "asset.bin",
  bytes: fixture.byteLength,
  sha256: digest(fixture),
  quant: "tiny-fixture",
  trialEligible: true,
};
const manifest = { version: "fixture-1", assets: [asset] };
const requests: Array<{ path: string; range: string | undefined }> = [];
let server: Server;
let vite: ViteDevServer;
let base: string;
let browser: FixtureBrowser;

beforeAll(async () => {
  vite = await createViteServer({
    configFile: false,
    envFile: false,
    // Deterministic repo root regardless of the vitest project's cwd: the browser imports
    // "/apps/local/src/mirror/*.ts", which only resolves when the Vite root IS the repo root.
    root: fileURLToPath(new URL("../../../../../", import.meta.url)),
    cacheDir: join(import.meta.dirname, "STAGING_vite"),
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
  });
  server = createServer((req, res) => {
    const path = new URL(req.url!, "http://fixture").pathname;
    if (path.startsWith("/fixture/")) {
      requests.push({ path, range: req.headers.range });
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (path.endsWith("/manifest.json")) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(manifest));
        return;
      }
      if (path.endsWith("/invalid.json")) {
        res.end("{invalid");
        return;
      }
      if (path.endsWith("/empty.bin")) {
        res.setHeader("Content-Length", "0");
        res.end();
        return;
      }
      if (path.endsWith("/redirect.bin")) {
        res.writeHead(302, { Location: "http://localhost:9/must-not-contact" });
        res.end();
        return;
      }
      if (path.endsWith("/redirect-safe.bin")) {
        res.writeHead(302, { Location: `${base}/fixture/asset.bin` });
        res.end();
        return;
      }
      if (path.endsWith("/missing.bin")) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (path.endsWith(".bin")) {
        const data = fixture.slice();
        if (path.endsWith("/corrupt.bin")) data[0] = data[0]! ^ 0xff;
        const start = path.endsWith("/ignore-range.bin")
          ? 0
          : Number(/^bytes=(\d+)-$/.exec(req.headers.range ?? "")?.[1] ?? 0);
        const ranged = Boolean(req.headers.range) && !path.endsWith("/ignore-range.bin");
        const end = path.endsWith("/bounded-range.bin")
          ? Math.min(start + 4096, data.length)
          : data.length;
        res.statusCode = ranged || end < data.length ? 206 : 200;
        if (res.statusCode === 206) {
          const declaredStart = path.endsWith("/bad-range.bin") ? start + 1 : start;
          res.setHeader("Content-Range", `bytes ${declaredStart}-${end - 1}/${data.length}`);
        }
        if (!path.endsWith("/overflow.bin")) res.setHeader("Content-Length", String(end - start));
        let offset = start;
        const timer = setInterval(() => {
          const next = Math.min(offset + 4096, end);
          res.write(data.subarray(offset, next));
          offset = next;
          if (path.endsWith("/short.bin") || offset === end) {
            if (path.endsWith("/overflow.bin")) res.write(new Uint8Array([1]));
            clearInterval(timer);
            res.end();
          }
        }, 8);
        res.on("close", () => clearInterval(timer));
        return;
      }
    }
    if (path === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>M.1 fixture</title>");
      return;
    }
    vite.middlewares(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = new FixtureBrowser();
  await browser.start(base);
  await browser.evaluate(`(async () => {
    const root = "/apps/local/src/mirror/";
    globalThis.mirror = Object.assign({},
      await import(root + "manifest.ts"), await import(root + "cache.ts"),
      await import(root + "download.ts"), await import(root + "catalogue.ts"));
    globalThis.fixtureAsset = ${JSON.stringify(asset)};
    globalThis.setupMirror = async (overrides = {}) => {
      const a = { ...fixtureAsset, ...overrides };
      const name = "mirror-fixture-" + crypto.randomUUID();
      const storage = new mirror.WebMirrorStorage({ cacheStorage: caches, locks: navigator.locks, origin: location.origin, cacheName: name });
      const network = new mirror.MirrorNetwork({ modelMirrorBase: location.origin + "/fixture/", licenseBridgeUrl: undefined });
      const space = new mirror.WebSpaceAdapter();
      const downloader = new mirror.MirrorDownloader(network, storage, space);
      const catalogue = new mirror.CatalogueStore({ version: "fixture", assets: [a] }, downloader);
      return { asset: a, name, storage, network, space, downloader, catalogue };
    };
  })()`);
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await vite?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

describe("manifest contract", () => {
  it("fetches the configured manifest and preserves explicit bytes, hashes, IDs and trial eligibility", async () => {
    const network = new MirrorNetwork({
      modelMirrorBase: `${base}/fixture`,
      licenseBridgeUrl: undefined,
    });
    expect(await fetchManifest(network)).toEqual(manifest);
    expect(requests.at(-1)?.path).toBe("/fixture/manifest.json");
  });

  it.each([
    ["missing id", { id: undefined }],
    ["blank id", { id: " " }],
    ["control id", { id: "bad\nID" }],
    ["missing bytes", { bytes: undefined }],
    ["negative bytes", { bytes: -1 }],
    ["fraction bytes", { bytes: 1.5 }],
    ["unsafe bytes", { bytes: Number.MAX_SAFE_INTEGER }],
    ["missing hash", { sha256: undefined }],
    ["invalid hash", { sha256: "invalid" }],
    ["blank file", { file: " " }],
    ["invalid trial flag", { trialEligible: "true" }],
  ])("rejects %s", (_label, replacement) => {
    expect(() => validateAsset({ ...asset, ...replacement })).toThrow();
  });

  it("rejects duplicate IDs, aliased files, outside hosts and credentialed URLs", () => {
    const network = new MirrorNetwork({
      modelMirrorBase: `${base}/fixture/`,
      licenseBridgeUrl: "https://bridge.example",
    });
    expect(() =>
      parseManifest({ ...manifest, assets: [asset, { ...asset, file: "other.bin" }] }, network),
    ).toThrow(/Duplicate.*ID/);
    expect(() =>
      parseManifest(
        { ...manifest, assets: [asset, { ...asset, id: "other", file: "./asset.bin" }] },
        network,
      ),
    ).toThrow(/Duplicate.*file/);
    expect(() => network.resolve("https://unlisted.example/model.bin")).toThrow(/not allowed/);
    expect(() => network.resolve("https://user:secret@bridge.example/model.bin")).toThrow(
      /credentials/,
    );
    expect(network.resolve("https://bridge.example/model.bin")).toBe(
      "https://bridge.example/model.bin",
    );
  });

  it("blocks redirects before contacting their destination", async () => {
    const network = new MirrorNetwork({
      modelMirrorBase: `${base}/fixture/`,
      licenseBridgeUrl: undefined,
    });
    await expect(network.fetch("redirect.bin")).rejects.toThrow();
  });

  it("follows a redirect that finishes on an allowed origin", async () => {
    const network = new MirrorNetwork({
      modelMirrorBase: `${base}/fixture/`,
      licenseBridgeUrl: undefined,
    });
    const response = await network.fetch("redirect-safe.bin");
    expect(response.ok).toBe(true);
    expect(response.redirected).toBe(true);
    expect(response.url).toBe(`${base}/fixture/asset.bin`);
  });

  it("rejects invalid JSON from an actual HTTP response", async () => {
    const network = new MirrorNetwork(
      { modelMirrorBase: `${base}/fixture/`, licenseBridgeUrl: undefined },
      () => fetch(`${base}/fixture/invalid.json`),
    );
    await expect(fetchManifest(network)).rejects.toThrow(/not valid JSON/);
  });

  it("rounds up the 10% reserve without floating point inflation", () => {
    expect(requiredSpace(10)).toBe(11);
    expect(requiredSpace(11)).toBe(13);
  });
});

describe("streaming SHA-256", () => {
  it.each([0, 1, 55, 56, 63, 64, 65, 127, 128, 4097, 1_000_000])(
    "matches Node crypto across padding/block boundaries (%i bytes)",
    (length) => {
      const input = Uint8Array.from({ length }, (_, i) => (i * 113 + 17) % 256);
      const hash = new StreamingSha256();
      for (let i = 0; i < input.length; i += 37) hash.update(input.subarray(i, i + 37));
      expect(hash.digestHex()).toBe(digest(input));
      expect(() => hash.update(new Uint8Array([1]))).toThrow(/finalized/);
    },
  );
  it("matches the published abc known-answer vector", () => {
    expect(new StreamingSha256().update(new TextEncoder().encode("abc")).digestHex()).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("real Chrome Cache Storage + HTTP fixture", () => {
  it("resumes a cancelled download, verifies persisted SHA-256, commits atomically, reloads and removes files + rows", async () => {
    const start = requests.length;
    const result = await browser.evaluate<{
      first: string;
      partial: number;
      visibleBefore: boolean;
      reloadedPartial: unknown;
      visibility: boolean[];
      sha: string;
      presentRow: unknown;
      observed: { state: string; bytes: number; percent: number }[];
      trial: boolean;
      stagedAfter: number;
      rowsAfter: unknown[];
      cacheKeys: number;
    }>(`(async () => {
      const c = await setupMirror();
      const observed = [];
      let interrupted = false;
      const unsubscribe = c.catalogue.subscribe(() => {
        const row = c.catalogue.getSnapshot()[0];
        if (row) observed.push({ state: row.state, bytes: row.bytes, percent: row.percent });
        if (row?.state === "downloading" && row.bytes >= 4096 && !interrupted) {
          interrupted = true; c.catalogue.cancel(c.asset.id);
        }
      });
      const first = await c.catalogue.download(c.asset.id).then(() => "unexpected-success", e => e.name);
      unsubscribe();
      const partial = await c.storage.partialBytes(c.asset);
      const visibleBefore = await c.storage.isPresent(c.asset);
      const resumedStorage = new mirror.WebMirrorStorage({ cacheStorage: caches, locks: navigator.locks, origin: location.origin, cacheName: c.name });
      const resumed = new mirror.CatalogueStore({ version: "fixture", assets: [c.asset] }, new mirror.MirrorDownloader(c.network, resumedStorage, c.space));
      await resumed.refresh();
      const reloadedPartial = resumed.getSnapshot()[0];
      const visibility = [];
      resumed.subscribe(() => {
        const row = resumed.getSnapshot()[0];
        if (row) observed.push({ state: row.state, bytes: row.bytes, percent: row.percent });
        if (row?.state === "verifying") visibility.push(resumedStorage.isPresent(c.asset));
      });
      await resumed.download(c.asset.id);
      const final = new Uint8Array(await new Response(await resumedStorage.read(c.asset)).arrayBuffer());
      const sha = new mirror.StreamingSha256().update(final).digestHex();
      const reloaded = new mirror.CatalogueStore({ version: "fixture", assets: [c.asset] }, c.downloader);
      await reloaded.refresh();
      const presentRow = reloaded.getSnapshot()[0];
      const stagedAfter = await c.storage.partialBytes(c.asset);
      const trial = reloaded.trialEligible(c.asset.id);
      await reloaded.remove(c.asset.id);
      await reloaded.refresh();
      return { first, partial, visibleBefore, reloadedPartial, visibility: await Promise.all(visibility),
        sha, presentRow, stagedAfter, trial, rowsAfter: reloaded.getSnapshot(),
        cacheKeys: (await (await caches.open(c.name)).keys()).length, observed };
    })()`);
    expect(result.first).toBe("AbortError");
    expect(result.partial).toBeGreaterThan(0);
    expect(result.partial).toBeLessThan(asset.bytes);
    expect(result.visibleBefore).toBe(false);
    expect(result.reloadedPartial).toMatchObject({ state: "partial", bytes: result.partial });
    expect(result.visibility).toEqual([false]);
    expect(
      requests.slice(start).some((request) => request.range === `bytes=${result.partial}-`),
    ).toBe(true);
    expect(result.sha).toBe(asset.sha256);
    expect(result.presentRow).toMatchObject({ state: "present", bytes: asset.bytes, percent: 100 });
    expect(
      result.observed.some(
        (row) => row.state === "downloading" && row.percent > 0 && row.percent < 100,
      ),
    ).toBe(true);
    expect(result.trial).toBe(true);
    expect(result.stagedAfter).toBe(0);
    expect(result.rowsAfter).toEqual([]);
    expect(result.cacheKeys).toBe(0);
  });

  it("rejects a same-length corrupt blob and removes its partial without publishing", async () => {
    const result = await browser.evaluate<{
      error: string;
      present: boolean;
      partial: number;
      keys: number;
      row: { state: string; bytes: number };
    }>(`(async () => {
      const c = await setupMirror({ file: "corrupt.bin" });
      const error = await c.catalogue.download(c.asset.id).then(() => null, e => e.message);
      return { error, present: await c.storage.isPresent(c.asset), partial: await c.storage.partialBytes(c.asset),
        row: c.catalogue.getSnapshot()[0], keys: (await (await caches.open(c.name)).keys()).length };
    })()`);
    expect(result.error).toMatch(/SHA-256.*corrupted blob rejected/);
    expect(result.present).toBe(false);
    expect(result.partial).toBe(0);
    expect(result.keys).toBe(0);
    expect(result.row.state).toBe("error");
    expect(result.row.bytes).toBe(0);
  });

  it.each(["ignore-range.bin", "bounded-range.bin"])(
    "handles %s with actual ranged server responses",
    async (file) => {
      const start = requests.length;
      const result = await browser.evaluate<{ partial: number; sha: string }>(`(async () => {
      const c = await setupMirror({ file: ${JSON.stringify(file)} });
      const controller = new AbortController();
      await c.downloader.download(c.asset, { signal: controller.signal, onProgress(p) {
        if (p.state === "downloading" && p.bytes >= 4096) controller.abort();
      } }).catch(() => undefined);
      const partial = await c.storage.partialBytes(c.asset);
      await c.downloader.download(c.asset);
      const data = new Uint8Array(await new Response(await c.storage.read(c.asset)).arrayBuffer());
      return { partial, sha: new mirror.StreamingSha256().update(data).digestHex() };
    })()`);
      expect(result.partial).toBeGreaterThan(0);
      expect(result.sha).toBe(asset.sha256);
      expect(
        requests.slice(start).some((request) => request.range === `bytes=${result.partial}-`),
      ).toBe(true);
    },
  );

  it("checks actual quota, refuses insufficient or unknown space before network, and fails honestly if estimate is absent", async () => {
    const start = requests.length;
    const result = await browser.evaluate<{
      available: number;
      errors: string[];
      partial: number;
    }>(`(async () => {
      const c = await setupMirror();
      const available = await c.space.availableBytes();
      const errors = [];
      for (const value of [c.asset.bytes, undefined]) {
        const downloader = new mirror.MirrorDownloader(c.network, c.storage, { async availableBytes() { return value; } });
        errors.push(await downloader.download(c.asset).then(() => null, e => e.message));
      }
      return { available, errors, partial: await c.storage.partialBytes(c.asset) };
    })()`);
    expect(result.available).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/Insufficient model storage/);
    expect(result.errors[1]).toMatch(/unknown/);
    expect(requests.length).toBe(start);
    expect(result.partial).toBe(0);
    await expect(
      new WebSpaceAdapter({ estimate: async () => ({}) }).availableBytes(),
    ).rejects.toThrow(/unavailable/);
  });

  it("preserves the previous committed response when a real Cache.put stream fails", async () => {
    const result = await browser.evaluate<{ failed: boolean; sha: string }>(`(async () => {
      const c = await setupMirror();
      await c.downloader.download(c.asset);
      // Corrupt a staged chunk on disk, so readPartial errors while Cache.put consumes it.
      await c.storage.appendPartial(c.asset, 0, new Uint8Array(c.asset.bytes));
      const cache = await caches.open(c.name);
      const chunk = (await cache.keys()).find(k => k.url.includes("/chunks/"));
      await cache.put(chunk, new Response(new Uint8Array([9]), { headers: { "content-length": String(c.asset.bytes) } }));
      const failed = await c.storage.commit(c.asset).then(() => false, () => true);
      const data = new Uint8Array(await new Response(await c.storage.read(c.asset)).arrayBuffer());
      return { failed, sha: new mirror.StreamingSha256().update(data).digestHex() };
    })()`);
    expect(result.failed).toBe(true);
    expect(result.sha).toBe(asset.sha256);
  });

  it("rejects malformed ranges and oversize data; missing trial flags remain ineligible", async () => {
    const result = await browser.evaluate<{
      rangeError: string;
      overflowError: string;
      eligible: boolean;
      rangePresent: boolean;
      overflowPresent: boolean;
      overflowPartial: number;
    }>(`(async () => {
      const bad = await setupMirror({ file: "bad-range.bin", trialEligible: undefined });
      const controller = new AbortController();
      await bad.downloader.download(bad.asset, { signal: controller.signal, onProgress(p) {
        if (p.bytes >= 4096) controller.abort();
      } }).catch(() => undefined);
      const rangeError = await bad.downloader.download(bad.asset).then(() => null, e => e.message);
      const overflow = await setupMirror({ file: "overflow.bin" });
      const overflowError = await overflow.downloader.download(overflow.asset).then(() => null, e => e.message);
      return { rangeError, overflowError, eligible: bad.catalogue.trialEligible(bad.asset.id),
        rangePresent: await bad.storage.isPresent(bad.asset), overflowPresent: await overflow.storage.isPresent(overflow.asset),
        overflowPartial: await overflow.storage.partialBytes(overflow.asset) };
    })()`);
    expect(result.rangeError).toMatch(/Content-Range/);
    expect(result.overflowError).toMatch(/exceeds declared size/);
    expect(result.eligible).toBe(false);
    expect(result.rangePresent).toBe(false);
    expect(result.overflowPresent).toBe(false);
    expect(result.overflowPartial).toBe(0);
  });

  it("serializes duplicate downloads and aborts an active download before remove", async () => {
    const start = requests.length;
    const result = await browser.evaluate<{
      samePromise: boolean;
      rows: unknown[];
      keys: number;
    }>(`(async () => {
      const c = await setupMirror();
      const first = c.catalogue.download(c.asset.id);
      const second = c.catalogue.download(c.asset.id);
      await Promise.all([first, second]);
      const samePromise = first === second;
      const d = await setupMirror();
      let removal;
      d.catalogue.subscribe(() => {
        const row = d.catalogue.getSnapshot()[0];
        if (row?.state === "downloading" && row.bytes > 0 && !removal) removal = d.catalogue.remove(d.asset.id);
      });
      await d.catalogue.download(d.asset.id).catch(() => undefined);
      await removal;
      return { samePromise, rows: d.catalogue.getSnapshot(), keys: (await (await caches.open(d.name)).keys()).length };
    })()`);
    expect(result.samePromise).toBe(true);
    expect(requests.slice(start).filter((r) => r.path.endsWith("/asset.bin"))).toHaveLength(2);
    expect(result.rows).toEqual([]);
    expect(result.keys).toBe(0);
  });

  it("downloads and verifies an empty file with a dot-segment ID, then removes it without orphan rows", async () => {
    const start = requests.length;
    const result = await browser.evaluate<{
      row: unknown;
      length: number;
      keys: number;
    }>(`(async () => {
      const c = await setupMirror({ id: "..", file: "empty.bin", bytes: 0, sha256: ${JSON.stringify(digest(new Uint8Array()))} });
      await c.catalogue.download(c.asset.id);
      const row = c.catalogue.getSnapshot()[0];
      const length = (await new Response(await c.storage.read(c.asset)).arrayBuffer()).byteLength;
      await c.catalogue.remove(c.asset.id);
      return { row, length, keys: (await (await caches.open(c.name)).keys()).length };
    })()`);
    expect(requests.slice(start).some((request) => request.path === "/fixture/empty.bin")).toBe(
      true,
    );
    expect(result.row).toMatchObject({ state: "present", bytes: 0, percent: 100 });
    expect(result.length).toBe(0);
    expect(result.keys).toBe(0);
  });
});
