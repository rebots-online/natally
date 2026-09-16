// natally — native LoreStore adapter shell (ARCHITECTURE §8.1).
//
// The package cannot import Tauri (dependency-rule rescue, architect ruling):
// this adapter is a thin JSON-RPC-style shell over an INJECTED invoke function.
// The app capability layer (I.3) supplies
//
//   invoke: (cmd: string, payload: unknown) => Promise<unknown>
//
// backed by Tauri `invoke` against the commands in
// `apps/local/src-tauri/src/lore_commands.rs` (rusqlite). The wire contract —
// command names, camelCase payload keys, response shapes — is the ONLY coupling
// with the Rust side; every response is validated with the package's zod
// contracts before it is returned (INC-19: nothing unvalidated crosses in).
import { z } from "zod";
import type { LoreFragment, LoreStats, LoreStore } from "../store";
import { type ExportDocument, ExportDocumentSchema, LoreKindSchema, type Turn } from "../types";
import type { EmbedFn } from "./common";

/** The injected native invoke (wired by I.3 to Tauri `invoke`). */
export type NativeInvoke = (cmd: string, payload: unknown) => Promise<unknown>;

export interface NativeLoreStoreOptions {
  /**
   * Query embedder — the shell embeds the query text locally and ships the
   * vector to the Rust side (which scores cosine over the stored BLOBs).
   * Absent ⇒ `query()` throws (honest absence); the other commands work.
   */
  readonly embed?: EmbedFn;
}

// ---------------------------------------------------------------------------
// Wire contract (must stay in lockstep with lore_commands.rs)
// ---------------------------------------------------------------------------

const OkSchema = z.object({ ok: z.boolean() });

const FragmentSchema = z.object({
  nodeId: z.string().min(1),
  kind: LoreKindSchema,
  summary: z.string(),
  /** Cosine of the direct vector hit; 0 for graph-expansion-only hits (§8.3). */
  score: z.number(),
  sourceTurnId: z.string().min(1),
  hops: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

const StatsSchema = z.object({
  turns: z.number().int().nonnegative(),
  nodes: z.number().int().nonnegative(),
  edges: z.number().int().nonnegative(),
  runtime: z.string().min(1),
});

async function invokeOk(invoke: NativeInvoke, cmd: string, payload: unknown): Promise<void> {
  const raw: unknown = await invoke(cmd, payload);
  const parsed = OkSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`lore store: ${cmd} returned an unexpected response`);
  }
}

/**
 * Build the native `LoreStore`. `query` needs `options.embed`; every other
 * command is pure storage and works without an embedder.
 */
export function createNativeLoreStore(
  invoke: NativeInvoke,
  options: NativeLoreStoreOptions = {},
): LoreStore {
  async function embedQuery(q: string): Promise<number[]> {
    const embed = options.embed;
    if (!embed) {
      throw new Error(
        "lore store: no embedder configured — query() needs the host-injected embedding model (ARCHITECTURE §8.1)",
      );
    }
    return [...(await embed(q))];
  }

  return {
    async upsertTurn(turn: Turn, embedding: number[]): Promise<void> {
      if (embedding.length === 0) {
        throw new Error("lore store: upsertTurn needs a non-empty embedding");
      }
      await invokeOk(invoke, "lore_upsert_turn", { turn, embedding });
    },

    async query(
      personId: string | undefined,
      q: string,
      k: number,
      budget: number,
    ): Promise<LoreFragment[]> {
      const embed = await embedQuery(q);
      const raw: unknown = await invoke("lore_query", {
        personId: personId ?? null,
        q,
        k,
        budget,
        embed,
      });
      if (!Array.isArray(raw)) {
        throw new Error("lore store: lore_query returned a non-array response");
      }
      return raw.map((fragment) => FragmentSchema.parse(fragment));
    },

    async exportAll(): Promise<ExportDocument> {
      const raw: unknown = await invoke("lore_export", {});
      return ExportDocumentSchema.parse(raw);
    },

    async deleteAll(): Promise<void> {
      await invokeOk(invoke, "lore_delete_all", {});
    },

    async stats(): Promise<LoreStats> {
      const raw: unknown = await invoke("lore_stats", {});
      return StatsSchema.parse(raw);
    },
  };
}
