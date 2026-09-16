// natally — J8 import (ARCHITECTURE §5 export law, §8.4).
// Merge-by-id restore: existing rows ALWAYS win, nothing is ever deleted.
// People merge on `personId`, lore nodes/edges on `nodeId`/edge key — an
// import adds what is missing and leaves what exists untouched, so importing
// the same document twice is a no-op and user data created since the export
// survives (§8.4: deletion is only ever the explicit delete-everything flow).
//
// Chart rows import as INPUTS with a JSON-`null` facts placeholder — computed
// facts are never serialized (§5) and are recomputed by the EphemerisEngine.
//
// When a lore sidecar is bound, the graph merges through the sidecar's OWN
// handle (the seam has no import method — see db.ts LoreStoreBinding), using
// the same insert-only SQL shapes the L.1 store core uses.
import type { SqliteDb } from "@natally/lore/ddl";
import {
  type ExportDocument,
  ExportDocumentSchema,
  type LoreEdge,
  type LoreNode,
} from "@natally/lore/types";
import type { LoreStoreBinding } from "./db";

/** Rows actually inserted per table — 0 everywhere for an idempotent re-import. */
export interface ImportSummary {
  readonly people: number;
  readonly sessions: number;
  readonly turns: number;
  readonly charts: number;
  readonly consumedCodes: number;
  readonly loreNodes: number;
  readonly loreEdges: number;
}

/** Little-endian Float32 BLOB — byte-identical to the L.1 store core's on-disk encoding. */
function float32Blob(embedding: readonly number[]): Uint8Array {
  const f32 = new Float32Array(embedding.length);
  f32.set(embedding);
  return new Uint8Array(f32.buffer);
}

/** BEGIN IMMEDIATE / COMMIT with rollback-on-error (same shape as the L.1 store core). */
function inTransaction<T>(db: SqliteDb, body: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = body();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Rollback itself failed — surface the original error below instead of masking it.
    }
    throw error;
  }
}

/** INSERT OR IGNORE over a statement: returns 1 when a row was inserted, 0 when it existed. */
function runIgnore(stmt: ReturnType<SqliteDb["prepare"]>, params: readonly unknown[]): number {
  return Number(stmt.run(...params).changes) > 0 ? 1 : 0;
}

function mergeAppRows(
  doc: ExportDocument,
  db: SqliteDb,
): Omit<ImportSummary, "loreNodes" | "loreEdges"> {
  return inTransaction(db, () => {
    let people = 0;
    const insertPerson = db.prepare(
      "INSERT OR IGNORE INTO people (id, name, birth_date, birth_time, time_known, place, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const person of doc.people) {
      people += runIgnore(insertPerson, [
        person.id,
        person.name,
        person.birth.date,
        person.birth.time ?? null,
        person.birth.timeKnown ? 1 : 0,
        person.birth.place,
        Date.now(),
      ]);
    }

    let sessions = 0;
    const insertSession = db.prepare(
      "INSERT OR IGNORE INTO sessions (id, person_id, started_at) VALUES (?, ?, ?)",
    );
    for (const session of doc.sessions) {
      sessions += runIgnore(insertSession, [session.id, session.personId, session.startedAt]);
    }

    let turns = 0;
    const insertTurn = db.prepare(
      "INSERT OR IGNORE INTO turns (id, session_id, person_id, role, text, ts, tool_ops) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const turn of doc.turns) {
      turns += runIgnore(insertTurn, [
        turn.id,
        turn.sessionId,
        turn.personId ?? null,
        turn.role,
        turn.text,
        turn.ts,
        turn.toolOps === undefined ? null : JSON.stringify(turn.toolOps),
      ]);
    }

    let charts = 0;
    const insertChart = db.prepare(
      "INSERT OR IGNORE INTO charts (id, inputs_json, facts_json, computed_at) VALUES (?, ?, ?, ?)",
    );
    for (const chart of doc.charts) {
      // Inputs only (§5): facts are recomputed by the engine, never fabricated.
      charts += runIgnore(insertChart, [chart.id, JSON.stringify(chart), "null", null]);
    }

    let consumedCodes = 0;
    const insertCode = db.prepare(
      "INSERT OR IGNORE INTO consumed_codes (code_hash, redeemed_at) VALUES (?, ?)",
    );
    for (const code of doc.consumedCodes) {
      consumedCodes += runIgnore(insertCode, [code.codeHash, code.redeemedAt]);
    }

    return { people, sessions, turns, charts, consumedCodes };
  });
}

/** Lore graph merge-by-id through the sidecar handle — existing wins, never deletes. */
function mergeLore(
  lore: LoreStoreBinding,
  nodes: readonly LoreNode[],
  edges: readonly LoreEdge[],
): { readonly loreNodes: number; readonly loreEdges: number } {
  return inTransaction(lore.db, () => {
    let loreNodes = 0;
    const insertNode = lore.db.prepare(
      "INSERT OR IGNORE INTO lore_nodes (id, kind, summary, embedding, refs_json) VALUES (?, ?, ?, ?, ?)",
    );
    for (const node of nodes) {
      loreNodes += runIgnore(insertNode, [
        node.id,
        node.kind,
        node.summary,
        float32Blob(node.embedding),
        JSON.stringify(node.refs),
      ]);
    }

    let loreEdges = 0;
    const insertEdge = lore.db.prepare(
      "INSERT OR IGNORE INTO lore_edges (from_id, to_id, rel, weight, source_turn_id) " +
        "VALUES (?, ?, ?, ?, ?)",
    );
    for (const edge of edges) {
      loreEdges += runIgnore(insertEdge, [
        edge.from,
        edge.to,
        edge.rel,
        edge.weight,
        edge.sourceTurnId,
      ]);
    }

    return { loreNodes, loreEdges };
  });
}

/**
 * Restore a J8 document into `db` (and the bound lore sidecar when present).
 * Idempotent by construction: every statement is INSERT OR IGNORE, so a
 * re-import inserts nothing, changes nothing, and never deletes anything.
 */
export function importDocument(doc: unknown, db: SqliteDb, lore?: LoreStoreBinding): ImportSummary {
  // Validate against the contract before anything touches a table (INC-19).
  const parsed: ExportDocument = ExportDocumentSchema.parse(doc);
  const app = mergeAppRows(parsed, db);
  const loreSummary =
    lore === undefined
      ? { loreNodes: 0, loreEdges: 0 }
      : mergeLore(lore, parsed.loreNodes, parsed.loreEdges);
  return { ...app, ...loreSummary };
}
