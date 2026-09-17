import type { BridgeTransport } from "../bridge-client.js";
import type { CheckoutSession, LicenseToken, Offering, PurchaseAdapter } from "../types.js";

/**
 * B.5b — RevenueCat web adapter (§9.4). RC is the registry: entitlement truth lives
 * there, and the bridge converts an entitlement into a durable LicenseToken via
 * `/mint` (the bridge re-verifies the purchase against RC REST v2 with its own
 * secret — the client never holds it). The RC SDK surface is injected as a
 * constructor parameter; tests pass an in-process fake, production passes the
 * `@revenuecat/purchases-js` instance built with `VITE_REVENUECAT_WEB_SDK_KEY`.
 */

export interface RevenueCatSdk {
  /** Web SDK paywall presentation; resolves when the sheet closes. */
  presentPaywall(offeringId: string): Promise<void>;
  /** True when the `unlimited` entitlement is active for this app user. */
  hasEntitlement(entitlementId: string): Promise<boolean>;
  /** The purchase id backing the active entitlement (RC REST purchase id). */
  activePurchaseId(entitlementId: string): Promise<string | null>;
  /** Sign-in/sync for restore flows. */
  restore(appUserId: string): Promise<void>;
}

export interface RevenueCatAdapterOptions {
  readonly sdk: RevenueCatSdk;
  readonly transport: BridgeTransport;
  readonly appUserId: string;
  readonly offeringId?: string;
  readonly entitlementId?: string;
  readonly signal?: AbortSignal;
}

interface MintResponse {
  token?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function mintToken(
  transport: BridgeTransport,
  appUserId: string,
  purchaseRef: string,
  signal?: AbortSignal,
): Promise<LicenseToken> {
  const response = await transport.post("/mint", { appUserId, purchaseRef }, signal);
  if (response.status !== 200) {
    throw new Error(`/mint failed (${response.status})`);
  }
  const json = (await response.json()) as MintResponse;
  if (!isRecord(json) || typeof json.token !== "string" || json.token.length === 0) {
    throw new Error("/mint: no token in response");
  }
  return json.token;
}

export function createRevenueCatAdapter(options: RevenueCatAdapterOptions): PurchaseAdapter {
  const offeringId = options.offeringId ?? "natally_default";
  const entitlementId = options.entitlementId ?? "unlimited";
  return {
    id: "revenuecat",
    available: () => true,
    async checkout(offering: Offering): Promise<CheckoutSession> {
      await options.sdk.presentPaywall(offering.id === offeringId ? offeringId : offering.id);
      // Entitlement may already be active after a successful sheet flow.
      if (await options.sdk.hasEntitlement(entitlementId)) {
        const purchaseRef = await options.sdk.activePurchaseId(entitlementId);
        if (purchaseRef)
          await mintToken(options.transport, options.appUserId, purchaseRef, options.signal);
      }
      return { kind: "rc", offering };
    },
    async restore(account: string): Promise<LicenseToken | null> {
      await options.sdk.restore(account);
      if (!(await options.sdk.hasEntitlement(entitlementId))) return null;
      const purchaseRef = await options.sdk.activePurchaseId(entitlementId);
      if (!purchaseRef) return null;
      return mintToken(options.transport, options.appUserId, purchaseRef, options.signal);
    },
  };
}
