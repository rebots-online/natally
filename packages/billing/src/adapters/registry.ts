import { type CodeOutcome, type ConsumedCodeLedger, redeemCode } from "../codes.js";
import type {
  CheckoutSession,
  LicenseToken,
  Offering,
  PurchaseAdapter,
  PurchaseAdapterId,
} from "../types.js";

/**
 * B.5c — the adapter registry (§9.4). Order-stable over the constructed adapters:
 * whatever order the app registers rails in, `paymentsAvailable()` reports them in
 * the frozen PurchaseAdapterId order so the paywall's "Ways to pay" line never
 * shuffles between builds. `purchase(adapterId, offering)` dispatches to exactly
 * one adapter; `redeem(code)` routes through B.4's four-outcome verification.
 */

export interface AdapterRegistry {
  /** Present rails in frozen id order — the honest availability readout. */
  paymentsAvailable(): readonly PurchaseAdapterId[];
  purchase(adapterId: PurchaseAdapterId, offering: Offering): Promise<CheckoutSession>;
  redeem(code: string): Promise<CodeOutcome>;
  /** The adapter behind an id, or undefined — never a fabricated rail. */
  get(adapterId: PurchaseAdapterId): PurchaseAdapter | undefined;
}

export interface RegistryCodeDeps {
  readonly publicKey: string;
  sha256Hex(text: string): Promise<string>;
  verifyEd25519(message: string, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean>;
  readonly ledger: ConsumedCodeLedger;
  readonly now?: () => number;
}

export interface RegistryOptions {
  /** Constructed B.5a/B.5b adapters in any order; duplicates are an error. */
  readonly adapters: readonly PurchaseAdapter[];
  /** B.4 verify dependencies for redeem(). */
  codeDeps: RegistryCodeDeps;
}

const FROZEN_ORDER = Object.freeze([
  "stripe",
  "revenuecat",
  "polar",
  "lemonsqueezy",
  "paypal",
  "square",
] as const satisfies readonly PurchaseAdapterId[]);

export function createAdapterRegistry(options: RegistryOptions): AdapterRegistry {
  const byId = new Map<PurchaseAdapterId, PurchaseAdapter>();
  for (const adapter of options.adapters) {
    if (byId.has(adapter.id)) throw new Error(`Duplicate adapter registration: ${adapter.id}`);
    byId.set(adapter.id, adapter);
  }
  const present = FROZEN_ORDER.filter((id) => byId.get(id)?.available() === true);

  return Object.freeze({
    paymentsAvailable: () => Object.freeze([...present]),
    get: (adapterId: PurchaseAdapterId) => byId.get(adapterId),
    async purchase(adapterId: PurchaseAdapterId, offering: Offering) {
      const adapter = byId.get(adapterId);
      if (!adapter) throw new Error(`Unknown payment adapter: ${adapterId}`);
      if (!adapter.available()) throw new Error(`${adapterId}: rail is not available`);
      return adapter.checkout(offering);
    },
    redeem: (code: string) => redeemCode(code, options.codeDeps),
  });
}

/** Convenience for paywall copy: the ids rendered as the honest processor line. */
export function waysToPayLine(ids: readonly PurchaseAdapterId[]): string {
  return ids.length === 0 ? "none configured" : ids.join(" · ");
}

export type { LicenseToken };
