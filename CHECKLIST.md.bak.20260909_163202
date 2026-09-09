# natally — implementation checklist (Gate 2 document 2 of 3)

Translated 1:1 from `DOCS/ARCHITECTURE.md` (2026-09-04, D10–D14 complement). Every task is
**atomic**, **idempotent** (re-running after completion changes nothing and exits 0),
**order-independent** (any task may run before or after any other, in parallel, with two
explicit exceptions marked ⛓), and **self-contained**: a subagent given exactly one task
block — plus `DOCS/ARCHITECTURE.md` for background — can finish it in one pass.

Sibling document: `DOCS/TEST_RUBRIC.md` (pending; task-level Verify lines here are the
executable subset of it).

## Execution protocol (house rules, CC/TC compliant)

- Marker protocol: `[ ]` untouched · `[/]` in progress or blocked (append ` — blocked: <reason>`
  when a **Reads** dependency is absent; never fake an Accept) · `[X]` implemented · `✅` only
  when the **Verify** command ran and its output matched the **Accept** line.
- Coordination is closed at architecting time, not execution time: the translation from
  `DOCS/ARCHITECTURE.md` to this checklist partitioned the entire surface into
  **pairwise-disjoint Owns sets** — no two tasks share an owned file, and shared seams are
  contract files owned by exactly one task each. Execution therefore needs no inter-task
  awareness, ordering, locking, or merging; a task block is its executor's whole world.
- Executors are scoped to exactly **one task block**. Reading other task blocks is out of
  scope — the checklist is a dispatch ledger for the orchestrator, not shared context for
  workers. A worker's inputs are: its assigned block, `DOCS/ARCHITECTURE.md`, and the repo
  itself (its **Reads**). If a task seems to require touching another task's files, that is
  a checklist defect: stop, mark `[/] blocked: cross-task need <…>`, and report — never
  improvise cross-task edits.
- **Owns** = the only files the task may create/modify. **Reads** = files it imports or
  consults; they may not exist yet (out-of-order execution) — write imports against them
  anyway; full-workspace typecheck is deferred to I.4.
- Verifies are scoped to owned files (unit-level, local fixtures) so they pass regardless of
  other tasks' state. The ⛓ integrator tasks are regenerators, not coordinators — they
  rebuild registries from whatever exists when they run.
- No mocks/stubs in shipped code; test utilities that are real injectable implementations
  (e.g. a deterministic embedder) live under the owning package's `tests/` and are never
  imported by `src/`.
- Stack law (ARCHITECTURE §3): TS `strict`, React 19, Tailwind 4 `@theme`, Vite, pnpm
  workspace, Rust for native core. Commits follow `v{VERSION}: ` via `scripts/update-version.sh`.

## Entity ownership map (exhaustive)

| Entity (ARCHITECTURE §5 + runtime) | Defined by | Persisted/owned by task |
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
| CompanionEvent, DomWriteOp, CompanionTool | T0.6 | C.3, C.4 |
| ExportDocument (exportVersion) | T0.6 | X.1 |
| StageState (mascot) | U.9 | U.9 |
| Route entries | U.1 (contract) | I.1 (registry) |

---

## Phase T — Scaffolding & contracts

- [ ] **T0.1 — Workspace scaffold.**
  **Owns:** `pnpm-workspace.yaml`, root `package.json` (rewrite — version stamp preserved),
  `tsconfig.base.json`, `biome.json`, `.prettierrc`, `vitest.workspace.ts`, `scripts/check.sh`.
  **Spec:** pnpm workspace packages `apps/*`, `packages/*`; TS `strict`, `moduleResolution:
  bundler`, path alias `@natally/*` → `packages/*/src`; Biome lint+format (rules: no `any`,
  no `console` in `src/`); vitest workspace with per-package projects; `scripts/check.sh`
  runs `pnpm -r typecheck && pnpm -r lint && pnpm vitest run --silent`. Dev deps pinned:
  typescript@5.9, vite@7, vitest@3, @biomejs/biome@2, tailwindcss@4, react@19,
  react-dom@19, @tauri-apps/cli@2. Keep existing `scripts/update-version.sh` and `version`
  script wired. **Verify:** `pnpm install --frozen-lockfile=false && ./scripts/check.sh`
  **Accept:** `workspace: 0 test files, typecheck+lint clean` (empty workspace passes).

- [ ] **T0.2 — apps/local frontend scaffold.**
  **Owns:** `apps/local/package.json`, `apps/local/vite.config.ts`, `apps/local/tsconfig.json`,
  `apps/local/index.html`, `apps/local/src/main.tsx`, `apps/local/src/app.tsx`,
  `apps/local/src/styles/global.css`, `apps/local/public/` (empty `.gitkeep`).
  **Reads:** T0.1, T0.8. **Spec:** Vite + React 19 entry that renders `<NatallyApp/>`;
  `global.css` imports `@natally/design-tokens/tokens.css` and sets `midnight` ground,
  self-hosted font `@font-face` declarations live in S.1 (import site reserved via comment
  contract `/* S.1 fonts */`); Tailwind 4 via `@import "tailwindcss"` in global.css with
  `@source` pointing at `../src`; `main.tsx` mounts router shell export from U.1 **as a
  lazy dynamic import with a real loading absence element** (dark, wordmark, nothing fake).
  **Verify:** `pnpm --filter @natally/local exec vite build` after I-tasks OR standalone:
  `pnpm --filter @natally/local exec tsc --noEmit -p tsconfig.standalone.json` where you also
  create `tsconfig.standalone.json` (owns it) that excludes router import.
  **Accept:** `built standalone entry OK` (tsc exits 0; vite build accepted after I.1).

- [ ] **T0.3 — src-tauri scaffold.**
  **Owns:** `apps/local/src-tauri/` (Cargo.toml, tauri.conf.json, build.rs, src/main.rs,
  src/lib.rs, capabilities/default.json).
  **Spec:** Tauri 2 app `mba.robin.natally`; dev server `http://localhost:5173`; window
  430×932 min, dark; `lib.rs` defines `#[tauri::command]` modules via a **static command
  registry macro** (`natally_plugin!`) so feature tasks register commands from their own
  files without editing lib.rs; Android build config (applicationId `mba.robin.natally`);
  no plugins yet. `main.rs` calls the registry builder. Cargo deps: tauri@2, tokio, serde,
  serde_json, rusqlite (bundled), thiserror.
  **Verify:** `cargo check --manifest-path apps/local/src-tauri/Cargo.toml`
  **Accept:** `Finished` with 0 errors.

