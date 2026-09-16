// natally — L.5 pipeline tests (ARCHITECTURE §8.3, TEST_RUBRIC §TR-4).
//
// Real cycle over in-memory better-sqlite3 (vec off): L.1 store core + the
// `flushTurn` batch entry implemented HERE over the same `SqliteDb` seam
// (insert-only SQL, ONE transaction — the seam implementation lives in tests/
// until the store-layer task lands the adapter implementations; the pipeline
// src/ owns only the seam type). The hash embedder is the TEST embedder —
// production code never imports it (TR-9 grep).
//
// Flush counting: a counting wrapper around the store asserts exactly one
// flush per consumed turn (TR-4 "asserted flush counter").
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { extractFromTurn, topicWords } from "../src/extract";
import { migrate } from "../src/migrate";
import { createLorePipeline, type LoreFlush, type LorePipelineStore } from "../src/pipeline";
import { createSqliteLoreStore, embeddingToBlob } from "../src/store/common";
import type { Turn } from "../src/types";
import { createHashEmbedder } from "./hash-embedder";

/** Turn texts: distinct per index, with REPEATING entity mentions so merges happen. */
const TEMPLATES: ReadonlyArray<(i: number) => string> = [
  (i) => `Yesterday Alice met Bob near Paris again (entry ${String(i)}).`,
  (i) => `Then Bob wrote to Alice about the chart (entry ${String(i)}).`,
  (i) => `On 1990-05-02 Alice recalled Paris with Bob (entry ${String(i)}).`,
  (i) => `Later Bob and Alice walked through Marseille together (entry ${String(i)}).`,
];

const GAZETTEER: ReadonlySet<string> = new Set(["Paris", "Marseille"]);
const TURN_COUNT = 50;

function turnAt(i: number): Turn {
  const template = TEMPLATES[i % TEMPLATES.length];
  if (template === undefined) {
    throw new Error(`template missing for index ${String(i)}`);
  }
  return {
    id: `t-${String(i).padStart(3, "0")}`,
    sessionId: "sess-1",
    personId: "person-1",
    role: i % 2 === 0 ? "you" : "her",
    text: template(i),
    ts: 1_700_000_000_000 + i * 1_000,
  };
}

/**
 * The flush implementation over the SAME opened db the store core backs:
 * session guard + turn row + `turn:<id>` evidence node + extraction
 * nodes/edges — every statement an INSERT with conflict clauses (TR-4
 * insert-only), all inside ONE transaction.
 */
function attachFlushTurn(
  base: ReturnType<typeof createSqliteLoreStore>,
  db: Database.Database,
): LorePipelineStore {
  const flushOnce = db.transaction(
    (turn: Turn, embedding: readonly number[], lore: LoreFlush): void => {
      db.prepare("INSERT OR IGNORE INTO sessions (id, person_id, started_at) VALUES (?, ?, ?)").run(
        turn.sessionId,
        null,
        turn.ts,
      );
      db.prepare(
        "INSERT INTO turns (id, session_id, person_id, role, text, ts, tool_ops) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        turn.id,
        turn.sessionId,
        turn.personId ?? null,
        turn.role,
        turn.text,
        turn.ts,
        turn.toolOps ? JSON.stringify(turn.toolOps) : null,
      );
      db.prepare(
        "INSERT INTO lore_nodes (id, kind, summary, embedding, refs_json) VALUES (?, ?, ?, ?, ?)",
      ).run(
        `turn:${turn.id}`,
        "event",
        turn.text,
        embeddingToBlob(embedding),
        JSON.stringify([turn.id]),
      );
      const insertNode = db.prepare(
        "INSERT INTO lore_nodes (id, kind, summary, embedding, refs_json) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET summary = excluded.summary, embedding = excluded.embedding, refs_json = excluded.refs_json",
      );
      for (const node of lore.nodes) {
        insertNode.run(
          node.id,
          node.kind,
          node.summary,
          embeddingToBlob(node.embedding),
          JSON.stringify(node.refs),
        );
      }
      // Edge weights are ABSOLUTE per turn — upsert, never accumulate (extract.ts law).
      const insertEdge = db.prepare(
        "INSERT INTO lore_edges (from_id, to_id, rel, weight, source_turn_id) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(from_id, to_id, rel, source_turn_id) DO UPDATE SET weight = excluded.weight",
      );
      for (const edge of lore.edges) {
        insertEdge.run(edge.from, edge.to, edge.rel, edge.weight, edge.sourceTurnId);
      }
    },
  );
  return {
    ...base,
    flushTurn: async (turn, embedding, lore) => {
      flushOnce(turn, embedding, lore);
    },
  };
}

