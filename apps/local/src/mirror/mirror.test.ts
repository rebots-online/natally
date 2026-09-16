// natally — M.1 verify.
// Accept: `mirror: resume + sha256 + atomic commit; corrupted blob rejected`.
//
// Real bytes end to end: a real node HTTP fixture server on 127.0.0.1:0
// (Range support, range-request counting, one-shot mid-transfer cut) and a
// real node-fs AssetStorage over a fresh tmp dir. No network leaves
// loopback; no mocks in shipped code (the shipped modules are exercised as-is).

import { createHash } from "node:crypto";
import {
  mkdir,
  open as openFile,
  readFile,
  rename as renameFile,
  rm,
  stat,
} from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cacheKey, cacheName, staticCacheDir } from "./cache";
import { Catalogue, type KvStore } from "./catalogue";
import {
  type AssetStorage,
  bufferedSha256,
  DownloadError,
  downloadAsset,
  type StorageWriter,
} from "./download";
import {
  type FetchLike,
  fetchManifest,
  type ManifestAsset,
  ManifestError,
  MirrorUrlError,
  type ModelManifest,
} from "./manifest";

// ---------------------------------------------------------------------------
// Real node-fs storage (the seam impl I.3 will mirror natively)
// ---------------------------------------------------------------------------

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

class NodeFsAssetStorage implements AssetStorage {
  readonly #root: string;
  constructor(root: string) {
    this.#root = root;
  }

  #path(name: string): string {
    return join(this.#root, name);
  }

  async open(name: string): Promise<StorageWriter> {
    const path = this.#path(name);
    await mkdir(dirname(path), { recursive: true });
    const handle = await openFile(path, "a");
    return {
      write: async (chunk: Uint8Array) => {
        await handle.write(chunk);
      },
      close: async () => {
        await handle.close();
      },
    };
  }

