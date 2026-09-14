import { type ManifestAsset, validateAsset } from "./manifest.js";

/** Native owners implement this against their cache directory and atomic rename commands. */
export interface MirrorStorage {
  withLock<T>(asset: Readonly<ManifestAsset>, operation: () => Promise<T>): Promise<T>;
  partialBytes(asset: Readonly<ManifestAsset>): Promise<number>;
  readPartial(asset: Readonly<ManifestAsset>): Promise<ReadableStream<Uint8Array>>;
  appendPartial(asset: Readonly<ManifestAsset>, offset: number, bytes: Uint8Array): Promise<void>;
  discardPartial(asset: Readonly<ManifestAsset>): Promise<void>;
  /** Publish a verified partial atomically; a failed publish must preserve the old entry. */
  commit(asset: Readonly<ManifestAsset>): Promise<void>;
  isPresent(asset: Readonly<ManifestAsset>): Promise<boolean>;
  read(asset: Readonly<ManifestAsset>): Promise<ReadableStream<Uint8Array> | null>;
  /** Remove all committed and partial versions for this ID, including durable metadata. */
  remove(asset: Readonly<ManifestAsset>): Promise<void>;
}

export interface SpaceAdapter {
  availableBytes(): Promise<number>;
}

export class WebSpaceAdapter implements SpaceAdapter {
  constructor(private readonly storage: Pick<StorageManager, "estimate"> = navigator.storage) {}

  async availableBytes(): Promise<number> {
    if (!this.storage?.estimate) throw new Error("Storage capacity estimate is unavailable");
    const { quota, usage } = await this.storage.estimate();
    if (
      typeof quota !== "number" ||
      typeof usage !== "number" ||
      !Number.isFinite(quota) ||
      !Number.isFinite(usage) ||
      quota < 0 ||
      usage < 0
    ) {
      throw new Error("Storage capacity estimate is unavailable");
    }
    return Math.max(0, Math.floor(quota - usage));
  }
}

export interface WebCacheOptions {
  cacheStorage: CacheStorage;
  locks: Pick<LockManager, "request">;
  origin: string;
  cacheName?: string;
}

/**
 * Chunks + a byte-count checkpoint survive interruptions. Cache.put publishes a final
 * response only after consuming its stream successfully, providing the web equivalent
 * of rename. No model-sized ArrayBuffer/Blob is assembled in application memory.
 */
export class WebMirrorStorage implements MirrorStorage {
  private readonly root: string;
  private readonly cacheName: string;

  constructor(private readonly options: WebCacheOptions) {
    this.root = new URL("/__model_mirror__/", options.origin).href;
    this.cacheName = options.cacheName ?? "natally-model-mirror-v1";
  }

  private cache(): Promise<Cache> {
    if (!this.options.cacheStorage) throw new Error("Web Cache Storage is unavailable");
    return this.options.cacheStorage.open(this.cacheName);
  }

  private idRoot(asset: Readonly<ManifestAsset>): string {
    // Prefix prevents IDs such as '.' and '..' becoming URL traversal segments.
    return `${this.root}id-${encodeURIComponent(validateAsset(asset).id)}/`;
  }

  private assetRoot(asset: Readonly<ManifestAsset>): string {
    return `${this.idRoot(asset)}${asset.sha256.toLowerCase()}-${asset.bytes}/`;
  }

  async withLock<T>(asset: Readonly<ManifestAsset>, operation: () => Promise<T>): Promise<T> {
    if (!this.options.locks?.request)
      throw new Error("Web Locks is required to serialize mirror cache writes");
    return this.options.locks.request(`${this.cacheName}:${this.idRoot(asset)}`, operation);
  }

  async partialBytes(asset: Readonly<ManifestAsset>): Promise<number> {
    const response = await (await this.cache()).match(`${this.assetRoot(asset)}partial`);
    if (!response) return 0;
    let checkpoint: unknown;
    try {
      checkpoint = await response.json();
    } catch (cause) {
      throw new Error("Invalid mirror partial checkpoint", { cause });
    }
    if (
      typeof checkpoint !== "number" ||
      !Number.isSafeInteger(checkpoint) ||
      checkpoint < 0 ||
      checkpoint > asset.bytes
    )
      throw new Error("Invalid mirror partial checkpoint");
    return checkpoint;
  }

