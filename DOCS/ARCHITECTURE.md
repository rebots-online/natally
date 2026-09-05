# natally — architecture (Gate 2 document 1 of 3)

Normative for the **local-app product** (Linux, Windows, Android, web PWA — all legs
local-inference) and for the monorepo seams the **hosted web-only SaaS** (Alby Market /
Bitcoin LN / x402, pay-per-reading) will occupy later (D10). Written 2026-09-04 against the
amended complement (D10–D14). `CHECKLIST.md` and `DOCS/TEST_RUBRIC.md` (gate-2 siblings)
follow separately; no `src/` is written before all three exist (CLAUDE.md, I2, TC12).

Reading order: `README.md` (what) → `DOCS/DECISIONS.md` (why; D1–D14 cited throughout) →
this file (how) → `LIBS/UI/FIGMA/DESIGN.md` + `TOKENS.md` + `STATE-LEDGER.json` (surfaces).
Everything here is production-complete: interfaces, entities, formats and algorithms are
specified to be implementable without inventing; where a choice is genuinely open it is
listed in §16, not papered over.

## 1. System overview

natally is a person: a warm robotic fortune-teller who reads your sky aloud, in conversation
(D6). The app is her notebook: the transcript is the primary surface, charts arrive as
**plates** laid on the page, and each plate opens into the **Atlas** instrument view. The
product pillars:

1. **Ephemeris truth** — every degree comes from the engine; no fabricated angles (INC-19).
2. **Companion** — an on-device tool-using agent (llama.cpp; atomic chat-turboquant weights +
   KV compression, D13) speaking only from computed facts and remembered lore, gated by a
   three-tier prompt fence (§7). Very approachable voice and animated mascot, ultra
   relatable — the affective surface **is** the USP (D13).
3. **Lore** — a GraphRAG-type local memory recording every turn of every conversation,
   actively engaged by the companion; client-side on local storage in **both** product lines
   (D12).
4. **Voice** — Kokoro on every leg; native Rust synthesis+playback on installed platforms,
   onnxruntime-web in the browser; `speechSynthesis` never called (D7/D7a).
5. **Commerce** — unlicensed trial (operator-configured gate, one designated trial model) →
   paid unlock = unlimited; six processor rails from build config; individually-redeemable
   and hash-based codes (D11).

Two complementary product lines share this repo (D10): the **local app** (this document's
scope) sells an unlimited companion; the **hosted SaaS** (designed later, separate pass)
sells single readings over Bitcoin Lightning and standard web rails. They share the design
system, the ephemeris seam, the lore core, and the companion persona; they differ in
inference lane (local models vs hosted API) and billing model (`billing.consume`, §8.6).

## 2. Monorepo layout

```
apps/local/                 # Tauri 2 application — one codebase, four targets
  src/                      # React 19 frontend (see §3)
  src-tauri/                # Rust core (see §5–§7 host duties)
apps/hosted/                # FUTURE (D10): web-only pay-per-reading SaaS. Empty by design;
                            # nothing in apps/local may import from it or vice versa.
packages/ephemeris/         # EphemerisEngine seam + sweph-wasm backend (§6)
packages/lore/              # Shared GraphRAG lore core, client-side storage (§8)
packages/billing/           # TrialPolicy, usage ledger, PurchaseAdapter, license verify (§9)
packages/design-tokens/     # Generated from LIBS/UI/FIGMA/TOKENS.md + STATE-LEDGER.json
services/license-bridge/    # Operator-hosted Rust service (webhooks, tokens, codes) (§9.4)
scripts/build-*.sh          # Per-target build entrypoints (§14)
dist/                       # Tracked; release binaries via git-LFS on forgejo (CC13)
```

Dependency rule: `apps/*` may import `packages/*`; `packages/*` never import `apps/*`;
`packages/lore` and `packages/billing` are platform-agnostic (browser + Tauri) so the hosted
product reuses them unchanged.

## 3. Normative stack

