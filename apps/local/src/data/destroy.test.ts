// natally — X.2 verify: delete-everything is REAL deletion (ARCHITECTURE §8.4,
// TEST_RUBRIC TR-4). Real in-memory better-sqlite3 through X.1's `openAppDb`,
// a REAL `createSqliteLoreStore` over a second in-memory handle, a REAL tmp-dir
// storage and a closure keychain — no mocks anywhere in the harness.
//
// Vec note: the sqlite-vec extension is not loadable in this test environment
// (the lore package's own store tests run vec-off for the same reason), so the
// `vec_nodes` mirror is stood up as a plain table of the same name on the lore
// handle. The destroy path issues the identical `DELETE FROM vec_nodes`, and
// the store is built with `vec: true` so its own `deleteAll` clears it too —
// the mirror-presence branch is exercised, not simulated away.

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SqliteDb } from "@natally/lore/ddl";
import { migrate } from "@natally/lore/migrate";
import type { LoreStore } from "@natally/lore/store";
import { createSqliteLoreStore } from "@natally/lore/store/common";
import type { Turn } from "@natally/lore/types";
import Database from "better-sqlite3";
import { expect, test } from "vitest";
import { type AppDb, openAppDb } from "./db";
import { type DestroyKeychain, type DestroyStorage, destroyEverything } from "./destroy";

/** Deterministic toy embedder — the real model is an injected host concern. */
const DIM = 4;
function toyEmbed(text: string): Promise<readonly number[]> {
  const vector = new Array<number>(DIM).fill(0);
  for (const ch of text.toLowerCase()) {
    const bucket = ch.charCodeAt(0) % DIM;
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }
  return Promise.resolve(vector);
}

function countRows(handle: SqliteDb, table: string): number {
  const row = handle.prepare(`SELECT COUNT(*) AS n FROM ${String(table)}`).get() as
    | { n?: unknown }
    | undefined;
  return Number(row?.n ?? 0);
}

/** The 9 user-owned tables on the app handle, in DDL order. */
const APP_TABLES = [
  "people",
  "sessions",
  "turns",
  "charts",
  "readings",
  "consumed_codes",
  "license_state",
  "lore_nodes",
  "lore_edges",
] as const;

/** Every table destroy must leave at 0 rows (9 app + the vec mirror). */
function expectAllCleared(appHandle: SqliteDb, loreHandle: SqliteDb): void {
  for (const table of APP_TABLES) {
    expect(countRows(appHandle, table), `app table ${String(table)} must be empty`).toBe(0);
  }
  // The sidecar handle: lore rows + the vector mirror (the "10 tables" tail).
  expect(countRows(loreHandle, "lore_nodes"), "lore nodes must be empty").toBe(0);
  expect(countRows(loreHandle, "lore_edges"), "lore edges must be empty").toBe(0);
  expect(countRows(loreHandle, "vec_nodes"), "vector mirror must be empty").toBe(0);
  // The `_migrations` ledger is deliberately KEPT (schema bookkeeping, not user
  // data) — the migrations stay recorded, so the schema stays current.
  expect(countRows(appHandle, "_migrations")).toBe(5);
}

interface Harness {
  readonly appHandle: SqliteDb;
  readonly loreHandle: SqliteDb;
  readonly db: AppDb;
  readonly loreStore: LoreStore;
  readonly dir: string;
  readonly storage: DestroyStorage;
  readonly keychain: DestroyKeychain;
  keychainClears(): number;
  close(): void;
}

