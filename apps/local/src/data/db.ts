import type { MigrateOptions } from "@natally/lore/migrate";
import {
  type Graph,
  migrationPlan,
  SqliteLoreStore,
  type SqlRow,
  type SqlStatement,
  type SqlValue,
  type StoreCapabilities,
  type StoreConnection,
  type StoreOptions,
} from "@natally/lore/store/common";
import type { NativeStoreOptions } from "@natally/lore/store/native";
import { synchronousConnection, type WebStoreOptions } from "@natally/lore/store/web";

export type { SqlRow, SqlStatement, SqlValue, StoreConnection };

export class DataDatabase {
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing?: Promise<void>;

  private constructor(
    private readonly connection: StoreConnection,
    readonly capabilities: StoreCapabilities,
    readonly lore: SqliteLoreStore,
  ) {}

  static async open(
    connection: StoreConnection,
    options: StoreOptions = {},
  ): Promise<DataDatabase> {
    // L.1 initializes the canonical T0.9 migrations on this same connection.
    const lore = await SqliteLoreStore.open(connection, options);
    return new DataDatabase(connection, lore.capabilities, lore);
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Data database is closed"));
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }

  /** The adapter must commit the entire batch, or roll back every statement. */
  batch(statements: SqlStatement[]): Promise<SqlRow[][]> {
    return this.run(() => this.connection.batch(statements));
  }

  /** Run repository reads and L.1 exportAll in ONE backend transaction, so a
   * concurrent writer cannot split a backup across different database states. */
  snapshot(statements: SqlStatement[]): Promise<{ rows: SqlRow[][]; graph: Graph }> {
    return this.run(async () => {
      let rows: SqlRow[][] = [];
      const snapshotLore = await SqliteLoreStore.open({
        initialize: async () => this.capabilities,
        batch: async (loreStatements) => {
          const result = await this.connection.batch([...statements, ...loreStatements]);
          rows = result.slice(0, statements.length);
          return result.slice(statements.length);
        },
        // This view borrows the database; DataDatabase owns its lifetime.
        close: async () => {},
      });
      try {
        const graph = await snapshotLore.exportAll();
        return { rows, graph };
      } finally {
        await snapshotLore.close();
      }
    });
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      this.closing = this.pending.then(() => this.lore.close());
    }
    return this.closing;
  }
}

let mountedDatabase: DataDatabase | undefined;

/** Parent mounting supplies a real opened database. No implicit in-memory fallback. */
export function setDatabase(database: DataDatabase | undefined): void {
  mountedDatabase = database;
}

export function getDatabase(): DataDatabase {
  if (!mountedDatabase) throw new Error("Data database has not been mounted");
  return mountedDatabase;
}

type WireValue = Exclude<SqlValue, Uint8Array> | { blob: number[] };

/** Same plugin:lore commands and BLOB envelope as L.1's native adapter. */
export function nativeConnection(invoke: NativeStoreOptions["invoke"]): StoreConnection {
  let connectionId: number | undefined;
  return {
    async initialize(migration) {
      const plan = migrationPlan(migration);
      const result = await invoke<{ connectionId: number; capabilities: StoreCapabilities }>(
        "plugin:lore|lore_open",
        {
          migrations: plan.migrations,
          vector: plan.vector,
          options: {
            vec: migration.vec,
            extensions: migration.extensions ?? true,
            vecDimensions: migration.vecDimensions ?? null,
          },
        },
      );
      connectionId = result.connectionId;
      return result.capabilities;
    },
    async batch(statements) {
      if (connectionId === undefined) throw new Error("Native data database is not initialized");
      const result = await invoke<Record<string, WireValue>[][]>("plugin:lore|lore_batch", {
        connectionId,
        statements: statements.map(({ sql, parameters = [] }) => ({
          sql,
          parameters: parameters.map((value) =>
            value instanceof Uint8Array ? { blob: Array.from(value) } : value,
          ),
        })),
      });
      return result.map((rows) =>
        rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              value !== null && typeof value === "object" ? Uint8Array.from(value.blob) : value,
            ]),
          ),
        ),
      );
    },
    async close() {
      if (connectionId !== undefined) {
        await invoke("plugin:lore|lore_close", { connectionId });
        connectionId = undefined;
      }
    },
  };
}

/** Dedicated L.1 worker, with its persistent OPFS/IndexedDB SQLite backend. */
export function webConnection(options: WebStoreOptions = {}): StoreConnection {
  if (options.database) return synchronousConnection(options.database, options.closeDatabase);
  const worker =
    options.createWorker?.() ??
    new Worker(new URL("../../../../../packages/lore/src/store/web.worker.ts", import.meta.url), {
      type: "module",
    });
  let sequence = 0;
  let failure: Error | undefined;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const fail = (error: Error) => {
    failure = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  worker.addEventListener("error", (event) =>
    fail(new Error(event.message || "Data worker failed")),
  );
  worker.addEventListener("messageerror", () => fail(new Error("Invalid data worker response")));
  worker.addEventListener("message", ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  });
  function call<T>(method: string, args: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      const id = ++sequence;
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try {
        worker.postMessage({ id, method, args });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }
  return {
    initialize: (migration: MigrateOptions) =>
      call("initialize", {
        filename: options.filename,
        storage: options.storage,
        wasmUrl: options.wasmUrl,
        migration,
      }),
    batch: (statements) => call("batch", statements),
    async close() {
      try {
        if (!failure) await call("close", null);
      } finally {
        worker.terminate();
        fail(new Error("Data worker closed"));
      }
    },
  };
}

export function openWebDatabase(options: WebStoreOptions = {}): Promise<DataDatabase> {
  return DataDatabase.open(webConnection(options), options);
}

export function openNativeDatabase(options: NativeStoreOptions): Promise<DataDatabase> {
  return DataDatabase.open(nativeConnection(options.invoke), options);
}

export function parseStoredJson(value: SqlValue | undefined, column: string): unknown {
  try {
    if (typeof value !== "string") throw new Error("Expected JSON text");
    return JSON.parse(value);
  } catch (cause) {
    throw new Error(`Corrupt data ${column}`, { cause });
  }
}
