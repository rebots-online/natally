import { MIGRATIONS, VEC_MIGRATION_ID, vecMigration } from "./ddl.js";

export interface SqliteStatement {
  /** Return undefined when the query has no matching row. */
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): unknown;
}

/** Structurally satisfied by better-sqlite3 and synchronous portable adapters. */
export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
}

export interface MigrateOptions {
  vec: boolean;
  /** Set false when the adapter cannot load extensions; defaults to true. */
  extensions?: boolean;
  /** Required only when creating vec_nodes with a loaded vec0 module. */
  vecDimensions?: number;
}

/**
 * Apply pending DDL and its ledger entries atomically. The host loads sqlite-vec;
 * an unavailable or disabled extension leaves all nine application tables usable.
 * A savepoint preserves ownership of any transaction opened by the caller.
 * Callers migrating within a transaction must enable foreign_keys beforehand.
 */
export function migrate(db: SqliteDatabase, options: MigrateOptions): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("SAVEPOINT natally_migrations");

  try {
    db.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY)");
    const applied = db.prepare("SELECT id FROM _migrations WHERE id = ?");
    const record = db.prepare("INSERT INTO _migrations (id) VALUES (?)");

    for (const migration of MIGRATIONS) {
      if (applied.get(migration.id) !== undefined) continue;
      db.exec(migration.sql);
      record.run(migration.id);
    }

    if (
      options.vec &&
      options.extensions !== false &&
      applied.get(VEC_MIGRATION_ID) === undefined &&
      db.prepare("SELECT name FROM pragma_module_list WHERE name = 'vec0'").get() !== undefined
    ) {
      if (options.vecDimensions === undefined) {
        throw new Error("vecDimensions is required when creating vec_nodes");
      }
      const migration = vecMigration(options.vecDimensions);
      db.exec(migration.sql);
      record.run(migration.id);
    }

    db.exec("RELEASE SAVEPOINT natally_migrations");
  } catch (error) {
    db.exec("ROLLBACK TO SAVEPOINT natally_migrations");
    db.exec("RELEASE SAVEPOINT natally_migrations");
    throw error;
  }
}
