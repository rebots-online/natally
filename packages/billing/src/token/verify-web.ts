import type { AppUserId, DenyList, LicenseToken, SignedDenyList } from "../types.js";
import {
  DENY_LIST_MAX_AGE,
  decodeBase64Url,
  denyListSigningInput,
  parseLicenseToken,
  parseSignedDenyList,
  TokenError,
  type VerifiableLicensePayload,
} from "./format.js";

declare global {
  interface ImportMetaEnv {
    readonly VITE_LICENSE_PUBKEY?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

const FIELD = (1n << 255n) - 19n;
const ORDER = (1n << 252n) + 27742317777372353535851937790883648493n;
const mod = (n: bigint) => ((n % FIELD) + FIELD) % FIELD;
function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  for (let n = exponent, b = mod(base); n > 0n; n >>= 1n, b = mod(b * b)) {
    if (n & 1n) result = mod(result * b);
  }
  return result;
}
const D = mod(-121665n * power(121666n, FIELD - 2n));
type Point = readonly [bigint, bigint, bigint, bigint];
function add([x1, y1, z1, t1]: Point, [x2, y2, z2, t2]: Point): Point {
  const a = mod((y1 - x1) * (y2 - x2));
  const b = mod((y1 + x1) * (y2 + x2));
  const c = mod(2n * D * t1 * t2);
  const d = mod(2n * z1 * z2);
  const [e, f, g, h] = [b - a, d - c, d + c, b + a];
  return [mod(e * f), mod(g * h), mod(f * g), mod(e * h)];
}

/** Validate the actual canonical prime-order point, not just the encoded length.
 * Some WebCrypto engines import arbitrary 32 bytes. Math here handles public key
 * validation only; signature verification always uses WebCrypto Ed25519.
 */
export function decodeLicensePublicKey(encoded: string): Uint8Array<ArrayBuffer> {
  const raw = decodeBase64Url(encoded);
  if (raw.length !== 32) throw new TokenError("invalid-public-key");
  let packed = 0n;
  for (let i = raw.length - 1; i >= 0; i--) packed = (packed << 8n) | BigInt(raw[i] ?? 0);
  const sign = packed >> 255n;
  const y = packed & ((1n << 255n) - 1n);
  if (y >= FIELD) throw new TokenError("invalid-public-key");
  const y2 = mod(y * y);
  const denominator = mod(D * y2 + 1n);
  if (denominator === 0n) throw new TokenError("invalid-public-key");
  const x2 = mod((y2 - 1n) * power(denominator, FIELD - 2n));
  let x = power(x2, (FIELD + 3n) / 8n);
  if (mod(x * x) !== x2) x = mod(x * power(2n, (FIELD - 1n) / 4n));
  if (mod(x * x) !== x2 || (x === 0n && sign === 1n)) {
    throw new TokenError("invalid-public-key");
  }
  if ((x & 1n) !== sign) x = mod(-x);
  if (x === 0n && y === 1n) throw new TokenError("invalid-public-key");
  let result: Point = [0n, 1n, 1n, 0n];
  let point: Point = [x, y, 1n, mod(x * y)];
  for (let n = ORDER; n > 0n; n >>= 1n, point = add(point, point)) {
    if (n & 1n) result = add(result, point);
  }
  if (result[2] === 0n || result[0] !== 0n || mod(result[1] - result[2]) !== 0n) {
    throw new TokenError("invalid-public-key");
  }
  return raw;
}

export function bakedLicensePublicKey(): string {
  // Vite replaces this at build time. A blank key never enables licensing.
  const encoded = import.meta.env?.VITE_LICENSE_PUBKEY;
  if (!encoded) throw new TokenError("license-key-unconfigured");
  return encoded;
}

export async function importLicensePublicKey(
  encoded = bakedLicensePublicKey(),
  crypto: Crypto = globalThis.crypto,
): Promise<CryptoKey> {
  if (!crypto?.subtle) throw new TokenError("webcrypto-unavailable");
  return crypto.subtle.importKey("raw", decodeLicensePublicKey(encoded), "Ed25519", false, [
    "verify",
  ]);
}

export async function verifyEd25519(
  publicKey: string,
  message: Uint8Array,
  signature: Uint8Array,
  crypto: Crypto = globalThis.crypto,
): Promise<boolean> {
  if (signature.length !== 64) return false;
  const key = await importLicensePublicKey(publicKey, crypto);
  return crypto.subtle.verify("Ed25519", key, new Uint8Array(signature), new Uint8Array(message));
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
function validNow(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) throw new TokenError("invalid-clock");
}

export async function verifySignedDenyList(
  signed: SignedDenyList,
  publicKey: string = bakedLicensePublicKey(),
  now = unixNow(),
  crypto: Crypto = globalThis.crypto,
): Promise<DenyList> {
  validNow(now);
  const parsed = parseSignedDenyList(signed);
  if (parsed.payload.issuedAt > now) throw new TokenError("future-deny-list");
  if (
    !(await verifyEd25519(
      publicKey,
      denyListSigningInput(parsed.payload),
      decodeBase64Url(parsed.signature),
      crypto,
    ))
  ) {
    throw new TokenError("invalid-deny-list-signature");
  }
  return parsed.payload;
}

export type LicenseVerification =
  | { valid: true; payload: VerifiableLicensePayload }
  | { valid: false; reason: string };
export interface VerifyLicenseOptions {
  publicKey?: string;
  now?: number;
  online?: boolean;
  denyList?: SignedDenyList;
  crypto?: Crypto;
}

export async function verifyLicenseToken(
  token: LicenseToken,
  appUserId: AppUserId,
  options: VerifyLicenseOptions = {},
): Promise<LicenseVerification> {
  try {
    const now = options.now ?? unixNow();
    validNow(now);
    const { payload, message, signature } = parseLicenseToken(token);
    const publicKey = options.publicKey ?? bakedLicensePublicKey();
    if (!(await verifyEd25519(publicKey, message, signature, options.crypto))) {
      throw new TokenError("invalid-signature");
    }
    if (payload.sub !== appUserId) throw new TokenError("wrong-subject");
    if (payload.iat > now) throw new TokenError("future-token");
    if (payload.exp !== null && (payload.exp <= now || payload.exp <= payload.iat)) {
      throw new TokenError("expired-token");
    }
    const online = options.online ?? globalThis.navigator?.onLine ?? false;
    if (online && options.denyList) {
      const list = await verifySignedDenyList(options.denyList, publicKey, now, options.crypto);
      if (list.revokedJti.includes(payload.jti)) throw new TokenError("revoked-token");
    }
    return { valid: true, payload };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof TokenError ? error.code : "verification-unavailable",
    };
  }
}