- [ ] **T0.4 — Token mirror test (design-tokens contract verification).**
  **Owns:** `packages/design-tokens/tests/tokens.test.ts`.
  **Reads:** T0.8. **Spec:** test parses `tokens.css` `@theme` block and asserts: 8 colour
  vars + 12 zodiac vars + 4 radius + 6 space + stroke + 3 size; every
  `--color-*`/`--spacing-*` name matches the `CSS` column of `LIBS/UI/FIGMA/TOKENS.md`
  (parse the markdown table in-repo); hex values equal TOKENS.md hex column.
  **Verify:** `pnpm vitest run packages/design-tokens`
  **Accept:** `tokens: 35 variables mirrored exactly`.

- [ ] **T0.5 — Ephemeris contracts.**
  **Owns:** `packages/ephemeris/src/types.ts`, `packages/ephemeris/src/seam.ts`,
  `packages/ephemeris/package.json`, `packages/ephemeris/tsconfig.json`.
  **Spec:** verbatim from ARCHITECTURE §6: `EphemerisEngine` (id, init(cfg), position, cusps,
  aspects, chiron?); `Body` = 11 bodies + 'chiron' | 'north-node' | 'south-node';
  `HouseSystem` = the 12 (P, K, O, R, C, A, E, W, T, B, M, 'GO'? — enumerate: Placidus,
  Koch, Porphyry, Regiomontanus, Campanus, Equal, WholeSign, Topocentric, Meridian,
  Alcabitius, Vehlow-equal, Kroonenhouse-generic — if sweph id differs use its 1-char codes;
  the set is fixed by sweph-wasm's `hsys` parameter domain); `OrbTable` (conjunction 8,
  opposition 8, trine 7, square 7, sextile 4, quincunx 3, semisextile 2 — defaults,
  overridable); `ChartFacts` (id: content hash, inputs {ut[], place, system}, positions:
  Array<{body, lon, lat, speed}>, cusps?: number[12]+asc+mc+armc, aspects: Aspect[]);
  `Aspect {a, b, type, orb, applying: boolean}`; `EclipticPosition`.
  Export all as `.ts` types + zod schemas (add zod dep).
  **Verify:** `pnpm vitest run packages/ephemeris/tests/types.test.ts` (write it; owns it)
  **Accept:** `seam types: schema roundtrip OK`.

- [ ] **T0.6 — Lore & conversation contracts.**
  **Owns:** `packages/lore/src/types.ts`, `packages/lore/src/store.ts` (interface only),
  `packages/lore/package.json`, tsconfig.
  **Spec (ARCHITECTURE §5, §8):** `LoreNode {id, kind: 'person'|'fact'|'event'|'thread'|'place',
  summary, embedding: number[], refs[]}`; `LoreEdge {from, to, rel: 'mentions'|'relates'|
  'follows'|'contradicts', weight, sourceTurnId}`; `Turn {id, sessionId, personId?, role:
  'you'|'her'|'tool', text, ts, toolOps?: DomWriteOp[]}`; `DomWriteOp {selector, op:
  'setattr'|'text'|'class'|'focus'|'scroll', value}`; `CompanionEvent` union (token, turn,
  chart-computed, envelope, error); `LoreStore` interface: `query(personId?, q, k, budget)`,
  `upsertTurn(turn, embedding)`, `exportAll()`, `deleteAll()`, `stats()`; `ExportDocument
  {exportVersion: 1, people, sessions, turns, charts(inputs only), loreNodes, loreEdges,
  consumedCodes}`. Pure types + zod; zero imports outside package.
  **Verify:** `pnpm vitest run packages/lore/tests/types.test.ts`
  **Accept:** `lore types: roundtrip OK`.

- [ ] **T0.7 — Billing contracts.**
  **Owns:** `packages/billing/src/types.ts`, `package.json`, tsconfig.
  **Spec (ARCHITECTURE §9):** `TrialPolicy {mode: 'count'|'time'|'rate', readings?: number,
  days?: number, cooldownDays?: number, trialModel: string}`; `Reading {id, ts, personId,
  chartId}`; `LicenseToken` = compact COSE-style string, payload type `{sub: appUserId, tier:
  'unlimited', iat, exp: null, iss: 'natally-license-bridge', jti}`; `ConsumedCode {codeHash,
  redeemedAt}`; `Offering {id, priceString, tier, durationIso?}`; `CheckoutSession {kind:
  'redirect'|'iap'|'rc', url?, offering}`; `PurchaseAdapter` (id set: stripe/revenuecat/
  polar/lemonsqueezy/paypal/square; available(); checkout(); restore()); `ConsumeResult
  {allowed, reason?: 'trial-exhausted'|'rate-limited'|'unlicensed'|'insufficient-credit'}`;
  `DenyList {issuedAt, revokedJti[]}` signed envelope type; `ModelManifest {version,
  assets: ManifestAsset[]}`, `ManifestAsset {id, kind: 'llm'|'embedder'|'voice'|'voices',
  file, bytes, sha256, quant?, trialEligible?}`.
  **Verify:** `pnpm vitest run packages/billing/tests/types.test.ts`
  **Accept:** `billing types: roundtrip OK`.

- [ ] **T0.8 — Design tokens package.**
  **Owns:** `packages/design-tokens/tokens.css`, `package.json`, `src/index.ts`.
  **Reads:** `LIBS/UI/FIGMA/TOKENS.md`, `STATE-LEDGER.json` (read-only).
  **Spec:** `tokens.css` = Tailwind 4 `@theme` block mirroring TOKENS.md one-to-one (colour,
  radius, spacing, stroke, size custom properties exactly as the `CSS` column; zodiac as
  `--color-z-<sign>`). `src/index.ts` exports the same as frozen TS const objects parsed
  once (no hand-duplicated values — parse tokens.css at build via a tiny owned script
  `scripts/gen.mjs`, output committed). **Verify:** `node packages/design-tokens/scripts/gen.mjs
  --check` **Accept:** `tokens.css in sync with TOKENS.md (35 vars)`.

