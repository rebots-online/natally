// natally — runtime configuration loader (ARCHITECTURE §15 configuration
// surface). A pure function of an environment record: every value is
// zod-validated, violations throw carrying the offending variable name, and
// the resolved RuntimeConfig is deeply frozen. Variable names are verbatim
// from `.env.example`.
//
// Trial law (§9.1): exactly one gate, the one `VITE_TRIAL_MODE` selects —
// count ⇒ `VITE_TRIAL_READINGS` (default 3), time ⇒ `VITE_TRIAL_DAYS`,
// rate ⇒ `VITE_TRIAL_RATE_COOLDOWN_DAYS` (default 3); each populated gate
// value must be a positive integer. `VITE_TRIAL_MODEL` is always required
// non-empty. Off-mode gate variables are tolerated as inert values (the
// shipped `.env.example` carries a populated cooldown while mode=count) but
// must still be well-formed when non-blank.
//
// B.3 will add `VITE_LICENSE_PUBKEY` to `.env.example`; this schema already
// tolerates its absence (optional `string | undefined`), so that change does
// not touch this file.

import { z } from "zod";
import type { PurchaseAdapterId, TrialPolicy } from "./types";

/** Environment record shape: `import.meta.env` or a Node `process.env`. */
export type EnvRecord = Readonly<Record<string, string | undefined>>;

/** Canonical six-rail order (§9.4, `PurchaseAdapterId`). */
export const PAYMENT_RAIL_ORDER: readonly PurchaseAdapterId[] = Object.freeze([
  "stripe",
  "revenuecat",
  "polar",
  "lemonsqueezy",
  "paypal",
  "square",
] satisfies readonly PurchaseAdapterId[]);

const DEFAULT_TRIAL_READINGS = 3;
const DEFAULT_TRIAL_COOLDOWN_DAYS = 3;
/** §8: lore embedding dimension pin; `VITE_LORE_EMBED_DIM` default. */
const DEFAULT_LORE_EMBED_DIM = 384;

// ---------------------------------------------------------------------------
// Resolved, frozen configuration
// ---------------------------------------------------------------------------

export interface RuntimeConfig {
  /** §9.1 trial policy with exactly one gate, per `VITE_TRIAL_MODE`. */
  readonly trial: TrialPolicy;
  /** Per-rail config value; `undefined` ⇒ rail absent (hidden, honest readout). */
  readonly rails: Readonly<Record<PurchaseAdapterId, string | undefined>>;
  readonly licenseBridgeUrl: string | undefined;
  /** Baked Ed25519 verify key (base64). Absent until B.3 adds the env line. */
  readonly licensePubkey: string | undefined;
  readonly modelMirrorBase: string | undefined;
  readonly appUrl: string | undefined;
  readonly revenueCatOfferingId: string | undefined;
  readonly lore: {
    readonly enabled: boolean;
    readonly embedDim: number;
  };
}

/** Thrown by `loadConfig` when the environment fails validation. */
export class ConfigError extends Error {
  /** The offending variable names (unique, first-seen order). */
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    const unique = [...new Set(fields)].filter((field) => field.length > 0);
    super(`config: invalid environment — offending variables: ${unique.join(", ")}`);
    this.name = "ConfigError";
    this.fields = unique;
  }
}

// ---------------------------------------------------------------------------
// Schema (object keys are the literal env variable names, so zod issue paths
// carry the field name on every violation)
// ---------------------------------------------------------------------------

/** Trimmed strings; blank/whitespace-only collapses to `undefined`. */
function blankToUndefined(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return value;
}

const optionalPositiveInt = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().positive().optional(),
);
const optionalNonEmpty = z.preprocess(blankToUndefined, z.string().min(1).optional());

