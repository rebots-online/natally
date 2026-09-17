# natally — Comprehensive Analysis & Checklist Audit

**Date:** 2026-09-13 · **Tree:** `v1.13.21288` + 76 uncommitted files (22 modified, 54 untracked)
**Analyst:** Claude (`/sc:analyze`, deep, all domains; 4 parallel full-read review agents + cross-cutting house-rule greps + gate executions + per-task Verify re-runs)
**Addressed to:** gpt-6 — predecessor implementer who signed off the current `CHECKLIST.md` (the only tasklist governing completion)
**Reproducibility:** every claim carries a command (Appendix A) or a file:line cite. Claims are labeled **[observed]** (a command ran and its output is quoted/summarized here), **[agent-verified]** (deep-review agent read the file end-to-end), or **[unverified]**.

---

## Part 1 — Executive verdict

The implemented code is **exceptionally clean**: across ~23.8k lines of TS/TSX/Rust read end-to-end, the quality review found **zero** logic bugs at ≥80% confidence (near-misses documented and rejected with reasons, §2.1). The security perimeter is unusually disciplined (no shell/fs/http plugin families in the dependency graph at all; production CSP has no `unsafe-inline`/`unsafe-eval` in `script-src`; no panic reachable from IPC; no committed secrets). Every mechanically-generated single-source chain holds under direct verification (tokens 36/36, version 6-surface agreement, vendor locks exact, D14 seam leak-proof).

The deficits are **ledger- and gate-shaped, not code-shaped**:

