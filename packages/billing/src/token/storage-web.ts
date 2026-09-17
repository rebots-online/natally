import type { AppUserId, LicenseToken, SignedDenyList } from "../types.js";
import { parseJson, parseSignedDenyList, TokenError } from "./format.js";
import { type DenyListCache, verifyLicenseToken, verifySignedDenyList } from "./verify-web.js";

export interface WrappedValue {
  version: 1;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

export async function wrapValue(
  value: string,
  key: CryptoKey,
  context: string,
  crypto: Crypto = globalThis.crypto,
): Promise<WrappedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context), tagLength: 128 },
    key,
    new TextEncoder().encode(value),
  );
  return { version: 1, iv, ciphertext };
}

export async function unwrapValue(
  value: WrappedValue,
  key: CryptoKey,
  context: string,
  crypto: Crypto = globalThis.crypto,
): Promise<string> {
  if (
    value?.version !== 1 ||
    !(value.iv instanceof Uint8Array) ||
    value.iv.length !== 12 ||
    !(value.ciphertext instanceof ArrayBuffer) ||
    value.ciphertext.byteLength < 16
  ) {
    throw new TokenError("invalid-storage-envelope");
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: value.iv,
        additionalData: new TextEncoder().encode(context),
        tagLength: 128,
      },
      key,
      value.ciphertext,
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    throw new TokenError("storage-authentication-failed");
  }
}

export interface WebTokenStorageOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
  crypto?: Crypto;
  publicKey?: string;
  now?: () => number;
}

/** The persisted key is a nonextractable CryptoKey, never exported key bytes.
 * IndexedDB must support CryptoKey structured cloning. Failure stays explicit;
 * no localStorage, plaintext, or memory-only success fallback exists.
 * Same-origin script can use this key: this protects storage, not an XSS boundary.
 */
export class WebTokenStorage implements DenyListCache {
  private database: Promise<IDBDatabase> | undefined;
  private readonly crypto: Crypto;
  constructor(private readonly options: WebTokenStorageOptions = {}) {
    this.crypto = options.crypto ?? globalThis.crypto;
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = this.options.indexedDB ?? globalThis.indexedDB;
      if (!factory || !this.crypto?.subtle) {
        reject(new TokenError("encrypted-storage-unavailable"));
        return;
      }
      const request = factory.open(this.options.databaseName ?? "natally-license-v1", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("keys");
        request.result.createObjectStore("values");
      };
      request.onerror = () => reject(new TokenError("storage-open-failed"));
      request.onblocked = () => reject(new TokenError("storage-open-blocked"));
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          this.database = undefined;
        };
        resolve(request.result);
      };
    }).catch((error: unknown) => {
      this.database = undefined;
      throw error;
    });
    return this.database;
  }

  private async key(create: boolean): Promise<CryptoKey> {
    const db = await this.open();
    // Generate outside the transaction; WebCrypto awaits otherwise make IDB idle.
    const candidate = create
      ? await this.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
          "encrypt",
          "decrypt",
        ])
      : undefined;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["keys", "values"], create ? "readwrite" : "readonly");
      const store = tx.objectStore("keys");
      const request = store.get("wrapping-key");
      let key: CryptoKey | undefined;
      let failure = "storage-key-write-failed";
      request.onsuccess = () => {
        key = request.result as CryptoKey | undefined;
        if (!key && candidate) {
          const count = tx.objectStore("values").count();
          count.onsuccess = () => {
            if (count.result !== 0) {
              // A lost key must not silently re-key a database with existing ciphertext.
              failure = "storage-key-unavailable";
              tx.abort();
              return;
            }
            key = candidate;
            // Read/create is serialized across tabs. Never overwrite another tab's key.
            try {
              store.add(key, "wrapping-key");
            } catch {
              tx.abort();
            }
          };
        }
      };
      tx.oncomplete = () => {
        if (
          key?.type !== "secret" ||
          key.extractable ||
          key.algorithm.name !== "AES-GCM" ||
          (key.algorithm as AesKeyAlgorithm).length !== 256 ||
          !key.usages.includes("encrypt") ||
          !key.usages.includes("decrypt")
        ) {
          reject(new TokenError("storage-key-unavailable"));
        } else resolve(key);
      };
      tx.onabort = () => reject(new TokenError(failure));
      tx.onerror = () => {
        /* onabort is the terminal transaction result. */
      };
    });
  }

  private async read(context: string): Promise<string | null> {
    const db = await this.open();
    const value = await new Promise<WrappedValue | undefined>((resolve, reject) => {
      const tx = db.transaction("values", "readonly");
      const request = tx.objectStore("values").get(context);
      tx.oncomplete = () => resolve(request.result as WrappedValue | undefined);
      tx.onabort = () => reject(new TokenError("storage-read-failed"));
    });
    if (value === undefined) return null;
    return unwrapValue(value, await this.key(false), context, this.crypto);
  }

  private async write(context: string, value: string | null): Promise<void> {
    const wrapped =
      value === null ? null : await wrapValue(value, await this.key(true), context, this.crypto);
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("values", "readwrite");
      const store = tx.objectStore("values");
      if (wrapped === null) store.delete(context);
      else store.put(wrapped, context);
      // Request success alone is not durability; wait for transaction completion.
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new TokenError("storage-write-failed"));
    });
  }

  private verificationOptions() {
    return {
      crypto: this.crypto,
      online: false,
      ...(this.options.publicKey === undefined ? {} : { publicKey: this.options.publicKey }),
      ...(this.options.now === undefined ? {} : { now: this.options.now() }),
    };
  }

  async store(token: LicenseToken, appUserId: AppUserId): Promise<void> {
    const verified = await verifyLicenseToken(token, appUserId, this.verificationOptions());
    if (!verified.valid) throw new TokenError(verified.reason);
    await this.write(`natally-license:v1:token:${appUserId}`, token);
  }

  /** Re-verifies signature/subject/expiry. Online callers then use DenyListManager.verify. */
  async load(appUserId: AppUserId): Promise<LicenseToken | null> {
    const token = await this.read(`natally-license:v1:token:${appUserId}`);
    if (token === null) return null;
    const verified = await verifyLicenseToken(token, appUserId, this.verificationOptions());
    if (!verified.valid) throw new TokenError(verified.reason);
    return token;
  }

  clear(appUserId: AppUserId): Promise<void> {
    return this.write(`natally-license:v1:token:${appUserId}`, null);
  }

  async readDenyList(): Promise<SignedDenyList | null> {
    const value = await this.read("natally-license:v1:deny-list");
    return value === null ? null : parseSignedDenyList(parseJson(value));
  }

  async writeDenyList(value: SignedDenyList): Promise<void> {
    const parsed = parseSignedDenyList(value);
    await verifySignedDenyList(parsed, this.options.publicKey, this.options.now?.(), this.crypto);
    await this.write("natally-license:v1:deny-list", JSON.stringify(parsed));
  }

  async close(): Promise<void> {
    if (this.database) (await this.database).close();
    this.database = undefined;
  }
}
