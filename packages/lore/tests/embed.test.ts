import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Wllama } from "@wllama/wllama/esm/wllama.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNativeEmbedder,
  createWebEmbedder,
  type EmbeddingInvoke,
  type MirrorEmbeddingAssets,
  resolveEmbedDimension,
  type WllamaEmbeddingModule,
  type WllamaEmbeddingRuntime,
} from "../src/embed/embedder.js";
import { createHashEmbedder } from "./hash-embedder.js";

afterEach(() => vi.unstubAllEnvs());

const assets: MirrorEmbeddingAssets = {
  modelUrl: "/mirror/embedder.gguf",
  wasmUrl: "/mirror/wllama.wasm",
  compat: { wasm: "/mirror/compat/wllama.wasm", worker: "/mirror/compat/wllama.js" },
};

function webRuntime(vector = [3, 4]) {
  const runtime = {
    setCompat: vi.fn<WllamaEmbeddingRuntime["setCompat"]>(),
    loadModelFromUrl: vi.fn<WllamaEmbeddingRuntime["loadModelFromUrl"]>().mockResolvedValue(),
    createEmbedding: vi.fn<WllamaEmbeddingRuntime["createEmbedding"]>().mockResolvedValue({
      data: [{ embedding: vector, index: 0 }],
    }),
    exit: vi.fn<WllamaEmbeddingRuntime["exit"]>().mockResolvedValue(),
  } satisfies WllamaEmbeddingRuntime;
  const constructed = vi.fn();
  class Wllama implements WllamaEmbeddingRuntime {
    setCompat = runtime.setCompat;
    loadModelFromUrl = runtime.loadModelFromUrl;
    createEmbedding = runtime.createEmbedding;
    exit = runtime.exit;

    constructor(paths: { default: string }) {
      constructed(paths);
    }
  }
  const loadWllama = vi.fn<() => Promise<WllamaEmbeddingModule>>().mockResolvedValue({
    Wllama,
  });
  return { runtime, loadWllama, constructed };
}

function nativeRuntime(output: unknown = [3, 4]) {
  const call = vi
    .fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()
    .mockResolvedValue(output);
  const invoke: EmbeddingInvoke = async <T>(command: string, args: Record<string, unknown>) =>
    (await call(command, args)) as T;
  return { call, invoke };
}

function expectUnit(vector: number[], dim: number) {
  expect(vector).toHaveLength(dim);
  expect(vector.every(Number.isFinite)).toBe(true);
  expect(Math.abs(Math.hypot(...vector) - 1)).toBeLessThanOrEqual(1e-6);
}

