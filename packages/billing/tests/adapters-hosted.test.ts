// natally — B.5a hosted-redirect adapter + bridge client tests (TEST_RUBRIC
// TR-3/B.5a matrix: URL build; poll 2 s backoff, 15 min cap; SSRF rejects
// http, loopback, RFC1918/private, link-local, reserved hosts).
//
// No mocks in shipped code — the transport is an injected parameter and the
// tests inject a plain queued function (tests may stub, src never does).
// Token verification on the happy path is the REAL B.3 `verifyToken` against
// a real WebCrypto Ed25519 keypair; the unverifiable path queues a token that
// genuinely fails verification.

import { describe, expect, it } from "vitest";
import { BridgeError, createBridgeClient, type TokenVerifier, type Transport } from "../src/bridge-client";
import { assertSafeUrl, UnsafeUrlError } from "../src/guards";
import { createHostedAdapter, HostedAdapterError } from "../src/adapters/hosted";
import { encodeToken } from "../src/token/format";
import { TOKEN_ISSUER, verifyToken } from "../src/token/verify-web";
import type { LicensePayload, LicenseToken, Offering } from "../src/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const APP_USER = "user-robin";
const BRIDGE = "https://bridge.natally.example";
const CONFIG = "https://checkout.stripe.example/c/pay";
const OFFERING: Offering = { id: "unlimited-lifetime", priceString: "$49", tier: "unlimited" };

interface TestKeypair {
  readonly privateKey: CryptoKey;
  readonly publicKeyRaw: Uint8Array;
}

async function makeKeypair(): Promise<TestKeypair> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKeyRaw };
}

async function mintToken(
  keypair: TestKeypair,
  overrides: Partial<LicensePayload> = {},
): Promise<LicenseToken> {
  const payload: LicensePayload = {
    sub: APP_USER,
    tier: "unlimited",
    iat: 1_700_000_000,
    exp: null,
    iss: TOKEN_ISSUER,
    jti: "jti-b5a-0001",
    ...overrides,
  };
  return encodeToken(payload, async (signingInput) =>
    new Uint8Array(await crypto.subtle.sign("Ed25519", keypair.privateKey, signingInput)),
  );
}

/** Real B.3 verifier with only the baked key bound; appUserId flows per call. */
function verifierFor(publicKeyRaw: Uint8Array): TokenVerifier {
  return (token, appUserId) => verifyToken(token, { publicKey: publicKeyRaw, appUserId });
}

// ---------------------------------------------------------------------------
// Queued transport — a plain injected function, no module mocking
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly body?: string;
}

type QueueEntry = { readonly status: number; readonly body: string } | { readonly offline: true };

function queueTransport(entries: QueueEntry[]): { transport: Transport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: Transport = async (url, request) => {
    calls.push({ url, method: request.method, body: request.body });
    const entry = entries.shift();
    if (entry === undefined || "offline" in entry) throw new Error("test transport: offline");
    return { status: entry.status, body: entry.body };
  };
  return { transport, calls };
}

