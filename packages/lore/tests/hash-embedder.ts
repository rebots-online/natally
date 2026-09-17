import type { Embedder } from "../src/embed/embedder.js";

/** Test/M.1 bootstrap fixture only. These vectors are not semantic model output. */
export function createHashEmbedder(dim = 384): Embedder {
  if (!Number.isSafeInteger(dim) || dim < 1 || dim > 2_147_483_647) {
    throw new RangeError("Hash embedding dimension must be a positive 32-bit integer");
  }
  return Object.freeze({
    dim,
    async embed(text: string): Promise<number[]> {
      const words =
        text
          .normalize("NFKC")
          .toLowerCase()
          .match(/[\p{L}\p{N}]+/gu) ?? [];
      const counts = new Map<string, number>();
      for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
      // The empty document gets a deterministic unit vector too.
      if (counts.size === 0) counts.set("\0empty", 1);
      const vector = Array<number>(dim).fill(0);
      // Sort before accumulation so bag order cannot change floating-point sums.
      for (const [word, count] of [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        let seed = 0x811c9dc5;
        for (const byte of new TextEncoder().encode(word)) {
          seed = Math.imul(seed ^ byte, 0x01000193) >>> 0;
        }
        // Project each hashed bag feature into every output coordinate.
        for (let i = 0; i < dim; i += 1) {
          let hash = (seed + Math.imul(i + 1, 0x9e3779b9)) >>> 0;
          hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
          hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
          hash = (hash ^ (hash >>> 16)) >>> 0;
          vector[i] = (vector[i] ?? 0) + count * (hash / 0x80000000 - 1);
        }
      }
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      // Degenerate projection/cancellation remains defined even for dim=1.
      if (norm === 0) {
        vector[0] = 1;
        return vector;
      }
      return vector.map((value) => value / norm);
    },
  });
}
