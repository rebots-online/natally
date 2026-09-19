import type { Embedder } from "./embed/embedder.js";
import { cosineSimilarity, extractTurn, type GazetteerEntry } from "./extract.js";
import type { LoreStore } from "./store.js";
import type { LoreEdge, LoreNode, Turn } from "./types.js";

/**
 * L.4 — hybrid retrieval for the fence's Tier 2 (§7.2/§8.3): vector kNN over node
 * summaries ∪ 2-hop graph expansion from the matched ids, person-scoped unless the
 * query is explicitly general, budgeted by a char/4 token estimate. Every fragment
 * carries its sourceTurnId so memory never becomes an unsourced astrological claim.
 */

export interface RetrievedFragment {
  readonly summary: string;
  readonly sourceTurnId: string;
  readonly score: number;
}

export interface RetrieveQuery {
  readonly personId?: string;
  readonly q: string;
  readonly k?: number;
  readonly budgetTokens?: number;
  /** Explicitly cross-person recall ("what do you know about…"). */
  readonly general?: boolean;
}

/** Ordered, deduplicated, budget-respecting fragment list. */
export function assembleFragments(
  matches: readonly { node: LoreNode; score: number }[],
  budgetTokens: number,
): readonly RetrievedFragment[] {
  const fragments: RetrievedFragment[] = [];
  const seenNodes = new Set<string>();
  let remaining = budgetTokens;
  for (const { node, score } of matches) {
    if (remaining <= 0) break;
    const cost = Math.ceil(node.summary.length / 4);
    if (cost > remaining && fragments.length > 0) continue;
    if (seenNodes.has(node.id)) continue;
    seenNodes.add(node.id);
    fragments.push({ summary: node.summary, sourceTurnId: sourceOf(node), score });
    remaining -= cost;
  }
  return Object.freeze(fragments);
}

/** Edges record provenance; nodes carry their best source turn via refs order. */
function sourceOf(node: LoreNode): string {
  const ref = node.refs.find((ref) => ref.startsWith("turn:"));
  return ref ? ref.slice("turn:".length) : (node.refs[0] ?? node.id);
}

/** 2-hop expansion from seed ids over the edge list, excluding the seeds themselves. */
export function twoHopNeighbourhood(
  seedIds: readonly string[],
  edges: readonly LoreEdge[],
): ReadonlySet<string> {
  const seeds = new Set(seedIds);
  const firstHop = new Set<string>();
  for (const edge of edges) {
    if (seeds.has(edge.from) && !seeds.has(edge.to)) firstHop.add(edge.to);
    if (seeds.has(edge.to) && !seeds.has(edge.from)) firstHop.add(edge.from);
  }
  const secondHop = new Set<string>();
  for (const edge of edges) {
    if (firstHop.has(edge.from) && !seeds.has(edge.to) && !firstHop.has(edge.to))
      secondHop.add(edge.to);
    if (firstHop.has(edge.to) && !seeds.has(edge.from) && !firstHop.has(edge.from))
      secondHop.add(edge.from);
  }
  return new Set([...firstHop, ...secondHop]);
}

export async function retrieve(
  store: LoreStore,
  embedder: Embedder,
  query: RetrieveQuery,
): Promise<readonly RetrievedFragment[]> {
  const k = query.k ?? 8;
  const budgetTokens = query.budgetTokens ?? 1500;
  const trimmed = query.q.trim();
  if (!trimmed) return Object.freeze([]);
  const personId = query.general ? undefined : query.personId;
  const { nodes, edges } = await store.query(personId, trimmed, k, budgetTokens);
  if (nodes.length === 0) return Object.freeze([]);

  const probe = await embedder.embed(trimmed);
  const ranked: { node: LoreNode; score: number }[] = [];
  for (const candidate of nodes) {
    const score = cosineSimilarity(probe, [...candidate.embedding]);
    if (score !== undefined) ranked.push({ node: candidate, score });
  }
  ranked.sort((left, right) => right.score - left.score);
  const top = ranked.slice(0, k);

  // Vector matches seed the graph expansion; expanded nodes ride along at their
  // adjacency-derived score (just under the weakest vector match), never above it.
  const neighbourhood = twoHopNeighbourhood(
    top.map((entry) => entry.node.id),
    edges,
  );
  const last = top[top.length - 1];
  const floor = last ? (last.score ?? 0) : 0;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const expanded: { node: LoreNode; score: number }[] = [];
  for (const id of neighbourhood) {
    const node = byId.get(id);
    if (node) expanded.push({ node, score: Math.max(0, floor - 0.01) });
  }
  const merged = [...top, ...expanded].sort(
    (left, right) => (right.score ?? -1) - (left.score ?? -1),
  );
  return assembleFragments(merged, budgetTokens);
}

/** L.3 extraction is deterministic; the pipeline exposes the gazetteer it uses. */
export function gazetteerOf(entries: readonly GazetteerEntry[]): readonly GazetteerEntry[] {
  return entries;
}

/** Shared by L.5: the turn that context extraction needs (same session, earlier). */
export interface TurnContext {
  readonly firstTurn?: Turn;
  readonly previousTurn?: Turn;
}

export function contextTurnsOf(sessionTurns: readonly Turn[], turn: Turn): TurnContext {
  const sameSession = sessionTurns.filter(
    (candidate) =>
      candidate.sessionId === turn.sessionId && candidate.ts <= turn.ts && candidate.id !== turn.id,
  );
  const context: { firstTurn?: Turn; previousTurn?: Turn } = {};
  const first = sameSession[0];
  const previous = sameSession[sameSession.length - 1];
  if (first) context.firstTurn = first;
  if (previous) context.previousTurn = previous;
  return context;
}

export { extractTurn };