function deferred() {
  let resolve: () => void = () => {
    throw new Error("Deferred promise not initialized");
  };
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("embedder configuration", () => {
  it("accepts the installed wllama constructor without an adapter cast", () => {
    // This assignment checks the real installed declarations during typechecking.
    const identity = (sdk: { Wllama: typeof Wllama }): WllamaEmbeddingModule => sdk;
    expect(typeof identity).toBe("function");
  });
  it("uses VITE_LORE_EMBED_DIM, default 384, with an explicit override", () => {
    vi.stubEnv("VITE_LORE_EMBED_DIM", undefined);
    expect(resolveEmbedDimension()).toBe(384);
    vi.stubEnv("VITE_LORE_EMBED_DIM", "768");
    expect(resolveEmbedDimension()).toBe(768);
    expect(resolveEmbedDimension(256)).toBe(256);
    expect(createWebEmbedder({ assets, ...webRuntime() }).dim).toBe(768);
    expect(createNativeEmbedder(nativeRuntime()).dim).toBe(768);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "",
    "0",
    "3.5",
    "384junk",
    "0x180",
    "1e3",
    2 ** 31,
  ])("rejects malformed dimensions (%s) before loading", (dim) => {
    const web = webRuntime();
    expect(() => createWebEmbedder({ assets, ...web, dim })).toThrow(/positive 32-bit integer/);
    expect(web.loadWllama).not.toHaveBeenCalled();
    expect(() => createNativeEmbedder({ ...nativeRuntime(), dim })).toThrow();
  });
});

describe("deterministic hash fixture", () => {
  it.each([1, 2, 7, 384, 768])(
    "honors dim=%i and normalizes text and empty documents",
    async (dim) => {
      const embedder = createHashEmbedder(dim);
      expect(embedder.dim).toBe(dim);
      for (const text of ["", "!!!", "café moon 東京", "moon moon sun", "  \n "]) {
        expectUnit(await embedder.embed(text), dim);
      }
    },
  );

  it("is a deterministic bag of words, preserving frequency and Unicode normalization", async () => {
    const fixture = createHashEmbedder(384);
    const result = await fixture.embed("Moon sun moon café");
    expect(result).toEqual(await createHashEmbedder(384).embed("cafe\u0301 MOON moon sun!"));
    expect(result).not.toEqual(await fixture.embed("moon sun café"));
    expect(await fixture.embed("sun")).not.toEqual(await fixture.embed("ocean"));
    result.fill(0);
    expectUnit(await fixture.embed("Moon sun moon café"), 384);
  });

  it("rejects invalid dimensions and defaults to 384 independently of production env", () => {
    vi.stubEnv("VITE_LORE_EMBED_DIM", "768");
    expect(createHashEmbedder().dim).toBe(384);
    for (const dim of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31]) {
      expect(() => createHashEmbedder(dim)).toThrow();
    }
  });
});

