import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DENY_LIST_MAX_AGE,
  decodeBase64Url,
  denyListSigningInput,
  encodeBase64Url,
  licenseSigningInput,
  parseLicenseToken,
  type VerifiableLicensePayload,
} from "../src/token/format.js";
import { unwrapValue, WebTokenStorage, wrapValue } from "../src/token/storage-web.js";
import {
  bakedLicensePublicKey,
  type DenyListCache,
  DenyListManager,
  decodeLicensePublicKey,
  importLicensePublicKey,
  verifyEd25519,
  verifyLicenseToken,
  verifySignedDenyList,
} from "../src/token/verify-web.js";
import type { DenyList, LicenseTokenPayload, SignedDenyList } from "../src/types.js";

const crypto = webcrypto as unknown as Crypto;
const utf8 = (value: string) => new TextEncoder().encode(value);
const hex = (value: string) =>
  Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
const NOW = 1_800_000_000;
const claims: LicenseTokenPayload = {
  sub: "app-user-alice",
  tier: "unlimited",
  iat: NOW - 100,
  exp: null,
  iss: "natally-license-bridge",
  jti: "purchase-1",
};
let pair: CryptoKeyPair;
let foreignPair: CryptoKeyPair;
let publicKey: string;
beforeAll(async () => {
  pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  foreignPair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  publicKey = encodeBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function sign(input: Uint8Array<ArrayBuffer>, key = pair.privateKey) {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.sign("Ed25519", key, input)));
}
async function mint(payload: VerifiableLicensePayload = claims, key = pair.privateKey) {
  const input = licenseSigningInput(payload);
  return `${input}.${await sign(utf8(input), key)}`;
}
async function mintRaw(payload: unknown, header: unknown = { alg: "EdDSA" }) {
  const input = `${encodeBase64Url(utf8(JSON.stringify(header)))}.${encodeBase64Url(utf8(JSON.stringify(payload)))}`;
  return `${input}.${await sign(utf8(input))}`;
}
async function deny(
  payload: DenyList = { issuedAt: NOW, revokedJti: [] },
  key = pair.privateKey,
): Promise<SignedDenyList> {
  return { payload, signature: await sign(denyListSigningInput(payload), key) };
}
const verify = (token: string, options: Parameters<typeof verifyLicenseToken>[2] = {}) =>
  verifyLicenseToken(token, claims.sub, { publicKey, crypto, now: NOW, online: false, ...options });

