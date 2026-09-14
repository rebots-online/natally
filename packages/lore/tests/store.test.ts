import Database from "better-sqlite3";
import { load as loadVec } from "sqlite-vec";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../src/migrate.js";
import {
  type Graph,
  type ManagedLoreStore,
  migrateAsync,
  type SqlRow,
} from "../src/store/common.js";
import { createNativeLoreStore, type NativeInvoke } from "../src/store/native.js";
import { createWebLoreStore, synchronousConnection } from "../src/store/web.js";
import type { LoreNode, Turn } from "../src/types.js";

const databases: Database.Database[] = [];
const stores: ManagedLoreStore[] = [];
const embedding = [0.25, 0.5, -0.75];
const turn = (id: string, text: string, personId = "alice", role: Turn["role"] = "you"): Turn => ({
  id,
  text,
  personId,
  sessionId: `session-${personId}`,
  role,
  ts: 1_700_000_000_001,
});
const node = (id: string, summary: string, refs = ["a"]): LoreNode => ({
  id,
  kind: "fact",
  summary,
  refs,
  embedding,
});
function database() {
  const db = new Database(":memory:");
  databases.push(db);
  return db;
}
function seed(db: Database.Database) {
  for (const id of ["alice", "bob"]) {
    db.prepare(
      "INSERT INTO people (id, name, birth_date, time_known, place) VALUES (?, ?, '1990-01-01', 0, 'Toronto')",
    ).run(id, id);
    db.prepare("INSERT INTO sessions (id, person_id, started_at) VALUES (?, ?, 100)").run(
      `session-${id}`,
      id,
    );
  }
}
async function fixture(options: Parameters<typeof createWebLoreStore>[0] = {}) {
  const db = database();
  const store = await createWebLoreStore({ ...options, database: db });
  stores.push(store);
  seed(db);
  return { db, store };
}

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const db of databases.splice(0)) if (db.open) db.close();
});