describe("wllama production adapter (SDK boundary doubles, no model inference)", () => {
  it("lazily loads injected mirror assets in embedding mode and returns normalized vectors", async () => {
    const web = webRuntime();
    const embedder = createWebEmbedder({ ...web, assets, dim: 2, contextSize: 256 });
    expect(web.loadWllama).not.toHaveBeenCalled();
    expect(await embedder.embed("moon and sun")).toEqual([0.6, 0.8]);
    expect(await embedder.embed("ocean")).toEqual([0.6, 0.8]);
    expect(web.loadWllama).toHaveBeenCalledTimes(1);
    expect(web.constructed).toHaveBeenCalledWith({ default: assets.wasmUrl });
    expect(web.runtime.setCompat).toHaveBeenCalledWith(assets.compat);
    expect(web.runtime.setCompat.mock.invocationCallOrder[0]).toBeLessThan(
      web.runtime.loadModelFromUrl.mock.invocationCallOrder[0] ?? 0,
    );
    expect(web.runtime.loadModelFromUrl).toHaveBeenCalledExactlyOnceWith(assets.modelUrl, {
      embeddings: true,
      pooling_type: "mean",
      n_ctx: 256,
      n_batch: 256,
      n_ubatch: 256,
    });
    expect(web.runtime.createEmbedding).toHaveBeenNthCalledWith(1, {
      input: "moon and sun",
      encoding_format: "float",
    });
    await embedder.dispose();
    expect(web.runtime.exit).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent requests and recovers after inference errors", async () => {
    const web = webRuntime();
    const active: string[] = [];
    const finish = deferred();
    const started = deferred();
    web.runtime.createEmbedding.mockImplementationOnce(async ({ input }) => {
      active.push(input);
      started.resolve();
      await finish.promise;
      throw new Error("inference failed");
    });
    const embedder = createWebEmbedder({ ...web, assets, dim: 2 });
    const first = embedder.embed("first");
    const failure = expect(first).rejects.toThrow("inference failed");
    const second = embedder.embed("second");
    await started.promise;
    expect(active).toEqual(["first"]);
    expect(web.runtime.createEmbedding).toHaveBeenCalledTimes(1);
    finish.resolve();
    await failure;
    expectUnit(await second, 2);
    expect(web.loadWllama).toHaveBeenCalledTimes(1);
    expect(web.runtime.createEmbedding).toHaveBeenNthCalledWith(2, {
      input: "second",
      encoding_format: "float",
    });
    await embedder.dispose();
  });

  it("cleans up a failed load and retries the real runtime loader", async () => {
    const web = webRuntime();
    web.runtime.loadModelFromUrl.mockRejectedValueOnce(new Error("model download failed"));
    const embedder = createWebEmbedder({ ...web, assets, dim: 2 });
    await expect(embedder.embed("first")).rejects.toThrow("model download failed");
    expect(web.runtime.exit).toHaveBeenCalledTimes(1);
    expect(web.runtime.createEmbedding).not.toHaveBeenCalled();
    expectUnit(await embedder.embed("retry"), 2);
    expect(web.loadWllama).toHaveBeenCalledTimes(2);
    await embedder.dispose();
  });

  it("retries a failed SDK import and preserves cleanup errors", async () => {
    const web = webRuntime();
    web.loadWllama.mockRejectedValueOnce(new Error("import failed"));
    const embedder = createWebEmbedder({ ...web, assets, dim: 2 });
    await expect(embedder.embed("first")).rejects.toThrow("import failed");
    web.runtime.loadModelFromUrl.mockRejectedValueOnce(new Error("load failed"));
    web.runtime.exit.mockRejectedValueOnce(new Error("exit failed"));
    await expect(embedder.embed("second")).rejects.toMatchObject({
      errors: [new Error("load failed"), new Error("exit failed")],
    });
    expectUnit(await embedder.embed("third"), 2);
    await embedder.dispose();
  });

  it("disposes after accepted requests, exactly once, and forbids future work", async () => {
    const web = webRuntime();
    const loaded = deferred();
    web.runtime.loadModelFromUrl.mockReturnValueOnce(loaded.promise);
    const embedder = createWebEmbedder({ ...web, assets, dim: 2 });
    const inference = embedder.embed("queued");
    const disposal = embedder.dispose();
    expect(embedder.dispose()).toBe(disposal);
    await expect(embedder.embed("late")).rejects.toThrow("disposed");
    expect(web.runtime.exit).not.toHaveBeenCalled();
    loaded.resolve();
    expectUnit(await inference, 2);
    await disposal;
    expect(web.runtime.exit).toHaveBeenCalledTimes(1);
  });

  it("disposes an unused embedder without importing or fetching", async () => {
    const web = webRuntime();
    const embedder = createWebEmbedder({ ...web, assets });
    await embedder.dispose();
    expect(web.loadWllama).not.toHaveBeenCalled();
  });

  it("requires explicit mirror assets and a valid context size", () => {
    const web = webRuntime();
    expect(() => createWebEmbedder({ ...web, assets: { ...assets, modelUrl: "" } })).toThrow(
      /asset/,
    );
    expect(() => createWebEmbedder({ ...web, assets: { ...assets, wasmUrl: "" } })).toThrow(
      /asset/,
    );
    expect(() =>
      createWebEmbedder({ ...web, assets: { ...assets, compat: { wasm: "", worker: "" } } }),
    ).toThrow(/asset/);
    for (const contextSize of [0, -1, 1.5, Number.NaN, 2 ** 31]) {
      expect(() => createWebEmbedder({ ...web, assets, contextSize })).toThrow(/contextSize/);
    }
  });

  it("rejects missing, multiple, or misindexed response vectors", async () => {
    const web = webRuntime();
    const embedder = createWebEmbedder({ ...web, assets, dim: 2 });
    for (const data of [
      [],
      [{ embedding: [3, 4], index: 1 }],
      [
        { embedding: [3, 4], index: 0 },
        { embedding: [3, 4], index: 1 },
      ],
    ]) {
      web.runtime.createEmbedding.mockResolvedValueOnce({ data });
      await expect(embedder.embed("text")).rejects.toThrow(/one embedding/);
    }
    await embedder.dispose();
  });
});

