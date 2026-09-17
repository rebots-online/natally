import type { MirrorStorage, SpaceAdapter } from "./cache.js";
import {
  type ManifestAsset,
  type MirrorNetwork,
  requiredSpace,
  validateAsset,
} from "./manifest.js";

// SHA-256 compression constants, FIPS 180-4 section 4.2.2.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

/** Incremental digest: one 64-byte block and 64-word schedule, independent of asset size. */
export class StreamingSha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private buffered = 0;
  private length = 0;
  private finished = false;

  update(bytes: Uint8Array): this {
    if (this.finished) throw new Error("SHA-256 digest is already finalized");
    this.length += bytes.byteLength;
    if (!Number.isSafeInteger(this.length)) throw new Error("SHA-256 input length is too large");
    let offset = 0;
    while (offset < bytes.byteLength) {
      const size = Math.min(64 - this.buffered, bytes.byteLength - offset);
      this.block.set(bytes.subarray(offset, offset + size), this.buffered);
      this.buffered += size;
      offset += size;
      if (this.buffered === 64) {
        this.compress();
        this.buffered = 0;
      }
    }
    return this;
  }

  private compress(): void {
    const w = this.words;
    const view = new DataView(this.block.buffer);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
      const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = Array.from(this.state) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const t1 =
        (h +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          K[i]! +
          w[i]!) >>>
        0;
      const t2 =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) this.state[i] = (this.state[i]! + next[i]!) >>> 0;
  }

  digestHex(): string {
    if (this.finished) throw new Error("SHA-256 digest is already finalized");
    this.finished = true;
    this.block[this.buffered++] = 0x80;
    if (this.buffered > 56) {
      this.block.fill(0, this.buffered);
      this.compress();
      this.buffered = 0;
    }
    this.block.fill(0, this.buffered, 56);
    const view = new DataView(this.block.buffer);
    view.setUint32(56, Math.floor(this.length / 0x20000000), false);
    view.setUint32(60, (this.length % 0x20000000) * 8, false);
    this.compress();
    return Array.from(this.state, (word) => word.toString(16).padStart(8, "0")).join("");
  }
}

export interface DownloadProgress {
  readonly id: string;
  readonly bytes: number;
  readonly totalBytes: number;
  readonly percent: number;
  readonly state: "downloading" | "verifying" | "present";
}

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: Readonly<DownloadProgress>) => void;
}

export interface DownloadResult {
  readonly asset: Readonly<ManifestAsset>;
  /** Publication succeeded; a later partial-file cleanup failure is reported separately. */
  readonly cleanupError?: unknown;
}

export class InsufficientSpaceError extends Error {
  constructor(
    readonly requiredBytes: number,
    readonly availableBytes: number,
  ) {
    super(
      `Insufficient model storage: requires ${requiredBytes} bytes, ${availableBytes} available`,
    );
    this.name = "InsufficientSpaceError";
  }
}

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

export class MirrorDownloader {
  constructor(
    readonly network: MirrorNetwork,
    readonly storage: MirrorStorage,
    private readonly space: SpaceAdapter,
  ) {}

