import { createRequire } from "node:module";
import type { ChartFacts } from "@natally/ephemeris/types";
import { ExportDocumentSchema, type Person, type Turn } from "@natally/lore";
import type { MigrateOptions } from "@natally/lore/migrate";
import type { NativeInvoke } from "@natally/lore/store/native";
import { type SynchronousDatabase, synchronousConnection } from "@natally/lore/store/web";
import { afterEach, describe, expect, it } from "vitest";
import { exportFixture } from "./fixtures/export-v1";
import {
  ChartsRepository,
  DataDatabase,
  EXPORT_PLAINTEXT_NOTICE,
  exportAll,
  exportJson,
  getDatabase,
  importDocument,
  importJson,
  openNativeDatabase,
  openWebDatabase,
  PeopleRepository,
  removePerson,
  SessionsRepository,
  type SqlStatement,
  type SqlValue,
  setDatabase,
  TurnsRepository,
} from "./index";

// Reuse L.1's already installed SQLite test dependency; no workspace manifest edits.
const require = createRequire(
  new URL("../../../../../packages/lore/package.json", import.meta.url),
);
type TestSqlite = SynchronousDatabase & { loadExtension(path: string): void };
const SQLite = require("better-sqlite3") as new (filename: string) => TestSqlite;
const live: Array<{ db: DataDatabase; sqlite: TestSqlite }> = [];

async function open(vec = false) {
  const sqlite = new SQLite(":memory:");
  if (vec) (require("sqlite-vec") as { load(db: TestSqlite): void }).load(sqlite);
  const db = await openWebDatabase({
    database: sqlite,
    migration: vec ? { vec: true, vecDimensions: 3 } : { vec: false },
  });
  live.push({ db, sqlite });
  return { db, sqlite };
}

afterEach(async () => {
  setDatabase(undefined);
  for (const { db, sqlite } of live.splice(0)) {
    await db.close();
    sqlite.close();
  }
});

