// natally — X.2: Settings › Data "delete everything" (ARCHITECTURE §8.4).
//
// Real deletion, never soft-hide (§8.4): every user-owned table row, the lore
// graph rows + vectors, the downloaded model files (the M.1 storage seam's
// list/remove slice) and the OS-keychain license token (the B.3 seam). The
// confirm affordance lives in U.5 — this module only calls the injected
// `() => Promise<boolean>`; a declined confirm aborts with NOTHING touched.
//
// Table coverage (§5/§8/§9): every `STORE_TABLES` entry except `_migrations`
// (people, sessions, turns, charts, readings, consumed_codes, license_state,
// lore_nodes, lore_edges), plus the `vec_nodes` mirror when present on the
// handle. DECISION, documented per the task notes: `_migrations` is schema
// bookkeeping, not user data, and is deliberately KEPT — clearing it would
// desync the migration ledger from the shipped schema. The data is gone; the
// shape stays current (the L.1 lore core's `deleteAll` keeps it too).
//
// Lore deletion goes through the injected store's `deleteAll()` — the L.1
// verified real-deletion contract (TR-4: 0 rows in both lore tables and the
// vectors) — because the sidecar handle is the only path to its vector mirror.
// The app-handle lore tables are additionally cleared directly, so
// merge-by-id import rows (written through the bare db handle per db.ts) die
// even when no store is wired. Same-handle production wiring makes the second
// pass an idempotent no-op on already-empty tables.

import { type SqliteDb, STORE_TABLES, VEC_NODES_TABLE } from "@natally/lore/ddl";
import type { LoreStore } from "@natally/lore/store";
import type { AppDb } from "./db";

/**
 * Minimal model-file storage seam for destroy — the read/erase slice of the
 * M.1 `AssetStorage` surface (`apps/local/src/mirror/download.ts`). Lists
 * committed files and leftover `.part` sinks alike; `remove` on an absent
 * name is already-removed (M.1 contract).
 */
export interface DestroyStorage {
  /** Names currently persisted by the platform. */
  list(): Promise<string[]>;
  /** Erase one persisted name. */
  remove(name: string): Promise<void>;
}

/** Minimal B.3 keychain seam for destroy. */
export interface DestroyKeychain {
  clearToken(): Promise<void>;
}

export interface DestroyOptions {
  /** The opened app database (X.1 `openAppDb` bundle). */
  readonly db: AppDb;
  /** Lore sidecar; present ⇒ its `deleteAll()` clears lore rows + vectors. */
  readonly lore?: LoreStore;
  /** Downloaded-model storage; present ⇒ every listed file is removed. */
  readonly storage?: DestroyStorage;
  /** Keychain; present ⇒ the license token is cleared. */
  readonly keychain?: DestroyKeychain;
  /** U.5's confirm plate; resolves `false` ⇒ abort with nothing touched. */
  readonly confirm: () => Promise<boolean>;
}

/** What actually got deleted — honest counts of deletions, not intents (INC-19). */
export interface DestroyReport {
  readonly tablesCleared: string[];
  readonly filesDeleted: string[];
  readonly tokenCleared: boolean;
}

/**
 * Declined confirm ⇒ `{ aborted: true }` and nothing touched; accepted ⇒ the
 * full {@link DestroyReport} with `aborted: false`.
 */
export type DestroyResult =
  | { readonly aborted: true }
  | ({ readonly aborted: false } & DestroyReport);

function transaction<T>(db: SqliteDb, body: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = body();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Rollback itself failed (transaction already closed) — surface the
      // original error below instead of masking it.
    }
    throw error;
  }
}

function tableExists(db: SqliteDb, table: string): boolean {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
    undefined
  );
}

/** User-owned tables in child-before-parent order; `_migrations` kept by decision. */
function userTableDeleteOrder(): readonly string[] {
  return [...STORE_TABLES].reverse().filter((table) => table !== "_migrations");
}

/**
 * Delete everything user-owned (§8.4): all app + lore table rows, the lore
 * sidecar's rows and vectors, downloaded model files, and the keychain
 * license token. Idempotent — a second run clears zero rows, lists zero
 * files, and re-clears the token without error.
 */
export async function destroyEverything(options: DestroyOptions): Promise<DestroyResult> {
  if (!(await options.confirm())) {
    return { aborted: true };
  }

  const handle = options.db.db;
  const cleared = new Set<string>();

  // 1. App-handle rows: one transaction, children before parents (the same
  //    order the lore core uses), `_migrations` skipped by decision.
  transaction(handle, () => {
    for (const table of userTableDeleteOrder()) {
      handle.exec(`DELETE FROM ${String(table)}`);
      cleared.add(String(table));
    }
    if (tableExists(handle, VEC_NODES_TABLE)) {
      handle.exec(`DELETE FROM ${VEC_NODES_TABLE}`);
      cleared.add(VEC_NODES_TABLE);
    }
  });

  // 2. Lore sidecar: rows + vectors through the store's own real-deletion
  //    contract (TR-4). Falls back to the X.1 binding when the explicit
  //    param is absent; the contract guarantees the vector mirror dies too.
  const loreStore = options.lore ?? options.db.loreStore?.store;
  if (loreStore) {
    await loreStore.deleteAll();
    cleared.add("lore_nodes");
    cleared.add("lore_edges");
    cleared.add(VEC_NODES_TABLE);
  }

  // 3. Downloaded model files (committed weights and leftover `.part` sinks).
  const filesDeleted: string[] = [];
  if (options.storage) {
    for (const name of await options.storage.list()) {
      await options.storage.remove(name);
      filesDeleted.push(name);
    }
  }

  // 4. Keychain license token.
  let tokenCleared = false;
  if (options.keychain) {
    await options.keychain.clearToken();
    tokenCleared = true;
  }

  return {
    aborted: false,
    tablesCleared: [...cleared],
    filesDeleted,
    tokenCleared,
  };
}