describe.each(["web", "native"] as const)("%s vector boundary", (platform) => {
  function adapter(output: unknown, dim = 2) {
    if (platform === "native") return createNativeEmbedder({ ...nativeRuntime(output), dim });
    return createWebEmbedder({ ...webRuntime(output as number[]), assets, dim });
  }

  it.each([
    [3, 4],
    [Number.MAX_VALUE, Number.MAX_VALUE],
    [Number.MIN_VALUE, Number.MIN_VALUE],
    [-3, 4],
  ])("returns a unit vector without mutating model output (%s, %s)", async (a, b) => {
    const raw = [a, b];
    const embedder = adapter(raw);
    expectUnit(await embedder.embed("text"), 2);
    expect(raw).toEqual([a, b]);
  });

  it("honors a non-default configured dimension", async () => {
    const embedder = adapter([1, 2, 3, 4, 5, 6, 7], 7);
    expectUnit(await embedder.embed("seven"), 7);
  });

  it("rejects wrong dimensions, zero vectors and malformed numeric data", async () => {
    for (const output of [
      [],
      [1],
      [1, 2, 3],
      [0, 0],
      [Number.NaN, 1],
      [Infinity, 1],
      ["3", 4],
      [null, 1],
      new Array(2),
      null,
    ]) {
      await expect(adapter(output).embed("text")).rejects.toThrow(/Embedding|embedding/);
    }
  });

  it.each(["", " \n\t ", "a\0b"])(
    "rejects invalid text before any load or bridge call (%j)",
    async (text) => {
      const web = webRuntime();
      const native = nativeRuntime();
      const embedder =
        platform === "web"
          ? createWebEmbedder({ ...web, assets, dim: 2 })
          : createNativeEmbedder({ ...native, dim: 2 });
      await expect(embedder.embed(text)).rejects.toThrow(/text/);
      expect(web.loadWllama).not.toHaveBeenCalled();
      expect(native.call).not.toHaveBeenCalled();
    },
  );
});

describe("native command boundary", () => {
  it("invokes the native bridge lazily with text and the configured dimension only", async () => {
    const native = nativeRuntime();
    const embedder = createNativeEmbedder({ ...native, dim: 2 });
    expect(native.call).not.toHaveBeenCalled();
    expect(await embedder.embed("  exact text  ")).toEqual([0.6, 0.8]);
    expect(native.call).toHaveBeenCalledExactlyOnceWith("plugin:lore-embed|lore_embed", {
      text: "  exact text  ",
      dim: 2,
    });
  });

  it("propagates native failures without substituting a test vector", async () => {
    const native = nativeRuntime();
    native.call.mockRejectedValueOnce(new Error("GGUF unavailable"));
    const embedder = createNativeEmbedder({ ...native, dim: 2 });
    await expect(embedder.embed("first")).rejects.toThrow("GGUF unavailable");
    expectUnit(await embedder.embed("retry"), 2);
  });
});

describe("src purity", () => {
  it("has zero production imports of the test embedder, including aliases and re-exports", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const offenders: string[] = [];
    const exactForbiddenImport = "import {createHashEmbedder} from '../tests/hash-embedder'";
    function visit(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (
          entry.name.startsWith(".") ||
          ["node_modules", "target", "dist", "VENDORED", "LIBS", "DOCS"].includes(entry.name)
        )
          continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (
          entry.isFile() &&
          relative(root, path).split(sep).includes("src") &&
          /\.(?:[cm]?[jt]sx?|rs)$/.test(path)
        ) {
          const source = readFileSync(path, "utf8");
          if (
            source.includes(exactForbiddenImport) ||
            /\bcreateHashEmbedder\b|hash-embedder/.test(source)
          ) {
            offenders.push(relative(root, path));
          }
        }
      }
    }
    visit(root);
    expect(offenders, "production must never reach the hash fixture").toEqual([]);
  });
});
