import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type Asset,
  assertNever,
  type CatalogueAlias,
  CatalogueAliasSchema,
  type ContentIdentity,
  ContentIdentitySchema,
  isShareable,
  type Lease,
  type LeaseTransitionError,
  type Lookup,
  type ObjectPath,
  PRIVATE_ASSET_KINDS,
  RuntimeQualificationSchema,
  releaseLease,
  SHARED_ASSET_KINDS,
  Sha256Schema,
  type SharedAssets,
} from "../src/types.js";

const digest = "ab".repeat(32);
const otherDigest = "cd".repeat(32);
const objectPath: ObjectPath = `objects/sha256/ab/${digest}`;

const identity: ContentIdentity = {
  sha256: digest,
  bytes: 3_221_225_472,
  objectPath,
};

const activeLease: Lease = {
  consumer: "natally-local",
  digest,
  scope: "shared-content-v1",
  acquiredAt: 1_700_000_000_000,
  state: "active",
};

describe("record roundtrips through zod", () => {
  it("ContentIdentity round-trips", () => {
    expect(ContentIdentitySchema.parse(identity)).toEqual(identity);
  });

  it("CatalogueAlias round-trips, including dependency bundle of ContentIdentity refs", () => {
    const alias: CatalogueAlias = {
      assetId: "kokoro-82m",
      revision: "r1",
      digest,
      format: "onnx",
      architecture: "arm64",
      quantization: "q8",
      license: "apache-2.0",
      minimumRuntime: "onnxruntime-web@1.20",
      dependencyBundle: [
        identity,
        { ...identity, sha256: otherDigest, objectPath: `objects/sha256/cd/${otherDigest}` },
      ],
    };
    expect(CatalogueAliasSchema.parse(alias)).toEqual(alias);
  });

  it("RuntimeQualification round-trips (presence independent of files)", () => {
    const qualification = RuntimeQualificationSchema.parse({
      backend: "webgpu",
      version: "1.20.0",
      contextLimit: 8192,
      tokenizer: "llama-bpe",
      template: "chatml",
      hardwareCapability: "fp16",
      evidenceRef: "qualifications/webgpu-fp16.json",
    });
    expect(qualification.backend).toBe("webgpu");
  });

  it("AccessLocator accepts every closed-union kind and rejects a bare path string", async () => {
    const { AccessLocatorSchema } = await import("../src/types.js");
    expect(
      AccessLocatorSchema.parse({ kind: "native-path", path: "/home/r/lib/model.onnx" }),
    ).toEqual({
      kind: "native-path",
      path: "/home/r/lib/model.onnx",
    });
    expect(AccessLocatorSchema.parse({ kind: "fd", fd: 7, offset: 0, length: 4096 })).toEqual({
      kind: "fd",
      fd: 7,
      offset: 0,
      length: 4096,
    });
    expect(AccessLocatorSchema.parse({ kind: "uri", uri: "content://docs/12" })).toEqual({
      kind: "uri",
      uri: "content://docs/12",
    });
    expect(AccessLocatorSchema.parse({ kind: "bookmark", bookmark: "book:AAECAw" })).toEqual({
      kind: "bookmark",
      bookmark: "book:AAECAw",
    });
    const handle = new AbortController();
    expect(AccessLocatorSchema.parse({ kind: "browser-handle", handle }).kind).toBe(
      "browser-handle",
    );
    expect(AccessLocatorSchema.safeParse("/home/r/lib/model.onnx").success).toBe(false);
  });
});

