import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { loadConfig, paymentsAvailable } from "../src/config.js";
import { type PurchaseAdapterId, PurchaseAdapterIdSchema } from "../src/types.js";

// Exercise the operator's actual template, without reading the private root .env.
const example = parseEnv(readFileSync(new URL("../../../.env.example", import.meta.url), "utf8"));
const fixture = (overrides: Record<string, unknown> = {}) => ({ ...example, ...overrides });
const railFields = {
  stripe: "VITE_STRIPE_CHECKOUT_URL",
  revenuecat: "VITE_REVENUECAT_WEB_SDK_KEY",
  polar: "VITE_POLAR_CHECKOUT_URL",
  lemonsqueezy: "VITE_LEMONSQUEEZY_CHECKOUT_URL",
  paypal: "VITE_PAYPAL_CHECKOUT_URL",
  square: "VITE_SQUARE_CHECKOUT_URL",
} as const satisfies Record<PurchaseAdapterId, string>;

function expectInvalid(overrides: Record<string, unknown>, field: string) {
  try {
    loadConfig(fixture(overrides));
  } catch (error) {
    expect(error).toBeInstanceOf(z.ZodError);
    if (!(error instanceof z.ZodError)) throw error;
    expect(error.issues.map((issue) => issue.path[0])).toContain(field);
    expect(error.message).toContain(field);
    return;
  }
  throw new Error(`Expected invalid configuration for ${field}`);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("config: valid", () => {
  it("loads the example's count3 trial and all public defaults", () => {
    const config = loadConfig(example);
    expect(config).toEqual({
      appName: example.VITE_APP_NAME,
      appId: example.VITE_APP_ID,
      appSlug: example.VITE_APP_SLUG,
      appUrl: example.VITE_APP_URL,
      landingUrl: example.VITE_LANDING_URL,
      modelMirrorBase: example.VITE_MODEL_MIRROR_BASE,
      devPort: 46371,
      trial: { mode: "count", readings: 3, trialModel: "qwen3-0.6b-q4_k_m" },
      licenseBridgeUrl: undefined,
      payments: {
        stripe: undefined,
        revenuecat: undefined,
        polar: undefined,
        lemonsqueezy: undefined,
        paypal: undefined,
        square: undefined,
      },
      revenueCatOfferingId: example.VITE_REVENUECAT_OFFERING_ID,
      loreEnabled: true,
      loreEmbedDim: 384,
      licensePubkey: undefined,
    });
    expect(example.VITE_TRIAL_DAYS).toBe("");
    expect(example.VITE_TRIAL_RATE_COOLDOWN_DAYS).toBe("");
    expect(example.VITE_LICENSE_PUBKEY).toBe("");
  });

  it.each([
    ["count", "VITE_TRIAL_READINGS", "readings"],
    ["time", "VITE_TRIAL_DAYS", "days"],
    ["rate", "VITE_TRIAL_RATE_COOLDOWN_DAYS", "cooldownDays"],
  ] as const)("populates exactly the %s gate", (mode, field, property) => {
    const config = loadConfig(
      fixture({
        VITE_TRIAL_MODE: mode,
        VITE_TRIAL_READINGS: "",
        VITE_TRIAL_DAYS: "",
        VITE_TRIAL_RATE_COOLDOWN_DAYS: "",
        [field]: "7",
      }),
    );
    expect(config.trial).toEqual({ mode, [property]: 7, trialModel: example.VITE_TRIAL_MODEL });
  });

  it("takes fork branding, URLs and model selection exclusively from supplied env", () => {
    const config = loadConfig(
      fixture({
        VITE_APP_NAME: "  My Sky  ",
        VITE_APP_ID: "org.example.mysky",
        VITE_APP_SLUG: "my-sky",
        VITE_APP_URL: "https://app.example.org",
        VITE_LANDING_URL: "https://www.example.org/sky",
        VITE_MODEL_MIRROR_BASE: "https://models.example.org/frozen",
        VITE_TRIAL_MODEL: "fork-model",
        VITE_REVENUECAT_OFFERING_ID: "fork-offering",
        NATALLY_DEV_PORT: "49173",
      }),
    );
    expect(config).toMatchObject({
      appName: "My Sky",
      appId: "org.example.mysky",
      appSlug: "my-sky",
      appUrl: "https://app.example.org",
      landingUrl: "https://www.example.org/sky",
      modelMirrorBase: "https://models.example.org/frozen",
      trial: { trialModel: "fork-model" },
      revenueCatOfferingId: "fork-offering",
      devPort: 49173,
    });
  });

  it("parses disabled lore as false and preserves configured licensing values", () => {
    const config = loadConfig(
      fixture({
        VITE_LORE_ENABLED: "0",
        VITE_LORE_EMBED_DIM: "768",
        VITE_LICENSE_PUBKEY: " public-verification-key ",
        VITE_LICENSE_BRIDGE_URL: "https://licenses.example.org",
      }),
    );
    expect(config.loreEnabled).toBe(false);
    expect(config.loreEmbedDim).toBe(768);
    expect(config.licensePubkey).toBe("public-verification-key");
    expect(config.licenseBridgeUrl).toBe("https://licenses.example.org");
  });

  it("freezes nested config and availability and detaches from the input env", () => {
    const env = fixture();
    const config = loadConfig(env);
    const available = paymentsAvailable(config);
    for (const value of [config, config.trial, config.payments, available]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Reflect.set(config, "appName", "changed")).toBe(false);
    expect(Reflect.set(config.trial, "readings", 99)).toBe(false);
    expect(Reflect.set(config.payments, "stripe", "https://wrong.example.org")).toBe(false);
    expect(Reflect.set(available, "0", "stripe")).toBe(false);
    env.VITE_APP_NAME = "changed";
    expect(config.appName).toBe(example.VITE_APP_NAME);
  });
});

describe("config: blank-rails-hidden", () => {
  it.each(["", " \t ", undefined])("hides every blank or absent rail (%s)", (value) => {
    const rails = Object.fromEntries(Object.values(railFields).map((field) => [field, value]));
    const config = loadConfig(fixture({ ...rails, VITE_LICENSE_BRIDGE_URL: value }));
    expect(paymentsAvailable(config)).toEqual([]);
    expect(Object.values(config.payments)).toEqual(Array(6).fill(undefined));
    expect(config.licenseBridgeUrl).toBeUndefined();
  });

  it.each(PurchaseAdapterIdSchema.options)("exposes only the configured %s rail", (id) => {
    const value = id === "revenuecat" ? "public-sdk-key" : "https://checkout.example.org/buy";
    const config = loadConfig(fixture({ [railFields[id]]: ` ${value} ` }));
    expect(paymentsAvailable(config)).toEqual([id]);
    expect(config.payments[id]).toBe(value);
  });

  it("reports all six IDs in billing vocabulary order, without the bridge as a rail", () => {
    const rails = Object.fromEntries(
      PurchaseAdapterIdSchema.options.map((id) => [
        railFields[id],
        id === "revenuecat" ? "public-sdk-key" : `https://checkout.example.org/${id}`,
      ]),
    );
    expect(
      paymentsAvailable(loadConfig(fixture({ ...rails, VITE_LICENSE_BRIDGE_URL: "" }))),
    ).toEqual(PurchaseAdapterIdSchema.options);
    expect(
      paymentsAvailable(
        loadConfig(fixture({ VITE_LICENSE_BRIDGE_URL: "https://bridge.example.org" })),
      ),
    ).toEqual([]);
  });
});

describe("config: bad-env-throws", () => {
  it("rejects an empty environment instead of supplying branded defaults", () => {
    expect(() => loadConfig({})).toThrow(z.ZodError);
  });

  it.each([
    "VITE_APP_NAME",
    "VITE_APP_ID",
    "VITE_APP_SLUG",
    "VITE_MODEL_MIRROR_BASE",
    "VITE_APP_URL",
    "VITE_LANDING_URL",
    "VITE_TRIAL_MODE",
    "VITE_TRIAL_MODEL",
    "VITE_REVENUECAT_OFFERING_ID",
    "VITE_LORE_ENABLED",
    "VITE_LORE_EMBED_DIM",
  ])("names missing or blank required field %s", (field) => {
    for (const value of [undefined, "", " \t "]) expectInvalid({ [field]: value }, field);
  });

  it.each([
    ["VITE_APP_ID", "sky"],
    ["VITE_APP_ID", "org..sky"],
    ["VITE_APP_ID", "org.example/sky"],
    ["VITE_APP_SLUG", "../sky"],
    ["VITE_APP_SLUG", "sky/app"],
    ["VITE_APP_SLUG", "sky app"],
    ["VITE_TRIAL_MODE", "COUNT"],
    ["VITE_TRIAL_MODE", "unlimited"],
    ["VITE_LORE_ENABLED", "false"],
    ["VITE_LORE_ENABLED", "true"],
    ["VITE_LORE_ENABLED", "2"],
    ["NATALLY_DEV_PORT", "1023"],
    ["NATALLY_DEV_PORT", "65536"],
  ])("rejects %s=%s", (field, value) => expectInvalid({ [field]: value }, field));

  it.each([
    "VITE_MODEL_MIRROR_BASE",
    "VITE_APP_URL",
    "VITE_LANDING_URL",
    "VITE_LICENSE_BRIDGE_URL",
    ...Object.entries(railFields)
      .filter(([id]) => id !== "revenuecat")
      .map(([, field]) => field),
  ])("rejects malformed, insecure or credential-bearing URLs in %s", (field) => {
    for (const value of [
      "not-a-url",
      "/relative",
      "http://example.org",
      "javascript:alert(1)",
      "ftp://example.org/file",
      "https://user:password@example.org",
    ]) {
      expectInvalid({ [field]: value }, field);
    }
  });

  it.each(["VITE_TRIAL_READINGS", "VITE_LORE_EMBED_DIM", "NATALLY_DEV_PORT"])(
    "rejects coercion, fractions and unsafe integers in %s",
    (field) => {
      for (const value of [
        "0",
        "-1",
        "1.5",
        "3x",
        "1e3",
        "0x10",
        "Infinity",
        "9007199254740992",
        3,
        true,
      ]) {
        expectInvalid({ [field]: value }, field);
      }
    },
  );

  it.each([
    ["count", "VITE_TRIAL_READINGS"],
    ["time", "VITE_TRIAL_DAYS"],
    ["rate", "VITE_TRIAL_RATE_COOLDOWN_DAYS"],
  ])("rejects missing, wrong or multiple parameters for %s mode", (mode, activeField) => {
    const emptyGates = {
      VITE_TRIAL_MODE: mode,
      VITE_TRIAL_READINGS: "",
      VITE_TRIAL_DAYS: "",
      VITE_TRIAL_RATE_COOLDOWN_DAYS: "",
    };
    expectInvalid(emptyGates, activeField);
    for (const invalid of [undefined, "", " ", "0", "-1", "1.5", "x", false]) {
      expectInvalid({ ...emptyGates, [activeField]: invalid }, activeField);
    }
    for (const field of [
      "VITE_TRIAL_READINGS",
      "VITE_TRIAL_DAYS",
      "VITE_TRIAL_RATE_COOLDOWN_DAYS",
    ]) {
      if (field === activeField) continue;
      expectInvalid({ ...emptyGates, [field]: "2" }, activeField);
      expectInvalid({ ...emptyGates, [activeField]: "3", [field]: "2" }, field);
    }
  });
});

describe("config: public browser boundary", () => {
  it("never propagates script/server secrets or unknown VITE values", () => {
    const config = loadConfig(
      fixture({
        HF_TOKEN: "hf-private-sentinel",
        LICENSE_ED25519_PRIVATE_KEY: "signing-private-sentinel",
        STRIPE_WEBHOOK_SECRET: "webhook-private-sentinel",
        VITE_UNRECOGNIZED_SECRET: "unknown-private-sentinel",
      }),
    );
    expect(JSON.stringify(config)).not.toMatch(/sentinel|HF_TOKEN|PRIVATE_KEY|SECRET/);
    const env = fixture();
    Object.defineProperty(env, "HF_TOKEN", {
      enumerable: true,
      get() {
        throw new Error("A script secret must not even be read");
      },
    });
    expect(() => loadConfig(env)).not.toThrow();
  });

  it("imports with invalid env and defers the named failure to loadRuntimeConfig", async () => {
    vi.stubEnv("VITE_TRIAL_MODEL", "");
    const { loadRuntimeConfig } = await import("../../../apps/local/src/config.js");
    expect(() => loadRuntimeConfig()).toThrow(/VITE_TRIAL_MODEL/);
    // A failed attempt is not cached; the boundary can retry after configuration changes.
    for (const [key, value] of Object.entries(example)) vi.stubEnv(key, value);
    expect(loadRuntimeConfig().trial.trialModel).toBe(example.VITE_TRIAL_MODEL);
  });

  it("uses public import.meta.env and excludes the dev port and script secrets", async () => {
    for (const [key, value] of Object.entries(example)) vi.stubEnv(key, value);
    vi.stubEnv("VITE_APP_NAME", "Browser Fork");
    vi.stubEnv("VITE_APP_URL", "https://browser.example.org");
    vi.stubEnv("NATALLY_DEV_PORT", "invalid-script-only-port");
    vi.stubEnv("HF_TOKEN", "browser-hf-private-sentinel");
    vi.stubEnv("LICENSE_ED25519_PRIVATE_KEY", "browser-signing-private-sentinel");
    vi.stubEnv("VITE_UNRECOGNIZED_SECRET", "browser-unknown-private-sentinel");
    const { loadRuntimeConfig } = await import("../../../apps/local/src/config.js");
    const config = loadRuntimeConfig();
    expect(config.appName).toBe("Browser Fork");
    expect(config.appUrl).toBe("https://browser.example.org");
    expect(Object.isFrozen(config)).toBe(true);
    expect(config).not.toHaveProperty("devPort");
    expect(JSON.stringify(config)).not.toMatch(
      /sentinel|HF_TOKEN|PRIVATE_KEY|SECRET|NATALLY_DEV_PORT/,
    );
  });

  it("does not invent a dev port when only public env is provided", () => {
    expect(loadConfig(fixture({ NATALLY_DEV_PORT: undefined }))).not.toHaveProperty("devPort");
  });
});
