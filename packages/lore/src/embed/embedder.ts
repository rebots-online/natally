/// <reference types="vite/client" />

/** L.2's platform-neutral boundary. Production vectors retain the model's width. */
export interface Embedder {
  readonly dim: number;
  embed(text: string): Promise<number[]>;
}

export interface WebEmbedder extends Embedder {
  /** Terminal; waits for accepted work, then releases the worker and model. */
  dispose(): Promise<void>;
}

export interface MirrorEmbeddingAssets {
  /** Resolved URLs from the application's actual mirror storage. */
  modelUrl: string;
  wasmUrl: string;
  /** Self-hosted wllama-compat assets; required for browsers without JSPI. */
  compat: { wasm: string; worker: string };
}

/** Structural subset of installed wllama 3.6.1; see SDK.md for API references. */
export interface WllamaEmbeddingRuntime {
  setCompat(assets: { wasm: string; worker: string }): void;
  loadModelFromUrl(
    url: string,
    options: {
      embeddings: true;
      pooling_type: "mean";
      n_ctx: number;
      n_batch: number;
      n_ubatch: number;
    },
  ): Promise<void>;
  createEmbedding(options: { input: string; encoding_format: "float" }): Promise<{
    data: { embedding: number[] | string; index: number }[];
  }>;
  exit(): Promise<void>;
}

export interface WllamaEmbeddingModule {
  Wllama: new (paths: { default: string }) => WllamaEmbeddingRuntime;
}

export interface WebEmbedderOptions {
  assets: MirrorEmbeddingAssets;
  /** Pass () => import("@wllama/wllama/esm/index.js"); called only on the first embed. */
  loadWllama: () => Promise<WllamaEmbeddingModule>;
  dim?: number | string;
  /** Same token limit as the native configuration, including special tokens. */
  contextSize?: number;
}

export type EmbeddingInvoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export interface NativeEmbedderOptions {
  /** Supply @tauri-apps/api/core invoke from the installed application. */
  invoke: EmbeddingInvoke;
  dim?: number | string;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new RangeError(`${name} must be a positive 32-bit integer`);
  }
  return value;
}

export function resolveEmbedDimension(value?: number | string): number {
  const env = import.meta.env;
  const configured = value ?? env?.VITE_LORE_EMBED_DIM ?? 384;
  if (typeof configured === "string" && !/^\s*\d+\s*$/.test(configured)) {
    throw new RangeError("VITE_LORE_EMBED_DIM must be a positive 32-bit integer");
  }
  return positiveInteger(Number(configured), "VITE_LORE_EMBED_DIM");
}

function validateText(text: string): void {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new TypeError("Embedding text must be a non-empty string");
  }
  // llama.cpp's Rust tokenizer accepts a CString. Keep both platforms identical.
  if (text.includes("\0")) throw new TypeError("Embedding text must not contain NUL");
}

function normalizeEmbedding(input: unknown, dim: number): number[] {
  if (!Array.isArray(input) || input.length !== dim) {
    throw new Error(
      `Embedding dimension mismatch: expected ${dim}, got ${Array.isArray(input) ? input.length : "non-vector"}`,
    );
  }
  let scale = 0;
  for (const value of input) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Embedding contains non-finite or non-numeric values");
    }
    scale = Math.max(scale, Math.abs(value));
  }
  if (scale === 0) throw new Error("Cannot normalize a zero embedding");
  // Scaling first avoids overflow/underflow even for finite extreme inputs.
  const scaled = input.map((value: number) => value / scale);
  const norm = Math.sqrt(scaled.reduce((sum, value) => sum + value * value, 0));
  return scaled.map((value) => value / norm);
}

export function createWebEmbedder(options: WebEmbedderOptions): WebEmbedder {
  const dim = resolveEmbedDimension(options.dim);
  const contextSize = positiveInteger(options.contextSize ?? 512, "contextSize");
  const { modelUrl, wasmUrl } = options.assets;
  const compat = { ...options.assets.compat };
  for (const [name, value] of Object.entries({ modelUrl, wasmUrl, ...compat })) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`Mirror embedding asset ${name} is required`);
    }
  }
  const loadWllama = options.loadWllama;
  let runtime: WllamaEmbeddingRuntime | undefined;
  let pending: Promise<void> = Promise.resolve();
  let disposed = false;
  let disposal: Promise<void> | undefined;

  async function load(): Promise<WllamaEmbeddingRuntime> {
    if (runtime) return runtime;
    const { Wllama } = await loadWllama();
    const candidate = new Wllama({ default: wasmUrl });
    try {
      // Override the SDK constructor's CDN fallback before any model/runtime load.
      candidate.setCompat(compat);
      await candidate.loadModelFromUrl(modelUrl, {
        embeddings: true,
        pooling_type: "mean",
        n_ctx: contextSize,
        n_batch: contextSize,
        n_ubatch: contextSize,
      });
      runtime = candidate;
      return candidate;
    } catch (error) {
      try {
        await candidate.exit();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Embedding load and cleanup failed");
      }
      throw error;
    }
  }

  return Object.freeze({
    dim,
    async embed(text: string): Promise<number[]> {
      if (disposed) throw new Error("Web embedder is disposed");
      validateText(text);
      // wllama's context is stateful. A failed request must not poison the queue.
      const result = pending.then(async () => {
        const loaded = await load();
        const response = await loaded.createEmbedding({ input: text, encoding_format: "float" });
        if (response.data.length !== 1 || response.data[0]?.index !== 0) {
          throw new Error("Expected one embedding for input index 0");
        }
        return normalizeEmbedding(response.data[0].embedding, dim);
      });
      pending = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    dispose(): Promise<void> {
      if (!disposal) {
        disposed = true;
        disposal = pending.then(async () => {
          await runtime?.exit();
          runtime = undefined;
        });
      }
      return disposal;
    },
  });
}

export function createNativeEmbedder(options: NativeEmbedderOptions): Embedder {
  const dim = resolveEmbedDimension(options.dim);
  const invoke = options.invoke;
  return Object.freeze({
    dim,
    async embed(text: string): Promise<number[]> {
      validateText(text);
      return normalizeEmbedding(
        await invoke<unknown>("plugin:lore-embed|lore_embed", { text, dim }),
        dim,
      );
    },
  });
}
