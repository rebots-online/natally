// natally — web (browser) LoreStore adapter shell (ARCHITECTURE §8.1).
//
// The package stays platform-pure (dependency-rule rescue, architect ruling):
// wa-sqlite and sqlite-vec are NOT dependencies of @natally/lore. The app
// capability layer (I.3) injects the already-initialized module handles —
//
//   * `sqlite3`: a wa-sqlite module opened against an OPFS (fallback
//     IndexedDB) VFS, wrapped into the synchronous `SqliteDb` seam ddl.ts
//     defines (exec/prepare). How the host realizes that seam over its async
//     wasm backend is the host's concern; this adapter only consumes it.
//   * `vecExt` (optional): the loaded sqlite-vec wasm extension, whose
//     `load(db)` attaches the extension to the database. `true` ⇒ the
//     `vec_nodes` mirror migration is emitted by `migrate`.
//
// After opening, the database is migrated (idempotent) and the shared core
// (`createSqliteLoreStore`) is returned as the `LoreStore`.
import type { SqliteDb } from "../ddl";
import { migrate } from "../migrate";
import type { LoreStore } from "../store";
import { createSqliteLoreStore, type EmbedFn } from "./common";

/** Minimal structural view of the injected wa-sqlite handle (§8.1). */
export interface WaSqlite3Like {
  /** Open (creating if needed) the store database inside the module's VFS. */
  open(path: string): Promise<SqliteDb>;
}

/** Minimal structural view of the injected sqlite-vec wasm extension (§8.1). */
export interface VecExtLike {
  /** Attach the extension to `db`; `true` only when the load succeeded. */
  load(db: SqliteDb): boolean;
}

export interface WebLoreStoreOptions {
  /** Injected, already-initialized wa-sqlite module handle (see file header). */
  readonly sqlite3: WaSqlite3Like;
  /** Injected sqlite-vec wasm extension; omitted ⇒ vec-off (no mirror table). */
  readonly vecExt?: VecExtLike;
  /** Query embedder — forwarded to the core; absent ⇒ `query()` throws. */
  readonly embed?: EmbedFn;
  /** Declared embedding dimension (`VITE_LORE_EMBED_DIM`, default 384). */
  readonly embedDim?: number;
  /** Database file name inside the VFS; default `natally.db`. */
  readonly path?: string;
}

/** Open, migrate and wrap the browser store (§8.1: wa-sqlite on OPFS, sqlite-vec when loaded). */
export async function createWebLoreStore(options: WebLoreStoreOptions): Promise<LoreStore> {
  const db = await options.sqlite3.open(options.path ?? "natally.db");
  const vec = options.vecExt ? options.vecExt.load(db) : false;
  migrate(db, { vec, embedDim: options.embedDim });
  return createSqliteLoreStore(db, {
    vec,
    runtime: "wa-sqlite/OPFS",
    embed: options.embed,
    embedDim: options.embedDim,
  });
}
