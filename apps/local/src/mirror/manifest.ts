// natally — M.1: model-mirror manifest fetch with the host allowlist guard
// (ARCHITECTURE §7.1, §13; contracts from @natally/billing §13).
//
// Host allowlist (config param, I.3 wires the real values): §7.3 fixes the
// egress allowlist to the mirror host + the license-bridge host (+ checkout
// hosts, not this lane). The allowlist arrives as `allowedHosts`; when
// omitted it defaults to the manifest/download base's own host — the safe
// minimum. Entries are hostnames or host:port ("mirror.example.com",
// "127.0.0.1:8443") and match either the URL's hostname (any port) or its
// host:port.
//
// Scheme rule: https is mandatory, except http on loopback (localhost,
// 127.0.0.1, [::1]) which exists for tests and local development.

import { type ModelManifest, ModelManifestSchema } from "@natally/billing";

/** Injectable fetch so tests point at a real local fixture server. */
export type FetchLike = typeof fetch;

/** A URL was rejected by the scheme/host-allowlist guard. */
export class MirrorUrlError extends Error {
  readonly code = "mirror-url-rejected";
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "MirrorUrlError";
  }
}

/** The manifest could not be fetched or failed schema validation. */
export class ManifestError extends Error {
  readonly code = "manifest-invalid";
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Normalizes a bare-host allowlist entry to its lowercase form. */
function normalizeHostEntry(entry: string): string {
  return entry.trim().toLowerCase();
}

/**
 * Guard shared by the manifest fetch and asset downloads: parses the URL,
 * enforces https-except-loopback, and enforces the host allowlist. Throws
 * {@link MirrorUrlError} on any violation.
 */
export function assertAllowedMirrorUrl(raw: string | URL, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = raw instanceof URL ? raw : new URL(raw);
  } catch (err) {
    throw new MirrorUrlError(`invalid URL: ${errorMessage(err)}`, String(raw));
  }
  if (url.protocol === "http:" && !LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new MirrorUrlError(
      `insecure scheme rejected (http allowed only on loopback): ${url.origin}`,
      url.toString(),
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new MirrorUrlError(`unsupported scheme: ${url.protocol}`, url.toString());
  }
  const host = url.hostname.toLowerCase();
  const hostPort = url.host.toLowerCase();
  const allowed = allowedHosts.some((entry) => {
    const e = normalizeHostEntry(entry);
    return e === host || e === hostPort;
  });
  if (!allowed) {
    throw new MirrorUrlError(`host "${url.host}" is outside the mirror allowlist`, url.toString());
  }
  return url;
}

/** The host:port of a base URL (used as the implicit allowlist entry). */
export function hostOf(base: string): string {
  try {
    return new URL(base).host.toLowerCase();
  } catch (err) {
    throw new MirrorUrlError(`invalid base URL: ${errorMessage(err)}`, base);
  }
}

/**
 * Resolves `file` against a mirror `base` and runs the allowlist guard.
 * `allowedHosts` must already include the base's own host (see
 * {@link hostOf}); this function does not add it implicitly.
 */
export function mirrorUrlFor(base: string, file: string, allowedHosts: readonly string[]): URL {
  const withSlash = base.endsWith("/") ? base : `${base}/`;
  let url: URL;
  try {
    url = new URL(file, withSlash);
  } catch (err) {
    throw new MirrorUrlError(
      `invalid mirror URL for "${file}": ${errorMessage(err)}`,
      `${withSlash}${file}`,
    );
  }
  return assertAllowedMirrorUrl(url, allowedHosts);
}

export interface FetchManifestOptions {
  /** Injectable fetch; defaults to the global. */
  fetchImpl?: FetchLike;
  /**
   * Allowlisted hosts (§7.3: mirror + license bridge, wired by I.3). When
   * omitted it defaults to the manifest base's own host; when given it
   * REPLACES the default entirely.
   */
  allowedHosts?: readonly string[];
}

/**
 * Fetches and validates `manifest.json` from a mirror base (§13):
 * `{ version, assets: [{ id, kind, file, bytes, sha256, quant?, trialEligible? }] }`.
 * Throws {@link MirrorUrlError} when the resolved URL fails the guard and
 * {@link ManifestError} on fetch/parse/schema failure.
 */
export async function fetchManifest(
  base: string,
  options: FetchManifestOptions = {},
): Promise<ModelManifest> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const allowedHosts = options.allowedHosts ?? [hostOf(base)];
  const url = mirrorUrlFor(base, "manifest.json", allowedHosts);
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    throw new ManifestError(`manifest fetch failed: ${errorMessage(err)}`);
  }
  if (!response.ok) {
    throw new ManifestError(`manifest fetch failed: HTTP ${response.status}`);
  }
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (err) {
    throw new ManifestError(`manifest is not valid JSON: ${errorMessage(err)}`);
  }
  const parsed = ModelManifestSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new ManifestError(`manifest failed schema validation: ${detail}`);
  }
  return parsed.data;
}

export type { ManifestAsset, ModelManifest } from "@natally/billing";
// Contract re-exports (§13) so mirror consumers import the whole surface from
// this module.
export { ManifestAssetSchema, ModelManifestSchema } from "@natally/billing";
