import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  createAdapterRegistry,
  type RegistryCodeDeps,
  waysToPayLine,
} from "../src/adapters/registry.js";
import { packHashCode, signingInput } from "../src/codes.js";
import { encodeBase64Url } from "../src/token/format.js";
import type { PurchaseAdapter } from "../src/types.js";

const crypto = webcrypto as unknown as Crypto;

const adapter = (id: PurchaseAdapter["id"], available: boolean): PurchaseAdapter => ({
  id,
  available: () => available,
  checkout: vi.fn(async (offering) => ({
    kind: "redirect" as const,
    url: `https://x/${id}`,
    offering,
  })),
  restore: vi.fn(async () => null),
});

const offering = { id: "natally_default", priceString: "$48", tier: "unlimited" } as const;

let publicKey: string;
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicKey = encodeBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
});

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function codeDeps(ledger: {
  has: (h: string) => Promise<boolean>;
  add: (h: string) => Promise<void>;
}): RegistryCodeDeps {
  return {
    publicKey,
    sha256Hex,
    verifyEd25519: async (message, signature, key) => {
      const raw = new Uint8Array(key);
      const cryptoKey = await crypto.subtle.importKey("raw", raw, "Ed25519", false, ["verify"]);
      const sig = new Uint8Array(signature);
      return crypto.subtle.verify("Ed25519", cryptoKey, sig, new TextEncoder().encode(message));
    },
    ledger,
  };
}

async function mint(tier = "unlimited"): Promise<string> {
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      privateKey,
      new TextEncoder().encode(signingInput({ tier, expiresAt: null })),
    ),
  );
  return packHashCode({ tier, expiresAt: null }, signature);
}

function makeRegistry(adapters: readonly PurchaseAdapter[], ledger = emptyLedger()) {
  return createAdapterRegistry({ adapters, codeDeps: codeDeps(ledger) });
}

function emptyLedger() {
  const used = new Set<string>();
  return {
    has: async (hash: string) => used.has(hash),
    add: async (hash: string) => {
      used.add(hash);
    },
  };
}

describe("adapter registry (B.5c)", () => {
  it("hides absent rails and exposes the present set in frozen id order", () => {
    const registry = makeRegistry([
      adapter("square", true),
      adapter("stripe", true),
      adapter("paypal", false),
      adapter("revenuecat", true),
    ]);
    expect(registry.paymentsAvailable()).toEqual(["stripe", "revenuecat", "square"]);
    expect(waysToPayLine(registry.paymentsAvailable())).toBe("stripe · revenuecat · square");
    expect(waysToPayLine([])).toBe("none configured");
  });

  it("duplicate registration is an error, not a silent overwrite", () => {
    expect(() => makeRegistry([adapter("stripe", true), adapter("stripe", false)])).toThrow(
      /Duplicate/,
    );
  });

  it("purchase dispatches to exactly the named adapter; unknown and absent rails fail", async () => {
    const stripe = adapter("stripe", true);
    const paypal = adapter("paypal", false);
    const registry = makeRegistry([stripe, paypal]);
    const session = await registry.purchase("stripe", { ...offering });
    expect(session.url).toBe("https://x/stripe");
    expect(stripe.checkout).toHaveBeenCalledTimes(1);
    await expect(registry.purchase("polar", { ...offering })).rejects.toThrow(/Unknown/);
    await expect(registry.purchase("paypal", { ...offering })).rejects.toThrow(/not available/);
  });

  it("redeem routes through B.4's four outcomes with reuse rejection", async () => {
    const ledger = emptyLedger();
    const registry = makeRegistry([adapter("stripe", true)], ledger);
    const code = await mint();
    await expect(registry.redeem(code)).resolves.toMatchObject({
      result: "valid",
      tier: "unlimited",
    });
    await expect(registry.redeem(code)).resolves.toMatchObject({ result: "already-used" });
    await expect(registry.redeem("NATALLY-AAAA-BBBB-CCCC")).resolves.toMatchObject({
      result: "invalid",
    });
  });

  it("get() returns the adapter or undefined, never a fabricated rail", () => {
    const registry = makeRegistry([adapter("stripe", true)]);
    expect(registry.get("stripe")?.id).toBe("stripe");
    expect(registry.get("polar")).toBeUndefined();
  });
});