describe("RFC 8032 Ed25519 verification", () => {
  // RFC 8032 §7.1, tests 1–3; fixed published vectors independent of the mint helper.
  // Source: https://www.rfc-editor.org/rfc/rfc8032.txt
  const vectors = [
    {
      key: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
      message: "",
      signature:
        "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
        "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    },
    {
      key: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
      message: "72",
      signature:
        "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da" +
        "085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
    },
    {
      key: "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
      message: "af82",
      signature:
        "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac" +
        "18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
    },
  ];
  it.each(vectors)(
    "verifies published message $message and rejects changed bytes",
    async (vector) => {
      const signature = hex(vector.signature);
      const key = encodeBase64Url(hex(vector.key));
      expect(await verifyEd25519(key, hex(vector.message), signature, crypto)).toBe(true);
      signature[0] = (signature[0] ?? 0) ^ 1;
      expect(await verifyEd25519(key, hex(vector.message), signature, crypto)).toBe(false);
    },
  );

  it("validates actual points and rejects weak, noncanonical and malformed public keys", async () => {
    expect(decodeLicensePublicKey(publicKey)).toHaveLength(32);
    const invalid = [
      "",
      "operator-key-not-configured",
      encodeBase64Url(new Uint8Array(31)),
      encodeBase64Url(new Uint8Array(32)), // order-four point
      encodeBase64Url(Uint8Array.from([1, ...new Array<number>(31).fill(0)])), // identity
      encodeBase64Url(new Uint8Array(32).fill(255)), // noncanonical y
      encodeBase64Url(Uint8Array.from([2, ...new Array<number>(31).fill(0)])), // not on curve
    ];
    for (const key of invalid) await expect(importLicensePublicKey(key, crypto)).rejects.toThrow();
    const imported = await importLicensePublicKey(publicKey, crypto);
    expect(imported.extractable).toBe(false);
    expect(imported.algorithm.name).toBe("Ed25519");
  });

  it("uses the baked environment key and fails closed for blank configuration", async () => {
    vi.stubEnv("VITE_LICENSE_PUBKEY", "");
    expect(() => bakedLicensePublicKey()).toThrow("license-key-unconfigured");
    vi.stubEnv("VITE_LICENSE_PUBKEY", publicKey);
    expect(bakedLicensePublicKey()).toBe(publicKey);
    expect((await verifyLicenseToken(await mint(), claims.sub, { now: NOW, crypto })).valid).toBe(
      true,
    );
  });
});

describe("token: valid passes, tampered/expired/revoked rejected", () => {
  it("accepts the exact T0.7 permanent payload and a future expiry", async () => {
    expect(await verify(await mint())).toEqual({ valid: true, payload: claims });
    expect((await verify(await mint({ ...claims, exp: NOW + 1 }))).valid).toBe(true);
  });
  it("rejects a changed payload, a changed signature and a token minted by another key", async () => {
    const token = await mint();
    const parts = token.split(".");
    parts[1] = encodeBase64Url(utf8(JSON.stringify({ ...claims, jti: "forged" })));
    expect(await verify(parts.join("."))).toEqual({ valid: false, reason: "invalid-signature" });
    const parsed = parseLicenseToken(token);
    parsed.signature[0] = (parsed.signature[0] ?? 0) ^ 1;
    expect(
      (
        await verify(
          `${new TextDecoder().decode(parsed.message)}.${encodeBase64Url(parsed.signature)}`,
        )
      ).valid,
    ).toBe(false);
    expect(await verify(await mint(claims, foreignPair.privateKey))).toEqual({
      valid: false,
      reason: "invalid-signature",
    });
  });
  it.each([NOW - 1, NOW, claims.iat - 1])(
    "rejects expiry %s including the exact boundary",
    async (exp) => {
      expect(await verify(await mint({ ...claims, exp }))).toEqual({
        valid: false,
        reason: "expired-token",
      });
    },
  );
  it("checks subject, issuer, tier, future issuance and a valid clock", async () => {
    expect(await verify(await mint({ ...claims, sub: "bob" }))).toEqual({
      valid: false,
      reason: "wrong-subject",
    });
    expect(await verify(await mintRaw({ ...claims, iss: "attacker" }))).toEqual({
      valid: false,
      reason: "invalid-claims",
    });
    expect((await verify(await mintRaw({ ...claims, tier: "premium" }))).valid).toBe(false);
    expect(await verify(await mint({ ...claims, iat: NOW + 1 }))).toEqual({
      valid: false,
      reason: "future-token",
    });
    expect(await verify(await mint(), { now: Number.NaN })).toEqual({
      valid: false,
      reason: "invalid-clock",
    });
  });
  it("rejects algorithm substitution, omitted expiry, extra claims and malformed transports", async () => {
    const { exp: _exp, ...withoutExpiry } = claims;
    for (const token of [
      await mintRaw(claims, { alg: "none" }),
      await mintRaw(withoutExpiry),
      await mintRaw({ ...claims, admin: true }),
      "",
      "a.b.c",
      "a.b.c.d",
      "x".repeat(16_385),
    ]) {
      expect((await verify(token)).valid).toBe(false);
    }
    const token = await mint();
    expect((await verify(`${token}=`)).valid).toBe(false);
    expect(() => decodeBase64Url("Zh")).toThrow("noncanonical-base64url");
  });
  it("rejects signed revocations online while preserving valid offline use", async () => {
    const list = await deny({ issuedAt: NOW, revokedJti: [claims.jti] });
    const token = await mint();
    expect(await verify(token, { online: true, denyList: list })).toEqual({
      valid: false,
      reason: "revoked-token",
    });
    expect((await verify(token, { online: false, denyList: list })).valid).toBe(true);
    expect(
      (await verify(await mint({ ...claims, exp: NOW }), { online: false, denyList: list })).valid,
    ).toBe(false);
  });
  it("authenticates the signed date and list contents; forged lists cannot grant or revoke", async () => {
    const list = await deny();
    expect(await verifySignedDenyList(list, publicKey, NOW, crypto)).toEqual(list.payload);
    list.payload.revokedJti.push(claims.jti);
    await expect(verifySignedDenyList(list, publicKey, NOW, crypto)).rejects.toThrow(
      "invalid-deny-list-signature",
    );
    const forged = await deny({ issuedAt: NOW, revokedJti: [] }, foreignPair.privateKey);
    expect((await verify(await mint(), { online: true, denyList: forged })).valid).toBe(false);
    const future = await deny({ issuedAt: NOW + 1, revokedJti: [] });
    await expect(verifySignedDenyList(future, publicKey, NOW, crypto)).rejects.toThrow(
      "future-deny-list",
    );
  });
});

function memoryCache(initial: SignedDenyList | null = null) {
  let value = structuredClone(initial);
  return {
    readDenyList: vi.fn(async () => structuredClone(value)),
    writeDenyList: vi.fn(async (next: SignedDenyList) => {
      value = structuredClone(next);
    }),
  } satisfies DenyListCache;
}
function managerFixture(initial: SignedDenyList | null = null) {
  let time = NOW;
  let online = true;
  const fetchDenyList = vi.fn(async () => deny({ issuedAt: time, revokedJti: [] }));
  const cache = memoryCache(initial);
  const manager = new DenyListManager({
    publicKey,
    crypto,
    cache,
    fetchDenyList,
    now: () => time,
    online: () => online,
  });
  return {
    manager,
    cache,
    fetchDenyList,
    setTime: (next: number) => {
      time = next;
    },
    setOnline: (next: boolean) => {
      online = next;
    },
  };
}

describe("signed deny-list cadence and recovery", () => {
  it("fetches at start, before checkout/restore, and at the 24-hour boundary", async () => {
    const f = managerFixture();
    expect(await f.manager.refresh("app-start")).toEqual({ status: "updated" });
    expect(await f.manager.refresh("periodic")).toEqual({ status: "cached" });
    f.setTime(NOW + DENY_LIST_MAX_AGE - 1);
    await f.manager.refresh("periodic");
    expect(f.fetchDenyList).toHaveBeenCalledTimes(1);
    f.setTime(NOW + DENY_LIST_MAX_AGE);
    expect(await f.manager.refresh("periodic")).toEqual({ status: "updated" });
    await f.manager.refresh("checkout");
    await f.manager.refresh("restore");
    expect(f.fetchDenyList).toHaveBeenCalledTimes(4);
    expect(f.cache.writeDenyList).toHaveBeenCalledTimes(4);
  });
  it("reschedules the daily timer after a checkout refresh and cancels on stop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
    const fetchDenyList = vi.fn(async () =>
      deny({ issuedAt: Math.floor(Date.now() / 1000), revokedJti: [] }),
    );
    const manager = new DenyListManager({
      publicKey,
      crypto,
      cache: memoryCache(),
      fetchDenyList,
      online: () => true,
    });
    try {
      await manager.start();
      await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000);
      await manager.refresh("checkout");
      await vi.advanceTimersByTimeAsync(DENY_LIST_MAX_AGE * 1000 - 1);
      expect(fetchDenyList).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await manager.refresh("periodic"); // join the timer's in-flight cryptographic work
      expect(fetchDenyList).toHaveBeenCalledTimes(3);
    } finally {
      manager.stop();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not fetch offline; cached revocation rejects online despite a failed fetch", async () => {
    const f = managerFixture(await deny({ issuedAt: NOW, revokedJti: [claims.jti] }));
    const token = await mint();
    f.setOnline(false);
    expect(await f.manager.refresh("app-start")).toEqual({ status: "offline" });
    expect((await f.manager.verify(token, claims.sub)).valid).toBe(true);
    expect(f.fetchDenyList).not.toHaveBeenCalled();
    f.setOnline(true);
    f.fetchDenyList.mockRejectedValue(new Error("network disconnected"));
    expect(await f.manager.verify(token, claims.sub)).toEqual({
      valid: false,
      reason: "revoked-token",
    });
    f.setOnline(false);
    expect((await f.manager.verify(token, claims.sub)).valid).toBe(true);
  });
  it("refuses signed rollback, stale refreshes, same-date changes and a forged cache", async () => {
    const old = await deny({ issuedAt: NOW, revokedJti: [claims.jti] });
    const f = managerFixture(old);
    f.fetchDenyList.mockResolvedValue(await deny({ issuedAt: NOW - 1, revokedJti: [] }));
    expect(await f.manager.refresh("app-start")).toEqual({
      status: "unavailable",
      reason: "deny-list-rollback",
    });
    f.fetchDenyList.mockResolvedValue(await deny({ issuedAt: NOW, revokedJti: [] }));
    expect(await f.manager.refresh("restore")).toEqual({
      status: "unavailable",
      reason: "deny-list-rollback",
    });
    f.fetchDenyList.mockResolvedValue(
      await deny({ issuedAt: NOW - DENY_LIST_MAX_AGE, revokedJti: [] }),
    );
    expect(await f.manager.refresh("checkout")).toEqual({
      status: "unavailable",
      reason: "stale-deny-list",
    });
    expect(f.cache.writeDenyList).not.toHaveBeenCalled();
    expect((await f.manager.verify(await mint(), claims.sub)).valid).toBe(false);
    const forged = managerFixture(
      await deny({ issuedAt: NOW, revokedJti: [claims.jti] }, foreignPair.privateKey),
    );
    expect(await forged.manager.refresh("app-start")).toEqual({ status: "updated" });
    expect((await forged.manager.verify(await mint(), claims.sub)).valid).toBe(true);
  });
  it("deduplicates concurrent refreshes and recovers after a failed cache read", async () => {
    const f = managerFixture();
    f.cache.readDenyList.mockRejectedValue(new Error("unreadable cache"));
    const results = await Promise.all([
      f.manager.refresh("app-start"),
      f.manager.refresh("checkout"),
      f.manager.refresh("restore"),
    ]);
    expect(results.every((result) => result.status === "updated")).toBe(true);
    expect(f.fetchDenyList).toHaveBeenCalledTimes(1);
    f.setTime(NOW + 1);
    f.fetchDenyList.mockResolvedValue(await deny({ issuedAt: NOW + 1, revokedJti: [claims.jti] }));
    f.cache.writeDenyList.mockRejectedValue(new Error("quota exceeded"));
    expect((await f.manager.refresh("restore")).status).toBe("unavailable");
    expect((await f.manager.verify(await mint(), claims.sub)).valid).toBe(false);
  });
});