- [ ] **T0.9 — SQLite DDL & migration runner.**
  **Owns:** `packages/lore/src/ddl.ts` (shared store DDL used by both lore and app tables —
  single ownership to keep parallel tasks disjoint), `packages/lore/src/migrate.ts`.
  **Spec:** `MIGRATIONS: {id, sql}[]` executed in order, recorded in `_migrations`. Tables
  (all entities, ARCHITECTURE §5/§8/§9):
  `people(id TEXT PK, name TEXT NOT NULL, birth_date TEXT NOT NULL, birth_time TEXT,
  time_known INTEGER NOT NULL, place TEXT NOT NULL, created_at INTEGER)`;
  `sessions(id TEXT PK, person_id TEXT REFERENCES people, started_at INTEGER)`;
  `turns(id TEXT PK, session_id TEXT NOT NULL REFERENCES sessions, person_id TEXT,
  role TEXT CHECK(role IN ('you','her','tool')), text TEXT NOT NULL, ts INTEGER,
  tool_ops TEXT)`; `charts(id TEXT PK, inputs_json TEXT NOT NULL, facts_json TEXT NOT NULL,
  computed_at INTEGER)`; `readings(id TEXT PK, ts INTEGER, person_id TEXT, chart_id TEXT)`;
  `consumed_codes(code_hash TEXT PK, redeemed_at INTEGER)`; `license_state(id INTEGER PK
  CHECK(id=1), token TEXT, verified_at INTEGER)`; `lore_nodes(id TEXT PK, kind TEXT, summary
  TEXT, embedding BLOB, refs_json TEXT)`; `lore_edges(from_id TEXT, to_id TEXT, rel TEXT,
  weight REAL, source_turn_id TEXT, PRIMARY KEY(from_id,to_id,rel,source_turn_id))`;
  `vec_nodes(virtual, sqlite-vec)` — emitted only when the vec extension loads (runner takes
  `extensions: boolean`). `migrate(db, {vec:boolean})` idempotent.
  **Verify:** `pnpm vitest run packages/lore/tests/ddl.test.ts` (in-memory better-sqlite3
  dev-dep; vec-off path) **Accept:** `migrations: fresh + re-run both OK (10 tables)`.

- [ ] **T0.10 — Config loader.**
  **Owns:** `apps/local/src/config.ts`, `packages/billing/src/config.ts`.
  **Spec:** typed `loadConfig(env)` reading the `.env.example` variables verbatim
  (ARCHITECTURE §15): trial block with validation (exactly one mode populated; trialModel
  required non-empty), 6 processor values (blank → rail absent), bridge URL, mirror base,
  app URL, lore flags + embed dim (384 default). Export `RuntimeConfig` frozen object +
  `paymentsAvailable()` derived list. zod-validated; throws with field names on bad env.
  **Verify:** `pnpm vitest run packages/billing/tests/config.test.ts`
  **Accept:** `config: valid, blank-rails-hidden, bad-env-throws`.

---

## Phase P — Ephemeris

- [ ] **P.1 — sweph-wasm backend.**
  **Owns:** `packages/ephemeris/src/sweph/` (engine.ts, tables.ts), `packages/ephemeris/tests/
  conformance.test.ts`, `packages/ephemeris/tests/fixtures/`.
  **Reads:** T0.5. **Spec:** implement `EphemerisEngine` on `sweph-wasm` (dep): `init` loads
  semiset ephemeris (lazy mount of bundled `se1` files; document the exact files in a
  `tables.ts` table map); `position` via `swe_calc_ut` (speed flags on); `cusps` via
  `swe_houses_ex` for each HouseSystem mapped to its sweph `hsys` char; time-unknown input
  never reaches here (P.2 guards). Conformance fixtures: embed 24 cases (2 dates × 12
  bodies: Gregorian 1990-05-02 14:32 UT and 2026-09-04 00:00 UT; place 55.60N 13.00E) with
  expected lon values generated from Swiss Ephemeris reference tables (operator supplies at
  review; until then compute-and-freeze via the same engine is FORBIDDEN — instead the test
  asserts **invariants**: positions in [0,360), |speed| bounds per body, cusps ascending
  modulo, asc/mc consistency `|normalize(mc-asc)| ≤ 180`). When operator supplies reference
  numbers, tighten tol 0.01°.
  **Verify:** `pnpm vitest run packages/ephemeris/tests/conformance.test.ts`
  **Accept:** `sweph backend: 24 cases, invariants hold`.

- [ ] **P.2 — Honest-absence & solar chart rules.**
  **Owns:** `packages/ephemeris/src/solar.ts`, tests.
  **Spec:** `chartInputs(person)` → when `timeKnown=false`: return `{ut: null-date-only,
  system: 'WholeSign', solarHouses: true}` and the rule set: no ASC, no MC, no house cusps,
  houses-by-sign only; `assertNoHouses(facts)` throws if any cusp present; per J3/J4: a
  person without time removes *their* house overlays only, the other direction computes.
  Pure functions, exhaustive unit tests for the three journey branches (J1, J3, J4).
  **Verify:** `pnpm vitest run packages/ephemeris/tests/solar.test.ts`
  **Accept:** `solar: absence rules hold for J1/J3/J4 branches`.

- [ ] **P.3 — Worker/off-thread host.**
  **Owns:** `packages/ephemeris/src/host/` (protocol.ts, web-worker.ts, native-task.rs at
  `packages/ephemeris/native/host.rs`).
  **Spec:** JSON protocol `{id, op: 'init'|'position'|'cusps'|'aspects', params}` →
  `{id, ok, result|error}`; web worker instantiates P.1; native side is a tokio
  `mpsc`-served task the Tauri command registry mounts (registry macro from T0.3).
  **Verify:** `pnpm vitest run packages/ephemeris/tests/host.test.ts` (worker via
  `new Worker(new URL(...), {type:'module'})` under vitest web-worker pool)
  **Accept:** `host: init→cusps roundtrip via protocol OK`.

- [ ] **P.4 — ChartFacts builder + cache.**
  **Owns:** `packages/ephemeris/src/facts.ts`, tests.
  **Reads:** T0.5, T0.9 (charts table via injected `put/get` — define local interface,
  X.1 adapts). **Spec:** `buildFacts(inputs)`: content id = sha256 of canonicalized inputs
  JSON; positions for all bodies (+chiron when backend flag), cusps when time known,
  aspects with default OrbTable, applying/separating from speeds; caches into injected
  KV; `aspectsBetween(a, b)` for synastry cross-aspects (no score, no label — INC-19).
  **Verify:** `pnpm vitest run packages/ephemeris/tests/facts.test.ts`
  **Accept:** `facts: deterministic id, cache hit, synastry aspects computed`.

---

## Phase L — Lore

- [ ] **L.1 — LoreStore storage adapters.**
  **Owns:** `packages/lore/src/store/` (web.ts, native.ts, common.ts), tests.
  **Reads:** T0.6, T0.9. **Spec:** web adapter: `wa-sqlite` on OPFS (fallback IndexedDB
  backend), sqlite-vec wasm extension load, exposes `LoreStore`; native adapter: same
  interface over `rusqlite` via a Tauri command surface (command file owned here:
  `lore_commands.rs` registered via T0.3 macro). Shared SQL lives in `common.ts` calling
  T0.9 DDL. Tests run the web adapter against an in-memory SQLite (better-sqlite3 + vec
  disabled path) exercising upsert/query/export/delete/stats.
  **Verify:** `pnpm vitest run packages/lore/tests/store.test.ts`
  **Accept:** `store: upsert→query→export→delete cycle OK`.

