# natally — implementation checklist (Gate 2 document 2 of 3)

Derived **de novo** 2026-09-09 from `DOCS/ARCHITECTURE.md` (2026-09-09 reconciled edition) —
section by section, with §5's entity table as the ownership partition and §2's dependency
rule as the phase structure. Each task's **Spec** opens with its architecture anchor so the
derivation stays auditable back to the source. This file supersedes two preserved
predecessors beside it: the 2026-09-04 translation (`CHECKLIST.md.bak.20260909_163202`) and
an intermediate transcription of that translation
(`CHECKLIST.v1.4.16444.transcribed-from-predecessor.md`) — additive per I3, copy never move.

Every task is **atomic**, **idempotent** (re-running after completion changes nothing and
exits 0), **order-independent** (any task may run before or after any other, in parallel,
with four explicit exceptions marked ⛓), and **self-contained**: a subagent given exactly
one task block — plus `DOCS/ARCHITECTURE.md` for background — can finish it in one pass.
The architecture enumerates every entity and closed set; each block cites its entities
verbatim, so a coder looks at its block and nothing else.

Sibling document: `DOCS/TEST_RUBRIC.md` (authored 2026-09-11; the task-level Verify lines
here are the executable subset of it).

## Execution protocol (house rules, CC/TC compliant)

- Marker protocol: `[ ]` untouched · `[/]` in progress · `[X]` implemented · `✅` only
  when the **Verify** command ran and its output matched the **Accept** line.
- **Ownership closure by derivation:** every file a task may create or modify is denoted in
  its own block (**Owns**), derived 1:1 from the architecture's entity enumeration — the
  enumeration is consumed onto the list or the list is wrong. **Reads** = files consulted
  but owned elsewhere; they may not exist yet (out-of-order execution) — write imports
  against them anyway; full-workspace typecheck is deferred to I.4.
- Coordination is closed at architecting time, not execution time: §5's entity rows
  partition into **pairwise-disjoint Owns sets** — no two tasks share an owned file; shared
  seams are contract files owned by exactly one task each. A task block is its executor's
  whole world. Resolve ownership and dependency concerns during architecture-to-checklist
  derivation, before sign-off. After sign-off, execute the approved block without creating
  blockers, reopening architecture, or improvising changes to its ownership or scope.
- **Global autonomous execution rule (operator clarification 2026-09-13):** the approved
  checklist authorizes completion without further operator attendance. Continue to the
  agreed goal; record concerns for discussion with the completed handoff. The operator may
  be working elsewhere, and a pause can waste the remainder of the day. Record actual
  verification outcomes honestly; this rule never turns a failed Accept into a pass.
- The ⛓ integrators (I.1–I.4) are regenerators, not coordinators — they rebuild registries
  from whatever exists when they run; running another task's script or contract file in a
  Verify is a **Read**, never a modification.
- No mocks/stubs in shipped code; test utilities that are real injectable implementations
  (e.g. a deterministic embedder) live under the owning package's `tests/` and are never
  imported by `src/`.
- Stack law (§3): TS `strict`, React 19, Tailwind 4 `@theme`, Vite, pnpm workspace, Rust
  native core under Tauri 2, identity `mba.robin.natally`. Commits follow `v{VERSION}: `
  via `scripts/update-version.sh`.

## Entity ownership map (derived from §5 + runtime entities)

| Entity (§5 row) | Defined by (contract task) | Persisted/owned by |
|---|---|---|
| Person, Session, Turn | T0.9 (DDL), T0.6 (types) | X.1 |
| Plate, ChartFacts, Aspect, HouseCusps, OrbTable | T0.5 | P.4 |
| GlossaryEntry | G.1 | G.1 (bundled) |
| TrialPolicy | T0.7, T0.10 | B.1 |
| Reading | T0.7 | B.2 |
| LicenseToken, DenyListEntry | T0.7 | B.3 |
| ConsumedCode | T0.7 | B.4 |
| Offering, CheckoutSession, PurchaseAdapter | T0.7 | B.5a/b/c |
| LoreNode, LoreEdge, LoreStore | T0.6 | L.1–L.5 |
| ModelManifest, ManifestAsset, Download | T0.7 (types) | M.1 |
| CompanionEvent, DomWriteOp, CompanionTool, StageSignal | T0.6, C.4 | C.3, C.4 |
| ExportDocument (exportVersion) | T0.6 | X.1 |
| StageState (mascot) | U.9 | U.9 |
| Route entries | U.1 (contract) | I.1 (registry) |

---

## Phase T — Scaffolding & contracts (§2 monorepo layout, §3 normative stack, §15 config)

- ✅ **T0.1 — Workspace scaffold.** *(§2 dependency rule, §3 stack)*
  **Owns:** `pnpm-workspace.yaml`, root `package.json` (rewrite — version stamp preserved),
  `pnpm-lock.yaml` (§3: committed from day one), `tsconfig.base.json`, `biome.json`,
  `.prettierrc`, `vitest.workspace.ts`, `scripts/check.sh`.
  **Spec:** pnpm workspace packages `apps/*`, `packages/*` per §2; TS `strict`,
  `moduleResolution: bundler`, path alias `@natally/*` → `packages/*/src`; Biome lint+format
  (no `any`, no `console` in `src/`); vitest workspace with per-package projects;
  `scripts/check.sh` runs `pnpm -r typecheck && pnpm -r lint && pnpm vitest run --silent`.
  Dev deps pinned (§3 stack): typescript@5.9, vite@7, vitest@3, @biomejs/biome@2,
  tailwindcss@4, react@19, react-dom@19, @tauri-apps/cli@2. Keep the existing
  `scripts/update-version.sh` and `version` script wired (§14).
  **Verify:** `pnpm install --frozen-lockfile=false && ./scripts/check.sh`
  **Accept:** `workspace: 0 test files, typecheck+lint clean` (empty workspace passes).
  **Observed 2026-09-13, v1.10.21039:** required install + check exited 0; TypeScript
  clean, Biome checked four files with no fixes, Vitest reported zero test files and
  exited 0. Frozen-lockfile install also passed. An isolated app/package fixture verified
  actual type, lint (`any`/console), and test failures return nonzero, then passed after
  correction. Vitest 3.2's workspace-format deprecation notice is recorded for later
  discussion; this task preserves the approved `vitest.workspace.ts` contract.

- [ ] **T0.2 — apps/local frontend scaffold.** *(§3 frontend row)*
  **Owns:** `apps/local/package.json`, `apps/local/vite.config.ts`, `apps/local/tsconfig.json`,
  `apps/local/index.html`, `apps/local/src/main.tsx`, `apps/local/src/app.tsx`,
  `apps/local/src/styles/global.css`, `apps/local/public/` (empty `.gitkeep`),
  `apps/local/tsconfig.standalone.json`.
  **Reads:** T0.1, T0.8. **Spec:** Vite + React 19 entry rendering `<NatallyApp/>`;
  `global.css` imports `@natally/design-tokens/tokens.css` and sets `midnight` ground (§3
  law: the `@theme` block lives in tokens.css — no raw hex outside it); font import site
  reserved via comment contract `/* S.1 fonts */` (S.1 fills it); Tailwind 4 via
  `@import "tailwindcss"` with `@source` at `../src`; `main.tsx` mounts the router shell
  export from U.1 **as a lazy dynamic import with a real loading absence element** (dark,
  wordmark, nothing fake). `tsconfig.standalone.json` typechecks this task's files alone
  (router import excluded) so the task is order-independent.
  **Verify:** `pnpm --filter @natally/local exec tsc --noEmit -p tsconfig.standalone.json`
  **Accept:** `built standalone entry OK` (tsc exits 0). The full-app `vite build` is
  exercised by I.1/I.4 once the route registry exists — not part of this Accept.

