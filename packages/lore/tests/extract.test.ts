import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  extractTurn,
  type GazetteerEntry,
  type LoreGraph,
  mergeLore,
} from "../src/extract.js";
import {
  type LoreEdge,
  LoreEdgeSchema,
  type LoreNode,
  LoreNodeSchema,
  type Turn,
} from "../src/types.js";

// Injected fixtures use G.1's exact contract, without an app-layer import.
const gazetteer: readonly GazetteerEntry[] = [
  {
    id: "geonames:6167865",
    name: "Toronto",
    countryCode: "CA",
    lat: 43.70643,
    lon: -79.39864,
    tzid: "America/Toronto",
  },
  {
    id: "geonames:6077243",
    name: "Montréal",
    countryCode: "CA",
    lat: 45.50884,
    lon: -73.58781,
    tzid: "America/Toronto",
  },
  {
    id: "geonames:1275339",
    name: "Mumbai",
    countryCode: "IN",
    lat: 19.07283,
    lon: 72.88261,
    tzid: "Asia/Kolkata",
  },
  {
    id: "geonames:3448439",
    name: "São Paulo",
    countryCode: "BR",
    lat: -23.5475,
    lon: -46.63611,
    tzid: "America/Sao_Paulo",
  },
  {
    id: "geonames:5128581",
    name: "New York City",
    countryCode: "US",
    lat: 40.71427,
    lon: -74.00597,
    tzid: "America/New_York",
  },
];

function turn(text: string, changes: Partial<Turn> = {}): Turn {
  return {
    id: "turn-1",
    sessionId: "session-1",
    role: "you",
    text,
    ts: Date.UTC(2026, 8, 12, 15),
    ...changes,
  };
}

function node(id: string, changes: Partial<LoreNode> = {}): LoreNode {
  return { id, kind: "person", summary: id, embedding: [1, 0], refs: [`source-${id}`], ...changes };
}

function edge(from: string, to: string, changes: Partial<LoreEdge> = {}): LoreEdge {
  return { from, to, rel: "mentions", weight: 1, sourceTurnId: from, ...changes };
}

function summaries(graph: LoreGraph, kind: LoreNode["kind"]): string[] {
  return graph.nodes.filter((item) => item.kind === kind).map((item) => item.summary);
}

function eventReferences(text: string, referenceDate?: string): string[] {
  return summaries(
    extractTurn(turn(text), {
      gazetteer,
      ...(referenceDate === undefined ? {} : { referenceDate }),
    }),
    "event",
  );
}