  async appendPartial(
    asset: Readonly<ManifestAsset>,
    offset: number,
    bytes: Uint8Array,
  ): Promise<void> {
    const current = await this.partialBytes(asset);
    if (offset !== current || !bytes.byteLength || offset + bytes.byteLength > asset.bytes) {
      throw new Error("Invalid mirror chunk offset or size");
    }
    const cache = await this.cache();
    const root = this.assetRoot(asset);
    // Chunk first, checkpoint last. An orphan chunk can be overwritten on resume.
    await cache.put(
      `${root}chunks/${offset}`,
      new Response(bytes.slice().buffer, {
        headers: { "content-length": String(bytes.byteLength) },
      }),
    );
    await cache.put(`${root}partial`, new Response(String(offset + bytes.byteLength)));
  }

  async readPartial(asset: Readonly<ManifestAsset>): Promise<ReadableStream<Uint8Array>> {
    const total = await this.partialBytes(asset);
    const cache = await this.cache();
    const root = this.assetRoot(asset);
    let offset = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let chunkEnd = 0;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (true) {
            if (!reader) {
              if (offset === total) {
                controller.close();
                return;
              }
              const chunk = await cache.match(`${root}chunks/${offset}`);
              const size = Number(chunk?.headers.get("content-length"));
              if (
                !chunk?.body ||
                !Number.isSafeInteger(size) ||
                size <= 0 ||
                offset + size > total
              ) {
                throw new Error("Mirror partial chunk is missing or invalid");
              }
              reader = chunk.body.getReader();
              chunkEnd = offset + size;
            }
            const next = await reader.read();
            if (next.done) {
              reader.releaseLock();
              reader = undefined;
              if (offset !== chunkEnd) throw new Error("Mirror partial chunk is truncated");
              continue;
            }
            offset += next.value.byteLength;
            if (offset > chunkEnd) throw new Error("Mirror partial chunk is oversized");
            controller.enqueue(next.value);
            return;
          }
        } catch (error) {
          await reader?.cancel().catch(() => undefined);
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader?.cancel(reason);
      },
    });
  }

  async discardPartial(asset: Readonly<ManifestAsset>): Promise<void> {
    const cache = await this.cache();
    const root = this.assetRoot(asset);
    for (const request of await cache.keys()) {
      if (request.url === `${root}partial` || request.url.startsWith(`${root}chunks/`)) {
        await cache.delete(request);
      }
    }
  }

  async commit(asset: Readonly<ManifestAsset>): Promise<void> {
    if ((await this.partialBytes(asset)) !== asset.bytes)
      throw new Error("Cannot commit an incomplete mirror asset");
    const cache = await this.cache();
    await cache.put(
      `${this.assetRoot(asset)}committed`,
      new Response(await this.readPartial(asset), {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(asset.bytes),
          "x-mirror-sha256": asset.sha256.toLowerCase(),
        },
      }),
    );
    // The committed response itself is the durable catalogue row. Cleanup is separate,
    // so a cleanup error cannot turn a successfully published file into a failed download.
  }

  private async committed(asset: Readonly<ManifestAsset>): Promise<Response | undefined> {
    const response = await (await this.cache()).match(`${this.assetRoot(asset)}committed`);
    if (!response) return undefined;
    if (
      response.headers.get("content-length") !== String(asset.bytes) ||
      response.headers.get("x-mirror-sha256") !== asset.sha256.toLowerCase()
    )
      throw new Error("Invalid committed mirror metadata");
    return response;
  }

  async isPresent(asset: Readonly<ManifestAsset>): Promise<boolean> {
    const response = await this.committed(asset);
    await response?.body?.cancel();
    return response !== undefined;
  }

  async read(asset: Readonly<ManifestAsset>): Promise<ReadableStream<Uint8Array> | null> {
    return (await this.committed(asset))?.body ?? null;
  }

  async remove(asset: Readonly<ManifestAsset>): Promise<void> {
    const cache = await this.cache();
    const root = this.idRoot(asset);
    for (const request of await cache.keys()) {
      if (request.url.startsWith(root)) await cache.delete(request);
    }
  }
}
