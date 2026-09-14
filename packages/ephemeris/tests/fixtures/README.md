# P.1 conformance inputs

`sweph-conformance.ts` contains 24 input cases: Gregorian 1990-05-02 14:32 UT
and 2026-09-04 00:00 UT, each with Sun, Moon, Mercury, Venus, Mars, Jupiter,
Saturn, Uranus, Neptune, Pluto, Chiron, and the true north node at 55.60 N,
13.00 E. The south node is the north node's antipode and is checked in both
north-node cases. All 12 pinned house systems are exercised at both dates.

The Node loader reads the actual detached `VENDORED/sweph-wasm/dist/` WASM
and three 1800–2400 table files. The adapter checks byte lengths and SHA-256
against `src/sweph/tables.ts` before mounting them. No network is needed.

Assertions cover finite bounded positions and speeds, speed agreement with
local motion, ordered cyclic cusps with one full winding, finite normalized
chart angles, node antipodes, and aspects derived from `ChartFacts.positions`.
Speed ceilings are deliberately broad plausibility bounds, not reference
observations. The finite-difference check is an internal consistency check,
not independent positional truth.

No computed positions are frozen in this directory. Independent operator
reference tables are still outstanding. When supplied, add those references
with their provenance and compare using a circular longitude tolerance of
0.01 degrees. Passing these invariants does not establish 0.01-degree accuracy.

Browser/worker initialization uses `new SwephEngine()` followed by
`await engine.init({ assetRoot: new URL("/assets/sweph/", self.location.href) })`.
That explicitly deployed root must contain the pinned `wasm/` and `ephe/`
assets. The optional `fetch` injection takes a URL and returns an object with
`ok`, `status`, and `arrayBuffer()`, as demonstrated by the Node fixture loader.
