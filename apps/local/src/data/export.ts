// natally — J8 export (ARCHITECTURE §5 export law, §8.4).
// One versioned ExportDocument of every user-owned entity: people, sessions,
// turns, chart INPUTS, lore graph, consumed codes.
//
// Export law (§5):
//  - Chart INPUTS only — `facts_json` is computed engine data and is never serialized.
//  - The lore graph comes from the injected L.1 store's `exportAll()` when a sidecar
//    is bound (only its `loreNodes`/`loreEdges` are taken; app entities always come
//    from the app handle's repositories).
//  - `consumed_codes` is the hash-only licensing ledger (§9.5); its repository
//    belongs to the licensing task, so J8 reads the table directly here.
//  - Plaintext JSON by design (user-owned) — the UI says so (§13).
// Every array is sorted by a stable key so an export is byte-for-byte deterministic.
import type { SqliteDb } from "@natally/lore/ddl";
import {
  type ConsumedCode,
  ConsumedCodeSchema,
  type ExportDocument,
  ExportDocumentSchema,
} from "@natally/lore/types";
import { createChartsRepo } from "./charts";
import type { LoreStoreBinding } from "./db";
import { createPeopleRepo } from "./people";
import { createSessionsRepo } from "./sessions";
import { createTurnsRepo } from "./turns";

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("export: expected a row object from the SQLite driver");
  }
  return value as Record<string, unknown>;
}

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byTsThenId(
  a: { readonly ts: number; readonly id: string },
  b: { readonly ts: number; readonly id: string },
): number {
  return a.ts - b.ts || byId(a, b);
}

function byHash(a: ConsumedCode, b: ConsumedCode): number {
  return a.codeHash < b.codeHash ? -1 : a.codeHash > b.codeHash ? 1 : 0;
}

function byEdgeKey(
  a: {
    readonly from: string;
    readonly to: string;
    readonly rel: string;
    readonly sourceTurnId: string;
  },
  b: {
    readonly from: string;
    readonly to: string;
    readonly rel: string;
    readonly sourceTurnId: string;
  },
): number {
  return (
    byId({ id: a.from }, { id: b.from }) ||
    byId({ id: a.to }, { id: b.to }) ||
    byId({ id: a.rel }, { id: b.rel }) ||
    byId({ id: a.sourceTurnId }, { id: b.sourceTurnId })
  );
}

/** The hash-only single-use ledger (§9.5), read directly for J8 (see file header). */
function readConsumedCodes(db: SqliteDb): ConsumedCode[] {
  return db
    .prepare("SELECT code_hash, redeemed_at FROM consumed_codes ORDER BY code_hash ASC")
    .all()
    .map((value) =>
      ConsumedCodeSchema.parse({
        codeHash: String(asRow(value)["code_hash"]),
        redeemedAt: Number(asRow(value)["redeemed_at"] ?? 0),
      }),
    );
}

/**
 * Build the J8 document from the app handle, optionally enriched with the lore
 * graph from an injected sidecar. Zod-validated before it leaves — a shape bug
 * fails loudly instead of exporting a lie (INC-19).
 */
export async function exportAll(db: SqliteDb, lore?: LoreStoreBinding): Promise<ExportDocument> {
  let loreNodes: ExportDocument["loreNodes"] = [];
  let loreEdges: ExportDocument["loreEdges"] = [];
  if (lore) {
    const loreDoc = await lore.store.exportAll();
    loreNodes = [...loreDoc.loreNodes].sort(byId);
    loreEdges = [...loreDoc.loreEdges].sort(byEdgeKey);
  }

  // Validated against the contract before it leaves (INC-19); sorting makes the
  // document deterministic regardless of table scan order.
  return ExportDocumentSchema.parse({
    exportVersion: 1,
    people: createPeopleRepo(db).list().sort(byId),
    sessions: createSessionsRepo(db).list().sort(byId),
    turns: createTurnsRepo(db).list().sort(byTsThenId),
    charts: createChartsRepo(db)
      .list()
      .map((record) => record.inputs)
      .sort(byId),
    loreNodes,
    loreEdges,
    consumedCodes: readConsumedCodes(db).sort(byHash),
  });
}