describe("extractTurn", () => {
  it("extracts English entities, grounded dates and all three edge relationships", () => {
    const first = turn("Career changes and family plans");
    const current = turn("Alice Chen met Bob in Toronto on September 12th, 2026 and 2026-09-13.", {
      id: "turn-2",
      ts: first.ts + 1,
    });
    const graph = extractTurn(current, { gazetteer, firstTurn: first, previousTurn: first });
    expect(summaries(graph, "person")).toEqual(["Alice Chen", "Bob"]);
    expect(summaries(graph, "place")).toEqual(["Toronto"]);
    expect(summaries(graph, "event")).toEqual(["2026-09-13", "2026-09-12"]);
    expect(summaries(graph, "thread")).toEqual(["career changes family plans"]);
    for (const item of graph.nodes) {
      expect(LoreNodeSchema.parse(item)).toEqual(item);
      expect(item.refs).toContain(current.id);
      expect(graph.edges).toContainEqual(edge(current.id, item.id));
    }
    expect(graph.edges).toContainEqual(
      edge(first.id, current.id, { rel: "follows", sourceTurnId: current.id }),
    );
    const names = graph.nodes.filter((item) => item.kind === "person");
    expect(graph.edges).toContainEqual(
      edge(names[0]?.id ?? "", names[1]?.id ?? "", {
        rel: "relates",
        sourceTurnId: current.id,
      }),
    );
    for (const relation of graph.edges) {
      expect(LoreEdgeSchema.parse(relation)).toEqual(relation);
      expect(relation.sourceTurnId).toBe(current.id);
    }
  });

  it("extracts a transliterated Hindi turn and accented gazetteer spellings", () => {
    const graph = extractTurn(turn("Priya Sharma kal Mumbai gayi; phir Sao Paulo aur Montreal."), {
      gazetteer,
    });
    expect(summaries(graph, "person")).toEqual(["Priya Sharma"]);
    expect(summaries(graph, "place")).toEqual(
      expect.arrayContaining(["Mumbai", "São Paulo", "Montréal"]),
    );
    expect(summaries(graph, "event")).toEqual([]); // No invented interpretation of "kal".
  });

  it("recognizes Unicode capitals, combining marks, hyphens and apostrophes", () => {
    const graph = extractTurn(
      turn("I met E\u0301lodie, Søren, Ольга and Jean-Luc O’Neill in Montréal."),
      { gazetteer },
    );
    expect(summaries(graph, "person")).toEqual(["Élodie", "Søren", "Ольга", "Jean-Luc O’Neill"]);
    expect(summaries(graph, "person")).not.toContain("I");
  });

  it("uses whole gazetteer names, longest matches and deterministic gazetteer order", () => {
    const city = {
      ...gazetteer[0],
      id: "test:city",
      name: "York",
      countryCode: "GB",
      lat: 53.96,
      lon: -1.08,
      tzid: "Europe/London",
    };
    const input = turn("new york city, Torontoish, toronto, sao paulo; new. york city.");
    const options = { gazetteer: [...gazetteer, city] };
    const graph = extractTurn(input, options);
    expect(summaries(graph, "place")).toHaveLength(4);
    expect(summaries(graph, "place")).toEqual(
      expect.arrayContaining(["New York City", "Toronto", "São Paulo", "York"]),
    );
    expect(graph).toEqual(extractTurn(input, { gazetteer: [...options.gazetteer].reverse() }));
    expect(summaries(extractTurn(turn("Torontoish"), { gazetteer }), "place")).toEqual([]);
  });

  it("never invents places absent from the injected gazetteer", () => {
    expect(summaries(extractTurn(turn("Toronto"), { gazetteer: [] }), "place")).toEqual([]);
  });

  it("normalizes absolute and yearless natural dates, and deduplicates equivalent dates", () => {
    expect(
      eventReferences(
        "2024-02-29, February 29th, 2024; 12 Sep 2026; Sept. 13, 2026; September 14.",
      ),
    ).toEqual(["2024-02-29", "2026-09-13", "--09-14", "2026-09-12"]);
    expect(eventReferences("February 29; January 1, 0001")).toEqual(["--02-29", "0001-01-01"]);
  });

  it("rejects impossible calendar dates instead of allowing JavaScript rollover", () => {
    expect(
      eventReferences("2026-02-29, 2026-13-01, 2026-04-31, February 30, 2026; 31 April 2026."),
    ).toEqual([]);
    expect(eventReferences("é2026-09-12 and 2026-09-12é")).toEqual([]);
  });

  it("retains honest normalized relative references when local civil time is unknown", () => {
    expect(eventReferences("Today, yesterday, tomorrow, NEXT Friday and next week.")).toEqual([
      "relative:today",
      "relative:yesterday",
      "relative:tomorrow",
      "relative:next-friday",
      "relative:next-week",
    ]);
    expect(eventReferences("Tomorrow", "2026-12-31")).toEqual(["2027-01-01"]);
    expect(eventReferences("Yesterday", "2024-03-01")).toEqual(["2024-02-29"]);
  });

  it("resolves weekdays from an explicit reference date and leaves periods unresolved", () => {
    expect(
      eventReferences("next Friday, last Friday, next week, last month, next year", "2026-09-11"),
    ).toEqual([
      "2026-09-18",
      "2026-09-04",
      "relative:next-week",
      "relative:last-month",
      "relative:next-year",
    ]);
    expect(() => extractTurn(turn("Tomorrow"), { gazetteer, referenceDate: "2026-02-30" })).toThrow(
      /referenceDate/u,
    );
  });

  it("keeps the first-turn thread label, ID and evidence on subsequent turns", () => {
    const first = turn("Career career changes and family plans");
    const initial = extractTurn(first, { gazetteer });
    const next = turn("Alice visits Mumbai", { id: "turn-2", ts: first.ts + 1 });
    const later = extractTurn(next, { gazetteer, firstTurn: first, previousTurn: first });
    const originalThread = initial.nodes.find((item) => item.kind === "thread");
    const laterThread = later.nodes.find((item) => item.kind === "thread");
    expect(laterThread).toMatchObject({
      id: originalThread?.id,
      summary: "career changes family plans",
      refs: [first.id, next.id],
    });
    expect(summaries(extractTurn(next, { gazetteer, previousTurn: first }), "thread")).toEqual([]);
    const otherSession = extractTurn({ ...first, sessionId: "other-session" }, { gazetteer });
    expect(otherSession.nodes.find((item) => item.kind === "thread")?.id).not.toBe(
      originalThread?.id,
    );
  });

  it("does not fabricate a topic for an empty first turn", () => {
    expect(extractTurn(turn(" \n "), { gazetteer })).toEqual({ nodes: [], edges: [] });
    expect(summaries(extractTurn(turn("I and you"), { gazetteer }), "thread")).toEqual([]);
  });

  it("rejects cross-session, future and self-follow context", () => {
    const current = turn("Alice");
    expect(() =>
      extractTurn(current, { gazetteer, firstTurn: { ...current, sessionId: "foreign" } }),
    ).toThrow(/same session/u);
    expect(() =>
      extractTurn(current, {
        gazetteer,
        previousTurn: { ...current, id: "future", ts: current.ts + 1 },
      }),
    ).toThrow(/not follow/u);
    expect(() => extractTurn(current, { gazetteer, previousTurn: current })).toThrow(/itself/u);
  });

  it("uses recall hits as grounded hints without asserting irrelevant recalled content", () => {
    const alice = node("old-alice", {
      summary: "Alice Chen",
      refs: ["turn-older"],
      embedding: [0, 1],
    });
    const reminder = node("old-fact", {
      kind: "fact",
      summary: "shared birthday",
      refs: ["turn-fact"],
    });
    const irrelevant = node("old-bob", { summary: "Bob is a doctor" });
    const input = turn("alice chen mentioned our shared birthday.");
    const before = structuredClone([alice, reminder, irrelevant]);
    const graph = extractTurn(input, { gazetteer, recallHints: [irrelevant, reminder, alice] });
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        kind: "person",
        summary: "Alice Chen",
        refs: ["turn-older", input.id],
        embedding: [0, 1],
      }),
    );
    expect(summaries(graph, "fact")).toEqual(["shared birthday"]);
    expect(graph.nodes.some((item) => item.summary === irrelevant.summary)).toBe(false);
    expect(graph).toEqual(
      extractTurn(input, { gazetteer, recallHints: [alice, reminder, irrelevant] }),
    );
    expect([alice, reminder, irrelevant]).toEqual(before);
  });

  it("produces deterministic IDs and fresh data without mutating inputs", () => {
    const input = turn("Alice met Alice in Toronto on 2026-09-12");
    const before = structuredClone(input);
    const vector = [1, 0];
    const options = { gazetteer, embed: () => vector };
    const graph = extractTurn(input, options);
    expect(graph).toEqual(extractTurn(input, options));
    expect(summaries(graph, "person")).toEqual(["Alice"]);
    expect(graph.nodes.every((item) => item.embedding !== vector)).toBe(true);
    const other = extractTurn({ ...input, id: "turn-2" }, options);
    expect(other.nodes.find((item) => item.kind === "person")?.id).not.toBe(
      graph.nodes.find((item) => item.kind === "person")?.id,
    );
    expect(input).toEqual(before);
    expect(() => extractTurn(input, { gazetteer, embed: () => [Number.NaN] })).toThrow(/finite/u);
  });

  it("retains all matching hint provenance, including gazetteer matches", () => {
    const alice = node("a", { summary: "Alice", refs: ["source-a"] });
    const alsoAlice = node("b", { summary: "Alice", refs: ["source-b"] });
    const city = node("c", { kind: "place", summary: "Toronto", refs: ["source-city"] });
    const result = extractTurn(turn("alice in Toronto"), {
      gazetteer,
      recallHints: [alice, alsoAlice, city],
    });
    expect(result.nodes.find((item) => item.kind === "person")?.refs).toEqual([
      "source-a",
      "turn-1",
      "source-b",
    ]);
    expect(result.nodes.find((item) => item.kind === "place")).toMatchObject({
      refs: ["turn-1", "source-city"],
      embedding: [1, 0],
    });
    expect(summaries(result, "person")).toEqual(["Alice"]);
  });
});

