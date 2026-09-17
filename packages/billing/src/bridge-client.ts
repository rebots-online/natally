import type { LicenseToken, SignedDenyList } from "./types.js";

/**
 * B.5a — license bridge client (§9.4): `POST /verify {appUserId}` polling after a
 * hosted-redirect checkout, `POST /redeem {code}` for bridge-issued single-use codes.
 * Transport is injected (a parameter, not a mock): production passes a fetch-based
 * transport bound to the guarded bridge URL; tests inject an in-process router.
 * Offline tolerance: the poll loop keeps trying under a 15-minute cap with 2-second
 * backoff (x1.5 growth, capped at 30s), and every request is abortable.
 */

export interface BridgeTransport {
  post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<{ status: number; json: () => Promise<unknown> }>;
}

export interface VerifyResponse {
  token: LicenseToken | null;
  denyList?: SignedDenyList;
}

export interface RedeemResponse {
  valid: boolean;
  token?: LicenseToken;
  reason?: "invalid" | "already-used" | "expired";
}

export interface BridgeClientOptions {
  readonly transport: BridgeTransport;
  readonly poll?: {
    readonly intervalMs?: number;
    readonly growth?: number;
    readonly maxIntervalMs?: number;
    readonly capMs?: number;
  };
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly now?: () => number;
}

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function verifyOnce(
  transport: BridgeTransport,
  appUserId: string,
  signal?: AbortSignal,
): Promise<VerifyResponse> {
  const response = await transport.post("/verify", { appUserId }, signal);
  if (response.status !== 200)
    throw new BridgeError(`/verify failed (${response.status})`, response.status);
  const json = await response.json();
  if (!isRecord(json) || !("token" in json)) throw new BridgeError("/verify: malformed body", 200);
  const token = typeof json.token === "string" && json.token.length > 0 ? json.token : null;
  const denyList = isRecord(json.denyList)
    ? (json.denyList as unknown as SignedDenyList)
    : undefined;
  return { token, ...(denyList ? { denyList } : {}) };
}

export async function redeemOnce(
  transport: BridgeTransport,
  code: string,
  signal?: AbortSignal,
): Promise<RedeemResponse> {
  const response = await transport.post("/redeem", { code }, signal);
  if (response.status !== 200)
    throw new BridgeError(`/redeem failed (${response.status})`, response.status);
  const json = await response.json();
  if (!isRecord(json) || typeof json.valid !== "boolean") {
    throw new BridgeError("/redeem: malformed body", 200);
  }
  const result: RedeemResponse = { valid: json.valid };
  if (typeof json.token === "string") result.token = json.token;
  if (json.reason === "invalid" || json.reason === "already-used" || json.reason === "expired") {
    result.reason = json.reason;
  }
  return result;
}

/** Poll /verify until a token appears, the cap elapses, or the signal aborts. */
export async function pollForToken(
  options: BridgeClientOptions & { readonly appUserId: string; readonly signal?: AbortSignal },
): Promise<LicenseToken> {
  const { transport, appUserId, signal, poll = {}, sleep = defaultSleep, now = Date.now } = options;
  const intervalMs = poll.intervalMs ?? 2_000;
  const growth = poll.growth ?? 1.5;
  const maxIntervalMs = poll.maxIntervalMs ?? 30_000;
  const capMs = poll.capMs ?? 15 * 60_000;
  const deadline = now() + capMs;
  let delay = intervalMs;
  let networkFailures = 0;
  for (;;) {
    signal?.throwIfAborted();
    try {
      const result = await verifyOnce(transport, appUserId, signal);
      if (result.token) return result.token;
    } catch (error) {
      if (
        error instanceof BridgeError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429
      ) {
        throw error;
      }
      // Offline-tolerant: transport errors and 5xx/429 keep polling under the cap.
      networkFailures += 1;
      if (networkFailures > 200) throw error;
    }
    if (now() >= deadline) throw new BridgeError("verify poll exceeded its cap", 408);
    await sleep(Math.min(delay, maxIntervalMs), signal);
    delay = Math.min(delay * growth, maxIntervalMs);
  }
}
