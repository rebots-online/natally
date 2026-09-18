# natally — implementation checklist — v3 (recipe edition)

Regenerated **de novo 2026-09-17** from `DOCS/ARCHITECTURE.md` v3; expanded the same day
into the **recipe edition** per the Architecture Law (CLAUDE.md): ARCHITECTURE.md is the
snapshot of the finished product; this file is the recipe that makes it real. Every open
task below is a **fully self-contained instruction block** — no other task is needed to
code any task; everything the block asserts is defined in the cited architecture section.
Nothing that is not in this file may be coded. Execution is order-independent
(architecture §22): any subset of tasks, any order, any number of agents — no task
requires another task to exist or be complete. **Attestations (Law 8):** every task's
Spec names the exact symbols it wires from architecture §5/§5.1; in coder mode the coder
annotates the symbol's engaged-by cell in §5/§5.1 with `<task-id>✓` using that
nomenclature verbatim, so parallel agents converge. Predecessors preserved: `CHECKLIST.md.bak.20260917_091435.pre-v3`
and `CHECKLIST.md.bak.20260917_140133.pre-recipe`.

**Census (this edition, counted by task block):** 45 ✅ · 1 `[X]` (P.3; I.4 partial
noted inline) · 43 `[ ]`. Marker
discipline (SC2): coders (subagents) flip at most to `[X]` with observed runs; `✅` is
issued **only by the orchestrator seat** on semantic evaluation of the coder's `[X]`
work, as-completing, per task — send-back instead of ✅ when the work is not what it
claims.

## Execution protocol

Unchanged: atomic, idempotent, order-independent (§22 — no exceptions);
disjoint Owns; Verify + Accept observe durable end-state; commit+push per line; no mocks.

---

## Phase T — Scaffolding & contracts (complete)

- ✅ **T0.1–T0.10** — all scaffold/contract tasks complete with observed runs (evidence
  in v2 predecessor and commit lineage `e5e6926…77d0dd8`).

## Phase P — Ephemeris

- ✅ **P.1, P.2, P.4** — conformance, solar rules, chart builder; P.4 observed
  end-to-end in-browser (real natal chart from intake, `77d0dd8`).
- [X] **P.3 Worker/off-thread host** — web worker green; native transport mounts with I.2.

## Phase L — Lore (complete)

- ✅ **L.1–L.5** — store, embedder, extraction, retrieval (kNN∪2-hop, `61dc3a3`),
  write-every-turn pipeline (flush-once-per-turn, `61dc3a3`).

## Phase B — Billing & licensing

- ✅ **B.1, B.2** — trial gate (119 tests), reading ledger + consume.
- ✅ **B.3** — token verify + storage (web + Rust written; keychain via I.2).
- ✅ **B.4** — codes (NATALLY- Crockford, 4 outcomes exact, `ca0fef0`).
- ✅ **B.5a** — hosted-redirect adapter + bridge client + SSRF guards (`c1ceef3`).
- ✅ **B.5b** — RevenueCat adapter (SDK injected, `aba35cc`).
- ✅ **B.5c Adapter registry** — [observed: gate GREEN 39/39 1258/1258; 5 registry tests —
  frozen-order availability, hides absent rails, purchase dispatch, redeem via B.4,
  duplicate-registration error].

- [ ] **B.6 License bridge service** · §9.4  **Spec:** Operator-hosted Rust/axum service at `services/license-bridge/`. HTTP surface,
  exactly: one webhook endpoint per processor rail (stripe, revenuecat, polar,
  lemonsqueezy, paypal, square — §9.4's six), `POST /redeem`, `POST /verify`, and a
  deny-list publication route. Webhooks are HMAC-verified against per-processor secrets
  from the bridge's own `.env` (Admin-Manual convention; never a client value) and are
  idempotent via a SQLite ledger keyed `(processor, invoiceId)` — replayed deliveries
  return the first outcome, never re-mint. `POST /verify` checks the Ed25519 signature
  (public key baked in clients per §9.3) and the signed dated deny-list. `POST /redeem`
  consumes single-use codes: 128-bit random, stored SHA-256-hashed, returning B.4's four
  exact outcomes. `LICENSE_ED25519_PRIVATE_KEY` mints tokens `{ sub, tier: 'unlimited',
  iat, exp?: null, iss: 'natally-license-bridge', jti }`. Refund/chargeback webhook events
  that identify a fulfilled purchase revoke the minted `jti` onto the signed deny-list —
  the only revocation path (§9.4). No processor secret and no signing key ever ships in a
  client (assert in review).
  **Owns:** `services/license-bridge/**`.
  **Verify:** `cargo test --manifest-path services/license-bridge/Cargo.toml` and one
  observed local run driving a signed webhook fixture → token mint → redeem → deny-list
  revocation via curl, quoted in the task report.
  **Accept:** `bridge: webhooks HMAC-verified + idempotent, tokens mint/verify offline,
  redeem 4 outcomes, refund → deny-list revocation, zero client-side secrets`.

## Phase C / V / U / M / X / G / S / I / R — carried from v2

- ✅ **C.1–C.4, V.2, U.1, U.2, U.4, M.1, X.1, G.1, S.1, I.1, R.1–R.4, R.6** — all
  evidence-cited in the v2 predecessor and commit lineage.

- [ ] **V.1 Kokoro native (Rust)** · §10, §18.2  **Spec:** Voice synthesis + playback fully native in `src-tauri/src/voice/`: ONNX
  runtime in Rust loading §13's baked-manifest voice assets (`onnx/model_quantized.onnx`,
  `tokenizer.json`, `voices/af_heart.bin` — obtained through the mirror storage seam, never
  WebView audio, D7). Input: sentence chunks from the companion turn (§4 pipeline). Output:
  PCM playback through Rust audio **plus** the three-valued envelope event stream —
  `envelope-start`, `envelope-level(0..1)` per 20 ms window, `envelope-end` on stream close
  or after the 120 ms silence threshold (§10 exact semantics) — emitted on the companion
  event bus so Stage `Speaking` spans `envelope-start → envelope-end`. `speechSynthesis`
  is banned (the R.7 grep guard covers native too). Commands mount via I.2's registry;
  until I.2 lands, cargo tests prove synth→PCM→envelope without a UI.
  **Owns:** `apps/local/src-tauri/src/voice/**`.
  **Verify:** `cargo test --manifest-path apps/local/src-tauri/Cargo.toml voice` (unit) +
  one observed native run after I.2: companion turn → audible speech → envelope events.
  **Accept:** `voice native: Rust synth+playback of Kokoro q8 with af_heart, envelope
  events fire at the §10 semantics, zero speechSynthesis calls`.

