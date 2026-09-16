// natally — B.4 redeem-code tests (TEST_RUBRIC TR-3 codes matrix).
//
// Real WebCrypto Ed25519 (node 24 + browsers — no external crypto dep, no
// mocks in shipped code; test-scope stubs are exactly the in-memory Set
// ledger, the registry map, and the better-sqlite3 in-memory database behind
// the T0.9 migrate seam). Scenarios: extended + compact mint→verify OK;
// reuse rejected (Set ledger AND the real consumed_codes table through the
// T0.9 migrate); registry-handle semantics for mintRandom (hit → valid,
// reuse → already-used, miss → invalid); charset confusables (I/L→1, O→0,
// U invalid), wrong length, missing prefix ⇒ invalid; expired at the exact
// day-granular boundary; keyId binding; fullSignature fast-reject + real
// Ed25519 confirmation; sha256 consumed-hash determinism; 4 outcomes exact.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  asConsumedCode,
  CODE_PREFIX,
  type CodeOutcome,
  type CodeTier,
  consumedCodeHash,
  CROCKFORD_ALPHABET,
  DAY_MS,
  type HashBasedCodePayload,
  keyIdForPubkey,
  mintHashBased,
  mintRandom,
  normalizeCode,
  type RegisteredCodeRecord,
  verifyCode,
  type VerifyCodeOptions,
} from "../src/codes";
import type { SignFn } from "../src/token/format";
import { canonicalJson, utf8Bytes } from "../src/token/format";
import type { ConsumedCode } from "../src/types";
import type { SqliteDb } from "../../lore/src/ddl";
import { migrate } from "../../lore/src/migrate";

// ---------------------------------------------------------------------------
// Fixtures: one test keypair, one payload, one injected clock
// ---------------------------------------------------------------------------

const EXP_DAYS = 20_000;
/** Last millisecond of expiry day EXP_DAYS — the exact day-granular deadline. */
const EXP = EXP_DAYS * DAY_MS + (DAY_MS - 1);
const NOW = EXP_DAYS * DAY_MS;
const PAYLOAD: HashBasedCodePayload = { tier: "unlimited", exp: EXP };

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

function payloadMessageBytes(expDays: number): Uint8Array<ArrayBuffer> {
  return utf8Bytes(canonicalJson({ exp: expDays, tier: "unlimited" as CodeTier }));
}

function verifyWith(
  code: string,
  keypair: TestKeypair,
  overrides: Partial<VerifyCodeOptions> = {},
): ReturnType<typeof verifyCode> {
  return verifyCode(code, {
    publicKey: keypair.publicKeyRaw,
    now: overrides.now ?? NOW,
    hasBeenConsumed: overrides.hasBeenConsumed,
    lookupRegistered: overrides.lookupRegistered,
    fullSignature: overrides.fullSignature,
  });
}

/** The real in-memory single-use ledger: a Set-backed closure (tests only). */
function createMemoryLedger(): {
  hasBeenConsumed(codeHash: string): boolean;
  markConsumed(codeHash: string): void;
} {
  const hashes = new Set<string>();
  return {
    hasBeenConsumed: (hash) => hashes.has(hash),
    markConsumed: (hash) => {
      hashes.add(hash);
    },
  };
}

function createRegistry(entries: Map<string, RegisteredCodeRecord>): {
  lookupRegistered(canonicalCode: string): RegisteredCodeRecord | null;
} {
  return {
    lookupRegistered: (canonicalCode) => entries.get(canonicalCode) ?? null,
  };
}

// ---------------------------------------------------------------------------
// better-sqlite3 through the T0.9 migrate seam (db path for consumed_codes)
// ---------------------------------------------------------------------------

type SqliteStatementLike = {
  get(...params: Bindable[]): unknown;
  all(...params: Bindable[]): unknown[];
  run(...params: Bindable[]): { readonly changes: number | bigint };
};

type SqliteDatabaseLike = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementLike;
  close(): void;
};

type Bindable = string | number | bigint | boolean | null | Uint8Array;

const requireModule = createRequire(import.meta.url);
const BetterSqlite3 = requireModule("../../lore/node_modules/better-sqlite3") as new (
  path: string,
) => SqliteDatabaseLike;

function sqliteSeam(database: SqliteDatabaseLike): SqliteDb {
  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => {
      const statement = database.prepare(sql);
      return {
        get: (...params) => statement.get(...params.map(String)),
        all: (...params) => statement.all(...params.map(String)),
        run: (...params) => statement.run(...params.map(String)),
      };
    },
  };
}