/** TR-4 asserted flush counter — wrapper lives in tests/, never src/. */
function countingWrap(base: LorePipelineStore): {
  store: LorePipelineStore;
  flushCount: () => number;
} {
  let count = 0;
  const store: LorePipelineStore = {
    ...base,
    flushTurn: async (turn, embedding, lore) => {
      count += 1;
      await base.flushTurn(turn, embedding, lore);
    },
  };
  return { store, flushCount: () => count };
}

function countRows(db: Database.Database, sql: string): number {
  const row = db.prepare(sql).get() as { n: number };
  return row.n;
}

describe("L.5 write-every-turn pipeline", () => {
  it("pipeline: 50 turns → nodes merged, flush count = 50, delete leaves 0 rows", async () => {
    const db = new Database(":memory:");
    migrate(db, { vec: false });
    const base = createSqliteLoreStore(db, { vec: false, runtime: "test-memory" });
    const wrapped = countingWrap(attachFlushTurn(base, db));
    const firstText = TEMPLATES[0]?.(0) ?? "";
    const pipeline = createLorePipeline({
      store: wrapped.store,
      embedder: createHashEmbedder({ dim: 64 }),
      gazetteer: GAZETTEER,
      threadSeedWords: topicWords(firstText),
    });

    // Candidate emissions are counted independently with the same pure
    // extractor (no existing, no embeddings ⇒ pure candidate count per turn).
    let candidateEmissions = 0;
    let mergeRecords = 0;
    for (let i = 0; i < TURN_COUNT; i += 1) {
      const turn = turnAt(i);
      const result = await pipeline.consume(turn);
      candidateEmissions += extractFromTurn(turn, {
        gazetteer: GAZETTEER,
        threadSeedWords: topicWords(firstText),
      }).nodes.length;
      mergeRecords += result.merges.length;
      // Exactly one flush per turn — checked mid-stream too.
      expect(wrapped.flushCount()).toBe(i + 1);
    }

    // --- flush count = 50 (TR-4: exactly one flush per turn) -------------------
    expect(wrapped.flushCount()).toBe(50);

    // --- nodes merged: persisted lore nodes collapse repeated candidates -------
    const loreNodeCount = countRows(
      db,
      "SELECT COUNT(*) AS n FROM lore_nodes WHERE id NOT LIKE 'turn:%'",
    );
    expect(loreNodeCount).toBeGreaterThan(0);
    expect(candidateEmissions).toBeGreaterThan(loreNodeCount); // merges happened
    expect(mergeRecords).toBeGreaterThan(0);
    // Alice was a candidate in every turn yet persists as ONE row whose refs
    // span all 50 turns — the merge identity survived (earlier id kept).
    const alice = db
      .prepare("SELECT refs_json FROM lore_nodes WHERE id = 'lore:person:alice'")
      .get() as { refs_json: string };
    const aliceRefs = JSON.parse(alice.refs_json) as unknown[];
    expect(aliceRefs.length).toBe(TURN_COUNT);
    // Edges landed, so the delete assertion below is meaningful.
    const edgeCount = countRows(db, "SELECT COUNT(*) AS n FROM lore_edges");
    expect(edgeCount).toBeGreaterThan(0);

    // --- stats consistent with the raw db (pre-delete) --------------------------
    const statsPre = await pipeline.stats();
    expect(statsPre.turns).toBe(TURN_COUNT);
    expect(statsPre.nodes).toBe(TURN_COUNT + loreNodeCount);
    expect(statsPre.edges).toBe(edgeCount);

    // --- deleteAll: real deletion, 0 rows across turns/lore_nodes/lore_edges ----
    await pipeline.deleteAll();
    expect(countRows(db, "SELECT COUNT(*) AS n FROM turns")).toBe(0);
    expect(countRows(db, "SELECT COUNT(*) AS n FROM lore_nodes")).toBe(0);
    expect(countRows(db, "SELECT COUNT(*) AS n FROM lore_edges")).toBe(0);
    const statsPost = await pipeline.stats();
    expect(statsPost.turns).toBe(0);
    expect(statsPost.nodes).toBe(0);
    expect(statsPost.edges).toBe(0);
  });
});
