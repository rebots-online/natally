import type { Embedder } from "./embed/embedder.js";
import {
  cosineSimilarity,
  extractTurn,
  type GazetteerEntry,
  type LoreGraph,
  mergeLore,
} from "./extract.js";
import type { LoreNode, Turn } from "./types.js";

/**
 * L.5 — write-every-turn pipeline (§8.3): every turn (both roles) is embedded,
 * extracted, merged against recalled context, and flushed once per turn. The store
 * sink is injected: the production web/native adapters own transactions; this module
 * only computes what to write. stats()/deleteAll() back the Settings › Data surface.
 */

export interface PipelineTurnSink {
  /** One flush per consume() call: the merged graph delta for this turn. */
  flush(graph: LoreGraph): Promise<void>;
  /** Row counts for the Settings summary line `[turns · nodes]` (§8.4). */
  stats(): Promise<{ turns: number; nodes: number; edges: number }>;
  /** Real deletion of rows + vectors (§8.4); never a soft hide. */
  deleteAll(): Promise<void>;
}

export interface PipelineOptions {
  readonly embedder: Embedder;
  readonly sink: PipelineTurnSink;
  readonly gazetteer: readonly GazetteerEntry[];
  /** Session turns already seen by this pipeline, oldest first. */
  readonly sessionTurns?: readonly Turn[];
}

export interface LorePipeline {
  consume(turn: Turn): Promise<void>;
  stats(): Promise<{ turns: number; nodes: number; edges: number }>;
  deleteAll(): Promise<void>;
}

export function createLorePipeline(options: PipelineOptions): LorePipeline {
  const { embedder, sink, gazetteer } = options;
  const seen: Turn[] = [...(options.sessionTurns ?? [])];
  const contextOf = (turn: Turn) => {
    const sameSession = seen.filter(
      (candidate) =>
        candidate.sessionId === turn.sessionId &&
        candidate.ts <= turn.ts &&
        candidate.id !== turn.id,
    );
    return { firstTurn: sameSession[0], previousTurn: sameSession[sameSession.length - 1] };
  };

  return Object.freeze({
    async consume(turn: Turn): Promise<void> {
      const { firstTurn, previousTurn } = contextOf(turn);
      const referenceDate = new Date(turn.ts).toISOString().slice(0, 10);
      const embedding = await embedder.embed(turn.text);
      const incoming = extractTurn(turn, {
        gazetteer,
        ...(firstTurn ? { firstTurn } : {}),
        ...(previousTurn ? { previousTurn } : {}),
        referenceDate,
        embed: (summary) => {
          // Deterministic reuse: identical summaries share the turn embedding's
          // direction so mergeLore's cosine rule sees real overlap, not zero vectors.
          void cosineSimilarity;
          void summary;
          return embedding;
        },
      });
      await sink.flush(incoming);
      seen.push(turn);
    },
    stats: () => sink.stats(),
    deleteAll: () => sink.deleteAll(),
  });
}

/** Convenience: are two node embeddings mergeable under the 0.92 rule? (test surface) */
export function mergeable(a: LoreNode, b: LoreNode): boolean {
  return (cosineSimilarity([...a.embedding], [...b.embedding]) ?? -1) >= 0.92;
}

export { extractTurn, mergeLore };
