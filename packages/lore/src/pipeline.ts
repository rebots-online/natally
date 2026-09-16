// natally — L.5 write-every-turn lore pipeline (ARCHITECTURE §8.3 pipeline,
// §8.4 boundaries; TEST_RUBRIC §TR-4).
//
// Flow per turn: embed the turn text ONCE (L.2 seam) → deterministic
// extraction + ≥ 0.92 same-kind merge (L.3 `extractFromTurn`, fed existing
// nodes read from the store and precomputed per-candidate summary embeddings)
// → ONE batched flush (turn upsert + lore node/edge writes, insert-only SQL
// inside exactly one transaction). §8.3: both roles write; retrieval is never
// blocked here — this module only writes.
//
// Flush seam ruling (recorded): the L.1 `LoreStore` interface has no
// transactional batch entry, and this task must not edit L.1's files. The
// structural batch seam is therefore owned HERE (`LorePipelineStore`): store
// adapters implement `flushTurn` over the same opened `SqliteDb` seam
// (ddl.ts) that backs their `LoreStore`. The `flushTurn` contract is
// normative: ALL writes are INSERT statements (conflict-resolution clauses
// only — no UPDATE/DELETE anywhere on the flush path, TR-4 "insert-only"),
// executed inside exactly ONE transaction, without calling any other store
// method. Re-flushing the same turn fails loudly on the `turns` primary key —
// a turn is consumed once.
//
// Embedding law: the turn text is embedded exactly once per consume; node
// vectors are per-node embeds of the node summary (extract.ts never
// fabricates vectors — the pipeline supplies them). Candidate discovery and
// merge resolution are the same pure L.3 function run twice over identical
// inputs: pass 1 (no embeddings) enumerates the deterministic candidate set,
// pass 2 re-runs with the candidate embeddings so the cosine merge can
// resolve. Deterministic by construction (extract.ts purity).
//
// INC-19: this module computes no interpretations — it persists extraction
// evidence only. `stats()` and `deleteAll()` delegate to the store (§8.4:
// Settings › Data summary line; real deletion of rows + vectors).
import type { Embedder } from "./embed/embedder";
import { type ExtractionResult, extractFromTurn } from "./extract";
import type { LoreStats, LoreStore } from "./store";
import type { LoreEdge, LoreNode, Turn } from "./types";

/** The lore half of one flush: nodes and edges extracted for the turn. */
export interface LoreFlush {
  readonly nodes: readonly LoreNode[];
  readonly edges: readonly LoreEdge[];
}

/**
 * Structural extension of `LoreStore` with the transactional batch entry the
 * pipeline flushes through (§8.3: single flush per turn). See the module
 * header for the ruling and the normative `flushTurn` contract.
 */
export interface LorePipelineStore extends LoreStore {
  /**
   * The ONE flush for `turn`: session guard row, turn row, the `turn:<id>`
   * evidence-anchor node, and the extraction `lore` nodes/edges — insert-only
   * SQL, one transaction, no other store calls.
   */
  flushTurn(turn: Turn, embedding: readonly number[], lore: LoreFlush): Promise<void>;
}

export interface LorePipelineOptions {
  /** The store the pipeline flushes through (see `LorePipelineStore`). */
  readonly store: LorePipelineStore;
  /** Embedding seam (§8.1: host-injected model, never bundled). */
  readonly embedder: Embedder;
  /** Place-name gazetteer (G.1 glossary export), injected — never imported. */
  readonly gazetteer: ReadonlySet<string>;
  /** First-turn topic words (kind "thread"); the caller derives them with `topicWords`. */
  readonly threadSeedWords?: readonly string[];
}

export interface LorePipeline {
  /**
   * Write-every-turn (§8.3): embed, extract/merge against the persisted graph,
   * flush once. Resolves with the turn's extraction result (merged node ids,
   * absolute-turn edge weights, merge records) — nothing about the turn's
   * lore work is hidden.
   */
  consume(turn: Turn): Promise<ExtractionResult>;
  /** Settings › Data summary counts (§8.4), from the store. */
  stats(): Promise<LoreStats>;
  /** Real deletion — rows + vectors (§8.4), from the store. */
  deleteAll(): Promise<void>;
}

/** Embed each candidate summary once, keyed by candidate id. */
async function embedNodeSummaries(
  embedder: Embedder,
  nodes: readonly LoreNode[],
): Promise<ReadonlyMap<string, readonly number[]>> {
  const embeddings = new Map<string, readonly number[]>();
  for (const node of nodes) {
    embeddings.set(node.id, await embedder.embed(node.summary));
  }
  return embeddings;
}

export function createLorePipeline(options: LorePipelineOptions): LorePipeline {
  const { store, embedder, gazetteer, threadSeedWords } = options;

  return {
    async consume(turn: Turn): Promise<ExtractionResult> {
      // The turn text is embedded exactly ONCE (§8.3); it anchors the
      // `turn:<id>` evidence node in the flush.
      const turnEmbedding = await embedder.embed(turn.text);

      // Merge against the PERSISTED graph: existing nodes are read from the
      // store every turn — merge state survives restarts, never lives in
      // pipeline memory.
      const existing = (await store.exportAll()).loreNodes;

      // Pass 1 discovers the deterministic candidate set (no embeddings ⇒ no
      // merges); pass 2 resolves the ≥ 0.92 cosine merge with the candidate
      // summary embeddings. Same pure function, identical inputs.
      const candidates = extractFromTurn(turn, { gazetteer, existing, threadSeedWords });
      const embeddings = await embedNodeSummaries(embedder, candidates.nodes);
      const result = extractFromTurn(turn, { gazetteer, existing, threadSeedWords, embeddings });

      // The single flush per turn (TR-4): turn upsert + node/edge writes in
      // ONE transactional batch entry.
      await store.flushTurn(turn, turnEmbedding, { nodes: result.nodes, edges: result.edges });

      return result;
    },

    stats(): Promise<LoreStats> {
      return store.stats();
    },

    deleteAll(): Promise<void> {
      return store.deleteAll();
    },
  };
}