  async download(
    input: Readonly<ManifestAsset>,
    options: DownloadOptions = {},
  ): Promise<DownloadResult> {
    const asset = validateAsset(input);
    this.network.resolve(asset.file);
    return this.storage.withLock(asset, async () => {
      const emit = (state: DownloadProgress["state"], bytes: number) =>
        options.onProgress?.(
          Object.freeze({
            id: asset.id,
            state,
            bytes,
            totalBytes: asset.bytes,
            percent:
              asset.bytes === 0 ? (state === "present" ? 100 : 0) : (bytes / asset.bytes) * 100,
          }),
        );
      options.signal?.throwIfAborted();
      if (await this.storage.isPresent(asset)) {
        emit("present", asset.bytes);
        return { asset };
      }
      let offset = await this.storage.partialBytes(asset);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > asset.bytes) {
        throw new Error("Invalid platform mirror partial byte count");
      }
      // The full asset + 10% precondition applies to resumes too, not just remaining bytes.
      const available = await this.space.availableBytes();
      if (!Number.isSafeInteger(available) || available < 0)
        throw new Error("Available model storage is unknown");
      if (available < requiredSpace(asset.bytes))
        throw new InsufficientSpaceError(requiredSpace(asset.bytes), available);
      emit("downloading", offset);
      let needsEmptyResponse = asset.bytes === 0;
      while (offset < asset.bytes || needsEmptyResponse) {
        needsEmptyResponse = false;
        options.signal?.throwIfAborted();
        const response = await this.network.fetch(asset.file, {
          signal: options.signal,
          headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
        });
        let end: number;
        try {
          if (response.status === 200) {
            if (offset > 0) {
              await this.storage.discardPartial(asset);
              offset = 0;
            }
            end = asset.bytes;
          } else if (response.status === 206) {
            const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
              response.headers.get("content-range") ?? "",
            );
            if (!match || Number(match[1]) !== offset || Number(match[3]) !== asset.bytes) {
              throw new IntegrityError("Invalid mirror Content-Range");
            }
            end = Number(match[2]) + 1;
            if (!Number.isSafeInteger(end) || end <= offset || end > asset.bytes) {
              throw new IntegrityError("Invalid mirror range end");
            }
          } else {
            throw new Error(`Model download failed: HTTP ${response.status}`);
          }
          const length = response.headers.get("content-length");
          if (length !== null && (!/^\d+$/.test(length) || Number(length) !== end - offset)) {
            throw new IntegrityError("Mirror response length disagrees with manifest/range");
          }
          if (
            response.headers.get("content-encoding") &&
            response.headers.get("content-encoding") !== "identity"
          ) {
            throw new IntegrityError("Encoded mirror responses cannot be resumed safely");
          }
          if (!response.body) throw new Error("Model response has no readable body");
        } catch (error) {
          await response.body?.cancel().catch(() => undefined);
          throw error;
        }
        const reader = response.body?.getReader();
        try {
          while (true) {
            options.signal?.throwIfAborted();
            const next = await reader.read();
            if (next.done) break;
            if (!next.value.byteLength) continue;
            if (offset + next.value.byteLength > end)
              throw new IntegrityError("Mirror response exceeds declared size");
            await this.storage.appendPartial(asset, offset, next.value);
            offset += next.value.byteLength;
            emit("downloading", offset);
          }
        } catch (error) {
          await reader.cancel().catch(() => undefined);
          if (error instanceof IntegrityError) await this.storage.discardPartial(asset);
          throw error;
        } finally {
          reader.releaseLock();
        }
        if (offset !== end)
          throw new Error("Mirror response interrupted; partial retained for resume");
      }
      options.signal?.throwIfAborted();
      emit("verifying", offset);
      // Verify persisted bytes, including pre-existing resumed chunks, in bounded memory.
      const reader = (await this.storage.readPartial(asset)).getReader();
      const hash = new StreamingSha256();
      let verified = 0;
      try {
        while (true) {
          options.signal?.throwIfAborted();
          const next = await reader.read();
          if (next.done) break;
          verified += next.value.byteLength;
          if (verified > asset.bytes)
            throw new IntegrityError("Cached model exceeds manifest size");
          hash.update(next.value);
        }
        if (verified !== asset.bytes || hash.digestHex() !== asset.sha256) {
          throw new IntegrityError("Model SHA-256 or byte count mismatch; corrupted blob rejected");
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        if (error instanceof IntegrityError) await this.storage.discardPartial(asset);
        throw error;
      } finally {
        reader.releaseLock();
      }
      options.signal?.throwIfAborted();
      await this.storage.commit(asset);
      let cleanupError: unknown;
      try {
        await this.storage.discardPartial(asset);
      } catch (error) {
        cleanupError = error;
      }
      emit("present", asset.bytes);
      return cleanupError === undefined ? { asset } : { asset, cleanupError };
    });
  }
}
