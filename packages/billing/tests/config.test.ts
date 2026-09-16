// natally — T0.10 config loader tests (ARCHITECTURE §15, §9.1).
// Accept: config: valid, blank-rails-hidden, bad-env-throws
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  loadConfig,
  paymentsAvailable,
  type EnvRecord,
  type RuntimeConfig,
} from "../src/config";

/** The shipped `.env.example`, populated; blank vars omitted. */
const VALID_ENV: Record<string, string> = {
  VITE_MODEL_MIRROR_BASE:
    "https://huggingface.co/RobinsAIWorld/natally-models/resolve/main",
  VITE_APP_URL: "https://natally.robin.mba",
  VITE_TRIAL_MODE: "count",
  VITE_TRIAL_READINGS: "3",
  VITE_TRIAL_RATE_COOLDOWN_DAYS: "3",
  VITE_TRIAL_MODEL: "natally-companion-q4_k_m",
  VITE_REVENUECAT_OFFERING_ID: "natally_default",
  VITE_LORE_ENABLED: "1",
  VITE_LORE_EMBED_DIM: "384",
};

const env = (overrides: Record<string, string> = {}): EnvRecord => ({
  ...VALID_ENV,
  ...overrides,
});

/** Run loadConfig, returning the thrown ConfigError or undefined. */
function loadFailing(vars: EnvRecord): ConfigError | undefined {
  try {
    loadConfig(vars);
    return undefined;
  } catch (error) {
    return error instanceof ConfigError ? error : undefined;
  }
}

