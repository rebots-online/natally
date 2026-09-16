// natally — license bridge client (ARCHITECTURE §9.4, §11; TEST_RUBRIC
// TR-3/B.5a).
//
// The bridge is the operator-hosted service that receives processor webhooks
// and mints LicenseTokens. The client does exactly two things:
//
//   poll(appUserId)    POST /verify {appUserId} every `pollIntervalMs`
//                      (default 2 s), capped at `pollCapMs` (default 15 min).
//                      Offline-tolerant: transport failures and non-2xx
//                      responses keep the loop alive; when the cap elapses the
//                      honest answer is `null`.
//   restore(appUserId) GET /verify?appUserId= — one shot, `null` on any
//                      absence, token on a verified response.
//
// §11 hard rule: a response body is never trusted alone. Every non-null token
// a bridge response presents is verified (B.3 `verifyToken`, Ed25519 over the
// build-baked public key) before it leaves this module; an unverifiable token
// is treated as no license at all and surfaced as a typed `BridgeError`.
//
// The transport is an injected parameter, not a mock: the real implementation
// is `createFetchTransport()` (plain `fetch`); tests inject a plain function.

import type { AppUserId, LicenseToken } from "./types";
import type { VerifyTokenResult } from "./token/verify-web";
import { assertSafeUrl } from "./guards";

/** Verifier seam (B.3): the wiring binds the baked public key + deny-list; the appUserId is passed per call so `sub` is checked against the account actually polled. */
export type TokenVerifier = (
  token: string,
  appUserId: AppUserId,
) => Promise<VerifyTokenResult>;

/** The transport boundary: method + optional JSON body in, status + raw body out. */
export interface TransportRequest {
  readonly method: "GET" | "POST";
  readonly body?: string;
}

export interface TransportResponse {
  readonly status: number;
  readonly body: string;
}

export type Transport = (
  url: string,
  request: TransportRequest,
) => Promise<TransportResponse>;

/** Real transport: plain `fetch` (injectable `fetchImpl` for exotic runtimes). */
export function createFetchTransport(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Transport {
  return async (url, request) => {
    const response = await fetchImpl(url, {
      method: request.method,
      headers: request.body === undefined ? undefined : { "content-type": "application/json" },
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    return { status: response.status, body: await response.text() };
  };
}

export type BridgeErrorReason = "unverifiable";

/** A bridge response presented a token that failed verification (§11). */
export class BridgeError extends Error {
  readonly reason: BridgeErrorReason;

  constructor(reason: BridgeErrorReason, detail: string) {
    super(`natally.billing: license bridge ${reason}: ${detail}`);
    this.name = "BridgeError";
    this.reason = reason;
  }
}

/** Default backoff between verify polls: 2 s (TR-3/B.5a). */
export const POLL_INTERVAL_MS = 2000;
/** Default poll cap: 15 minutes, after which the honest answer is `null`. */
export const POLL_CAP_MS = 15 * 60 * 1000;

export interface BridgeClientOptions {
  readonly bridgeUrl: string;
  readonly transport: Transport;
  readonly verifyToken: TokenVerifier;
  /** Backoff between polls. Default 2 s; shortened by tests. */
  readonly pollIntervalMs?: number;
  /** Total polling budget. Default 15 min; shortened by tests. */
  readonly pollCapMs?: number;
  /** Guard relief for loopback http bridges (tests / local dev only). */
  readonly allowHttpLoopback?: boolean;
}

export interface BridgeClient {
  /** POST /verify loop until a verified token or the cap (⇒ `null`). */
  poll(appUserId: AppUserId): Promise<LicenseToken | null>;
  /** GET /verify once: verified token, or `null` (honest absence). */
  restore(appUserId: AppUserId): Promise<LicenseToken | null>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `200`-range check only; anything else is treated as "not licensed yet". */
function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Extract the token a bridge response presents. The body is `{token}` JSON;
 * anything else — unparsable, wrong shape, empty token — is "no token yet",
 * never an error and never trusted.
 */
function extractToken(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "token" in parsed) {
      const token = (parsed as Record<string, unknown>).token;
      if (typeof token === "string" && token.length > 0) return token;
    }
  } catch {
    // Body was not JSON: treated as "no token yet".
  }
  return null;
}

export function createBridgeClient(options: BridgeClientOptions): BridgeClient {
  // Trailing slashes normalized, any path prefix preserved (`…/api` + `/verify`).
  const base = options.bridgeUrl.replace(/\/+$/, "");
  assertSafeUrl(base, { allowHttpLoopback: options.allowHttpLoopback });
  const verifyEndpoint = `${base}/verify`;

  async function trusted(token: string, appUserId: AppUserId): Promise<LicenseToken> {
    const result = await options.verifyToken(token, appUserId);
    if (!result.ok) {
      throw new BridgeError("unverifiable", `token rejected by verify (${result.reason})`);
    }
    return token as LicenseToken;
  }

  return {
    async poll(appUserId: AppUserId): Promise<LicenseToken | null> {
      const intervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
      const capMs = options.pollCapMs ?? POLL_CAP_MS;
      const startedAt = Date.now();
      for (;;) {
        let response: TransportResponse | null = null;
        try {
          response = await options.transport(verifyEndpoint, {
            method: "POST",
            body: JSON.stringify({ appUserId }),
          });
        } catch {
          // Offline: tolerated — keep polling until the cap.
        }
        if (response !== null && isOk(response.status)) {
          const token = extractToken(response.body);
          if (token !== null) return await trusted(token, appUserId);
        }
        if (Date.now() - startedAt >= capMs) return null;
        await sleep(intervalMs);
      }
    },

    async restore(appUserId: AppUserId): Promise<LicenseToken | null> {
      const url = `${verifyEndpoint}?appUserId=${encodeURIComponent(appUserId)}`;
      let response: TransportResponse;
      try {
        response = await options.transport(url, { method: "GET" });
      } catch {
        return null; // offline: honest absence, not an error
      }
      if (!isOk(response.status)) return null;
      const token = extractToken(response.body);
      if (token === null) return null;
      // A presented token is verified before it leaves this module (§11);
      // an unverifiable one throws `BridgeError`, never a trusted token.
      return await trusted(token, appUserId);
    },
  };
}
