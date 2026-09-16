// natally — X.1 verify.
// Accept: `data: CRUD roundtrip; export→wipe→import restores equivalently`.
//
// Real cycle over in-memory better-sqlite3 (vec off) and the REAL L.1 store
// (createSqliteLoreStore) bound over a second in-memory db — the established
// packages/lore/tests pattern; no store stubs anywhere. The deterministic
// fixture is seeded through the repositories, exported, wiped (fresh dbs),
// imported merge-by-id, and re-exported: the two documents deep-equal.

import type { SqliteDb } from "@natally/lore/ddl";
import { migrate } from "@natally/lore/migrate";
import { createSqliteLoreStore, embeddingToBlob } from "@natally/lore/store/common";
import type { ChartInputs, Person, Session, Turn } from "@natally/lore/types";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { type AppDb, type LoreStoreBinding, openAppDb } from "./db";
import { exportAll } from "./export";
import { importDocument } from "./import";

// ---------------------------------------------------------------------------
// Deterministic fixture
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;

const PERSON_A: Person = {
  id: "person-a",
  name: "Alice Example",
  birth: { date: "1990-05-02", time: "14:30", place: "Porto, PT", timeKnown: true },
};
const PERSON_B: Person = {
  id: "person-b",
  name: "Bea Unknown",
  birth: { date: "1985-11-30", place: "Lisbon, PT", timeKnown: false },
};
const PERSON_EXTRA: Person = {
  id: "person-extra",
  name: "Extra Person",
  birth: { date: "2000-01-01", time: "00:00", place: "Porto, PT", timeKnown: true },
};
const SESSION_1: Session = { id: "session-1", personId: "person-a", startedAt: NOW };
const TURN_YOU: Turn = {
  id: "turn-1",
  sessionId: "session-1",
  personId: "person-a",
  role: "you",
  text: "What does my chart say about Paris?",
  ts: NOW + 1,
};
const TURN_HER: Turn = {
  id: "turn-2",
  sessionId: "session-1",
  personId: "person-a",
  role: "her",
  text: "Your Sun sits at 11 Taurus, per your computed chart.",
  ts: NOW + 2,
};
const TURN_TOOL: Turn = {
  id: "turn-3",
  sessionId: "session-1",
  personId: "person-a",
  role: "tool",
  text: "dom.write applied",
  ts: NOW + 3,
  toolOps: [{ selector: "#stage", op: "text", value: "hello" }],
};
const CHART_1: ChartInputs = {
  id: "chart-1",
  personIds: ["person-a"],
  ut: "1990-05-02T13:30:00Z",
  place: { lat: 41.15, lon: -8.61, label: "Porto" },
};
const CHART_FACTS = {
  positions: [{ body: "sun", lon: 41.7, speed: 0.96 }],
  cusps: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
  aspects: [],
};

function freshAppDb(lore?: LoreStoreBinding): { app: AppDb; db: Database.Database } {
  const db = new Database(":memory:");
  return { app: openAppDb(db, lore === undefined ? {} : { loreStore: lore }), db };
}

function freshLoreBinding(): LoreStoreBinding {
  const loreDb = new Database(":memory:");
  migrate(loreDb, { vec: false });
  return {
    store: createSqliteLoreStore(loreDb, { vec: false, runtime: "test-memory" }),
    db: loreDb,
  };
}

function seedStandardData(app: AppDb): void {
  app.people.create(PERSON_A);
  app.people.create(PERSON_B);
  app.sessions.create(SESSION_1);
  app.turns.append(TURN_YOU);
  app.turns.append(TURN_HER);
  app.turns.append(TURN_TOOL);
  app.charts.put(CHART_1, CHART_FACTS);
  // The consumed-codes ledger repository belongs to the licensing task — seeded directly.
  app.db
    .prepare("INSERT INTO consumed_codes (code_hash, redeemed_at) VALUES (?, ?)")
    .run("sha256:deadbeef", NOW);
}

function seedLore(loreDb: SqliteDb): void {
  const insertNode = loreDb.prepare(
    "INSERT INTO lore_nodes (id, kind, summary, embedding, refs_json) VALUES (?, ?, ?, ?, ?)",
  );
  insertNode.run(
    "lore:person:alice",
    "person",
    "Alice met Bob near Paris.",
    embeddingToBlob([0.5, 0.25, -1]),
    JSON.stringify(["turn-1"]),
  );
  insertNode.run(
    "lore:place:paris",
    "place",
    "Paris, France.",
    embeddingToBlob([1, 0, 0.5]),
    JSON.stringify(["turn-1"]),
  );
  loreDb
    .prepare(
      "INSERT INTO lore_edges (from_id, to_id, rel, weight, source_turn_id) VALUES (?, ?, ?, ?, ?)",
    )
    .run("lore:person:alice", "lore:place:paris", "mentions", 2, "turn-1");
}

// ---------------------------------------------------------------------------
// Accept line
// ---------------------------------------------------------------------------

