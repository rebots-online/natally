import {
  ChartInputsSchema,
  CompanionEventSchema,
  ConsumedCodeSchema,
  DomWriteOpSchema,
  ExportDocumentSchema,
  LoreEdgeSchema,
  LoreNodeSchema,
  PersonSchema,
  SessionSchema,
  TurnSchema,
} from "@natally/lore";
import type { LoreStore as SourceLoreStore } from "@natally/lore/src/store.ts";
import { TurnSchema as SourceTurnSchema } from "@natally/lore/src/types.ts";
import type { LoreStore } from "@natally/lore/store";
import * as storeModule from "@natally/lore/store.js";
import type {
  ChartInputs,
  CompanionEvent,
  DomWriteOp,
  ExportDocument,
  LoreEdge,
  LoreNode,
  Person,
  LoreStore as PublicLoreStore,
  Session,
  Turn,
} from "@natally/lore/types";
import { ExportDocumentSchema as ExplicitSchema } from "@natally/lore/types.js";
import { describe, expect, expectTypeOf, it } from "vitest";

const person = {
  id: "person-1",
  name: "Alex",
  birth: { date: "1990-04-12", place: "Toronto, Canada", timeKnown: false },
} satisfies Person;

const session = {
  id: "session-1",
  personId: person.id,
  startedAt: 1_789_214_400_000,
} satisfies Session;

const turn = {
  id: "turn-1",
  sessionId: session.id,
  role: "her",
  text: "You mentioned Toronto — what would you like to explore? 🌙",
  ts: session.startedAt + 1_000,
} satisfies Turn;

const toolOps = [
  { selector: "#composer", op: "text", value: "Show my natal chart" },
  { selector: "#composer", op: "class", value: "ready" },
  { selector: "#composer", op: "focus", value: "" },
] satisfies DomWriteOp[];

const toolTurn = {
  ...turn,
  id: "turn-2",
  role: "tool",
  personId: person.id,
  text: JSON.stringify(toolOps),
  toolOps,
} satisfies Turn;

const node = {
  id: "node-1",
  kind: "place",
  summary: "Toronto was mentioned in the conversation.",
  embedding: [0.25, -0.5, 0, 1],
  refs: [turn.id],
} satisfies LoreNode;

const edge = {
  from: node.id,
  to: "node-2",
  rel: "mentions",
  weight: 3,
  sourceTurnId: turn.id,
} satisfies LoreEdge;

const document = {
  exportVersion: 1,
  people: [person],
  sessions: [session],
  turns: [{ ...turn, id: "turn-0", role: "you", text: "I was born in Toronto." }, turn, toolTurn],
  charts: [
    {
      id: "chart-1",
      personIds: [person.id],
      ut: [2_448_263.5],
      place: { lat: 43.6532, lon: -79.3832 },
      system: "P",
    },
  ],
  loreNodes: [node, { ...node, id: edge.to, kind: "thread" }],
  loreEdges: [edge],
  consumedCodes: [{ codeHash: "sha256:redeemed-code", redeemedAt: session.startedAt }],
} satisfies ExportDocument;

function fromJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error("Invalid JSON in lore contract roundtrip", { cause });
  }
}

