import { z } from "zod";
import { type PurchaseAdapterId, PurchaseAdapterIdSchema, type TrialPolicy } from "./types.js";

const text = z.string().trim().min(1);
const httpsUrl = text.pipe(z.url({ protocol: /^https$/ })).refine((value) => {
  try {
    const url = new URL(value);
    return url.username === "" && url.password === "";
  } catch {
    return false;
  }
}, "URL must not contain credentials");
/**
 * Mirror base: https in production; http is permitted only on loopback hosts, matching
 * MirrorNetwork's own rule (manifest.ts checkedURL) so local dev mirrors and the M.1
 * fixture servers validate without weakening the production posture.
 */
const mirrorBaseUrl = text.pipe(z.url({ protocol: /^https?$/ })).refine((value) => {
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") return false;
    if (url.protocol === "https:") return true;
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}, "Mirror base must be https, or http on a loopback host, without credentials");
const positiveInteger = text
  .regex(/^[1-9]\d*$/, "Expected a positive decimal integer")
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

/** Empty optional settings mean absence; they never become zero or false by coercion. */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema.optional(),
  );
}

const trialFields = {
  count: "VITE_TRIAL_READINGS",
  time: "VITE_TRIAL_DAYS",
  rate: "VITE_TRIAL_RATE_COOLDOWN_DAYS",
} as const;

// This allowlist deliberately strips script/server secrets and unrelated environment values.
// Defaults belong exclusively to .env.example, including branding and the development port.
const envSchema = z
  .object({
    VITE_APP_NAME: text,
    VITE_APP_ID: text.regex(
      /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/,
      "Expected a reverse-DNS application namespace",
    ),
    VITE_APP_SLUG: text.regex(
      /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
      "Expected a lowercase artifact basename without paths",
    ),
    VITE_MODEL_MIRROR_BASE: mirrorBaseUrl,
    VITE_APP_URL: httpsUrl,
    VITE_LANDING_URL: httpsUrl,
    // Vite's Node configuration can supply this; public import.meta.env omits it.
    NATALLY_DEV_PORT: optional(positiveInteger.pipe(z.number().min(1024).max(65535))),
    VITE_TRIAL_MODE: z.enum(["count", "time", "rate"]),
    VITE_TRIAL_READINGS: optional(positiveInteger),
    VITE_TRIAL_DAYS: optional(positiveInteger),
    VITE_TRIAL_RATE_COOLDOWN_DAYS: optional(positiveInteger),
    VITE_TRIAL_MODEL: text,
    VITE_LICENSE_BRIDGE_URL: optional(httpsUrl),
    VITE_STRIPE_CHECKOUT_URL: optional(httpsUrl),
    VITE_REVENUECAT_WEB_SDK_KEY: optional(text),
    VITE_REVENUECAT_OFFERING_ID: text,
    VITE_POLAR_CHECKOUT_URL: optional(httpsUrl),
    VITE_LEMONSQUEEZY_CHECKOUT_URL: optional(httpsUrl),
    VITE_PAYPAL_CHECKOUT_URL: optional(httpsUrl),
    VITE_SQUARE_CHECKOUT_URL: optional(httpsUrl),
    VITE_LORE_ENABLED: z.enum(["0", "1"]).transform((value) => value === "1"),
    VITE_LORE_EMBED_DIM: positiveInteger,
    // Key decoding/signature verification is owned by licensing, not configuration.
    VITE_LICENSE_PUBKEY: optional(text),
  })
  .superRefine((env, context) => {
    const activeField = trialFields[env.VITE_TRIAL_MODE];
    for (const field of Object.values(trialFields)) {
      if (field === activeField && env[field] === undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `Required for VITE_TRIAL_MODE=${env.VITE_TRIAL_MODE}`,
        });
      } else if (field !== activeField && env[field] !== undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `Must be blank for VITE_TRIAL_MODE=${env.VITE_TRIAL_MODE}`,
        });
      }
    }
  });

export interface RuntimeConfig {
  readonly appName: string;
  readonly appId: string;
  readonly appSlug: string;
  readonly modelMirrorBase: string;
  readonly appUrl: string;
  readonly landingUrl: string;
  /** Script-side input only; absent from the browser runtime configuration. */
  readonly devPort?: number;
  readonly trial: Readonly<TrialPolicy>;
  readonly licenseBridgeUrl: string | undefined;
  readonly payments: Readonly<Record<PurchaseAdapterId, string | undefined>>;
  readonly revenueCatOfferingId: string;
  readonly loreEnabled: boolean;
  readonly loreEmbedDim: number;
  readonly licensePubkey: string | undefined;
}

/** Parse at the app boundary so an invalid build can display a configuration error. */
export function loadConfig(env: Readonly<Record<string, unknown>>): RuntimeConfig {
  const values = envSchema.parse(env);
  const trial: Readonly<TrialPolicy> = Object.freeze({
    mode: values.VITE_TRIAL_MODE,
    trialModel: values.VITE_TRIAL_MODEL,
    ...(values.VITE_TRIAL_READINGS === undefined ? {} : { readings: values.VITE_TRIAL_READINGS }),
    ...(values.VITE_TRIAL_DAYS === undefined ? {} : { days: values.VITE_TRIAL_DAYS }),
    ...(values.VITE_TRIAL_RATE_COOLDOWN_DAYS === undefined
      ? {}
      : { cooldownDays: values.VITE_TRIAL_RATE_COOLDOWN_DAYS }),
  });

  return Object.freeze({
    appName: values.VITE_APP_NAME,
    appId: values.VITE_APP_ID,
    appSlug: values.VITE_APP_SLUG,
    modelMirrorBase: values.VITE_MODEL_MIRROR_BASE,
    appUrl: values.VITE_APP_URL,
    landingUrl: values.VITE_LANDING_URL,
    ...(values.NATALLY_DEV_PORT === undefined ? {} : { devPort: values.NATALLY_DEV_PORT }),
    trial,
    licenseBridgeUrl: values.VITE_LICENSE_BRIDGE_URL,
    payments: Object.freeze({
      stripe: values.VITE_STRIPE_CHECKOUT_URL,
      revenuecat: values.VITE_REVENUECAT_WEB_SDK_KEY,
      polar: values.VITE_POLAR_CHECKOUT_URL,
      lemonsqueezy: values.VITE_LEMONSQUEEZY_CHECKOUT_URL,
      paypal: values.VITE_PAYPAL_CHECKOUT_URL,
      square: values.VITE_SQUARE_CHECKOUT_URL,
    }),
    revenueCatOfferingId: values.VITE_REVENUECAT_OFFERING_ID,
    loreEnabled: values.VITE_LORE_ENABLED,
    loreEmbedDim: values.VITE_LORE_EMBED_DIM,
    licensePubkey: values.VITE_LICENSE_PUBKEY,
  });
}

/** Availability follows the billing ID vocabulary and each rail's configured value. */
export function paymentsAvailable(config: RuntimeConfig): readonly PurchaseAdapterId[] {
  return Object.freeze(
    PurchaseAdapterIdSchema.options.filter((id) => config.payments[id] !== undefined),
  );
}