describe("LoreStore using real in-memory SQLite through the web adapter", () => {
  it("store: upsert→query→export→delete cycle OK", async () => {
    const { db, store } = await fixture();
    const source = turn("a", "Alice remembers the Montréal observatory.");
    source.toolOps = [{ selector: "#chart", op: "focus", value: "" }];
    await store.upsertTurn(source, embedding);
    const result = await store.query("alice", "Montréal", 8, 1500);
    expect(result).toEqual({
      nodes: [{ id: "turn:a", kind: "thread", summary: source.text, embedding, refs: ["a"] }],
      edges: [],
    });
    expect(await store.exportAll()).toEqual(result);
    expect(await store.stats()).toEqual({ turns: 1, nodes: 1, edges: 0 });
    const persisted = db.prepare("SELECT role, text, ts, tool_ops FROM turns WHERE id='a'").get();
    expect(persisted).toEqual({
      role: "you",
      text: source.text,
      ts: source.ts,
      tool_ops: JSON.stringify(source.toolOps),
    });
    expect(db.prepare("SELECT typeof(embedding) AS type FROM lore_nodes").get()).toEqual({
      type: "blob",
    });
    await store.deleteAll();
    expect(await store.query(undefined, "Montréal", 8, 1500)).toEqual({ nodes: [], edges: [] });
    expect(await store.exportAll()).toEqual({ nodes: [], edges: [] });
    // LoreStore.deleteAll owns lore. The app deletion coordinator owns transcripts.
    expect(await store.stats()).toEqual({ turns: 1, nodes: 0, edges: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM people").get()).toEqual({ n: 2 });
    console.log("store: upsert→query→export→delete cycle OK");
  });

  it("updates a repeated turn id without duplicating rows, preserving all three roles", async () => {
    const { store } = await fixture();
    await store.upsertTurn(turn("a", "old text"), embedding);
    await store.upsertTurn(turn("a", "revised text"), [1, 2, 3]);
    await store.upsertTurn(turn("b", "companion reply", "alice", "her"), embedding);
    await store.upsertTurn(turn("c", "tool reply", "alice", "tool"), embedding);
    expect(await store.stats()).toEqual({ turns: 3, nodes: 3, edges: 0 });
    expect((await store.query("alice", "old text", 8, 1500)).nodes.map((n) => n.summary)).toEqual([
      "revised text",
    ]);
    expect((await store.exportAll()).nodes[0]).toMatchObject({
      summary: "revised text",
      embedding: [1, 2, 3],
    });
  });

  it("scopes nodes through source turns, falling back to the session owner", async () => {
    const { store } = await fixture();
    const alice = turn("a", "A shared observatory");
    delete alice.personId;
    await store.upsertTurn(alice, embedding);
    await store.upsertTurn(turn("b", "B shared observatory", "bob"), embedding);
    expect((await store.query("alice", "observatory", 8, 1500)).nodes.map((n) => n.id)).toEqual([
      "turn:a",
    ]);
    expect((await store.query("bob", "observatory", 8, 1500)).nodes.map((n) => n.id)).toEqual([
      "turn:b",
    ]);
    expect((await store.query(undefined, "observatory", 8, 1500)).nodes).toHaveLength(2);
    expect((await store.query("unknown", "observatory", 8, 1500)).nodes).toEqual([]);
  });

  it("binds quotes and literal wildcard characters without changing the query", async () => {
    const { store } = await fixture();
    await store.upsertTurn(turn("a", "100%_\\ O'Brien 星"), embedding);
    await store.upsertTurn(turn("b", "unrelated"), embedding);
    for (const query of ["%", "_", "\\", "O'Brien", "星"]) {
      expect((await store.query(undefined, query, 8, 1500)).nodes.map((n) => n.id)).toEqual([
        "turn:a",
      ]);
    }
    expect((await store.query(undefined, "';DROP", 8, 1500)).nodes).toEqual([]);
    expect(await store.stats()).toEqual({ turns: 2, nodes: 2, edges: 0 });
  });

  it("persists graph edges, includes only two hops, respects k and the retrieval budget", async () => {
    const { store } = await fixture({
      projectTurn: () => ({ nodes: [], edges: [] }),
      countTokens: (text) => text.length,
    });
    await store.upsertTurn(turn("a", "source"), embedding);
    const graph: Graph = {
      nodes: [node("1", "seed"), node("2", "near"), node("3", "next"), node("4", "far")],
      edges: [
        { from: "1", to: "2", rel: "mentions", weight: 2, sourceTurnId: "a" },
        { from: "2", to: "3", rel: "relates", weight: 1, sourceTurnId: "a" },
        { from: "3", to: "4", rel: "follows", weight: 1, sourceTurnId: "a" },
      ],
    };
    await store.upsertGraph(graph);
    await store.upsertGraph(graph);
    expect(await store.exportAll()).toEqual(graph);
    expect(await store.stats()).toEqual({ turns: 1, nodes: 4, edges: 3 });
    const result = await store.query("alice", "seed", 1, 1500);
    expect(result.nodes.map((n) => n.id)).toEqual(["1", "2", "3"]);
    expect(result.edges).toEqual(graph.edges.slice(0, 2));
    expect(await store.query("alice", "seed", 1, 4)).toEqual({
      nodes: [graph.nodes[0]],
      edges: [],
    });
    expect(await store.query("alice", "seed", 1, 3)).toEqual({ nodes: [], edges: [] });
    expect(await store.query("alice", "seed", 0, 1500)).toEqual({ nodes: [], edges: [] });
    expect((await store.query("alice", "", 1, 0)).nodes).toEqual([]);
  });

  it("does not export another person's edge provenance in scoped retrieval", async () => {
    const { store } = await fixture();
    await store.upsertTurn(turn("a", "Alice source"), embedding);
    await store.upsertTurn(turn("b", "Bob source", "bob"), embedding);
    await store.upsertGraph({
      nodes: [node("1", "shared", ["a", "b"]), node("2", "shared", ["a", "b"])],
      edges: [{ from: "1", to: "2", rel: "mentions", weight: 1, sourceTurnId: "b" }],
    });
    expect((await store.query("alice", "shared", 8, 1500)).edges).toEqual([]);
    expect((await store.query("bob", "shared", 8, 1500)).edges).toHaveLength(1);
  });

  it("rolls back the complete turn/graph batch when SQLite rejects a graph write", async () => {
    const { db, store } = await fixture();
    db.exec(
      "CREATE TRIGGER reject_lore BEFORE INSERT ON lore_nodes BEGIN SELECT RAISE(ABORT, 'graph rejected'); END",
    );
    await expect(store.upsertTurn(turn("a", "failed"), embedding)).rejects.toThrow(
      "graph rejected",
    );
    expect(await store.stats()).toEqual({ turns: 0, nodes: 0, edges: 0 });
  });

  it("does not fabricate sessions to satisfy the foreign key", async () => {
    const { store } = await fixture();
    await expect(
      store.upsertTurn({ ...turn("a", "missing session"), sessionId: "missing" }, embedding),
    ).rejects.toThrow(/FOREIGN KEY/);
    expect(await store.stats()).toEqual({ turns: 0, nodes: 0, edges: 0 });
    await store.upsertTurn(turn("a", "valid session"), embedding);
    expect((await store.stats()).turns).toBe(1);
  });

  it("rejects invalid embeddings, malformed input and corrupt stored JSON", async () => {
    const { db, store } = await fixture();
    for (const value of [NaN, Infinity, 1e100]) {
      await expect(store.upsertTurn(turn("a", "bad"), [value])).rejects.toThrow(/finite/);
    }
    await expect(
      store.upsertTurn({ ...turn("a", "bad"), role: "invented" } as unknown as Turn, embedding),
    ).rejects.toThrow();
    await expect(store.query(undefined, "", -1, 1500)).rejects.toThrow(RangeError);
    await expect(store.query(undefined, "", 1, 0.5)).rejects.toThrow(RangeError);
    await store.upsertTurn(turn("a", "valid"), embedding);
    db.prepare("UPDATE lore_nodes SET refs_json = ?").run("not JSON");
    await expect(store.exportAll()).rejects.toThrow("Corrupt lore refs_json");
    expect((await store.stats()).turns).toBe(1);
  });

  it("serializes concurrent operations and drains pending writes before close", async () => {
    const { db, store } = await fixture();
    const writes = Array.from({ length: 12 }, (_, i) =>
      store.upsertTurn(turn(`t${i}`, `event ${i}`), embedding),
    );
    const closing = store.close();
    await Promise.all([...writes, closing]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM lore_nodes").get()).toEqual({ n: 12 });
    await expect(store.stats()).rejects.toThrow("closed");
    await store.close();
  });

  it("reopens the same SQLite database without losing data or reapplying migrations", async () => {
    const { db, store } = await fixture();
    await store.upsertTurn(turn("a", "persistent"), embedding);
    await store.close();
    const reopened = await createWebLoreStore({ database: db });
    stores.push(reopened);
    expect((await reopened.exportAll()).nodes[0]?.summary).toBe("persistent");
    expect(db.prepare("SELECT id FROM _migrations ORDER BY id").all()).toEqual([{ id: 1 }]);
    await reopened.deleteAll();
    await reopened.deleteAll();
    expect(await reopened.exportAll()).toEqual({ nodes: [], edges: [] });
  });

  it("reports extension absence honestly with configured migration dimensions", async () => {
    const { db, store } = await fixture({ migration: { vec: true, vecDimensions: 384 } });
    expect(store.capabilities).toEqual({
      storage: "memory",
      vec: { enabled: false, reason: "extension-unavailable" },
    });
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name='vec_nodes'").get(),
    ).toBeUndefined();
    await store.upsertTurn(turn("a", "vec-off works"), embedding);
    expect((await store.query("alice", "works", 8, 1500)).nodes).toHaveLength(1);
    await expect(
      createWebLoreStore({ database: db, migration: { vec: true, vecDimensions: 0 } }),
    ).rejects.toThrow("vecDimensions");
  });

  it("refuses vec-off writes when a vector table already exists", async () => {
    const db = database();
    migrate(db, { vec: false });
    db.exec("CREATE TABLE vec_nodes (id TEXT PRIMARY KEY, embedding BLOB)");
    await expect(createWebLoreStore({ database: db })).rejects.toThrow(
      "reopen with sqlite-vec enabled",
    );
  });

  it("maintains real sqlite-vec rows, uses query embeddings, and enforces persisted dimensions", async () => {
    const db = database();
    loadVec(db);
    const store = await createWebLoreStore({
      database: db,
      migration: { vec: true, vecDimensions: 3 },
      embedQuery: async () => [1, 0, 0],
    });
    stores.push(store);
    seed(db);
    expect(store.capabilities.vec).toEqual({ enabled: true, dimensions: 3 });
    await store.upsertTurn(turn("a", "closest to the query"), [1, 0, 0]);
    await store.upsertTurn(turn("b", "opposite"), [-1, 0, 0]);
    expect((await store.query("alice", "semantic", 1, 1500)).nodes.map((n) => n.id)).toEqual([
      "turn:a",
    ]);
    await store.upsertTurn(turn("a", "updated vector"), [0, 1, 0]);
    expect(db.prepare("SELECT embedding FROM vec_nodes WHERE id='turn:a'").get()).toEqual({
      embedding: Buffer.from(new Float32Array([0, 1, 0]).buffer),
    });
    await expect(store.upsertTurn(turn("bad", "wrong width"), [1, 0])).rejects.toThrow(
      "3 dimensions",
    );
    await expect(
      createWebLoreStore({ database: db, migration: { vec: true, vecDimensions: 4 } }),
    ).rejects.toThrow("persisted");
    expect(await store.stats()).toEqual({ turns: 2, nodes: 2, edges: 0 });
    await store.deleteAll();
    expect(db.prepare("SELECT COUNT(*) AS n FROM vec_nodes").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT id FROM _migrations ORDER BY id").all()).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it("runs the async migration path against real SQLite and retains T0.9's ledger", async () => {
    const db = database();
    const connection = {
      async exec(sql: string) {
        db.exec(sql);
      },
      async all(sql: string, parameters: unknown[] = []) {
        const statement = db.prepare(sql);
        if (statement.reader) return statement.all(...parameters) as SqlRow[];
        statement.run(...parameters);
        return [];
      },
    };
    expect(await migrateAsync(connection, { vec: false })).toEqual({
      enabled: false,
      reason: "disabled",
    });
    seed(db);
    await migrateAsync(connection, { vec: true, vecDimensions: 384 });
    migrate(db, { vec: false });
    expect(db.prepare("SELECT id FROM _migrations").all()).toEqual([{ id: 1 }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM people").get()).toEqual({ n: 2 });
  });

  it("roundtrips the native command transport and BLOB envelope through real SQLite", async () => {
    const db = database();
    const connection = synchronousConnection(db);
    const calls: string[] = [];
    // Exercise the JSON IPC boundary with actual SQL execution. Rust itself is
    // typechecked separately; this does not pretend to launch a Tauri runtime.
    const invoke: NativeInvoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      calls.push(command);
      if (command === "plugin:lore|lore_open") {
        expect(args?.migrations).toBeInstanceOf(Array);
        const options = args?.options as {
          vec: boolean;
          extensions: boolean;
          vecDimensions: number | null;
        };
        const capabilities = await connection.initialize({
          vec: options.vec,
          extensions: options.extensions,
          ...(options.vecDimensions === null ? {} : { vecDimensions: options.vecDimensions }),
        });
        return { connectionId: 1, capabilities: { ...capabilities, storage: "native" } } as T;
      }
      expect(args?.connectionId).toBe(1);
      if (command === "plugin:lore|lore_close") {
        await connection.close();
        return undefined as T;
      }
      expect(command).toBe("plugin:lore|lore_batch");
      const statements = args?.statements as {
        sql: string;
        parameters: (string | number | null | { blob: number[] })[];
      }[];
      const rows = await connection.batch(
        statements.map((statement) => ({
          sql: statement.sql,
          parameters: statement.parameters.map((value) =>
            value !== null && typeof value === "object" ? Uint8Array.from(value.blob) : value,
          ),
        })),
      );
      return rows.map((batch) =>
        batch.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              value instanceof Uint8Array ? { blob: Array.from(value) } : value,
            ]),
          ),
        ),
      ) as T;
    };
    const store = await createNativeLoreStore({ invoke });
    stores.push(store);
    seed(db);
    await store.upsertTurn(turn("a", "native text"), embedding);
    expect((await store.query("alice", "native", 8, 1500)).nodes[0]?.embedding).toEqual(embedding);
    expect((await store.exportAll()).nodes[0]?.summary).toBe("native text");
    expect(await store.stats()).toEqual({ turns: 1, nodes: 1, edges: 0 });
    await store.deleteAll();
    expect((await store.exportAll()).nodes).toEqual([]);
    await store.close();
    expect(calls[0]).toBe("plugin:lore|lore_open");
    expect(calls.at(-1)).toBe("plugin:lore|lore_close");
  });
});
