// natally — Lore embedding seam (ARCHITECTURE §7.1, §8.1, §8.2, §13).
//
// The `Embedder` interface is the single seam every lore-pipeline call site
// (§8.3 write-every-turn, §7.2 Tier-2 retrieval) depends on. The production
// implementation runs the mirror's embedder GGUF (§13, kind "embedder"):
//   - web leg (PWA): wllama, onnxruntime-web-backed, in-browser;
//   - native legs: llama.cpp behind the Tauri bridge (see native.rs).
// Both lanes arrive here through one injected, structurally-typed handle, so
// this module has zero dependencies outside the package.
//
// Contract (normative for all implementations):
//   - `dim` is fixed by configuration (`VITE_LORE_EMBED_DIM`, §8.1, default
//     384); every non-empty input embeds to exactly `dim` components.
//   - Output is L2-normalized (‖v‖₂ = 1.0 ±1e-6) for non-empty inputs.
//   - Empty input returns the zero vector. This is contractually allowed: a
//     zero vector cannot ground a kNN match (§8.3), so an empty turn carries
//     no lore weight instead of a fabricated direction. Unit-norm guarantees
//     therefore apply to non-empty inputs only.
//
// The deterministic TEST embedder lives under the lore package's tests
// directory (never in src/). It is for tests and M.1's catalogue bootstrap
// only. Its import specifier appearing in any `src/` file anywhere in the
// repo fails the purity test in `packages/lore/tests/embed.test.ts` —
// production paths must use `createWllamaEmbedder` (or the native bridge),
// never the test embedder.

/** Typed failure surface of the embedding seam. */
export type EmbedderErrorCode =
  /** Configured dim is not a positive integer. */
  | "dim-invalid"
  /** Backend returned a vector whose length differs from the configured dim. */
  | "dim-mismatch"
  /** Model load (loadModel) rejected or was otherwise unusable. */
  | "load-failed"
  /** Backend embed call rejected, or returned non-finite components. */
  | "embed-failed";

export class EmbedderError extends Error {
  readonly code: EmbedderErrorCode;
  readonly cause: unknown;

  constructor(code: EmbedderErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "EmbedderError";
    this.code = code;
    this.cause = cause;
  }
}

/** The embedding seam. Satisfied by the production wllama embedder and (test/bootstrap only) the hash embedder. */
export interface Embedder {
  /** Fixed vector dimension; comes from config (`VITE_LORE_EMBED_DIM`, §8.1). */
  readonly dim: number;
  /**
   * Embed `text` into an L2-normalized `dim`-vector.
   * Empty input returns the zero vector (contractual — see module header).
   */
  embed(text: string): Promise<number[]>;
}

/**
 * Minimal structural view of a wllama handle (web leg). Deliberately small:
 * only the two operations this seam actually uses, no documented-API coupling,
 * so the app leg can pin whatever wllama version it carries and adapt it here.
 * The native legs adapt their llama.cpp bridge to this same shape.
 */
export interface WllamaLike {
  /**
   * Resolves once the embedder GGUF at `url` (§13 mirror asset, sha256-verified
   * at download) is resident for inference. This seam calls it at most once per
   * embedder instance (lazy, on first non-empty embed); failures are retried on
   * the next embed.
   */
  loadModel(url: string, config?: Record<string, unknown>): Promise<void>;
  /**
   * Returns the RAW (unnormalized) embedding of `text`. The component count is
   * whatever the loaded model's n_embd is; this seam normalizes and dims-checks.
   */
  createEmbedding(text: string): Promise<number[]>;
}

export interface WllamaEmbedderOptions {
  /** Injected handle (structural `WllamaLike`), owned by the calling leg. */
  wllama: WllamaLike;
  /** Embedder GGUF location: mirror URL or platform-cache URL (§13). */
  modelUrl: string;
  /** Target dimension, from config (`VITE_LORE_EMBED_DIM`, §8.1, default 384). */
  dim: number;
}

/**
 * Normalize a vector to unit L2 length, returning a fresh array.
 * Zero vectors pass through as zeros (no NaN); non-finite components are a
 * hard `EmbedderError` ("embed-failed") — a broken backend must never be
 * silently laundered into "normalized" output.
 */
export function l2Normalize(vector: readonly number[]): number[] {
  let sumSquares = 0;
  for (const component of vector) {
    if (!Number.isFinite(component)) {
      throw new EmbedderError(
        "embed-failed",
        "embedding contains a non-finite component; refusing to normalize",
      );
    }
    sumSquares += component * component;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return vector.map(() => 0);
  return vector.map((component) => component / norm);
}

/**
 * Production embedder (both legs via their injected handles): lazy single-shot
 * model load on the first non-empty embed, backend output L2-normalized at the
 * seam, dim mismatch surfaced as a typed `EmbedderError`.
 */
export function createWllamaEmbedder(options: WllamaEmbedderOptions): Embedder {
  const { wllama, modelUrl, dim } = options;
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new EmbedderError(
      "dim-invalid",
      `configured embed dim must be a positive integer, got ${String(dim)}`,
    );
  }

  // Lazy load: at most one in-flight load; a failed load clears the slot so the
  // next embed retries instead of caching the failure forever.
  let loadPromise: Promise<void> | null = null;
  const ensureModel = (): Promise<void> => {
    loadPromise ??= wllama.loadModel(modelUrl).catch((cause: unknown) => {
      loadPromise = null;
      throw new EmbedderError(
        "load-failed",
        `failed to load embedder model from ${modelUrl}`,
        cause,
      );
    });
    return loadPromise;
  };

  return {
    dim,
    embed(text: string): Promise<number[]> {
      // Contractual short-circuit: empty input ⇒ zero vector, no model load
      // (a zero vector is a valid, matchless lore direction — see module header).
      if (text.length === 0) return Promise.resolve(new Array<number>(dim).fill(0));
      return ensureModel()
        .then(() => wllama.createEmbedding(text))
        .then((raw) => {
          if (raw.length !== dim) {
            throw new EmbedderError(
              "dim-mismatch",
              `backend embedding has length ${String(raw.length)}, configured dim is ${String(dim)}`,
            );
          }
          return l2Normalize(raw);
        });
    },
  };
}