describe("export document", () => {
  it("lore types: roundtrip OK", () => {
    const parsed = ExportDocumentSchema.parse(fromJson(JSON.stringify(document)));
    expect(parsed).toStrictEqual(document);
    expect(parsed.people[0]?.birth).not.toHaveProperty("time");
    expect(parsed.turns.map(({ role }) => role)).toEqual(["you", "her", "tool"]);
    expect(parsed.loreNodes[0]?.embedding).toEqual([0.25, -0.5, 0, 1]);
    expect(parsed.loreEdges[0]?.sourceTurnId).toBe(turn.id);
    expect(parsed.consumedCodes).toStrictEqual(document.consumedCodes);
    expect(parsed.charts).toStrictEqual(document.charts);
    expect(parsed.turns[2]?.personId).toBe(person.id);
    expect(parsed.turns[2]?.toolOps).toStrictEqual(toolOps);
    console.log("lore types: roundtrip OK");
  });

  it("preserves an empty export after delete-everything", () => {
    const empty = {
      exportVersion: 1,
      people: [],
      sessions: [],
      turns: [],
      charts: [],
      loreNodes: [],
      loreEdges: [],
      consumedCodes: [],
    };
    expect(ExportDocumentSchema.parse(fromJson(JSON.stringify(empty)))).toStrictEqual(empty);
  });

  it.each([0, 2, "1", null, undefined])("rejects export version %s", (exportVersion) => {
    expect(ExportDocumentSchema.safeParse({ ...document, exportVersion }).success).toBe(false);
  });

  it.each(["people", "sessions", "turns", "charts", "loreNodes", "loreEdges", "consumedCodes"])(
    "requires the %s collection",
    (collection) => {
      const incomplete: Record<string, unknown> = { ...document };
      delete incomplete[collection];
      expect(ExportDocumentSchema.safeParse(incomplete).success).toBe(false);
    },
  );

  it.each(["positions", "cusps", "aspects"])("rejects cached chart %s", (field) => {
    const cached = { ...document.charts[0], [field]: [1, 2, 3] };
    expect(ChartInputsSchema.safeParse(cached).success).toBe(false);
    expect(ExportDocumentSchema.safeParse({ ...document, charts: [cached] }).success).toBe(false);
  });

  it.each([
    { kind: "natal", ut: [2_448_263.5], personIds: [person.id], system: "P" },
    {
      kind: "synastry",
      ut: [2_448_263.5, 2_447_392.75],
      personIds: [person.id, "person-2"],
      system: "W",
    },
    {
      kind: "today",
      ut: [2_448_263.5, 2_461_295.125],
      personIds: [person.id],
      system: "K",
    },
  ] as const)(
    "preserves all $kind recomputation inputs in order",
    ({ kind, ut, personIds, system }) => {
      const chart = {
        id: `chart-${kind}`,
        personIds: [...personIds],
        ut: [...ut],
        place: { lat: 43.6532, lon: -79.3832 },
        system,
      } satisfies ChartInputs;
      const exported = { ...document, charts: [chart] };
      const parsed = ExportDocumentSchema.parse(fromJson(JSON.stringify(exported)));
      expect(parsed.charts).toStrictEqual([chart]);
      const [restored] = parsed.charts;
      expect(restored?.personIds).toEqual(personIds);
      expect(restored?.ut).toEqual(ut);
      expect(restored?.system).toBe(system);
      expect(restored?.place).toStrictEqual(chart.place);
    },
  );

  it.each(["P", "K", "O", "R", "C", "A", "V", "W", "T", "X", "B", "U"] as const)(
    "roundtrips the supported house system %s",
    (system) => {
      const chart = { ...document.charts[0], system };
      const exported = { ...document, charts: [chart] };
      expect(ExportDocumentSchema.parse(fromJson(JSON.stringify(exported))).charts).toStrictEqual([
        chart,
      ]);
    },
  );

  it.each([
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "L",
    "M",
    "N",
    "Q",
    "S",
    "Y",
    "Z",
    "p",
    "Placidus",
    "",
    null,
    undefined,
  ])("rejects a house system outside the closed set: %s", (system) => {
    const chart = { ...document.charts[0], system };
    expect(ExportDocumentSchema.safeParse({ ...document, charts: [chart] }).success).toBe(false);
  });

  it.each([
    { ut: 2_448_263.5 },
    { ut: [] },
    { ut: ["2448263.5"] },
    { ut: [Number.NaN] },
    { ut: [Number.POSITIVE_INFINITY] },
    { ut: [2_448_263.5, Number.NEGATIVE_INFINITY] },
    { ut: null },
    { ut: undefined },
  ])("rejects invalid or lossy UT inputs %j", ({ ut }) => {
    const chart = { ...document.charts[0], ut };
    expect(ExportDocumentSchema.safeParse({ ...document, charts: [chart] }).success).toBe(false);
  });

  it("rejects malformed nested entities and extra export fields", () => {
    expect(ExportDocumentSchema.safeParse({ ...document, secrets: {} }).success).toBe(false);
    expect(
      ExportDocumentSchema.safeParse({
        ...document,
        loreEdges: [{ ...edge, sourceTurnId: 42 }],
      }).success,
    ).toBe(false);
    expect(
      ExportDocumentSchema.safeParse({
        ...document,
        consumedCodes: [{ codeHash: "hash" }],
      }).success,
    ).toBe(false);
  });

  it.each([
    { lat: -91, lon: 0 },
    { lat: 91, lon: 0 },
    { lat: 0, lon: -181 },
    { lat: 0, lon: 181 },
    { lat: Number.NaN, lon: 0 },
    { lat: 0, lon: Number.POSITIVE_INFINITY },
  ])("rejects invalid chart coordinates %j", (place) => {
    expect(ChartInputsSchema.safeParse({ ...document.charts[0], place }).success).toBe(false);
  });
});