1. Both static gates are red (`pnpm typecheck` exit 2; `pnpm lint` exit 1), and because `scripts/check.sh` runs `pnpm -r typecheck` first — with `includeWorkspaceRoot: true` executing the broken root project — **the canonical gate dies before ever reaching the test suite**.
2. That masked a real regression: **L.1 `[X]` fails its own Verify command today** (3/16 tests) — migration-3 drift from later `ddl.ts` work. One U.2 test also fails.
3. **T0.V is ✅ with no Verify or Accept lines at all** (the checklist's own worst SC2 breach); ≥8 other blocks are `[ ]` while their artifacts exist and pass.
4. 76 files of completed work are uncommitted (TC10 durability gap).
5. Five performance majors and one security major (lore raw-SQL gateway) are scheduled work, not emergencies — several detonate only when I.1 wiring lands.

**Causal chain worth internalizing:** F-1 (broken aggregate gate) → tests never re-run in aggregate → cross-task regression (F-12) undetected → markers flipped on stale evidence (F-11). The gates are the detection mechanism, not bureaucracy.

---

## Part 2 — Comprehensive findings

Severity order. CRITICAL: none.

### Major

| # | Domain | Finding | Anchor |
|---|---|---|---|
| F-1 | Quality/CI | Root typecheck red, 10 errors: (a) `allowImportingTsExtensions` missing in `tsconfig.base.json` → 9× TS5097 in `packages/ephemeris` (its own package tsconfig sets the flag; the root sweep lacks it); (b) `paths` lacks `@natally/local-shell` (Vite alias points at `apps/local/src/ui/shell.tsx`; tsconfig glob looks in `packages/`) → TS2307 in `app.tsx:5`. Consequence: `scripts/check.sh` fails at step 1. | `tsconfig.base.json`; `apps/local/tsconfig.json:6` (child has the mapping) |
| F-2 | Quality/CI | Biome red: 33 errors / 56 warnings / 148 files. Rule census: 55× `noNonNullAssertion`, 3× `useExhaustiveDependencies`, 2× `noExplicitAny`, 2× `noArrayIndexKey`, 2× `useIterableCallbackReturn`, 1× `noDescendingSpecificity`, 1× `noUselessEscapeInRegex`; 16 files need formatting incl. **generated** `src-tauri/gen/schemas/*` (should be ignored, not formatted). | conversation/, voice/, mirror/ |
| F-3 | Process (TC10) | 76 files uncommitted over 25 ✅ blocks: whole modules live only in the working tree (`src-tauri/src/inference/`, `src/plugins/`, icons ×20, capabilities, permissions, mascot assets, `AGENTS.md`, `DOCS/sdk/sqlite-vec/`). Last commit 2026-09-13 01:36. Not pushed to either remote. | `git status` |
| F-4 | Security | **Lore plugin is a raw-SQL gateway.** `lore_batch` prepares renderer-supplied `statement.sql` verbatim; `lore_open` executes renderer-supplied `migration.sql`. Parameters are bound, the SQL *text* is webview-controlled. Given webview compromise (XSS via companion DOM-write surface is the realistic vector): full DB r/w (birth data, transcripts, `license_state.token`), lore poisoning that steers retrieval, and an `ATTACH DATABASE '<path>'` file-write primitive outside the DB (bundled SQLite does not omit ATTACH — verified in vendored `libsqlite3-sys` build; `load_extension` stays runtime-disabled; `readfile/writefile` are CLI-only). CSP `script-src 'self'` is the load-bearing mitigant. Remediation is cheap: per-connection authorizer denying `ATTACH`/`DETACH`/write-`PRAGMA` — `ddl.ts`/`common.ts` already enumerate every legal shape. | `packages/lore/native/lore_commands.rs:198-310` |
| F-5 | Performance | `lore_batch`/`lore_open` are **sync** Tauri commands — SQLite transactions run on the main thread with the `LoreState` mutex held across them. `DataDatabase.snapshot()` (repository reads + full `exportAll` in one transaction), import/export/deleteAll freeze the entire window. Contrast: inference/embedding correctly use `spawn_blocking`. Fix: `async fn` + `spawn_blocking`. | `lore_commands.rs:298-310`, `apps/local/src/data/db.ts:52-72` |
| F-6 | Performance | 1.7 MB animated WebP statically imported and rendered in the loading fallback **and** TopBar — the single largest first-load transfer on the web leg, paid before the shell chunk. 200 KB PNG still already bundled. | `apps/local/src/ui/mascot.tsx:1`, `app.tsx:10`, `TopBar.tsx:36` |
| F-7 | Performance | Per-token `setStream` re-renders `ConversationSession` → full spread/filter/map/sort of all turns+plates → re-renders every unmemoized row → `scrollHeight` read per token (forced layout). O(N log N) + layout at token rate; streaming degrades as sessions grow. | `use-conversation.ts:62`, `ConversationScreen.tsx:151-154,81-84` |
| F-8 | Performance | Zero secondary indexes. Hottest query `SELECT * FROM turns WHERE session_id=? ORDER BY ts,id` full-scans+sorts the whole table every conversation mount, forever. Also needs: expression index for `COALESCE(person_id, historical_person_id)`, `lore_edges(to_id)`. Fix via a **new migration** (never edit applied SQL). | `packages/lore/src/ddl.ts`, `apps/local/src/data/turns.ts:50`, `sessions.ts`, `store/common.ts:322-324` |
| F-9 | Performance (when wired) | No KV/prompt reuse: fresh llama.cpp context per request + `cache_prompt:false` + CPU-only → first-token latency grows linearly with history. Purity motivation is legitimate; fix is session-scoped KV prefix reuse behind a prefix-stable fence. | `src-tauri/src/inference/llama.rs:123-126`, `companion/inference-web.ts:99` |
| F-10 | Performance (when wired) | Pure-JS `StreamingSha256` over the whole model blob (~6–15 s for 500 MB) — must be worker-hosted when a UI wires `MirrorDownloader`. | `apps/local/src/mirror/download.ts:23-111` |
| F-11 | Spec/SC2 | Checklist integrity: T0.V ✅ with **no Verify/Accept lines**; ≥8 `[ ]` blocks have real passing implementations (see §3.3); only 2 of 25 ✅ blocks record Observed output (T0.1, T0.V); R/I/S phases verify by proxy (§3.5). | `CHECKLIST.md` |
| F-12 | Regression | **L.1 `[X]` Verify fails on re-run [observed]:** `pnpm vitest run packages/lore/tests/store.test.ts` → exit 1, 3 failed / 13 passed. All three expect the `_migrations` ledger `[ {id:1} ]`/`[ {id:1},{id:2} ]` but receive an extra `{id:3}` — migration 3 (`sessions.historical_person_id`, per X.1's spec) was added to `ddl.ts` after L.1's tests froze their expectation. Cross-task regression, undetected because F-1 kills `check.sh` before vitest. | `packages/lore/tests/store.test.ts`; `ddl.ts` |
| F-13 | Defect | **U.2 test fails [observed]:** `conversation.test.tsx:397` reads the frozen Figma ledger via `new URL("../../../../../LIBS/...", import.meta.url)` → `ERR_INVALID_URL_SCHEME` under the workspace vitest context. 1 failed / 21 passed. | `apps/local/src/screens/conversation/conversation.test.tsx:396-400` |

### Minor

F-14 `.ui-version` 11px violates the 12 px type floor (`apps/local/src/ui/primitives/primitives.css:230`; line-height 14px).
F-15 CSP: `base-uri`/`form-action`/`object-src` unset; `style-src 'unsafe-inline'` is a standing CSS-injection channel (verify whether any consumer needs it — React style props are CSSOM, not CSP-blocked); dead `asset:` allowance (assetProtocol never enabled). `tauri.conf.json:26`.
F-16 Unbounded IPC args (statement count, SQL bytes, param count, blob bytes) in `lore_open`/`lore_batch`; `inference` messages likewise (staged).
F-17 Single-statement CPU/mem exhaustion (`randomblob`, recursive CTE) + `LoreState` mutex stalls all lore IPC → `sqlite3_progress_handler` budget.
F-18 `natally-source-loop.mp4` (476 KB, `preload="auto"`) is a redundant second animation for the same mascot (Thinking); idle WebP alone is 3.4× the 500 KB per-asset guideline.
F-19 Web SQLite slowest-durability profile: `journal_mode=DELETE`, `synchronous=FULL`, strict IDB VFS, `BEGIN IMMEDIATE` even for pure reads (`store/web-sqlite.ts:72-90,155-162`).
F-20 Stage re-renders ~50 Hz during speech (worklet posts 20 ms RMS; 3-frame mouth is over-sampled ~10×; animated `backdrop-filter` compositing throughout) — throttle to 10–15 Hz or quantize.
F-21 Embeddings cross IPC as JSON number arrays (`data/db.ts:122-127`): 1.5 KB float32 → ~7 KB JSON per statement.
F-22 Vector search is brute-force `vec_distance_cosine` ORDER BY over scoped rows (not vec0 KNN) and `json_each(n.refs_json)` re-parses per row (`store/common.ts:183-185,303-327`).
F-23 Infinite rAF poll while model presence unknown (`use-conversation.ts:30-47`) — never terminates on a web leg without a model.
F-24 `onnxruntime-web/webgpu` fetched unconditionally even when the adapter probe fails and wasm runs (`voice/web.ts:193,213-219`).
F-25 Root `package.json` `vitest --passWithNoTests` converts "no coverage" into "green" — 32 test files exist; the flag now only masks gaps.
F-26 Doc staleness: ARCHITECTURE §3 + TOKENS.md header say the `@theme` mirror is `apps/local/src/styles/tokens.css` — it lives at `packages/design-tokens/tokens.css`; §5 cites `scripts/generate-icons.sh` (absent; U.10 in flight); §2 rows read as existing for pending `services/license-bridge`, `dist/`, per-target build scripts; `CLAUDE.md` "58 tasks" — disk has 60 blocks.

### Informational

- `src-tauri/src/inference/` staged but unmounted: no `mod inference;`, `llama-cpp-2` absent from Cargo.toml — dead code today. Its `model_path` confinement (canonicalize + `starts_with(model_root)` + GGUF `file_type==15`) is correct: preserve verbatim when wiring; register narrow permission/capability exactly as lore/ephemeris did.
- Desktop CSP `worker-src` inherits `script-src 'self'` → WASM/blob workers fail **closed**. Correct; do not widen it when web-inference code is present in the shared tree — keep desktop on the native lane.
- CHECKLIST backups (`CHECKLIST.md.bak…`, `CHECKLIST.v1.4…`) tracked at repo root — I3-compliant retention, cosmetic only.
- D20's structured Figma export does not exist (2026-09-13 connector returned an empty Cover page per `DOCS/DESIGN-INDEX.md`); README honestly records the shell is not the approved UI.
- `apps/hosted` absent while D22/D23 direct parallel build (README honest: "no tracked implementation yet").

### 2.1 Quality domain — clean bill (agent-verified)

Zero ≥80%-confidence logic bugs in: app core, shell/router, stage/mascot/glyphs/version, primitives, conversation screen logic, companion bus/lane/fence/persona/tools/inference-web, data layer, mirror, voice, sw.ts, content, all packages. Rejected candidates (so they are not re-litigated): cross-session token leakage (closed by abort propagation + `key={sessionId}` remount); `lifecycle.current!` (passive effects flush before discrete events); `db.ts snapshot()` batch atomicity (verified single transaction); engine unload on abort (deliberate fail-safe); fence Roman-letter over-capture (documented fail-closed); sw.ts network-only navigations (stated R.4 policy).

### 2.2 Security domain — posture summary (agent-verified)

Capabilities: three files, single `main` window, no wildcards, all `local:true`; `core:default` grants read-only introspection (no `allow-create-webview-window`); shell/fs/http/process plugins **absent from the dependency graph**. CSP production: `script-src 'self'`, `connect-src 'self' ipc: http://ipc.localhost`, no external endpoints. Ephemeris FFI: every numeric range/enumeration validated, tables sha256-verified + length-checked at init, panics caught via `catch_unwind` (host poisons instead of crashing), `SE_EPHE_PATH` override rejected. No `unwrap`/`expect` reachable from IPC outside `#[cfg(test)]`. No committed secrets (`.env` gitignored). Residual risk = F-4 (+F-16/F-17 side effects).

### 2.3 Performance domain — verified-good baseline

Every heavy engine is dynamically imported or worker-hosted and absent from the entry chunk (wllama, ORT/Kokoro, sweph ~2.6 MB at init only, lore SQLite). Chart facts content-addressed + double-cached (`facts.ts:80-94`, `charts.ts:57-69`). `SwephEngine.init` lazy/idempotent/re-entrant-safe. Native host: dedicated OS thread, bounded queue. Inference/embedding on `spawn_blocking`. The majors are F-5..F-10.

### 2.4 House-rule conformance scorecard [observed via grep]

| Rule | Verdict |
|---|---|
| D7/D7a audio law | ✅ 0 `speechSynthesis`/WebView-audio; `scripts/grep-no-speechsynthesis.sh` exits 0 (0 hits) |
| Fragility ethos | ✅ 0 third-party URLs in runtime source (apps/local/src, index.html, public, packages) |
| Fonts self-hosted (S.1) | ✅ 6 woff2 + 3 OFL licenses + `FONT_PROVENANCE.md` |
| Secrets (I-15) | ✅ no token patterns; `.env` gitignored |
| Content law (INC-19) | ✅ no compatibility/match-score strings |
| Versioning (CC7/CC9) | ✅ `1.13.21288` on all six surfaces; `versionCode 100013` = `MAJOR*100000+MINOR` |
| Ports (I-16/INC-11) | ✅ 46371, env-validated 1024–65535, `strictPort` |
| INC-16 | ✅ `emptyOutDir:false` in `vite.config.ts` AND `build-web.sh` (×2); no `rm -rf` in scripts; `-before-build`/`-previous-web` semantic renames |
| Tracked `dist/` (CC12) | ⚪ N/A — no release build yet; nothing unstamped on disk |
| Type floor 12 px | ❌ F-14 (one 11px) |
| Commit-at-completion (TC10) | ❌ F-3 |
| Verify-by-running (SC2/I-5) | ❌ F-11, F-12 |

---

## Part 3 — Narrow analysis: CHECKLIST task audit

### 3.1 Census [observed from `CHECKLIST.md` + block count]

**60 task blocks** (not 58 — `CLAUDE.md` predates T0.V and U.10 additions, F-26):
**25 ✅ · 3 [X] · 1 [/] · 31 [ ].** 29 touched, 31 untouched.

### 3.2 Per-task audit table

Legend — Marker: as signed off. Disk: artifact state. Evidence: what was **observed this audit** vs agent-verified (av) vs not re-run (—). Verdict: OK / **LAG** (implemented, unmarked) / **REGRESSED** (marked done, Verify fails now) / **BREACH** (SC2) / PENDING (genuinely absent) / PARTIAL.

| Task | Marker | Disk | Evidence (this audit) | Verdict |
|---|---|---|---|---|
| T0.1 scaffold | ✅ | present | Observed-para recorded; **but its `check.sh` now fails at step 1 (F-1)** — true when observed (v1.10.21039), regressed since | OK→REGRESSED (gate) |
| T0.V vendored ephemeris | ✅ | `VENDORED/` + lock + manifest (av: commits pinned exactly) | Observed-para present; **no Verify/Accept lines exist** | **BREACH** |
| T0.2 app scaffold | ✅ | present | typecheck-only Verify (by design); `app.tsx:5` now trips root TS2307 (F-1b) | OK (verify-tier: proxy) |
| T0.3 tauri scaffold | ✅ | present | `cargo check` Finished 0 errors (observed via I.2 run) | OK (proxy tier) |
| T0.4 tokens mirror | ✅ | present | gen chain 36/36 (av) | OK |
| T0.5 ephemeris contracts | ✅ | present | — (not re-run) | OK |
| T0.6 lore contracts | ✅ | present | — | OK |
| T0.7 billing contracts | ✅ | present | — | OK |
| T0.8 design-tokens pkg | ✅ | present | `gen.mjs --check` rerunnable (av) | OK |
| T0.9 DDL + migrate | ✅ | present | — ; **now carries migration 3** (source of F-12) | OK |
| T0.10 config loader | ✅ | present | — | OK |
| P.1 sweph backend | ✅ | present | conformance suite (av) | OK |
| P.2 solar rules | ✅ | present | — | OK |
| P.3 worker host | **[X]** | present | **14/14 pass, exit 0 [observed]** | OK — awaiting ✅ |
| P.4 facts builder | ✅ | present | — | OK |
| L.1 store adapters | **[X]** | present | **3 failed / 13 passed, exit 1 [observed]** | **REGRESSED (F-12)** |
| L.2 embedder | [ ] | **implemented** (`embed/` + tests) | **50/50 pass, exit 0 [observed]** | **LAG** |
| L.3 extract/merge | ✅ | present | — | OK |
| L.4 retrieval | [ ] | absent | — | PENDING |
| L.5 pipeline | [ ] | absent | — | PENDING |
| B.1 trial gate | ✅ | present | — | OK |
| B.2 ledger+consume | ✅ | present | — | OK |
| B.3 license token | [ ] | **implemented** (`token/` ≈1,240 lines + tests) | **22/22 pass, exit 0 [observed]** | **LAG** |
| B.4 codes | [ ] | absent | — | PENDING |
| B.5a/b/c adapters | [ ] | absent | — | PENDING |
| B.6 license bridge | [ ] | absent | — | PENDING |
| C.1 inference host | [ ] | **partial**: TS lane complete; Rust staged **unmounted** (no `mod inference;`, `llama-cpp-2` not in Cargo.toml) | **26/26 pass, exit 0 [observed]** (TS side) | **LAG/PARTIAL** |
| C.2 fence | ✅ | present | — | OK |
| C.3 tools | ✅ | present | — | OK |
| C.4 bus | ✅ | present | — | OK |
| V.1 voice native | [ ] | absent (`src-tauri/src/voice/`) | — | PENDING |
| V.2 voice web | [ ] | **implemented** | **36/36 pass + ban-grep 0 hits [observed]** | **LAG** |
| U.1 shell/primitives | ✅ | present | — ; carries F-14 (11px) | OK (defect F-14) |
| U.2 conversation | [ ] | **implemented** | **1 failed / 21 passed, exit 1 [observed]** (F-13) | **LAG + DEFECT** |
| U.3–U.8 screens | [ ] | absent | — | PENDING |
| U.9 stage | [ ] | **implemented** (stage.tsx + mascot assets) | **25/25 pass, exit 0 [observed]** | **LAG** |
| U.10 icons/mascot | [/] | substantially on disk (icons ×20, mascot.tsx, manifest links — untracked) | honest in-progress marker | IN FLIGHT |
| M.1 mirror | **[X]** | present | **37/37 pass, exit 0 [observed]** | OK — awaiting ✅ |
| X.1 data layer | [ ] | **implemented** (`src/data/` complete) | **20/20 pass, exit 0 [observed]** | **LAG** |
| X.2 destroy | [ ] | absent | — | PENDING |
| G.1 glossary | ✅ | present | — | OK |
| S.1 fonts | ✅ | present | 6 woff2 confirmed [observed]; Verify is an `ls | wc -l` proxy | OK (proxy tier) |
| I.1 route registry | [ ] | **absent** (`routes.generated.ts`, `gen-routes.mjs`) — **zero `registerRoute` call sites; every route renders honest-absence** | grep [observed] | PENDING — **keystone** |
| I.2 command registry | [ ] | **implemented** (`registry_generated.rs` + permissions/ + capabilities/) | **`cargo check` Finished, 0 errors [observed]** | **LAG** |
| I.3 capability layer | [ ] | absent | — | PENDING |
| I.4 workspace gate | [ ] | absent (`assert-budget.mjs`) | — | PENDING — blocked by F-1/F-2 |
| R.1/R.2/R.3/R.5 builds | [ ] | absent | — | PENDING |
| R.4 web build | ✅ | present | dry-run + real SW test (av) | OK (mixed tier) |
| R.6 version stamper | ✅ | present | 6-surface agreement verified (av) | OK |
| R.7 dormant CI | [ ] | absent | — | PENDING |

### 3.3 Marker-vs-disk reconciliation (F-11 detail)

Implemented-and-passing but marked `[ ]`: **L.2, B.3, V.2, U.9, X.1, I.2** (all Verify green this audit) and **C.1** (TS side green; Rust side staged-unmounted — the `[ ]` is half-honest). Implemented-but-failing: **U.2** (F-13 — must be fixed before any flip). All of these artifacts are inside the 54 **untracked** files (F-3) — the work and its ledger diverged together.

### 3.4 Regressions against sign-off

1. **F-12 (L.1):** `_migrations` expectations frozen at ≤2; `ddl.ts` now applies migration 3. Fix belongs to the test (or an explicit ledger assertion updated with rationale) — **not** to removing migration 3.
2. **F-13 (U.2):** frozen-ledger read via `new URL(..., import.meta.url)` breaks under the workspace vitest project (`ERR_INVALID_URL_SCHEME`). Fix: resolve via `path.resolve(__dirname, …)` / `node:path` equivalent in the test.
3. **T0.1 gate regression (F-1/F-2):** aggregate gate red since ephemeris `.ts`-extension imports and the `@natally/local-shell` alias landed — after T0.1's observation, before anyone re-ran the aggregate.

### 3.5 SC2 verify-quality tiers

- **Breach:** T0.V (✅ with no Verify/Accept).
- **Proxy verifies** (grep / file-count / typecheck / compile / dry-run, no observed artifact run): T0.2 (typecheck-only, by design), T0.3 (`cargo check`), S.1 (`ls | wc -l`), U.10 (borrowed verifies; operator-eyes acceptance deferred), I.1 (gen + typecheck), I.2 (`cargo check`), R.1/R.2/R.3/R.5 (`bash -n` + `--dry-run`), R.4 (dry-run + one real SW test).
- **Real observed runs:** T0.1 (recorded), T0.4–T0.10, P.1–P.4, L.1/L.3, B.1/B.2, C.2–C.4, V.2-when-flipped, M.1, G.1, R.6 (`--check` against real surfaces).
- **Evidence recording:** Observed-output paragraphs exist for 2/25 ✅ (T0.1, T0.V). The other 23 assert ✅ without recorded output — unverifiable after the fact per the marker protocol's own standard.

### 3.6 Remaining-work inventory (what "complete the checklist" means now)

**Ready to flip on evidence (after F-12/F-13 fixes + commit):** L.2, B.3, V.2, U.9, X.1, I.2 → `[X]`→✅ via their Verify lines; C.1 → finish Rust mount (`mod inference;`, Cargo deps, permission/capability files mirroring lore's pattern) then flip; U.10 → operator observation protocol (HTTP preview, reduced-motion still, icon artwork) then ✅; P.3, L.1, M.1 `[X]`→✅ (L.1 only after F-12 fix).

**Genuinely pending (23 blocks):** L.4, L.5 · B.4, B.5a, B.5b, B.5c, B.6 · V.1 · U.3, U.4, U.5, U.6, U.7, U.8 · X.2 · I.1, I.3, I.4 · R.1, R.2, R.3, R.5, R.7.

**Sequencing notes:** I.1 is the keystone (the shipped shell renders honest-absence on every route until screens register); I.4 runs last and **requires F-1 + F-2 fixed first** (its Accept is `check.sh` green); R-phase real builds gate the CC15 Milestone-1 provisional production build; B.6 needs the HF/bridge credentials path resolved; V.1 owns the last D7 surface.

---

## Part 4 — Remediation map (every finding → owner)

Ownership follows each block's **Owns** set; no side-channels:

| Finding | Owning surface | Action |
|---|---|---|
| F-1 | T0.1 (`tsconfig.base.json`) | add `allowImportingTsExtensions: true`; add `"@natally/local-shell": ["apps/local/src/ui/shell.tsx"]` to `paths` |
| F-2 | T0.1 (`biome.json`) + owning screens | ignore `src-tauri/gen/`; fix real rule hits; `biome-ignore` with reasons only where verified safe |
| F-3 | handback discipline | scoped commits (`git add` per task's files, never `-A`), `v{VERSION}: ` stamp via `update-version.sh`, push `origin` then `GIT_LFS_SKIP_PUSH=1 git push github` |
| F-4, F-16, F-17 | L.1 (`lore_commands.rs`) | authorizer denying ATTACH/DETACH/write-PRAGMA; arg caps; progress-handler budget |
| F-5 | L.1 | `async fn` + `spawn_blocking` for `lore_batch`/`lore_open` |
| F-6, F-18 | U.10 / U.9 | PNG still in fallback+TopBar; recompress idle loop; lazy or derive Thinking |
| F-7 | U.2 | streaming-text isolation, memoized rows, `useMemo` sort, no per-token layout read |
| F-8 | T0.9 (`ddl.ts` new migration) | `idx_turns_session`, sessions COALESCE expression index, `idx_lore_edges_to` |
| F-9 | C.1 (Rust mount) | session-scoped KV prefix reuse behind prefix-stable fence |
| F-10 | M.1 consumers / U.5 | host SHA-256 in a worker when the Download button wires |
| F-12 | L.1 tests | update `_migrations` expectations to include migration 3, with rationale comment |
| F-13 | U.2 tests | file-scheme-safe frozen-ledger path resolution |
| F-14 | U.1 (`primitives.css`) | 11px→12px (+line-height pairing) |
| F-15 | T0.3 (`tauri.conf.json`) | add `base-uri`/`form-action`/`object-src 'self'`; audit `style-src 'unsafe-inline'` consumers; drop dead `asset:` |
| F-19–F-24 | owning tasks (V.2/U.2/L-phase/M.1) | fold into their blocks' Specs at execution |
| F-25 | T0.1 (root `package.json`) | drop `--passWithNoTests` (32 test files exist) |
| F-26 | ARCHITECTURE.md / TOKENS.md / CLAUDE.md | path corrections; 58→60 |
| F-11 | CHECKLIST.md | true-up lagged markers **only with recorded Verify output**; backfill T0.V Verify/Accept (labelled retroactive); adopt Observed-para convention for every future ✅ |

---

## Appendix A — Reproduction commands

```bash
pnpm typecheck                                   # F-1: exit 2, 10 errors
pnpm lint                                        # F-2: exit 1, 33 errors
pnpm -r typecheck                                # canonical gate dies at root project (F-1)
pnpm exec vitest run packages/lore/tests/store.test.ts        # F-12: 3 failed / 13 passed
pnpm exec vitest run apps/local/src/screens/conversation      # F-13: 1 failed / 21 passed
pnpm exec vitest run packages/lore/tests/embed.test.ts        # L.2: 50 passed
pnpm exec vitest run packages/billing/tests/token.test.ts     # B.3: 22 passed
pnpm exec vitest run apps/local/src/voice                      # V.2: 36 passed
bash scripts/grep-no-speechsynthesis.sh                        # D7a: 0 hits
pnpm exec vitest run apps/local/src/ui/stage.test.tsx          # U.9: 25 passed
pnpm exec vitest run apps/local/src/data                       # X.1: 20 passed
pnpm exec vitest run apps/local/src/companion/inference.test.ts# C.1 TS: 26 passed
pnpm exec vitest run apps/local/src/mirror                     # M.1: 37 passed
pnpm exec vitest run packages/ephemeris/tests/host.test.ts     # P.3: 14 passed
cargo check --manifest-path apps/local/src-tauri/Cargo.toml    # I.2: Finished, 0 errors
bash scripts/update-version.sh --check                         # R.6: six surfaces agree
git status --porcelain | wc -l                                 # F-3: 76
```

*Report ends. Prepared for gpt-6 review and for the operator's remediation sequencing; no source files were modified during this audit.*