function createSqliteLedger(
  seam: SqliteDb,
  now: () => number,
): {
  hasBeenConsumed(codeHash: string): boolean;
  markConsumed(codeHash: string): void;
} {
  const insert = seam.prepare(
    "INSERT INTO consumed_codes (code_hash, redeemed_at) VALUES (?, ?)",
  );
  const select = seam.prepare("SELECT code_hash FROM consumed_codes WHERE code_hash = ?");
  return {
    hasBeenConsumed: (hash) => select.get(hash) !== undefined,
    markConsumed: (hash) => {
      insert.run(hash, now());
    },
  };
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe("codes: mint→verify→reuse rejected, 4 outcomes exact", () => {
  it("extended mint→verify OK with the exact payload roundtripped; reuse rejected via the Set ledger", async () => {
    const keypair = await generateTestKeypair();
    const code = await mintHashBased(PAYLOAD, signer(keypair.privateKey), {
      keyId: await keyIdForPubkey(keypair.publicKeyRaw),
    });
    expect(code).toMatch(/^NATALLY-([0-9A-Z]{4}-){4}[0-9A-Z]{4}$/);
    const ledger = createMemoryLedger();
    const result = await verifyWith(code, keypair, { hasBeenConsumed: ledger.hasBeenConsumed });
    expect(result).toEqual({ outcome: "valid", tier: "unlimited", exp: EXP });
    ledger.markConsumed(await consumedCodeHash(code));
    expect(await verifyWith(code, keypair, { hasBeenConsumed: ledger.hasBeenConsumed })).toEqual({
      outcome: "already-used",
    });
  });

  it("compact mint→verify OK offline (no registry dep); reuse rejected", async () => {
    const keypair = await generateTestKeypair();
    const code = await mintHashBased(PAYLOAD, signer(keypair.privateKey), { shape: "compact" });
    expect(code).toMatch(/^NATALLY-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const ledger = createMemoryLedger();
    expect(await verifyWith(code, keypair, { hasBeenConsumed: ledger.hasBeenConsumed })).toEqual({
      outcome: "valid",
      tier: "unlimited",
      exp: EXP,
    });
    ledger.markConsumed(await consumedCodeHash(code));
    expect(await verifyWith(code, keypair, { hasBeenConsumed: ledger.hasBeenConsumed })).toEqual({
      outcome: "already-used",
    });
  });

  it("extended ignores a wired-but-empty registry (offline by design); compact with a wired lookup is a pure handle", async () => {
    const keypair = await generateTestKeypair();
    const code = await mintHashBased(PAYLOAD, signer(keypair.privateKey), {
      keyId: await keyIdForPubkey(keypair.publicKeyRaw),
    });
    expect(await verifyWith(code, keypair, { lookupRegistered: () => null })).toEqual({
      outcome: "valid",
      tier: "unlimited",
      exp: EXP,
    });
    const compact = await mintHashBased(PAYLOAD, signer(keypair.privateKey), {
      shape: "compact",
    });
    expect(await verifyWith(compact, keypair, { lookupRegistered: () => null })).toEqual({
      outcome: "invalid",
    });
  });

  it("mintRandom is a registry handle: lookup hit → valid, reuse → already-used, miss → invalid", async () => {
    const keypair = await generateTestKeypair();
    const code = mintRandom();
    expect(normalizeCode(code)).toBe(code);
    const ledger = createMemoryLedger();
    const registry = createRegistry(
      new Map([[code, { tier: "unlimited", exp: EXP } as RegisteredCodeRecord]]),
    );
    expect(
      await verifyWith(code, keypair, {
        hasBeenConsumed: ledger.hasBeenConsumed,
        lookupRegistered: registry.lookupRegistered,
      }),
    ).toEqual({ outcome: "valid", tier: "unlimited", exp: EXP });
    ledger.markConsumed(await consumedCodeHash(code));
    expect(
      await verifyWith(code, keypair, {
        hasBeenConsumed: ledger.hasBeenConsumed,
        lookupRegistered: registry.lookupRegistered,
      }),
    ).toEqual({ outcome: "already-used" });
    const stranger = mintRandom();
    expect(
      await verifyWith(stranger, keypair, {
        hasBeenConsumed: ledger.hasBeenConsumed,
        lookupRegistered: registry.lookupRegistered,
      }),
    ).toEqual({ outcome: "invalid" });
  });

  it("charset: I/L→1 and O→0 normalize (lowercase too), U is invalid, bad length and missing prefix invalid", async () => {
    expect(normalizeCode("natally-iiii-llll-oooo")).toBe("NATALLY-1111-1111-0000");
    expect(normalizeCode("NATALLY-ILOI-LOIL-OILO")).toBe("NATALLY-1101-1011-0110");
    expect(normalizeCode("NATALLY-UUUU-UUUU-UUUU")).toBeNull();
    expect(normalizeCode("NATALLY-1111-1111-11")).toBeNull();
    expect(normalizeCode("NATALLY-1111-1111-11111")).toBeNull();
    expect(normalizeCode("NATALLY-1111-1111-1!2@")).toBeNull();
    expect(normalizeCode("1111-1111-1111")).toBeNull();
    expect(normalizeCode("NATALLY-1111-1111-1111-1111-1111")).not.toBeNull();

    // End-to-end: the confusable typing of a minted code verifies identically.
    const keypair = await generateTestKeypair();
    const code = await mintHashBased(PAYLOAD, signer(keypair.privateKey), {
      keyId: await keyIdForPubkey(keypair.publicKeyRaw),
    });
    const confusable = code.toLowerCase().replaceAll("0", "o").replaceAll("1", "i");
    expect(await verifyWith(confusable, keypair)).toEqual({
      outcome: "valid",
      tier: "unlimited",
      exp: EXP,
    });
    // Every body char is Crockford; the alphabet excludes I/L/O/U.
    for (const char of code.slice(CODE_PREFIX.length + 1).replaceAll("-", "")) {
      expect(CROCKFORD_ALPHABET.includes(char)).toBe(true);
    }
  });

  it("expired: valid through the last ms of the expiry day, expired one ms later", async () => {
    const keypair = await generateTestKeypair();
    const code = await mintHashBased(PAYLOAD, signer(keypair.privateKey), {
      keyId: await keyIdForPubkey(keypair.publicKeyRaw),
    });
    expect(await verifyWith(code, keypair, { now: EXP })).toEqual({
      outcome: "valid",
      tier: "unlimited",
      exp: EXP,
    });
    expect(await verifyWith(code, keypair, { now: EXP + 1 })).toEqual({ outcome: "expired" });
    // Day granularity: minting yesterday's expiry day means expired today.
    const shortLived = await mintHashBased(
      { tier: "unlimited", exp: NOW - 1 },
      signer(keypair.privateKey),
      { keyId: await keyIdForPubkey(keypair.publicKeyRaw) },
    );
    expect(await verifyWith(shortLived, keypair)).toEqual({ outcome: "expired" });
  });

  it("keyId binding: a foreign-key keyId slice makes the extended code invalid", async () => {
    const keypair = await generateTestKeypair();
    const expectedKeyId = await keyIdForPubkey(keypair.publicKeyRaw);
    const forged = await mintHashBased(PAYLOAD, signer(keypair.privateKey), {
      keyId: (expectedKeyId + 1) % 256,
    });
    expect(await verifyWith(forged, keypair)).toEqual({ outcome: "invalid" });
    const honest = await mintHashBased(PAYLOAD, signer(keypair.privateKey), { keyId: expectedKeyId });
    expect(await verifyWith(honest, keypair)).toEqual({
      outcome: "valid",
      tier: "unlimited",
      exp: EXP,
    });
  });

  it("fullSignature: truncation fast-rejects a foreign sig, then the real Ed25519 verify confirms the true one", async () => {
    const keypair = await generateTestKeypair();
    const code = await mintHashBased(PAYLOAD, signer(keypair.privateKey), {
      keyId: await keyIdForPubkey(keypair.publicKeyRaw),
    });
    // Ed25519 is deterministic: re-signing the same message reproduces σ.
    const signature = await signer(keypair.privateKey)(payloadMessageBytes(EXP_DAYS));
    expect(signature.byteLength).toBe(64);
    expect(
      await verifyWith(code, keypair, { fullSignature: new Uint8Array(signature) }),
    ).toEqual({ outcome: "valid", tier: "unlimited", exp: EXP });

    const tampered = new Uint8Array(signature);
    tampered[0] = ((tampered[0] ?? 0) ^ 0xff) & 0xff;
    expect(await verifyWith(code, keypair, { fullSignature: tampered })).toEqual({
      outcome: "invalid",
    });

    const foreign = await signer(keypair.privateKey)(payloadMessageBytes(EXP_DAYS + 1));
    expect(await verifyWith(code, keypair, { fullSignature: new Uint8Array(foreign) })).toEqual({
      outcome: "invalid",
    });
  });

  it("sha256 consumed-hash determinism: confusable typings hash identically and match node's sha256; rows fit ConsumedCode", async () => {
    const keypair = await generateTestKeypair();
    const code = await mintHashBased(PAYLOAD, signer(keypair.privateKey), {
      keyId: await keyIdForPubkey(keypair.publicKeyRaw),
    });
    const canonical = normalizeCode(code);
    expect(canonical).not.toBeNull();
    const hash = await consumedCodeHash(code);
    // The ledger key is SHA-256 of the CANONICAL form: the confusable typing
    // normalizes to the same canonical string, hence the same hash.
    expect(await consumedCodeHash(normalizeCode(code.toLowerCase()) as string)).toBe(hash);
    expect(await consumedCodeHash(canonical as string)).toBe(hash);
    expect(hash).toBe(createHash("sha256").update(canonical as string).digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const row: ConsumedCode = asConsumedCode(hash, NOW);
    expect(row).toEqual({ codeHash: hash, redeemedAt: NOW });
  });

  it("minting is deterministic per key+payload and differs across payloads; day-granular exp roundtrips exactly", async () => {
    const keypair = await generateTestKeypair();
    const keyId = await keyIdForPubkey(keypair.publicKeyRaw);
    const first = await mintHashBased(PAYLOAD, signer(keypair.privateKey), { keyId });
    const second = await mintHashBased(PAYLOAD, signer(keypair.privateKey), { keyId });
    expect(second).toBe(first);
    const other = await mintHashBased(
      { tier: "unlimited", exp: EXP + DAY_MS },
      signer(keypair.privateKey),
      { keyId },
    );
    expect(other).not.toBe(first);
    expect((await verifyWith(first, keypair)).exp).toBe(EXP);
    expect((await verifyWith(other, keypair)).exp).toBe(EXP + DAY_MS);
  });

  it("the 4 outcomes are exactly valid | invalid | already-used | expired", async () => {
    const keypair = await generateTestKeypair();
    const ledger = createMemoryLedger();
    const code = await mintHashBased(PAYLOAD, signer(keypair.privateKey), {
      keyId: await keyIdForPubkey(keypair.publicKeyRaw),
    });
    const observed = new Set<CodeOutcome>();
    observed.add((await verifyWith(code, keypair, { hasBeenConsumed: ledger.hasBeenConsumed })).outcome);
    observed.add((await verifyWith("NATALLY-UUUU-UUUU-UUUU", keypair)).outcome);
    ledger.markConsumed(await consumedCodeHash(code));
    observed.add((await verifyWith(code, keypair, { hasBeenConsumed: ledger.hasBeenConsumed })).outcome);
    observed.add((await verifyWith(code, keypair, { now: EXP + 1 })).outcome);
    expect([...observed].sort()).toEqual(["already-used", "expired", "invalid", "valid"]);
  });

  it("db path: consumed_codes through the T0.9 migrate enforces single-use; migrate is idempotent", () => {
    const database = new BetterSqlite3(":memory:");
    try {
      const seam = sqliteSeam(database);
      const applied = migrate(seam, { vec: false });
      expect(applied).toContain("0004-license-ledgers");
      expect(migrate(seam, { vec: false })).toEqual([]);

      const ledger = createSqliteLedger(seam, () => NOW);
      expect(ledger.hasBeenConsumed("deadbeef")).toBe(false);
      const redeemedAt = NOW;
      const hash = createHash("sha256").update("NATALLY-1111-2222-3333").digest("hex");
      const row = asConsumedCode(hash, redeemedAt);
      ledger.markConsumed(row.codeHash);
      expect(ledger.hasBeenConsumed(row.codeHash)).toBe(true);
      expect(ledger.hasBeenConsumed("deadbeef")).toBe(false);
      const stored = seam.prepare("SELECT code_hash, redeemed_at FROM consumed_codes").all();
      expect(stored).toEqual([{ code_hash: hash, redeemed_at: redeemedAt }]);
    } finally {
      database.close();
    }
  });
});
