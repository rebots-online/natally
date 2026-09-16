// natally — SSRF guards for runtime-resolved URLs (ARCHITECTURE §11,
// TEST_RUBRIC TR-3/B.5a).
//
// Every URL that reaches the network layer (processor checkout host, license
// bridge host) is checked here before use: https-only, and hosts that are
// loopback, RFC1918/private, link-local or otherwise reserved are rejected.
// The checks are literal + suffix only — the guard NEVER resolves DNS.
//
// Residual gap (documented, accepted at this layer): a public hostname that
// resolves to a private address (DNS rebinding) passes a literal check. The
// transport seam is where this closes: production transport implementations
// pin the resolved IP of the configured host at connect time and re-check the
// pinned address against these same ranges, so a rebinding answer never
// carries a request.

/** Why a URL was rejected by `assertSafeUrl`. */
export type UnsafeUrlReason =
  | "unparsable"
  | "empty-host"
  | "non-https"
  | "loopback"
  | "private-range"
  | "reserved-host";

/** Typed rejection so callers can classify without string matching. */
export class UnsafeUrlError extends Error {
  readonly reason: UnsafeUrlReason;

  constructor(reason: UnsafeUrlReason, url: string) {
    super(`natally.billing: unsafe URL rejected (${reason}): ${url}`);
    this.name = "UnsafeUrlError";
    this.reason = reason;
  }
}

export interface SafeUrlOptions {
  /**
   * Test/dev relief ONLY: also accept plain `http://` when the host is
   * loopback (127.0.0.0/8, ::1, `localhost`, `*.localhost`). Private and
   * reserved ranges stay rejected even with this flag set.
   */
  readonly allowHttpLoopback?: boolean;
}

/** Dotted-quad parser; `null` when `host` is not a canonical IPv4 literal. */
function parseIpv4(host: string): readonly [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
}

function classifyIpv4(octets: readonly number[]): UnsafeUrlReason | null {
  const first = octets[0] ?? 0;
  const second = octets[1] ?? 0;
  if (first === 127) return "loopback"; // 127.0.0.0/8
  if (first === 10) return "private-range"; // 10.0.0.0/8
  if (first === 172 && second >= 16 && second <= 31) return "private-range"; // 172.16.0.0/12
  if (first === 192 && second === 168) return "private-range"; // 192.168.0.0/16
  if (first === 169 && second === 254) return "reserved-host"; // 169.254.0.0/16 link-local
  if (octets.join(".") === "0.0.0.0") return "reserved-host"; // this-host literal
  return null;
}

/**
 * Bracket-stripped, lowercased, URL-canonical IPv6 literal. Canonicalization
 * is load-bearing: `assertSafeUrl` only ever inspects `new URL(...).hostname`,
 * so expanded forms like `0:0:0:0:0:0:0:1` have already been compressed to
 * `::1` by the URL parser before classification.
 */
function classifyIpv6(host: string): UnsafeUrlReason | null {
  // IPv4-mapped (::ffff:aabb:ccdd canonical form): classify the embedded v4.
  if (host.startsWith("::ffff:")) {
    const tail = host.slice("::ffff:".length);
    const dotted = parseIpv4(tail);
    if (dotted !== null) return classifyIpv4(dotted);
    const hextets = tail.split(":");
    const high = Number.parseInt(hextets[0] ?? "", 16);
    const low = Number.parseInt(hextets[1] ?? "", 16);
    if (Number.isNaN(high) || Number.isNaN(low)) return "reserved-host";
    return classifyIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  if (host === "::1") return "loopback";
  const lead = Number.parseInt(host.split(":")[0] ?? "", 16);
  if (Number.isNaN(lead)) return null;
  if ((lead & 0xfe00) === 0xfc00) return "private-range"; // fc00::/7 unique-local
  if ((lead & 0xffc0) === 0xfe80) return "reserved-host"; // fe80::/10 link-local
  return null;
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const ipv4 = parseIpv4(host);
  if (ipv4 !== null) return (ipv4[0] ?? 0) === 127;
  return classifyIpv6(host) === "loopback";
}

/** Literal/suffix classification of a URL-canonical host; `null` = safe. */
function classifyHost(host: string): UnsafeUrlReason | null {
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  if (host.endsWith(".local")) return "reserved-host"; // mDNS range
  const ipv4 = parseIpv4(host);
  if (ipv4 !== null) return classifyIpv4(ipv4);
  return classifyIpv6(host);
}

/**
 * Parse `url` and reject anything the network layer must not touch
 * (ARCHITECTURE §11): non-https schemes, empty hosts, and hosts that are
 * loopback, private (RFC1918 / fc00::/7), link-local (169.254/16, fe80::/10)
 * or otherwise reserved (0.0.0.0, `*.localhost`, `*.local`). No DNS is
 * resolved — see the module header for the residual rebinding gap and where
 * production closes it. Returns the parsed URL so callers can build on it.
 *
 * With `allowHttpLoopback`, plain http to a loopback host is permitted (tests
 * and local bridge development only); every other rule still applies.
 */
export function assertSafeUrl(url: string, options: SafeUrlOptions = {}): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeUrlError("unparsable", url);
  }
  const rawHost = parsed.hostname;
  if (rawHost.length === 0) throw new UnsafeUrlError("empty-host", url);
  const host = stripBrackets(rawHost).toLowerCase();
  if (options.allowHttpLoopback === true && isLoopbackHost(host)) return parsed;
  if (parsed.protocol !== "https:") throw new UnsafeUrlError("non-https", url);
  const reason = classifyHost(host);
  if (reason !== null) throw new UnsafeUrlError(reason, url);
  return parsed;
}