- [ ] **L.2 — Embedder.**
  **Owns:** `packages/lore/src/embed/` (embedder.ts, native.rs bridge file), tests incl.
  `tests/hash-embedder.ts`.
  **Spec:** `Embedder {dim, embed(text: string): Promise<number[]>}`; production impl runs
  the mirror's embedder GGUF via wllama (web) / llama.cpp (native) — lazy model load,
  L2-normalized output; the dim comes from config. Ship a **real deterministic test
  embedder** (hashing bag-of-words → projected vector, L2-normalized) used by tests and by
  M.1's catalogue bootstrap only — never in production paths (enforced by a test asserting
  `import {createHashEmbedder} from '../tests/hash-embedder'` appears in zero `src/` files).
  **Verify:** `pnpm vitest run packages/lore/tests/embed.test.ts`
  **Accept:** `embedder: dim honored, L2 norm 1.0 ±1e-6, src purity holds`.

- [ ] **L.3 — Extraction & merge.**
  **Owns:** `packages/lore/src/extract.ts`, tests.
  **Spec:** deterministic extraction from a Turn: capitalized proper nouns (unicode-aware),
  dates (ISO + natural), places against the glossary gazetteer (G.1 exports the list),
  thread labels (session first-turn topic words); emit candidate LoreNodes (kind assigned)
  + LoreEdges (`mentions` turn→entity, `follows` consecutive, `relates` shared refs).
  Merge: cosine ≥ 0.92 between same-kind candidates and existing nodes ⇒ merge (union refs,
  bump weight, keep earlier id). All pure; tests cover en + one transliterated case.
  **Verify:** `pnpm vitest run packages/lore/tests/extract.test.ts`
  **Accept:** `extract: entities+edges found; merge at 0.92 verified`.

- [ ] **L.4 — Hybrid retrieval.**
  **Owns:** `packages/lore/src/retrieve.ts`, tests.
  **Reads:** T0.6. **Spec:** `retrieve(store, {personId?, q, k=8, budgetTokens=1500})`:
  cosine kNN over vec_nodes (sqlite-vec `MATCH`) ∪ 2-hop graph expansion from matched node
  ids; person-scoped unless `q.general`; token budget via char/4 estimate; returns
  fragments `{summary, sourceTurnId, score}` ordered. Tests with hash-embedder fixtures.
  **Verify:** `pnpm vitest run packages/lore/tests/retrieve.test.ts`
  **Accept:** `retrieve: vector ∪ 2-hop, budget respected, person-scoped`.

- [ ] **L.5 — Write-every-turn pipeline.**
  **Owns:** `packages/lore/src/pipeline.ts`, tests.
  **Spec:** `LorePipeline.consume(turn)` → embed (L.2) → extract/merge (L.3) → batched
  write (single flush per turn, insert-only SQL within one transaction); `stats()` returns
  `{turns, nodes, edges}` for Settings; `deleteAll()` = rows + vectors real deletion.
  **Verify:** `pnpm vitest run packages/lore/tests/pipeline.test.ts`
  **Accept:** `pipeline: 50 turns → nodes merged, flush count = 50, delete leaves 0 rows`.

---

## Phase B — Billing & licensing

- [ ] **B.1 — Trial gate.**
  **Owns:** `packages/billing/src/trial.ts`, tests.
  **Spec:** parse RuntimeConfig trial block; `evaluateGate(policy, ledgerRows, now)` →
  `{state: 'trial-active'|'trial-exhausted'|'rate-limited'|'licensed', remaining?,
  nextReadingAt?}` implementing count/time/rate exactly (rate: last reading + cooldownDays;
  time: installTs + days — installTs from `readings` table bootstrap row id `install`).
  Clock injected (`now: () => number`). Pure + exhaustive table-driven tests.
  **Verify:** `pnpm vitest run packages/billing/tests/trial.test.ts`
  **Accept:** `trial: count/time/rate/licensed matrices pass (≥14 cases)`.

- [ ] **B.2 — Reading ledger + billing.consume (local).**
  **Owns:** `packages/billing/src/ledger.ts`, `packages/billing/src/consume.ts`, tests.
  **Reads:** T0.7, T0.9. **Spec:** `ReadingLedger` over injected SQLite (readings table):
  `append(reading)` (never mutate), `rowsSince(ts)`; `billing.consume(reading, deps)`:
  licensed (B.3 token verified) ⇒ allowed; else evaluateGate ⇒ map states to
  ConsumeResult; this is THE seam (hosted product swaps impl, same signature).
  **Verify:** `pnpm vitest run packages/billing/tests/ledger.test.ts`
  **Accept:** `consume: licensed/trial/exhausted/rate paths exact`.

- [ ] **B.3 — License token verify + storage.**
  **Owns:** `packages/billing/src/token/` (format.ts, verify-web.ts, storage-web.ts,
  native.rs, verify.rs), tests.
  **Spec:** compact token = base64url(header).payload.Ed25519-sig (COSE-esque, no external
  dep: implement encode/verify with WebCrypto Ed25519 on web; RustCurve25519-dalek-ed25519
  native); public key baked from config `VITE_LICENSE_PUBKEY` (add to `.env.example` —
  owns that line); verify offline: sig, iss, sub match appUserId, exp null-or-future;
  deny-list: signed DenyList fetched when online (bridge), cached, `revokedJti` blocks only
  listed jti; storage: keychain (native command via registry macro) / IndexedDB
  WebCrypto-wrapped (web). Tests: generate test keypair, forge + reject tests.
  **Verify:** `pnpm vitest run packages/billing/tests/token.test.ts`
  **Accept:** `token: valid passes, tampered/expired/revoked rejected`.

- [ ] **B.4 — Codes (single-use + hash-based).**
  **Owns:** `packages/billing/src/codes.ts`, tests.
  **Spec:** format `NATALLY-XXXX-XXXX-XXXX` (Crockford base32, no I/L/O/U); hash-based
  code = base32(payload `{tier, exp}` + Ed25519 sig) packed into that shape — offline
  verify via B.3 pubkey; single-use: sha256(code) into consumed_codes; outcomes enum:
  `valid | invalid | already-used | expired` mapping to paywall states (code-error variant).
  **Verify:** `pnpm vitest run packages/billing/tests/codes.test.ts`
  **Accept:** `codes: mint→verify→reuse rejected, 4 outcomes exact`.

