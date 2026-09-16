// natally — web-leg license token storage (ARCHITECTURE §9.3, TR-3/B.3).
//
// IndexedDB holding two records in the `natally-billing` database:
//   - `aes-wrap-key`: a per-install, NON-extractable AES-GCM-256 CryptoKey
//     (structured-clone persists non-extractable keys in IDB; they simply
//     cannot be exported, so the wrapping key never leaves the browser);
//   - `license-token`: the envelope `{ iv, ciphertext }` — the LicenseToken
//     exists on disk only encrypted under that key.
//
// `save`/`load`/`clear` are the whole surface. Decryption failure is honest
// absence (`null`), never a fabricated token; verification of the loaded
// token remains verify-web.ts's job. Native legs use the OS keychain seam
// instead (native.rs design, C-phase wiring) — this module throws when no
// IndexedDB exists rather than silently degrading.
//
// The IndexedDB surface below is a minimal STRUCTURAL subset (no dependency;
// tests provide an in-memory stub — tests may stub, src never does). The one
// cast from the real `indexedDB` is documented at `defaultIdb`.

import type { LicenseToken } from "../types";
import { utf8Bytes } from "./format";

// ---------------------------------------------------------------------------
// Structural IndexedDB subset (no dependency; the real `indexedDB` crosses one
// documented cast at `defaultIdb` below).
// ---------------------------------------------------------------------------

export interface IdbRequestLike<T> {
  readonly result: T;
  readonly error: DOMException | null;
  onsuccess(event: unknown): void;
  onerror(event: unknown): void;
}

export interface IdbUpgradeEvent {
  readonly target: IdbOpenRequestLike;
}

export interface IdbOpenRequestLike extends IdbRequestLike<IdbDatabaseLike> {
  onupgradeneeded(event: IdbUpgradeEvent): void;
}

export interface IdbObjectStoreNamesLike {
  readonly contains: (name: string) => boolean;
}

export interface IdbDatabaseLike {
  readonly objectStoreNames: IdbObjectStoreNamesLike;
  createObjectStore(name: string): void;
  transaction(storeNames: string, mode: "readonly" | "readwrite"): IdbTransactionLike;
  close(): void;
}

export interface IdbTransactionLike {
  readonly error: DOMException | null;
  objectStore(name: string): IdbObjectStoreLike;
  oncomplete(event: unknown): void;
  onerror(event: unknown): void;
  onabort(event: unknown): void;
}

export interface IdbObjectStoreLike {
  get(key: string): IdbRequestLike<unknown>;
  put(value: unknown, key: string): IdbRequestLike<unknown>;
  delete(key: string): IdbRequestLike<unknown>;
}

export interface IdbFactoryLike {
  open(name: string, version?: number): IdbOpenRequestLike;
}

// ---------------------------------------------------------------------------
// Storage constants + envelope
// ---------------------------------------------------------------------------

const DB_NAME = "natally-billing";
const DB_VERSION = 1;
const STORE = "license";
const KEY_RECORD = "aes-wrap-key";
const TOKEN_RECORD = "license-token";
const AES_ALGO = "AES-GCM";
const IV_BYTES = 12;

/** The only on-disk form of the token: GCM ciphertext plus its fresh IV. */
interface WrapEnvelope {
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly ciphertext: Uint8Array<ArrayBuffer>;
}

function defaultIdb(): IdbFactoryLike {
  const candidate = (globalThis as { indexedDB?: unknown }).indexedDB;
  if (candidate === undefined || candidate === null) {
    throw new Error(
      "natally.billing: IndexedDB unavailable — the web leg requires it (§9.3); native legs use the OS keychain seam",
    );
  }
  // Single documented boundary cast: the real IDBFactory fulfils the
  // structural subset above at runtime; DOM lib handler signatures are only
  // nominally wider than what this module needs.
  return candidate as IdbFactoryLike;
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------------

function storageError(what: string, cause: DOMException | null): Error {
  return new Error(
    `natally.billing: IndexedDB ${what} failed${cause === null ? "" : ` (${cause.name})`}`,
  );
}

function requestToPromise<T>(request: IdbRequestLike<T>, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(what, request.error));
  });
}

