// natally — RevenueCat purchase adapter (ARCHITECTURE §9.4, TEST_RUBRIC
// TR-3/B.5b).
//
// The web/PWA + Android leg of §9.4: RevenueCat is the purchase registry; the
// license bridge is the token authority. Flow, exactly one direction:
//
//   checkout(offering)  present the RC paywall for the configured offering id
//                       (default `natally_default`), then poll the SDK's
//                       customer info until the `unlimited` entitlement carries
//                       a purchase id (2 s interval, 15 min cap — the paywall
//                       resolves on dismissal, the poll covers the purchase).
//                       Entitlement present ⇒ bridge mint with the RC purchase
//                       id (the bridge re-checks the purchase against RC REST
//                       v2 with its server secret) ⇒ the presented token is
//                       verified with the real B.3 offline verifier before it
//                       leaves this module (§11: never trusted by provenance
//                       alone) ⇒ delivered through `onToken`; the returned
//                       session is `{kind:'rc', offering}`. Honest failures are
//                       typed, never fake successes: no entitlement ⇒
//                       `not-unlocked`; bridge could not mint ⇒ `mint-failed`;
//                       minted-but-unverifiable ⇒ `BridgeError('unverifiable')`
//                       (shared with B.5a — same §11 semantics).
//   restore(account)    RC restore ⇒ same entitlement → mint → verify chain,
//                       returned directly (`null` on honest absence — no
//                       entitlement, restore failure, or no mint; an
//                       unverifiable mint still throws `BridgeError`).
//
// Dependency seams (no new package dependencies):
// - The RC web SDK (`@revenuecat/purchases-js`) is NOT added here: a minimal
//   structural handle (`RevenueCatHandle`, typed from its documented public
//   surface) is an injected parameter. I-phase wiring constructs the real
//   handle — `Purchases.configure({ apiKey: VITE_REVENUECAT_WEB_SDK_KEY,
//   appUserId })` — and injects it; this adapter holds the same `sdkKey` value
//   only for the honest `available()` readout.
// - `bridge-client.ts` (B.5a) exposes only `/verify` (poll/restore); it is not
//   extended here (not this task's file). The mint call is therefore an
//   injected `BridgeMint` — I-phase wiring binds it to the bridge's
//   `POST /mint {appUserId, purchaseRef}`.
// - The frozen `CheckoutSession` carries no token, so checkout's verified
//   token leaves through the injected `onToken`; I-phase wiring binds token
//   storage (`token/storage-web.ts` / keychain). `onToken` is required so a
//   wiring omission fails at construction instead of silently dropping a
//   verified license.

import type {
  AppUserId,
  CheckoutSession,
  LicenseToken,
  Offering,
  PurchaseAdapter,
} from "../types";
import { BridgeError, type TokenVerifier } from "../bridge-client";

// ---------------------------------------------------------------------------
// Structural handle over the RC web SDK (injected, never imported)
// ---------------------------------------------------------------------------

/** One RC entitlement as the SDK's customer info presents it (structural subset). */
export interface RevenueCatEntitlement {
  readonly latestPurchaseId?: string;
}

/**
 * Structural subset of the RC web SDK's customer info: the §9.4 flow reads
 * only `entitlements["unlimited"].latestPurchaseId`. The real SDK object
 * satisfies this shape; tests inject a plain object.
 */
export interface RevenueCatCustomerInfo {
  readonly entitlements: Readonly<Record<string, RevenueCatEntitlement>>;
}

/**
 * Minimal structural handle over `@revenuecat/purchases-js`'s documented
 * public surface — exactly the pieces the §9.4 flow needs. The real handle is
 * constructed and injected by I-phase wiring; nothing here imports the SDK.
 */
export interface RevenueCatHandle {
  /** Presents the RC paywall for `offeringId`; resolves when it is dismissed/completed. */
  presentPaywall(offeringId: string): Promise<unknown>;
  /** Current customer info (re-fetched from the registry). */
  getCustomerInfo(): Promise<RevenueCatCustomerInfo>;
  /** RC restore: re-syncs purchases from the registry and resolves with fresh info. */
  restore(): Promise<RevenueCatCustomerInfo>;
}

/**
 * The bridge mint call (§9.4): `POST /mint {appUserId, purchaseRef}` on the
 * license bridge. Not part of `bridge-client.ts` (B.5a ships only `/verify`);
 * I-phase wiring binds this function to the bridge client's mint call.
 * `null` is the honest "recognized purchase, no token yet" (webhook lag).
 */
export type BridgeMint = (purchaseRef: string) => Promise<LicenseToken | null>;

// ---------------------------------------------------------------------------
// Typed failures (honest absence, no fake successes — INC-19 discipline)
// ---------------------------------------------------------------------------

export type RevenueCatAdapterErrorReason = "not-configured" | "not-unlocked" | "mint-failed";

export class RevenueCatAdapterError extends Error {
  readonly reason: RevenueCatAdapterErrorReason;