const ConfigSchema = z
  .object({
    // Trial block (§9.1)
    VITE_TRIAL_MODE: z.preprocess(blankToUndefined, z.enum(["count", "time", "rate"])),
    VITE_TRIAL_READINGS: optionalPositiveInt,
    VITE_TRIAL_DAYS: optionalPositiveInt,
    VITE_TRIAL_RATE_COOLDOWN_DAYS: optionalPositiveInt,
    VITE_TRIAL_MODEL: z.preprocess(blankToUndefined, z.string().min(1)),

    // Unlock / processors (§9.4); blank ⇒ rail absent
    VITE_LICENSE_BRIDGE_URL: optionalNonEmpty,
    VITE_STRIPE_CHECKOUT_URL: optionalNonEmpty,
    VITE_REVENUECAT_WEB_SDK_KEY: optionalNonEmpty,
    VITE_REVENUECAT_OFFERING_ID: optionalNonEmpty,
    VITE_POLAR_CHECKOUT_URL: optionalNonEmpty,
    VITE_LEMONSQUEEZY_CHECKOUT_URL: optionalNonEmpty,
    VITE_PAYPAL_CHECKOUT_URL: optionalNonEmpty,
    VITE_SQUARE_CHECKOUT_URL: optionalNonEmpty,

    // Tolerated-absent until B.3 adds VITE_LICENSE_PUBKEY to .env.example.
    VITE_LICENSE_PUBKEY: optionalNonEmpty,

    // Build-baked URLs (§15)
    VITE_MODEL_MIRROR_BASE: optionalNonEmpty,
    VITE_APP_URL: optionalNonEmpty,

    // Lore (§8): 0 disables; unset ⇒ enabled. Embed dim default 384.
    VITE_LORE_ENABLED: z.preprocess(blankToUndefined, z.enum(["0", "1"]).optional()),
    VITE_LORE_EMBED_DIM: optionalPositiveInt,
  })
  .superRefine((env, ctx) => {
    // §9.1: the time gate has no default — mode=time demands VITE_TRIAL_DAYS.
    if (env.VITE_TRIAL_MODE === "time" && env.VITE_TRIAL_DAYS === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["VITE_TRIAL_DAYS"],
        message: "required when VITE_TRIAL_MODE=time",
      });
    }
  })
  .transform((env): RuntimeConfig => {
    const trial: TrialPolicy =
      env.VITE_TRIAL_MODE === "count"
        ? {
            mode: "count",
            readings: env.VITE_TRIAL_READINGS ?? DEFAULT_TRIAL_READINGS,
            trialModel: env.VITE_TRIAL_MODEL,
          }
        : env.VITE_TRIAL_MODE === "time"
          ? { mode: "time", days: env.VITE_TRIAL_DAYS!, trialModel: env.VITE_TRIAL_MODEL }
          : {
              mode: "rate",
              cooldownDays: env.VITE_TRIAL_RATE_COOLDOWN_DAYS ?? DEFAULT_TRIAL_COOLDOWN_DAYS,
              trialModel: env.VITE_TRIAL_MODEL,
            };

    return deepFreeze({
      trial,
      rails: {
        stripe: env.VITE_STRIPE_CHECKOUT_URL,
        revenuecat: env.VITE_REVENUECAT_WEB_SDK_KEY,
        polar: env.VITE_POLAR_CHECKOUT_URL,
        lemonsqueezy: env.VITE_LEMONSQUEEZY_CHECKOUT_URL,
        paypal: env.VITE_PAYPAL_CHECKOUT_URL,
        square: env.VITE_SQUARE_CHECKOUT_URL,
      },
      licenseBridgeUrl: env.VITE_LICENSE_BRIDGE_URL,
      licensePubkey: env.VITE_LICENSE_PUBKEY,
      modelMirrorBase: env.VITE_MODEL_MIRROR_BASE,
      appUrl: env.VITE_APP_URL,
      revenueCatOfferingId: env.VITE_REVENUECAT_OFFERING_ID,
      lore: {
        enabled: env.VITE_LORE_ENABLED !== "0",
        embedDim: env.VITE_LORE_EMBED_DIM ?? DEFAULT_LORE_EMBED_DIM,
      },
    });
  });

/** Recursively freeze an object graph; returns the same value, frozen. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      deepFreeze(record[key]);
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate an environment record into a frozen `RuntimeConfig`. Throws
 * `ConfigError` listing the offending variable names on any violation.
 */
export function loadConfig(env: EnvRecord): RuntimeConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => issue.path.join(".")));
  }
  return parsed.data;
}

/**
 * The paywall's honest "Ways to pay" readout (§9.4): adapter ids whose config
 * value is non-blank, in the canonical six-rail order. Blank rails are hidden.
 */
export function paymentsAvailable(config: RuntimeConfig): readonly PurchaseAdapterId[] {
  return deepFreeze(
    PAYMENT_RAIL_ORDER.filter((id) => {
      const value = config.rails[id];
      return value !== undefined && value.length > 0;
    }),
  );
}
