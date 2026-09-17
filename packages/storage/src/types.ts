import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives (SC1: closed sets, template-checked paths)
// ---------------------------------------------------------------------------

const SHA256_HEX = /^[a-f0-9]{64}$/;

export const Sha256Schema = z
  .string()
  .regex(SHA256_HEX, "sha256 must be 64 lowercase hex characters");
export type Sha256 = z.infer<typeof Sha256Schema>;

/** Safe integer byte count (a multi-GB object count is well inside 2^53-1). */
export const BytesSchema = z.number().int().safe();
export type Bytes = z.infer<typeof BytesSchema>;

const OBJECT_PATH_TEMPLATE = /^objects\/sha256\/([a-f0-9]{2})\/([a-f0-9]{64})$/;

/**
 * Immutable object path `objects/sha256/<ab>/<full-digest>` — template-checked:
 * the shard segment must be the first two hex characters of the full digest.
 */
export const ObjectPathSchema = z
  .string()
  .regex(OBJECT_PATH_TEMPLATE, "objectPath must be objects/sha256/<ab>/<full-digest>")
  .refine((path) => {
    const match = OBJECT_PATH_TEMPLATE.exec(path);
    if (match === null) return false;
    const shard: string | undefined = match[1];
    const digest: string | undefined = match[2];
    return shard !== undefined && digest?.startsWith(shard) === true;
  }, "objectPath shard must equal the first two characters of the digest");
export type ObjectPath = z.infer<typeof ObjectPathSchema>;

// ---------------------------------------------------------------------------
// §19.2 record set
// ---------------------------------------------------------------------------

/** SHA-256 of exact bytes + expected byte count; the scope selects the library, not the hash. */
export const ContentIdentitySchema = z.strictObject({
  sha256: Sha256Schema,
  bytes: BytesSchema,
  objectPath: ObjectPathSchema,
});
export type ContentIdentity = z.infer<typeof ContentIdentitySchema>;

const identifier = z.string().min(1);
const timestamp = z.number().int().nonnegative();

/**
 * Logical catalogue alias: asset ID + immutable revision → digest, format,
 * architecture, quantization, license, minimum runtime, dependency bundle.
 */
export const CatalogueAliasSchema = z.strictObject({
  assetId: identifier,
  revision: identifier,
  digest: Sha256Schema,
  format: identifier,
  architecture: z.string().min(1).optional(),
  quantization: z.string().min(1).optional(),
  license: identifier,
  minimumRuntime: z.string().min(1).optional(),
  /** A logical bundle is ready only when all required digests are available (§19.5). */
  dependencyBundle: z.array(ContentIdentitySchema).optional(),
});
export type CatalogueAlias = z.infer<typeof CatalogueAliasSchema>;

/**
 * Runtime qualification — backend/version, context limit, tokenizer/template,
 * hardware capability, compatibility evidence. Separate from file presence:
 * qualification never implies that bytes are on the device.
 */
export const RuntimeQualificationSchema = z.strictObject({
  backend: identifier,
  version: identifier,
  contextLimit: z.number().int().positive().optional(),
  tokenizer: z.string().min(1).optional(),
  template: z.string().min(1).optional(),
  hardwareCapability: identifier,
  evidenceRef: z.string().min(1).optional(),
});
export type RuntimeQualification = z.infer<typeof RuntimeQualificationSchema>;

// ---------------------------------------------------------------------------
// Access locator — closed union; never a bare path string
// ---------------------------------------------------------------------------

export const AccessLocatorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("native-path"), path: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("fd"),
    fd: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    length: z.number().int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal("uri"), uri: z.string().min(1) }),
  z.strictObject({ kind: z.literal("bookmark"), bookmark: z.string().min(1) }),
  z.strictObject({ kind: z.literal("browser-handle"), handle: z.unknown() }),
]);
export type AccessLocator = z.infer<typeof AccessLocatorSchema>;

// ---------------------------------------------------------------------------
// Usage claim / lease — lifecycle transitions only active → released
// ---------------------------------------------------------------------------

export const LeaseStateSchema = z.enum(["active", "released"]);
export type LeaseState = z.infer<typeof LeaseStateSchema>;

export const LeaseSchema = z.strictObject({
  consumer: identifier,
  digest: Sha256Schema,
  scope: identifier,
  acquiredAt: timestamp,
  expiresAt: timestamp.optional(),
  state: LeaseStateSchema,
});
export type Lease = z.infer<typeof LeaseSchema>;

export type LeaseTransitionError = { ok: true; lease: Lease } | { ok: false; error: string };

/**
 * The only permitted lifecycle transition is `active → released`. Releasing a
 * lease that is already released (or otherwise not active) is rejected.
 */
export function releaseLease(lease: Lease): LeaseTransitionError {
  if (lease.state !== "active") {
    return {
      ok: false,
      error: `lease for ${lease.digest} is not active (state: ${lease.state}); only active → released is permitted`,
    };
  }
  return {
    ok: true,
    lease: { ...lease, state: "released" },
  };
}

// ---------------------------------------------------------------------------
// Shared-vs-private classification — closed sets per §19.2
// ---------------------------------------------------------------------------

/**
 * Shared candidates (§19.2): public LLM weights, tokenizers, Kokoro/embedder
 * weights, licensed public ZIM files, immutable authored public lore packs.
 */
export const SHARED_ASSET_KINDS = [
  "llm-weights",
  "tokenizer",
  "kokoro-weights",
  "embedder-weights",
  "public-zim",
  "public-lore-pack",
] as const;
export type SharedAssetKind = (typeof SHARED_ASSET_KINDS)[number];

/**
 * Private by default (§19.2): birth details, people, charts, conversations,
 * generated companion text, personal GraphRAG nodes/edges/embeddings, licenses,
 * keys, usage ledgers.
 */
export const PRIVATE_ASSET_KINDS = [
  "birth-details",
  "people",
  "charts",
  "conversations",
  "companion-text",
  "graphrag",
  "licenses",
  "keys",
  "usage-ledgers",
] as const;
export type PrivateAssetKind = (typeof PRIVATE_ASSET_KINDS)[number];

export type AssetKind = SharedAssetKind | PrivateAssetKind;

const SHARED_SET: ReadonlySet<string> = new Set<string>(SHARED_ASSET_KINDS);

/** An asset kind not in the closed set above is not shareable (private by default). */
export function isShareable(kind: string): kind is SharedAssetKind {
  return SHARED_SET.has(kind);
}

// ---------------------------------------------------------------------------
// §19.3 resolve-existing-first resolver — shapes verbatim
// ---------------------------------------------------------------------------

/** Identity of an asset to resolve; resolved to bytes via the catalogue alias. */
export const AssetSchema = z.strictObject({
  assetId: identifier,
  revision: identifier,
});
export type Asset = z.infer<typeof AssetSchema>;

export type Lookup =
  | { kind: "ready"; lease: Lease }
  | { kind: "missing" }
  | { kind: "needs-grant" | "unavailable" | "corrupt"; reason: string };

/** SharedAssets interface, verbatim from architecture §19.3. */
export interface SharedAssets {
  lock<T>(key: string, run: () => Promise<T>): Promise<T>;
  lookup(asset: Asset, signal: AbortSignal): Promise<Lookup>;
  acquire(asset: Asset, signal: AbortSignal): Promise<Lease>;
}

/** Exhaustiveness guard: a caller that reaches this branch has an unhandled Lookup kind. */
export function assertNever(value: never, message = "unreachable"): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