describe("WebCrypto encrypted storage", () => {
  it("round-trips the actual token using a nonextractable key and fresh nonces", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const token = await mint();
    const a = await wrapValue(token, key, "alice", crypto);
    const b = await wrapValue(token, key, "alice", crypto);
    expect(await unwrapValue(a, key, "alice", crypto)).toBe(token);
    expect(a.iv).not.toEqual(b.iv);
    expect(new Uint8Array(a.ciphertext)).not.toEqual(new Uint8Array(b.ciphertext));
    expect(new TextDecoder().decode(a.ciphertext)).not.toContain(token);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
    // CryptoKey cloning, required by IndexedDB, retains nonextractability and ability to decrypt.
    const cloned = structuredClone(key);
    expect(cloned.extractable).toBe(false);
    expect(await unwrapValue(a, cloned, "alice", crypto)).toBe(token);
  });
  it("rejects account substitution, wrong keys, ciphertext/nonce tampering and plaintext envelopes", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const wrong = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const wrapped = await wrapValue(await mint(), key, "alice", crypto);
    await expect(unwrapValue(wrapped, key, "bob", crypto)).rejects.toThrow(
      "storage-authentication-failed",
    );
    await expect(unwrapValue(wrapped, wrong, "alice", crypto)).rejects.toThrow(
      "storage-authentication-failed",
    );
    const tampered = structuredClone(wrapped);
    new Uint8Array(tampered.ciphertext)[0] = (new Uint8Array(tampered.ciphertext)[0] ?? 0) ^ 1;
    await expect(unwrapValue(tampered, key, "alice", crypto)).rejects.toThrow(
      "storage-authentication-failed",
    );
    const wrongNonce = structuredClone(wrapped);
    wrongNonce.iv[0] = (wrongNonce.iv[0] ?? 0) ^ 1;
    await expect(unwrapValue(wrongNonce, key, "alice", crypto)).rejects.toThrow(
      "storage-authentication-failed",
    );
    await expect(
      unwrapValue("plaintext" as unknown as typeof wrapped, key, "alice", crypto),
    ).rejects.toThrow("invalid-storage-envelope");
  });
  it("rejects invalid tokens before storage and has no plaintext fallback without IndexedDB", async () => {
    const storage = new WebTokenStorage({ crypto, publicKey, now: () => NOW });
    await expect(
      storage.store(await mint(claims, foreignPair.privateKey), claims.sub),
    ).rejects.toThrow("invalid-signature");
    await expect(storage.store(await mint(), claims.sub)).rejects.toThrow(
      "encrypted-storage-unavailable",
    );
    await expect(storage.load(claims.sub)).rejects.toThrow("encrypted-storage-unavailable");
  });
});
