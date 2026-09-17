import type { ExportDocument } from "@natally/lore";

/** Fixed IDs, timestamps and float32-exact embeddings make JSON roundtrips deterministic. */
export const exportFixture: ExportDocument = {
  exportVersion: 1,
  people: [
    {
      id: "p1",
      name: "Ada",
      birth: { date: "1990-04-12", time: "06:30", place: "Toronto", timeKnown: true },
    },
    { id: "p2", name: "Lin", birth: { date: "1992-07-03", place: "Montréal", timeKnown: false } },
  ],
  sessions: [
    { id: "s1", personId: "p1", startedAt: 1000 },
    { id: "s2", personId: "p2", startedAt: 2000 },
    { id: "s3-empty", personId: "p1", startedAt: 3000 },
  ],
  turns: [
    {
      id: "t1",
      sessionId: "s1",
      personId: "p1",
      role: "you",
      text: "My birth time is 06:30.",
      ts: 1010,
    },
    {
      id: "t2",
      sessionId: "s1",
      role: "her",
      text: "I have saved the time you supplied.",
      ts: 1020,
    },
    {
      id: "t3",
      sessionId: "s2",
      personId: "p2",
      role: "tool",
      text: "Focused the chart.",
      ts: 2010,
      toolOps: [{ selector: "[data-chart]", op: "focus", value: "" }],
    },
  ],
  charts: [
    {
      id: "c1",
      personIds: ["p1"],
      ut: [2447993.9375],
      place: { lat: 43.65, lon: -79.38 },
      system: "P",
    },
    {
      id: "c2",
      personIds: ["p1", "p2"],
      ut: [2447993.9375, 2448807.5],
      place: { lat: 43.65, lon: -79.38 },
      system: "W",
    },
    {
      id: "c3",
      personIds: ["p2"],
      ut: [2448807.5],
      place: { lat: 45.5, lon: -73.57 },
      system: "W",
    },
  ],
  loreNodes: [
    {
      id: "fact1",
      kind: "fact",
      summary: "A supplied birth time.",
      embedding: [0.5, 0.25, 0],
      refs: ["t1"],
    },
    { id: "p1", kind: "person", summary: "Ada", embedding: [1, 0, 0], refs: ["t1"] },
    { id: "p2", kind: "person", summary: "Lin", embedding: [0, 1, 0], refs: ["t3"] },
  ],
  loreEdges: [
    { from: "fact1", to: "p1", rel: "mentions", weight: 1, sourceTurnId: "t1" },
    { from: "fact1", to: "p2", rel: "relates", weight: 0.5, sourceTurnId: "t3" },
    { from: "p1", to: "p2", rel: "relates", weight: 2, sourceTurnId: "t1" },
  ],
  consumedCodes: [
    { codeHash: "hash-a", redeemedAt: 50 },
    { codeHash: "hash-b", redeemedAt: 60 },
  ],
};
