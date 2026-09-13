import type { DownloadProgress, DownloadResult, MirrorDownloader } from "./download.js";
import { type ManifestAsset, type ModelManifest, parseManifest } from "./manifest.js";

export interface CatalogueRow {
  readonly asset: Readonly<ManifestAsset>;
  readonly state: "partial" | "downloading" | "verifying" | "present" | "error";
  readonly bytes: number;
  readonly totalBytes: number;
  readonly percent: number;
  readonly error?: string;
}

/** Manifest stays separate from installed/partial rows; remove deletes files and its row. */
export class CatalogueStore {
  readonly manifest: Readonly<ModelManifest>;
  private readonly assets: ReadonlyMap<string, Readonly<ManifestAsset>>;
  private readonly rows = new Map<string, Readonly<CatalogueRow>>();
  private readonly listeners = new Set<() => void>();
  private readonly active = new Map<
    string,
    { controller: AbortController; promise: Promise<DownloadResult> }
  >();
  private snapshot: readonly Readonly<CatalogueRow>[] = Object.freeze([]);

  constructor(
    manifest: Readonly<ModelManifest>,
    private readonly downloader: MirrorDownloader,
  ) {
    this.manifest = parseManifest(manifest, downloader.network);
    this.assets = new Map(this.manifest.assets.map((asset) => [asset.id, asset]));
  }

  getSnapshot = (): readonly Readonly<CatalogueRow>[] => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Only explicit true is eligible. Billing still owns authorization/entitlement decisions. */
  trialEligible(id: string): boolean {
    return this.asset(id).trialEligible === true;
  }

  private asset(id: string): Readonly<ManifestAsset> {
    const asset = this.assets.get(id);
    if (!asset) throw new Error(`Unknown manifest asset ID: ${id}`);
    return asset;
  }

  private publish(): void {
    this.snapshot = Object.freeze(Array.from(this.rows.values()));
    for (const listener of this.listeners) listener();
  }

  private set(
    asset: Readonly<ManifestAsset>,
    state: CatalogueRow["state"],
    bytes: number,
    error?: string,
  ): void {
    this.rows.set(
      asset.id,
      Object.freeze({
        asset,
        state,
        bytes,
        totalBytes: asset.bytes,
        percent: asset.bytes === 0 ? (state === "present" ? 100 : 0) : (bytes / asset.bytes) * 100,
        ...(error === undefined ? {} : { error }),
      }),
    );
    this.publish();
  }

  /** Rebuild from durable platform-cache metadata after app reload; absent files get no row. */
  async refresh(): Promise<void> {
    for (const asset of this.assets.values()) {
      if (this.active.has(asset.id)) continue;
      await this.downloader.storage.withLock(asset, async () => {
        if (this.active.has(asset.id)) return;
        if (await this.downloader.storage.isPresent(asset)) {
          this.set(asset, "present", asset.bytes);
        } else {
          const bytes = await this.downloader.storage.partialBytes(asset);
          if (bytes > 0) this.set(asset, "partial", bytes);
          else {
            this.rows.delete(asset.id);
            this.publish();
          }
        }
      });
    }
  }

  download(id: string): Promise<DownloadResult> {
    const existing = this.active.get(id);
    if (existing) return existing.promise;
    const asset = this.asset(id);
    const controller = new AbortController();
    const onProgress = (progress: Readonly<DownloadProgress>) =>
      this.set(asset, progress.state, progress.bytes);
    const promise = this.downloader
      .download(asset, { signal: controller.signal, onProgress })
      .catch(async (error: unknown) => {
        // Integrity rejection may have discarded every chunk: display persisted bytes,
        // not the pre-verification progress counter for the now-rejected download.
        let bytes = this.rows.get(id)?.bytes ?? 0;
        let message = error instanceof Error ? error.message : String(error);
        try {
          bytes = await this.downloader.storage.partialBytes(asset);
        } catch {
          message += "; persisted byte count is unavailable";
        }
        this.set(asset, "error", bytes, message);
        throw error;
      })
      .finally(() => {
        this.active.delete(id);
      });
    this.active.set(id, { controller, promise });
    return promise;
  }

  /** Interrupt and preserve durable partial bytes, so a later download can resume. */
  cancel(id: string): void {
    this.active.get(id)?.controller.abort();
  }

  async remove(id: string): Promise<void> {
    const asset = this.asset(id);
    const active = this.active.get(id);
    if (active) {
      active.controller.abort();
      await active.promise.catch(() => undefined);
    }
    await this.downloader.storage.withLock(asset, async () => {
      await this.downloader.storage.remove(asset);
      this.rows.delete(id);
      this.publish();
    });
  }
}
