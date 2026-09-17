// SS.1 — Build-time storage-scope config, TypeScript side (architecture §19.1).
// The generated file is the single source; the Rust side reads the same file
// via include_str!. The scope is a public frozen constant, never a secret.
import generated from "../../../../config/asset-storage.generated.json";

export type AssetStorageConfig = Readonly<{
  scope: string;
  generatedAt: string;
  source: string;
}>;

export const assetStorageConfig: AssetStorageConfig = generated;

export const storageScope: string = assetStorageConfig.scope;
