// natally — L.1 verify: LoreStore storage adapters (common core, web adapter, native shell).
// Vec-off path only: in-memory better-sqlite3 behind the SqliteDb seam (ddl.ts),
// no sqlite-vec extension in tests — retrieval therefore scores the stored Float32
// BLOBs with cosine computed in SQL-adjacent JS inside src/store/common.ts (the
// vec-on kNN MATCH path is deliberately not shipped untested; see the file header).
// The web adapter runs here with the memory database injected as its wa-sqlite
// handle; the native adapter runs against fixture invoke responses (its Rust twin
// lives in apps/local/src-tauri/src/lore_commands.rs and is exercised by cargo).
import Database from "better-sqlite3";
import { expect, test } from "vitest";
import type { SqliteDb } from "../src/ddl";
import { migrate } from "../src/migrate";
import { createSqliteLoreStore } from "../src/store/common";
import { createNativeLoreStore } from "../src/store/native";
import { createWebLoreStore } from "../src/store/web";
import type { LoreEdge, LoreNode, Turn } from "../src/types";

/** Deterministic bag-of-chars toy embedder — the real model is an injected host concern. */
const DIM = 8;
function toyEmbed(text: string): Promise<readonly number[]> {
  const vector = new Array<number>(DIM).fill(0);
  for (const ch of text.toLowerCase()) {
    const bucket = ch.charCodeAt(0) % DIM;
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return Promise.resolve(norm === 0 ? vector : vector.map((x) => x / norm));
}

function turn(id: string, text: string, personId?: string): Turn {
  return {
    id,
    sessionId: `session-${id}`,
    ...(personId === undefined ? {} : { personId }),
    role: "you",
    text,
    ts: 1_700_000_000_000,
  };
}

function openMemory(): SqliteDb {
  return new Database(":memory:");
}

test("store: upsert→query→export→delete cycle OK", async () => {
  const db = openMemory();
  // Web adapter with the memory database as the injected wa-sqlite handle.
  const store = await createWebLoreStore({
    sqlite3: { open: async () => db },
    embed: toyEmbed,
    embedDim: DIM,
  });

  const you = turn("t1", "moon over reykjavik", "p1");
  const tool: Turn = {
    id: "t2",
    sessionId: "session-t2",
    role: "tool",
    text: "dom.write stage",
    ts: 1_700_000_001_000,
    toolOps: [{ selector: "#stage", op: "text", value: "hi" }],
  };
  await store.upsertTurn(you, [...(await toyEmbed(you.text))]);
  await store.upsertTurn(tool, [...(await toyEmbed(tool.text))]);

  // Query: direct vector hit on the turn node, hops 0, traced back to its turn.
  const hits = await store.query(undefined, "moon over reykjavik", 8, 1500);
  const top = hits[0];
  expect(top?.nodeId).toBe("turn:t1");
  expect(top?.hops).toBe(0);
  expect(top?.sourceTurnId).toBe("t1");
  expect(top === undefined || top.score > 0.99).toBe(true);

  // Stats: summary line `[turns · nodes · runtime]` inputs (§8.4).
  await expect(store.stats()).resolves.toEqual({
    turns: 2,
    nodes: 2,
    edges: 0,
    runtime: "wa-sqlite/OPFS",
  });

  // Export: user-owned document, chart facts never (none stored), tool ops intact.
  const doc = await store.exportAll();
  expect(doc.exportVersion).toBe(1);
  expect(doc.turns).toHaveLength(2);
  // The safety-net session stubs carry no person linkage (the store cannot
  // fabricate people rows — see common.ts), so none are export-worthy here;
  // the conversation layer owns real people/sessions rows.
  expect(doc.sessions).toEqual([]);
  expect(doc.loreNodes).toHaveLength(2);
  expect(doc.loreEdges).toEqual([]);
  expect(doc.people).toEqual([]);
  expect(doc.charts).toEqual([]);
  expect(doc.consumedCodes).toEqual([]);
  const exportedTool = doc.turns.find((t) => t.id === "t2");
  expect(exportedTool?.toolOps).toEqual([{ selector: "#stage", op: "text", value: "hi" }]);
  expect(doc.loreNodes.every((node) => node.embedding.length === DIM)).toBe(true);

  // Delete: real deletion — rows + vectors gone, stats drop to zero, query drains.
  await store.deleteAll();
  await expect(store.stats()).resolves.toEqual({
    turns: 0,
    nodes: 0,
    edges: 0,
    runtime: "wa-sqlite/OPFS",
  });
  await expect(store.query(undefined, "moon over reykjavik", 8, 1500)).resolves.toEqual([]);
  const after = await store.exportAll();
  expect(after.turns).toEqual([]);
  expect(after.loreNodes).toEqual([]);
});

test("query is person-scoped and budget-capped (core, vec off)", async () => {
  const db = openMemory();
  expect(migrate(db, { vec: false })).toHaveLength(5);
  const store = createSqliteLoreStore(db, {
    vec: false,
    embed: toyEmbed,
    embedDim: DIM,
    runtime: "memory",
  });
  await store.upsertTurn(turn("a1", "mars retrograde", "p1"), [
    ...(await toyEmbed("mars retrograde")),
  ]);
  await store.upsertTurn(turn("a2", "venus transit", "p2"), [...(await toyEmbed("venus transit"))]);

  // Person-scoped: p1's store view only sees p1's nodes (§8.3).
  const scoped = await store.query("p1", "mars retrograde", 8, 1500);
  expect(scoped.map((hit) => hit.nodeId)).toEqual(["turn:a1"]);

  // Unscoped: both nodes, direct hit ranked first.
  const all = await store.query(undefined, "mars retrograde", 8, 1500);
  expect(all).toHaveLength(2);
  expect(all[0]?.nodeId).toBe("turn:a1");

  // Budget: one fragment max (each summary costs ceil(len/4) = 4 tokens).
  const capped = await store.query(undefined, "mars retrograde", 8, 4);
  expect(capped).toHaveLength(1);
  expect(capped[0]?.nodeId).toBe("turn:a1");

  // Dimension guard: a wrong-length embedding fails loudly.
  await expect(store.upsertTurn(turn("a3", "sun", "p1"), [1, 0])).rejects.toThrow(/dimension/);
});

test("native adapter shells invoke commands with validated payloads", async () => {
  const seen: Array<{ cmd: string; payload: unknown }> = [];
  const invoke = async (cmd: string, payload: unknown): Promise<unknown> => {
    seen.push({ cmd, payload });
    switch (cmd) {
      case "lore_upsert_turn":
        return { ok: true };
      case "lore_query":
        return [
          {
            nodeId: "turn:t1",
            kind: "event",
            summary: "moon",
            score: 0.9,
            sourceTurnId: "t1",
            hops: 0,
          },
        ];
      case "lore_export":
        return {
          exportVersion: 1,
          people: [],
          sessions: [],
          turns: [],
          charts: [],
          loreNodes: [],
          loreEdges: [],
          consumedCodes: [],
        };
      case "lore_delete_all":
        return { ok: true };
      case "lore_stats":
        return { turns: 1, nodes: 1, edges: 0, runtime: "rusqlite" };
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  };
  const store = createNativeLoreStore(invoke, { embed: toyEmbed });

  await store.upsertTurn(turn("t1", "moon"), [1, 0, 0]);
  const upsert = seen[0];
  expect(upsert?.cmd).toBe("lore_upsert_turn");
  const upsertPayload = upsert?.payload as { embedding: number[] } | undefined;
  expect(upsertPayload?.embedding).toEqual([1, 0, 0]);

  const fragments = await store.query("p1", "moon", 8, 1500);
  expect(fragments).toEqual([
    { nodeId: "turn:t1", kind: "event", summary: "moon", score: 0.9, sourceTurnId: "t1", hops: 0 },
  ]);
  const query = seen[1];
  expect(query?.payload).toMatchObject({
    personId: "p1",
    q: "moon",
    k: 8,
    budget: 1500,
    embed: toyVectorOf("moon"),
  });

  await expect(store.exportAll()).resolves.toMatchObject({ exportVersion: 1 });
  await expect(store.deleteAll()).resolves.toBeUndefined();
  await expect(store.stats()).resolves.toMatchObject({ turns: 1, runtime: "rusqlite" });
});

test("native adapter rejects contract-violating responses and embedder absence", async () => {
  const store = createNativeLoreStore(
    async () => [
      { nodeId: "n1", kind: "person", summary: "s", score: 0.5, sourceTurnId: "t1", hops: 3 },
    ],
    { embed: toyEmbed },
  );
  // hops: 3 is outside the 0–2 contract — the shell must not surface it.
  await expect(store.query(undefined, "q", 1, 100)).rejects.toThrow();

  const bare = openMemory();
  migrate(bare, { vec: false });
  const bareStore = createSqliteLoreStore(bare, { vec: false, runtime: "memory" });
  await expect(bareStore.query(undefined, "q", 1, 100)).rejects.toThrow(/embedder/);
  const bareNative = createNativeLoreStore(async () => ({ ok: true }));
  await expect(bareNative.query(undefined, "q", 1, 100)).rejects.toThrow(/embedder/);
});

test("flushTurn: one transactional batch — evidence node, node/edge upserts, idempotent re-flush", async () => {
  const db = openMemory();
  migrate(db, { vec: false });
  const store = createSqliteLoreStore(db, { vec: false, runtime: "memory" });
  const t = turn("f1", "alice met bob", "p1");
  const embed = [...(await toyEmbed(t.text))];
  const nodes: LoreNode[] = [
    {
      id: "lore:person:alice",
      kind: "person",
      summary: "Alice",
      embedding: [...(await toyEmbed("Alice"))],
      refs: ["f1"],
    },
    {
      id: "lore:person:bob",
      kind: "person",
      summary: "Bob",
      embedding: [...(await toyEmbed("Bob"))],
      refs: ["f1"],
    },
  ];
  const edges: LoreEdge[] = [
    {
      from: "lore:person:alice",
      to: "lore:person:bob",
      rel: "mentions",
      weight: 1,
      sourceTurnId: "f1",
    },
    {
      from: "lore:person:bob",
      to: "lore:person:alice",
      rel: "mentions",
      weight: 1,
      sourceTurnId: "f1",
    },
    // Same (from, to, rel, source_turn_id) as the first edge, different weight:
    // the ON CONFLICT clause must collapse the duplicate to the last write.
    {
      from: "lore:person:alice",
      to: "lore:person:bob",
      rel: "mentions",
      weight: 7,
      sourceTurnId: "f1",
    },
  ];

  await store.flushTurn(t, embed, { nodes, edges });

  // Rows: turn + evidence node + 2 extraction nodes; 3 edge writes → 2 rows.
  await expect(store.stats()).resolves.toEqual({
    turns: 1,
    nodes: 3,
    edges: 2,
    runtime: "memory",
  });
  const doc = await store.exportAll();
  const evidence = doc.loreNodes.find((node) => node.id === "turn:f1");
  expect(evidence).toMatchObject({ kind: "event", summary: t.text, refs: ["f1"] });
  expect(evidence?.embedding).toHaveLength(DIM);
  expect(doc.turns.map((row) => row.id)).toEqual(["f1"]);
  // Weight semantics: ABSOLUTE per turn, last write wins — never accumulate.
  const aliceBob = doc.loreEdges.find(
    (edge) =>
      edge.from === "lore:person:alice" && edge.to === "lore:person:bob" && edge.rel === "mentions",
  );
  expect(aliceBob).toMatchObject({ weight: 7, sourceTurnId: "f1" });

  // Re-flush of the SAME turn: guard + turn rows are INSERT OR IGNORE, the
  // node/edge upserts rewrite identical content — still exactly one row each.
  await store.flushTurn(t, embed, { nodes, edges });
  await expect(store.stats()).resolves.toEqual({
    turns: 1,
    nodes: 3,
    edges: 2,
    runtime: "memory",
  });
  const docAfter = await store.exportAll();
  expect(docAfter.turns.map((row) => row.id)).toEqual(["f1"]);
  expect(docAfter.loreNodes.map((node) => node.id).sort()).toEqual([
    "lore:person:alice",
    "lore:person:bob",
    "turn:f1",
  ]);
  expect(
    docAfter.loreEdges.find(
      (edge) =>
        edge.from === "lore:person:alice" &&
        edge.to === "lore:person:bob" &&
        edge.rel === "mentions",
    ),
  ).toMatchObject({ weight: 7 });
});

test("flushTurn: mid-transaction failure rolls back EVERYTHING — no partial rows", async () => {
  const db = openMemory();
  migrate(db, { vec: false });
  // Inject exactly ONE mid-flush statement failure through the SqliteDb seam:
  // the first lore_edges INSERT throws AFTER the session guard row, turn row,
  // evidence node and lore node of the SAME transaction have been written
  // (every flush statement carries a conflict clause, so no flush input can
  // raise a native constraint error mid-flush — the injected failure is the
  // only way to exercise the ROLLBACK path honestly).
  let failEdgesOnce = true;
  const flaky: SqliteDb = {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => {
      if (failEdgesOnce && sql.startsWith("INSERT INTO lore_edges")) {
        failEdgesOnce = false;
        throw new Error("lore store test: simulated mid-flush statement failure");
      }
      return db.prepare(sql);
    },
  };
  const store = createSqliteLoreStore(flaky, { vec: false, runtime: "memory" });
  const embed = [...(await toyEmbed("seed"))];
  const nodes: LoreNode[] = [
    {
      id: "lore:person:alice",
      kind: "person",
      summary: "Alice",
      embedding: embed,
      refs: ["f1"],
    },
  ];
  const edges: LoreEdge[] = [
    {
      from: "turn:f1",
      to: "lore:person:alice",
      rel: "mentions",
      weight: 1,
      sourceTurnId: "f1",
    },
  ];

  await expect(store.flushTurn(turn("f1", "seed", "p1"), embed, { nodes, edges })).rejects.toThrow(
    /mid-flush/,
  );

  // EVERYTHING rolled back: the guard session, the turn row, the evidence node
  // and the lore node written before the failure are all gone — no partials.
  await expect(store.stats()).resolves.toEqual({
    turns: 0,
    nodes: 0,
    edges: 0,
    runtime: "memory",
  });
  const sessions = db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
  expect(sessions.n).toBe(0);

  // The store is uncorrupted: the identical flush (failure spent) succeeds.
  await store.flushTurn(turn("f1", "seed", "p1"), embed, { nodes, edges });
  await expect(store.stats()).resolves.toEqual({
    turns: 1,
    nodes: 2,
    edges: 1,
    runtime: "memory",
  });
});

/** Helper mirroring toyEmbed for payload assertions (kept async-free for toMatchObject). */
function toyVectorOf(text: string): number[] {
  const vector = new Array<number>(DIM).fill(0);
  for (const ch of text.toLowerCase()) {
    const bucket = ch.charCodeAt(0) % DIM;
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? vector : vector.map((x) => x / norm);
}