describe("conversation records", () => {
  it("preserves supplied birth time and an unknown birth time without inventing one", () => {
    expect(PersonSchema.parse(person)).toStrictEqual(person);
    const timed = { ...person, birth: { ...person.birth, time: "08:30", timeKnown: true } };
    expect(PersonSchema.parse(timed)).toStrictEqual(timed);
    expect(
      PersonSchema.safeParse({ ...person, birth: { ...person.birth, timeKnown: "no" } }).success,
    ).toBe(false);
  });

  it.each(["you", "her", "tool"] as const)("roundtrips the %s role", (role) => {
    const record = { ...turn, role };
    expect(TurnSchema.parse(fromJson(JSON.stringify(record)))).toStrictEqual(record);
  });

  it("keeps optional person scope and tool operations absent when they were not recorded", () => {
    const parsed = TurnSchema.parse(fromJson(JSON.stringify(turn)));
    expect(parsed).toStrictEqual(turn);
    expect(parsed).not.toHaveProperty("personId");
    expect(parsed).not.toHaveProperty("toolOps");
    expect(TurnSchema.parse({ ...turn, toolOps: [] }).toolOps).toStrictEqual([]);
  });

  it.each(["you", "her", "tool"] as const)(
    "preserves optional person scope for %s turns",
    (role) => {
      const scoped = { ...turn, role, personId: person.id } satisfies Turn;
      expect(TurnSchema.parse(fromJson(JSON.stringify(scoped)))).toStrictEqual(scoped);
    },
  );

  it("preserves ordered DOM operations and person scope through the companion bus", () => {
    const event = { type: "turn", turn: toolTurn } satisfies CompanionEvent;
    const parsed = CompanionEventSchema.parse(fromJson(JSON.stringify(event)));
    expect(parsed).toStrictEqual(event);
    expect(TurnSchema.parse(toolTurn).toolOps).toStrictEqual(toolOps);
  });

  it.each([
    { personId: "" },
    { personId: 7 },
    { personId: null },
    { toolOps: null },
    { toolOps: { selector: "#composer", op: "focus", value: "" } },
    { toolOps: [{ selector: "#composer", op: "remove", value: "" }] },
    { toolOps: [{ selector: "#composer", op: "text" }] },
    { toolOps: [{ selector: "#composer", op: "text", value: 7 }] },
  ])("rejects malformed optional turn fields %j", (fields) => {
    const malformed = { ...toolTurn, ...fields };
    expect(TurnSchema.safeParse(malformed).success).toBe(false);
    expect(CompanionEventSchema.safeParse({ type: "turn", turn: malformed }).success).toBe(false);
    expect(ExportDocumentSchema.safeParse({ ...document, turns: [malformed] }).success).toBe(false);
  });

  it.each(["assistant", "user", "system", "function"])("rejects role %s", (role) => {
    expect(TurnSchema.safeParse({ ...turn, role }).success).toBe(false);
  });

  it("validates identifiers, timestamps, and single-use code records", () => {
    expect(SessionSchema.parse(session)).toStrictEqual(session);
    expect(SessionSchema.safeParse({ ...session, personId: "" }).success).toBe(false);
    expect(SessionSchema.safeParse({ ...session, startedAt: "yesterday" }).success).toBe(false);
    expect(TurnSchema.safeParse({ ...turn, ts: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(ConsumedCodeSchema.safeParse({ codeHash: "", redeemedAt: 0 }).success).toBe(false);
  });
});

describe("lore graph", () => {
  it.each(["person", "fact", "event", "thread", "place"] as const)(
    "roundtrips %s nodes",
    (kind) => {
      const record = { ...node, kind };
      expect(LoreNodeSchema.parse(fromJson(JSON.stringify(record)))).toStrictEqual(record);
    },
  );

  it.each(["mentions", "relates", "follows", "contradicts"] as const)(
    "roundtrips %s edges with accumulated weight and turn provenance",
    (rel) => {
      const record = { ...edge, rel };
      expect(LoreEdgeSchema.parse(fromJson(JSON.stringify(record)))).toStrictEqual(record);
    },
  );

  it("rejects unknown kinds, relations, invalid references, and missing provenance", () => {
    expect(LoreNodeSchema.safeParse({ ...node, kind: "memory" }).success).toBe(false);
    expect(LoreNodeSchema.safeParse({ ...node, refs: [3] }).success).toBe(false);
    expect(LoreEdgeSchema.safeParse({ ...edge, rel: "supports" }).success).toBe(false);
    const { sourceTurnId: _sourceTurnId, ...withoutSource } = edge;
    expect(LoreEdgeSchema.safeParse(withoutSource).success).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects nonfinite graph numbers %s",
    (value) => {
      expect(LoreNodeSchema.safeParse({ ...node, embedding: [value] }).success).toBe(false);
      expect(LoreEdgeSchema.safeParse({ ...edge, weight: value }).success).toBe(false);
    },
  );

  it("accepts configured embedding dimensions without hard-coding 384", () => {
    for (const dimension of [3, 384, 768]) {
      const record = { ...node, embedding: Array.from({ length: dimension }, () => 0.5) };
      expect(LoreNodeSchema.parse(record).embedding).toHaveLength(dimension);
    }
  });
});

describe("DOM writes", () => {
  it.each(["setattr", "text", "class", "focus", "scroll"] as const)("roundtrips %s", (op) => {
    const operation = { selector: "#composer", op, value: "" } satisfies DomWriteOp;
    expect(DomWriteOpSchema.parse(fromJson(JSON.stringify(operation)))).toStrictEqual(operation);
  });

  it("rejects operations outside the closed set and missing or malformed values", () => {
    expect(DomWriteOpSchema.safeParse({ selector: "body", op: "remove", value: "" }).success).toBe(
      false,
    );
    expect(DomWriteOpSchema.safeParse({ selector: "body", op: "focus" }).success).toBe(false);
    expect(DomWriteOpSchema.safeParse({ selector: "body", op: "text", value: 7 }).success).toBe(
      false,
    );
  });
});

describe("companion bus", () => {
  const events: CompanionEvent[] = [
    { type: "token", token: "🌙" },
    { type: "turn", turn },
    { type: "chart-computed", chartId: "chart-1" },
    { type: "envelope-start" },
    { type: "envelope-level", level: 0.5 },
    { type: "envelope-end" },
    { type: "error", message: "Engine unavailable" },
  ];

  it.each(events)("roundtrips $type and its payload", (event) => {
    expect(CompanionEventSchema.parse(fromJson(JSON.stringify(event)))).toStrictEqual(event);
  });

  it("preserves the speaking lifecycle as start, bounded levels, then end", () => {
    const lifecycle = [
      { type: "envelope-start" },
      { type: "envelope-level", level: 0 },
      { type: "envelope-level", level: 1 },
      { type: "envelope-end" },
    ];
    expect(lifecycle.map((event) => CompanionEventSchema.parse(event))).toStrictEqual(lifecycle);
  });

  it.each([-0.001, 1.001, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null, undefined])(
    "rejects an invalid RMS level %s",
    (level) => {
      expect(CompanionEventSchema.safeParse({ type: "envelope-level", level }).success).toBe(false);
    },
  );

  it.each([
    { type: "envelope", level: 0.5 },
    { type: "envelope-start", level: 0 },
    { type: "envelope-end", level: 0 },
    { type: "thinking" },
    { type: "token" },
    { type: "turn", turn: { ...turn, role: "assistant" } },
    { type: "chart-computed" },
    { type: "error", message: 42 },
  ])("rejects invalid bus event %j", (event) => {
    expect(CompanionEventSchema.safeParse(event).success).toBe(false);
  });
});

describe("package and store contract", () => {
  it("exposes explicit ESM subpaths and keeps the store interface free of implementation", () => {
    expect(ExplicitSchema).toBe(ExportDocumentSchema);
    expect(SourceTurnSchema).toBe(TurnSchema);
    expect(Object.keys(storeModule)).toEqual([]);
    expectTypeOf<PublicLoreStore>().toEqualTypeOf<LoreStore>();
    expectTypeOf<SourceLoreStore>().toEqualTypeOf<LoreStore>();
  });

  it("types person-scoped retrieval, embedding writes, graph export, deletion, and statistics", () => {
    expectTypeOf<LoreStore["query"]>().parameters.toEqualTypeOf<
      [personId: string | undefined, q: string, k: number, budget: number]
    >();
    expectTypeOf<LoreStore["query"]>().returns.toEqualTypeOf<
      Promise<{ nodes: LoreNode[]; edges: LoreEdge[] }>
    >();
    expectTypeOf<LoreStore["upsertTurn"]>().parameters.toEqualTypeOf<
      [turn: Turn, embedding: number[]]
    >();
    expectTypeOf<LoreStore["upsertTurn"]>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<LoreStore["exportAll"]>().returns.toEqualTypeOf<
      Promise<{ nodes: LoreNode[]; edges: LoreEdge[] }>
    >();
    expectTypeOf<LoreStore["deleteAll"]>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<LoreStore["stats"]>().returns.toEqualTypeOf<
      Promise<{ turns: number; nodes: number; edges: number }>
    >();
  });
});
