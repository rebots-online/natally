import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  crockfordChars,
  isCodeShape,
  packHashCode,
  redeemCode,
  signingInput,
} from "../src/codes.js";
import { decodeBase64Url, encodeBase64Url } from "../src/token/format.js";

const crypto = webcrypto as unknown as Crypto;

let publicKey: string;
let privateKey: CryptoKey;

async function signText(text: string, key: CryptoKey = privateKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(text)));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ledger(initial: string[] = []) {
  const used = new Set(initial);
  return {
    has: vi.fn(async (hash: string) => used.has(hash)),
    add: vi.fn(async (hash: string) => {
      used.add(hash);
    }),
  };
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicKey = encodeBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
});

async function mint(tier: string, expiresAt: number | null): Promise<string> {
  const signature = await signText(signingInput({ tier, expiresAt }));
  return packHashCode({ tier, expiresAt }, signature);
}

function deps(options: { ledger?: ReturnType<typeof ledger>; now?: () => number } = {}) {
  return {
    publicKey,
    sha256Hex,
    verifyEd25519: async (message: string, signature: Uint8Array, key: Uint8Array) => {
      const raw = new Uint8Array(key.length);
      raw.set(key);
      const cryptoKey = await crypto.subtle.importKey("raw", raw, "Ed25519", false, ["verify"]);
      const sig = new Uint8Array(signature.length);
      sig.set(signature);
      return crypto.subtle.verify("Ed25519", cryptoKey, sig, new TextEncoder().encode(message));
    },
    ledger: options.ledger ?? ledger(),
    ...(options.now ? { now: options.now } : {}),
  };
}

describe("code shape", () => {
  it("accepts only NATALLY-XXXX-XXXX-XXXX", () => {
    expect(isCodeShape("NATALLY-ABCD-EF0G-HJKM")).toBe(true);
    expect(isCodeShape("natally-abcd-ef0g-hjkm")).toBe(false);
    expect(isCodeShape("NATALLY-ABC-DEF-GHIJ")).toBe(false);
    expect(isCodeShape("XXXX-ABCD-EFGH-JKMN")).toBe(false);
  });

  it("rejects Crockford-confusable characters (I, L, O, U)", () => {
    expect(crockfordChars("NATALLY-ABCD-EF0G-HJKM")).toBe(true);
    expect(crockfordChars("NATALLY-ABCI-EF0G-HJKM")).toBe(false);
    expect(crockfordChars("NATALLY-ABCD-EF0G-HJKU")).toBe(false);
  });
});

describe("redeemCode — the four outcomes", () => {
  it("valid: a correctly signed unexpired, unused code redeems and is consumed", async () => {
    const code = await mint("unlimited", null);
    const book = ledger();
    const outcome = await redeemCode(code, deps({ ledger: book }));
    expect(outcome).toEqual({ result: "valid", tier: "unlimited", expiresAt: null });
    const again = await redeemCode(code, deps({ ledger: book }));
    expect(again.result).toBe("already-used");
    expect(book.add).toHaveBeenCalledTimes(1);
  });

  it("expired: a signed code past its exp is expired, and is NOT consumed", async () => {
    const book = ledger();
    const code = await mint("unlimited", 1_000);
    const outcome = await redeemCode(code, deps({ ledger: book, now: () => 2_000 }));
    expect(outcome).toEqual({ result: "expired", expiresAt: 1_000 });
    expect(book.add).not.toHaveBeenCalled();
  });

  it("invalid: wrong shape, wrong charset, tampered payload, and foreign key all fail", async () => {
    expect((await redeemCode("HELLO", deps())).result).toBe("invalid");
    expect((await redeemCode("NATALLY-ABCD-EF0I-HJKM", deps())).result).toBe("invalid");

    const code = await mint("unlimited", null);
    const book = ledger();
    // Tamper: redeem under a foreign public key.
    const foreign = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const foreignPublic = encodeBase64Url(
      new Uint8Array(await crypto.subtle.exportKey("raw", foreign.publicKey)),
    );
    const outcome = await redeemCode(code, {
      ...deps({ ledger: book }),
      publicKey: foreignPublic,
    });
    expect(outcome).toMatchObject({ result: "invalid", reason: "signature" });
    expect(book.add).not.toHaveBeenCalled();
  });

  it("roundtrips: mint → verify → reuse rejected (Accept clause)", async () => {
    const code = await mint("unlimited", Date.now() + 60_000);
    const book = ledger();
    expect((await redeemCode(code, deps({ ledger: book }))).result).toBe("valid");
    expect((await redeemCode(code, deps({ ledger: book }))).result).toBe("already-used");
  });

  it("consumed ledger stores sha256 of the canonical uppercase code", async () => {
    const code = await mint("unlimited", null);
    const book = ledger();
    await redeemCode(code, deps({ ledger: book }));
    expect(book.has).toHaveBeenCalledWith(await sha256Hex(code.trim().toUpperCase()));
    expect(decodeBase64Url(publicKey)).toHaveLength(32);
  });
});