  constructor(reason: RevenueCatAdapterErrorReason, detail: string) {
    super(`natally.billing: revenuecat rail ${reason}: ${detail}`);
    this.name = "RevenueCatAdapterError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Config constants (§9.4 / §15)
// ---------------------------------------------------------------------------

/** The single paid tier's RC entitlement id (`tier: "unlimited"`, §9.3/§9.4). */
export const RC_ENTITLEMENT_ID = "unlimited";
/** Default RC offering id when `VITE_REVENUECAT_OFFERING_ID` is blank. */
export const DEFAULT_OFFERING_ID = "natally_default";
/** Backoff between entitlement polls (mirrors the B.5a bridge poll rhythm). */
export const ENTITLEMENT_POLL_INTERVAL_MS = 2000;
/** Entitlement poll cap: after this the honest answer is "not unlocked". */
export const ENTITLEMENT_POLL_CAP_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface RevenueCatAdapterOptions {
  /** `VITE_REVENUECAT_WEB_SDK_KEY`; blank/undefined ⇒ rail hidden (`available()` false). */
  readonly sdkKey: string | undefined;
  /** This install's stable app user id (§9.3) — the SDK handle is configured for it. */
  readonly appUserId: AppUserId;
  /** RC offering id presented by the paywall. Default `natally_default`. */
  readonly offeringId?: string;
  /** Injected structural RC handle (I-phase wiring; tests inject a plain object). */
  readonly purchases: RevenueCatHandle;
  /** Injected bridge mint (`POST /mint {appUserId, purchaseRef}`; see `BridgeMint`). */
  readonly bridgeMint: BridgeMint;
  /** Real B.3 offline verifier; the minted token is verified before delivery (§11). */
  readonly verifyToken: TokenVerifier;
  /**
   * Required sink for checkout's verified token — the frozen `CheckoutSession`
   * carries no token field. I-phase wiring binds token storage
   * (`token/storage-web.ts` / keychain) here.
   */
  readonly onToken: (token: LicenseToken) => void;
  /** Backoff between entitlement polls. Default 2 s; shortened by tests. */
  readonly entitlementPollIntervalMs?: number;
  /** Total entitlement poll budget. Default 15 min; shortened by tests. */
  readonly entitlementPollCapMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll the SDK's customer info until the `unlimited` entitlement carries a
 * usable purchase id; `null` at the cap. Snapshot/transport failures
 * (offline, SDK hiccup) are tolerated — polling continues until the cap. An
 * entitlement without a purchase id is treated as an incomplete snapshot and
 * polled over, never minted from.
 */
async function waitForUnlimitedPurchaseId(
  purchases: RevenueCatHandle,
  intervalMs: number,
  capMs: number,
): Promise<string | null> {
  const startedAt = Date.now();
  for (;;) {
    try {
      const info = await purchases.getCustomerInfo();
      const purchaseId = info.entitlements[RC_ENTITLEMENT_ID]?.latestPurchaseId;
      if (typeof purchaseId === "string" && purchaseId.length > 0) return purchaseId;
    } catch {
      // Offline / SDK hiccup: tolerated — keep polling until the cap.
    }
    if (Date.now() - startedAt >= capMs) return null;
    await sleep(intervalMs);
  }
}

/** §11: a minted token is verified before it leaves this module. */
async function verifiedToken(
  token: string,
  verifyToken: TokenVerifier,
  account: AppUserId,
): Promise<LicenseToken> {
  const result = await verifyToken(token, account);
  if (!result.ok) {
    throw new BridgeError("unverifiable", `minted token rejected by verify (${result.reason})`);
  }
  return token as LicenseToken;
}

export function createRevenueCatAdapter(options: RevenueCatAdapterOptions): PurchaseAdapter {
  const configured = options.sdkKey !== undefined && options.sdkKey.length > 0;
  const offeringId = options.offeringId ?? DEFAULT_OFFERING_ID;
  const intervalMs = options.entitlementPollIntervalMs ?? ENTITLEMENT_POLL_INTERVAL_MS;
  const capMs = options.entitlementPollCapMs ?? ENTITLEMENT_POLL_CAP_MS;

  /** Entitlement → bridge mint → verified token. Absence and forgery are typed. */
  async function mintAndVerify(
    purchaseRef: string,
    account: AppUserId,
  ): Promise<LicenseToken> {
    const minted = await options.bridgeMint(purchaseRef);
    if (minted === null || minted.length === 0) {
      throw new RevenueCatAdapterError(
        "mint-failed",
        `bridge returned no token for RC purchase ${purchaseRef} (webhook lag or offline — retry or restore)`,
      );
    }
    return verifiedToken(minted, options.verifyToken, account);
  }

  return {
    id: "revenuecat",

    available(): boolean {
      return configured;
    },

    async checkout(offering: Offering): Promise<CheckoutSession> {
      if (!configured) {
        throw new RevenueCatAdapterError(
          "not-configured",
          "VITE_REVENUECAT_WEB_SDK_KEY is blank — the rail is hidden",
        );
      }
      await options.purchases.presentPaywall(offeringId);
      const purchaseRef = await waitForUnlimitedPurchaseId(options.purchases, intervalMs, capMs);
      if (purchaseRef === null) {
        throw new RevenueCatAdapterError(
          "not-unlocked",
          `no "${RC_ENTITLEMENT_ID}" entitlement with a purchase id after the paywall (poll cap ${capMs} ms)`,
        );
      }
      const token = await mintAndVerify(purchaseRef, options.appUserId);
      options.onToken(token);
      return { kind: "rc", offering };
    },

    async restore(account: AppUserId): Promise<LicenseToken | null> {
      if (!configured) return null; // honest absence: no registry configured to restore against
      let info: RevenueCatCustomerInfo;
      try {
        info = await options.purchases.restore();
      } catch {
        return null; // offline / registry failure: honest absence, never a fake success
      }
      const purchaseRef = info.entitlements[RC_ENTITLEMENT_ID]?.latestPurchaseId;
      if (typeof purchaseRef !== "string" || purchaseRef.length === 0) return null;
      // Mint absence here is honest `null` (entitlement at the registry, no
      // token minted yet) — only checkout, mid-flow, raises typed `mint-failed`.
      const minted = await options.bridgeMint(purchaseRef);
      if (minted === null || minted.length === 0) return null;
      return await verifiedToken(minted, options.verifyToken, account);
    },
  };
}