function transactionDone(tx: IdbTransactionLike, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(storageError(what, tx.error));
    tx.onabort = () => reject(storageError(what, tx.error));
  });
}

function openDatabase(idb: IdbFactoryLike): Promise<IdbDatabaseLike> {
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event as IdbUpgradeEvent).target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError("open", request.error));
  });
}

// ---------------------------------------------------------------------------
// Wrap key (per install, non-extractable)
// ---------------------------------------------------------------------------

/**
 * Load the per-install AES-GCM wrap key, generating and persisting it on
 * first use. Generation happens strictly BETWEEN transactions (an awaited
 * crypto call inside a live IDB transaction would let it auto-commit), so
 * key material is never minted mid-transaction.
 */
async function loadOrCreateWrapKey(db: IdbDatabaseLike): Promise<CryptoKey> {
  const readTx = db.transaction(STORE, "readonly");
  const existing = await requestToPromise(
    readTx.objectStore(STORE).get(KEY_RECORD),
    "wrap-key read",
  );
  if (existing instanceof CryptoKey) return existing;
  const key = (await crypto.subtle.generateKey({ name: AES_ALGO, length: 256 }, false, [
    "encrypt",
    "decrypt",
  ])) as CryptoKey;
  const writeTx = db.transaction(STORE, "readwrite");
  writeTx.objectStore(STORE).put(key, KEY_RECORD);
  await transactionDone(writeTx, "wrap-key write");
  return key;
}

// ---------------------------------------------------------------------------
// Public surface: save / load / clear
// ---------------------------------------------------------------------------

/** Encrypt `token` under the per-install key and persist the envelope. */
export async function saveLicenseToken(
  token: LicenseToken,
  idb: IdbFactoryLike = defaultIdb(),
): Promise<void> {
  const db = await openDatabase(idb);
  try {
    const key = await loadOrCreateWrapKey(db);
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const plaintext = utf8Bytes(token);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: AES_ALGO, iv }, key, plaintext),
    );
    const writeTx = db.transaction(STORE, "readwrite");
    const envelope: WrapEnvelope = { iv, ciphertext };
    writeTx.objectStore(STORE).put(envelope, TOKEN_RECORD);
    await transactionDone(writeTx, "token write");
  } finally {
    db.close();
  }
}

/**
 * Load and decrypt the stored token. Returns `null` when nothing is stored
 * or the envelope cannot be decrypted (lost/rotated wrap key) — honest
 * absence; the caller treats it exactly like "unlicensed, verify nothing".
 */
export async function loadLicenseToken(
  idb: IdbFactoryLike = defaultIdb(),
): Promise<LicenseToken | null> {
  const db = await openDatabase(idb);
  try {
    const readTx = db.transaction(STORE, "readonly");
    const store = readTx.objectStore(STORE);
    const [keyValue, envelope] = await Promise.all([
      requestToPromise(store.get(KEY_RECORD), "wrap-key read"),
      requestToPromise(store.get(TOKEN_RECORD), "token read"),
    ]);
    if (!(keyValue instanceof CryptoKey)) return null;
    if (typeof envelope !== "object" || envelope === null) return null;
    const wrap = envelope as Partial<WrapEnvelope>;
    if (!(wrap.iv instanceof Uint8Array) || !(wrap.ciphertext instanceof Uint8Array)) return null;
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: AES_ALGO, iv: wrap.iv },
        keyValue,
        wrap.ciphertext,
      );
      return new TextDecoder().decode(plaintext) as LicenseToken;
    } catch {
      return null;
    }
  } finally {
    db.close();
  }
}

/** Remove the stored token AND the wrap key (a fresh install state, §9.3). */
export async function clearLicenseToken(idb: IdbFactoryLike = defaultIdb()): Promise<void> {
  const db = await openDatabase(idb);
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.delete(TOKEN_RECORD);
    store.delete(KEY_RECORD);
    await transactionDone(tx, "clear");
  } finally {
    db.close();
  }
}