- **Shell:** Tauri 2 (identity `mba.robin.natally`); targets Linux (AppImage, deb), Windows 11
  (exe + NSIS cross-built on Linux via cargo-xwin; msi + msix on a Windows host — D8),
  Android (apk, aab), and a **web PWA** build of the same frontend (`dist/web` →
  `https://natally.robin.mba`), first-class with its own stamped artifact (R1 lineage).
- **Frontend:** Vite; React 19; TypeScript `strict`; Tailwind 4 with the `@theme` block in
  `src/styles/tokens.css` mirroring `TOKENS.md` **one-to-one** (variable → CSS custom
  property; law: no raw hex outside `tokens.css`); hash router with exactly the routes in
  `DESIGN.md` (`/`, `/atlas/:plate`, `/people`, `/people/:id`, `/settings`, `/paywall`,
  `/checkout`, `/about`); fonts self-hosted woff2 (Fraunces, Nunito Sans, IBM Plex Mono).
- **Native core (src-tauri):** Rust; hosts the ephemeris worker, llama.cpp bindings, Kokoro
  ONNX synthesis + playback, OS keychain access, and the SQLite stores. On the PWA leg every
  capability has a browser counterpart (Web Worker, wllama-style WASM inference,
  onnxruntime-web, WebCrypto + IndexedDB/OPFS) selected by a capability layer — never by
  `if (platform)` scattered through components.
- **No lockfile divergence:** one pnpm workspace root; `pnpm-lock.yaml` committed from day one.

## 4. Process & platform topology

- **Ephemeris** runs off the UI thread: Web Worker (web/PWA) / dedicated tokio task (native).
- **Companion inference** streams tokens through a typed event bus
  (`companion:event → stage(mascot) + transcript + voice`); the Stage's Thinking/Speaking
  states bind to real events on this bus (STATES.md law: no fake states).
- **Voice** pipeline: companion turn → sentence chunks → Kokoro synth (native Rust /
  onnxruntime-web) → playback (Rust audio / Web Audio) → RMS envelope → Stage speaking.
- **Lore writer** consumes the same event bus; reads never block a turn (§8.3).

## 5. Data & entities (INC-19 provenance table)

The mandated entity table. **Provenance** is one of the INC-19 classes: `computed` (engine
fact), `authored` (static education, labelled in UI), `generated` (companion transcript),
`absence` (honest absence state), `system` (never user-visible as content).

| Entity | Key fields | Provenance | Storage | Notes |
|---|---|---|---|---|
| Person | id, name, birth {date, time?, place, timeKnown} | system (input) | SQLite `people` | birth data is quasi-PII (§12) |
| Session | id, personId, startedAt | system | SQLite `sessions` | one conversation thread |
| Turn | id, sessionId, role (you/her/tool), text, ts | generated (her) / system (you) | SQLite `turns` | tool turns record DOM ops (§7.3) |
| Plate | id, sessionId, kind (natal/synastry/today), chartId | computed (rendered from ChartFacts) | derived, cached | in-transcript card |
| ChartFacts | id, personIds[], ut/place inputs, positions[], cusps[], aspects[] | computed | SQLite `charts` (content-addressed by input hash) | immutable; from EphemerisEngine only |
| GlossaryEntry | term, body, glyph | authored | bundled JSON (lib) | "What it is" labels |
| TrialPolicy | mode, params, trialModel | system (build-baked from `.env`) | embedded config | §9.1 |
| Reading | id, ts, personId, chartId | system | SQLite `readings` (append-only) | §9.2 |
| LicenseToken | sub (appUserId), tier, iat, exp?, signature | system | OS keychain (native) / IndexedDB (web) | Ed25519 (§9.3) |
| ConsumedCode | codeHash, redeemedAt | system | SQLite `consumed_codes` | single-use enforcement |
| Offering | id, priceString, tier, durationIso | system (runtime from RevenueCat/bridge) | memory | paywall display only |
| LoreNode | id, kind, summary, embedding, refs[] | generated (derived) | SQLite+vec (§8) | D12 |
| LoreEdge | from, to, rel, weight, sourceTurnId | generated (derived) | SQLite | §8.2 |
| Lore itself (summaries) | — | generated | UI-labelled | never shown as computed fact |

