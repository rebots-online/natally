import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assembleFragments,
  contextTurnsOf,
  retrieve,
  twoHopNeighbourhood,
} from "../src/retrieve.js";
import type { LoreStore } from "../src/store.js";
import type { LoreEdge, LoreNode, Turn } from "../src/types.js";
import { createHashEmbedder } from "./hash-embedder.js";

const node = (id: string, summary: string, refs: string[], embedding: number[]): LoreNode => ({
  id,
  kind: "fact",
  summary,
  embedding,
  refs,
});

const edge = (from: string, to: string, rel: LoreEdge["rel"], sourceTurnId: string): LoreEdge => ({
  from,
  to,
  rel,
  weight: 1,
  sourceTurnId,
});

function unit(dim: number, at: number): number[] {
  const vector = Array<number>(dim).fill(0);
  vector[at % dim] = 1;
  return vector;
}

const embedder = createHashEmbedder(8);

describe("twoHopNeighbourhood", () => {
  it("expands exactly two hops from the seeds and never returns the seeds", () => {
    const edges = [
      edge("a", "b", "mentions", "t1"),
      edge("b", "c", "relates", "t2"),
      edge("c", "d", "follows", "t3"),
    ];
    const hood = twoHopNeighbourhood(["a"], edges);
    expect([...hood].sort()).toEqual(["b", "c"]);
  });
});

describe("assembleFragments", () => {
  it("respects the char/4 token budget and keeps order", () => {
    const nodes = [
      node("n1", "x".repeat(40), ["turn:t1"], unit(4, 0)),
      node("n2", "y".repeat(4000), ["turn:t2"], unit(4, 1)),
    ];
    const fragments = assembleFragments(
      nodes.map((n, index) => ({ node: n, score: 1 - index })),
      20,
    );
    expect(fragments).toHaveLength(1);
    expect(fragments[0]?.sourceTurnId).toBe("t1");
  });

  it("deduplicates nodes", () => {
    const n = node("n1", "summary", ["turn:t1"], unit(4, 0));
    const fragments = assembleFragments(
      [
        { node: n, score: 0.9 },
        { node: n, score: 0.8 },
      ],
      100,
    );
    expect(fragments).toHaveLength(1);
  });
});

describe("retrieve", () => {
  let store: LoreStore;

  beforeEach(() => {
    store = {
      query: vi.fn(async () => ({
        nodes: [
          node("sun", "Sun in Taurus topics", ["turn:turn-sun"], unit(8, 0)),
          node("moon", "Moon in Leo topics", ["turn:turn-moon"], unit(8, 1)),
          node("rel", "related via graph", ["turn:turn-rel"], unit(8, 2)),
        ],
        edges: [edge("sun", "rel", "relates", "turn-sun")],
      })),
      upsertTurn: vi.fn(async () => undefined),
      exportAll: vi.fn(async () => ({ nodes: [], edges: [] })),
      deleteAll: vi.fn(async () => undefined),
      stats: vi.fn(async () => ({ turns: 0, nodes: 0, edges: 0 })),
    };
  });

  it("ranks vector matches and pulls the 2-hop neighbourhood under the floor score", async () => {
    const fragments = await retrieve(store, embedder, { q: "taurus sun", k: 2, budgetTokens: 500 });
    const ids = fragments.map((fragment) => fragment.summary);
    expect(ids).toContain("Sun in Taurus topics");
    expect(ids).toContain("related via graph");
    expect(ids.indexOf("Sun in Taurus topics")).toBeLessThan(ids.indexOf("related via graph"));
    for (const fragment of fragments) expect(fragment.sourceTurnId).toMatch(/^turn-/);
  });

  it("scopes to the person unless the query is general", async () => {
    await retrieve(store, embedder, { personId: "p1", q: "anything" });
    expect(store.query).toHaveBeenCalledWith("p1", "anything", 8, 1500);
    await retrieve(store, embedder, { personId: "p1", q: "anything", general: true });
    expect(store.query).toHaveBeenLastCalledWith(undefined, "anything", 8, 1500);
  });

  it("returns empty for an empty query without touching the store", async () => {
    const fragments = await retrieve(store, embedder, { q: "   " });
    expect(fragments).toHaveLength(0);
    expect(store.query).not.toHaveBeenCalled();
  });

  it("returns empty when the store has no nodes", async () => {
    store.query = vi.fn(async () => ({ nodes: [], edges: [] }));
    const fragments = await retrieve(store, embedder, { q: "mercury" });
    expect(fragments).toHaveLength(0);
  });
});

describe("contextTurnsOf", () => {
  it("picks the first and immediately preceding same-session turns", () => {
    const turns: Turn[] = [
      { id: "t1", sessionId: "s", role: "you", text: "first", ts: 1 },
      { id: "t2", sessionId: "s", role: "her", text: "second", ts: 2 },
      { id: "t3", sessionId: "other", role: "you", text: "elsewhere", ts: 3 },
    ];
    const current: Turn = { id: "t4", sessionId: "s", role: "you", text: "now", ts: 4 };
    const { firstTurn, previousTurn } = contextTurnsOf(turns, current);
    expect(firstTurn?.id).toBe("t1");
    expect(previousTurn?.id).toBe("t2");
  });
});
