/**
 * Detached sweph-wasm 2.6.9 assets, relative to its packaged dist/ directory.
 * Provenance: DOCS/sdk/sweph-wasm/PROVENANCE.md, source assimilation amendment.
 * Hashes and byte lengths were measured from VENDORED/sweph-wasm/dist/.
 * These are asset integrity pins, never computed positional reference values.
 */
export const SWEPH_TABLES = [
  {
    name: "sepl_18.se1",
    path: "ephe/sepl_18.se1",
    bytes: 484055,
    sha256: "0b7e416e3c1be9e6a0dd1d711dae7f7685793a0e7df13f76363a493dc27b6ea1",
  },
  {
    name: "semo_18.se1",
    path: "ephe/semo_18.se1",
    bytes: 1304771,
    sha256: "ecfa54dbf5bc0b5a9bc3e04ed28629a821e98625eacae38f4070593bba0e2980",
  },
  {
    name: "seas_18.se1",
    path: "ephe/seas_18.se1",
    bytes: 223002,
    sha256: "5fd9c2aa1654e37c09a6aeb558076e795409b7dc4bd948ebc0faa7d4a7686b5b",
  },
] as const;

export const SWEPH_WASM = {
  path: "wasm/swisseph.wasm",
  bytes: 584227,
  sha256: "b8edc953c490d073f542fce22a9d50df85169fbb2e5e6573ec064df9d0bf622d",
} as const;

/** Gregorian 1800-01-01 inclusive to 2400-01-01 exclusive, expressed as UT JD. */
export const SWEPH_TABLE_RANGE = { start: 2378496.5, end: 2597641.5 } as const;