export interface DenyListCache {
  readDenyList(): Promise<SignedDenyList | null>;
  writeDenyList(value: SignedDenyList): Promise<void>;
}
export type DenyListRefreshReason = "app-start" | "checkout" | "restore" | "periodic";
export type DenyListRefresh =
  | { status: "offline" | "cached" | "updated" }
  | { status: "unavailable"; reason: string };
export interface DenyListManagerOptions {
  publicKey?: string;
  fetchDenyList: () => Promise<SignedDenyList>;
  cache: DenyListCache;
  now?: () => number;
  online?: () => boolean;
  crypto?: Crypto;
}

/** Call start() at app bootstrap; await refresh('checkout'/'restore') before those
 * operations. Fetch is injected because §9.3 does not specify the bridge route.
 * A failed refresh preserves the last authenticated list and reports its failure.
 */
export class DenyListManager {
  private current: SignedDenyList | null = null;
  private loaded = false;
  private lastAttempt: number | null = null;
  private inFlight: Promise<DenyListRefresh> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  constructor(private readonly options: DenyListManagerOptions) {}

  private now() {
    return (this.options.now ?? unixNow)();
  }
  private online() {
    return (this.options.online ?? (() => globalThis.navigator?.onLine ?? false))();
  }
  private key() {
    return this.options.publicKey ?? bakedLicensePublicKey();
  }

  async start(): Promise<DenyListRefresh> {
    if (!this.running) {
      this.running = true;
      globalThis.addEventListener?.("online", this.reconnected);
    }
    return this.refresh("app-start");
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    globalThis.removeEventListener?.("online", this.reconnected);
  }

  private reconnected = () => {
    void this.refresh("periodic");
  };

  private schedule(): void {
    if (!this.running) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    const delay =
      this.online() && this.lastAttempt !== null
        ? Math.max(1, (this.lastAttempt + DENY_LIST_MAX_AGE - this.now()) * 1000)
        : DENY_LIST_MAX_AGE * 1000;
    this.timer = setTimeout(() => {
      void this.refresh("periodic");
    }, delay);
  }

  refresh(reason: DenyListRefreshReason): Promise<DenyListRefresh> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.update(reason).finally(() => {
      this.inFlight = null;
      this.schedule();
    });
    return this.inFlight;
  }

  private async update(reason: DenyListRefreshReason): Promise<DenyListRefresh> {
    try {
      const now = this.now();
      validNow(now);
      if (!this.loaded) {
        try {
          const cached = await this.options.cache.readDenyList();
          if (cached) {
            await verifySignedDenyList(cached, this.key(), now, this.options.crypto);
            this.current = parseSignedDenyList(cached);
          }
        } catch {
          /* A corrupt/unavailable cache must not prevent a fresh online fetch. */
        }
        this.loaded = true;
      }
      if (!this.online()) return { status: "offline" };
      if (
        reason === "periodic" &&
        this.lastAttempt !== null &&
        now >= this.lastAttempt &&
        now - this.lastAttempt < DENY_LIST_MAX_AGE
      ) {
        return { status: "cached" };
      }
      this.lastAttempt = now;
      const signed = parseSignedDenyList(await this.options.fetchDenyList());
      const list = await verifySignedDenyList(signed, this.key(), this.now(), this.options.crypto);
      if (this.now() - list.issuedAt >= DENY_LIST_MAX_AGE) throw new TokenError("stale-deny-list");
      if (
        this.current &&
        (list.issuedAt < this.current.payload.issuedAt ||
          (list.issuedAt === this.current.payload.issuedAt &&
            new TextDecoder().decode(denyListSigningInput(list)) !==
              new TextDecoder().decode(denyListSigningInput(this.current.payload))))
      ) {
        throw new TokenError("deny-list-rollback");
      }
      // Preserve the verified revocation in memory even if durable caching fails.
      this.current = signed;
      await this.options.cache.writeDenyList(signed);
      return { status: "updated" };
    } catch (error) {
      return {
        status: "unavailable",
        reason: error instanceof TokenError ? error.code : "deny-list-refresh-failed",
      };
    }
  }

  async verify(token: LicenseToken, appUserId: AppUserId): Promise<LicenseVerification> {
    await this.refresh("periodic");
    return verifyLicenseToken(token, appUserId, {
      ...(this.options.publicKey === undefined ? {} : { publicKey: this.options.publicKey }),
      now: this.now(),
      online: this.online(),
      ...(this.options.crypto ? { crypto: this.options.crypto } : {}),
      ...(this.current ? { denyList: this.current } : {}),
    });
  }
}
