// T0.6 — lore & conversation contracts roundtrip test.
// Proves the zod schemas and exported types line up, that an ExportDocument
// survives a JSON roundtrip, and that the CompanionEvent union discriminates.
import { expect, test } from "vitest";
import type { LoreStore } from "../src/store";
import {
  ChartComputedEventSchema,
  CompanionErrorEventSchema,
  CompanionEventSchema,
  EnvelopeEventSchema,
  type ExportDocument,
  ExportDocumentSchema,
  TokenEventSchema,
  TurnEventSchema,
} from "../src/types";

// Compile-time seam proof: an implementable stub keeps the interface honest.
const _stubStore: LoreStore = {
  async query() {
    return [];
  },
  async upsertTurn() {},
  async exportAll() {
    throw new Error("not implemented");
  },
  async deleteAll() {},
  async stats() {
    return { turns: 0, nodes: 0, edges: 0, runtime: "stub" };
  },
};

const exportDocumentFixture = {
  exportVersion: 1,
  people: [
    {
      id: "person-1",
      name: "Robin",
      // honest absence: time unknown ⇒ no `time`, no Ascendant anywhere (§6)
      birth: { date: "1990-05-21", place: "Oslo", timeKnown: false },
    },
  ],
  sessions: [{ id: "session-1", personId: "person-1", startedAt: 1_760_000_000_000 }],
  turns: [
    {
      id: "turn-1",
      sessionId: "session-1",
      personId: "person-1",
      role: "you",
      text: "Where is my Moon?",
      ts: 1_760_000_001_000,
    },
    {
      id: "turn-2",
      sessionId: "session-1",
      role: "tool",
      text: "dom.write applied",
      ts: 1_760_000_002_000,
      toolOps: [{ selector: "#stage", op: "class", value: "delighted" }],
    },
  ],
  // chart INPUTS only — computed facts are never exported (§5)
  charts: [
    {
      id: "chart-1",
      personIds: ["person-1"],
      ut: "1990-05-21T12:00:00Z",
      place: { lat: 59.9139, lon: 10.7522, label: "Oslo" },
    },
  ],
  loreNodes: [
    {
      id: "node-1",
      kind: "person",
      summary: "Robin mentions Oslo often",
      embedding: [0.1, -0.2, 0.3],
      refs: ["turn-1"],
    },
  ],
  loreEdges: [
    { from: "node-1", to: "node-1", rel: "mentions", weight: 1.5, sourceTurnId: "turn-1" },
  ],
  consumedCodes: [{ codeHash: "deadbeef", redeemedAt: 1_760_000_003_000 }],
} as const;

test("lore types: roundtrip OK", () => {
  // Parse: fixture validates against every entity schema and the types line up.
  const doc: ExportDocument = ExportDocumentSchema.parse(exportDocumentFixture);
  expect(doc.people).toHaveLength(1);
  expect(doc.turns[1]?.toolOps?.[0]?.op).toBe("class");
  expect(doc.people[0]?.birth.time).toBeUndefined();

  // Roundtrip through JSON: shape survives, revalidation succeeds, deep-equal holds.
  const json = JSON.stringify(doc);
  const restored: ExportDocument = ExportDocumentSchema.parse(JSON.parse(json));
  expect(restored).toEqual(doc);

  // exportVersion is pinned to 1 (J8).
  expect(ExportDocumentSchema.safeParse({ ...doc, exportVersion: 2 }).success).toBe(false);
  // Tool turns without ops are contract-illegal shapes to rely on; a non-tool turn
  // must not smuggle an unknown role.
  expect(
    ExportDocumentSchema.safeParse({
      ...doc,
      turns: [{ ...doc.turns[0], role: "narrator" }],
    }).success,
  ).toBe(false);
});

test("lore types: companion event union discriminates", () => {
  const token = TokenEventSchema.parse({ type: "token", turnId: "turn-1", text: "Your" });
  const turn = TurnEventSchema.parse({ type: "turn", turn: doc0Turn() });
  const chart = ChartComputedEventSchema.parse({ type: "chart-computed", chartId: "chart-1" });
  const envelope = EnvelopeEventSchema.parse({ type: "envelope", rms: 0.5 });
  const error = CompanionErrorEventSchema.parse({ type: "error", message: "engine down" });

  const parsed = [token, turn, chart, envelope, error].map((e) => CompanionEventSchema.parse(e));
  expect(parsed.filter((e) => e.type === "token")).toHaveLength(1);

  // Exhaustive narrowing over the union (compile-time proof of discrimination).
  const kinds: string[] = [];
  for (const event of parsed) {
    switch (event.type) {
      case "token":
        kinds.push(`token:${event.text}`);
        break;
      case "turn":
        kinds.push(`turn:${event.turn.id}`);
        break;
      case "chart-computed":
        kinds.push(`chart-computed:${event.chartId}`);
        break;
      case "envelope":
        kinds.push(`envelope:${event.rms}`);
        break;
      case "error":
        kinds.push(`error:${event.message}`);
        break;
    }
  }
  expect(kinds).toEqual([
    "token:Your",
    "turn:turn-x",
    "chart-computed:chart-1",
    "envelope:0.5",
    "error:engine down",
  ]);

  // Unknown discriminator and out-of-range rms are rejected.
  expect(CompanionEventSchema.safeParse({ type: "mood", level: 10 }).success).toBe(false);
  expect(EnvelopeEventSchema.safeParse({ type: "envelope", rms: 1.5 }).success).toBe(false);
});

function doc0Turn(): { id: string; sessionId: string; role: "her"; text: string; ts: number } {
  return { id: "turn-x", sessionId: "session-1", role: "her", text: "Hi", ts: 1 };
}
