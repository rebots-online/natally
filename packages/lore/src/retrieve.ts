// natally — Tier-2 hybrid retrieval orchestrator (L.4, ARCHITECTURE §8.3).
//
// `retrieve` is the thin composition the companion pipeline calls: embed the
// query through the host-injected embedder (§8.1 injection point), delegate the
// hybrid retrieval to the LoreStore seam (§8.4), and return fragments ordered
// by score, best first. The store adapters own the mechanics — cosine kNN over
// `vec_nodes` (sqlite-vec `MATCH` on the vec-on path, documented-untested
// there), 2-hop graph expansion from the matched node ids, the char/4 token
// budget estimate, and person scoping — so this module stays adapter-agnostic
// and pure: no SQL, no storage, no interpretation. INC-19: fragments carry
// provenance `sourceTurnId`s into the transcript; nothing here authors text.
import type { LoreFragment, LoreStore } from "./store";

/**
 * Structural contract for the injected query embedder (§8.1). Mirrors the
 * `Embedder` seam (`dim` + `embed`) so any production embedder satisfies it;
 * tests inject the deterministic hash embedder.
 */
export interface RetrievalEmbedder {
  readonly dim: number;
  embed(text: string): Promise<number[]>;
}

/** `retrieve` options (§8.3): person-scoped by default, general when omitted. */
export interface RetrieveOptions {
  /**
   * Person scope. Present ⇒ results restricted to that person's lore;
   * omitted ⇒ the explicitly-general query — cross-person results (§8.3).
   */
  readonly personId?: string;
  /** The natural-language query text. */
  readonly q: string;
  /** Vector kNN width (direct-hit cap). Default 8 (§8.3). */
  readonly k?: number;
  /** Token budget, enforced by the store's char/4 estimate. Default 1500 (§8.3). */
  readonly budgetTokens?: number;
}

/**
 * Hybrid retrieval (§8.3): embed → `store.query` → fragments ordered by score
 * desc. The expansion union (direct vector hits ∪ 1–2-hop graph neighbours)
 * happens inside the store adapter; `retrieve` guarantees the fragment
 * contract on top of it:
 *
 * - ordering: best score first (stable sort — adapters already return this
 *   order, so the guarantee holds regardless of adapter);
 * - budget: `budgetTokens` forwarded to the store's char/4 accumulator, which
 *   stops emission once the next fragment would overflow (farther fragments
 *   drop out first);
 * - scoping: `personId` forwarded as-is; `undefined` means the explicitly
 *   general query and returns cross-person results;
 * - honest absence: a query the embedder maps to the zero vector (no tokens)
 *   returns `[]` without touching storage.
 */
export async function retrieve(
  store: LoreStore,
  embedder: RetrievalEmbedder,
  options: RetrieveOptions,
): Promise<LoreFragment[]> {
  const k = options.k ?? 8;
  const budgetTokens = options.budgetTokens ?? 1500;

  // §8.1 injection point: the host-provided embedder turns the query into the
  // retrieval space. A zero vector means the query carried no tokens — there
  // is nothing to match, honestly absent.
  const queryVector = await embedder.embed(options.q);
  if (queryVector.every((component) => component === 0)) {
    return [];
  }

  // The store performs the hybrid kNN ∪ 2-hop work with the budget and
  // scoping applied; `retrieve` composes and normalizes the order.
  const fragments = await store.query(options.personId, options.q, k, budgetTokens);

  return [...fragments].sort((a, b) => b.score - a.score);
}