function fixture() {
  return structuredClone(exportFixture);
}
function facts(index = 0): ChartFacts {
  const { id, ut, place, system } = exportFixture.charts[index];
  return {
    id,
    inputs: { ut, place, system },
    positions: [{ body: "sun", lon: 22, lat: 0, speed: 1 }],
    aspects: [],
  };
}
const records = Object.values(exportFixture).reduce<number>(
  (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
  0,
);

describe("data: X.1 repositories and export/import", () => {
  it("CRUD roundtrip for people, sessions, turns and real chart facts", async () => {
    const { db } = await open();
    const people = new PeopleRepository(db);
    const sessions = new SessionsRepository(db);
    const turns = new TurnsRepository(db);
    const charts = new ChartsRepository(db);
    const person = fixture().people[0];
    await people.upsert(person);
    expect(await people.get(person.id)).toEqual(person);
    person.name = "Ada updated";
    await people.upsert(person);
    expect(await people.list()).toEqual([person]);
    const session = { id: "s", personId: person.id, startedAt: 42 };
    await sessions.upsert(session);
    session.startedAt = 43;
    await sessions.upsert(session);
    expect(await sessions.get("s")).toEqual(session);
    expect(await sessions.list(person.id)).toEqual([session]);
    expect(await sessions.list("other")).toEqual([]);
    const turn: Turn = {
      id: "t",
      sessionId: "s",
      role: "tool",
      text: "Before",
      ts: 45,
      toolOps: [{ selector: "#chart", op: "text", value: "Updated" }],
    };
    await turns.upsert(turn);
    turn.text = "After";
    await turns.upsert(turn);
    expect(await turns.get("t")).toEqual(turn);
    expect(await turns.list("s")).toEqual([turn]);
    await charts.upsert(facts(), [person.id], 46);
    expect(await charts.get("c1")).toEqual({
      id: "c1",
      inputs: exportFixture.charts[0],
      facts: facts(),
      computedAt: 46,
    });
    await charts.upsert({ ...facts(), positions: [] }, [person.id], 47);
    expect((await charts.list())[0].facts?.positions).toEqual([]);
    await charts.remove("c1");
    await turns.remove("t");
    await sessions.remove("s");
    await people.removePerson(person.id);
    expect(await charts.get("c1")).toBeUndefined();
    expect(await turns.get("t")).toBeUndefined();
    expect(await sessions.get("s")).toBeUndefined();
    expect(await people.get(person.id)).toBeUndefined();
  });

  it("export→wipe→import restores the deterministic fixture equivalently, with inputs only", async () => {
    const { db } = await open();
    expect(await importDocument(fixture(), db)).toEqual({
      merged: records,
      skipped: 0,
      conflicts: [],
    });
    await new ChartsRepository(db).upsert(facts(), ["p1"], 9876);
    await db.batch([
      { sql: "INSERT INTO readings (id, person_id, chart_id) VALUES ('r', 'p1', 'c1')" },
      { sql: "INSERT INTO license_state (id, token) VALUES (1, 'private-runtime-token')" },
    ]);
    const before = await exportJson(db);
    expect(await exportAll(db)).toEqual(exportFixture);
    expect(before).not.toContain("positions");
    expect(before).not.toContain("private-runtime-token");
    expect(EXPORT_PLAINTEXT_NOTICE).toContain("plaintext JSON");
    // A test-only wipe of isolated memory; destroy.ts remains X.2-owned.
    await db.batch(
      ["lore_edges", "lore_nodes", "charts", "turns", "sessions", "people", "consumed_codes"].map(
        (table) => ({ sql: `DELETE FROM ${table}` }),
      ),
    );
    expect((await exportAll(db)).people).toEqual([]);
    await importJson(before, db);
    expect(await exportJson(db)).toBe(before);
    const restored = await new ChartsRepository(db).get("c1");
    expect(restored?.facts).toBeNull();
    expect(restored?.computedAt).toBeNull();
    const destination = await open();
    await importJson(before, destination.db);
    expect(await exportJson(destination.db)).toBe(before);
  });

  it("re-import is idempotent, preserving existing node contents, weights and consumed timestamps", async () => {
    const { db } = await open();
    await importDocument(fixture(), db);
    const before = await exportJson(db);
    const doc = fixture();
    doc.people[0].name = "Incoming name";
    doc.loreNodes[0].summary = "Incoming summary";
    doc.loreEdges[0].weight = 999;
    doc.consumedCodes[0].redeemedAt = 999;
    expect(await importDocument(doc, db)).toEqual({ merged: 0, skipped: records, conflicts: [] });
    expect(await exportJson(db)).toBe(before);
  });

  it.each([
    { date: "2001-01-01" },
    { time: "12:00" },
    { time: undefined },
    { timeKnown: false },
    { place: "Ottawa" },
  ] satisfies Partial<Person["birth"]>[])(
    "birth conflict %j reports one row; existing wins and stale chart inputs stay out",
    async (birth) => {
      const { db } = await open();
      await new PeopleRepository(db).upsert(exportFixture.people[0]);
      const doc = fixture();
      doc.people[0].birth = { ...doc.people[0].birth, ...birth };
      const report = await importDocument(doc, db);
      expect(report.conflicts).toEqual([
        {
          personId: "p1",
          existingBirth: exportFixture.people[0].birth,
          incomingBirth: doc.people[0].birth,
        },
      ]);
      expect(await new PeopleRepository(db).get("p1")).toEqual(exportFixture.people[0]);
      expect((await new ChartsRepository(db).list()).map((chart) => chart.id)).toEqual(["c3"]);
      expect((await db.lore.exportAll()).nodes.map((node) => node.id)).toEqual(["fact1", "p2"]);
      expect((await new TurnsRepository(db).list()).length).toBe(3);
      expect(report.merged + report.skipped).toBe(records);
    },
  );

  it.each([false, true])(
    "removePerson cascades lore+charts, retains transcript including empty sessions (vec=%s)",
    async (vec) => {
      const { db, sqlite } = await open(vec);
      await importDocument(fixture(), db);
      const sessions = await new SessionsRepository(db).list();
      const turns = await new TurnsRepository(db).list();
      await removePerson("p1", db);
      expect(await new PeopleRepository(db).get("p1")).toBeUndefined();
      expect((await new ChartsRepository(db).list()).map((chart) => chart.id)).toEqual(["c3"]);
      expect(await new SessionsRepository(db).list()).toEqual(sessions);
      expect(await new TurnsRepository(db).list()).toEqual(turns);
      expect(sqlite.prepare("SELECT person_id FROM sessions WHERE id='s1'").all()).toEqual([
        { person_id: null },
      ]);
      expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      const graph = await db.lore.exportAll();
      expect(graph.nodes.map((node) => node.id)).toEqual(["fact1", "p2"]);
      expect(graph.edges).toEqual([exportFixture.loreEdges[1]]);
      if (vec)
        expect(sqlite.prepare("SELECT id FROM vec_nodes ORDER BY id").all()).toEqual([
          { id: "fact1" },
          { id: "p2" },
        ]);
      const before = await exportJson(db);
      await removePerson("p1", db);
      expect(await exportJson(db)).toBe(before);
      const target = await open(vec);
      await importJson(before, target.db);
      expect(await exportJson(target.db)).toBe(before);
      expect(await new SessionsRepository(target.db).get("s3-empty")).toEqual(
        exportFixture.sessions[2],
      );
      expect(target.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    },
  );

  it("deletion preserves a non-person lore node even when its ID matches", async () => {
    const { db } = await open();
    const doc = fixture();
    doc.loreNodes[1].kind = "event";
    await importDocument(doc, db);
    await removePerson("p1", db);
    expect(await db.lore.exportAll()).toEqual({ nodes: doc.loreNodes, edges: doc.loreEdges });
  });

  it("birth edits invalidate every affected chart cache, while renames keep it", async () => {
    const { db } = await open();
    await importDocument(fixture(), db);
    const person = fixture().people[0];
    person.name = "Updated";
    await new PeopleRepository(db).upsert(person);
    expect((await new ChartsRepository(db).list()).length).toBe(3);
    person.birth.place = "Ottawa";
    await new PeopleRepository(db).upsert(person);
    expect((await new ChartsRepository(db).list()).map((chart) => chart.id)).toEqual(["c3"]);
  });

  it("invalid JSON, schema versions, cached facts and duplicate IDs fail without mutations", async () => {
    const { db } = await open();
    const before = await exportJson(db);
    await expect(importJson("{", db)).rejects.toThrow("Invalid export JSON");
    await expect(importDocument({ ...fixture(), exportVersion: 2 }, db)).rejects.toThrow();
    const withFacts = fixture();
    Object.assign(withFacts.charts[0], { positions: [] });
    await expect(importDocument(withFacts, db)).rejects.toThrow();
    const duplicate = fixture();
    duplicate.people.push(duplicate.people[0]);
    await expect(importDocument(duplicate, db)).rejects.toThrow("Duplicate people");
    expect(await exportJson(db)).toBe(before);
  });

  it("a real foreign-key failure rolls back the entire import, preserving existing data", async () => {
    const { db } = await open();
    await new PeopleRepository(db).upsert(exportFixture.people[0]);
    const before = await exportJson(db);
    const doc = fixture();
    doc.turns[2].sessionId = "missing-session";
    await expect(importDocument(doc, db)).rejects.toThrow(/FOREIGN KEY/);
    expect(await exportJson(db)).toBe(before);
    // The failed operation does not poison the connection queue.
    await importDocument(fixture(), db);
    expect(await exportAll(db)).toEqual(exportFixture);
  });

  it("a late cascade failure rolls back person, transcript links, lore and charts together", async () => {
    const { db, sqlite } = await open();
    await importDocument(fixture(), db);
    sqlite.exec(
      "CREATE TRIGGER keep_person BEFORE DELETE ON people BEGIN SELECT RAISE(ABORT, 'test retention'); END",
    );
    const before = await exportJson(db);
    await expect(removePerson("p1", db)).rejects.toThrow("test retention");
    expect(await exportJson(db)).toBe(before);
    expect(sqlite.prepare("SELECT historical_person_id FROM sessions WHERE id='s1'").all()).toEqual(
      [{ historical_person_id: "p1" }],
    );
    expect(sqlite.prepare("SELECT person_id FROM sessions WHERE id='s1'").all()).toEqual([
      { person_id: "p1" },
    ]);
  });

  it("vec imports are idempotent and dimension mismatch is rejected before writing", async () => {
    const { db, sqlite } = await open(true);
    await importDocument(fixture(), db);
    const before = await exportJson(db);
    expect((await importDocument(fixture(), db)).merged).toBe(0);
    expect(sqlite.prepare("SELECT count(*) AS n FROM vec_nodes").all()).toEqual([{ n: 3 }]);
    const doc = fixture();
    doc.people.push({ ...doc.people[0], id: "new-person" });
    doc.loreNodes[0].embedding = [1, 0];
    await expect(importDocument(doc, db)).rejects.toThrow("embedding must have 3 dimensions");
    expect(await exportJson(db)).toBe(before);
  });

  it("uses L.1 exportAll with all table reads in one real SQLite transaction", async () => {
    const sqlite = new SQLite(":memory:");
    const connection = synchronousConnection(sqlite);
    const batches: SqlStatement[][] = [];
    const db = await DataDatabase.open({
      ...connection,
      batch: (statements) => {
        batches.push(statements);
        return connection.batch(statements);
      },
    });
    live.push({ db, sqlite });
    await importDocument(fixture(), db);
    batches.length = 0;
    expect(await exportAll(db)).toEqual(exportFixture);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(7);
    expect(batches[0][5].sql).toContain("FROM lore_nodes");
    expect(batches[0][6].sql).toContain("FROM lore_edges");
  });

  it("exposes explicit mounting and reports corrupt stored JSON instead of fabricating rows", async () => {
    expect(() => getDatabase()).toThrow("has not been mounted");
    const { db } = await open();
    setDatabase(db);
    await importDocument(fixture());
    expect(ExportDocumentSchema.parse(await exportAll())).toEqual(exportFixture);
    await db.batch([{ sql: "UPDATE turns SET tool_ops='{' WHERE id='t3'" }]);
    await expect(new TurnsRepository().get("t3")).rejects.toThrow("Corrupt data tool_ops");
    await expect(exportAll()).rejects.toThrow("Corrupt data tool_ops");
    await db.close();
    await expect(new PeopleRepository().list()).rejects.toThrow("closed");
  });

  it("native adapter executes the real SQL/BLOB protocol and propagates native failures", async () => {
    const sqlite = new SQLite(":memory:");
    const connection = synchronousConnection(sqlite);
    const commands: string[] = [];
    type WireValue = Exclude<SqlValue, Uint8Array> | { blob: number[] };
    const invoke: NativeInvoke = async <T>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      commands.push(command);
      let result: unknown;
      if (command === "plugin:lore|lore_open") {
        const wire = args.options as MigrateOptions & { vecDimensions: number | null };
        const options: MigrateOptions = {
          vec: wire.vec,
          extensions: wire.extensions,
          ...(wire.vecDimensions === null ? {} : { vecDimensions: wire.vecDimensions }),
        };
        const capabilities = await connection.initialize(options);
        result = { connectionId: 1, capabilities: { ...capabilities, storage: "native" } };
      } else if (command === "plugin:lore|lore_batch") {
        expect(args.connectionId).toBe(1);
        const statements = args.statements as Array<{ sql: string; parameters: WireValue[] }>;
        const rows = await connection.batch(
          statements.map(({ sql, parameters }) => ({
            sql,
            parameters: parameters.map((value) =>
              value !== null && typeof value === "object" ? Uint8Array.from(value.blob) : value,
            ),
          })),
        );
        result = rows.map((batch) =>
          batch.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key,
                value instanceof Uint8Array ? { blob: Array.from(value) } : value,
              ]),
            ),
          ),
        );
      } else if (command === "plugin:lore|lore_close") {
        await connection.close();
      } else throw new Error(`Unexpected native command ${command}`);
      return result as T;
    };
    const db = await openNativeDatabase({ invoke });
    live.push({ db, sqlite });
    expect(db.capabilities.storage).toBe("native");
    await importDocument(fixture(), db);
    expect(await exportAll(db)).toEqual(exportFixture);
    const invalid = fixture();
    invalid.turns.push({ ...invalid.turns[0], id: "bad-turn", sessionId: "missing" });
    await expect(importDocument(invalid, db)).rejects.toThrow(/FOREIGN KEY/);
    expect(await exportAll(db)).toEqual(exportFixture);
    await db.close();
    expect(commands[0]).toBe("plugin:lore|lore_open");
    expect(commands.at(-1)).toBe("plugin:lore|lore_close");
  });

  it("web worker transport roundtrips real SQLite and terminates after a channel failure", async () => {
    const sqlite = new SQLite(":memory:");
    const connection = synchronousConnection(sqlite);
    let terminated = false;
    const worker = new EventTarget();
    const transport = Object.assign(worker, {
      terminate() {
        terminated = true;
      },
      postMessage(request: { id: number; method: string; args: unknown }) {
        void (async () => {
          try {
            let result: unknown;
            if (request.method === "initialize") {
              const options = request.args as { filename: string; migration: MigrateOptions };
              expect(options.filename).toBe("STAGING_X1-worker.sqlite3");
              result = await connection.initialize(options.migration);
            } else if (request.method === "batch") {
              result = await connection.batch(request.args as SqlStatement[]);
            } else if (request.method === "close") {
              await connection.close();
            } else throw new Error("Unexpected worker method");
            worker.dispatchEvent(new MessageEvent("message", { data: { id: request.id, result } }));
          } catch (error) {
            worker.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  id: request.id,
                  error: error instanceof Error ? error.message : String(error),
                },
              }),
            );
          }
        })();
      },
    });
    const db = await openWebDatabase({
      filename: "STAGING_X1-worker.sqlite3",
      createWorker: () => transport as unknown as Worker,
    });
    live.push({ db, sqlite });
    await importDocument(fixture(), db);
    expect(await exportAll(db)).toEqual(exportFixture);
    worker.dispatchEvent(new Event("messageerror"));
    await expect(exportAll(db)).rejects.toThrow("Invalid data worker response");
    await db.close();
    expect(terminated).toBe(true);
  });
});
