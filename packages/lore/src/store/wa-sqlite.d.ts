// wa-sqlite 1.0.0 publishes SQLiteAPI types but omits these example VFS modules.
declare module "wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js" {
  export interface OriginPrivateFileSystemVFS extends SQLiteVFS {
    readonly name: string;
    close(): Promise<void>;
  }
  export const OriginPrivateFileSystemVFS: { new (): OriginPrivateFileSystemVFS };
}
declare module "wa-sqlite/src/examples/IDBBatchAtomicVFS.js" {
  export interface IDBBatchAtomicVFS extends SQLiteVFS {
    readonly name: string;
    close(): Promise<void>;
  }
  export const IDBBatchAtomicVFS: {
    new (
      name?: string,
      options?: { durability?: "default" | "strict" | "relaxed" },
    ): IDBBatchAtomicVFS;
  };
}
declare module "wa-sqlite/dist/wa-sqlite-async.wasm?url" {
  const url: string;
  export default url;
}
