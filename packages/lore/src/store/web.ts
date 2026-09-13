import { migrate, type SqliteDatabase } from "../migrate.js";
import {
  migrationPlan,
  SqliteLoreStore,
  type SqlRow,
  type StoreConnection,
  type StoreOptions,
  vectorCapability,
} from "./common.js";

/** Real better-sqlite3 satisfies this interface; it is never imported in a browser. */
export interface SynchronousDatabase extends SqliteDatabase {
  prepare(sql: string): ReturnType<SqliteDatabase["prepare"]> & {
    reader: boolean;
    all(...parameters: unknown[]): unknown[];
  };
  close(): unknown;
}
export interface BrowserOptions {
  filename?: string;
  storage?: "auto" | "opfs" | "indexeddb";
  /** A local/bundled wasm URL, including an optional compatible sqlite-vec build. */
  wasmUrl?: string;
}
export interface WebStoreOptions extends StoreOptions, BrowserOptions {
  /** Explicit dependency injection for the prescribed in-memory SQLite tests. */
  database?: SynchronousDatabase;
  /** The caller retains ownership of an injected connection unless set true. */
  closeDatabase?: boolean;
  /** A custom worker can initialize a sqlite-vec-enabled wa-sqlite module. */
  createWorker?: () => Worker;
}

export function synchronousConnection(
  db: SynchronousDatabase,
  closeDatabase = false,
): StoreConnection {
  return {
    async initialize(options) {
      migrationPlan(options);
      const all = async (sql: string) => db.prepare(sql).all() as SqlRow[];
      // Fail before making a vec-off writer available on an existing vec database.
      await vectorCapability(all, options, false);
      migrate(db, options);
      return { storage: "memory", vec: await vectorCapability(all, options) };
    },
    async batch(statements) {
      db.exec("SAVEPOINT lore_batch");
      try {
        const result = statements.map(({ sql, parameters = [] }) => {
          const prepared = db.prepare(sql);
          if (prepared.reader) return prepared.all(...parameters) as SqlRow[];
          prepared.run(...parameters);
          return [];
        });
        db.exec("RELEASE SAVEPOINT lore_batch");
        return result;
      } catch (error) {
        db.exec("ROLLBACK TO SAVEPOINT lore_batch");
        db.exec("RELEASE SAVEPOINT lore_batch");
        throw error;
      }
    },
    async close() {
      if (closeDatabase) db.close();
    },
  };
}

function workerConnection(worker: Worker, options: BrowserOptions): StoreConnection {
  let sequence = 0;
  let failed: Error | undefined;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const fail = (error: Error) => {
    failed = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  worker.addEventListener("error", (event) =>
    fail(new Error(event.message || "Lore SQLite worker failed")),
  );
  worker.addEventListener("messageerror", () =>
    fail(new Error("Invalid Lore SQLite worker response")),
  );
  worker.addEventListener("message", ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  });
  const call = <T>(method: string, args: unknown): Promise<T> =>
    new Promise((resolve, reject) => {
      if (failed) {
        reject(failed);
        return;
      }
      const id = ++sequence;
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try {
        worker.postMessage({ id, method, args });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  return {
    initialize: (migration) => call("initialize", { ...options, migration }),
    batch: (statements) => call("batch", statements),
    async close() {
      try {
        if (!failed) await call("close", null);
      } finally {
        worker.terminate();
        fail(new Error("Lore SQLite worker closed"));
      }
    },
  };
}

/** Production always uses persistent SQLite in a dedicated worker. */
export async function createWebLoreStore(options: WebStoreOptions = {}): Promise<SqliteLoreStore> {
  const connection = options.database
    ? synchronousConnection(options.database, options.closeDatabase)
    : workerConnection(
        options.createWorker?.() ??
          new Worker(new URL("./web.worker.ts", import.meta.url), { type: "module" }),
        {
          ...(options.filename !== undefined ? { filename: options.filename } : {}),
          ...(options.storage !== undefined ? { storage: options.storage } : {}),
          ...(options.wasmUrl !== undefined ? { wasmUrl: options.wasmUrl } : {}),
        },
      );
  return SqliteLoreStore.open(connection, options);
}