- [ ] **T0.3 — src-tauri scaffold.** *(§3 native core row, §2)*
  **Owns:** `apps/local/src-tauri/` (Cargo.toml, tauri.conf.json, build.rs, src/main.rs,
  src/lib.rs, capabilities/default.json).
  **Spec:** Tauri 2 app, identity `mba.robin.natally` (§3; Android applicationId equal);
  dev server `http://localhost:5173`; window 430×932 min, dark. §3 native core hosts:
  ephemeris worker, llama.cpp bindings, Kokoro ONNX synthesis + playback, OS keychain,
  SQLite stores — this task lays the shell: `lib.rs` defines `#[tauri::command]` modules
  via a static command registry macro (`natally_plugin!`) so feature tasks register
  commands from their own files without editing lib.rs; `main.rs` calls the registry
  builder; no plugins yet. Cargo deps: tauri@2, tokio, serde, serde_json, rusqlite
  (bundled), thiserror.
  **Verify:** `cargo check --manifest-path apps/local/src-tauri/Cargo.toml`
  **Accept:** `Finished` with 0 errors.

- [ ] **T0.4 — Token mirror test.** *(§3 law: @theme mirrors TOKENS.md one-to-one)*
  **Owns:** `packages/design-tokens/tests/tokens.test.ts`.
  **Reads:** T0.8. **Spec:** test parses `tokens.css` `@theme` and asserts the frozen
  collection exactly: 36 variables — 10 colour (STATE-LEDGER 2:3–2:12) + 12 zodiac
  (2:13–2:24) + 4 radius (2:25–2:28) + 6 space (2:29–2:34) + 1 stroke (2:35) + 3 size
  (2:36–2:38); every `--color-*`/`--spacing-*` name equals the `CSS` column of
  `LIBS/UI/FIGMA/TOKENS.md` (parsed from the markdown table in-repo); hex values equal
  TOKENS.md's hex column.
  **Verify:** `pnpm vitest run packages/design-tokens`
  **Accept:** `tokens: 36 variables mirrored exactly`.

- [ ] **T0.5 — Ephemeris contracts.** *(§6 seam, verbatim)*
  **Owns:** `packages/ephemeris/src/types.ts`, `packages/ephemeris/src/seam.ts`,
  `packages/ephemeris/package.json`, `packages/ephemeris/tsconfig.json`,
  `packages/ephemeris/tests/types.test.ts`.
  **Reads:** `DOCS/sdk/sweph-wasm/` (vendored 2.6.9 snapshot — PROVENANCE.md, index.d.ts).
  **Spec:** §6 `EphemerisEngine` exactly: `id`, `init(cfg)`, `position(body, ut)`,
  `cusps(ut, place, system)`, `aspects(a, b, orbs)`, optional `chiron?(ut)`. `Body` = the
  11 classical+modern bodies + `'chiron' | 'north-node' | 'south-node'`. `HouseSystem` =
  the §6 pinned closed set of 12, each code identical to its `HouseSystems` member of
  `sweph-wasm@2.6.9` (type at `DOCS/sdk/sweph-wasm/index.d.ts:2423`): `'P'` Placidus,
  `'K'` Koch, `'O'` Porphyry, `'R'` Regiomontanus, `'C'` Campanus, `'A'` Equal (Asc),
  `'V'` Vehlow Equal, `'W'` Whole Sign, `'T'` Topocentric (Polich/Page), `'X'` Meridian
  (axial rotation), `'B'` Alcabitius, `'U'` Krusinski-Pisa-Goelzer. `OrbTable` defaults:
  conjunction 8, opposition 8, trine 7, square 7, sextile 4, quincunx 3, semisextile 2
  (overridable). `ChartFacts {id: content hash, inputs {ut[], place, system}, positions:
  Array<{body, lon, lat, speed}>, cusps?: number[12] + asc + mc + armc, aspects: Aspect[]}`;
  `Aspect {a, b, type, orb, applying: boolean}`; `EclipticPosition`. All exported as `.ts`
  types + zod schemas (zod dep added here).
  **Verify:** `pnpm vitest run packages/ephemeris/tests/types.test.ts`
  **Accept:** `seam types: schema roundtrip OK`.

- [ ] **T0.6 — Lore & conversation contracts.** *(§8.2 graph model, §7.3 ops, §5 export)*
  **Owns:** `packages/lore/src/types.ts`, `packages/lore/src/store.ts` (interface only),
  `packages/lore/package.json`, tsconfig, `packages/lore/tests/types.test.ts`.
  **Spec:** §8.2 verbatim — `LoreNode {id, kind: 'person'|'fact'|'event'|'thread'|'place',
  summary, embedding: number[], refs[]}`; `LoreEdge {from, to, rel:
  'mentions'|'relates'|'follows'|'contradicts', weight, sourceTurnId}`. §7.3 —
  `DomWriteOp {selector, op: 'setattr'|'text'|'class'|'focus'|'scroll', value}`. §4/§10 —
  `CompanionEvent` union (token, turn, chart-computed, envelope, error). §8.4 — `LoreStore`
  interface: `query(personId?, q, k, budget)`, `upsertTurn(turn, embedding)`, `exportAll()`,
  `deleteAll()`, `stats()` (returns `{turns, nodes, edges}`). §5 — `ExportDocument
  {exportVersion: 1, people, sessions, turns, charts(inputs only), loreNodes, loreEdges,
  consumedCodes}`. Pure types + zod; zero imports outside the package (§2 dependency rule).
  **Verify:** `pnpm vitest run packages/lore/tests/types.test.ts`
  **Accept:** `lore types: roundtrip OK`.

- [ ] **T0.7 — Billing contracts.** *(§9.1–§9.6, §13)*
  **Owns:** `packages/billing/src/types.ts`, `package.json`, tsconfig,
  `packages/billing/tests/types.test.ts`.
  **Spec:** §9.1 `TrialPolicy {mode: 'count'|'time'|'rate', readings?, days?,
  cooldownDays?, trialModel}`; §9.2 `Reading {id, ts, personId, chartId}`; §9.3
  `LicenseToken` = compact COSE-style string, payload `{sub: appUserId, tier: 'unlimited',
  iat, exp: null, iss: 'natally-license-bridge', jti}` + signed `DenyList {issuedAt,
  revokedJti[]}` envelope; §9.5 `ConsumedCode {codeHash, redeemedAt}`; §9.4 `Offering {id,
  priceString, tier, durationIso?}`, `CheckoutSession {kind: 'redirect'|'iap'|'rc', url?,
  offering}`, `PurchaseAdapter` over the six ids (stripe/revenuecat/polar/lemonsqueezy/
  paypal/square; `available()`, `checkout()`, `restore()`); §9.6 `ConsumeResult {allowed,
  reason?: 'trial-exhausted'|'rate-limited'|'unlicensed'|'insufficient-credit'}`; §13
  `ModelManifest {version, assets: ManifestAsset[]}`, `ManifestAsset {id, kind:
  'llm'|'embedder'|'voice'|'voices', file, bytes, sha256, quant?, trialEligible?}`.
  **Verify:** `pnpm vitest run packages/billing/tests/types.test.ts`
  **Accept:** `billing types: roundtrip OK`.

- [ ] **T0.8 — Design tokens package.** *(§3 tokens law)*
  **Owns:** `packages/design-tokens/tokens.css`, `package.json`, `src/index.ts`,
  `scripts/gen.mjs`.
  **Reads:** `LIBS/UI/FIGMA/TOKENS.md`, `STATE-LEDGER.json` (read-only sources).
  **Spec:** `tokens.css` = Tailwind 4 `@theme` mirroring TOKENS.md one-to-one (colour,
  radius, spacing, stroke, size custom properties exactly as the `CSS` column; zodiac as
  `--color-z-<sign>`) — §3 bans raw hex outside this file. `src/index.ts` exports the same
  values as frozen TS consts parsed once — no hand-duplicated values: parse tokens.css via
  the owned `scripts/gen.mjs`, output committed.
  **Verify:** `node packages/design-tokens/scripts/gen.mjs --check`
  **Accept:** `tokens.css in sync with TOKENS.md (36 vars)`.

