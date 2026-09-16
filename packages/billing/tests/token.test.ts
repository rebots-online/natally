// natally — B.3 license token tests (TEST_RUBRIC TR-3 token matrix).
//
// Real WebCrypto Ed25519 (node 24 + browsers — no external crypto dep, no
// mocks in shipped code; the ONLY stub here is the in-memory structural
// IndexedDB, which is test-scope by contract: tests may stub, src never
// does). Scenarios: valid/exp-null passes; tampered payload and tampered
// signature reject with `sig`; wrong `iss`/`sub`, expired, revoked-jti each
// reject with their distinct reason; deny-list present but jti unlisted
// passes; malformed inputs reject; verify runs with the network removed;
// storage save/load/overwrite/clear roundtrips on the stub.

import { describe, expect, it } from "vitest";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  canonicalJson,
  encodeToken,
  type SignFn,
  utf8Bytes,
} from "../src/token/format";
import {
  clearLicenseToken,
  type IdbDatabaseLike,
  type IdbFactoryLike,
  type IdbObjectStoreLike,
  type IdbOpenRequestLike,
  type IdbRequestLike,
  type IdbTransactionLike,
  type IdbUpgradeEvent,
  loadLicenseToken,
  saveLicenseToken,
} from "../src/token/storage-web";
import { TOKEN_ISSUER, verifyToken } from "../src/token/verify-web";
import type { DenyListPayload, LicensePayload, LicenseToken } from "../src/types";

// ---------------------------------------------------------------------------
// Fixtures: one test keypair, one payload, one injected clock
// ---------------------------------------------------------------------------

const APP_USER = "user-robin";
const BASE_IAT = 1_700_000_000;
const NOW = BASE_IAT + 60;
const PAYLOAD: LicensePayload = {
  sub: APP_USER,
  tier: "unlimited",
  iat: BASE_IAT,
  exp: null,
  iss: TOKEN_ISSUER,
  jti: "jti-0001",
};

interface TestKeypair {
  readonly privateKey: CryptoKey;
  readonly publicKeyRaw: Uint8Array;
}

async function generateTestKeypair(): Promise<TestKeypair> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKeyRaw };
}

function signer(privateKey: CryptoKey): SignFn {
  return async (signingInput) =>
    new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, signingInput));
}