The provenance tag travels with the content into the prompt fence (§7.2) and the renderer
(Plex Mono for `computed`, Fraunces margin for `generated`, labelled sections for
`authored`, distinct absence treatment for `absence`). Export/import (J8) serializes all
user-owned entities (Person, Session, Turn, ChartFacts inputs, LoreNode, LoreEdge,
ConsumedCode) as one JSON document, versioned by `exportVersion`.

## 6. Ephemeris subsystem (D14)

Swiss Ephemeris via `sweph-wasm` is the pinned incumbent; all call sites go through the seam:

```ts
interface EphemerisEngine {
  readonly id: string;                       // 'sweph-wasm'
  init(cfg: EngineConfig): Promise<void>;    // loads ephemeris tables (lazy, §13)
  position(body: Body, ut: JulianDay): { lon: number; lat: number; speed: number };
  cusps(ut: JulianDay, place: GeoPlace, system: HouseSystem): { cusps: number[12]; asc: number; mc: number; armc: number };
  aspects(a: ChartFacts, b: ChartFacts, orbs: OrbTable): Aspect[]; // + applying/separating from speeds
  chiron?(ut: JulianDay): Position;          // backend capability flag
}
```

- Backend package `packages/ephemeris` ships the seam + `sweph-wasm` implementation; a future
  successor (Astrodienst-licensed native build, `astronomy-engine` + in-house house math, or
  the operator's in-house engine) registers behind the same interface with a conformance
  suite (fixed-star and planet positions vs DE431 references at 0.01° tolerance; house cusps
  vs published examples for all 12 systems).
- **Honest absence rules:** birth time unknown ⇒ solar chart (Sun on the 1st-house cusp by
  sign), no Ascendant, no houses anywhere that person appears (J1/J3/J4 branches); backend
  without Chiron ⇒ glyph shows absence, never an estimate.
- **AGPL posture:** while `sweph-wasm` is in the dependency tree the product is
  AGPL-3.0-or-later and source is offered accordingly; the D9 proprietary flip happens only
  when a successor engine lands (license-lint in CI: fail if any `sweph` import exists while
  `package.json.license ≠ AGPL-3.0-or-later`, or vice versa any proprietary claim).

## 7. Companion subsystem (D13)

### 7.1 Inference lane
On-device only for this product: llama.cpp (native) / WASM (PWA), configured for **atomic
chat-turboquant**: quantized weights (Q4_K_M default catalogue tier) **and** KV-cache
compression (q8_0 KV default, q4r8 recursor tier when the device allows), streamed token by
token. Models come from the frozen mirror `RobinsAIWorld/natally-models`
(`manifest.json`, sha256-verified, resumable, §13). The catalogue flags exactly one model
`trialEligible` (D11).

### 7.2 Three-tier prompt fence (normative)
The companion's context is assembled in exactly three tiers, each tagged with provenance:

1. **Tier 1 — computed facts.** Serialized `ChartFacts` for every plate in scope (positions,
   cusps, orbs, applying/separating) plus glossary definitions for terms used. Immutable;
   injected as system context. *Rule: every astrological number she utters must exist here.*
2. **Tier 2 — lore.** Hybrid retrieval over the lore graph (§8.3): vector kNN over LoreNodes
   + 2-hop graph expansion, person-scoped, each fragment carrying `sourceTurnId`. *Rule:
   memory informs continuity, never new astrological claims.*
3. **Tier 3 — the live turn.** The user's utterance and in-flight tool results.

A post-generation **fence checker** validates the output: any degree/orb/date in her reply
is parsed and matched against Tier 1 values (tolerance 0.01°; house/sign names must be
consistent); violations trigger one regeneration with the violation quoted, then honest
absence ("I only say what your chart says"). The persona system prompt fixes her voice:
warm, approachable, ultra-relatable, never clinical (D13).

### 7.3 Tool suite (standard full DOM read/write)
```ts
type CompanionTool =
  | { tool: 'dom.read';   selector: string; depth?: number }          // → masked snapshot
  | { tool: 'dom.write';  ops: DomWriteOp[] }                         // setattr|text|class|focus|scroll
  | { tool: 'chart.open'; plateId: string }
  | { tool: 'chart.compute'; query: ComputeQuery };                   // → EphemerisEngine (Tier 1)
  | { tool: 'lore.recall'; query: string; personId?: string };
```
- `dom.read` returns an accessibility-tree-style snapshot; input values, keychain-backed
  fields and license material are masked at the bridge, never serialized.
- `dom.write` applies to the app's own WebView DOM (native legs) or page DOM (PWA); every
  invocation is recorded as a `Turn(role=tool)` in the transcript and lore — **no hidden
  writes**; writes that mutate user data require the same confirm affordance as UI actions.
- Tools have **no network access**; the only egress from the companion is the inference
  pipeline itself, which is local.

### 7.4 Gating
Companion turns that ground on a plate (readings, §9.2) pass through the trial gate; free
chat that reads no chart is ungated (she remains conversational in trial — the gate is on
readings, not on her existence).

## 8. Lore subsystem (D12, shared by both products)

### 8.1 Storage
Client-side, local-only in both product lines: SQLite everywhere — `rusqlite` behind Tauri
on native, `wa-sqlite` on OPFS in the browser — with the **sqlite-vec** extension for
embeddings (`VITE_LORE_EMBED_DIM`, default 384, from a mirror-hosted embedding model). No
server, ever; in the hosted SaaS the only egress is retrieval context sent to its hosted
inference API (documented in that product's pass).

### 8.2 Graph model
- `LoreNode(id, kind: person|fact|event|thread|place, summary, embedding, refs[])`
- `LoreEdge(from, to, rel: mentions|relates|follows|contradicts, weight, sourceTurnId)`

### 8.3 Pipeline
Every turn (you and her, both roles) is embedded and appended (`write-every-turn`). Node
extraction v1 is deterministic: proper nouns, dates, places, and thread labels recognized by
rule + gazetteer from the glossary; the companion may also emit structured `lore.recall`
hits as extraction hints. Merging: candidate node with cosine similarity ≥ 0.92 to an
existing node of the same kind merges (edges accumulate `weight`). Retrieval (Tier 2) is
hybrid: top-k vector matches (k=8) ∪ 2-hop neighbourhood of matched nodes, budgeted to
1,500 tokens, person-scoped unless the query is explicitly general.

### 8.4 Boundaries
`LoreStore` is an interface (`query`, `upsert`, `export`, `delete`, `stats`) so the later
**pysanky / 6dog** graph-navigation UI reads the same graph without re-architecting. User
controls (Settings › Data): summary line (`[turns · nodes · runtime]`), export with J8,
delete-everything includes lore. Deletion is real deletion (rows + vectors), not soft-hide.

## 9. Licensing & entitlement (D11)

### 9.1 Trial policy
Baked at build from `.env` (§15): `VITE_TRIAL_MODE = count | time | rate` with
`VITE_TRIAL_READINGS` (default 3), `VITE_TRIAL_DAYS`, `VITE_TRIAL_RATE_COOLDOWN_DAYS`
(default 3), and `VITE_TRIAL_MODEL` (exactly one catalogue id). Trial users may download and
run **only** the designated trial model; other catalogue rows render the lock and route to
`/paywall` (J6 amended).

### 9.2 The reading unit & usage ledger
A **reading** is consumed when the companion produces her first Tier-1-grounded turn of a
conversation that references at least one plate. Ledger: SQLite `readings(id, ts, personId,
chartId)` append-only (house never-delete rule; corrections are compensating rows). Gate
check runs pre-inference; outcomes map to the designed states: remaining counter (TrialIdle
chip), exhausted (TrialExhausted composer replacement), rate-limited next-date aside.

### 9.3 License token
Ed25519-signed JSON `{ sub: appUserId, tier: 'unlimited', iat, exp?: null, iss:
'natally-license-bridge', jti }` (COSE/CWT-style compact form). The **public key is baked at
build**; verification is offline; revocation is a bridge-published, signed, dated deny-list
checked when online (never blocks a verified unexpired token offline). Storage: OS keychain
(native) / IndexedDB with WebCrypto-wrapped value (web).

### 9.4 Processor rails & the license bridge
One interface, six adapters, presence driven by `.env` (blank ⇒ rail hidden; the paywall's
"Ways to pay" line is the honest availability readout):

```ts
interface PurchaseAdapter {
  id: 'stripe' | 'revenuecat' | 'polar' | 'lemonsqueezy' | 'paypal' | 'square';
  available(): boolean;
  checkout(offering: Offering): Promise<CheckoutSession>;  // hosted URL | store sheet | RC paywall
  restore(account: AppUserId): Promise<LicenseToken | null>;
}
```

- **Android:** Google Play Billing via RevenueCat (native SDK keys live in the mobile build
  config); paywall = RC offering presentation.
- **Web/PWA:** RevenueCat web SDK (`VITE_REVENUECAT_WEB_SDK_KEY`) or any hosted-checkout
  redirect (Stripe/Polar/LemonSqueezy/PayPal/Square) — the `/checkout` handoff frame.
- **Desktop:** hosted-redirect checkout + QR + manual license-key path
  (`/checkout` `enter-license-key`), key format `NATALLY-XXXX-XXXX-XXXX`.
- The **license bridge** (`services/license-bridge`, operator-hosted Rust/axum, clean-room
  sibling of the Kintsugi pattern) receives processor webhooks (HMAC-verified, idempotent
  SQLite ledger keyed `(processor, invoiceId)`), mints LicenseTokens with
  `LICENSE_ED25519_PRIVATE_KEY`, issues single-use redeem codes (128-bit random, stored
  SHA-256-hashed), publishes the signed deny-list, and exposes `POST /redeem` +
  `POST /verify`. Secrets live in the bridge's `.env` per Admin-Manual convention; **no
  processor secret and no signing key ever ships in a client**.

### 9.5 Codes
- **Individually-redeemable:** bridge-issued, single-use, registry-deduped server-side and
  locally via `consumed_codes`.
- **Hash-based:** offline-verifiable — payload `{tier, exp}` + Ed25519 signature, base32
  encoded in the `NATALLY-…` shape; validity check needs no network; single-use enforced by
  the local consumed-code ledger (re-use shows the code-error variant with the real reason).

### 9.6 `billing.consume` seam (reserved)
```ts
billing.consume(reading: Reading): Promise<{ allowed: boolean; reason?: 'trial-exhausted' | 'rate-limited' | 'unlicensed' | 'insufficient-credit' }>
```
In the local product this consults only the local state (§9.1–§9.3). The hosted product
(D10, R2) implements the same seam as a per-reading debit over Lightning/x402 rails — the
interface is frozen now so that edition never re-architects (R2's clause).

## 10. Voice subsystem (D7/D7a) and the Stage

Kokoro on every leg. Native: ONNX runtime in Rust, synthesis and playback fully native,
voices from the mirror (`manifest.json` shared with the LLM catalogue); Web:
onnxruntime-web (WASM, WebGPU where present) with PCM through Web Audio. `speechSynthesis`
is banned on all legs (CI grep guard). The Stage consumes real events only (STATES.md):
Thinking on first streamed token, Speaking while PCM plays with the RMS envelope driving
orb+mouth, Delighted on chart computed / unlock success, Error on engine failure.

## 11. Privacy & security posture

- Birth data + lore + turns are **local-only** in this product; no telemetry, no analytics,
  no crash reporter. Network egress is exactly: model-mirror downloads (§13) and the
  license/checkout calls (§9). 
- Network layer: https-only; host allowlist = mirror host + `VITE_LICENSE_BRIDGE_URL` +
  processor checkout hosts; **SSRF guards** (reject loopback/private/reserved hosts on any
  runtime-resolved URL); webhook-style responses verified by signature, never trusted by
  body alone.
- Secrets: `.env` gitignored, fed from `~/Admin-Manual/CREDENTIALS/natally.md`; keychain for
  tokens; CI greps for `hf_`/`sk-`/private-key patterns.
- Exported data (J8) is plaintext JSON by design (user-owned); the UI says so.

## 12. Performance mandates (acceptance criteria)

- Initial JS ≤ 300 KB gz; ephemeris WASM + tables, llama runtime, Kokoro weights: **lazy,
  on-demand, sha256-verified, cached** — none may be in the initial bundle.
- Ephemeris and inference never block the UI thread (§4); first plate ≤ 150 ms after tables
  warm on desktop-class hardware.
- Mascot idle loop plays only while visible; composed states are overlays (STATES.md);
  reduced-motion freezes frame 0 (a11y floor).
- Lore writes are async batched (≤ 1 flush per turn); retrieval budgeted (§8.3).

## 13. Model mirror contract

`VITE_MODEL_MIRROR_BASE` → `RobinsAIWorld/natally-models` (A3). `manifest.json`:
`{ version, assets: [{ id, kind: 'llm'|'embedder'|'voice'|'voices', file, bytes, sha256,
quant, trialEligible? }] }`. Downloads: ranged + resumable, sha256-verified before commit,
stored under the platform cache dir (native) / Cache Storage (web); catalogue rows in
Settings render from this manifest; removal deletes files + manifest rows. HF write token is
an operator precondition (open item §16).

## 14. Build, release, versioning

- `scripts/build-linux.sh` (AppImage, deb) · `build-windows.sh` (exe+NSIS via cargo-xwin on
  Linux; msi+msix when run on Windows — D8) · `build-android.sh` (apk, aab) · `build-web.sh`
  (PWA → `dist/web`) · `build-all.sh` honors `release.lock` (single-flight; post-build bump
  via `update-version.sh --post-build`).
- Artifacts: `mba.robin.natally-v<MAJOR.MINOR.BUILD>-<qualifier>` in tracked `dist/`,
  binaries via git-LFS on forgejo (CC13; GitHub mirror stays code-only until then).
- Commits prefixed `v{VERSION}: `; CI dormant until public release (CLAUDE.md) — when it
  wakes: typecheck, lint, unit + conformance suites, license-lint (§6), the
  `speechSynthesis` grep, and bundle-budget asserts.

## 15. Configuration surface (`.env`, see `.env.example`)

Build-baked client values: mirror base, app URL, trial policy block, six processor values +
bridge URL, RevenueCat offering id, lore flags. Script/server-only: `HF_TOKEN` (local repo)
and the bridge's `LICENSE_ED25519_PRIVATE_KEY`, processor webhook secrets, code registry
(bridge host only, Admin-Manual convention). Nothing in `apps/local` reads a secret at
runtime.

## 16. Open items register

1. Operator re-clearance of the 2026-09-04 complement additions in Figma → re-freeze
   (STATE-LEDGER `pendingFixes`).
2. `CHECKLIST.md` + `DOCS/TEST_RUBRIC.md` (gate-2 siblings; next session).
3. HF write token for the mirror (both PATs 401 on 2026-08-18).
4. forgejo return → push `origin` with LFS; decide the GitHub artifact channel (R1 needs a
   downloadable web build before forgejo returns).
5. Hosted-product design pass (Alby Market/x402 rails, OpenRouter admin-key provisioning
   with `.env` spend ratio, business panel) — separate conversation, seams already frozen
   (§1, §9.6).
6. Embedding model selection for lore (mirror catalogue entry + dimension pin).
7. Ephemeris successor watch (D14 keeps the seam; conformance suite specified §6).

## 17. Traceability appendix

| Section | Decisions | Screens / journeys | Complement artifacts |
|---|---|---|---|
| §1 overview | D4, D5, D6, D10, D13 | all | DESIGN.md |
| §5 entities | INC-19 | all | SCREEN.md ×13 |
| §6 ephemeris | D9, D14 | atlas ×3, plates | DESIGN.md, STATE-LEDGER |
| §7 companion | D13 | conversation ×8 variants | mascot/STATES.md |
| §8 lore | D12 | settings (Data/Lore) | screenshot-license.png |
| §9 licensing | D11, R2 | paywall ×7, checkout ×6, conversation trial ×3 | SCREEN.md (paywall, checkout), J10, J11 |
| §10 voice/stage | D7, D7a | conversation, settings (Voice) | STATES.md |
| §14 build | D8, CC13 | — | scripts/update-version.sh |