- [ ] **U.3 Plates + Atlas screens** · §18.1 wiring law, D21  **Spec:** The in-transcript PlateCard opens the Atlas instrument view; the chart wheel is
  the **rotating 3D doughnut/toroidal shape** (D21) with deliberate legible 2D rendering
  wherever a 2D view is present; hover callouts on glyphs (glossary-term hover law, U.7
  shares the component). Every element wires from `LIBS/UI/STITCH-v2/<screen>/code.html`
  element names/labels **verbatim** (TopBar, Composer, PlateCard, TurnHer/TurnYou, shell,
  stage, wheel vocabulary — §18.1); no invented element names. Chart data is ChartFacts
  only (§5, computed provenance); unknown-birth-time renders the solar-chart absence
  branches (§6 honest absence rules).
  **Owns:** `apps/local/src/screens/atlas/**`, `apps/local/src/ui/plate*`.
  **Verify:** `pnpm vitest run apps/local/src/screens` + observed in-browser: plate →
  atlas → torus rotates → hover callout shows authored glossary text.
  **Accept:** `atlas: 3D torus wheel renders ChartFacts, 2D views legible, hover callouts
  fire, element names match STITCH-v2 verbatim`.

- [ ] **U.5 Settings — 6 sections** · §9.1, §13, §18.2, §19, §21  **Spec:** Six sections, wired from STITCH-v2 element names: **Model** (catalogue rows
  rendered from the baked §13 manifest — 5 ready assets; locked rows show the §9.1 lock and
  route `/paywall`; download progress states from DownloadProgress `downloading/verifying/
  present`); **Voice** (voice-on-by-default toggle, replay affordance per §18.2); **Data**
  (lore summary line from `stats() → {turns, nodes, edges}`, J8 export, delete-everything
  entry point → X.2); **Lore** (extraction/retrieval flags per §15 lore flags); **License**
  (entitlement state + restore, customer language per §21.2 — approved micro-copy only);
  **Storage** (shared-asset library state per §19: scope display, claims, release actions).
  **Owns:** `apps/local/src/screens/settings/**`.
  **Verify:** `pnpm vitest run apps/local/src/screens/settings` + observed walk of all six
  sections in the built app.
  **Accept:** `settings: 6 sections render real state (manifest rows, stats line,
  entitlement, storage claims), zero forbidden customer-copy terms (OR.2 scanner green on
  these surfaces)`.

- [ ] **U.6 Paywall + checkout** · §21.1, §21.2, §9.1, §9.4  **Spec:** 13 frames (paywall ×7, checkout ×6) wired from STITCH-v2 element names. Copy is
  **exactly** §21.1's approved table: "Unlimited chats with natally" / "One purchase. Chat
  with natally as often as you like." · "Pay as you chat" / "Start with a little credit.
  Pay only for the chats you use." · "Monthly chat credits" / "Includes [configured
  amount] $ROCHE each month." — plus approved micro-copy only ("Add $ROCHE to keep
  chatting." / "You're offline. Connect to keep chatting." / "Restore purchases."). The
  "Ways to pay" line is B.5c's frozen-order honest availability readout (blank rail ⇒
  hidden, never a dead button). Checkout hands off per §9.4 per-platform: RC paywall
  (Android), hosted-redirect (web/PWA), hosted-redirect + QR + manual license-key path
  (desktop `/checkout` `enter-license-key`, format `NATALLY-XXXX-XXXX-XXXX`). Hard rules
  rendered honestly: depleted balance never revokes Unlimited; no silent paid-remote
  switch (§21.1).
  **Owns:** `apps/local/src/screens/paywall/**`, `apps/local/src/screens/checkout/**`.
  **Verify:** `pnpm vitest run apps/local/src/screens` (includes OR.2 language-law scan)
  + observed walk: paywall → checkout → key-entry path with a B.4 test code.
  **Accept:** `paywall+checkout: 13 frames, exact §21.1 strings, honest availability line,
  license-key redeem end-to-end, language law green, §11.1(a) legal links present on
  checkout (privacy + terms beside the purchase action)`.

- [ ] **U.7 About + glossary-callout** · §6 AGPL posture, INC-19 §5  **Spec:** About screen carries the AGPL-3.0-or-later line and source-offer statement per
  §6 (license-lint counterpart in R.7). Hover-term callouts: glossary terms (`GlossaryEntry`
  term/body/glyph, authored provenance) surface as hover explanations across screens;
  shared callout component consumed by U.3 atlas glyphs. Provenance rendering follows §5:
  Plex Mono for `computed`, Fraunces margin for `generated`, labelled sections for
  `authored`, distinct absence treatment.
  **Owns:** `apps/local/src/screens/about/**`, `apps/local/src/ui/glossary-callout*`.
  **Verify:** `pnpm vitest run apps/local/src/screens` + observed hover on three terms.
  **Accept:** `about: AGPL line + provenance labels present; hover callouts show authored
  glossary text on atlas + conversation terms; §11.1(a) legal links to
  /legal/privacy.html + /legal/terms.html present`.

- [ ] **U.8 Splash** · D21, §12  **Spec:** Typewriter onboarding splash (D21 — Kintsugi's big bold typography + typewriter
  as behavior reference only, clean-room D2) whose progress is the **real** engine/model
  load progress from capability signals (model presence, engine load progress — §10 Stage
  signal sources); never a fake timer. First plate budget §12 unchanged (≤150 ms after
  tables warm). Reduced-motion renders without animation (a11y floor).
  **Owns:** `apps/local/src/screens/splash/**`.
  **Verify:** `pnpm vitest run apps/local/src/screens` + observed cold load: typewriter
  advances only as real load events arrive; throttled/artificial network shows honest stall.
  **Accept:** `splash: typewriter paced by real capability signals, reduced-motion honored,
  no fabricated progress`.

- [ ] **U.9 Stage (sprite MascotRenderer)** · §18.2, §10, STATES.md  **Spec:** Porthole law: natally present on EVERY screen — bottom-right circular
  ship-window portal on non-conversation surfaces; conversation docked OPEN by default.
  Sprite MascotRenderer (pluggable): real-footage idle core (operator's natally-idle loop)
  + authored sprite states + gold-hairline silhouette placeholders; **no AI-generated
  character art**. Idle cycle implements §18.2's enumerated behaviours verbatim (lounging
  atop the composer, standing behind the gold circle, tending the crystal ball,
  doom-scroll/texting, attention gestures, time-of-day mirroring, cursor-grab/ride desktop,
  finger-pounce touch). Asleep is animated (droopy eyes, twitches, near-drop-and-hug).
  States drive only from the `StageSignal` union (companion bus events ∪ capability
  signals, C.4); Thinking on request-sent, Speaking on envelope, Delighted/Error per §10.
  Reduced-motion selects frame 0. `Mascot` (TopBar/startup/error surfaces, §5 row) remains
  separate and state-less.
  **Owns:** `apps/local/src/ui/stage.tsx`, `apps/local/src/ui/mascot.tsx` (Stage side),
  `apps/local/src/assets/mascot/**`.
  **Verify:** `pnpm vitest run apps/local/src/ui` + observed: send a turn → Thinking →
  Speaking bound to envelope; idle → Asleep cycle; reduced-motion frozen frame 0.
  **Accept:** `stage: porthole on all screens, docked-open conversation, sprite idle cycle
  + animated Asleep, states only from StageSignal, reduced-motion frame 0`.