function openHarness(): Harness {
  const appRaw = new Database(":memory:");
  const appHandle: SqliteDb = appRaw; // X.1 migrates on open.
  const loreRaw = new Database(":memory:");
  const loreHandle: SqliteDb = loreRaw; // second handle, per the wiring note.
  migrate(loreHandle, { vec: false });
  // Vec mirror stand-in: plain table, same name — see the file header.
  loreHandle.exec("CREATE TABLE vec_nodes (node_id TEXT PRIMARY KEY, embedding BLOB);");
  const loreStore = createSqliteLoreStore(loreHandle, { vec: true, runtime: "memory" });
  const db = openAppDb(appHandle);

  const dir = mkdtempSync(join(tmpdir(), "natally-destroy-"));
  const storage: DestroyStorage = {
    async list(): Promise<string[]> {
      return existsSync(dir) ? readdirSync(dir) : [];
    },
    async remove(name: string): Promise<void> {
      rmSync(join(dir, name), { force: true });
    },
  };

  let clears = 0;
  const keychain: DestroyKeychain = {
    async clearToken(): Promise<void> {
      clears += 1;
    },
  };

  return {
    appHandle,
    loreHandle,
    db,
    loreStore,
    dir,
    storage,
    keychain,
    keychainClears: () => clears,
    close(): void {
      appRaw.close();
      loreRaw.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedAppRows(handle: SqliteDb): void {
  handle.exec(`
    INSERT INTO people (id, name, birth_date, birth_time, time_known, place, created_at)
      VALUES ('p1', 'Ada', '1990-04-15', '14:30', 1, 'Reykjavík', 1);
    INSERT INTO sessions (id, person_id, started_at) VALUES ('s1', 'p1', 1);
    INSERT INTO turns (id, session_id, person_id, role, text, ts, tool_ops)
      VALUES ('t1', 's1', 'p1', 'you', 'moon over reykjavik', 1, NULL);
    INSERT INTO charts (id, inputs_json, facts_json, computed_at) VALUES ('c1', '{}', '{}', 1);
    INSERT INTO readings (id, ts, person_id, chart_id) VALUES ('r1', 1, 'p1', 'c1');
    INSERT INTO consumed_codes (code_hash, redeemed_at) VALUES ('hash-1', 1);
    INSERT INTO license_state (id, token, verified_at) VALUES (1, 'tok-1', 1);
    INSERT INTO lore_nodes (id, kind, summary, embedding, refs_json)
      VALUES ('import:1', 'person', 'Ada', x'00', '["t1"]');
    INSERT INTO lore_edges (from_id, to_id, rel, weight, source_turn_id)
      VALUES ('import:1', 'import:1', 'mentions', 1, 't1');
  `);
}

async function seedLoreRows(loreStore: LoreStore, loreHandle: SqliteDb): Promise<void> {
  const turn: Turn = {
    id: "lt1",
    sessionId: "ls1",
    personId: "p1",
    role: "you",
    text: "moon over reykjavik",
    ts: 1,
  };
  await loreStore.upsertTurn(turn, [...(await toyEmbed(turn.text))]);
  loreHandle.exec(`
    INSERT INTO lore_edges (from_id, to_id, rel, weight, source_turn_id)
      VALUES ('turn:lt1', 'turn:lt1', 'mentions', 1, 'lt1');
    INSERT INTO vec_nodes (node_id, embedding) VALUES ('turn:lt1', x'00');
  `);
}

function seedFiles(dir: string): void {
  writeFileSync(join(dir, "kokoro-82m.onnx"), "weights");
  writeFileSync(join(dir, "kokoro-82m.onnx.part"), "partial");
}

const yes = (): Promise<boolean> => Promise.resolve(true);
const no = (): Promise<boolean> => Promise.resolve(false);

test("destroy: 0 rows remain across 10 tables; files removed; token cleared", async () => {
  const h = openHarness();
  try {
    seedAppRows(h.appHandle);
    await seedLoreRows(h.loreStore, h.loreHandle);
    seedFiles(h.dir);

    const result = await destroyEverything({
      db: h.db,
      lore: h.loreStore,
      storage: h.storage,
      keychain: h.keychain,
      confirm: yes,
    });

    if (result.aborted) {
      throw new Error("destroy aborted despite an accepted confirm");
    }
    // Honest report: 9 app tables + lore_nodes + lore_edges + vec_nodes = 10.
    expect(result.tablesCleared).toHaveLength(10);
    expect(new Set(result.tablesCleared)).toEqual(
      new Set([...APP_TABLES, "lore_nodes", "lore_edges", "vec_nodes"]),
    );
    expect(result.filesDeleted).toHaveLength(2);
    expect(new Set(result.filesDeleted)).toEqual(
      new Set(["kokoro-82m.onnx", "kokoro-82m.onnx.part"]),
    );
    expect(result.tokenCleared).toBe(true);

    expectAllCleared(h.appHandle, h.loreHandle);
    expect(readdirSync(h.dir), "model files must be gone from the tmp dir").toEqual([]);
    expect(h.keychainClears()).toBe(1);
  } finally {
    h.close();
  }
});

test("destroy: declined confirm aborts with nothing touched", async () => {
  const h = openHarness();
  try {
    seedAppRows(h.appHandle);
    await seedLoreRows(h.loreStore, h.loreHandle);
    seedFiles(h.dir);

    const result = await destroyEverything({
      db: h.db,
      lore: h.loreStore,
      storage: h.storage,
      keychain: h.keychain,
      confirm: no,
    });

    expect(result).toEqual({ aborted: true });
    // Everything intact: rows, lore rows, vectors, files, token.
    expect(countRows(h.appHandle, "people")).toBe(1);
    expect(countRows(h.appHandle, "license_state")).toBe(1);
    expect(countRows(h.loreHandle, "lore_nodes")).toBe(1);
    expect(countRows(h.loreHandle, "vec_nodes")).toBe(1);
    expect(readdirSync(h.dir).sort()).toEqual(["kokoro-82m.onnx", "kokoro-82m.onnx.part"]);
    expect(h.keychainClears()).toBe(0);
  } finally {
    h.close();
  }
});

test("destroy: idempotent second run clears nothing more and does not error", async () => {
  const h = openHarness();
  try {
    seedAppRows(h.appHandle);
    await seedLoreRows(h.loreStore, h.loreHandle);
    seedFiles(h.dir);

    const first = await destroyEverything({
      db: h.db,
      lore: h.loreStore,
      storage: h.storage,
      keychain: h.keychain,
      confirm: yes,
    });
    if (first.aborted) {
      throw new Error("destroy aborted despite an accepted confirm");
    }
    expect(first.filesDeleted).toHaveLength(2);

    const second = await destroyEverything({
      db: h.db,
      lore: h.loreStore,
      storage: h.storage,
      keychain: h.keychain,
      confirm: yes,
    });
    if (second.aborted) {
      throw new Error("second destroy aborted despite an accepted confirm");
    }
    // Zero new deletions, no error, honest report of the (already-empty) run.
    expect(second.filesDeleted).toEqual([]);
    expect(second.tokenCleared).toBe(true);
    expect(second.tablesCleared).toHaveLength(10);
    expectAllCleared(h.appHandle, h.loreHandle);
    expect(h.keychainClears()).toBe(2);
  } finally {
    h.close();
  }
});

test("destroy: lore rows on the app handle die even with no lore store wired", async () => {
  const h = openHarness();
  try {
    // No lore param, no binding: merge-by-id import rows live on the bare app
    // handle (db.ts contract) — direct deletion must still reach them, and a
    // pre-existing vec mirror on the app handle must go too.
    h.appHandle.exec(`
      CREATE TABLE vec_nodes (node_id TEXT PRIMARY KEY, embedding BLOB);
      INSERT INTO people (id, name, birth_date, birth_time, time_known, place, created_at)
        VALUES ('p1', 'Ada', '1990-04-15', '14:30', 1, 'Reykjavík', 1);
      INSERT INTO lore_nodes (id, kind, summary, embedding, refs_json)
        VALUES ('import:1', 'person', 'Ada', x'00', '[]');
      INSERT INTO lore_edges (from_id, to_id, rel, weight, source_turn_id)
        VALUES ('import:1', 'import:1', 'mentions', 1, 't1');
      INSERT INTO vec_nodes (node_id, embedding) VALUES ('import:1', x'00');
    `);

    const result = await destroyEverything({ db: h.db, confirm: yes });
    if (result.aborted) {
      throw new Error("destroy aborted despite an accepted confirm");
    }
    expect(countRows(h.appHandle, "lore_nodes")).toBe(0);
    expect(countRows(h.appHandle, "lore_edges")).toBe(0);
    expect(countRows(h.appHandle, "vec_nodes")).toBe(0);
    expect(countRows(h.appHandle, "people")).toBe(0);
    // No keychain injected ⇒ honest `false`, not a claimed success.
    expect(result.tokenCleared).toBe(false);
    expect(h.keychainClears()).toBe(0);
  } finally {
    h.close();
  }
});