async function mint(payload: LicensePayload, keypair: TestKeypair): Promise<LicenseToken> {
  return encodeToken(payload, signer(keypair.privateKey));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function tokenSegments(token: string): [string, string, string] {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("test helper: expected 3 segments");
  const header = parts[0];
  const payload = parts[1];
  const signature = parts[2];
  if (header === undefined || payload === undefined || signature === undefined) {
    throw new Error("test helper: missing segment");
  }
  return [header, payload, signature];
}

function payloadSegmentOf(payload: LicensePayload): string {
  return bytesToBase64Url(utf8Bytes(canonicalJson(payload)));
}

interface VerifyOverrides {
  readonly now?: number;
  readonly denyList?: DenyListPayload;
  readonly appUserId?: string;
}

function verifyWith(
  token: string,
  keypair: TestKeypair,
  overrides: VerifyOverrides = {},
): ReturnType<typeof verifyToken> {
  return verifyToken(token, {
    publicKey: keypair.publicKeyRaw,
    appUserId: overrides.appUserId ?? APP_USER,
    now: overrides.now ?? NOW,
    denyList: overrides.denyList,
  });
}

// ---------------------------------------------------------------------------
// In-memory structural IndexedDB stub — TESTS ONLY (src may not stub)
// ---------------------------------------------------------------------------

class MemoryRequest<T> implements IdbRequestLike<T> {
  result: T;
  error: DOMException | null = null;
  onsuccess: (event: unknown) => void = () => {};
  onerror: (event: unknown) => void = () => {};

  constructor(result: T) {
    this.result = result;
  }

  settle(): void {
    this.onsuccess({});
  }
}

class MemoryOpenRequest implements IdbOpenRequestLike {
  result: IdbDatabaseLike;
  error: DOMException | null = null;
  onsuccess: (event: unknown) => void = () => {};
  onerror: (event: unknown) => void = () => {};
  onupgradeneeded: (event: IdbUpgradeEvent) => void = () => {};

  constructor(result: IdbDatabaseLike) {
    this.result = result;
  }
}

class MemoryTransaction implements IdbTransactionLike {
  error: DOMException | null = null;
  oncomplete: (event: unknown) => void = () => {};
  onerror: (event: unknown) => void = () => {};
  onabort: (event: unknown) => void = () => {};
  private pending = 0;

  constructor(private readonly stores: Map<string, Map<string, unknown>>) {}

  objectStore(name: string): IdbObjectStoreLike {
    const map = this.stores.get(name);
    if (map === undefined) throw new Error(`memory idb: no object store "${name}"`);
    return new MemoryObjectStore(this, map);
  }

  track(): void {
    this.pending += 1;
  }

  settled(): void {
    this.pending -= 1;
    if (this.pending <= 0) queueMicrotask(() => this.oncomplete({}));
  }
}

class MemoryObjectStore implements IdbObjectStoreLike {
  constructor(
    private readonly tx: MemoryTransaction,
    private readonly map: Map<string, unknown>,
  ) {}

  get(key: string): IdbRequestLike<unknown> {
    return this.emit(key);
  }

  put(value: unknown, key: string): IdbRequestLike<unknown> {
    this.map.set(key, value);
    return this.emit(key);
  }

  delete(key: string): IdbRequestLike<unknown> {
    this.map.delete(key);
    return this.emit(key);
  }

  private emit(key: string): IdbRequestLike<unknown> {
    const request = new MemoryRequest<unknown>(this.map.get(key));
    this.tx.track();
    queueMicrotask(() => {
      request.settle();
      this.tx.settled();
    });
    return request;
  }
}

class MemoryDb implements IdbDatabaseLike {
  private readonly stores = new Map<string, Map<string, unknown>>();
  readonly objectStoreNames = { contains: (name: string): boolean => this.stores.has(name) };

  createObjectStore(name: string): void {
    this.stores.set(name, new Map());
  }

  transaction(storeNames: string, mode: "readonly" | "readwrite"): IdbTransactionLike {
    void storeNames;
    void mode;
    return new MemoryTransaction(this.stores);
  }

  close(): void {}
}

function createMemoryIdb(): IdbFactoryLike {
  const databases = new Map<string, MemoryDb>();
  return {
    open(name: string): IdbOpenRequestLike {
      const existing = databases.get(name);
      const db = existing ?? new MemoryDb();
      const request = new MemoryOpenRequest(db);
      queueMicrotask(() => {
        if (existing === undefined) {
          databases.set(name, db);
          request.onupgradeneeded({ target: request });
        }
        request.onsuccess({});
      });
      return request;
    },
  };
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe("token: valid passes, tampered/expired/revoked rejected", () => {
  it("valid token passes with the exact payload roundtripped", async () => {
    const keypair = await generateTestKeypair();
    const token = await mint(PAYLOAD, keypair);
    const result = await verifyWith(token, keypair);
    expect(result).toEqual({ ok: true, payload: PAYLOAD });
  });

  it("exp null is valid; minting is deterministic (canonical JSON)", async () => {
    const keypair = await generateTestKeypair();
    const first = await encodeToken(PAYLOAD, signer(keypair.privateKey));
    const second = await encodeToken(PAYLOAD, signer(keypair.privateKey));
    expect(second).toBe(first);
    expect(await verifyWith(first, keypair)).toEqual({ ok: true, payload: PAYLOAD });
  });

  it("base64 pubkey string from VITE_LICENSE_PUBKEY verifies like raw bytes", async () => {
    const keypair = await generateTestKeypair();
    const token = await mint(PAYLOAD, keypair);
    const result = await verifyToken(token, {
      publicKey: toBase64(keypair.publicKeyRaw),
      appUserId: APP_USER,
      now: NOW,
    });
    expect(result).toEqual({ ok: true, payload: PAYLOAD });
  });

  it("tampered payload rejects with sig (swapped payload under the original signature)", async () => {
    const keypair = await generateTestKeypair();
    const token = await mint(PAYLOAD, keypair);
    const [header, , signature] = tokenSegments(token);
    const forged = `${header}.${payloadSegmentOf({ ...PAYLOAD, jti: "jti-9999" })}.${signature}`;
    expect(await verifyWith(forged, keypair)).toEqual({ ok: false, reason: "sig" });
  });

  it("tampered signature byte rejects with sig", async () => {
    const keypair = await generateTestKeypair();
    const token = await mint(PAYLOAD, keypair);
    const [header, payload, signature] = tokenSegments(token);
    const sigBytes = base64UrlToBytes(signature);
    sigBytes[0] = (sigBytes[0] ?? 0) === 0 ? 1 : 0;
    const forged = `${header}.${payload}.${bytesToBase64Url(sigBytes)}`;
    expect(await verifyWith(forged, keypair)).toEqual({ ok: false, reason: "sig" });
  });

  it("wrong iss rejects with iss", async () => {
    const keypair = await generateTestKeypair();
    const rogue = { ...PAYLOAD, iss: "someone-else" } as unknown as LicensePayload;
    const token = await mint(rogue, keypair);
    expect(await verifyWith(token, keypair)).toEqual({ ok: false, reason: "iss" });
  });

  it("wrong sub rejects with sub (another user's token on this install)", async () => {
    const keypair = await generateTestKeypair();
    const token = await mint({ ...PAYLOAD, sub: "user-someone-else" }, keypair);
    expect(await verifyWith(token, keypair)).toEqual({ ok: false, reason: "sub" });
  });

  it("expired (exp in the past) rejects with expired; exp one second in the future passes", async () => {
    const keypair = await generateTestKeypair();
    const expired = { ...PAYLOAD, exp: NOW - 1 } as unknown as LicensePayload;
    expect(await verifyWith(await mint(expired, keypair), keypair)).toEqual({
      ok: false,
      reason: "expired",
    });
    const stillValid = { ...PAYLOAD, exp: NOW + 1 } as unknown as LicensePayload;
    expect(await verifyWith(await mint(stillValid, keypair), keypair)).toEqual({
      ok: true,
      payload: stillValid,
    });
  });

  it("revoked jti rejects with revoked when listed; unlisted jti passes with the deny-list present", async () => {
    const keypair = await generateTestKeypair();
    const denyList: DenyListPayload = {
      issuedAt: (BASE_IAT + 30) * 1000,
      revokedJti: ["jti-0001"],
    };
    const revoked = await mint(PAYLOAD, keypair);
    expect(await verifyWith(revoked, keypair, { denyList })).toEqual({
      ok: false,
      reason: "revoked",
    });
    const survivor = await mint({ ...PAYLOAD, jti: "jti-0002" }, keypair);
    expect(await verifyWith(survivor, keypair, { denyList })).toEqual({
      ok: true,
      payload: { ...PAYLOAD, jti: "jti-0002" },
    });
    // No deny-list at all (offline, never refreshed): the same revoked token passes.
    expect(await verifyWith(revoked, keypair)).toEqual({ ok: true, payload: PAYLOAD });
  });

  it("malformed inputs (garbage, two segments, non-base64url, wrong header) reject with malformed", async () => {
    const keypair = await generateTestKeypair();
    for (const broken of ["garbage", "a.b", "!!!.***.###", "YQ.b.c"]) {
      expect(await verifyWith(broken, keypair)).toEqual({ ok: false, reason: "malformed" });
    }
    const wellFormed = await mint(PAYLOAD, keypair);
    const [, payload, signature] = tokenSegments(wellFormed);
    const foreignHeader = bytesToBase64Url(
      utf8Bytes(canonicalJson({ alg: "HS256", typ: "JWT+COSE-ish v1" })),
    );
    expect(await verifyWith(`${foreignHeader}.${payload}.${signature}`, keypair)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("offline verify never requires network (fetch removed)", async () => {
    const keypair = await generateTestKeypair();
    const token = await mint(PAYLOAD, keypair);
    const backup = globalThis.fetch;
    (globalThis as { fetch?: unknown }).fetch = undefined;
    try {
      const result = await verifyToken(token, {
        publicKey: keypair.publicKeyRaw,
        appUserId: APP_USER,
        now: NOW,
      });
      expect(result).toEqual({ ok: true, payload: PAYLOAD });
    } finally {
      (globalThis as { fetch?: unknown }).fetch = backup;
    }
  });

  it("canonical JSON sorts keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: [true, null], c: 2 } })).toBe(
      '{"a":{"c":2,"d":[true,null]},"b":1}',
    );
  });

  it("storage: save/load/overwrite/clear roundtrip on the in-memory IndexedDB", async () => {
    const keypair = await generateTestKeypair();
    const first = await mint(PAYLOAD, keypair);
    const second = await mint({ ...PAYLOAD, jti: "jti-0002" }, keypair);
    const idb = createMemoryIdb();

    await expect(loadLicenseToken(idb)).resolves.toBeNull();
    await saveLicenseToken(first, idb);
    await expect(loadLicenseToken(idb)).resolves.toBe(first);
    await saveLicenseToken(second, idb);
    await expect(loadLicenseToken(idb)).resolves.toBe(second);
    await clearLicenseToken(idb);
    await expect(loadLicenseToken(idb)).resolves.toBeNull();
    // Clear is idempotent; a fresh save after clear generates a new wrap key and still roundtrips.
    await clearLicenseToken(idb);
    await saveLicenseToken(first, idb);
    await expect(loadLicenseToken(idb)).resolves.toBe(first);
  });
});
