/// <reference path="./wa-sqlite.d.ts" />
import * as SQLite from "wa-sqlite";
import SQLiteAsyncFactory from "wa-sqlite/dist/wa-sqlite-async.mjs";
import bundledWasmUrl from "wa-sqlite/dist/wa-sqlite-async.wasm?url";
import { IDBBatchAtomicVFS } from "wa-sqlite/src/examples/IDBBatchAtomicVFS.js";
import { OriginPrivateFileSystemVFS } from "wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js";
import { migrateAsync, type SqlRow, type SqlValue, type StoreConnection } from "./common.js";
import type { BrowserOptions } from "./web.js";

export type WasmModuleFactory = typeof SQLiteAsyncFactory;

/** Called in a worker: OPFS's createSyncAccessHandle is worker-only. */
export async function openBrowserConnection(
  options: BrowserOptions = {},
  moduleFactory: WasmModuleFactory = SQLiteAsyncFactory,
): Promise<StoreConnection> {
  const filename = options.filename ?? "natally.sqlite3";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(filename))
    throw new Error("Invalid lore database filename");
  const wasmUrl = new URL(options.wasmUrl ?? bundledWasmUrl, import.meta.url).href;
  const module = await moduleFactory({ locateFile: () => wasmUrl });
  const sqlite = SQLite.Factory(module);
  let storage!: "opfs" | "indexeddb";
  let fallbackReason: string | undefined;
  let vfs!: OriginPrivateFileSystemVFS | IDBBatchAtomicVFS;
  let handle!: number;
  // Persist the first backend choice: a later browser capability change must not
  // silently open an empty OPFS database in place of existing IndexedDB lore.
  const registry = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("natally-lore-storage", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("databases");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await navigator.locks.request(`natally-lore-backend:${filename}`, async () => {
      const remembered = await new Promise<"opfs" | "indexeddb" | undefined>((resolve, reject) => {
        const request = registry.transaction("databases").objectStore("databases").get(filename);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (
        remembered &&
        options.storage &&
        options.storage !== "auto" &&
        options.storage !== remembered
      ) {
        throw new Error(
          `Lore database already uses ${remembered}; changing storage requires an explicit migration`,
        );
      }
      const preference = remembered ?? options.storage ?? "auto";
      // Choose a backend before opening the database. Never mask corruption, lock or
      // migration failures by opening an apparently empty database on another backend.
      if (preference !== "indexeddb") {
        try {
          if (
            typeof navigator.storage?.getDirectory !== "function" ||
            typeof FileSystemFileHandle === "undefined" ||
            !("createSyncAccessHandle" in FileSystemFileHandle.prototype)
          ) {
            throw new Error("OPFS synchronous access handles are unavailable");
          }
          await navigator.storage.getDirectory();
          vfs = new OriginPrivateFileSystemVFS();
          storage = "opfs";
        } catch (error) {
          if (preference === "opfs") throw error;
          fallbackReason = error instanceof Error ? error.message : String(error);
          vfs = new IDBBatchAtomicVFS(`natally-lore-${filename}`, { durability: "strict" });
          storage = "indexeddb";
        }
      } else {
        vfs = new IDBBatchAtomicVFS(`natally-lore-${filename}`, { durability: "strict" });
        storage = "indexeddb";
      }
      sqlite.vfs_register(vfs, true);
      let opened = false;
      try {
        handle = await sqlite.open_v2(
          filename,
          SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE,
          vfs.name,
        );
        opened = true;
        await sqlite.exec(
          handle,
          "PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;",
        );
        await new Promise<void>((resolve, reject) => {
          const transaction = registry.transaction("databases", "readwrite", {
            durability: "strict",
          });
          transaction.objectStore("databases").put(storage, filename);
          transaction.oncomplete = () => resolve();
          transaction.onabort = () =>
            reject(transaction.error ?? new Error("Lore backend selection could not be saved"));
        });
      } catch (error) {
        if (opened) await sqlite.close(handle);
        await vfs.close();
        throw error;
      }
    });
  } finally {
    registry.close();
  }
  let closed = false;
  // A wa-sqlite Asyncify module must never execute overlapping async calls.
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(() => {
      if (closed) throw new Error("Lore SQLite connection is closed");
      return operation();
    });
    pending = result.catch(() => undefined);
    return result;
  };
  const exec = async (sql: string) => {
    await sqlite.exec(handle, sql);
  };
  const all = async (sql: string, parameters: SqlValue[] = []): Promise<SqlRow[]> => {
    const rows: SqlRow[] = [];
    for await (const statement of sqlite.statements(handle, sql)) {
      sqlite.bind_collection(statement, parameters);
      while ((await sqlite.step(statement)) === SQLite.SQLITE_ROW) {
        const columns = sqlite.column_names(statement);
        const values = sqlite.row(statement);
        rows.push(
          Object.fromEntries(
            columns.map((name, i) => {
              const value = values[i];
              if (typeof value === "bigint") {
                if (!Number.isSafeInteger(Number(value)))
                  throw new RangeError("SQLite integer exceeds JavaScript precision");
                return [name, Number(value)];
              }
              return [name, value];
            }),
          ) as SqlRow,
        );
      }
    }
    return rows;
  };
  return {
    initialize: (options) =>
      serialize(async () => ({
        storage,
        ...(fallbackReason === undefined ? {} : { fallbackReason }),
        vec: await migrateAsync({ exec, all }, options),
      })),
    batch: (statements) =>
      serialize(async () => {
        await exec("BEGIN IMMEDIATE");
        try {
          const rows: SqlRow[][] = [];
          for (const statement of statements)
            rows.push(await all(statement.sql, statement.parameters));
          await exec("COMMIT");
          return rows;
        } catch (error) {
          await exec("ROLLBACK");
          throw error;
        }
      }),
    close: () =>
      serialize(async () => {
        try {
          await sqlite.close(handle);
        } finally {
          closed = true;
          await vfs.close();
        }
      }),
  };
}
