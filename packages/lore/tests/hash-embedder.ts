// natally — deterministic TEST embedder (L.2). TESTS + M.1 catalogue bootstrap ONLY.
//
// IMPLEMENTATION IS PRODUCTION-PROHIBITED: this module is hashing bag-of-words,
// not a learned model. It exists so tests (and only M.1's catalogue bootstrap)
// get a real, stable, dependency-free embedding that honors the `Embedder`
// contract (same dim, same L2-normalization, same empty-input zero vector).
// The purity test in `embed.test.ts` fails the suite if the import specifier
// `tests/hash-embedder` ever appears in a `src/` file anywhere in the repo —
// production paths must use `createWllamaEmbedder` (or the native bridge), never
// this.
//
// Determinism contract: same input string ⇒ byte-identical vector; different
// token multisets ⇒ (with overwhelming probability, by construction) different
// vectors; output length is exactly `dim`; non-empty inputs are L2-normalized.
import type { Embedder } from "../src/embed/embedder";
import { EmbedderError, l2Normalize } from "../src/embed/embedder";

/** Fixed global projection seed. Any constant works; it only has to never change. */
const DEFAULT_SEED = 0x4e41544c; // "NATL"

/** FNV-1a 32-bit over UTF-16 code units, mixed with a global seed, avalanche-finalized. */
function hashToken(token: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // fmix32 finalizer: spreads nearby strings across the 32-bit space.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 — tiny fully deterministic PRNG (no Math.random anywhere). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unicode-aware word tokens: letters+digits runs, lowercased. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export interface HashEmbedderOptions {
  /** Vector dimension; must be a positive integer (same floor as production). */
  dim: number;
  /** Optional global seed override; defaults to the fixed DEFAULT_SEED. */
  seed?: number;
}

/**
 * Deterministic hashing bag-of-words embedder.
 *
 * Algorithm: tokenize → word counts (bag-of-words) → for each token, a seeded
 * PRNG (seeded by hash(token, seed)) generates one deterministic pseudo-random
 * projection row in `dim` dimensions; rows are accumulated weighted by token
 * count; the sum is L2-normalized. No Math.random, no clocks, no env — pure
 * function of (text, dim, seed).
 */
export function createHashEmbedder(options: HashEmbedderOptions): Embedder {
  const { dim } = options;
  const seed = options.seed ?? DEFAULT_SEED;
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new EmbedderError(
      "dim-invalid",
      `hash embedder dim must be a positive integer, got ${String(dim)}`,
    );
  }

  return {
    dim,
    embed(text: string): Promise<number[]> {
      // Contractual empty-input rule (embedder.ts module header): zero vector.
      const tokens = tokenize(text);
      if (tokens.length === 0) return Promise.resolve(new Array<number>(dim).fill(0));

      const bagOfWords = new Map<string, number>();
      for (const token of tokens) {
        bagOfWords.set(token, (bagOfWords.get(token) ?? 0) + 1);
      }

      const out = new Array<number>(dim).fill(0);
      for (const [token, count] of bagOfWords) {
        const projection = mulberry32(hashToken(token, seed));
        for (let i = 0; i < dim; i += 1) {
          // PRNG ∈ [0,1) → pseudo-random projection row in [-1, 1).
          out[i] = (out[i] ?? 0) + count * (projection() * 2 - 1);
        }
      }
      return Promise.resolve(l2Normalize(out));
    },
  };
}
