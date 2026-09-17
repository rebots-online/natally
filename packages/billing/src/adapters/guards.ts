/**
 * B.5a — SSRF guards for every runtime-resolved URL the billing surface touches
 * (§11): https-only, no credentials, no query/fragment surprises, and loopback /
 * private / reserved hosts rejected. The mirror allowlist carve-out for loopback
 * (config amendment 2026-09-17) applies to the model mirror only — checkout and
 * bridge URLs follow the strict production posture here.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

function isPrivateIPv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "::" || bare === "::1") return true;
  if (bare.startsWith("fc") || bare.startsWith("fd")) return true;
  if (bare.startsWith("fe80")) return true;
  // URL normalizes IPv4-mapped forms to pure hex ("::ffff:c0a8:101").
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(bare);
  if (mapped) {
    const hi = Number.parseInt(mapped[1]!, 16);
    const lo = Number.parseInt(mapped[2]!, 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  return false;
}

export class GuardError extends Error {
  constructor(readonly reason: string) {
    super(`Blocked URL (${reason})`);
  }
}

/** Strict https URL with no userinfo/query/hash and a public host. */
export function assertPublicHttpsUrl(value: string, role: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GuardError(`${role}: not a URL`);
  }
  if (url.protocol !== "https:") throw new GuardError(`${role}: protocol must be https`);
  if (url.username || url.password) throw new GuardError(`${role}: credentials forbidden`);
  if (url.search || url.hash) throw new GuardError(`${role}: query/fragment forbidden`);
  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host) || isPrivateIPv4(host) || isPrivateIPv6(host)) {
    throw new GuardError(`${role}: loopback/private/reserved host`);
  }
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
    throw new GuardError(`${role}: local domain`);
  }
  return url;
}

/** Check URLs additionally allow one search pair (the appUserId/offering params). */
export function assertPublicHttpsCheckoutUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GuardError("checkout: not a URL");
  }
  if (url.protocol !== "https:") throw new GuardError("checkout: protocol must be https");
  if (url.username || url.password) throw new GuardError("checkout: credentials forbidden");
  if (url.hash) throw new GuardError("checkout: fragment forbidden");
  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host) || isPrivateIPv4(host) || isPrivateIPv6(host)) {
    throw new GuardError("checkout: loopback/private/reserved host");
  }
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
    throw new GuardError("checkout: local domain");
  }
  return url;
}