function alwaysOfflineTransport(): Transport {
  return async () => {
    throw new Error("test transport: offline");
  };
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe("hosted adapter: URL build, poll loop, SSRF rejects loopback/private", () => {
  it("available() mirrors the configured checkout URL (blank ⇒ rail hidden)", () => {
    const absent = createHostedAdapter({
      rail: "stripe",
      configUrl: undefined,
      bridgeUrl: BRIDGE,
      appUserId: APP_USER,
      opener: () => {},
      transport: alwaysOfflineTransport(),
      verifyToken: verifierFor(new Uint8Array(32)),
    });
    expect(absent.available()).toBe(false);

    const present = createHostedAdapter({
      rail: "polar",
      configUrl: CONFIG,
      bridgeUrl: BRIDGE,
      appUserId: APP_USER,
      opener: () => {},
      transport: alwaysOfflineTransport(),
      verifyToken: verifierFor(new Uint8Array(32)),
    });
    expect(present.available()).toBe(true);
  });

  it("checkout builds the redirect URL with exactly ?appUserId=<id>&offering=<id> and opens it", async () => {
    const opened: string[] = [];
    const adapter = createHostedAdapter({
      rail: "stripe",
      configUrl: CONFIG,
      bridgeUrl: BRIDGE,
      appUserId: APP_USER,
      opener: (url) => {
        opened.push(url);
      },
      transport: alwaysOfflineTransport(),
      verifyToken: verifierFor(new Uint8Array(32)),
    });

    const session = await adapter.checkout(OFFERING);

    expect(session.kind).toBe("redirect");
    expect(session.offering).toBe(OFFERING);
    const parsed = new URL(session.url ?? "");
    // The configured checkout URL is preserved verbatim as the base.
    expect(`${parsed.protocol}//${parsed.host}${parsed.pathname}`).toBe(CONFIG);
    // Exactly two params, in spec order: appUserId then offering.
    expect([...parsed.searchParams.keys()]).toEqual(["appUserId", "offering"]);
    expect(parsed.searchParams.get("appUserId")).toBe(APP_USER);
    expect(parsed.searchParams.get("offering")).toBe(OFFERING.id);
    // The opener received exactly the session URL (Tauri shell-open / window.open seam).
    expect(opened).toEqual([session.url]);
  });

  it("checkout on a rail with a blank URL throws the typed not-configured error", async () => {
    const adapter = createHostedAdapter({
      rail: "square",
      configUrl: undefined,
      bridgeUrl: BRIDGE,
      appUserId: APP_USER,
      opener: () => {},
      transport: alwaysOfflineTransport(),
      verifyToken: verifierFor(new Uint8Array(32)),
    });
    const error = await adapter.checkout(OFFERING).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(HostedAdapterError);
    expect((error as HostedAdapterError).reason).toBe("not-configured");
  });

  it("poll: immediate success returns the verified token after a single POST /verify", async () => {
    const keypair = await makeKeypair();
    const token = await mintToken(keypair);
    const queue = queueTransport([{ status: 200, body: JSON.stringify({ token }) }]);
    const client = createBridgeClient({
      bridgeUrl: BRIDGE,
      transport: queue.transport,
      verifyToken: verifierFor(keypair.publicKeyRaw),
    });

    await expect(client.poll(APP_USER)).resolves.toBe(token);

    expect(queue.calls).toEqual([
      {
        url: `${BRIDGE}/verify`,
        method: "POST",
        body: JSON.stringify({ appUserId: APP_USER }),
      },
    ]);
  });

  it("poll: delayed success keeps polling (no token yet) until the bridge mints one", async () => {
    const keypair = await makeKeypair();
    const token = await mintToken(keypair, { jti: "jti-b5a-0002" });
    const queue = queueTransport([
      { status: 200, body: "{}" },
      { status: 404, body: "not found" },
      { status: 200, body: JSON.stringify({ token }) },
    ]);
    const client = createBridgeClient({
      bridgeUrl: BRIDGE,
      transport: queue.transport,
      verifyToken: verifierFor(keypair.publicKeyRaw),
      pollIntervalMs: 1,
    });

    await expect(client.poll(APP_USER)).resolves.toBe(token);
    expect(queue.calls.length).toBe(3);
    for (const call of queue.calls) {
      expect(call.method).toBe("POST");
      expect(call.url).toBe(`${BRIDGE}/verify`);
    }
  });

  it("poll: transport offline until the cap keeps retrying, then returns null (no throw)", async () => {
    let attempts = 0;
    const client = createBridgeClient({
      bridgeUrl: BRIDGE,
      transport: async () => {
        attempts += 1;
        throw new Error("test transport: offline");
      },
      verifyToken: verifierFor(new Uint8Array(32)),
      pollIntervalMs: 2,
      pollCapMs: 40,
    });

    await expect(client.poll(APP_USER)).resolves.toBeNull();
    // The loop stayed alive and retried until the cap, instead of failing fast.
    expect(attempts).toBeGreaterThan(1);
  });

  it("poll: a presented token that fails verification is a typed BridgeError, never returned", async () => {
    const keypair = await makeKeypair();
    // Genuinely unverifiable: signed for a different sub than the polled account.
    const foreign = await mintToken(keypair, { sub: "user-someone-else" });
    const queue = queueTransport([{ status: 200, body: JSON.stringify({ token: foreign }) }]);
    const client = createBridgeClient({
      bridgeUrl: BRIDGE,
      transport: queue.transport,
      verifyToken: verifierFor(keypair.publicKeyRaw),
    });

    const error = await client.poll(APP_USER).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(BridgeError);
    expect((error as BridgeError).reason).toBe("unverifiable");
  });

  it("restore: GET /verify?appUserId= returns the verified token (real B.3 verify)", async () => {
    const keypair = await makeKeypair();
    const token = await mintToken(keypair, { jti: "jti-b5a-0003" });
    const queue = queueTransport([{ status: 200, body: JSON.stringify({ token }) }]);
    const adapter = createHostedAdapter({
      rail: "lemonsqueezy",
      configUrl: CONFIG,
      bridgeUrl: BRIDGE,
      appUserId: APP_USER,
      opener: () => {},
      transport: queue.transport,
      verifyToken: verifierFor(keypair.publicKeyRaw),
    });

    await expect(adapter.restore(APP_USER)).resolves.toBe(token);
    expect(queue.calls).toEqual([
      { url: `${BRIDGE}/verify?appUserId=${encodeURIComponent(APP_USER)}`, method: "GET" },
    ]);
  });

  it("restore: absence is honest null (404, no-token body, transport offline)", async () => {
    const keypair = await makeKeypair();
    const verifier = verifierFor(keypair.publicKeyRaw);
    const make = (transport: Transport) =>
      createHostedAdapter({
        rail: "paypal",
        configUrl: CONFIG,
        bridgeUrl: BRIDGE,
        appUserId: APP_USER,
        opener: () => {},
        transport,
        verifyToken: verifier,
      });

    const notFound = queueTransport([{ status: 404, body: "no license" }]);
    await expect(make(notFound.transport).restore(APP_USER)).resolves.toBeNull();

    const noToken = queueTransport([{ status: 200, body: "{}" }]);
    await expect(make(noToken.transport).restore(APP_USER)).resolves.toBeNull();

    const offline = make(alwaysOfflineTransport());
    await expect(offline.restore(APP_USER)).resolves.toBeNull();
  });

  it("restore: an unverifiable token (wrong sub, or malformed) is never returned — typed BridgeError", async () => {
    const keypair = await makeKeypair();
    const verifier = verifierFor(keypair.publicKeyRaw);
    const make = (transport: Transport) =>
      createHostedAdapter({
        rail: "stripe",
        configUrl: CONFIG,
        bridgeUrl: BRIDGE,
        appUserId: APP_USER,
        opener: () => {},
        transport,
        verifyToken: verifier,
      });

    const wrongSub = await mintToken(keypair, { sub: "user-someone-else", jti: "jti-b5a-0004" });
    const wrongSubQueue = queueTransport([{ status: 200, body: JSON.stringify({ token: wrongSub }) }]);
    const wrongSubError = await make(wrongSubQueue.transport)
      .restore(APP_USER)
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(wrongSubError).toBeInstanceOf(BridgeError);
    expect((wrongSubError as BridgeError).reason).toBe("unverifiable");

    const malformedQueue = queueTransport([{ status: 200, body: JSON.stringify({ token: "garbage" }) }]);
    const malformedError = await make(malformedQueue.transport)
      .restore(APP_USER)
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(malformedError).toBeInstanceOf(BridgeError);
    expect((malformedError as BridgeError).reason).toBe("unverifiable");
  });
});

// ---------------------------------------------------------------------------
// SSRF guards (§11): literal + suffix checks, no DNS
// ---------------------------------------------------------------------------

describe("guards: SSRF rejects http, loopback, private, link-local, reserved hosts", () => {
  const rejected: ReadonlyArray<readonly [string, string]> = [
    ["http://checkout.stripe.example/c/pay", "non-https"],
    ["https://127.0.0.1/x", "loopback"],
    ["https://127.8.15.99/x", "loopback"],
    ["https://10.1.2.3/x", "private-range"],
    ["https://172.16.0.9/x", "private-range"],
    ["https://172.31.255.255/x", "private-range"],
    ["https://192.168.1.5/x", "private-range"],
    ["https://169.254.9.9/x", "reserved-host"],
    ["https://0.0.0.0/x", "reserved-host"],
    ["https://[::1]/x", "loopback"],
    ["https://[::ffff:127.0.0.1]/x", "loopback"],
    ["https://[fc00::1]/x", "private-range"],
    ["https://[fd12:3456::1]/x", "private-range"],
    ["https://[fe80::1]/x", "reserved-host"],
    ["https://evil.localhost/x", "loopback"],
    ["https://printer.local/x", "reserved-host"],
    ["https://[::ffff:192.168.0.10]/x", "private-range"],
    ["not a url at all", "unparsable"],
  ];

  for (const [url, reason] of rejected) {
    it(`rejects ${url} (${reason})`, () => {
      expect(() => assertSafeUrl(url)).toThrow(UnsafeUrlError);
      try {
        assertSafeUrl(url);
      } catch (error) {
        expect((error as UnsafeUrlError).reason).toBe(reason);
      }
    });
  }

  it("accepts real https hosts and public IPs", () => {
    expect(assertSafeUrl("https://checkout.stripe.example/c/pay").hostname).toBe(
      "checkout.stripe.example",
    );
    expect(assertSafeUrl("https://8.8.8.8/x").hostname).toBe("8.8.8.8");
    // 172.32.x is outside the /12 — public.
    expect(assertSafeUrl("https://172.32.0.1/x").hostname).toBe("172.32.0.1");
    // 169.255.x is outside link-local.
    expect(assertSafeUrl("https://169.255.1.1/x").hostname).toBe("169.255.1.1");
  });

  it("allowHttpLoopback admits only http-to-loopback; private ranges stay rejected", () => {
    expect(assertSafeUrl("http://127.0.0.1:8787/verify", { allowHttpLoopback: true }).port).toBe(
      "8787",
    );
    expect(assertSafeUrl("http://localhost:9/verify", { allowHttpLoopback: true }).hostname).toBe(
      "localhost",
    );
    expect(() =>
      assertSafeUrl("http://10.0.0.1/verify", { allowHttpLoopback: true }),
    ).toThrow(UnsafeUrlError);
    expect(() => assertSafeUrl("http://bridge.natally.example")).toThrow(UnsafeUrlError);
  });

  it("the adapter seam rejects unsafe configuration at construction", () => {
    const base = {
      appUserId: APP_USER,
      opener: () => {},
      transport: alwaysOfflineTransport(),
      verifyToken: verifierFor(new Uint8Array(32)),
    };
    // Plain-http (non-loopback) checkout host — rejected before any call.
    expect(() =>
      createHostedAdapter({ ...base, rail: "stripe", configUrl: "http://checkout.example/pay", bridgeUrl: BRIDGE }),
    ).toThrow(UnsafeUrlError);
    // Private-range bridge host — rejected.
    expect(() =>
      createHostedAdapter({ ...base, rail: "stripe", configUrl: CONFIG, bridgeUrl: "https://192.168.0.10" }),
    ).toThrow(UnsafeUrlError);
    // Loopback http bridge with the dev relief set — constructs and builds URLs.
    const dev = createHostedAdapter({
      ...base,
      rail: "square",
      configUrl: "http://127.0.0.1:5173/checkout",
      bridgeUrl: "http://localhost:8787",
      allowHttpLoopback: true,
    });
    expect(dev.available()).toBe(true);
  });
});
