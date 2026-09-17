import { describe, expect, it, vi } from "vitest";
import {
  assertPublicHttpsCheckoutUrl,
  assertPublicHttpsUrl,
  GuardError,
} from "../src/adapters/guards.js";

describe("SSRF guards", () => {
  it("accepts a clean public https URL", () => {
    expect(assertPublicHttpsUrl("https://bridge.natally.robin.mba/verify", "bridge").pathname).toBe(
      "/verify",
    );
    expect(assertPublicHttpsCheckoutUrl("https://checkout.stripe.com/c/pay").hostname).toBe(
      "checkout.stripe.com",
    );
  });

  it("rejects non-https, credentials, query/fragment (verify role)", () => {
    expect(() => assertPublicHttpsUrl("http://bridge.example.com/", "bridge")).toThrow(GuardError);
    expect(() => assertPublicHttpsUrl("https://user:pass@bridge.example.com/", "bridge")).toThrow(
      GuardError,
    );
    expect(() => assertPublicHttpsUrl("https://bridge.example.com/?x=1", "bridge")).toThrow(
      GuardError,
    );
    expect(() => assertPublicHttpsUrl("https://bridge.example.com/#frag", "bridge")).toThrow(
      GuardError,
    );
  });

  it("rejects loopback, private and reserved hosts", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "192.168.0.10",
      "172.16.5.4",
      "172.31.255.255",
      "169.254.1.1",
      "[::1]",
      "[fd00::1]",
      "[fe80::1]",
      "metadata.google.internal",
      "printer.local",
    ]) {
      expect(() => assertPublicHttpsUrl(`https://${host}/`, "bridge"), host).toThrow(GuardError);
      expect(() => assertPublicHttpsCheckoutUrl(`https://${host}/`), host).toThrow(GuardError);
    }
  });

  it("allows public IPv4 and IPv6 and 172-public ranges", () => {
    expect(() => assertPublicHttpsUrl("https://93.184.216.34/", "bridge")).not.toThrow();
    expect(() =>
      assertPublicHttpsUrl("https://[2606:2800:220:1:248:1893:25c8:1946]/", "bridge"),
    ).not.toThrow();
    expect(() => assertPublicHttpsUrl("https://172.32.0.1/", "bridge")).not.toThrow();
  });

  it("IPv4-mapped IPv6 private form is caught", () => {
    expect(() => assertPublicHttpsUrl("https://[::ffff:192.168.1.1]/", "bridge")).toThrow(
      GuardError,
    );
  });
});

describe("hosted adapter", () => {
  it("URL build: config presence governs availability; checkout appends appUserId+offering and opens once", async () => {
    const { createHostedAdapter } = await import("../src/adapters/hosted.js");
    const opener = vi.fn(async (_url: string) => undefined);
    const present = createHostedAdapter(
      { id: "stripe", checkoutUrl: "https://checkout.stripe.com/c/pay", appUserId: "user-1" },
      opener,
    );
    const absent = createHostedAdapter(
      { id: "square", checkoutUrl: undefined, appUserId: "user-1" },
      opener,
    );
    expect(present.available()).toBe(true);
    expect(absent.available()).toBe(false);
    const session = await present.checkout({
      id: "natally_default",
      priceString: "$48",
      tier: "unlimited",
    });
    expect(session.kind).toBe("redirect");
    const url = new URL(session.url!);
    expect(url.searchParams.get("appUserId")).toBe("user-1");
    expect(url.searchParams.get("offering")).toBe("natally_default");
    expect(opener).toHaveBeenCalledTimes(1);
    await expect(
      absent.checkout({ id: "x", priceString: "$1", tier: "unlimited" }),
    ).rejects.toThrow(/not configured/);
    await expect(present.restore("user-1")).resolves.toBeNull();
  });
});

describe("bridge client", () => {
  const transport = (
    handler: (path: string, body: unknown) => { status: number; json: unknown },
  ) => ({
    post: vi.fn(async (path: string, body: unknown) => {
      const result = handler(path, body);
      return { status: result.status, json: async () => result.json };
    }),
  });

  it("verifyOnce parses token presence/absence and surfaces deny-list", async () => {
    const { verifyOnce } = await import("../src/bridge-client.js");
    const withToken = transport(() => ({
      status: 200,
      json: { token: "tok", denyList: { issuedAt: 1, revokedJti: [] } },
    }));
    await expect(verifyOnce(withToken, "u1")).resolves.toEqual({
      token: "tok",
      denyList: { issuedAt: 1, revokedJti: [] },
    });
    const without = transport(() => ({ status: 200, json: { token: null } }));
    await expect(verifyOnce(without, "u1")).resolves.toEqual({ token: null });
  });

  it("redeemOnce maps the four outcomes", async () => {
    const { redeemOnce } = await import("../src/bridge-client.js");
    const ok = transport(() => ({ status: 200, json: { valid: true, token: "tok" } }));
    await expect(redeemOnce(ok, "NATALLY-AAAA-BBBB-CCCC")).resolves.toMatchObject({
      valid: true,
      token: "tok",
    });
    const bad = transport(() => ({ status: 200, json: { valid: false, reason: "already-used" } }));
    await expect(redeemOnce(bad, "X")).resolves.toMatchObject({
      valid: false,
      reason: "already-used",
    });
  });

  it("poll loop: returns the token when it appears; backs off with growth and a cap", async () => {
    const { pollForToken } = await import("../src/bridge-client.js");
    const slept: number[] = [];
    let clock = 1_000;
    let calls = 0;
    const t = transport(() => {
      calls += 1;
      return calls < 4
        ? { status: 200, json: { token: null } }
        : { status: 200, json: { token: "late-token" } };
    });
    const token = await pollForToken({
      transport: t,
      appUserId: "u1",
      poll: { intervalMs: 2_000, growth: 1.5, maxIntervalMs: 30_000, capMs: 600_000 },
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
      now: () => clock,
    });
    expect(token).toBe("late-token");
    expect(calls).toBe(4);
    expect(slept).toEqual([2_000, 3_000, 4_500]);
  });

  it("poll loop: offline transport errors are tolerated under the cap; 4xx (non-429) aborts", async () => {
    const { pollForToken } = await import("../src/bridge-client.js");
    let clock = 0;
    let attempts = 0;
    const failing = {
      post: vi.fn(async (_path: string, _body: unknown) => {
        attempts += 1;
        if (attempts <= 2) throw new TypeError("Failed to fetch");
        return { status: 200, json: async () => ({ token: "recovered" }) };
      }),
    };
    await expect(
      pollForToken({
        transport: failing,
        appUserId: "u1",
        poll: { intervalMs: 100, capMs: 60_000 },
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).resolves.toBe("recovered");

    const forbidden = transport(() => ({ status: 403, json: {} }));
    await expect(
      pollForToken({
        transport: forbidden,
        appUserId: "u1",
        poll: { intervalMs: 100, capMs: 60_000 },
        sleep: async () => {
          clock += 100;
        },
        now: () => clock,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("poll loop: the cap throws 408 rather than polling forever", async () => {
    const { pollForToken } = await import("../src/bridge-client.js");
    let clock = 0;
    const never = transport(() => ({ status: 200, json: { token: null } }));
    await expect(
      pollForToken({
        transport: never,
        appUserId: "u1",
        poll: { intervalMs: 1_000, capMs: 5_000 },
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).rejects.toMatchObject({ status: 408 });
  });
});
