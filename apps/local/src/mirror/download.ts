// natally — M.1: ranged, resumable, sha256-verified mirror downloads with
// atomic commit (ARCHITECTURE §7.1, §13).
//
// Flow: GET with `Range: bytes=<part-length>-` from whatever the platform
// storage already holds, stream the body into the `<file>.part` sink, then
// verify the SHA-256 of the WHOLE assembled file against the manifest digest
// BEFORE any commit. Commit is a single atomic rename part → final on the
// storage seam — no final-name file ever exists with unverified bytes.
//
// Digest note: production native lanes stream chunks straight into a native
// / WASM hasher; this API accepts that via the `digest` injectable (an
// {@link IncrementalDigest} factory). The default {@link bufferedSha256}
// assembles the buffer and calls `crypto.subtle` once — correct and fine for
// small files, not for multi-GB weights.
//
// On resume the prior part bytes are read back through the storage seam
// (`read`, added to the seam beyond the minimal listed members precisely so
// the whole-file digest can be recomputed after an app restart) and fed into
// the digest before the first live chunk, so verification always covers the
// complete blob.

import type { ManifestAsset } from "@natally/billing";
import { type FetchLike, hostOf, mirrorUrlFor } from "./manifest";

/** Suffix of the in-progress sink; the committed file never carries it. */
export const PART_SUFFIX = ".part";

export type DownloadErrorCode = "network" | "byte-count" | "sha256-mismatch";

export class DownloadError extends Error {
  constructor(
    readonly code: DownloadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DownloadError";
  }
}

/**
 * Incremental SHA-256. Production impls stream chunks into a native/WASM
 * hasher; the default buffered implementation below is correct for small
 * files and keeps this module runtime-pure.
 */
export interface IncrementalDigest {
  update(chunk: Uint8Array): void;
  /** Lowercase hex digest over everything fed so far. */
  hex(): Promise<string>;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/** Default digest: buffer everything, one `crypto.subtle.digest` at the end. */
export function bufferedSha256(): IncrementalDigest {
  const chunks: Uint8Array[] = [];
  let total = 0;
  return {
    update(chunk: Uint8Array): void {
      chunks.push(chunk);
      total += chunk.length;
    },
    async hex(): Promise<string> {
      const view = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) {
        view.set(chunk, at);
        at += chunk.length;
      }
      const digest = await crypto.subtle.digest("SHA-256", view);
      return toHex(new Uint8Array(digest));
    },
  };
}

/**
 * Writer handle returned by {@link AssetStorage.open}. `open` APPENDS
 * (creates when absent) so ranged resume just keeps writing.
 */
export interface StorageWriter {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/**
 * Platform byte-sink seam (I.3 wires the real impls):
 *
 * - native: real files under the OS cache dir, written through Tauri fs
 *   commands (`open` append-creates, `rename` is atomic on the same volume,
 *   `read` backs the resume digest);
 * - web: Cache Storage — `open` accumulates into the pending entry,
 *   `read` replays it, `rename` re-puts under the final key and deletes the
 *   pending one (Cache Storage has no true rename; the delete-after-put pair
 *   is the atomic-enough equivalent, and a crash leaves only the `.part`
 *   entry behind).
 *
 * `remove` on an absent name is a no-op (already removed).
 */
export interface AssetStorage {
  open(name: string): Promise<StorageWriter>;
  /** Bytes currently persisted under `name` (0 when absent). */
  length(name: string): Promise<number>;
  /** Full bytes under `name` (used to seed the resume digest). */
  read(name: string): Promise<Uint8Array>;
  /** Atomic on native filesystems; see the web note above. */
  rename(from: string, to: string): Promise<void>;
  /** Absent names are treated as already removed. */
  remove(name: string): Promise<void>;
}

export interface DownloadProgress {
  readonly assetId: string;
  readonly bytesDone: number;
  readonly bytesTotal: number;
}

export interface DownloadAssetOptions {
  /** Mirror base URL, e.g. the §13 `VITE_MODEL_MIRROR_BASE`. */
  baseUrl: string;
  storage: AssetStorage;
  fetchImpl?: FetchLike;
  onProgress?: (progress: DownloadProgress) => void;
  /**
   * Allowlisted hosts (§7.3: mirror + bridge, wired by I.3). When omitted
   * it defaults to the base's own host; when given it REPLACES the default.
   */
  allowedHosts?: readonly string[];
  /** Digest factory; defaults to {@link bufferedSha256}. */
  digest?: () => IncrementalDigest;
}

export interface DownloadResult {
  readonly assetId: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Downloads one manifest asset into the platform storage: ranged + resumable,
 * whole-blob SHA-256 verified before commit, committed by atomic rename.
 * Network failures keep the partial `.part` (resume); byte-count or digest
 * mismatches remove it (corrupted blob rejected, nothing committed).
 */
export async function downloadAsset(
  asset: ManifestAsset,
  options: DownloadAssetOptions,
): Promise<DownloadResult> {
  const { baseUrl, storage } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const allowedHosts = options.allowedHosts ?? [hostOf(baseUrl)];
  const url = mirrorUrlFor(baseUrl, asset.file, allowedHosts);
  const partName = `${asset.file}${PART_SUFFIX}`;

  let offset = await storage.length(partName);
  if (offset > asset.bytes) {
    // Stale part from an older, larger artifact under the same name: restart.
    await storage.remove(partName);
    offset = 0;
  }

  const headers: Record<string, string> = {};
  let resuming = offset > 0;
  if (resuming) {
    headers.Range = `bytes=${offset}-`;
  }

  let response: Response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (err) {
    throw new DownloadError("network", `download of "${asset.id}" failed: ${errorMessage(err)}`);
  }
  if (!response.ok) {
    throw new DownloadError("network", `download of "${asset.id}": HTTP ${response.status}`);
  }
  if (resuming && response.status === 200) {
    // Server ignored the Range request: nothing on disk is trustworthy for
    // the assembled digest — restart from zero.
    await storage.remove(partName);
    offset = 0;
    resuming = false;
  }

  const digest = (options.digest ?? bufferedSha256)();
  if (resuming) {
    digest.update(await storage.read(partName));
  }

  const body = response.body;
  if (body === null) {
    throw new DownloadError("network", `download of "${asset.id}": empty body`);
  }

  const writer = await storage.open(partName);
  let bytesDone = offset;
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value !== undefined) {
        await writer.write(value);
        digest.update(value);
        bytesDone += value.length;
        options.onProgress?.({
          assetId: asset.id,
          bytesDone,
          bytesTotal: asset.bytes,
        });
      }
    }
  } catch (err) {
    // Network-level failure mid-stream: the part stays for the next resume.
    throw new DownloadError(
      "network",
      `download of "${asset.id}" interrupted at ${bytesDone} bytes: ${errorMessage(err)}`,
    );
  } finally {
    await writer.close();
  }

  if (bytesDone !== asset.bytes) {
    await storage.remove(partName);
    throw new DownloadError(
      "byte-count",
      `download of "${asset.id}": expected ${asset.bytes} bytes, got ${bytesDone}`,
    );
  }

  const actualSha256 = await digest.hex();
  if (actualSha256 !== asset.sha256.toLowerCase()) {
    await storage.remove(partName);
    throw new DownloadError(
      "sha256-mismatch",
      `download of "${asset.id}": sha256 mismatch (expected ${asset.sha256}, got ${actualSha256})`,
    );
  }

  // Commit: exactly one atomic rename, only after full verification.
  await storage.rename(partName, asset.file);
  return {
    assetId: asset.id,
    file: asset.file,
    bytes: bytesDone,
    sha256: actualSha256,
  };
}
