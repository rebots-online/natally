// natally — L.2 verify: the Embedder seam (ARCHITECTURE §7.1, §8.1, §8.2, §13).
//
// Accept (verbatim): `embedder: dim honored, L2 norm 1.0 ±1e-6, src purity holds`.
// The describe title below IS the Accept line — vitest prints it in the run.
//
// Empty-input note: `embed("")` returns the ZERO vector — that is the
// documented contract (see embedder.ts module header; a zero vector cannot
// ground a kNN match, so an empty turn carries no lore weight). A zero vector
// is not unit-norm, so every norm assertion in this file is over NON-empty
// inputs; the empty contract is pinned separately.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createWllamaEmbedder, EmbedderError, type WllamaLike } from "../src/embed/embedder";
import { createHashEmbedder } from "./hash-embedder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function norm2(vector: readonly number[]): number {
  let sum = 0;
  for (const component of vector) sum += component * component;
  return Math.sqrt(sum);
}

interface FakeWllama {
  wllama: WllamaLike;
  loadCalls(): number;
  embedCalls(): number;
}

/** Structural fake of the injected handle: counts loads, serves a canned raw vector. */
function makeFakeWllama(raw: (text: string) => number[]): FakeWllama {
  let loads = 0;
  let embeds = 0;
  const wllama: WllamaLike = {
    async loadModel(): Promise<void> {
      loads += 1;
    },
    async createEmbedding(text: string): Promise<number[]> {
      embeds += 1;
      return raw(text);
    },
  };
  return { wllama, loadCalls: () => loads, embedCalls: () => embeds };
}

// ---------------------------------------------------------------------------
// Accept line as describe title (printed by the runner)
// ---------------------------------------------------------------------------