describe("config: valid, blank-rails-hidden, bad-env-throws", () => {
  it("parses a valid env into a deeply frozen RuntimeConfig", () => {
    const config: RuntimeConfig = loadConfig(env());

    expect(config.trial).toEqual({
      mode: "count",
      readings: 3,
      trialModel: "natally-companion-q4_k_m",
    });
    expect(config.modelMirrorBase).toBe(
      "https://huggingface.co/RobinsAIWorld/natally-models/resolve/main",
    );
    expect(config.appUrl).toBe("https://natally.robin.mba");
    expect(config.revenueCatOfferingId).toBe("natally_default");
    expect(config.licenseBridgeUrl).toBeUndefined();
    // VITE_LICENSE_PUBKEY does not exist yet (B.3 adds it); tolerated absent.
    expect(config.licensePubkey).toBeUndefined();
    expect(config.lore).toEqual({ enabled: true, embedDim: 384 });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.trial)).toBe(true);
    expect(Object.isFrozen(config.rails)).toBe(true);
    expect(Object.isFrozen(config.lore)).toBe(true);
  });

  it("hides blank rails from paymentsAvailable, in canonical six-rail order", () => {
    const partial = loadConfig(
      env({
        VITE_STRIPE_CHECKOUT_URL: "https://buy.stripe.example/natally",
        VITE_PAYPAL_CHECKOUT_URL: "https://paypal.example/natally",
        VITE_SQUARE_CHECKOUT_URL: "   ",
      }),
    );
    expect(partial.rails.stripe).toBe("https://buy.stripe.example/natally");
    expect(partial.rails.square).toBeUndefined();
    expect(paymentsAvailable(partial)).toEqual(["stripe", "paypal"]);

    const scrambled = loadConfig(
      env({
        VITE_SQUARE_CHECKOUT_URL: "https://square.example/natally",
        VITE_PAYPAL_CHECKOUT_URL: "https://paypal.example/natally",
        VITE_LEMONSQUEEZY_CHECKOUT_URL: "https://ls.example/natally",
        VITE_POLAR_CHECKOUT_URL: "https://polar.example/natally",
        VITE_REVENUECAT_WEB_SDK_KEY: "rcw_example_key",
        VITE_STRIPE_CHECKOUT_URL: "https://buy.stripe.example/natally",
      }),
    );
    expect(paymentsAvailable(scrambled)).toEqual([
      "stripe",
      "revenuecat",
      "polar",
      "lemonsqueezy",
      "paypal",
      "square",
    ]);
  });

  it("throws naming the field for each bad-trial shape", () => {
    const cases: ReadonlyArray<readonly [string, EnvRecord]> = [
      // mode itself
      ["VITE_TRIAL_MODE", {}],
      ["VITE_TRIAL_MODE", env({ VITE_TRIAL_MODE: "forever" })],
      ["VITE_TRIAL_MODE", env({ VITE_TRIAL_MODE: "" })],
      // trialModel always required non-empty
      ["VITE_TRIAL_MODEL", {}],
      ["VITE_TRIAL_MODEL", env({ VITE_TRIAL_MODEL: "" })],
      ["VITE_TRIAL_MODEL", env({ VITE_TRIAL_MODEL: "  " })],
      // count gate: positive int
      ["VITE_TRIAL_READINGS", env({ VITE_TRIAL_READINGS: "0" })],
      ["VITE_TRIAL_READINGS", env({ VITE_TRIAL_READINGS: "-2" })],
      ["VITE_TRIAL_READINGS", env({ VITE_TRIAL_READINGS: "2.5" })],
      // time gate: days positive int, required under mode=time
      ["VITE_TRIAL_DAYS", env({ VITE_TRIAL_MODE: "time" })],
      ["VITE_TRIAL_DAYS", env({ VITE_TRIAL_MODE: "time", VITE_TRIAL_DAYS: "" })],
      ["VITE_TRIAL_DAYS", env({ VITE_TRIAL_MODE: "time", VITE_TRIAL_DAYS: "-1" })],
      // rate gate: cooldown positive int (default 3 when blank)
      [
        "VITE_TRIAL_RATE_COOLDOWN_DAYS",
        env({ VITE_TRIAL_MODE: "rate", VITE_TRIAL_RATE_COOLDOWN_DAYS: "abc" }),
      ],
      [
        "VITE_TRIAL_RATE_COOLDOWN_DAYS",
        env({ VITE_TRIAL_MODE: "rate", VITE_TRIAL_RATE_COOLDOWN_DAYS: "0" }),
      ],
    ];
    for (const [field, vars] of cases) {
      const error = loadFailing(vars);
      expect(error, field).toBeInstanceOf(ConfigError);
      expect(error?.fields, field).toContain(field);
      expect(error?.message, field).toContain(field);
    }
  });

  it("throws naming the field for malformed non-trial values", () => {
    const cases: ReadonlyArray<readonly [string, EnvRecord]> = [
      ["VITE_LORE_ENABLED", env({ VITE_LORE_ENABLED: "maybe" })],
      ["VITE_LORE_EMBED_DIM", env({ VITE_LORE_EMBED_DIM: "0" })],
      ["VITE_LORE_EMBED_DIM", env({ VITE_LORE_EMBED_DIM: "wide" })],
    ];
    for (const [field, vars] of cases) {
      const error = loadFailing(vars);
      expect(error, field).toBeInstanceOf(ConfigError);
      expect(error?.fields, field).toContain(field);
    }
  });

  it("applies defaults: embed dim 384, readings 3, cooldown 3, lore on when blank", () => {
    const minimal = loadConfig({ VITE_TRIAL_MODE: "count", VITE_TRIAL_MODEL: "m" });
    expect(minimal.lore.embedDim).toBe(384);
    expect(minimal.lore.enabled).toBe(true);
    expect(minimal.trial.readings).toBe(3);

    const rate = loadConfig({ VITE_TRIAL_MODE: "rate", VITE_TRIAL_MODEL: "m" });
    expect(rate.trial.cooldownDays).toBe(3);

    const disabled = loadConfig(env({ VITE_LORE_ENABLED: "0" }));
    expect(disabled.lore.enabled).toBe(false);

    const time = loadConfig(env({ VITE_TRIAL_MODE: "time", VITE_TRIAL_DAYS: "14" }));
    expect(time.trial).toEqual({ mode: "time", days: 14, trialModel: "natally-companion-q4_k_m" });
    expect(time.trial.readings).toBeUndefined();
    expect(time.trial.cooldownDays).toBeUndefined();
  });
});
