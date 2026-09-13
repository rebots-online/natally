import type { StoreConnection } from "./common.js";
import { openBrowserConnection } from "./web-sqlite.js";

let connection: StoreConnection | undefined;
let queue: Promise<unknown> = Promise.resolve();
self.addEventListener("message", ({ data }) => {
  queue = queue.then(async () => {
    try {
      let result: unknown;
      if (data.method === "initialize") {
        if (connection) throw new Error("Lore worker already initialized");
        connection = await openBrowserConnection(data.args);
        result = await connection.initialize(data.args.migration);
      } else if (data.method === "batch") {
        if (!connection) throw new Error("Lore worker is not initialized");
        result = await connection.batch(data.args);
      } else if (data.method === "close") {
        await connection?.close();
        connection = undefined;
      } else throw new Error("Unknown Lore worker operation");
      self.postMessage({ id: data.id, result });
    } catch (error) {
      self.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});