describe("embedder: dim honored, L2 norm 1.0 ±1e-6, src purity holds", () => {
  const NON_EMPTY_INPUTS = [
    "Mars rules the ascendant tonight",
    "2001-07-21 eclipse over Lisbon, thread #12",
    "¡Héllo, 世界! café — she said 14° Aries rising",
    "a",
  ];

  it("dim honored — output length is exactly the configured dim (hash embedder, dim 7 and 384)", async () => {
    const small = createHashEmbedder({ dim: 7 });
    const prod = createHashEmbedder({ dim: 384 });
    await expect(small.embed("the moon rises over the harbor")).resolves.toHaveLength(7);
    await expect(prod.embed("the moon rises over the harbor")).resolves.toHaveLength(384);
    expect(small.dim).toBe(7);
    expect(prod.dim).toBe(384);
  });

  it("dim honored — production wllama embedder returns the configured dim", async () => {
    const fake = makeFakeWllama(() => [3, 1, 2]);
    const embedder = createWllamaEmbedder({ wllama: fake.wllama, modelUrl: "gguf://test", dim: 3 });
    await expect(embedder.embed("saturn return")).resolves.toHaveLength(3);
    expect(fake.embedCalls()).toBe(1);
  });

  it("L2 norm 1.0 ±1e-6 for several non-empty inputs (hash embedder)", async () => {
    const embedder = createHashEmbedder({ dim: 384 });
    for (const text of NON_EMPTY_INPUTS) {
      const vector = await embedder.embed(text);
      expect(vector).toHaveLength(384);
      expect(Math.abs(norm2(vector) - 1.0)).toBeLessThanOrEqual(1e-6);
    }
  });

  it("L2 norm 1.0 ±1e-6 — production wllama embedder normalizes raw backend output", async () => {
    // Raw vector [3, 4] has norm 5; the seam must return [0.6, 0.8].
    const fake = makeFakeWllama((text) => (text === "big" ? [3, 4] : [0, 0]));
    const embedder = createWllamaEmbedder({ wllama: fake.wllama, modelUrl: "gguf://test", dim: 2 });
    await expect(embedder.embed("big")).resolves.toEqual([0.6, 0.8]);
    const normalized = await embedder.embed("big");
    expect(Math.abs(norm2(normalized) - 1.0)).toBeLessThanOrEqual(1e-6);
    // All-zero raw backend output stays a zero vector (no NaN laundering).
    await expect(embedder.embed("empty")).resolves.toEqual([0, 0]);
  });

  it("empty input returns the zero vector — contractual, documented (norm test above uses non-empty inputs only)", async () => {
    const hash = createHashEmbedder({ dim: 8 });
    const fake = makeFakeWllama(() => [1, 1]);
    const wllama = createWllamaEmbedder({ wllama: fake.wllama, modelUrl: "gguf://test", dim: 8 });
    await expect(hash.embed("")).resolves.toEqual(new Array<number>(8).fill(0));
    await expect(hash.embed("   —  !!! ")).resolves.toEqual(new Array<number>(8).fill(0));
    await expect(wllama.embed("")).resolves.toEqual(new Array<number>(8).fill(0));
    // Pinned zero, not one: the empty contract IS the zero vector.
    expect(norm2(await wllama.embed(""))).toBe(0);
    // And it short-circuits: no model load, no backend call for empty input.
    expect(fake.loadCalls()).toBe(0);
    expect(fake.embedCalls()).toBe(0);
  });

  it("deterministic — same input ⇒ same vector; different tokens ⇒ different vectors (hash embedder)", async () => {
    const embedder = createHashEmbedder({ dim: 64 });
    const a1 = await embedder.embed("Venus in the seventh house");
    const a2 = await embedder.embed("Venus in the seventh house");
    expect(a1).toEqual(a2);
    const moon = await embedder.embed("moon");
    const sun = await embedder.embed("sun");
    expect(moon).not.toEqual(sun);
    expect(await embedder.embed("moonlight")).not.toEqual(moon);
    // A pure count-weighted bag-of-words is linear in counts, and L2
    // normalization erases magnitude: duplicating a token ("moon moon") scales
    // the vector uniformly, so the normalized direction is unchanged. That is
    // contract-correct (counts only shift a vector relative to OTHER tokens);
    // assert it explicitly instead of expecting a fake difference.
    expect(await embedder.embed("moon moon")).toEqual(moon);
    expect(await embedder.embed("moon sun")).not.toEqual(moon);
  });

  it("lazy model load — loadModel fires once, on first non-empty embed; concurrent embeds share the load", async () => {
    const fake = makeFakeWllama(() => [2, 2]);
    const embedder = createWllamaEmbedder({ wllama: fake.wllama, modelUrl: "gguf://test", dim: 2 });
    expect(fake.loadCalls()).toBe(0); // nothing loaded at construction
    await embedder.embed("first");
    expect(fake.loadCalls()).toBe(1);
    await embedder.embed("second");
    expect(fake.loadCalls()).toBe(1); // still one load across embeds
    await Promise.all([embedder.embed("a"), embedder.embed("b")]);
    expect(fake.loadCalls()).toBe(1); // concurrent embeds share the in-flight load
    expect(fake.embedCalls()).toBe(4);
  });

  it("backend dim mismatch rejects with typed EmbedderError('dim-mismatch')", async () => {
    const fake = makeFakeWllama(() => [1, 2, 3]); // n_embd 3, configured dim 2
    const embedder = createWllamaEmbedder({ wllama: fake.wllama, modelUrl: "gguf://test", dim: 2 });
    await expect(embedder.embed("too many dims")).rejects.toBeInstanceOf(EmbedderError);
    await expect(embedder.embed("too many dims")).rejects.toMatchObject({ code: "dim-mismatch" });
  });

  it("invalid configured dim rejects construction with typed EmbedderError('dim-invalid')", () => {
    const fake = makeFakeWllama(() => [1]);
    expect(() =>
      createWllamaEmbedder({ wllama: fake.wllama, modelUrl: "gguf://test", dim: 0 }),
    ).toThrow(EmbedderError);
    expect(() =>
      createWllamaEmbedder({ wllama: fake.wllama, modelUrl: "gguf://test", dim: 2.5 }),
    ).toThrow(EmbedderError);
    expect(() => createHashEmbedder({ dim: -4 })).toThrow(EmbedderError);
  });

  it("src purity holds — the import specifier 'tests/hash-embedder' appears in zero src/ files repo-wide", () => {
    // Repo root: packages/lore/tests/<this file> → three levels up.
    const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const forbidden = "tests/hash-embedder";
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git")
          continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else {
          const contents = readFileSync(path, "utf8");
          if (contents.includes(forbidden)) offenders.push(path);
        }
      }
    };

    const srcRoots = [join(repoRoot, "packages"), join(repoRoot, "apps")];
    for (const root of srcRoots) {
      if (!existsSync(root)) continue;
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const srcDir = join(root, entry.name, "src");
        if (existsSync(srcDir)) walk(srcDir);
      }
    }

    expect(offenders).toEqual([]);
  });
});
