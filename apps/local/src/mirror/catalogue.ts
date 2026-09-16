// natally — M.1: the model catalogue store (ARCHITECTURE §7.1, §13). Rows in
// an injected KV (I.3 wires SQLite on native / IndexedDB on web; tests inject
// their own KV). States per §13: `present` (verified blob committed) and
// `downloading` (bytesDone/bytesTotal progress). `remove` deletes both the
// stored files and the row. `trialEligible` on the embedded manifest asset is
// a pass-through: the catalogue never mutates it — B.1/U.5 read it verbatim.

import type { ManifestAsset } from "@natally/billing";
import { type AssetStorage, PART_SUFFIX } from "./download";

export type CatalogueState = "present" | "downloading";

export interface CatalogueRow {
  readonly asset: ManifestAsset;
  state: CatalogueState;
  bytesDone: number;
  bytesTotal: number;
  error?: string;
}

/** Minimal async KV (namespaced by the provider; rows are keyed by asset id). */
export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
}

export type CatalogueListener = (rows: readonly CatalogueRow[]) => void;

/** Defensive re-parse of our own serialized rows; torn/malformed rows are skipped. */
function parseRow(raw: string): CatalogueRow | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const asset = record.asset;
    if (typeof asset !== "object" || asset === null) {
      return null;
    }
    const assetRecord = asset as Record<string, unknown>;
    if (typeof assetRecord.id !== "string" || typeof assetRecord.file !== "string") {
      return null;
    }
    if (record.state !== "present" && record.state !== "downloading") {
      return null;
    }
    return value as CatalogueRow;
  } catch {
    return null;
  }
}

export class Catalogue {
  readonly #kv: KvStore;
  readonly #storage: AssetStorage | null;
  readonly #listeners = new Set<CatalogueListener>();

  /**
   * @param kv row store (keyed by asset id)
   * @param storage when given, {@link remove} also deletes the committed
   * file and its `.part` sibling ("remove = files + rows", §13).
   */
  constructor(kv: KvStore, storage: AssetStorage | null = null) {
    this.#kv = kv;
    this.#storage = storage;
  }

  /** Subscribes to row-set snapshots; returns the unsubscribe function. */
  subscribe(listener: CatalogueListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async #emit(): Promise<void> {
    const rows = await this.list();
    for (const listener of [...this.#listeners]) {
      listener(rows);
    }
  }

  /** All rows, ordered by asset id. */
  async list(): Promise<CatalogueRow[]> {
    const keys = await this.#kv.keys();
    const rows: CatalogueRow[] = [];
    for (const key of keys) {
      const raw = await this.#kv.get(key);
      if (raw === null) {
        continue;
      }
      const row = parseRow(raw);
      if (row !== null) {
        rows.push(row);
      }
    }
    rows.sort((a, b) => (a.asset.id < b.asset.id ? -1 : a.asset.id > b.asset.id ? 1 : 0));
    return rows;
  }

  async get(assetId: string): Promise<CatalogueRow | null> {
    const raw = await this.#kv.get(assetId);
    return raw === null ? null : parseRow(raw);
  }

  /** Enters (or re-enters) the `downloading` state for an asset. */
  async markDownloading(asset: ManifestAsset, bytesDone = 0): Promise<void> {
    const row: CatalogueRow = {
      asset,
      state: "downloading",
      bytesDone,
      bytesTotal: asset.bytes,
    };
    await this.#kv.set(asset.id, JSON.stringify(row));
    await this.#emit();
  }

  /** Records progress; no-op when the row is gone (e.g. removed mid-download). */
  async progress(assetId: string, bytesDone: number): Promise<void> {
    const row = await this.get(assetId);
    if (row === null || row.state !== "downloading") {
      return;
    }
    row.bytesDone = bytesDone;
    delete row.error;
    await this.#kv.set(assetId, JSON.stringify(row));
    await this.#emit();
  }

  /** Marks a verified, committed asset present; clears any error. */
  async markPresent(assetId: string): Promise<void> {
    const row = await this.get(assetId);
    if (row === null) {
      return;
    }
    row.state = "present";
    row.bytesDone = row.bytesTotal;
    delete row.error;
    await this.#kv.set(assetId, JSON.stringify(row));
    await this.#emit();
  }

  /** Records a failure against a downloading row (state stays `downloading`). */
  async markError(assetId: string, message: string): Promise<void> {
    const row = await this.get(assetId);
    if (row === null) {
      return;
    }
    row.error = message;
    await this.#kv.set(assetId, JSON.stringify(row));
    await this.#emit();
  }

  /**
   * Removes the row and, when a storage was injected, the committed file and
   * its `.part` sibling. Returns true when a row was removed.
   */
  async remove(assetId: string): Promise<boolean> {
    const row = await this.get(assetId);
    if (row === null) {
      return false;
    }
    if (this.#storage !== null) {
      await this.#storage.remove(row.asset.file);
      await this.#storage.remove(`${row.asset.file}${PART_SUFFIX}`);
    }
    await this.#kv.delete(assetId);
    await this.#emit();
    return true;
  }

  /**
   * Pass-through of the manifest's `trialEligible` flag, untouched by this
   * store (B.1/U.5 read it): true only for a catalogue row whose asset is
   * explicitly flagged.
   */
  async isTrialEligible(assetId: string): Promise<boolean> {
    const row = await this.get(assetId);
    return row?.asset.trialEligible === true;
  }
}