describe("validation rejections", () => {
  it("rejects a bad sha256", () => {
    expect(Sha256Schema.safeParse("ZZ".repeat(32)).success).toBe(false);
    expect(Sha256Schema.safeParse("ab".repeat(31)).success).toBe(false);
  });

  it("rejects an objectPath whose shard is not the digest prefix", () => {
    expect(
      ContentIdentitySchema.safeParse({ ...identity, objectPath: `objects/sha256/cd/${digest}` })
        .success,
    ).toBe(false);
    expect(
      ContentIdentitySchema.safeParse({ ...identity, objectPath: `objects/sha256/${digest}` })
        .success,
    ).toBe(false);
    expect(
      ContentIdentitySchema.safeParse({ ...identity, objectPath: "/var/lib/model.onnx" }).success,
    ).toBe(false);
  });
});

describe("lease lifecycle", () => {
  it("active → released is permitted", () => {
    const result: LeaseTransitionError = releaseLease(activeLease);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lease.state).toBe("released");
      // immutable transition: the original record is untouched
      expect(activeLease.state).toBe("active");
    }
  });

  it("double-release is rejected", () => {
    const released = releaseLease(activeLease);
    if (!released.ok) throw new Error("first release must succeed");
    const second = releaseLease(released.lease);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("only active → released is permitted");
  });
});

describe("shared-vs-private closed sets", () => {
  it("every §19.2 shared candidate row is shareable", () => {
    for (const kind of SHARED_ASSET_KINDS) expect(isShareable(kind)).toBe(true);
  });

  it("every §19.2 private-by-default row is not shareable", () => {
    for (const kind of PRIVATE_ASSET_KINDS) expect(isShareable(kind)).toBe(false);
  });

  it("unknown kinds are not shareable (private by default)", () => {
    expect(isShareable("conversation-archive")).toBe(false);
    expect(isShareable("")).toBe(false);
  });
});

describe("Lookup exhaustiveness", () => {
  // Compile-time: this switch is exhaustive today; adding a Lookup kind without
  // handling it makes `value` not `never` and this file fails to typecheck.
  function describeLookup(lookup: Lookup): string {
    switch (lookup.kind) {
      case "ready":
        return `ready:${lookup.lease.digest}`;
      case "missing":
        return "missing";
      case "needs-grant":
        return `needs-grant:${lookup.reason}`;
      case "unavailable":
        return `unavailable:${lookup.reason}`;
      case "corrupt":
        return `corrupt:${lookup.reason}`;
      default:
        return assertNever(lookup);
    }
  }

  it("handles every Lookup variant at runtime", () => {
    expect(describeLookup({ kind: "ready", lease: activeLease })).toBe(`ready:${digest}`);
    expect(describeLookup({ kind: "missing" })).toBe("missing");
    expect(describeLookup({ kind: "needs-grant", reason: "SAF grant not persisted" })).toBe(
      "needs-grant:SAF grant not persisted",
    );
    expect(describeLookup({ kind: "unavailable", reason: "device offline" })).toBe(
      "unavailable:device offline",
    );
    expect(describeLookup({ kind: "corrupt", reason: "digest mismatch after verification" })).toBe(
      "corrupt:digest mismatch after verification",
    );
  });

  it("assertNever throws when reached", () => {
    expect(() => assertNever(undefined as never, "hit unreachable branch")).toThrowError(
      "hit unreachable branch: undefined",
    );
  });

  it("Lookup type shape is exactly the §19.3 union", () => {
    expectTypeOf<Lookup>().toEqualTypeOf<
      | { kind: "ready"; lease: Lease }
      | { kind: "missing" }
      | { kind: "needs-grant" | "unavailable" | "corrupt"; reason: string }
    >();
  });

  it("SharedAssets interface shape matches §19.3", () => {
    expectTypeOf<SharedAssets["lock"]>().toEqualTypeOf<
      <T>(key: string, run: () => Promise<T>) => Promise<T>
    >();
    expectTypeOf<SharedAssets["lookup"]>().toEqualTypeOf<
      (asset: Asset, signal: AbortSignal) => Promise<Lookup>
    >();
    expectTypeOf<SharedAssets["acquire"]>().toEqualTypeOf<
      (asset: Asset, signal: AbortSignal) => Promise<Lease>
    >();
  });
});