- [ ] **B.5a — Generic hosted-redirect adapter + bridge client.**
  **Owns:** `packages/billing/src/adapters/hosted.ts`, `packages/billing/src/bridge-client.ts`,
  tests. **Spec:** for stripe/polar/lemonsqueezy/paypal/square: `available()` = config URL
  present; `checkout(offering)` → `{kind:'redirect', url: <configured checkout URL> +
  ?appUserId=<id>&offering=<id>}` opened via opener injection (Tauri shell-open / window.open);
  then poll bridge `POST /verify {appUserId}` (2s backoff, 15 min cap, offline-tolerant);
  `restore()` → `GET /verify?appUserId=` → token|null. SSRF guard: reject non-https,
  loopback/private/reserved hosts (owns `guards.ts`).
  **Verify:** `pnpm vitest run packages/billing/tests/adapters-hosted.test.ts` (fetch stubbed
  at the boundary — real `fetchGlobal` injectable, test injects local http server via
  `node:test`? Simpler: inject `transport` fn, real impl uses fetch — the injection is a
  parameter, not a mock.)
  **Accept:** `hosted adapter: URL build, poll loop, SSRF rejects loopback/private`.

- [ ] **B.5b — RevenueCat adapter.**
  **Owns:** `packages/billing/src/adapters/revenuecat.ts`, tests.
  **Spec:** web SDK (`@revenuecat/purchases-js` dep): init with web SDK key + appUserId;
  `checkout` → `presentPaywall(offeringId)`; entitlement `unlimited` present ⇒ request
  bridge mint (or RC-hosted entitlement is itself the proof — take RC entitlement + bridge
  token per §9.4: RC is the registry; on entitlement grant, call bridge `/mint` with the RC
  purchase id — bridge verifies via RC REST v2 with its secret) → LicenseToken; `restore`
  via RC restore. Config: `VITE_REVENUECAT_WEB_SDK_KEY`, offering id default `natally_default`.
  **Verify:** `pnpm vitest run packages/billing/tests/adapters-rc.test.ts` (RC SDK injected
  as constructor param)
  **Accept:** `rc adapter: paywall→entitlement→mint→token flow OK`.

- [ ] **B.5c — Adapter registry.**
  **Owns:** `packages/billing/src/adapters/registry.ts`, tests.
  **Spec:** order-stable registry over B.5a/B.5b instances filtered by `available()`;
  exports `paymentsAvailable()` labels for the paywall honest line; one `purchase(adapterId,
  offering)` entry + `redeem(code)` using B.4.
  **Verify:** `pnpm vitest run packages/billing/tests/registry.test.ts`
  **Accept:** `registry: hides absent rails, exposes present set`.

