// natally — SQLite migration runner over the shared DDL (ddl.ts).
// Idempotent: executed migration ids live in `_migrations`; a fresh run creates
// everything, a re-run is a no-op, and a partial ledger resumes from the first
// missing id. Each migration executes inside a transaction together with its
// ledger row, so a crash can never leave DDL applied without its record.
import {
  MIGRATIONS,
  type Migration,
  type SqliteDb,
  VEC_NODES_MIGRATION_ID,
  vecNodesMigration,
} from "./ddl";

/** Embedding dimension for `vec_nodes` when `VITE_LORE_EMBED_DIM` is unset (§8.1). */
const DEFAULT_EMBED_DIM = 384;

export interface MigrateOptions {
  /**
   * `true` only when the sqlite-vec extension is loaded by the host: emits the
   * `vec_nodes` virtual table (§8.1). `false` keeps the 9 concrete tables + ledger.
   */
  readonly vec: boolean;
  /** Embedding dimension; `VITE_LORE_EMBED_DIM` at runtime, default 384 (§8.1). */
  readonly embedDim?: number;
}

/**
 * Bring `db` up to the current schema (ARCHITECTURE §5/§8/§9).
 *
 * @returns The ids applied by THIS call, in order — empty when already current
 * (the idempotent re-run case).
 */
export function migrate(db: SqliteDb, opts: MigrateOptions): readonly string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);",
  );

  const done = new Set<string>();
  const rows = db.prepare("SELECT id FROM _migrations").all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    done.add(String(row["id"]));
  }

  const queue: readonly Migration[] = opts.vec
    ? [...MIGRATIONS, vecNodesMigration(opts.embedDim ?? DEFAULT_EMBED_DIM)]
    : MIGRATIONS;

  const applied: string[] = [];
  for (const migration of queue) {
    if (done.has(migration.id)) {
      continue;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(
        migration.id,
        Date.now(),
      );
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Rollback itself failed (transaction already closed) — surface the
        // original migration error below instead of masking it.
      }
      throw err;
    }
    applied.push(migration.id);
  }
  return applied;
}

/** Convenience re-export so consumers can detect the conditional vec migration id. */
export { VEC_NODES_MIGRATION_ID };