- [ ] **X.2 Delete-everything** · §8.4, §18.6, §19.5  **Spec:** Settings › Data delete-everything performs **real deletion** (rows + vectors,
  never soft-hide) of private data: people, sessions/turns (transcript history included
  here — this is the explicit user-initiated wipe, distinct from person-removal §8.4 which
  preserves transcript), charts, lore nodes/edges/embeddings, consumed codes, cached
  private state. Shared assets: release natally's claims per §19.5 — never delete shared
  bytes another app needs; the §19 release-of-claim path applies. Person-removal flow
  (People edit) keeps its own §8.4 semantics. Both actions run behind the standard confirm
  affordance.
  **Owns:** `apps/local/src/data/destroy.ts` (+ repository methods it calls).
  **Verify:** `pnpm vitest run apps/local/src/data` + observed run: seeded store → delete →
  SQLite/vec counts zero, shared object untouched, claims released.
  **Accept:** `delete-everything: private rows+vectors truly gone, shared bytes preserved,
  claims released, confirm affordance required`.

- [ ] **I.2 Tauri command registry** · §3 capability law, §4  **Spec:** One generated command registry in `src-tauri` mounting every native capability
  behind typed commands: P.3 worker transport (native ephemeris tokio task), L.1 lore store
  (`lore_commands.rs` — private, never shared-store), B.3 keychain token storage, C.1
  native inference lane, M.1 native mirror storage. Selection between web/native
  implementations is the I.3 capability layer's single decision point — the registry never
  branches on platform itself. Mounting V.1's voice commands completes P.3's `[X]`→✅ and
  B.3's keychain note.
  **Owns:** `apps/local/src-tauri/src/registry_generated.rs`, `apps/local/src-tauri/src/plugins/**`,
  `apps/local/src-tauri/capabilities/**`.
  **Verify:** `cargo test --manifest-path apps/local/src-tauri/Cargo.toml` + observed
  native run: ephemeris + lore + inference + keychain + mirror all reachable through the
  registry in one session.
  **Accept:** `registry: all native commands mounted, capability selection delegated to
  I.3, no platform branching in command bodies`.

- [ ] **I.3 Capability layer** · §3  **Spec:** Exactly one selection point mapping each capability (ephemeris host, inference
  lane, voice synth/playback, secure storage, mirror storage, lore storage) to its web or
  native implementation from build + runtime capability signals. Law: **never** `if
  (platform)` scattered through components (§3); components receive the selected
  implementation via composition (`createConversationComposition` shape).
  **Owns:** `apps/local/src/capabilities/**`.
  **Verify:** `pnpm vitest run apps/local/src/capabilities` + code review observation: zero
  platform conditionals outside the layer (biome rule or review note quoted).
  **Accept:** `capabilities: single selection point, all §3 capabilities mapped, zero
  out-of-layer platform branching`.

- [ ] **I.4 Full workspace gate** · §12, §14  **Spec:** `check.sh` green across all workers (typecheck strict, lint, unit +
  conformance suites) **and** the §12 budget asserts active: initial JS ≤ 300 KB gz;
  ephemeris WASM/tables, llama runtime, Kokoro weights lazy + sha256-verified + cached
  (none in the initial bundle — assert, not eyeball). Current state: green at 2 workers
  `[X]`; budget assert owed.
  **Owns:** `scripts/check.sh`, bundle-budget assert wiring.
  **Verify:** `./scripts/check.sh` (full) — quote exit code and the budget-assert output
  line for the built `dist/web`.
  **Accept:** `gate: full workspace green at all workers, JS budget assert present and
  passing on the built artifact`.

- ✅ **R.5 build-all + release flow** · §14, §18.5, CC14 · [orchestrator semantic
  evaluation 2026-09-17: observed run artifacts verified — android apk+aab, linux
  AppImage+deb, win exe+NSIS, web archives, ALL stamped v1.29.27910, zero off-stamp
  outputs; android first attempt failed environmentally (rust-lld bus error) and was
  retried honestly, never fabricated; post-build bump ran (1.30.27931, --check
  consistent); update-version.sh --check quoted; 2026-09-18 rerun produced the full
  v1.31.28919 matrix, including production-signed APK and AAB independently verified,
  then advanced the canonical source to v1.32.28929]  **Spec:** `scripts/build-all.sh` honors `release.lock` single-flight: one stamp for every
  platform in one invocation; post-build bump via `update-version.sh --post-build`; every
  artifact named `mba.robin.natally-v<MAJOR.MINOR.BUILD>-<qualifier>` in tracked `dist/`;
  never an unstamped or wrongly-stamped artifact left behind. Android stays single-ABI
  (aarch64) until a bigger-RAM host (§18.5); Android is mandatory, and any Android failure
  fails the full matrix. The final audit requires both the stamped APK and AAB. No destructive clean (`emptyOutDir: false`
  law); regenerated artifacts renamed with semantic suffixes (TC5).
  **Verify:** one observed `./scripts/build-all.sh` run under `release.lock` — quote the
  stamp and the resulting artifact list.
  **Accept:** `release: single release.lock stamp across Android apk+aab, web, Linux and
  Windows artifacts in dist/, zero unstamped outputs, post-build bump ran`.

- [ ] **R.7 Dormant CI + guards** · §6, §10, §11, CC3/TC14  **Spec:** Dormant workflows authored (`.github/workflows/` + `.forgejo/workflows/`
  sibling, CC3 — uninvoked until public release, TC14). Guards wired into them:
  license-lint (fail if any `sweph` import exists while `package.json.license ≠
  AGPL-3.0-or-later`, or any proprietary claim while sweph is in-tree — §6 exact rule);
  `speechSynthesis` grep guard (all legs, D7); secret greps (`hf_`/`sk-`/private-key
  patterns, §11); typecheck + lint + unit + conformance + bundle-budget asserts (§14
  CI-when-awake list).
  **Owns:** `.github/workflows/**`, `.forgejo/workflows/**`, guard scripts.
  **Verify:** guard scripts run locally observed (license-lint pass case + a deliberate
  fail case each); workflow files validate (actionlint or schema check).
  **Accept:** `ci: workflows authored dormant, all five guards demonstrably fail-red and
  pass-green in local observation, zero invocations`.

