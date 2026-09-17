import type { CheckoutSession, Offering, PurchaseAdapter } from "../types.js";
import { assertPublicHttpsCheckoutUrl } from "./guards.js";

/**
 * B.5a — the generic hosted-redirect adapter over the five processor URL rails
 * (stripe / polar / lemonsqueezy / paypal / square, §9.4). Presence is the honest
 * readout: a rail with no configured URL is unavailable and never guessed.
 * `opener` is injected (Tauri shell-open / window.open) — the adapter opens URLs,
 * it never fetches them; the poll loop lives in the bridge client.
 */
export type Opener = (url: string) => void | Promise<void>;

export interface HostedAdapterConfig {
  readonly id: "stripe" | "polar" | "lemonsqueezy" | "paypal" | "square";
  readonly checkoutUrl: string | undefined;
  readonly appUserId: string;
}

export function createHostedAdapter(config: HostedAdapterConfig, opener: Opener): PurchaseAdapter {
  return {
    id: config.id,
    available: () => typeof config.checkoutUrl === "string" && config.checkoutUrl.trim().length > 0,
    async checkout(offering: Offering): Promise<CheckoutSession> {
      if (!config.checkoutUrl) throw new Error(`${config.id}: checkout URL is not configured`);
      const base = assertPublicHttpsCheckoutUrl(config.checkoutUrl);
      base.searchParams.set("appUserId", config.appUserId);
      base.searchParams.set("offering", offering.id);
      const url = base.href;
      await opener(url);
      return { kind: "redirect", url, offering };
    },
    async restore(_account: string): Promise<null> {
      // Hosted rails restore through the bridge /verify poll, not the processor.
      void _account;
      return null;
    },
  };
}
