import {
  type ManifestAsset,
  ManifestAssetSchema,
  type ModelManifest,
  ModelManifestSchema,
} from "../../../../packages/billing/src/types.js";
import type { BrowserRuntimeConfig } from "../config.js";

export type { ManifestAsset, ModelManifest };
export type MirrorConfig = Pick<BrowserRuntimeConfig, "modelMirrorBase" | "licenseBridgeUrl">;
export type MirrorFetch = typeof fetch;

function checkedURL(value: string, base?: URL): URL {
  const url = new URL(value, base);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      "Mirror URLs require HTTPS (HTTP is permitted only on loopback), without credentials or fragments",
    );
  }
  return url;
}

/** Exact origins also pin scheme/port; redirects cannot escape the mirror/bridge allowlist. */
export class MirrorNetwork {
  readonly base: string;
  private readonly origins: ReadonlySet<string>;

  constructor(
    config: MirrorConfig,
    private readonly fetcher: MirrorFetch = globalThis.fetch,
  ) {
    const base = checkedURL(config.modelMirrorBase);
    if (base.search) throw new Error("Model mirror base must not contain a query");
    base.pathname = `${base.pathname.replace(/\/$/, "")}/`;
    this.base = base.href;
    this.origins = new Set([
      base.origin,
      ...(config.licenseBridgeUrl ? [checkedURL(config.licenseBridgeUrl).origin] : []),
    ]);
  }

  resolve(file: string): string {
    const url = checkedURL(file, new URL(this.base));
    if (!this.origins.has(url.origin)) throw new Error(`Mirror host is not allowed: ${url.origin}`);
    return url.href;
  }

  async fetch(file: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetcher.call(globalThis, this.resolve(file), {
      ...init,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    // Also check adapters that return a followed response despite redirect: error.
    if (response.url) this.resolve(response.url);
    if (response.redirected || response.type === "opaqueredirect") {
      throw new Error("Mirror redirects are not permitted");
    }
    return response;
  }
}

/** Validate at every public download boundary, even when a caller supplied a typed object. */
export function validateAsset(input: unknown): Readonly<ManifestAsset> {
  const asset = ManifestAssetSchema.parse(input);
  const hasControl = (value: string) =>
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
  if (!asset.id.trim() || hasControl(asset.id)) {
    throw new Error("Manifest asset ID must be explicit, nonblank and free of control characters");
  }
  if (!asset.file.trim() || hasControl(asset.file)) {
    throw new Error("Manifest asset file must be explicit and nonblank");
  }
  if (!Number.isSafeInteger(asset.bytes) || !Number.isSafeInteger(requiredSpace(asset.bytes))) {
    throw new Error("Manifest asset bytes and required space must be safe integers");
  }
  return Object.freeze({ ...asset, sha256: asset.sha256.toLowerCase() });
}

export function requiredSpace(bytes: number): number {
  return bytes + Math.ceil(bytes / 10);
}

export function parseManifest(input: unknown, network: MirrorNetwork): Readonly<ModelManifest> {
  const manifest = ModelManifestSchema.parse(input);
  const ids = new Set<string>();
  const files = new Set<string>();
  const assets = manifest.assets.map((inputAsset) => {
    const asset = validateAsset(inputAsset);
    const file = network.resolve(asset.file);
    if (ids.has(asset.id)) throw new Error(`Duplicate manifest asset ID: ${asset.id}`);
    if (files.has(file)) throw new Error(`Duplicate manifest asset file: ${asset.file}`);
    ids.add(asset.id);
    files.add(file);
    return asset;
  });
  // Freeze the array at runtime as well as each asset: catalogue identities cannot drift.
  Object.freeze(assets);
  return Object.freeze({ version: manifest.version, assets });
}

export async function fetchManifest(
  network: MirrorNetwork,
  signal?: AbortSignal,
): Promise<Readonly<ModelManifest>> {
  const response = await network.fetch("manifest.json", { signal });
  if (!response.ok) throw new Error(`Manifest request failed: HTTP ${response.status}`);
  let input: unknown;
  try {
    input = await response.json();
  } catch (cause) {
    throw new Error("Manifest is not valid JSON", { cause });
  }
  return parseManifest(input, network);
}