## Model sourcing (§13 public HF contract)

- ✅ **MS.1 Build-time manifest** — [observed: gen-manifest --check passes; **5 assets**,
  all absolute huggingface.co URLs, sha256 pins present, trial model qwen3.5-2b,
  1333.9 MB total]. True-up (recipe edition): the shipped manifest carries the **five
  ready assets** of §13's frozen source catalogue (Qwen3.5-2B, Kokoro q8 + tokenizer +
  af_heart, MiniLM q8_0); **LFM2.5-2.6B is not the default and is out of scope at this
  stage** (operator 2026-09-17); adding any asset is a decision-entry event (SC1).
  **Owns:** `apps/local/src/mirror/catalogue.json` + `scripts/gen-manifest.mjs`.
  **Verify:** `node scripts/gen-manifest.mjs --check` · **Accept:** `manifest: 5 ready
  assets, all absolute huggingface.co URLs, sha256 pins present, one trialEligible`.
- ✅ **MS.2 Manifest loader update** — [observed: composition uses loadBakedManifest; mirror
  tests 37/37; gate 39/39 1258/1258; origin-allowlist test for huggingface.co].

## Shared storage (§19)

- ✅ **SS.1 Scope config generator** · §19.1  **Spec:** `scripts/generate-storage-config.mjs` emits `config/asset-storage.generated.json`
  from `VITE_STORAGE_SCOPE` (validation regex `^[a-z0-9][a-z0-9_-]{2,63}$`; scope is a
  frozen public constant like `shared-content-v1`, never a Settings switch, never a secret
  or entitlement). Both consumers read the one generated file: Vite (`apps/local/src/storage/
  build-config.ts`) and Rust (`src-tauri/src/storage_config.rs` via `include_str!`) with
  `cargo:rerun-if-changed`. Generation runs under `release.lock`. Scope change = storage
  migration (old discovery aliases retained until assets accounted for).
  **Owns:** the script, the generated file, both consumers.
  **Verify:** `node scripts/generate-storage-config.mjs production && cargo check
  --manifest-path apps/local/src-tauri/Cargo.toml` — quote both outputs; invalid-scope
  fixture exits non-zero.
  **Accept:** `scope config: one generated artifact consumed by both targets, schema
  validated, invalid scopes rejected`.

- ✅ **SS.2 Content-identity store types** · §19.2, §19.3  **Spec:** The §19.2 record set as frozen types: ContentIdentity (SHA-256 of exact bytes +
  expected byte count; immutable object path `objects/sha256/<ab>/<full-digest>`; scope
  selects the library, not the hash), CatalogueAlias (asset ID + immutable revision →
  digest/format/architecture/quantization/license/minimum-runtime/dependency-bundle),
  RuntimeQualification (backend/version, context limit, tokenizer/template, hardware
  capability — separate from file presence), AccessLocator (native path / fd+offset+length /
  document URI / security-scoped bookmark / browser handle — never a bare path string),
  UsageClaim/Lease (consumer identity, active read lease/pin, lifetime + recovery rules).
  Plus the `SharedAssets` interface (`lock(key, run)`, `lookup(asset, signal)`,
  `acquire(asset, signal)`) and the exhaustive `Lookup` union (`ready{lease}` | `missing` |
  `needs-grant`/`unavailable`/`corrupt` with reason). Shared-vs-private classification per
  §19.2's lists is encoded as a closed set.
  **Owns:** `packages/storage/src/types.ts` (new package; `packages/billing/src/types.ts`
  `ManifestAsset` extension for kinds + dependency graphs + access locators per §19.6 last
  row).
  **Verify:** `pnpm vitest run packages/storage` · **Accept:** `storage types: record
  roundtrips, Lookup union exhaustive (compile-time assert), lease lifecycle states valid
  transitions only`.

- [ ] **SS.3 Resolve-existing-first resolver** · §19.3, §19.5  **Spec:** `resolveExistingFirst(scope, asset, store, signal)`: validate identity →
  `lookup` (shared providers first, then authorized legacy/private caches) → on `missing`,
  acquire the `scope:digest` lock and **re-lookup inside the lock** (single-writer: two
  apps arriving simultaneously produce one published object) → `acquire` returns a read
  lease only after persisted bytes are verified (hash the **full persisted content**, size
  + digest + compatible metadata) and atomically published. A logical bundle is ready only
  when **all** required digests are available. Never start a multi-GB download after a
  denied/expired grant.
  **Owns:** `packages/storage/src/resolver.ts`.
  **Verify:** `pnpm vitest run packages/storage` (concurrent-caller test: N parallel
  resolves of the same missing asset perform exactly one publish) · **Accept:** `resolver:
  lookup-first, lock-recheck, single-writer publish, concurrent callers share one object,
  corrupt bytes never leased`.

- [ ] **SS.4 Browser adapter** · §19.4 row Browser/PWA  **Spec:** Shared library root = same-origin OPFS / Cache Storage with the stable path
  layout `objects/sha256/<ab>/<digest>` under the storage scope; service-worker control;
  coordination via the **Web Locks API** keyed `scope:sha256` (the `SharedAssets.lock`
  implementation); File System Access handles where supported. Fallbacks: partial-object
  recovery from interrupted writes; quota handling surfaced as `unavailable` Lookup with
  reason (never a silent failure).
  **Owns:** `apps/local/src/storage/web.ts`.
  **Verify:** `pnpm vitest run apps/local/src/storage` (two-context test where the runtime
  allows; else simulated concurrent acquires) · **Accept:** `web adapter: cross-tab reuse
  zero-network, partial-object recovery, quota → unavailable-with-reason`.

- [ ] **SS.5 Linux adapter** · §19.4 row Linux  **Spec:** Root `$XDG_DATA_HOME/<scope>` (fallback `$HOME/.local/share/<scope>`); OS file
  locks (flock/fcntl) keyed scope:digest; read-only handles for readers; transactional
  publication = same-directory temp file + verified fsync + atomic rename; Flatpak/Snap
  fallback → document portal. Object path layout per §19.2.
  **Owns:** `apps/local/src-tauri/src/storage/linux.rs`.
  **Verify:** `cargo test --manifest-path apps/local/src-tauri/Cargo.toml storage::linux`
  · **Accept:** `linux adapter: shared root resolved, digest lock held during publish,
  verified atomic publish, second consumer reuses zero-network`.