- [ ] **T0.9 — SQLite DDL & migration runner.** *(§5 storage column, §8.1)*
  **Owns:** `packages/lore/src/ddl.ts` (the shared DDL for lore **and** app tables — single
  ownership keeps parallel tasks disjoint), `packages/lore/src/migrate.ts`,
  `packages/lore/tests/ddl.test.ts`.
  **Spec:** `MIGRATIONS: {id, sql}[]` executed in order, recorded in `_migrations`; tables
  per §5 Storage column: `people(id TEXT PK, name TEXT NOT NULL, birth_date TEXT NOT NULL,
  birth_time TEXT, time_known INTEGER NOT NULL, place TEXT NOT NULL, created_at INTEGER)`;
  `sessions(id TEXT PK, person_id TEXT REFERENCES people, started_at INTEGER)`; `turns(id
  TEXT PK, session_id TEXT NOT NULL REFERENCES sessions, person_id TEXT, role TEXT
  CHECK(role IN ('you','her','tool')), text TEXT NOT NULL, ts INTEGER, tool_ops TEXT)`;
  `charts(id TEXT PK, inputs_json TEXT NOT NULL, facts_json TEXT NOT NULL, computed_at
  INTEGER)`; `readings(id TEXT PK, ts INTEGER, person_id TEXT, chart_id TEXT)`;
  `consumed_codes(code_hash TEXT PK, redeemed_at INTEGER)`; `license_state(id INTEGER PK
  CHECK(id=1), token TEXT, verified_at INTEGER)`; `lore_nodes(id TEXT PK, kind TEXT,
  summary TEXT, embedding BLOB, refs_json TEXT)`; `lore_edges(from_id TEXT, to_id TEXT,
  rel TEXT, weight REAL, source_turn_id TEXT, PRIMARY KEY(from_id,to_id,rel,source_turn_id))`;
  `vec_nodes` (virtual, sqlite-vec) emitted only when the extension loads — runner takes
  `extensions: boolean`. `migrate(db, {vec:boolean})` idempotent.
  **Verify:** `pnpm vitest run packages/lore/tests/ddl.test.ts` (in-memory better-sqlite3
  dev-dep; vec-off path) **Accept:** `migrations: fresh + re-run both OK (9 tables without
  vec; 10 with)`.

- [ ] **T0.10 — Config loader.** *(§15 configuration surface, verbatim)*
  **Owns:** `apps/local/src/config.ts`, `packages/billing/src/config.ts`,
  `packages/billing/tests/config.test.ts`, `.env.example` (whole file).
  **Spec:** typed `loadConfig(env)` over §15's build-baked values exactly: mirror base,
  app URL, trial block (§9.1 — exactly one mode populated; `trialModel` required
  non-empty; a blank value throws at boot with the field named — fail-loud by design),
  six processor values + bridge URL (blank ⇒ rail absent, §9.4), RevenueCat offering id,
  lore flags + embed dim (§8.1, default 384), `VITE_LICENSE_PUBKEY` (§9.3). This task
  owns `.env.example` whole: it carries every §15 key with comments, including
  `VITE_LICENSE_PUBKEY=` (B.3 reads it). Export a frozen `RuntimeConfig` +
  `paymentsAvailable()` derived list; zod-validated.
  **Verify:** `pnpm vitest run packages/billing/tests/config.test.ts`
  **Accept:** `config: valid, blank-rails-hidden, bad-env-throws`.

---

## Phase P — Ephemeris (§6, §4)

- [ ] **P.1 — sweph-wasm backend.** *(§6 incumbent + conformance)*
  **Owns:** `packages/ephemeris/src/sweph/` (engine.ts, tables.ts),
  `packages/ephemeris/tests/conformance.test.ts`, `packages/ephemeris/tests/fixtures/`.
  **Reads:** T0.5, `DOCS/sdk/sweph-wasm/` (vendored 2.6.9 snapshot). **Spec:** implement
  `EphemerisEngine` on `sweph-wasm@2.6.9` (pin per `DOCS/sdk/sweph-wasm/PROVENANCE.md`);
  `init` lazily mounts the engine's bundled semiset tables (the package ships
  `dist/ephe/seas_*.se1`; `tables.ts` records exactly which files mount — §6 "lazy");
  `position` via `swe_calc_ut` with speed flags; `cusps` via `swe_houses_ex` for each of
  the 12 pinned systems (§6 codes are the engine's own). Time-unknown input never reaches
  here (P.2 guards). Conformance per §6: 24 fixtures (2 dates × 12 bodies — Gregorian
  1990-05-02 14:32 UT and 2026-09-04 00:00 UT; place 55.60N 13.00E) asserting invariants
  until the operator supplies reference tables (positions in [0,360), per-body |speed|
  bounds, cusps ascending modulo, `|normalize(mc-asc)| ≤ 180`); compute-and-freeze from
  the same engine is FORBIDDEN. When reference numbers land, tighten tolerance to 0.01°.
  **Verify:** `pnpm vitest run packages/ephemeris/tests/conformance.test.ts`
  **Accept:** `sweph backend: 24 cases, invariants hold`.

- [ ] **P.2 — Honest-absence & solar chart rules.** *(§6 honest absence rules)*
  **Owns:** `packages/ephemeris/src/solar.ts`, tests.
  **Spec:** `chartInputs(person)` with `timeKnown=false` returns `{ut: null-date-only,
  system: 'WholeSign', solarHouses: true}` and enforces §6: no ASC, no MC, no house cusps;
  houses-by-sign only; `assertNoHouses(facts)` throws on any cusp. Per J3/J4 a person
  without time removes *their* house overlays only — the other direction computes. Pure
  functions; exhaustive tests for the three journey branches (J1, J3, J4).
  **Verify:** `pnpm vitest run packages/ephemeris/tests/solar.test.ts`
  **Accept:** `solar: absence rules hold for J1/J3/J4 branches`.

- [ ] **P.3 — Worker/off-thread host.** *(§4 process topology)*
  **Owns:** `packages/ephemeris/src/host/` (protocol.ts, web-worker.ts, native-task.rs at
  `packages/ephemeris/native/host.rs`), `packages/ephemeris/tests/host.test.ts`.
  **Spec:** §4 "ephemeris runs off the UI thread": JSON protocol `{id, op:
  'init'|'position'|'cusps'|'aspects', params}` → `{id, ok, result|error}`; web worker
  instantiates P.1 (§3 PWA counterpart); native side is a tokio `mpsc` task mounted by the
  T0.3 registry macro.
  **Verify:** `pnpm vitest run packages/ephemeris/tests/host.test.ts` (worker via
  `new Worker(new URL(...), {type:'module'})` under vitest web-worker pool)
  **Accept:** `host: init→cusps roundtrip via protocol OK`.

- [ ] **P.4 — ChartFacts builder + cache.** *(§5 charts row, §6 aspects)*
  **Owns:** `packages/ephemeris/src/facts.ts`, tests.
  **Reads:** T0.5, T0.9 (charts storage via injected `put/get`; X.1 adapts).
  **Spec:** `buildFacts(inputs)` — content id = sha256 of canonicalized inputs JSON (§5
  "content-addressed by input hash", immutable); positions for all bodies (+chiron when
  the backend flag allows, §6); cusps when time known; aspects from the default OrbTable
  with applying/separating from speeds (§6); caches into injected KV; `aspectsBetween(a,
  b)` for synastry cross-aspects — no score, no label (INC-19).
  **Verify:** `pnpm vitest run packages/ephemeris/tests/facts.test.ts`
  **Accept:** `facts: deterministic id, cache hit, synastry aspects computed`.

---

## Phase L — Lore (§8)

- [ ] **L.1 — LoreStore storage adapters.** *(§8.1 client-side storage)*
  **Owns:** `packages/lore/src/store/` (web.ts, native.ts, common.ts), tests.
  **Reads:** T0.6, T0.9. **Spec:** §8.1 "SQLite everywhere": web adapter `wa-sqlite` on
  OPFS (IndexedDB fallback), sqlite-vec wasm extension; native adapter the same interface
  over `rusqlite` behind a Tauri command surface (command file owned here:
  `lore_commands.rs`, registered via the T0.3 macro). Shared SQL in `common.ts` calling
  T0.9's DDL. Tests run the web adapter against in-memory SQLite (better-sqlite3, vec-off)
  exercising upsert/query/export/delete/stats.
  **Verify:** `pnpm vitest run packages/lore/tests/store.test.ts`
  **Accept:** `store: upsert→query→export→delete cycle OK`.

- [ ] **L.2 — Embedder.** *(§8.1 embed dim, §13 mirror-hosted model)*
  **Owns:** `packages/lore/src/embed/` (embedder.ts, native.rs bridge file), tests incl.
  `tests/hash-embedder.ts`.
  **Spec:** `Embedder {dim, embed(text): Promise<number[]>}`; production impl runs the
  mirror's embedder GGUF via wllama (web) / llama.cpp (native) — lazy load, L2-normalized,
  dim from config (§8.1 `VITE_LORE_EMBED_DIM`, default 384). Ship a real deterministic
  test embedder (hashing bag-of-words → projected vector, L2-normalized) for tests and
  M.1's catalogue bootstrap only — never in production paths (enforced by a test asserting
  `import {createHashEmbedder} from '../tests/hash-embedder'` appears in zero `src/` files).
  **Verify:** `pnpm vitest run packages/lore/tests/embed.test.ts`
  **Accept:** `embedder: dim honored, L2 norm 1.0 ±1e-6, src purity holds`.

