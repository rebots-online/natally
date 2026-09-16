// natally — L.3 tests: deterministic extraction & merge (ARCHITECTURE §8.2–8.3).
// Fixtures are inline: the gazetteer is injected (app-layer dependency ruling) and
// embeddings are precomputed (L.5 embeds; extraction stays pure).
//
// Merge-boundary vectors (2-D, integer, computed with the same op order as
// `cosine()` — IEEE-754 doubles, deterministic):
//   cos([11,30],[31,33]) = 0.9200009036111985  ≥ 0.92  ⇒ merges
//   cos([8,15],[36,29])  = 0.9199984906327019  <  0.92  ⇒ no merge
import { describe, expect, it } from "vitest";
import { EN_STOPWORDS, extractFromTurn, MERGE_COSINE_THRESHOLD, topicWords } from "../src/extract";
import type { LoreNode, Turn } from "../src/types";

const GAZETTEER: ReadonlySet<string> = new Set(["Paris", "London"]);

function turn(id: string, text: string): Turn {
  return { id, sessionId: "sess-1", role: "you", text, ts: 1760000000000 };
}

describe("extract: entities+edges found; merge at 0.92 verified", () => {
  it("finds en person + place + ISO date + natural date + thread labels with mentions/follows/relates edges", () => {
    const result = extractFromTurn(
      turn("t1", "Meet Marina in Paris on 1990-05-02, then fly again on May 21."),
      {
        gazetteer: GAZETTEER,
        threadSeedWords: ["synastry", "transits"],
      },
    );

    expect(result.merges).toEqual([]);
    expect(result.nodes.map((n) => [n.kind, n.summary])).toEqual([
      ["person", "Marina"],
      ["place", "Paris"], // canonical summary from the gazetteer entry
      ["event", "1990-05-02"],
      ["event", "May 21"],
      ["thread", "synastry"],
      ["thread", "transits"],
    ]);
    expect(result.nodes.map((n) => n.id)).toEqual([
      "lore:person:marina",
      "lore:place:paris",
      "lore:event:1990-05-02",
      "lore:event:may 21",
      "lore:thread:synastry",
      "lore:thread:transits",
    ]);
    // "Meet" is sentence-initial (heuristic: skipped); every candidate refs this turn.
    for (const node of result.nodes) expect(node.refs).toEqual(["t1"]);
    // No embeddings supplied ⇒ empty vectors (L.5 fills them later).
    for (const node of result.nodes) expect(node.embedding).toEqual([]);

    const ids = result.nodes.map((n) => n.id);
    const mentions = result.edges.filter((e) => e.rel === "mentions");
    const follows = result.edges.filter((e) => e.rel === "follows");
    const relates = result.edges.filter((e) => e.rel === "relates");

    // mentions: turn → each node, weight 1, sourced to this turn.
    expect(mentions.map((e) => e.to)).toEqual(ids);
    for (const e of mentions) {
      expect(e.from).toBe("t1");
      expect(e.weight).toBe(1);
      expect(e.sourceTurnId).toBe("t1");
    }
    // follows: consecutive extracted nodes in reading order.
    expect(follows.map((e) => [e.from, e.to])).toEqual([
      [ids[0], ids[1]],
      [ids[1], ids[2]],
      [ids[2], ids[3]],
      [ids[3], ids[4]],
      [ids[4], ids[5]],
    ]);
    // relates: every distinct pair shares this turn's ref.
    expect(relates).toHaveLength((ids.length * (ids.length - 1)) / 2);
    expect(relates[0]).toEqual({
      from: ids[0],
      to: ids[1],
      rel: "relates",
      weight: 1,
      sourceTurnId: "t1",
    });
    expect(result.edges).toHaveLength(mentions.length + follows.length + relates.length);
  });

  it("extracts a transliterated (Cyrillic) proper noun as a person via unicode segmentation", () => {
    const result = extractFromTurn(turn("t2", "Вчера Анастасия написала письмо."), {
      gazetteer: GAZETTEER,
    });
    // "Вчера" is sentence-initial (skipped); "Анастасия" is mid-sentence capitalized.
    expect(result.nodes).toEqual([
      {
        id: "lore:person:анастасия",
        kind: "person",
        summary: "Анастасия",
        embedding: [],
        refs: ["t2"],
      },
    ]);
    expect(result.merges).toEqual([]);
    expect(result.edges).toEqual([
      { from: "t2", to: "lore:person:анастасия", rel: "mentions", weight: 1, sourceTurnId: "t2" },
    ]);
  });

  it("merges at the 0.92 boundary: same-kind cosine ≥ 0.92, union refs, bumped mentions weight, earlier id kept", () => {
    expect(MERGE_COSINE_THRESHOLD).toBe(0.92);
    const existing: LoreNode[] = [
      {
        id: "lore:person:katy",
        kind: "person",
        summary: "Katy",
        embedding: [11, 30],
        refs: ["t0"],
      },
    ];
    const result = extractFromTurn(turn("t1", "Then Katya wrote."), {
      gazetteer: GAZETTEER,
      existing,
      // cos([11,30],[31,33]) = 0.9200009036111985 ≥ 0.92 ⇒ merge.
      embeddings: new Map([["lore:person:katya", [31, 33]]]),
    });

    expect(result.merges).toEqual([
      { keptId: "lore:person:katy", mergedIds: ["lore:person:katya"] },
    ]);
    // Existing identity survives; refs unioned sorted-unique; embedding from the existing node.
    expect(result.nodes).toEqual([
      {
        id: "lore:person:katy",
        kind: "person",
        summary: "Katy",
        embedding: [11, 30],
        refs: ["t0", "t1"],
      },
    ]);
    // "bump weight": mentions edge carries 1 + absorbed merges this turn.
    expect(result.edges).toEqual([
      { from: "t1", to: "lore:person:katy", rel: "mentions", weight: 2, sourceTurnId: "t1" },
    ]);
  });

  it("keeps the earlier id even when the candidate id is lexicographically smaller", () => {
    const existing: LoreNode[] = [
      {
        id: "lore:person:aaron",
        kind: "person",
        summary: "Aaron",
        embedding: [11, 30],
        refs: ["t0"],
      },
    ];
    const result = extractFromTurn(turn("t1", "Yesterday Aaliyah called."), {
      gazetteer: GAZETTEER,
      existing,
      embeddings: new Map([["lore:person:aaliyah", [31, 33]]]),
    });

    // "lore:person:aaliyah" < "lore:person:aaron" ⇒ candidate id wins, existing identity survives.
    expect(result.merges).toEqual([
      { keptId: "lore:person:aaliyah", mergedIds: ["lore:person:aaron"] },
    ]);
    expect(result.nodes).toEqual([
      {
        id: "lore:person:aaliyah",
        kind: "person",
        summary: "Aaron",
        embedding: [11, 30],
        refs: ["t0", "t1"],
      },
    ]);
  });

  it("does not merge just below the threshold (0.919-region cosine) and emits a fresh node", () => {
    const existing: LoreNode[] = [
      { id: "lore:person:mira", kind: "person", summary: "Mira", embedding: [8, 15], refs: ["t0"] },
    ];
    const result = extractFromTurn(turn("t1", "Yesterday Mirren called."), {
      gazetteer: GAZETTEER,
      existing,
      // cos([8,15],[36,29]) = 0.9199984906327019 < 0.92 ⇒ no merge.
      embeddings: new Map([["lore:person:mirren", [36, 29]]]),
    });

    expect(result.merges).toEqual([]);
    expect(result.nodes).toEqual([
      {
        id: "lore:person:mirren",
        kind: "person",
        summary: "Mirren",
        embedding: [36, 29],
        refs: ["t1"],
      },
    ]);
    expect(result.edges).toEqual([
      { from: "t1", to: "lore:person:mirren", rel: "mentions", weight: 1, sourceTurnId: "t1" },
    ]);
  });

  it("is deterministic: same input twice ⇒ deep-equal output; inputs are never mutated", () => {
    const existing: LoreNode[] = [
      {
        id: "lore:person:katy",
        kind: "person",
        summary: "Katy",
        embedding: [11, 30],
        refs: ["t0"],
      },
    ];
    const existingSnapshot = structuredClone(existing);
    const input = {
      gazetteer: GAZETTEER,
      existing,
      threadSeedWords: ["synastry"],
      embeddings: new Map([["lore:person:katya", [31, 33]]]),
    };
    const t = turn("t1", "Meet Marina in Paris on 1990-05-02, then fly again on May 21.");
    const first = extractFromTurn(t, input);
    const second = extractFromTurn(t, input);

    expect(first).toEqual(second);
    expect(existing).toEqual(existingSnapshot);
  });

  it("returns an empty result for an empty turn", () => {
    expect(extractFromTurn(turn("t0", ""), { gazetteer: GAZETTEER })).toEqual({
      nodes: [],
      edges: [],
      merges: [],
    });
  });

  it("topicWords derives first-turn seed words using EN_STOPWORDS (no stopwords, months, or numbers)", () => {
    expect(EN_STOPWORDS.has("and")).toBe(true);
    expect(topicWords("I met Marina in Paris on May 2 and we talked about synastry")).toEqual([
      "met",
      "Marina",
      "Paris",
      "talked",
      "synastry",
    ]);
  });
});
