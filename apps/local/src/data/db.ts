// natally — app data layer wiring (ARCHITECTURE §5 entities, §8.4 boundaries, J8 export).
//
// `openAppDb` takes the HOST-INJECTED `SqliteDb` handle — the structural seam from
// `@natally/lore/ddl` (exec/prepare only, no vendor types) — and returns the
// repository bundle. `migrate(db, { vec: false })` runs on open; the re-run is an
// idempotent no-op. The sqlite-vec mirror is the lore sidecar's concern, not the
// app repositories'.
//
// I.3 wiring (documented contract): the native adapter opens the rusqlite-backed
// handle behind Tauri; the web adapter opens wa-sqlite over OPFS. Both construct
// this same seam and hand the handle here — from that point `openAppDb` owns it.
// When lore ships in the same process, the sidecar binding is
// `{ store: createSqliteLoreStore(handle, …), db: handle }` (§8.4): the same
// handle in production wiring, a second in-memory handle under test.
import type { SqliteDb } from "@natally/lore/ddl";
import { migrate } from "@natally/lore/migrate";
import type { LoreStore } from "@natally/lore/store";
import { type ChartsRepo, createChartsRepo } from "./charts";
import { createPeopleRepo, type PeopleRepo } from "./people";
import { createSessionsRepo, type SessionsRepo } from "./sessions";
import { createTurnsRepo, type TurnsRepo } from "./turns";

/**
 * The lore sidecar (§8.4). `store` is the real L.1 `LoreStore` — J8 export pulls
 * the lore graph via its `exportAll()`. `db` is the SAME handle the store backs:
 * merge-by-id lore import writes through it (the seam interface has no import
 * method, and import must not fabricate one).
 */
export interface LoreStoreBinding {
  readonly store: LoreStore;
  readonly db: SqliteDb;
}

export interface OpenAppDbOptions {
  /** Lore sidecar; absent when the host wires data without a lore graph. */
  readonly loreStore?: LoreStoreBinding;
}

/** The opened app database: the raw seam plus one repository per §5 entity table. */
export interface AppDb {
  readonly db: SqliteDb;
  readonly loreStore?: LoreStoreBinding;
  readonly people: PeopleRepo;
  readonly sessions: SessionsRepo;
  readonly turns: TurnsRepo;
  readonly charts: ChartsRepo;
}

/**
 * Migrate the handle to the current schema and bundle the §5 repositories.
 * Idempotent: calling again over an already-migrated handle is a no-op.
 */
export function openAppDb(db: SqliteDb, opts: OpenAppDbOptions = {}): AppDb {
  migrate(db, { vec: false });
  return {
    db,
    loreStore: opts.loreStore,
    people: createPeopleRepo(db),
    sessions: createSessionsRepo(db),
    turns: createTurnsRepo(db),
    charts: createChartsRepo(db),
  };
}