- [ ] **L.3 — Extraction & merge.** *(§8.3 pipeline, extraction v1 + merge rule)*
  **Owns:** `packages/lore/src/extract.ts`, tests.
  **Spec:** deterministic extraction from a Turn (§8.3: proper nouns, dates, places,
  thread labels by rule + gazetteer; `lore.recall` hits as hints) — capitalized proper
  nouns (unicode-aware), ISO + natural dates, places against G.1's gazetteer, thread
  labels from session first-turn topic words; emit candidate LoreNodes (kind assigned) +
  LoreEdges (`mentions` turn→entity, `follows` consecutive, `relates` shared refs). Merge
  per §8.3: cosine ≥ 0.92 same-kind ⇒ merge (union refs, bump weight, keep earlier id).
  All pure; tests cover en + one transliterated case.
  **Verify:** `pnpm vitest run packages/lore/tests/extract.test.ts`
  **Accept:** `extract: entities+edges found; merge at 0.92 verified`.

- [ ] **L.4 — Hybrid retrieval.** *(§8.3 retrieval, §7.2 Tier 2)*
  **Owns:** `packages/lore/src/retrieve.ts`, tests.
  **Reads:** T0.6. **Spec:** §8.3 exactly: `retrieve(store, {personId?, q, k=8,
  budgetTokens=1500})` — cosine kNN over vec_nodes ∪ 2-hop graph expansion from matched
  ids; person-scoped unless `q.general`; token budget via char/4; returns fragments
  `{summary, sourceTurnId, score}` ordered (each carries `sourceTurnId` per §7.2 Tier 2).
  Tests with hash-embedder fixtures.
  **Verify:** `pnpm vitest run packages/lore/tests/retrieve.test.ts`
  **Accept:** `retrieve: vector ∪ 2-hop, budget respected, person-scoped`.

- [ ] **L.5 — Write-every-turn pipeline.** *(§8.3, §8.4 controls)*
  **Owns:** `packages/lore/src/pipeline.ts`, tests.
  **Spec:** `LorePipeline.consume(turn)` → embed (L.2) → extract/merge (L.3) → batched
  write (§12: ≤ 1 flush per turn, insert-only SQL in one transaction); `stats()` →
  `{turns, nodes, edges}` (§8.4 — the Settings line renders `[turns · nodes]`);
  `deleteAll()` = rows + vectors, real deletion (§8.4).
  **Verify:** `pnpm vitest run packages/lore/tests/pipeline.test.ts`
  **Accept:** `pipeline: 50 turns → nodes merged, flush count = 50, delete leaves 0 rows`.

---

## Phase B — Billing & licensing (§9)

- [ ] **B.1 — Trial gate.** *(§9.1 trial policy)*
  **Owns:** `packages/billing/src/trial.ts`, tests.
  **Spec:** parse the RuntimeConfig trial block (T0.10); `evaluateGate(policy, ledgerRows,
  now)` → `{state: 'trial-active'|'trial-exhausted'|'rate-limited'|'licensed', remaining?,
  nextReadingAt?}` implementing §9.1's three gates exactly (count: readings allowed; time:
  installTs + days; rate: last reading + cooldownDays — installTs from the readings table
  bootstrap row id `install`). Clock injected (`now: () => number`). Pure + table-driven.
  **Verify:** `pnpm vitest run packages/billing/tests/trial.test.ts`
  **Accept:** `trial: count/time/rate/licensed matrices pass (≥14 cases)`.

- [ ] **B.2 — Reading ledger + billing.consume.** *(§9.2 reading unit, §9.6 seam)*
  **Owns:** `packages/billing/src/ledger.ts`, `packages/billing/src/consume.ts`, tests.
  **Reads:** T0.7, T0.9. **Spec:** `ReadingLedger` over injected SQLite (readings table):
  `append(reading)` — append-only, never mutate (§9.2); `compensate(reading)` — appends the
  compensating credit row of the §9.2 charge lifecycle (charge at request with a plate in
  scope; refund when the fence finds zero Tier-1 references); `rowsSince(ts)`.
  `billing.consume(reading, deps)`: licensed (verified B.3 token) ⇒
  allowed; else evaluateGate ⇒ map states to ConsumeResult (§9.6 — THE seam: the hosted
  product swaps the impl, same signature).
  **Verify:** `pnpm vitest run packages/billing/tests/ledger.test.ts`
  **Accept:** `consume: licensed/trial/exhausted/rate paths exact`.

- [ ] **B.3 — License token verify + storage.** *(§9.3)*
  **Owns:** `packages/billing/src/token/` (format.ts, verify-web.ts, storage-web.ts,
  native.rs, verify.rs), tests.
  **Reads:** `.env.example` `VITE_LICENSE_PUBKEY` (owned by T0.10).
  **Spec:** §9.3 exactly: compact base64url(header).payload.Ed25519-sig token (COSE-esque,
  no external dep — WebCrypto Ed25519 on web; `ed25519-dalek` native); public key baked
  from `VITE_LICENSE_PUBKEY`; offline verify checks sig, iss, sub = appUserId, exp
  null-or-future; revocation = bridge-published signed dated DenyList checked when online,
  never blocking a verified unexpired token offline; deny-list fetched at app start,
  before any checkout/restore, and at most every 24 h (§9.3); storage: OS keychain (native
  command via T0.3 macro) / IndexedDB WebCrypto-wrapped (web) — where no OS keychain
  exists, an encrypted app-data file with About disclosure (§9.3), never plaintext. Tests:
  published Ed25519 test vectors (RFC 8032) for verify; generated keypair for the
  mint/forge paths.
  **Verify:** `pnpm vitest run packages/billing/tests/token.test.ts`
  **Accept:** `token: valid passes, tampered/expired/revoked rejected`.

- [ ] **B.4 — Codes.** *(§9.5 individually-redeemable + hash-based)*
  **Owns:** `packages/billing/src/codes.ts`, tests.
  **Spec:** format `NATALLY-XXXX-XXXX-XXXX` (Crockford base32, no I/L/O/U); hash-based
  code = base32(payload `{tier, exp}` + Ed25519 sig) packed into that shape — offline
  verify via the B.3 pubkey (§9.5 "no network"); single-use: sha256(code) into
  consumed_codes (§9.5 local ledger); outcomes `valid | invalid | already-used | expired`
  mapping to the paywall's code-error variant with the real reason.
  **Verify:** `pnpm vitest run packages/billing/tests/codes.test.ts`
  **Accept:** `codes: mint→verify→reuse rejected, 4 outcomes exact`.