describe("data: CRUD roundtrip; export→wipe→import restores equivalently", () => {
  test("CRUD roundtrip: people, sessions, turns (append-only), charts (immutable)", () => {
    const { app } = freshAppDb();

    app.people.create(PERSON_A);
    expect(app.people.get("person-a")).toEqual(PERSON_A);
    const renamed: Person = { ...PERSON_A, name: "Alice Renamed" };
    expect(app.people.update(renamed)).toBe(true);
    expect(app.people.get("person-a")).toEqual(renamed);
    expect(app.people.update({ ...PERSON_B, id: "ghost" })).toBe(false);
    app.people.create(PERSON_B);
    expect(app.people.list()).toEqual([renamed, PERSON_B]);
    expect(app.people.remove("person-b")).toBe(true);
    expect(app.people.get("person-b")).toBeUndefined();
    expect(app.people.remove("person-b")).toBe(false);

    app.sessions.create(SESSION_1);
    expect(app.sessions.get("session-1")).toEqual(SESSION_1);
    expect(app.sessions.listByPerson("person-a")).toEqual([SESSION_1]);
    expect(app.sessions.listByPerson("person-b")).toEqual([]);

    app.turns.append(TURN_YOU);
    app.turns.append(TURN_HER);
    app.turns.append(TURN_TOOL);
    expect(app.turns.listBySession("session-1")).toEqual([TURN_YOU, TURN_HER, TURN_TOOL]);
    expect(app.turns.get("turn-2")).toEqual(TURN_HER);
    expect(app.turns.get("nope")).toBeUndefined();
    // Append-only law: a duplicate turn id throws — the transcript is never rewritten.
    expect(() => app.turns.append(TURN_YOU)).toThrow();

    app.charts.put(CHART_1, CHART_FACTS);
    const record = app.charts.get("chart-1");
    expect(record?.inputs).toEqual(CHART_1);
    expect(record?.facts).toEqual(CHART_FACTS);
    app.charts.put(CHART_1, { positions: [] }); // content-addressed: first write wins
    expect(app.charts.get("chart-1")?.facts).toEqual(CHART_FACTS);
    expect(app.charts.get("nope")).toBeUndefined();
  });

  test("export→wipe→import restores equivalently (app entities, no lore sidecar)", async () => {
    const first = freshAppDb();
    seedStandardData(first.app);
    const docA = await exportAll(first.db);

    expect(docA.exportVersion).toBe(1);
    expect(docA.people.map((p) => p.id)).toEqual(["person-a", "person-b"]);
    expect(docA.sessions).toEqual([SESSION_1]);
    expect(docA.turns).toEqual([TURN_YOU, TURN_HER, TURN_TOOL]);
    expect(docA.charts).toEqual([CHART_1]);
    expect(docA.consumedCodes).toEqual([{ codeHash: "sha256:deadbeef", redeemedAt: NOW }]);
    // §5 export law: computed facts never leave the device — inputs only.
    const json = JSON.stringify(docA);
    expect(json).not.toContain("positions");
    expect(json).not.toContain('"facts"');

    const second = freshAppDb(); // wipe: a fresh db
    const summary = importDocument(docA, second.db);
    expect(summary).toEqual({
      people: 2,
      sessions: 1,
      turns: 3,
      charts: 1,
      consumedCodes: 1,
      loreNodes: 0,
      loreEdges: 0,
    });
    // Import lands inputs only — facts stay an honest-absence placeholder until recompute.
    const restored = second.app.charts.get("chart-1");
    expect(restored?.inputs).toEqual(CHART_1);
    expect(restored?.facts).toBeNull();

    const docB = await exportAll(second.db);
    expect(docB).toEqual(docA);
  });

  test("export→wipe→import restores equivalently with the real L.1 lore store bound", async () => {
    const firstApp = freshAppDb();
    seedStandardData(firstApp.app);
    const bindingA = freshLoreBinding();
    seedLore(bindingA.db);

    const docA = await exportAll(firstApp.db, bindingA);
    expect(docA.loreNodes.map((n) => n.id)).toEqual(["lore:person:alice", "lore:place:paris"]);
    expect(docA.loreEdges).toEqual([
      {
        from: "lore:person:alice",
        to: "lore:place:paris",
        rel: "mentions",
        weight: 2,
        sourceTurnId: "turn-1",
      },
    ]);

    const bindingB = freshLoreBinding(); // wipe: fresh app db + fresh lore db
    const secondApp = freshAppDb(bindingB);
    const summary = importDocument(docA, secondApp.db, bindingB);
    expect(summary.loreNodes).toBe(2);
    expect(summary.loreEdges).toBe(1);

    const docB = await exportAll(secondApp.db, bindingB);
    expect(docB).toEqual(docA);

    // Idempotent: a re-import inserts nothing, changes nothing.
    expect(importDocument(docA, secondApp.db, bindingB)).toEqual({
      people: 0,
      sessions: 0,
      turns: 0,
      charts: 0,
      consumedCodes: 0,
      loreNodes: 0,
      loreEdges: 0,
    });
    expect(await exportAll(secondApp.db, bindingB)).toEqual(docA);
  });

  test("import never deletes: rows created after the export survive a re-import", async () => {
    const first = freshAppDb();
    seedStandardData(first.app);
    const doc = await exportAll(first.db);

    const target = freshAppDb();
    importDocument(doc, target.db);
    target.app.people.create(PERSON_EXTRA);

    const again = importDocument(doc, target.db); // merge-only second pass
    expect(again.people).toBe(0);
    expect(target.app.people.get("person-extra")).toEqual(PERSON_EXTRA);
    const ids = (await exportAll(target.db)).people.map((p) => p.id);
    expect(ids).toContain("person-extra");
    expect(ids).toContain("person-a");
  });
});
