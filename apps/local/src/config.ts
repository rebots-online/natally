/// <reference types="vite/client" />

import { loadConfig, type RuntimeConfig } from "../../../packages/billing/src/config.js";

export type { RuntimeConfig } from "../../../packages/billing/src/config.js";
export { paymentsAvailable } from "../../../packages/billing/src/config.js";

export type BrowserRuntimeConfig = Omit<RuntimeConfig, "devPort">;

/** Call inside the app's error boundary; importing this module never parses configuration. */
export function loadRuntimeConfig(): BrowserRuntimeConfig {
  return loadConfig({
    VITE_APP_NAME: import.meta.env.VITE_APP_NAME,
    VITE_APP_ID: import.meta.env.VITE_APP_ID,
    VITE_APP_SLUG: import.meta.env.VITE_APP_SLUG,
    VITE_MODEL_MIRROR_BASE: import.meta.env.VITE_MODEL_MIRROR_BASE,
    VITE_APP_URL: import.meta.env.VITE_APP_URL,
    VITE_LANDING_URL: import.meta.env.VITE_LANDING_URL,
    VITE_TRIAL_MODE: import.meta.env.VITE_TRIAL_MODE,
    VITE_TRIAL_READINGS: import.meta.env.VITE_TRIAL_READINGS,
    VITE_TRIAL_DAYS: import.meta.env.VITE_TRIAL_DAYS,
    VITE_TRIAL_RATE_COOLDOWN_DAYS: import.meta.env.VITE_TRIAL_RATE_COOLDOWN_DAYS,
    VITE_TRIAL_MODEL: import.meta.env.VITE_TRIAL_MODEL,
    VITE_LICENSE_BRIDGE_URL: import.meta.env.VITE_LICENSE_BRIDGE_URL,
    VITE_STRIPE_CHECKOUT_URL: import.meta.env.VITE_STRIPE_CHECKOUT_URL,
    VITE_REVENUECAT_WEB_SDK_KEY: import.meta.env.VITE_REVENUECAT_WEB_SDK_KEY,
    VITE_REVENUECAT_OFFERING_ID: import.meta.env.VITE_REVENUECAT_OFFERING_ID,
    VITE_POLAR_CHECKOUT_URL: import.meta.env.VITE_POLAR_CHECKOUT_URL,
    VITE_LEMONSQUEEZY_CHECKOUT_URL: import.meta.env.VITE_LEMONSQUEEZY_CHECKOUT_URL,
    VITE_PAYPAL_CHECKOUT_URL: import.meta.env.VITE_PAYPAL_CHECKOUT_URL,
    VITE_SQUARE_CHECKOUT_URL: import.meta.env.VITE_SQUARE_CHECKOUT_URL,
    VITE_LORE_ENABLED: import.meta.env.VITE_LORE_ENABLED,
    VITE_LORE_EMBED_DIM: import.meta.env.VITE_LORE_EMBED_DIM,
    VITE_LICENSE_PUBKEY: import.meta.env.VITE_LICENSE_PUBKEY,
  });
}
