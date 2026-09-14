import {
  migrationPlan,
  SqliteLoreStore,
  type SqlRow,
  type SqlValue,
  type StoreCapabilities,
  type StoreConnection,
  type StoreOptions,
} from "./common.js";

export type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type WireValue = Exclude<SqlValue, Uint8Array> | { blob: number[] };
/** Pass the installed app's @tauri-apps/api/core invoke; lore stays platform-neutral. */
export interface NativeStoreOptions extends StoreOptions {
  invoke: NativeInvoke;
}

/** Names, camelCase arguments, BLOB envelope and result shapes match lore_commands.rs. */
export async function createNativeLoreStore(options: NativeStoreOptions): Promise<SqliteLoreStore> {
  const invoke = options.invoke;
  let connectionId: number | undefined;
  const connection: StoreConnection = {
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
      if (connectionId === undefined) throw new Error("Native LoreStore is not initialized");
      const result = await invoke<Record<string, WireValue>[][]>("plugin:lore|lore_batch", {
        connectionId,
        statements: statements.map((statement) => ({
          sql: statement.sql,
          parameters: (statement.parameters ?? []).map((value) =>
            value instanceof Uint8Array ? { blob: Array.from(value) } : value,
          ),
        })),
      });
      return result.map((rows) =>
        rows.map(
          (row) =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key,
                value !== null && typeof value === "object" ? Uint8Array.from(value.blob) : value,
              ]),
            ) as SqlRow,
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
  return SqliteLoreStore.open(connection, options);
}