  async length(name: string): Promise<number> {
    try {
      return (await stat(this.#path(name))).size;
    } catch (err) {
      if (isEnoent(err)) {
        return 0;
      }
      throw err;
    }
  }

  async read(name: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.#path(name)));
  }

  async rename(from: string, to: string): Promise<void> {
    await renameFile(this.#path(from), this.#path(to));
  }

  async remove(name: string): Promise<void> {
    try {
      await rm(this.#path(name));
    } catch (err) {
      if (!isEnoent(err)) {
        throw err;
      }
    }
  }
}

function mapKv(): KvStore {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
    keys: async () => [...map.keys()],
  };
}

// ---------------------------------------------------------------------------
// Real HTTP fixture server: tiny manifest + tiny asset, Range-aware
// ---------------------------------------------------------------------------

const MODEL_BYTES = 2000;
const CUT_AFTER = 41;

interface FixtureState {
  /** One-shot: next full (non-Range) transfer is cut after this many bytes. */
  cutFullTransferAt: number | null;
  /** Serve corrupted model bytes (same length, wrong content). */
  corruptModel: boolean;
  /** Pretend the server does not support Range: always answer 200 full. */
  ignoreRange: boolean;
  rangeRequests: number;
  fullRequests: number;
}

interface Fixture {
  base: string;
  state: FixtureState;
  model: Uint8Array;
  modelSha256: string;
  asset: ManifestAsset;
  manifest: ModelManifest;
  close: () => Promise<void>;
}

function deterministicModel(): Buffer {
  const bytes = Buffer.alloc(MODEL_BYTES);
  for (let i = 0; i < MODEL_BYTES; i++) {
    bytes[i] = i % 251;
  }
  return bytes;
}

function serve(
  res: ServerResponse,
  status: number,
  headers: Record<string, string | number>,
  body?: Uint8Array,
): void {
  res.writeHead(status, headers);
  if (body === undefined) {
    res.end();
    return;
  }
  res.end(body);
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  state: FixtureState,
  model: Uint8Array,
  asset: ManifestAsset,
  manifest: ModelManifest,
): Promise<void> {
  const total = model.length;
  const served = state.corruptModel
    ? Uint8Array.from(model, (byte, i) => (i === 0 ? byte ^ 0xff : byte))
    : model;

  if (req.url === "/manifest.json") {
    serve(res, 200, { "content-type": "application/json" }, Buffer.from(JSON.stringify(manifest)));
    return;
  }
  if (req.url !== `/${asset.file}`) {
    serve(res, 404, {});
    return;
  }

  const wantsRange = req.headers.range !== undefined && !state.ignoreRange;
  if (wantsRange) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (match === null) {
      serve(res, 416, {});
      return;
    }
    state.rangeRequests++;
    const start = Number(match[1] ?? "0");
    const endRaw = match[2] ?? "";
    const end = endRaw === "" ? total - 1 : Math.min(Number(endRaw), total - 1);
    if (start >= total || start > end) {
      serve(res, 416, {});
      return;
    }
    const slice = served.subarray(start, end + 1);
    serve(
      res,
      206,
      {
        "content-range": `bytes ${start}-${end}/${total}`,
        "content-length": String(slice.length),
        "accept-ranges": "bytes",
      },
      slice,
    );
    return;
  }

  state.fullRequests++;
  if (state.cutFullTransferAt !== null) {
    const cut = state.cutFullTransferAt;
    state.cutFullTransferAt = null;
    res.writeHead(200, { "content-length": String(total), "accept-ranges": "bytes" });
    await new Promise<void>((resolve) => {
      res.write(served.subarray(0, cut), () => resolve());
    });
    // Let the kernel transmit (and the client read) the cut bytes before the
    // abrupt close, so exactly `cut` bytes are delivered deterministically.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    res.destroy();
    return;
  }
  serve(res, 200, { "content-length": String(total), "accept-ranges": "bytes" }, served);
}

async function startFixture(): Promise<Fixture> {
  const model = deterministicModel();
  const modelSha256 = createHash("sha256").update(model).digest("hex");
  const asset: ManifestAsset = {
    id: "test-model",
    kind: "llm",
    file: "assets/model.bin",
    bytes: model.length,
    sha256: modelSha256,
    trialEligible: true,
  };
  const manifest: ModelManifest = { version: "1", assets: [asset] };
  const state: FixtureState = {
    cutFullTransferAt: null,
    corruptModel: false,
    ignoreRange: false,
    rangeRequests: 0,
    fullRequests: 0,
  };
  const server: Server = createServer((req, res) => {
    void handleRequest(req, res, state, model, asset, manifest).catch(() => {
      if (!res.headersSent) {
        serve(res, 500, {});
      } else {
        res.destroy();
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server has no TCP address");
  }
  return {
    base: `http://127.0.0.1:${address.port}`,
    state,
    model,
    modelSha256,
    asset,
    manifest,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let fixture: Fixture;
let tmpDir: string;
let storage: NodeFsAssetStorage;

beforeEach(async () => {
  fixture = await startFixture();
  tmpDir = join(tmpdir(), `natally-mirror-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmpDir, { recursive: true });
  storage = new NodeFsAssetStorage(tmpDir);
});

afterEach(async () => {
  await fixture.close();
  await rm(tmpDir, { recursive: true, force: true });
});

function failingFetch(): FetchLike {
  return async () => {
    throw new Error("fetch must not be called");
  };
}

function jsonFetch(payload: unknown): FetchLike {
  return async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

// ---------------------------------------------------------------------------
// The suite — description prints the Accept line
// ---------------------------------------------------------------------------

describe("mirror: resume + sha256 + atomic commit; corrupted blob rejected", () => {
  describe("manifest", () => {
    test("fetches and validates manifest.json from the mirror base", async () => {
      const manifest = await fetchManifest(fixture.base);
      expect(manifest).toEqual(fixture.manifest);
    });

    test("rejects a manifest that fails the ModelManifest schema", async () => {
      const bad = {
        version: "1",
        assets: [{ id: "x", kind: "llm", file: "f", bytes: 1, sha256: "nothex" }],
      };
      await expect(fetchManifest(fixture.base, { fetchImpl: jsonFetch(bad) })).rejects.toThrowError(
        ManifestError,
      );
    });

    test("guard: rejects plain-http non-loopback and non-allowlisted hosts without fetching", async () => {
      await expect(
        fetchManifest("http://insecure.example/mirror/", { fetchImpl: failingFetch() }),
      ).rejects.toThrowError(MirrorUrlError);
      await expect(
        fetchManifest("https://stranger.example/m/", {
          fetchImpl: failingFetch(),
          allowedHosts: ["mirror.example"],
        }),
      ).rejects.toThrowError(MirrorUrlError);
    });

    test("guard: https allowlisted host and loopback http pass", async () => {
      // Explicit allowlist replaces the default: I.3 passes {mirror, bridge}.
      const viaHttps = await fetchManifest("https://mirror.example/m/", {
        fetchImpl: jsonFetch(fixture.manifest),
        allowedHosts: ["mirror.example", "bridge.example"],
      });
      expect(viaHttps.version).toBe("1");
      const viaLoopback = await fetchManifest("http://localhost:9/m/", {
        fetchImpl: jsonFetch(fixture.manifest),
      });
      expect(viaLoopback).toEqual(fixture.manifest);
    });
  });

  describe("download", () => {
    test("resume: cut transfer continues via Range and commits atomically", async () => {
      fixture.state.cutFullTransferAt = CUT_AFTER;

      let firstError: unknown;
      try {
        await downloadAsset(fixture.asset, { baseUrl: fixture.base, storage });
        expect.unreachable("download should have failed mid-transfer");
      } catch (err) {
        firstError = err;
      }
      expect(firstError).toBeInstanceOf(DownloadError);
      expect((firstError as DownloadError).code).toBe("network");
      // Partial bytes survived on disk; nothing was committed.
      expect(await storage.length(`${fixture.asset.file}.part`)).toBe(CUT_AFTER);
      expect(await storage.length(fixture.asset.file)).toBe(0);
      expect(fixture.state.rangeRequests).toBe(0);
      expect(fixture.state.fullRequests).toBe(1);

      const result = await downloadAsset(fixture.asset, { baseUrl: fixture.base, storage });
      // Exactly one ranged continuation was served for the resume.
      expect(fixture.state.rangeRequests).toBe(1);
      expect(result).toEqual({
        assetId: fixture.asset.id,
        file: fixture.asset.file,
        bytes: MODEL_BYTES,
        sha256: fixture.modelSha256,
      });
      // Atomic commit: final file holds the real bytes; the part is gone.
      const committed = await readFile(join(tmpDir, fixture.asset.file));
      expect(Buffer.compare(committed, fixture.model)).toBe(0);
      expect(await storage.length(`${fixture.asset.file}.part`)).toBe(0);
    });

    test("corrupted blob rejected: sha256 checked before commit, part removed", async () => {
      fixture.state.corruptModel = true;
      const attempt = downloadAsset(fixture.asset, { baseUrl: fixture.base, storage });
      await expect(attempt).rejects.toThrowError(DownloadError);
      await expect(attempt).rejects.toMatchObject({ code: "sha256-mismatch" });
      // No final file until hash ok; the rejected part is cleaned up.
      expect(await storage.length(fixture.asset.file)).toBe(0);
      expect(await storage.length(`${fixture.asset.file}.part`)).toBe(0);
    });

    test("byte-count mismatch rejected even when the digest would pass", async () => {
      const shortAsset: ManifestAsset = { ...fixture.asset, bytes: MODEL_BYTES - 5 };
      const attempt = downloadAsset(shortAsset, { baseUrl: fixture.base, storage });
      await expect(attempt).rejects.toMatchObject({ code: "byte-count" });
      expect(await storage.length(shortAsset.file)).toBe(0);
      expect(await storage.length(`${shortAsset.file}${".part"}`)).toBe(0);
    });

    test("server ignoring Range restarts cleanly from zero", async () => {
      // Seed a junk partial part, then let the server answer 200 to the
      // Range request — the downloader must discard the part and re-fetch.
      const writer = await storage.open(`${fixture.asset.file}.part`);
      await writer.write(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
      await writer.close();
      fixture.state.ignoreRange = true;

      const result = await downloadAsset(fixture.asset, { baseUrl: fixture.base, storage });
      expect(result.bytes).toBe(MODEL_BYTES);
      expect(fixture.state.rangeRequests).toBe(0);
      const committed = await readFile(join(tmpDir, fixture.asset.file));
      expect(Buffer.compare(committed, fixture.model)).toBe(0);
    });

    test("incremental digest injectable produces the same digest", async () => {
      const result = await downloadAsset(fixture.asset, {
        baseUrl: fixture.base,
        storage,
        digest: bufferedSha256,
      });
      expect(result.sha256).toBe(fixture.modelSha256);
    });
  });

  describe("catalogue", () => {
    test("states cycle downloading% → present → removed; files + rows deleted", async () => {
      const catalogue = new Catalogue(mapKv(), storage);
      const snapshots: string[] = [];
      const progressTrail: number[] = [];
      catalogue.subscribe((rows) => {
        for (const row of rows) {
          if (row.asset.id !== fixture.asset.id) {
            continue;
          }
          if (snapshots[snapshots.length - 1] !== row.state) {
            snapshots.push(row.state);
          }
          progressTrail.push(row.bytesDone);
        }
      });

      await catalogue.markDownloading(fixture.asset);
      const downloading = await catalogue.get(fixture.asset.id);
      expect(downloading).toMatchObject({
        state: "downloading",
        bytesDone: 0,
        bytesTotal: MODEL_BYTES,
      });

      // Collect real progress events from a real download, then replay them
      // through the catalogue deterministically (the downloader's onProgress
      // is synchronous; the catalogue writes are awaited in order).
      const events: { assetId: string; bytesDone: number }[] = [];
      const result = await downloadAsset(fixture.asset, {
        baseUrl: fixture.base,
        storage,
        onProgress: (progress) => {
          events.push({ assetId: progress.assetId, bytesDone: progress.bytesDone });
        },
      });
      expect(result.bytes).toBe(MODEL_BYTES);
      for (const event of events) {
        await catalogue.progress(event.assetId, event.bytesDone);
      }
      const progressed = await catalogue.get(fixture.asset.id);
      expect(progressed?.state).toBe("downloading");
      expect(progressed?.bytesDone).toBe(MODEL_BYTES);

      await catalogue.markPresent(fixture.asset.id);
      const present = await catalogue.get(fixture.asset.id);
      expect(present).toMatchObject({ state: "present", bytesDone: MODEL_BYTES });

      // trialEligible passes through untouched (B.1/U.5).
      expect(present?.asset.trialEligible).toBe(true);
      expect(await catalogue.isTrialEligible(fixture.asset.id)).toBe(true);

      // State cycle: downloading → present (removal empties the set).
      expect(snapshots[0]).toBe("downloading");
      expect(snapshots[snapshots.length - 1]).toBe("present");
      const nonDecreasing = progressTrail.every(
        (bytes, i) => i === 0 || bytes >= (progressTrail[i - 1] ?? 0),
      );
      expect(nonDecreasing).toBe(true);

      // remove = files + rows (§13).
      expect(await storage.length(fixture.asset.file)).toBe(MODEL_BYTES);
      let snapshotCount = 0;
      catalogue.subscribe(() => {
        snapshotCount++;
      });
      const removed = await catalogue.remove(fixture.asset.id);
      expect(removed).toBe(true);
      expect(snapshotCount).toBe(1);
      expect(await catalogue.get(fixture.asset.id)).toBeNull();
      expect(await storage.length(fixture.asset.file)).toBe(0);
      expect(await storage.length(`${fixture.asset.file}.part`)).toBe(0);

      // Removing again is a no-op and emits nothing.
      expect(await catalogue.remove(fixture.asset.id)).toBe(false);
      expect(snapshotCount).toBe(1);
      expect(await catalogue.list()).toEqual([]);
    });

    test("remove also deletes a leftover .part; non-trial assets read false", async () => {
      const catalogue = new Catalogue(mapKv(), storage);
      const plainAsset: ManifestAsset = {
        ...fixture.asset,
        id: "plain-model",
        trialEligible: undefined,
      };
      await catalogue.markDownloading(plainAsset);
      const writer = await storage.open(`${plainAsset.file}.part`);
      await writer.write(Uint8Array.from([9, 9, 9]));
      await writer.close();

      expect(await catalogue.isTrialEligible(plainAsset.id)).toBe(false);
      await catalogue.remove(plainAsset.id);
      expect(await storage.length(`${plainAsset.file}.part`)).toBe(0);
    });
  });

  describe("cache", () => {
    test("cacheKey is deterministic and safe; resolver seam resolves", async () => {
      expect(cacheKey("qwen3-1.7b-q4_k_m")).toBe("qwen3-1.7b-q4_k_m");
      expect(cacheKey("a b/c:d")).toBe("a_b_c_d");
      expect(cacheKey("")).toBe("_");
      const resolver = staticCacheDir("/cache");
      await expect(resolver.resolve()).resolves.toBe("/cache");
      await expect(cacheName(resolver, "test-model")).resolves.toBe("/cache/test-model");
    });
  });
});