describe("mergeLore", () => {
  it("merges at cosine 0.92, keeps the earliest entity, unions refs and bumps edge weight", () => {
    const earlier = node("z-earliest", { summary: "Alice", refs: ["turn-1", "shared"] });
    const candidate = node("a-later", {
      summary: "Alice Chen",
      embedding: [0.92, Math.sqrt(1 - 0.92 ** 2)],
      refs: ["shared", "turn-2"],
    });
    const graph = mergeLore(
      { nodes: [earlier], edges: [edge("turn-2", earlier.id, { weight: 2 })] },
      {
        nodes: [candidate],
        edges: [edge("turn-2", candidate.id, { weight: 3 })],
      },
    );
    expect(cosineSimilarity(earlier.embedding, candidate.embedding)).toBeCloseTo(0.92, 14);
    expect(graph.nodes).toEqual([{ ...earlier, refs: ["turn-1", "shared", "turn-2"] }]);
    expect(graph.edges).toEqual([edge("turn-2", earlier.id, { weight: 5 })]);
  });

  it("does not merge below 0.92 or across kinds, even with identical embeddings", () => {
    const original = node("first");
    const below = node("below", { embedding: [0.919999, Math.sqrt(1 - 0.919999 ** 2)] });
    const place = node("place", { kind: "place" });
    expect(
      mergeLore({ nodes: [original], edges: [] }, { nodes: [below, place], edges: [] }).nodes,
    ).toEqual([original, below, place]);
  });

  it("chooses the earliest qualifying entity rather than the highest similarity or ID", () => {
    const earlier = node("z-earliest", { embedding: [0.93, Math.sqrt(1 - 0.93 ** 2)] });
    const later = node("a-later", { embedding: [0.99, -Math.sqrt(1 - 0.99 ** 2)] });
    const incoming = node("incoming");
    const result = mergeLore(
      { nodes: [earlier, later], edges: [] },
      { nodes: [incoming], edges: [] },
    );
    expect(result.nodes.map((item) => item.id)).toEqual([earlier.id, later.id]);
    expect(result.nodes[0]?.refs).toContain("source-incoming");
    expect(result.nodes[1]?.refs).not.toContain("source-incoming");
  });

  it("retains sourceTurnId on every remapped edge and keeps distinct sources separate", () => {
    const earlier = node("early");
    const later = node("later");
    const place = node("place", { kind: "place" });
    const graph = mergeLore(
      {
        nodes: [earlier, place],
        edges: [
          edge("turn-1", earlier.id),
          edge(earlier.id, place.id, { rel: "relates", sourceTurnId: "turn-1" }),
        ],
      },
      {
        nodes: [later],
        edges: [
          edge("turn-2", later.id),
          edge(later.id, place.id, { rel: "relates", sourceTurnId: "turn-2" }),
          edge(place.id, later.id, { rel: "contradicts", sourceTurnId: "turn-2" }),
          edge("turn-1", "turn-2", { rel: "follows", sourceTurnId: "turn-2" }),
        ],
      },
    );
    expect(graph.edges).toEqual([
      edge("turn-1", earlier.id),
      edge(earlier.id, place.id, { rel: "relates", sourceTurnId: "turn-1" }),
      edge("turn-2", earlier.id),
      edge(earlier.id, place.id, { rel: "relates", sourceTurnId: "turn-2" }),
      edge(place.id, earlier.id, { rel: "contradicts", sourceTurnId: "turn-2" }),
      edge("turn-1", "turn-2", { rel: "follows", sourceTurnId: "turn-2" }),
    ]);
    for (const item of graph.edges) {
      expect(LoreEdgeSchema.parse(item)).toEqual(item);
    }
  });

  it("preserves source evidence on relations collapsed to a single entity", () => {
    const result = mergeLore(
      { nodes: [node("early")], edges: [] },
      {
        nodes: [node("late")],
        edges: [
          edge("early", "late", { rel: "relates", sourceTurnId: "source-1" }),
          edge("late", "early", { rel: "contradicts", sourceTurnId: "source-2" }),
        ],
      },
    );
    expect(result.edges).toEqual([
      edge("early", "early", { rel: "relates", sourceTurnId: "source-1" }),
      edge("early", "early", { rel: "contradicts", sourceTurnId: "source-2" }),
    ]);
  });

  it("rewrites both entity endpoints and preserves turn IDs even when strings coincide", () => {
    const early = node("early");
    const late = node("late");
    const other = node("other", { kind: "place" });
    const graph = mergeLore(
      { nodes: [early], edges: [] },
      {
        nodes: [late, other],
        edges: [
          edge("late", "other", { sourceTurnId: "late" }),
          edge("late", "turn-next", { rel: "follows", sourceTurnId: "late" }),
          edge("late", "other", { rel: "relates", sourceTurnId: "evidence" }),
          edge("other", "late", { rel: "contradicts", sourceTurnId: "evidence" }),
        ],
      },
    );
    expect(graph.edges).toEqual([
      edge("late", "other", { sourceTurnId: "late" }),
      edge("late", "turn-next", { rel: "follows", sourceTurnId: "late" }),
      edge("early", "other", { rel: "relates", sourceTurnId: "evidence" }),
      edge("other", "early", { rel: "contradicts", sourceTurnId: "evidence" }),
    ]);
  });

  it("coalesces stable IDs with empty embeddings but never merges unembedded names", () => {
    const earlier = node("same", { embedding: [], refs: ["turn-1"] });
    const repeated = node("same", { embedding: [], refs: ["turn-2"] });
    const different = node("different", { summary: earlier.summary, embedding: [] });
    expect(
      mergeLore({ nodes: [earlier], edges: [] }, { nodes: [repeated, different], edges: [] }).nodes,
    ).toEqual([{ ...earlier, refs: ["turn-1", "turn-2"] }, different]);
    expect(() =>
      mergeLore(
        { nodes: [earlier], edges: [] },
        { nodes: [{ ...repeated, kind: "fact" }], edges: [] },
      ),
    ).toThrow(/change kind/u);
  });

  it("preserves evidence when two extracted turns are merged and never mutates inputs", () => {
    const first = turn("Alice in Toronto on September 12, 2026");
    const second = turn("Alice in Toronto tomorrow", { id: "turn-2", ts: first.ts + 1 });
    const embed = (_summary: string, kind: LoreNode["kind"]): number[] =>
      kind === "person" ? [1, 0] : [0, 1];
    const existing = extractTurn(first, { gazetteer, embed });
    const incoming = extractTurn(second, {
      gazetteer,
      embed,
      firstTurn: first,
      previousTurn: first,
    });
    const snapshots = structuredClone([existing, incoming]);
    const merged = mergeLore(existing, incoming);
    expect(merged.nodes.map((item) => item.id)).toEqual(existing.nodes.map((item) => item.id));
    for (const item of merged.nodes) {
      expect(item.refs).toEqual([first.id, second.id]);
      expect(merged.edges).toContainEqual(edge(first.id, item.id));
      expect(merged.edges).toContainEqual(edge(second.id, item.id));
    }
    expect([existing, incoming]).toEqual(snapshots);
    expect(merged).toEqual(mergeLore(existing, incoming));
    merged.nodes[0]?.refs.push("mutation");
    merged.nodes[0]?.embedding.push(999);
    const relation = merged.edges[0];
    if (relation) relation.weight = 999;
    expect([existing, incoming]).toEqual(snapshots);
  });
});

describe("cosineSimilarity", () => {
  it.each([
    [[], []],
    [
      [0, 0],
      [1, 0],
    ],
    [
      [1, 0],
      [0, 0],
    ],
    [[1], [1, 0]],
    [
      [Number.NaN, 0],
      [1, 0],
    ],
    [
      [1, 0],
      [Number.POSITIVE_INFINITY, 0],
    ],
  ])("does not infer similarity from invalid vectors %j and %j", (left, right) => {
    expect(cosineSimilarity(left, right)).toBeUndefined();
    const first = node("first", { embedding: left });
    const second = node("second", { embedding: right });
    expect(
      mergeLore({ nodes: [first], edges: [] }, { nodes: [second], edges: [] }).nodes,
    ).toHaveLength(2);
  });

  it("handles non-unit, huge, tiny, perpendicular and opposite vectors", () => {
    expect(cosineSimilarity([3, 4], [6, 8])).toBeCloseTo(1, 14);
    expect(cosineSimilarity([1e308, 1e308], [1e308, 1e308])).toBeCloseTo(1, 14);
    expect(cosineSimilarity([1e-308, 0], [1e-308, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });
});
