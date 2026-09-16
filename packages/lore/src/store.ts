// natally — LoreStore seam (ARCHITECTURE §8.4). Interface only: the later pysanky /
// 6dog graph-navigation UI reads the same graph without re-architecting.
// Implementations (adapters) live elsewhere; nothing here imports outside the package.
import type { ExportDocument, LoreKind, Turn } from "./types";

/**
 * One Tier-2 retrieval fragment (§8.3). Every fragment carries its `sourceTurnId`
 * back into the transcript — memory informs continuity, never new astrological
 * claims (§7.2 fence rule).
 */
export interface LoreFragment {
  readonly nodeId: string;
  readonly kind: LoreKind;
  readonly summary: string;
  /** Cosine similarity of the direct vector hit; 0 for graph-expansion-only hits. */
  readonly score: number;
  readonly sourceTurnId: string;
  /** 0 = direct vector hit; 1–2 = graph expansion hops (§8.3 hybrid retrieval). */
  readonly hops: 0 | 1 | 2;
}

/** Settings › Data summary line `[turns · nodes · runtime]` (§8.4). */
export interface LoreStats {
  readonly turns: number;
  readonly nodes: number;
  readonly edges: number;
  /** Storage/embedding runtime label, e.g. `wa-sqlite/OPFS` or `rusqlite`. */
  readonly runtime: string;
}

/**
 * The lore store seam (§8.4). Storage is client-side SQLite everywhere (§8.1:
 * rusqlite behind Tauri natively, wa-sqlite on OPFS in the browser) with the
 * sqlite-vec extension for embeddings — hence the async surface.
 */
export interface LoreStore {
  /**
   * Tier-2 hybrid retrieval (§8.3): top-k vector matches ∪ 2-hop neighbourhood,
   * budgeted to `budget` tokens, person-scoped unless the query is explicitly
   * general (`personId` undefined).
   *
   * `personId` is `string | undefined` rather than an optional parameter: the
   * contract fixes the argument order `(personId, q, k, budget)`, and TypeScript
   * forbids an optional parameter ahead of required ones.
   */
  query(
    personId: string | undefined,
    q: string,
    k: number,
    budget: number,
  ): Promise<LoreFragment[]>;

  /**
   * Write-every-turn (§8.3): append the turn together with its embedding. Node
   * extraction and the ≥ 0.92 cosine merge are the store's pipeline concern; edges
   * accumulate `weight` on merge.
   */
  upsertTurn(turn: Turn, embedding: number[]): Promise<void>;

  /** Export everything user-owned as one `ExportDocument` (§5, J8). */
  exportAll(): Promise<ExportDocument>;

  /** Delete everything including lore — real deletion, rows + vectors, not soft-hide (§8.4). */
  deleteAll(): Promise<void>;

  /** Settings › Data summary line (§8.4). */
  stats(): Promise<LoreStats>;
}