- [ ] **B.6 — License bridge service.**
  **Owns:** `services/license-bridge/**` (Cargo.toml, src/main.rs, src/routes/*.rs,
  src/ledger.rs, src/mint.rs, src/codes.rs, .env.example, README.md), tests.
  **Spec (ARCHITECTURE §9.4):** axum service; SQLite idempotent ledger PK `(processor,
  invoice_id)`; webhook routes per processor `{prefix}/webhook/{stripe|polar|lemonsqueezy|
  paypal|square|revenuecat}` each verifying that processor's documented HMAC/signature
  scheme (impl per current official docs; list the exact header/secret mapping in README);
  on verified event ⇒ mint LicenseToken (ed25519-dalek, key from
  `LICENSE_ED25519_PRIVATE_KEY`), store issuance, return token via `POST /verify`; routes:
  `POST /verify {appUserId}` → token|null + denylist; `POST /redeem {code}` (single-use
  registry, sha256-stored); `POST /mint {appUserId, purchaseRef}` (called by RC adapter path;
  verifies purchase against RC REST v2 with `RC_SECRET_KEY`); `GET /denylist` (signed);
  `GET /healthz`. Env: the six processor webhook secrets + RC keys + signing key + `LEDGER_PATH`.
  Tests: HMAC fixtures, idempotent double-webhook, mint+verify roundtrip, redeem reuse.
  **Verify:** `cargo test --manifest-path services/license-bridge/Cargo.toml`
  **Accept:** `bridge: 6 webhook fixtures verified idempotently; mint→verify; redeem reuse rejected`.

---

## Phase C — Companion

- [ ] **C.1 — Inference host (turboquant).**
  **Owns:** `apps/local/src-tauri/src/inference/` (mod.rs, llama.rs), `apps/local/src/
  companion/inference-web.ts`, `packages/…` none — plus `apps/local/src/companion/lane.ts`.
  **Spec:** streaming completion API `complete(ctx: FenceContext, onToken)`; native:
  llama.cpp bindings (crate `llama-cpp-2` or vendored; catalogue-tier Q4_K_M weights, KV
  q8_0 via context params; recursor tier q4r8 optional flag); web: wllama with same
  quant settings; both lazy-load the model from M.1 storage. Emits CompanionEvent tokens.
  **Verify:** `pnpm vitest run apps/local/src/companion/inference.test.ts` (lane selection +
  param mapping with injected engine factory) **Accept:** `inference: turboquant params
  (Q4_K_M, kv q8_0) mapped on both lanes`.

- [ ] **C.2 — Prompt fence + checker.**
  **Owns:** `apps/local/src/companion/fence.ts`, `apps/local/src/companion/persona.ts`,
  tests. **Spec (§7.2):** assemble Tier1 (serialized ChartFacts in scope + glossary
  definitions), Tier2 (L.4 fragments with sourceTurnId), Tier3 (live turn + tool results);
  persona prompt (voice law D13: warm, approachable, ultra-relatable; never clinical;
  INC-19); `checkFence(output, tier1)`: parse degrees/orbs/dates/sign-house names from
  output; every number must match a Tier1 value within 0.01° (house/sign names consistent);
  violation ⇒ one regeneration with quoted violation, then honest-absence fallback string.
  Table-driven tests incl. a violating sample.
  **Verify:** `pnpm vitest run apps/local/src/companion/fence.test.ts`
  **Accept:** `fence: clean passes; 0.01° tolerance; violation→regen→absence chain exact`.

- [ ] **C.3 — Tool suite (DOM r/w).**
  **Owns:** `apps/local/src/companion/tools.ts`, tests.
  **Spec (§7.3):** `dom.read` → accessibility-style snapshot from the live DOM (query from
  root or selector, depth cap, mask: input values, [data-secret], keychain fields); `dom.write`
  applies ops after the same confirm affordance UI actions use (a `requestConfirm` injected
  dependency rendering the real confirm plate); every invocation appends `Turn(role='tool')`
  with toolOps to the transcript (X.1 repo injection) and lore pipeline; `chart.open`,
  `chart.compute` (P.4 via host), `lore.recall` (L.4). No network: assert by construction —
  tools module imports no fetch/URL opener; a test greps the file for `fetch|WebSocket|open(`
  and fails on hit.
  **Verify:** `pnpm vitest run apps/local/src/companion/tools.test.ts` (jsdom)
  **Accept:** `tools: read masks secrets, write records turn, no-network grep clean`.

- [ ] **C.4 — Companion event bus.**
  **Owns:** `apps/local/src/companion/bus.ts`, tests.
  **Spec:** typed pub/sub for the CompanionEvent union (§ Turn/chart/envelope/error/token);
  `subscribe(type, fn)` unsubscribe handle; replay-buffered `stageState$` derived reducer
  (Thinking on first token, Speaking during envelope, Delighted on chart-computed/unlock,
  Error) — pure reducer exported for U.9 tests.
  **Verify:** `pnpm vitest run apps/local/src/companion/bus.test.ts`
  **Accept:** `bus: event→stage reducer sequence Thinking→Speaking→Idle exact`.

---

## Phase V — Voice

- [ ] **V.1 — Kokoro native (Rust).**
  **Owns:** `apps/local/src-tauri/src/voice/` (mod.rs, kokoro.rs, audio.rs), Rust tests.
  **Spec:** onnxruntime session (crate `ort`) loading mirror Kokoro ONNX + voices;
  sentence-chunked synthesis queue; playback via cpal; RMS envelope (per 20 ms window,
  normalized 0–1) emitted as CompanionEvent envelope; mute persisted via config store
  command. **Verify:** `cargo test --manifest-path apps/local/src-tauri/Cargo.toml voice`
  (unit: chunking + envelope math over a synthetic PCM fixture; model-dependent tests
  behind `#[ignore]` with real-file runner) **Accept:** `voice native: chunking + RMS
  envelope fixtures pass`.

- [ ] **V.2 — Kokoro web + ban guard.**
  **Owns:** `apps/local/src/voice/web.ts`, `apps/local/src/voice/envelope.ts`,
  `scripts/grep-no-speechsynthesis.sh`, tests.
  **Spec:** onnxruntime-web (WASM; WebGPU when `navigator.gpu`) synth → AudioWorklet
  playback → shared envelope.ts RMS (same math as V.1) → bus; the script greps `apps/
  **/src/**` (ts,tsx,rs) for `speechSynthesis` and exits 1 on hit; CI hook file R.7 calls it.
  **Verify:** `pnpm vitest run apps/local/src/voice && bash scripts/grep-no-speechsynthesis.sh`
  **Accept:** `voice web: envelope fixtures pass; speechSynthesis: 0 hits`.

---

## Phase U — UI (React; each screen owns its dir)

- [ ] **U.1 — Shell, router contract, primitives.**
  **Owns:** `apps/local/src/ui/shell.tsx`, `apps/local/src/ui/router.ts` (contract +
  registry type), `apps/local/src/ui/primitives/` (Button, Chip, TopBar, Composer, PlateCard,
  TurnHer, TurnYou), `apps/local/src/ui/glyphs.tsx`, `apps/local/src/ui/version.tsx`.
  **Spec:** primitives mirror Components page 1:1 (STATE-LEDGER ids in doc comments); glyph
  set loaded from `LIBS/UI/FIGMA/glyphs/natally-glyphs.svg` (owns `apps/local/src/assets/
  glyphs/` copy); router: hash routes exactly `/`,`/atlas/:plate`,`/people`,`/people/:id`,
  `/settings`,`/paywall`,`/checkout`,`/about`; each screen registers via
  `registerRoute({path, load})` into a module-owned registry (I.1 consolidates imports);
  version stamp `data/micro` bottom-right every surface. Storybook-free visual tests:
  render primitives against token CSS in jsdom + assert class/theme wiring.
  **Verify:** `pnpm vitest run apps/local/src/ui/primitives`
  **Accept:** `primitives: 7 components, tokens.css vars applied, routes typecheck`.

- [ ] **U.2 — Conversation screen.**
  **Owns:** `apps/local/src/screens/conversation/`.
  **Spec:** all 9 variants (Idle, Thinking, Speaking, Asleep, Error, TrialIdle,
  TrialExhausted, RateLimited, Desktop) per SCREEN.md + STATE-LEDGER node ids; transcript
  grammar (her turns page text + gilt glyph margin; yours orbglow hairline right; plates as
  midnight/2 cards with provenance foot + Open); trial chip from B.1 state; composer gating
  (TrialExhausted replacement block); Stage mounts U.9; binds C.4 bus; INC-19 rendering
  rules (computed → Plex Mono, generated → margin glyph, absence → voice/aside treatment).
  jsdom tests per variant with scripted bus events.
  **Verify:** `pnpm vitest run apps/local/src/screens/conversation`
  **Accept:** `conversation: 9 variants render against event scripts`.

- [ ] **U.3 — Plates + Atlas screens.**
  **Owns:** `apps/local/src/screens/plate-natal/`, `apps/local/src/screens/atlas/`.
  **Spec:** plate cards (natal withHouses/timeUnknown); Atlas views natal/synastry/today:
  wheel renderer (owns `apps/local/src/ui/wheel.tsx` — 272px structure, AC/MC labels, cusps
  placed from ChartFacts at runtime, zodiac ramp per sign, aspects table with orb +
  applying/separating, 12-house-system chip selector, bi-wheel for synastry, no score/no
  label); honest-absence branches (J1/J3/J4/J5). Render tests assert cusp angles from
  fixture ChartFacts.
  **Verify:** `pnpm vitest run apps/local/src/screens/atlas apps/local/src/screens/plate-natal`
  **Accept:** `atlas: 3 views render; wheel cusp angles match fixtures ±0.5°`.

- [ ] **U.4 — People + first-light.**
  **Owns:** `apps/local/src/screens/people/`, `apps/local/src/screens/first-light/`.
  **Spec:** conversational intake (name/date/place/time-or-unknown; instant computed fact
  after each answer via P.4; privacy explainer two-lane local wording); people list (name ·
  sun glyph · date · place · time-known marker; add/edit/remove with export-first nudge);
  J3 flow; X.1 repo injection.
  **Verify:** `pnpm vitest run apps/local/src/screens/people apps/local/src/screens/first-light`
  **Accept:** `intake: 4-step flow yields Person + first computed fact; unknown-time branch`.

- [ ] **U.5 — Settings screen.**
  **Owns:** `apps/local/src/screens/settings/`.
  **Spec:** sections exactly per amended SCREEN.md: House system (12 chips), Model
  (catalogue from M.1, real download progress %, storage used, remove, trial-eligible flag
  + lock routing to /paywall), Voice (Kokoro picker, preview, mute — V.1/V.2 injection),
  License (status from B.1/B.3, Restore → B.5c, Enter a code → /paywall enter-code state),
  Data (export/import/deleted via X.1/X.2, Lore summary line `[turns · nodes]` from L.5
  stats), About link; mobile + web (1280) layouts.
  **Verify:** `pnpm vitest run apps/local/src/screens/settings`
  **Accept:** `settings: 6 sections render; trial-lock and license states bind`.

- [ ] **U.6 — Paywall + checkout screens.**
  **Owns:** `apps/local/src/screens/paywall/`, `apps/local/src/screens/checkout/`.
  **Spec:** all frames per SCREEN.md files (paywall 7 variants, checkout 6); bind B.5c
  registry (Ways-to-pay line), B.1 gate states, B.4 redeem with 4 outcomes, B.5a handoff
  (QR renders from real checkout URL via owned qrcode wasm dep; link line), license-key
  entry path; commerce law (DESIGN.md): one gilt primary per screen, runtime markers,
  no pressure copy; Delighted on success via bus.
  **Verify:** `pnpm vitest run apps/local/src/screens/paywall apps/local/src/screens/checkout`
  **Accept:** `commerce: 13 variants render; gate→CTA→handoff→success chain binds`.

- [ ] **U.7 — About + glossary-callout.**
  **Owns:** `apps/local/src/screens/about/`, `apps/local/src/screens/glossary/`.
  **Spec:** About (version, license AGPL-3.0-or-later + provenance lines ephemeris/Kokoro,
  D9 note); glossary callout per glyph with authored-static body + "Ask natally about this"
  posting the term into the conversation (bus). Fix the frozen spec drift: license line
  reads AGPL-3.0-or-later (not "proprietary").
  **Verify:** `pnpm vitest run apps/local/src/screens/about apps/local/src/screens/glossary`
  **Accept:** `about+glossary: license line AGPL; 36 glyph entries open`.

- [ ] **U.8 — Splash.**
  **Owns:** `apps/local/src/screens/splash/`.
  **Spec:** wordmark + real engine-load progress only (ephemeris table mount events from
  P.3; NO fabricated progress); ready → route to conversation or first-light (people count
  via X.1); desktop variant.
  **Verify:** `pnpm vitest run apps/local/src/screens/splash`
  **Accept:** `splash: progress binds to engine events; routes by people count`.

- [ ] **U.9 — Stage (mascot).**
  **Owns:** `apps/local/src/ui/stage.tsx`, `apps/local/src/assets/mascot/` (copies from
  LIBS/UI/FIGMA/mascot/), tests.
  **Spec:** 8 states driven only by C.4 bus events (STATES.md real-vs-composed table):
  idle loop (webp) real; waking/thinking/speaking/delighted/error as composed overlays
  (SVG/glyph + envelope ring); asleep = no model; reduced-motion: frame 0 + no plate slide;
  envelope drives orb+mouth scale.
  **Verify:** `pnpm vitest run apps/local/src/ui/stage.test.tsx`
  **Accept:** `stage: 8 states map to bus events; envelope scales orb; reduced-motion honored`.

---

## Phase M — Mirror & models

- [ ] **M.1 — Manifest, downloads, catalogue.**
  **Owns:** `apps/local/src/mirror/` (manifest.ts, download.ts, cache.ts, catalogue.ts),
  tests.
  **Reads:** T0.7 types. **Spec:** fetch `manifest.json` from mirror base (host allowlist =
  mirror + bridge); ranged resumable download to platform cache (native dir via command,
  web Cache Storage), sha256 verify before commit (streaming digest), atomic rename;
  catalogue store (present → downloading %, bytes, remove = files + rows); trialEligible
  flag honoured by B.1/U.5. Tests with a local fixture server + tiny files.
  **Verify:** `pnpm vitest run apps/local/src/mirror`
  **Accept:** `mirror: resume + sha256 + atomic commit; corrupted blob rejected`.

---

## Phase X — Persistence app layer

- [ ] **X.1 — Repositories + export/import.**
  **Owns:** `apps/local/src/data/` (db.ts adapters wiring T0.9 to native/web, people.ts,
  sessions.ts, turns.ts, charts.ts, export.ts, import.ts), tests.
  **Spec:** repos for Person/Session/Turn/ChartFacts per DDL; `exportAll()` →
  ExportDocument v1 (people, sessions, turns, chart inputs, lore via L.1 exportAll,
  consumedCodes); `importDocument(doc)` merges by personId and lore nodeId (never deletes);
  deterministic export test fixture roundtrip.
  **Verify:** `pnpm vitest run apps/local/src/data`
  **Accept:** `data: CRUD roundtrip; export→wipe→import restores equivalently`.

- [ ] **X.2 — Delete-everything.**
  **Owns:** `apps/local/src/data/destroy.ts`, tests.
  **Spec:** real deletion: all app tables rows + lore rows + vectors + downloaded model
  files + keychain token (B.3 injection) + license_state; returns a report
  `{tablesCleared, filesDeleted, tokenCleared}`; confirm affordance lives in U.5 (inject).
  **Verify:** `pnpm vitest run apps/local/src/data/destroy.test.ts`
  **Accept:** `destroy: 0 rows remain across 10 tables; files removed; token cleared`.

---

## Phase G — Content

- [ ] **G.1 — Glossary + gazetteer.**
  **Owns:** `apps/local/src/content/glossary.json`, `apps/local/src/content/gazetteer.json`,
  `apps/local/src/content/index.ts`, tests.
  **Spec:** GlossaryEntry per glyph (36) with `What it is` body (authored-static, INC-19) +
  synastry notes where applicable (per glossary-callout screen); gazetteer = place names
  gazetteer for L.3 (seed: ~100 major cities + reflexive user-entered places at runtime);
  index exports typed loaders.
  **Verify:** `pnpm vitest run apps/local/src/content`
  **Accept:** `content: 36 entries, all four fields present, gazetteer loads`.

---

## Phase S — Assets

- [ ] **S.1 — Fonts self-host.**
  **Owns:** `apps/local/public/fonts/` (woff2 files), `apps/local/src/styles/fonts.css`.
  **Spec:** Fraunces (SemiBold, Italic), Nunito Sans (Regular, SemiBold), IBM Plex Mono
  (Regular, Medium) as woff2, self-hosted, `font-display: swap`; `@font-face` in fonts.css;
  imported from global.css at the S.1 comment contract (T0.2 reserved). Files from the
  operator's licensed font set (document source in a FONT_PROVENANCE.md you own).
  **Verify:** `bash -c 'ls apps/local/public/fonts/*.woff2 | wc -l'`
  **Accept:** `6 woff2 present + fonts.css parses (node --check via css parse test)`.

---

## Phase I — Integrators (⛓ idempotent consolidators; safe to re-run anytime, in any order after their inputs exist)

- [ ] **I.1 — Route registry wiring.** ⛓
  **Owns:** `apps/local/src/ui/routes.generated.ts`.
  **Spec:** generate (owned script `gen-routes.mjs`) the static import list of every
  `registerRoute` call site under `src/screens/**`; emit registry module consumed by
  router.ts. Re-running regenerates identically. **Verify:** `node apps/local/scripts/
  gen-routes.mjs && pnpm --filter @natally/local exec tsc --noEmit -p tsconfig.standalone.json`
  **Accept:** `routes.generated.ts lists all implemented screens; typecheck clean`.

- [ ] **I.2 — Tauri command registry wiring.** ⛓
  **Owns:** `apps/local/src-tauri/src/registry_generated.rs`.
  **Spec:** macro expansion list of every `natally_plugin!` module under src-tauri (lore,
  inference, voice, keychain, mirror-cache); regenerate on change.
  **Verify:** `cargo check --manifest-path apps/local/src-tauri/Cargo.toml`
  **Accept:** `registry builds; invoke_handler covers all registered commands`.

- [ ] **I.3 — Capability layer resolution.** ⛓
  **Owns:** `apps/local/src/capabilities.ts`.
  **Spec:** single map `{db, inference, voice, keychain, opener} → {native, web}`
  implementations (imports only; selection by `window.__TAURI__` presence); no `if
  (platform)` anywhere else — a lint test greps `src/` for `__TAURI__` outside this file.
  **Verify:** `pnpm vitest run apps/local/src/capabilities.test.ts`
  **Accept:** `capabilities: single selection point; grep clean elsewhere`.

- [ ] **I.4 — Full workspace gate.** ⛓
  **Owns:** nothing new; runs checks. **Spec:** `./scripts/check.sh` (T0.1) +
  `bash scripts/grep-no-speechsynthesis.sh` + bundle budget assert script (owns
  `scripts/assert-budget.mjs`: built web initial JS ≤ 300 KB gz).
  **Verify:** `./scripts/check.sh && node scripts/assert-budget.mjs`
  **Accept:** `workspace: typecheck+lint+tests green; budget ≤ 300 KB gz; ban greps 0`.

---

## Phase R — Build & release

- [ ] **R.1 — build-linux.sh.** **Owns:** `scripts/build-linux.sh`. AppImage + deb via
  `tauri build`; artifacts → `dist/mba.robin.natally-v<version>-linux.{AppImage,deb}`;
  runs version stamp pre-build; `set -euo pipefail`; idempotent (skip if artifact exists at
  same version unless `--force`). **Verify:** `bash -n scripts/build-linux.sh && bash
  scripts/build-linux.sh --dry-run` (owns the dry-run flag) **Accept:** `dry-run prints
  artifact names + version stamp plan`.

- [ ] **R.2 — build-windows.sh.** **Owns:** `scripts/build-windows.sh`. Host-detecting
  (D8): Linux host → `cargo-xwin` exe + NSIS bundle; Windows host → msi + msix. Same
  dist naming `-win.exe/-setup.exe/-win.msi/-win.msix`. **Verify:** `bash -n` +
  `--dry-run` **Accept:** `dry-run prints per-host plan (xwin vs msi/msix)`.

- [ ] **R.3 — build-android.sh.** **Owns:** `scripts/build-android.sh`. apk + aab via
  `tauri android build`; versionCode from `version.json` (`MAJOR*100000+MINOR`).
  **Verify:** `bash -n` + `--dry-run` **Accept:** `dry-run prints apk/aab names + versionCode`.

- [ ] **R.4 — build-web.sh (PWA).** **Owns:** `scripts/build-web.sh`,
  `apps/local/public/manifest.webmanifest`, `apps/local/src/sw.ts`.
  **Spec:** vite build → `dist/web` (its own stamped qualifier artifact per R1 lineage);
  PWA manifest (name natally, identity `mba.robin.natally`, dark theme `#120C1C`); service
  worker: cache-first for hashed assets + fonts, network-only for mirror/bridge (never
  caches POSTs). **Verify:** `bash scripts/build-web.sh --dry-run && pnpm vitest run
  apps/local/src/sw.test.ts` **Accept:** `web: artifact name printed; SW strategy map exact`.

- [ ] **R.5 — build-all.sh + release flow.** **Owns:** `scripts/build-all.sh`.
  **Spec:** respects `release.lock` (single-flight; refuses concurrent run), sequences
  R.1–R.4 (or `--only linux,web`), stamps post-build bump via
  `scripts/update-version.sh --post-build`. **Verify:** `bash -n && --dry-run`
  **Accept:** `dry-run sequences all targets; lock acquire/release printed`.

- [ ] **R.6 — Version stamping wiring.** **Owns:** edits limited to
  `scripts/update-version.sh` guards (already pre-wired: package.json, tauri.conf.json,
  Cargo.toml, tauri.properties). Confirm idempotency: no-op when values equal (fix the
  unconditional MINOR bump to only fire with `--bump` or when committing per house flow —
  keep default behavior, add `--check` mode you own). **Verify:** `bash
  scripts/update-version.sh --check` **Accept:** `version check: consistent
  (version.txt = version.json = package.json)`.

- [ ] **R.7 — Dormant CI + guards.** **Owns:** `.github/workflows/check.yml` (workflow
  gated to run only when labeled/`workflow_dispatch` — dormant until public release),
  `scripts/license-lint.mjs`. **Spec:** workflow_dispatch-only job running I.4 suite;
  license-lint: fail if any `sweph` import exists while `package.json.license ≠
  AGPL-3.0-or-later`, or license proprietary while sweph present (both directions).
  **Verify:** `node scripts/license-lint.mjs` **Accept:** `license-lint: AGPL + sweph
  consistent (state OK)`.

---

## Completion criteria

All tasks `[X]` and ✅, plus I.4 green end-to-end, equals the local-app production snapshot
of ARCHITECTURE.md. Gate-2 sibling `DOCS/TEST_RUBRIC.md` then formalizes the cross-task
acceptance matrix (conformance tolerances, fence adversarial suite, J1–J11 journey walks,
budget asserts) before `src/` PRs are merged — coders execute only tasks above, in any
order, one subagent per task.