- [ ] **SS.6 Windows adapter** · §19.4 row Windows, §20.5  **Spec:** Root `FOLDERID_Profile` + `Shared AI Assets/<scope>/` — outside AppData
  virtualization, shared by MSI and MSIX editions. `LockFileEx` digest locks; native
  broker returns read-only handles; discovery/migration of prior downloads under
  LocalAppData (read-only discover → validate → claim); same-volume atomic publish (flush +
  qualified rename); validation = size/digest/reparse-point/containment checks per §20.5;
  release claims on uninstall.
  **Owns:** `apps/local/src-tauri/src/storage/windows.rs`.
  **Verify:** `cargo test` cross-compile check on Linux + observed run on the Windows host
  (W7-4 window acceptable) · **Accept:** `windows adapter: profile root resolved via
  known-folder API, prior-download discovery, LockFileEx serialization, atomic verified
  publish`.

- [ ] **SS.7 Android adapter** · §19.4 row Android  **Spec:** SAF document-tree grant (user-selected) with persisted URI permissions;
  `ContentResolver` descriptor semantics (seekable read-only fds); `BlobStoreManager` for
  immutable blobs with shared `BlobHandle` identity (= §19.2 content identity); content
  URI ≠ filesystem path (AccessLocator carries the URI). Optional provider-app fallback.
  **Owns:** Kotlin glue under `apps/local/src-tauri/gen/android/` + Rust bridge.
  **Verify:** on-device test (W7-4 window acceptable) · **Accept:** `android adapter: SAF
  grant persisted across restarts, blob identity shared, zero-network cross-app reuse
  observed`.

- [ ] **SS.8 Downloader integration** · §19.6  **Spec:** The §19.6 mapping, executed: `MirrorDownloader.download` consults the resolver
  **before** any network fetch (lookup-first through SS.3); `MirrorStorage`/
  `WebMirrorStorage` gain shared discovery/access without invalidating existing caches;
  `CatalogueStore.remove` becomes release-of-claim (never deletes shared bytes another app
  needs); `loadRuntimeConfig` wires `VITE_STORAGE_SCOPE` through generated config + native
  construction; lore DB stays private (never relocated). Existing resume/cancel/integrity
  semantics of `download` are preserved unchanged (ranged resume, StreamingSha256 verify,
  free-space precondition).
  **Owns:** `apps/local/src/mirror/download.ts`, `apps/local/src/mirror/catalogue.ts`,
  `apps/local/src/mirror/cache.ts`, `apps/local/src/config.ts` touchpoints.
  **Verify:** `pnpm vitest run apps/local/src/mirror` · **Accept:** `downloader: shared
  hit = zero network bytes, absence = download + publish, removal = claim released with
  shared bytes intact`.

## Windows packaging (§20)

- [ ] **WP.1 Partner Center identity** · §20.2  **Spec:** Commit `config/windows-store-identity.json` with the Partner Center-reserved
  values: `STORE_IDENTITY_NAME`, `STORE_PUBLISHER` (DN), `PUBLISHER_DISPLAY_NAME`,
  `MSIX_VERSION` policy note (four 16-bit fields, fourth reserved zero),
  `TESTED_WINDOWS_VERSION`, `ARCHITECTURE`; plus the MSI `UpgradeCode` (generated once,
  never per build). These are independent of `mba.robin.natally`, the storage scope, and
  RevenueCat project IDs (§20.2 rule). Values are transcribed from the operator's
  Partner Center reservation (CREDENTIALS/manual record) — placeholder values are
  forbidden (complete-work law); the reservation is resolved operator-side before this
  task runs, never improvised.
  **Owns:** `config/windows-store-identity.json` + its validator.
  **Verify:** validator run (schema + non-empty + DN shape) · **Accept:** `identity: all
  §20.2 fields committed, validated, referenced by WP.2/WP.3`.

- ✅ **WP.2 AppxManifest generator** · §20.3  **Spec:** `scripts/gen-appx-manifest.mjs` + `config/appx-template.xml`: full-trust
  `packagedClassicApp` at `mediumIL`; `runFullTrust` capability; `MinVersion=10.0.22000.0`;
  `MaxVersionTested` records an actually-tested version; generator XML-escapes every
  substituted value and **rejects unresolved `@…@` tokens**; manifest is generated, never
  hand-edited.
  **Owns:** the script + template.
  **Verify:** `node scripts/gen-appx-manifest.mjs --check` (valid XML parse + token
  resolution + escaping fixture with `&<>"'` values) · **Accept:** `appx manifest:
  generates valid XML, all tokens resolved, runFullTrust declared, escape-hostile values
  safe`.

- ✅ **WP.3 Version ordinal mapping** · §20.4 · [orchestrator semantic evaluation
  2026-09-17: source inspected — §20.4 formulas verbatim; overflow guard errors at
  255·2²⁴ (observed); ordinal round-trip observed (bump n=1→2, restored, --check PASS);
  adversarial probe: monotonicity asserted per numeric field-tuple (correct MSI/MSIX
  semantics — plain string compare would break at 1.0.9 vs 1.0.10, test does it right);
  node --test 4/4 observed by orchestrator. Note recorded: --bump is a plain write (no
  flock helper exists in scripts/) — acceptable, CC14's release.lock unification at R.5
  covers stamp single-flight]  **Spec:** `scripts/windows-version.mjs` + committed `config/windows-release-ordinal`
  (integer `n`, increments once under `release.lock`). Exact §20.4 formulas, verbatim:
  `msi = [1 + floor(n / 2^24), floor(n / 65536) % 256, n % 65536].join(".")` and
  `msix = [1, floor(n / 65536), n % 65536, 0].join(".")`; MSI ProductVersion field limits
  ≤ 255/255/65535 enforced; never truncate or extra-modulo. Ordinal persists beside
  release metadata.
  **Owns:** the script + ordinal file.
  **Verify:** `node scripts/windows-version.mjs --check` over boundary fixtures
  (n = 0, 65535, 65536, 2²⁴…) · **Accept:** `windows versions: monotonic across
  increments, field limits respected, ordinal persisted once per release`.

