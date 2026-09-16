// natally — generic hosted-redirect purchase adapter (ARCHITECTURE §9.4,
// TEST_RUBRIC TR-3/B.5a).
//
// One adapter shape for the five hosted-checkout rails (Stripe, Polar, Lemon
// Squeezy, PayPal, Square): `available()` is the honest `.env` readout; a
// checkout is a redirect to the configured processor URL carrying
// `?appUserId=<id>&offering=<id>`, opened through the injected opener
// (`window.open` on web, Tauri shell-open native — wired at I.3); a restore
// consults the license bridge (GET /verify) and returns a B.3-verified token
// or `null`. After the redirect, the app polls the bridge for the minted
// token via `createBridgeClient().poll()` — 2 s backoff, 15 min cap,
// offline-tolerant.
//
// Both configured URLs pass the §11 SSRF guard at construction; no processor
// secret ever reaches a client (the rail URL is a public checkout link).

import type {
  AppUserId,
  CheckoutSession,
  LicenseToken,
  Offering,
  PurchaseAdapter,
  PurchaseAdapterId,
} from "../types";
import { assertSafeUrl } from "../guards";
import { createBridgeClient, type TokenVerifier, type Transport } from "../bridge-client";

/** The five hosted-redirect rails (RevenueCat is its own adapter, elsewhere). */
export type HostedRail = Extract<
  PurchaseAdapterId,
  "stripe" | "polar" | "lemonsqueezy" | "paypal" | "square"
>;

export type HostedAdapterErrorReason = "not-configured";

export class HostedAdapterError extends Error {
  readonly reason: HostedAdapterErrorReason;

  constructor(reason: HostedAdapterErrorReason, rail: HostedRail) {
    super(
      `natally.billing: hosted rail "${rail}" is not configured (its checkout URL is blank in .env)`,
    );
    this.name = "HostedAdapterError";
    this.reason = reason;
  }
}

export interface HostedAdapterOptions {
  readonly rail: HostedRail;
  /** Processor checkout URL from `.env`; blank/undefined ⇒ the rail is hidden. */
  readonly configUrl: string | undefined;
  /** License bridge base URL from `.env` (restore + post-checkout polling). */
  readonly bridgeUrl: string;
  /** This install's stable app user id (carried on the redirect URL). */
  readonly appUserId: AppUserId;
  /** Opens the hosted page: `window.open` (web) / Tauri shell-open (native). */
  readonly opener: (url: string) => void;
  readonly transport: Transport;
  readonly verifyToken: TokenVerifier;
  /** Passed through to the embedded bridge client (tests shorten both). */
  readonly pollIntervalMs?: number;
  readonly pollCapMs?: number;
  /** Guard relief for loopback http URLs (tests / local dev only). */
  readonly allowHttpLoopback?: boolean;
}

export function createHostedAdapter(options: HostedAdapterOptions): PurchaseAdapter {
  const configUrl = options.configUrl;
  const configured = configUrl !== undefined && configUrl.length > 0;
  // Fail fast on unsafe configuration — a blank URL is fine (rail hidden),
  // an unsafe one is a construction-time rejection, never a runtime surprise.
  if (configUrl !== undefined && configUrl.length > 0) {
    assertSafeUrl(configUrl, { allowHttpLoopback: options.allowHttpLoopback });
  }
  assertSafeUrl(options.bridgeUrl, { allowHttpLoopback: options.allowHttpLoopback });

  const bridge = createBridgeClient({
    bridgeUrl: options.bridgeUrl,
    transport: options.transport,
    verifyToken: options.verifyToken,
    pollIntervalMs: options.pollIntervalMs,
    pollCapMs: options.pollCapMs,
    allowHttpLoopback: options.allowHttpLoopback,
  });

  return {
    id: options.rail,

    available(): boolean {
      return configured;
    },

    async checkout(offering: Offering): Promise<CheckoutSession> {
      if (!configured || configUrl === undefined) {
        throw new HostedAdapterError("not-configured", options.rail);
      }
      const url = assertSafeUrl(configUrl, { allowHttpLoopback: options.allowHttpLoopback });
      url.searchParams.set("appUserId", options.appUserId);
      url.searchParams.set("offering", offering.id);
      const redirect = url.toString();
      options.opener(redirect);
      return { kind: "redirect", url: redirect, offering };
    },

    restore(account: AppUserId): Promise<LicenseToken | null> {
      return bridge.restore(account);
    },
  };
}