- [ ] **B.5a — Generic hosted-redirect adapter + bridge client.** *(§9.4 rails, §11 SSRF)*
  **Owns:** `packages/billing/src/adapters/hosted.ts`,
  `packages/billing/src/bridge-client.ts`, `packages/billing/src/adapters/guards.ts`, tests.
  **Spec:** for stripe/polar/lemonsqueezy/paypal/square (§9.4): `available()` = config URL
  present (§9.4 presence rule); `checkout(offering)` → `{kind:'redirect', url: <configured
  URL> + ?appUserId=<id>&offering=<id>}` opened via opener injection (Tauri shell-open /
  window.open); then poll bridge `POST /verify {appUserId}` (2s backoff, 15 min cap,
  offline-tolerant); `restore()` → `GET /verify?appUserId=` → token|null. §11 SSRF guard:
  reject non-https, loopback/private/reserved hosts (`guards.ts`).
  **Verify:** `pnpm vitest run packages/billing/tests/adapters-hosted.test.ts` (no network:
  `fetch` arrives as an injected `transport` constructor parameter; tests inject an
  in-process routing function)
  **Accept:** `hosted adapter: URL build, poll loop, SSRF rejects loopback/private`.

- [ ] **B.5b — RevenueCat adapter.** *(§9.4 RC rail)*
  **Owns:** `packages/billing/src/adapters/revenuecat.ts`, tests.
  **Spec:** web SDK (`@revenuecat/purchases-js`): init with `VITE_REVENUECAT_WEB_SDK_KEY`
  + appUserId; `checkout` → `presentPaywall(offeringId)` (default offering
  `natally_default`); entitlement `unlimited` present ⇒ bridge `/mint` with the RC
  purchase id (§9.4: RC is the registry; the bridge verifies via RC REST v2 with its
  secret) → LicenseToken; `restore` via RC restore; `GET /denylist` enforcement honours the
  §9.3 fetch cadence.
  **Verify:** `pnpm vitest run packages/billing/tests/adapters-rc.test.ts` (RC SDK
  injected as constructor param)
  **Accept:** `rc adapter: paywall→entitlement→mint→token flow OK`.

- [ ] **B.5c — Adapter registry.** *(§9.4 presence → paywall line)*
  **Owns:** `packages/billing/src/adapters/registry.ts`, tests.
  **Spec:** order-stable registry over B.5a/B.5b instances filtered by `available()`;
  exports `paymentsAvailable()` — the paywall's honest "Ways to pay" readout (§9.4);
  single `purchase(adapterId, offering)` entry + `redeem(code)` via B.4.
  **Verify:** `pnpm vitest run packages/billing/tests/registry.test.ts`
  **Accept:** `registry: hides absent rails, exposes present set`.