- [ ] **WP.4 Build pipeline completion** · §14 host auto-detect, §20.1 defect, §20.6
  **Spec:** Fix §20.1's observed defect with **host auto-detection** (§14): on Linux,
  `scripts/build-windows.sh` cross-compiles exe+NSIS via cargo-xwin exactly as today;
  when run on Windows it builds **native .exe and .msi at that time** (msix per §20.6).
  Windows-host path: per-arch staging → native MSI → `MakeAppx pack` / `MakeAppx bundle`
  → sign (SHA-256 + timestamp, credential-managed) → record in the release manifest:
  MSI, each MSIX, optional bundle, hashes, display version, package version (from WP.3),
  source SHA, architecture, signing/verification status. Disable the self-updater in
  Store MSIX (Store owns updates).
  **Owns:** `scripts/build-windows.sh`.
  **Verify:** observed run on each host type — Linux run and Windows-host run, both quoted.
  **Accept:** `windows: linux run yields exe+NSIS unchanged; windows-host run yields
  native exe + msi (+ msix/bundle), signed, hashes recorded in release manifest` (only
  then is R.2's done-marker honest, §20.1).

- [ ] **WP.5 Shared library bridge** · §20.5, §20.7 (Windows host for observation)
  **Spec:** Integration test proving the §20.7 acceptance row: MSI-installed and
  MSIX-installed natally (two package identities) + direct MSI share the same
  `Shared AI Assets/<scope>/` library — one downloads, the others reuse with zero network
  transfer (SS.6 adapter underneath).
  **Owns:** the integration test + any adapter glue it exposes.
  **Verify:** on-device run on Windows 11 x64 · **Accept:** `windows shared library: MSI +
  MSIX apps share one digest with zero network transfer; uninstall preserves other
  consumers' assets`.

## Offers + ROCHE + customer language (§21)

- ✅ **OR.1 Offer catalog + copy** · §21.1, §21.5  **Spec:** `packages/billing/src/offers.ts` + committed copy JSON defining exactly three
  offers with §21.1's exact strings (title + sub-line as in the table) and §21.5 catalog
  separation: non-consumable lifetime ("Unlimited chats with natally"), consumable $ROCHE
  packs ("Pay as you chat"), optional finite subscription ("Monthly chat credits" with
  configured amount). Distinct product IDs / RC product IDs / entitlement keys / currency
  code (`ROCHE` in RC, `$ROCHE` customer-facing) per offer. Subscription row states whether
  it grants credits, time-limited local access, or both. Hard rules encoded as test
  assertions: depleted balance never revokes owned Unlimited; Unlimited never makes remote
  requests free; no silent switch to paid remote; lifetime buyers never relabelled
  subscribers.
  **Owns:** `packages/billing/src/offers.ts` + copy JSON + `offers.test.ts`.
  **Verify:** `pnpm vitest run packages/billing/tests/offers.test.ts` · **Accept:**
  `offers: three paths, exact approved copy, catalog separation, hard-rule assertions
  green`.

- [ ] **OR.2 Customer language enforcement** · §21.2  **Spec:** `packages/billing/tests/language-law.test.ts` scans every customer-facing
  surface (paywall, onboarding, settings, receipts, error strings, Store-listing copy) for
  the forbidden terms: "local", "inference", "ephemeris", model names, "token",
  "quantization", "API", computing-location wording. Allowed micro-copy set: "Add $ROCHE
  to keep chatting." / "You're offline. Connect to keep chatting." / "Restore purchases."
  Technical docs and internal logs keep exact implementation names (scan scope is
  customer surfaces only — the customer-facing copy modules are enumerated imports, a
  closed set).
  **Owns:** the test + the enumerated customer-copy modules it scans.
  **Verify:** `pnpm vitest run packages/billing/tests/language-law.test.ts` (must fail-red
  on a seeded violation fixture, pass-green clean) · **Accept:** `language law: zero
  forbidden terms in customer surfaces, fail-red proven`.

- ✅ **OR.3 ROCHE currency contract** · §21.3  **Spec:** `packages/billing/src/roche.ts`: integer units, range 0..2×10⁹, no negative
  balances (invariant), unit precision defined once. Authority split encoded: RC = system
  of record for balances + purchase-driven grants; the application service = jobs,
  reservations, provenance, reconciliation — the service never computes a second wallet
  total; all participating projects call the same spend boundary. Fungibility matrix per
  §21.3: Windows MSIX / direct MSI + Linux / hosted web + PWA → common eligible pool;
  Google Play → origin-restricted (Play policy); direct Android → distinct from Play
  origin; future Apple → StoreKit/RC rules; restricted-origin credits never silently mix
  into unrestricted funds.
  **Owns:** `packages/billing/src/roche.ts` + `roche.test.ts`.
  **Verify:** `pnpm vitest run packages/billing/tests/roche.test.ts` · **Accept:** `roche:
  units bounded, lifecycle events table-complete, fungibility rules enforced, no-negative
  invariant unbreakable`.

- [ ] **OR.4 Quote/reserve/settle state machine** · §21.4  **Spec:** Server-side durable state machine implementing §21.4's graph **exactly**:
  `created → debit_pending → reserved → running → settling → completed`, with
  `refund_pending → refunded` from running/settling and `declined` from debit_pending;
  uncertain network results reconcile on the `(account, request-id)` operation identity.
  Reserve the quoted maximum from RC **before** dispatch (atomic deduction prevents
  concurrent overspend); durable idempotency keys tied to the original job; at completion
  meter actual usage and return the unused reservation **exactly once**; provider failure
  before paid work → full refund; no per-token debits — reserve once, settle once per
  bounded request.
  **Owns:** server-side module in the license bridge or hosted service.
  **Verify:** integration test with concurrency (two concurrent spends of one balance →
  exactly one reserve succeeds) + replayed completion (same request-id → one settle)
  · **Accept:** `spend: reserve-before-dispatch, settle-once, refund-on-failure,
  concurrent-safe, idempotent`.

- [ ] **OR.5 Microsoft Store adapter** · §21.7, SC1  **Spec:** First: the schema amendment as a recorded decision event — add `'microsoft'`
  to `PurchaseAdapterId` (SC1; cite this task in the commit). Then `adapters/microsoft.ts`:
  `Windows.Services.Store.StoreContext` adapter — associate with the real Store product →
  `RequestPurchaseAsync` checkout → backend validation via Microsoft service APIs →
  sync-once into RevenueCat → bridge mints the appropriate token or currency grant (§21.7
  flow). Available() reflects Store-context presence only.
  **Owns:** `packages/billing/src/types.ts` amendment + `adapters/microsoft.ts` +
  `adapters-microsoft.test.ts`.
  **Verify:** `pnpm vitest run packages/billing/tests/adapters-microsoft.test.ts` (mocked
  StoreContext at the SDK seam, real state machine) · **Accept:** `microsoft adapter:
  StoreContext flow, backend validation, sync-once into RC, enum amendment recorded`.

## Phase W3 — Screens from Stitch

- [ ] **W3-S2 Stitch v2 export** · §18.1, D19/D20, TC5  **Spec:** Generate `LIBS/UI/STITCH-v2/` (additive; STITCH v1 demoted to wiring
  reference, never overwritten). Method: frozen Figma PNGs
  (`LIBS/UI/FIGMA/screens/*`) as visual references + prompts carrying **CHECKLIST entity
  names verbatim** — U.1 primitives (Button, Chip, TopBar, Composer, PlateCard, TurnHer,
  TurnYou, shell, stage, wheel) + U.2–U.9 screen vocabulary + the 36-var token names
  (`--color-midnight` etc.), never Stitch's M3 vocabulary. Every session design law held:
  porthole, sprites-slot, speaker icons, hover callouts, torus, typewriter, no AI
  character art. Pro-tier model (surface before generating if unreachable). Iterate per
  screen until visually equal-or-better than the frozen renders; MCP-pull `code.html` for
  every screen.
  **Owns:** `LIBS/UI/STITCH-v2/**`.
  **Verify:** entity-name audit (every CHECKLIST vocabulary name present in the exported
  code.html set) + side-by-side vs frozen renders · **Accept:** `stitch-v2: all screens
  exported with code, entity coverage complete, gallery archived`.

- [ ] **W3-People** · §8.4, J3  **Spec:** People list/edit/remove + export-first nudge (J3), wired from STITCH-v2
  element names. Person removal implements §8.4 exactly: real deletion of the person,
  their `kind=person` lore node + every incident edge, and their cached charts; sessions
  and turns persist as transcript history (never rewritten); standard confirm affordance.
  Export-first nudge offers J8 export before removal. Every date entry is the structured
  auto-expanded date picker (§18.1 input law — free-text dates forbidden).
  **Owns:** `apps/local/src/screens/people/**`.
  **Verify:** `pnpm vitest run apps/local/src/screens` + observed: create → edit → export
  → remove → transcript survives, lore node/edges and cached charts gone.
  **Accept:** `people: full CRUD + export nudge, §8.4 removal semantics observed, date
  picker law held`.

- [ ] **W3-Screens (U.3, U.5–U.8)** · §18.1 wiring law  **Spec:** Wire U.3 (atlas/torus), U.5 (settings), U.6 (paywall/checkout with §21 copy),
  U.7 (about/glossary), U.8 (splash) — each from `LIBS/UI/STITCH-v2/<screen>/code.html`
  element names/labels **verbatim**; this task is the wiring pass over the screens whose
  blocks above define behavior (those blocks' Verify/Accept are the gates; this block
  adds nothing new — it exists so the wiring pass itself is checklist-owned).
  **Owns:** `apps/local/src/screens/**` wiring files for the five screens.
  **Verify:** the five screens' own Verify commands · **Accept:** `screens: U.3, U.5, U.6,
  U.7, U.8 wired from STITCH-v2 element names verbatim, all five Accept lines green`.

## Phase H — Hosted edition (D22/D23)

- [ ] **H.1 Hosted scaffold** · §2 layout, D22  **Spec:** `apps/hosted/` consuming the **same** exported UI source (STITCH-v2) behind
  shared service interfaces — identical companion feel, onboarding, components, mascot,
  motion; edition services (inference, STT, TTS, payments) selected behind the shared
  interfaces per D22. Dependency law unchanged: `apps/*` → `packages/*`; platform-agnostic
  packages (`lore`, `billing`) reused unchanged. Lore stays client-side (D12) — only
  retrieval context egresses to the hosted API.
  **Owns:** `apps/hosted/**` (scaffold: build config, router, shell, service-interface
  seams; no inference logic).
  **Verify:** `pnpm --filter hosted build` + served scaffold renders the shell from the
  shared UI source · **Accept:** `hosted: scaffold builds, same UI source renders, service
  seams present and empty`.

- [ ] **H.2 OpenRouter adapter** · §18.3, §9.6  **Spec:** `apps/hosted/src/inference/openrouter.ts`: default **OpenRouter free**
  (`openrouter/free` + config-level fallback list) with rate-limit-aware **dynamic
  backoff**; free access is trial-limited; plain disclosure that free endpoints train on
  prompts; `insufficient-credit` maps to the reserved `billing.consume` seam reason
  (§9.6's frozen union — never a new reason). Backoff policy: exponential with
  rate-limit-header awareness; fallback list traversal is config, not code.
  **Owns:** the adapter + its tests.
  **Verify:** `pnpm vitest run apps/hosted` (rate-limit fixture → backoff observed;
  exhausted fallbacks → `insufficient-credit`) · **Accept:** `openrouter: free default,
  dynamic backoff, training disclosure rendered, insufficient-credit seam exact`.

- [ ] **H.3 Hosted voice/STT interfaces** · D22/D23  **Spec:** Hosted-edition implementations of the shared voice interfaces: server-side
  TTS (stronger voices behind the same §10 Stage/envelope contract — envelope events keep
  the exact three-valued semantics so U.9 is edition-agnostic) and speech recognition
  (STT in scope per D23). `speechSynthesis` ban applies here too.
  **Owns:** `apps/hosted/src/voice/**`, `apps/hosted/src/stt/**`.
  **Verify:** `pnpm vitest run apps/hosted` + observed hosted session: speak a turn →
  audio + envelope → Stage Speaking · **Accept:** `hosted voice/stt: server TTS + STT
  behind shared interfaces, envelope semantics identical, zero speechSynthesis`.

- [ ] **H.4 Hosted billing** · §9.6, §21.4  **Spec:** The hosted `billing.consume` implementation as $ROCHE metering through OR.4's
  quote/reserve/settle machine (reserve before dispatch, settle-once, refund-on-failure)
  — not just x402: the seam maps to ROCHE debits per §21. Depleted balance → the §21.2
  approved micro-copy ("Add $ROCHE to keep chatting."), never a revocation of any owned
  Unlimited entitlement.
  **Owns:** `apps/hosted/src/billing/**`.
  **Verify:** integration test driving consume against OR.4 (trial → exhausted → top-up →
  resume) · **Accept:** `hosted billing: consume = ROCHE reserve/settle via OR.4,
  exhaustion copy exact, entitlement never revoked`.

## Legal documents (§11.1)

- ✅ **LG.1 Privacy policy + terms of use** · §11.1, §12, §21 · [orchestrator semantic
  evaluation 2026-09-17 (observed run quoted): 22/22 privacy contract sets, 22/22 terms
  contract sets, theming law holds — zero raw hex outside the mirrored :root; per-section
  Back-to-Top 7/7 + 11/11; placement contract recorded §11.1 incl. RC paywall URL fields;
  markdown predecessors outboxed per I3. Recipe defect found and fixed in the same pass:
  U.6/U.7 Accept lines now attest the §11.1(a) legal links]
  **Spec:** Write `apps/local/public/legal/privacy.md` and `terms.md` exactly per §11.1's
  closed section sets — the single source the web app (About, first-run, checkout), the
  landing page, the order pages and the website link to (never copy). The privacy policy
  quotes **"birth data is quasi-PII (§12)"** verbatim in the data inventory, enumerates
  every stored record class (Person fields incl. tzid, sessions/turns incl. tool turns,
  ChartFacts, lore nodes/edges/embeddings, readings ledger, consumed codes, wrapped
  license token + deny-list cache), the exact network egress allowlist (public
  unauthenticated Hugging Face model downloads + license bridge + chosen payment
  processor), no telemetry/analytics/crash-reporting/tracking cookies, the J8 export +
  delete-everything + per-person-removal rights, and shared model bytes being
  non-personal. Terms carry the AGPL source offer, trial policy, $ROCHE rules
  (§21 fungibility, reserve/settle, no revocation of Unlimited), single-use codes,
  acceptable use incl. upstream model licenses, no-warranty + liability cap (12-month
  payments).
  **Owns:** `apps/local/public/legal/**`.
  **Verify:** `node -e` presence + citation scan (each §11.1-required phrase present in
  the committed files), output quoted.
  **Accept:** `legal: both token-themed HTML documents with the full §11.1 section sets,
  per-section Back-to-Top, and required citations; placed per the §11.1 placement
  contract — app (About/first-run/checkout links), website + landing page (canonical-URL
  links), RevenueCat paywall Privacy/Terms URL fields set to the canonical pair, order
  pages link beside every purchase action; zero customer-copy conflicts with §21.2`.



- [ ] **W7-1 TEST_RUBRIC gauntlet + TC11 screencast** · `DOCS/TEST_RUBRIC.md`  **Spec:** Run the pre-committed rubric (GR-1 pass; verdicts exactly SHIP-READY or
  DEFECTIVE; every PASS a direct semantic observation) against the built web app with the
  driven session screencast archived git-tracked under
  `dist/rubric-runs/v<VERSION>-<device>-<stamp>/` (TC11 v1.1; native captures spliced).
  A verdict whose evidence file does not exist is not a verdict.
  **Verify:** the rubric run itself · **Accept:** `rubric: verdict SHIP-READY with
  screencast archived at the stamped path`.

- [ ] **W7-2 CC15 Milestone-1 provisional build** · CC15, §22  **Spec:** First end-to-end production-signed build, staged in tracked `dist/` with
  `NOT-A-RELEASE.md`, never published; append-only tweak log under `DOCS/`; single
  `release.lock` stamp across platforms (R.5 gate); success gate = one mp4 screencast of
  the built web app demonstrating every rubrical requirement with a timecode +
  seek-link table.
  **Verify:** artifact set + screencast · **Accept:** `milestone-1: stamped multiplatform
  set in dist/ with NOT-A-RELEASE.md, screencast table complete`.

- [ ] **W7-3 Registry & INC-9 write-backs** · CLAUDE.md registry obligations  **Spec:** Same-session updates: `~/Admin-Manual/PROJECTS/APP_INVENTORY.md` +
  `DOCS/PORTFOLIO.md` (location/remotes/credentials/dependencies changes; rank changes
  proposed, never silently applied); cross-cutting learnings → Admin-Manual with an
  incident (INC-9) — never accreted as project-local memory.
  **Verify:** the updated manual files quoted · **Accept:** `registry: inventory +
  portfolio current, INC-9 write-backs recorded`.

- [ ] **W7-4 On-device verification** · §18.7 item 5  **Spec:** Behavioral verification of the native artifacts: adb install + run on
  Android, Windows-box run (MSI + MSIX per WP.4/WP.5), AppImage run on Linux. Observed:
  startup without dev tools, native chat + audio (V.1), shared-asset reuse where the
  platform adapter exists.
  **Verify:** the device runs themselves, screencast or logged observation quoted ·
  **Accept:** `devices: android + windows + linux runs observed, chat/audio live on each`.

---

## Completion criteria

All `[ ]`/`[X]` resolved to ✅ with cited observed runs; I.4 normalized green; the
release.lock-unified stamped set in `dist/`; TEST_RUBRIC + CC15 screencast archived;
customer language law enforced (OR.2 green); shared-storage cross-app reuse demonstrated
(WP.5 or SS platform observation).


## Operator amendment — typewriter intake, 2026-09-18

- ✅ **U.4-TW — FirstLight typewriter onboarding.** · [orchestrator semantic
  evaluation 2026-09-18: 11/11 focused intake tests passed; local-app typecheck
  passed; desktop, mobile-width, and reduced-motion browser sessions observed the
  prompt gates, focus progression, structured fields, unknown-time path, error
  recovery, and single Begin emission]
  **Authority:** attached Typewriter Onboarding design; ARCHITECTURE §18.6.1.
  **Owns:** apps/local/src/screens/first-light/FirstLight.tsx,
  apps/local/src/screens/first-light/first-light.css,
  apps/local/src/screens/first-light/FirstLight.test.tsx,
  apps/local/public/fonts/playfair-display-latin.woff2,
  apps/local/public/fonts/OFL-PlayfairDisplay.txt,
  apps/local/public/fonts/FONT_PROVENANCE.md.
  **Do:** Preserve IntakeDraft and FirstLightProps. Export QUESTION_SEQUENCE ordered
  name/date/place/time, exact prompts “What may I call you?”, “When were you born?”,
  “Where were you born?”, “What time were you born?”. Use 55ms reveal, hide controls
  until done, focus current field. Keep field IDs first-light-name/date/place/time;
  Next/Back/Begin controls; native structured date/time; gazetteer match required;
  unknown checkbox disables time. Final Begin emits existing draft once. Ignore
  repeated Enter/composition. Mirror text caret follows selection/scroll; native
  picker chrome remains usable. Implement scoped attachment colors/timings, local
  Playfair, dark aura/stars/veins, responsive display sizing, static reduced motion.
  Existing FirstLight.tsx owns flow; new CSS is scoped because global.css owns app
  defaults. No invented rewards. Tests own timing, gated controls, focus, navigation,
  known/unknown drafts, invalid place, IME, repeats, busy/error/retry and cleanup.
  **Verify:** NATALLY_DEV_PORT=43827 VITE_APP_NAME=natally pnpm exec vitest run
  apps/local/src/screens/first-light/FirstLight.test.tsx; pnpm --filter @natally/local
  typecheck; pnpm exec biome check apps/local/src/screens/first-light.
  **Accept:** intake tests pass, typecheck and scoped lint exit zero.
  **Operator verification protocol:** browser at desktop/mobile widths; observe
  timed prompts, focus, long-answer caret, all four steps and reduced motion as a
  convenience UI check; Android build and on-device behavior remain authoritative.
