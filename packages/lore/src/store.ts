import type { LoreEdge, LoreNode, Turn } from "./types.js";

/** Platform-independent boundary; implementations own persistence and retrieval. */
export interface LoreStore {
  /** Pass undefined for personId when recalling across all people. */
  query(
    personId: string | undefined,
    q: string,
    k: number,
    budget: number,
  ): Promise<{ nodes: LoreNode[]; edges: LoreEdge[] }>;

  upsertTurn(turn: Turn, embedding: number[]): Promise<void>;

  /** Exports the complete graph for ExportDocument.loreNodes/loreEdges. */
  exportAll(): Promise<{ nodes: LoreNode[]; edges: LoreEdge[] }>;

  /** Removes persisted lore rows and vectors. */
  deleteAll(): Promise<void>;

  stats(): Promise<{ turns: number; nodes: number; edges: number }>;
}
