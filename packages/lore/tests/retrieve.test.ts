// natally — L.4 verify: hybrid retrieval (ARCHITECTURE §8.3).
//
// Real cycle end-to-end: deterministic hash embedder (L.2, tests-only) →
// in-memory SQLite LoreStore (L.1's common core, vec-off canonical path —
// identical retrieval behaviour either way; the sqlite-vec MATCH swap lives
// inside store adapters, never in retrieve()) → hybrid orchestrator.
//
// Fixture: chain A —follows→ B —follows→ C within person p1, plus p2's X
// edge-adjacent to A (`upsertTurn` appends one node per turn and never
// fabricates edges, so the graph edges are inserted directly — the extraction
// pipeline's concern, not the store's).
import Database from "better-sqlite3";
import { expect, test } from "vitest";
import type { SqliteDb } from "../src/ddl";
import { migrate } from "../src/migrate";
import { retrieve } from "../src/retrieve";
import type { LoreStore } from "../src/store";
import { createSqliteLoreStore } from "../src/store/common";
import { createHashEmbedder } from "./hash-embedder";

const DIM = 64;
const embedder = createHashEmbedder({ dim: DIM });

function openMemory(): SqliteDb {
  return new Database(":memory:");
}

/** The §8.3 budget estimate, as the store computes it: ceil(chars / 4), min 1. */
function tokenEstimate(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

async function upsert(store: LoreStore, id: string, personId: string, text: string): Promise<void> {
  await store.upsertTurn(
    { id, sessionId: "s1", personId, role: "you", text, ts: 1_700_000_000_000 },
    await embedder.embed(text),
  );
}

function insertEdge(
  db: SqliteDb,
  from: string,
  to: string,
  rel: string,
  sourceTurnId: string,
): void {
  db.prepare(
    "INSERT INTO lore_edges (from_id, to_id, rel, weight, source_turn_id) VALUES (?, ?, ?, ?, ?)",
  ).run(from, to, rel, 1, sourceTurnId);
}

test("retrieve: vector ∪ 2-hop, budget respected, person-scoped", async () => {
  const db = openMemory();
  expect(migrate(db, { vec: false })).toHaveLength(5);
  const store = createSqliteLoreStore(db, {
    vec: false,
    embed: embedder.embed,
    embedDim: DIM,
    runtime: "memory",
  });

  await upsert(store, "tA", "p1", "mars retrograde tonight");
  await upsert(store, "tB", "p1", "venus transit forecast");
  await upsert(store, "tC", "p1", "comet shower over oslo");
  await upsert(store, "tX", "p2", "pluto opposition notes");
  insertEdge(db, "turn:tA", "turn:tB", "follows", "tA");
  insertEdge(db, "turn:tB", "turn:tC", "follows", "tB");
  insertEdge(db, "turn:tA", "turn:tX", "mentions", "tA");

  // Vector ∪ 2-hop, person-scoped: A matches directly; B and C are reachable
  // only through the graph (1 hop, 2 hops); p2's X — edge-adjacent to A — is
  // excluded by the person scope.
  const scoped = await retrieve(store, embedder, {
    personId: "p1",
    q: "mars retrograde tonight",
  });
  const byId = new Map(scoped.map((fragment) => [fragment.nodeId, fragment]));

  const a = byId.get("turn:tA");
  expect(a).toBeDefined();
  expect(a?.hops).toBe(0);
  expect(a?.score).toBeCloseTo(1, 5);
  expect(a?.summary).toBe("mars retrograde tonight");
  expect(a?.sourceTurnId).toBe("tA");

  const b = byId.get("turn:tB");
  expect(b?.hops).toBe(1);
  expect(b?.score).toBe(0);

  const c = byId.get("turn:tC");
  expect(c?.hops).toBe(2);
  expect(c?.score).toBe(0);
  expect(c?.sourceTurnId).toBe("tB");

  expect(byId.has("turn:tX")).toBe(false);

  // Ordered by score, best first.
  for (let i = 1; i < scoped.length; i += 1) {
    expect(scoped[i - 1]?.score ?? 0).toBeGreaterThanOrEqual(scoped[i]?.score ?? 0);
  }

  // Default budget (1500 tokens, char/4 estimate) respected.
  const scopedCost = scoped.reduce((sum, f) => sum + tokenEstimate(f.summary), 0);
  expect(scopedCost).toBeLessThanOrEqual(1500);

  // General query (personId omitted): cross-person results come back.
  const general = await retrieve(store, embedder, { q: "mars retrograde tonight" });
  const generalIds = new Set(general.map((fragment) => fragment.nodeId));
  expect(generalIds.has("turn:tX")).toBe(true);
  expect(generalIds.has("turn:tA")).toBe(true);
  expect(generalIds.has("turn:tC")).toBe(true);

  // Budget cut: A (6) + B (6) exactly fills 12; C (7 tokens) — reachable at
  // 2 hops under the default budget — drops out first.
  const cut = await retrieve(store, embedder, {
    personId: "p1",
    q: "mars retrograde tonight",
    budgetTokens: 12,
  });
  expect(cut.map((fragment) => fragment.nodeId)).toEqual(["turn:tA", "turn:tB"]);
  expect(cut.some((fragment) => fragment.nodeId === "turn:tC")).toBe(false);
  const cutCost = cut.reduce((sum, fragment) => sum + tokenEstimate(fragment.summary), 0);
  expect(cutCost).toBeLessThanOrEqual(12);

  // Token-less query embeds to the zero vector — honest absence, no results.
  await expect(retrieve(store, embedder, { personId: "p1", q: "!!!" })).resolves.toEqual([]);
});