- [ ] **B.6 — License bridge service.** *(§9.4 bridge, §11 secrets)*
  **Owns:** `services/license-bridge/**` (Cargo.toml, src/main.rs, src/routes/*.rs,
  src/ledger.rs, src/mint.rs, src/codes.rs, .env.example, README.md), tests.
  **Spec:** §9.4: axum; SQLite idempotent ledger PK `(processor, invoice_id)`; webhook
  routes `{prefix}/webhook/{stripe|polar|lemonsqueezy|paypal|square|revenuecat}` each
  verifying that processor's documented HMAC/signature scheme (per current official docs;
  the exact header/secret mapping listed in README); verified event ⇒ mint LicenseToken
  (`ed25519-dalek`, `LICENSE_ED25519_PRIVATE_KEY`) + store issuance + return via
  `POST /verify`; routes: `POST /verify {appUserId}` → token|null + denylist; `POST /redeem
  {code}` (single-use registry, sha256-stored); `POST /mint {appUserId, purchaseRef}` (RC
  path — verifies purchase against RC REST v2 with `RC_SECRET_KEY`); `GET /denylist`
  (signed); `GET /healthz`. Env: six processor webhook secrets + RC keys + signing key +
  `LEDGER_PATH` (§11: no secret ever ships in a client). **Refund/chargeback webhook
  events that identify a fulfilled purchase add the minted jti to the signed deny-list**
  (§9.4 — the only revocation path). Tests: HMAC fixtures, idempotent
  double-webhook, mint+verify roundtrip, redeem reuse, refund→deny-list.
  **Verify:** `cargo test --manifest-path services/license-bridge/Cargo.toml`
  **Accept:** `bridge: 6 webhook fixtures verified idempotently; mint→verify; redeem reuse
  rejected; refund→deny-list revoke`.

---

## Phase C — Companion (§7, §4)

- [ ] **C.1 — Inference host (turboquant).** *(§7.1 inference lane)*
  **Owns:** `apps/local/src-tauri/src/inference/` (mod.rs, llama.rs),
  `apps/local/src/companion/inference-web.ts`, `apps/local/src/companion/lane.ts`,
  `apps/local/src/companion/inference.test.ts`.
  **Spec:** §7.1 exactly: streaming `complete(ctx: FenceContext, onToken)`; native
  llama.cpp (crate `llama-cpp-2` or vendored), web wllama — both lazy-load from M.1
  storage, both configured atomic chat-turboquant: Q4_K_M weights (catalogue default
  tier), KV q8_0 via context params, q4r8 recursor tier when the device allows. Emits
  CompanionEvent tokens.
  **Verify:** `pnpm vitest run apps/local/src/companion/inference.test.ts` (lane selection +
  param mapping with injected engine factory) **Accept:** `inference: turboquant params
  (Q4_K_M, kv q8_0) mapped on both lanes`.

- [ ] **C.2 — Prompt fence + checker.** *(§7.2 three-tier fence)*
  **Owns:** `apps/local/src/companion/fence.ts`, `apps/local/src/companion/persona.ts`,
  tests.
  **Spec:** §7.2 verbatim structure: Tier 1 = serialized ChartFacts in scope + glossary
  definitions (immutable system context — every astrological number she utters must exist
  here); Tier 2 = L.4 fragments with `sourceTurnId` (memory informs continuity, never new
  astrological claims); Tier 3 = live turn + tool results. `checkFence(output, tier1)`:
  parse degrees/orbs/dates/sign-house names from output; every number must match a Tier 1
  value within 0.01° (house/sign names consistent); violation ⇒ one regeneration with the
  violation quoted, then honest absence ("I only say what your chart says"). `persona.ts`
  carries the D13 voice law (warm, approachable, ultra-relatable, never clinical; INC-19).
  Table-driven tests incl. a violating sample.
  **Verify:** `pnpm vitest run apps/local/src/companion/fence.test.ts`
  **Accept:** `fence: clean passes; 0.01° tolerance; violation→regen→absence chain exact`.

- [ ] **C.3 — Tool suite (DOM r/w).** *(§7.3)*
  **Owns:** `apps/local/src/companion/tools.ts`, tests.
  **Spec:** §7.3's five tools: `dom.read` → accessibility-style snapshot from the live DOM
  (root or selector, depth cap; §7.3 masking — input values, `[data-secret]`, keychain
  fields masked at the bridge, never serialized); `dom.write` applies ops after the same
  confirm affordance UI actions use (injected `requestConfirm` rendering the real confirm
  plate; §7.3 no hidden writes); every invocation appends `Turn(role='tool')` with toolOps
  (X.1 repo injection) and feeds the lore pipeline; `chart.open`, `chart.compute` (P.4 via
  P.3 host), `lore.recall` (L.4). §7.3 tools have no network: assert by construction — a
  test greps the file for `fetch(`, `XMLHttpRequest`, `new WebSocket`, `window.open(` and
  fails on any hit.
  **Verify:** `pnpm vitest run apps/local/src/companion/tools.test.ts` (jsdom)
  **Accept:** `tools: read masks secrets, write records turn, no-network grep clean`.

- [ ] **C.4 — Companion event bus.** *(§4 event bus, §10 Stage signals)*
  **Owns:** `apps/local/src/companion/bus.ts`, tests.
  **Spec:** §4's typed bus for the CompanionEvent union (token, turn, chart-computed,
  envelope, error): `subscribe(type, fn)` unsubscribe handle. §10's `StageSignal` union =
  `CompanionEvent ∪ {engine-load(fraction), model-presence(bool), composer-focus(bool)}`
  — asleep/waking/listening ride capability signals, not bus events; the `envelope` member
  is three-valued — `envelope-start`, `envelope-level(0..1)` per 20 ms window,
  `envelope-end` (stream close or 120 ms silence, §10); `Speaking` spans start→end.
  Replay-buffered
  `stageState$` reducer over StageSignal (§10 + STATES.md): Thinking on request-sent (no
  tokens yet), Speaking while the envelope plays, Delighted on chart-computed/unlock,
  Error on engine failure, Asleep from model-presence=false, Waking from engine-load
  progress — pure reducer exported for U.9.
  **Verify:** `pnpm vitest run apps/local/src/companion/bus.test.ts`
  **Accept:** `bus: StageSignal→stage reducer sequence request-sent→Thinking→Speaking→Idle exact`.

---

## Phase V — Voice (§10, D7/D7a)

- [ ] **V.1 — Kokoro native (Rust).** *(§10 native leg, D7)*
  **Owns:** `apps/local/src-tauri/src/voice/` (mod.rs, kokoro.rs, audio.rs), Rust tests.
  **Reads:** T0.3 `apps/local/src-tauri/Cargo.toml`.
  **Spec:** §10 + D7: synthesis and playback fully native in Rust — onnxruntime session
  (crate `ort`) loading mirror Kokoro ONNX + voices (§13 manifest `voice`/`voices` kinds);
  sentence-chunked synthesis queue; playback via cpal; RMS envelope (per 20 ms window,
  normalized 0–1) emitted as CompanionEvent envelope; mute persisted via config store
  command. Unit tests: chunking + envelope math over a synthetic PCM fixture;
  model-dependent tests behind `#[ignore]` with a real-file runner.
  **Verify:** `cargo test --manifest-path apps/local/src-tauri/Cargo.toml voice`
  **Accept:** `voice native: chunking + RMS envelope fixtures pass`.

- [ ] **V.2 — Kokoro web + ban guard.** *(§10 web leg, D7a)*
  **Owns:** `apps/local/src/voice/web.ts`, `apps/local/src/voice/envelope.ts`,
  `scripts/grep-no-speechsynthesis.sh`, tests.
  **Spec:** D7a: Kokoro in the browser — onnxruntime-web (WASM; WebGPU when
  `navigator.gpu`) synth → AudioWorklet playback → shared `envelope.ts` RMS (same math as
  V.1) → bus. §10/DESIGN ban: `speechSynthesis` is never called on any leg — the owned
  script greps `apps/**/src/**` (ts, tsx, rs) for `speechSynthesis` and exits 1 on hit;
  R.7's CI hook calls it.
  **Verify:** `pnpm vitest run apps/local/src/voice && bash scripts/grep-no-speechsynthesis.sh`
  **Accept:** `voice web: envelope fixtures pass; speechSynthesis: 0 hits`.

---

## Phase U — UI (React; each screen owns its dir — §1, §3, DESIGN.md)

- [ ] **U.1 — Shell, router contract, primitives.** *(§3 routes, DESIGN components)*
  **Owns:** `apps/local/src/ui/shell.tsx`, `apps/local/src/ui/router.ts` (contract +
  registry type), `apps/local/src/ui/primitives/` (Button, Chip, TopBar, Composer,
  PlateCard, TurnHer, TurnYou), `apps/local/src/ui/glyphs.tsx`, `apps/local/src/ui/version.tsx`.
  **Spec:** primitives mirror the Components page 1:1 with STATE-LEDGER ids in doc
  comments (STATE-LEDGER is canonical for component node-ids — DESIGN.md's Stage row is
  stale pending the operator re-clearance, see `pendingFixes`); glyph set loaded from
  `LIBS/UI/FIGMA/glyphs/natally-glyphs.svg` (owns the `apps/local/src/assets/glyphs/`
  copy). §3 hash router, exactly: `/`, `/atlas/:plate`, `/people`, `/people/:id`,
  `/settings`, `/paywall`, `/checkout`, `/about`; each screen registers
  `registerRoute({path, load})` into a module-owned registry (I.1 consolidates imports).
  Version stamp `data/micro` bottom-right on every surface (TOKENS text styles).
  Storybook-free visual tests: render primitives against token CSS in jsdom + assert
  class/theme wiring.
  **Verify:** `pnpm vitest run apps/local/src/ui/primitives`
  **Accept:** `primitives: 7 components, tokens.css vars applied, routes typecheck`.

- [ ] **U.2 — Conversation screen.** *(§1 conversation-first, §9.2 states, DESIGN grammar)*
  **Owns:** `apps/local/src/screens/conversation/`.
  **Spec:** all 9 variants per SCREEN.md + STATE-LEDGER (Idle, Thinking, Speaking, Asleep,
  Error, TrialIdle, TrialExhausted, RateLimited, Desktop). DESIGN transcript grammar: her
  turns as page text with `voice/name` + gilt margin glyph (no bubbles); yours
  right-aligned in an orbglow hairline box; plates as midnight/2 cards with
  provenance foot + Open. Trial chip from B.1 state (§9.2 designed outcomes); composer
  gating (TrialExhausted replacement block); Stage mounts U.9; binds C.4 bus. INC-19
  rendering: computed → Plex Mono, generated → margin glyph, absence → voice/aside
  treatment. jsdom tests per variant with scripted events.
  **Verify:** `pnpm vitest run apps/local/src/screens/conversation`
  **Accept:** `conversation: 9 variants render against event scripts`.

- [ ] **U.3 — Plates + Atlas screens.** *(§1 plates→Atlas, §6 data)*
  **Owns:** `apps/local/src/screens/plate-natal/`, `apps/local/src/screens/atlas/`.
  **Spec:** plate cards (natal withHouses/timeUnknown per STATE-LEDGER); Atlas natal/
  synastry/today; wheel renderer (owns `apps/local/src/ui/wheel.tsx` — 272 px structure,
  AC/MC labels, cusps placed from ChartFacts at runtime, zodiac ramp per sign, aspects
  table with orb + applying/separating, 12-house-system chip selector = the §6 pinned set
  P K O R C A V W T X B U, bi-wheel for synastry — no score, no label, ever, INC-19);
  honest-absence branches J1/J3/J4/J5. Render tests assert cusp angles from fixture
  ChartFacts.
  **Verify:** `pnpm vitest run apps/local/src/screens/atlas apps/local/src/screens/plate-natal`
  **Accept:** `atlas: 3 views render; wheel cusp angles match fixtures ±0.5°`.

- [ ] **U.4 — People + first-light.** *(§1 intake, J1/J3)*
  **Owns:** `apps/local/src/screens/people/`, `apps/local/src/screens/first-light/`.
  **Spec:** conversational intake (name/date/place/time-or-unknown; instant computed fact
  after each answer via P.4 — J1); privacy explainer, two-lane local wording (§11); people
  list (name · sun glyph · date · place · time-known marker; add/edit/remove — remove runs
  X.1's `removePerson` cascade behind a `requestConfirm` plate (§8.4) — with export-first
  nudge — J3; X.1 repo injection).
  **Verify:** `pnpm vitest run apps/local/src/screens/people apps/local/src/screens/first-light`
  **Accept:** `intake: 4-step flow yields Person + first computed fact; unknown-time branch`.

- [ ] **U.5 — Settings screen.** *(§8.4 controls, §9.1 model rows, DESIGN sections)*
  **Owns:** `apps/local/src/screens/settings/`.
  **Spec:** sections exactly per amended SCREEN.md: House system (12 chips — the §6 pinned
  set), Model catalogue (from M.1; real download progress %, storage used, remove,
  trialEligible flag + lock routing to `/paywall` — §9.1 J6), Voice (Kokoro picker,
  preview, mute — V.1/V.2 injection), License (status from B.1/B.3, Restore → B.5c, Enter
  a code → `/paywall` enter-code state), Data (export/import/deleted via X.1/X.2; Lore
  summary line `[turns · nodes]` from L.5 `stats()` — §8.4), About link. Mobile + web
  (1280) layouts per STATE-LEDGER.
  **Verify:** `pnpm vitest run apps/local/src/screens/settings`
  **Accept:** `settings: 6 sections render; trial-lock and license states bind`.

- [ ] **U.6 — Paywall + checkout screens.** *(§9.4, DESIGN commerce law)*
  **Owns:** `apps/local/src/screens/paywall/`, `apps/local/src/screens/checkout/`.
  **Spec:** all frames per SCREEN.md (paywall 7, checkout 6, per STATE-LEDGER); bind B.5c
  registry (the honest "Ways to pay" line, §9.4), B.1 gate states, B.4 redeem with the 4
  outcomes, B.5a handoff (QR rendered from the real checkout URL via an owned qrcode wasm
  dep; link line), license-key entry (`enter-license-key`, §9.4). DESIGN commerce law:
  her voice, never a storefront's; one gilt primary per screen (the unlock CTA); prices/
  counters/processor lists are runtime data (bracketed markers, never sample prose); no
  countdown timers, no pressure copy; Delighted on success via bus (J10/J11).
  **Verify:** `pnpm vitest run apps/local/src/screens/paywall apps/local/src/screens/checkout`
  **Accept:** `commerce: 13 variants render; gate→CTA→handoff→success chain binds`.

- [ ] **U.7 — About + glossary-callout.** *(§5 authored provenance, D9)*
  **Owns:** `apps/local/src/screens/about/`, `apps/local/src/screens/glossary/`.
  **Spec:** About — version, license line AGPL-3.0-or-later (the frozen spec drift fix:
  not "proprietary"; D9), provenance lines for ephemeris (§6) and Kokoro; glossary callout
  per glyph with authored-static body (`What it is` / `In synastry`, §5 `authored`) +
  "Ask natally about this" posting the term into the conversation via bus (J2).
  **Verify:** `pnpm vitest run apps/local/src/screens/about apps/local/src/screens/glossary`
  **Accept:** `about+glossary: license line AGPL; 35 glyph entries open`.

- [ ] **U.8 — Splash.** *(§4 real progress only)*
  **Owns:** `apps/local/src/screens/splash/`.
  **Spec:** wordmark + real engine-load progress only (ephemeris table-mount events from
  P.3; §10 waking law — no fabricated progress, DESIGN anti-pattern list); ready → route
  to conversation or first-light by people count via X.1; desktop variant per STATE-LEDGER.
  **Verify:** `pnpm vitest run apps/local/src/screens/splash`
  **Accept:** `splash: progress binds to engine events; routes by people count`.

- [ ] **U.9 — Stage (mascot).** *(§10 + STATES.md real-vs-composed)*
  **Owns:** `apps/local/src/ui/stage.tsx`, `apps/local/src/assets/mascot/` (copies from
  LIBS/UI/FIGMA/mascot/), `apps/local/src/ui/stage.test.tsx`.
  **Spec:** 8 states driven only by C.4's `StageSignal` (STATES.md table): idle loop (webp)
  is the only real footage; waking/thinking/speaking/delighted/error/asleep/listening are
  composed overlays (SVG/glyph + envelope ring; asleep = no model, listening = composer
  focus); envelope drives orb+mouth scale (§10); reduced-motion freezes frame 0 and
  disables the plate slide (§12 a11y floor).
  **Verify:** `pnpm vitest run apps/local/src/ui/stage.test.tsx`
  **Accept:** `stage: 8 states map to StageSignal; envelope scales orb; reduced-motion honored`.

---

## Phase M — Mirror & models (§13)

- [ ] **M.1 — Manifest, downloads, catalogue.** *(§13 mirror contract)*
  **Owns:** `apps/local/src/mirror/` (manifest.ts, download.ts, cache.ts, catalogue.ts),
  tests.
  **Reads:** T0.7 types. **Spec:** §13 verbatim: fetch `manifest.json` from
  `VITE_MODEL_MIRROR_BASE` (host allowlist = mirror + bridge, §11); a **free-space
  precondition** (asset size + 10 %) checked before each download starts — failure is an
  honest error (§13); ranged resumable
  download to the platform cache (native dir via command, web Cache Storage); sha256
  verify before commit (streaming digest), atomic rename; catalogue store (present →
  downloading %, bytes; remove = files + rows); `trialEligible` honoured by B.1/U.5 (§9.1).
  Tests with a local fixture server + tiny files.
  **Verify:** `pnpm vitest run apps/local/src/mirror`
  **Accept:** `mirror: resume + sha256 + atomic commit; corrupted blob rejected`.

---

## Phase X — Persistence app layer (§5 export, §8.4 deletion)

- [ ] **X.1 — Repositories + export/import.** *(§5 ExportDocument, J8)*
  **Owns:** `apps/local/src/data/` (db.ts adapters wiring T0.9 to native/web, people.ts,
  sessions.ts, turns.ts, charts.ts, export.ts, import.ts), tests.
  **Reads:** T0.9 DDL, L.1 `exportAll()`. **Spec:** repos for Person/Session/Turn/ChartFacts
  per the T0.9 tables; `exportAll()` → ExportDocument v1 (§5: people, sessions, turns,
  chart **inputs**, lore via L.1, consumedCodes); `importDocument(doc)` merges by personId
  and lore nodeId — never deletes; same personId with divergent birth data ⇒ **existing
  wins**, incoming birth fields ignored, one row in the returned report
  `{merged, skipped, conflicts[]}` (§8.4); `removePerson(personId)` = real deletion of the
  person, their `kind=person` lore node + incident edges, and their cached charts;
  sessions/turns persist as transcript history (§8.4); §11: exported JSON is plaintext by
  design and the UI says so. Deterministic export fixture roundtrip.
  **Verify:** `pnpm vitest run apps/local/src/data`
  **Accept:** `data: CRUD roundtrip; export→wipe→import restores equivalently; conflicts
  reported with existing wins; removePerson cascades lore+charts and keeps the transcript`.

- [ ] **X.2 — Delete-everything.** *(§8.4 real deletion)*
  **Owns:** `apps/local/src/data/destroy.ts`, tests.
  **Spec:** §8.4 "deletion is real deletion, not soft-hide": all app table rows + lore
  rows + vectors + downloaded model files (M.1 cache) + keychain token (B.3 injection) +
  license_state; returns `{tablesCleared, filesDeleted, tokenCleared}`; the confirm
  affordance lives in U.5 (injected).
  **Verify:** `pnpm vitest run apps/local/src/data/destroy.test.ts`
  **Accept:** `destroy: 0 rows remain across all app tables (9 without vec; 10 with); files
  removed; token cleared`.

---

## Phase G — Content (§5 authored, §8.3 gazetteer)

- [ ] **G.1 — Glossary + gazetteer.**
  **Owns:** `apps/local/src/content/glossary.json`, `apps/local/src/content/gazetteer.json`,
  `apps/local/src/content/index.ts`, tests.
  **Spec:** GlossaryEntry per glyph — 35 (12 signs, 11 bodies, 2 nodes, 7 aspects,
  retrograde, applying, separating; TOKENS.md glyph decomposition, `natally-glyphs.svg`
  set) — each with authored-static `What it is` body (§5 `authored`; INC-19) + synastry
  notes where applicable (glossary-callout screen); gazetteer for L.3 (§8.3): ~100 major
  cities seeded + reflexive user-entered places at runtime; typed loaders from `index.ts`.
  **Verify:** `pnpm vitest run apps/local/src/content`
  **Accept:** `content: 35 entries, all four fields present, gazetteer loads`.

---

## Phase S — Assets (§3 self-hosted fonts, fragility ethos)

- [ ] **S.1 — Fonts self-host.**
  **Owns:** `apps/local/public/fonts/` (woff2 files), `apps/local/src/styles/fonts.css`.
  **Spec:** §3 + CLAUDE.md fragility ethos: Fraunces (SemiBold, Italic), Nunito Sans
  (Regular, SemiBold), IBM Plex Mono (Regular, Medium) as self-hosted woff2,
  `font-display: swap`; `@font-face` in `fonts.css`, imported from `global.css` at the
  `/* S.1 fonts */` contract (T0.2 reserved). Files from the operator's licensed font set;
  source documented in an owned `FONT_PROVENANCE.md`.
  **Verify:** `bash -c 'ls apps/local/public/fonts/*.woff2 | wc -l'`
  **Accept:** `6 woff2 present + fonts.css parses (css parse test)`.

---

## Phase I — Integrators (⛓ idempotent consolidators; safe to re-run anytime, in any order after their inputs exist)

- [ ] **I.1 — Route registry wiring.** ⛓ *(§3 route set → registry module)*
  **Owns:** `apps/local/src/ui/routes.generated.ts`, `apps/local/scripts/gen-routes.mjs`.
  **Reads:** U.1 router contract; T0.2 `apps/local/tsconfig.standalone.json`.
  **Spec:** generate (owned script) the static import list of every `registerRoute` call
  site under `src/screens/**`; emit the registry module the U.1 router consumes;
  re-running regenerates identically.
  **Verify:** `node apps/local/scripts/gen-routes.mjs && pnpm --filter @natally/local exec
  tsc --noEmit -p tsconfig.standalone.json`
  **Accept:** `routes.generated.ts lists all implemented screens; typecheck clean`.

- [ ] **I.2 — Tauri command registry wiring.** ⛓ *(§3 native core → macro expansion)*
  **Owns:** `apps/local/src-tauri/src/registry_generated.rs`.
  **Reads:** T0.3 `apps/local/src-tauri/Cargo.toml`. **Spec:** macro expansion list of
  every `natally_plugin!` module under src-tauri (lore, inference, voice, keychain,
  mirror-cache); regenerate on change.
  **Verify:** `cargo check --manifest-path apps/local/src-tauri/Cargo.toml`
  **Accept:** `registry builds; invoke_handler covers all registered commands`.

- [ ] **I.3 — Capability layer resolution.** ⛓ *(§4 capability layer law)*
  **Owns:** `apps/local/src/capabilities.ts`, `apps/local/src/capabilities.test.ts`.
  **Spec:** §4 "selected by a capability layer — never by `if (platform)` scattered
  through components": single map `{db, inference, voice, keychain, opener} → {native,
  web}` implementations (imports only; selection by `window.__TAURI__` presence); a test
  greps `src/` for `__TAURI__` outside this file and fails on any hit.
  **Verify:** `pnpm vitest run apps/local/src/capabilities.test.ts`
  **Accept:** `capabilities: single selection point; grep clean elsewhere`.

- [ ] **I.4 — Full workspace gate.** ⛓ *(§12 performance mandates as checks)*
  **Owns:** `scripts/assert-budget.mjs`.
  **Reads:** T0.1 `scripts/check.sh`; V.2 `scripts/grep-no-speechsynthesis.sh`.
  **Spec:** the standing gate: `./scripts/check.sh` (T0.1) + the V.2 ban grep + an owned
  bundle-budget assert (`scripts/assert-budget.mjs`): built web initial JS ≤ 300 KB gz
  (§12).
  **Verify:** `./scripts/check.sh && node scripts/assert-budget.mjs`
  **Accept:** `workspace: typecheck+lint+tests green; budget ≤ 300 KB gz; ban greps 0`.

---

## Phase R — Build & release (§14, D8, §6 license-lint)

- [ ] **R.1 — build-linux.sh.** *(§14)* **Owns:** `scripts/build-linux.sh`. AppImage + deb
  via `tauri build`; artifacts → `dist/mba.robin.natally-v<version>-linux.{AppImage,deb}`
  (§14 naming); version stamp pre-build; `set -euo pipefail`; idempotent (skip if the
  artifact exists at the same version unless `--force`). **Verify:** `bash -n
  scripts/build-linux.sh && bash scripts/build-linux.sh --dry-run` (owns the dry-run flag)
  **Accept:** `dry-run prints artifact names + version stamp plan`.

- [ ] **R.2 — build-windows.sh.** *(§14 + D8)* **Owns:** `scripts/build-windows.sh`.
  Host-detecting per D8: Linux host → `cargo-xwin` exe + NSIS bundle; Windows host → msi +
  msix. Dist naming `-win.exe/-setup.exe/-win.msi/-win.msix`. **Verify:** `bash -n` +
  `--dry-run` **Accept:** `dry-run prints per-host plan (xwin vs msi/msix)`.

- [ ] **R.3 — build-android.sh.** *(§14)* **Owns:** `scripts/build-android.sh`. apk + aab
  via `tauri android build`; versionCode from `version.json` (`MAJOR*100000+MINOR` — the
  stamper's formula). **Verify:** `bash -n` + `--dry-run` **Accept:** `dry-run prints
  apk/aab names + versionCode`.

- [ ] **R.4 — build-web.sh (PWA).** *(§3 web leg, §14)* **Owns:** `scripts/build-web.sh`,
  `apps/local/public/manifest.webmanifest`, `apps/local/src/sw.ts`,
  `apps/local/src/sw.test.ts`.
  **Spec:** vite build → `dist/web` — first-class stamped artifact (§14, R1 lineage); PWA
  manifest (name natally, identity `mba.robin.natally`, dark theme `#120C1C`); service
  worker: cache-first for hashed assets + fonts, network-only for mirror/bridge — never
  caches POSTs (§11 egress law). **Verify:** `bash scripts/build-web.sh --dry-run && pnpm
  vitest run apps/local/src/sw.test.ts` **Accept:** `web: artifact name printed; SW
  strategy map exact`.

- [ ] **R.5 — build-all.sh + release flow.** *(§14)* **Owns:** `scripts/build-all.sh`.
  **Spec:** honours `release.lock` (single-flight; refuses concurrent runs), sequences
  R.1–R.4 (or `--only linux,web`), post-build bump via `scripts/update-version.sh
  --post-build` (the stamper's existing mode). **Verify:** `bash -n` + `--dry-run`
  **Accept:** `dry-run sequences all targets; lock acquire/release printed`.

- [ ] **R.6 — Version stamping wiring.** *(§14, SC3 version surfaces)* **Owns:**
  `scripts/update-version.sh`.
  **Spec:** add a read-only `--check` mode (exit 0 when every version surface agrees;
  nonzero otherwise; never writes). Migrate the manifest guards to the monorepo paths they
  silently miss today: `apps/local/src-tauri/tauri.conf.json`,
  `apps/local/src-tauri/Cargo.toml`, `apps/local/src-tauri/gen/android/tauri.properties`
  (current guards point at the pre-monorepo root and no-op). Default stamp behaviour and
  `--post-build` unchanged (house flow — no hardening).
  **Verify:** `bash scripts/update-version.sh --check` **Accept:** `version check:
  consistent (version.txt = version.json = package.json = apps/local/src-tauri/tauri.conf.json
  = apps/local/src-tauri/Cargo.toml)`.

- [ ] **R.7 — Dormant CI + guards.** *(§14 CI list, §6 license-lint)* **Owns:**
  `.github/workflows/check.yml` (workflow_dispatch/labeled only — dormant until public
  release per CLAUDE.md), `scripts/license-lint.mjs`.
  **Spec:** the dormant job runs the I.4 suite; license-lint enforces §6's AGPL posture
  both directions: fail if any `sweph` import exists while `package.json.license ≠
  AGPL-3.0-or-later`, or a proprietary license is claimed while sweph is present.
  **Verify:** `node scripts/license-lint.mjs` **Accept:** `license-lint: AGPL + sweph
  consistent (state OK)`.

---

## Completion criteria

All tasks `[X]` and ✅, plus I.4 green end-to-end, equals the local-app production snapshot
of `DOCS/ARCHITECTURE.md` (§1–§15). Gate-2 sibling `DOCS/TEST_RUBRIC.md` then formalizes
the cross-task acceptance matrix (conformance tolerances, fence adversarial suite, J1–J11
journey walks, §12 budget asserts) before `src/` PRs are merged — coders execute only the
tasks above, in any order, one subagent per task, each seeing exactly one block.
