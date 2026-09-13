# natally

**natally** (natal-ly) is a natal astrology and synastry companion. natally is a person: the
animated fortune-teller with the crystal ball who reads your sky to you, out loud, in
conversation. Charts are the things she shows you while she talks.

- Identity: `mba.robin.natally` (Tauri identifier, Android applicationId, package name)
- **One monorepo, two editions built in parallel:** `apps/local` (device inference,
  including the local-inference PWA) and `apps/hosted` (web app with hosted inference
  and voice APIs). Both use the **same exported UI source** and companion experience
  (D20–D23). Hosted development runs alongside local development.
- License: **AGPL-3.0-or-later for now** (Swiss Ephemeris via `sweph-wasm` is AGPL). Target: proprietary once an in-house ephemeris supersedes Swiss Ephemeris (D9, seam per D14). Public repo either way.
- Origin: `https://forgejo.robin.mba/rcheung/natally.git`, branch `master`

## Local vs. hosted — at a glance

**Updated 2026-09-13 · Both editions are in scope now.** This tracks intended behavior
and observed implementation separately. **Partial** means components exist but the
complete app flow is unfinished; **required** means directed work remains; **not
selected** means no provider/model is pinned. No row claims a completed release.

### Models and execution

| Capability | Local / device edition | Hosted web / API edition |
|---|---|---|
| **Companion inference** | **Staged candidate:** Qwen3‑0.6B, `qwen3-0.6b-q4_k_m.gguf`. Native llama.cpp; local PWA uses wllama/WASM. **Partial:** model-to-app integration remains. | **Required:** stronger server-side inference behind the same companion interface. **Provider/model not selected**; no hosted adapter implemented. |
| **Speech recognition (STT)** | **Required:** device-local speech input. **Model/runtime not selected; implementation absent.** | **Required:** hosted recognition API. **Provider/model not selected; implementation absent.** |
| **Voice generation (TTS)** | **Staged:** Kokoro‑82M v1, `kokoro-v1-q8.onnx`, voice `af_heart`. Native target: Rust ONNX synthesis/playback; local PWA: ONNX Runtime Web + Web Audio. **Partial:** web component exists; native/app integration remains. | **Required:** higher-quality hosted speech generation using the same speaking/mascot events. **Provider/model/voice not selected; implementation absent.** |
| **Lore embeddings** | **Staged:** `all-minilm-l6-v2-q8_0.gguf`, 384 dimensions. Native llama.cpp; local PWA wllama. **Partial:** embedding components exist; app integration remains. | **Shared client-side lore** (D12): browser-local embeddings and storage, with retrieved context sent to inference. Reuse the MiniLM path; **hosted wiring pending**. |
| **Quantization / capability** | Q4_K_M chat weights + q8_0 K/V cache in the current inference component. The proposed `q4r8` recursor is **unsupported** by the pinned engines. | Server model precision/context depend on the selected provider. **Not selected**; no equivalence claim with the local runtime. |
| **Model delivery** | Manifest IDs, sizes and SHA-256; download/cache/catalogue components exist. The assets above are staged on the development host; **publication and app provisioning remain**. | Hosted chat/STT/TTS weights stay on the server. Browser assets and lore model still need provisioning. **API configuration pending**. |

Model names above identify staged assets, not a deployed default. Selecting another
model must update its identifier, quantization, runtime and status here alongside the
actual manifest/provider configuration. The local PWA runs its models **in the browser**;
it is a different edition from the hosted web app.

### Features and implementation progress

| Feature | Local / device edition | Hosted web / API edition | Progress |
|---|---|---|---|
| **UI source and feel** | Warm, conversational, companion-led interface | Identical screens, components and interactions | **Required:** shared Figma → Make source export; Stitch HTML/CSS/JS fallback. Current shell is not the approved UI. |
| **Onboarding** | Kintsugi sequence; big bold type; typewriter animation | Same sequence and animation | **Required:** preserve behavior in the structured UI export, then wire both editions. |
| **Mascot and background** | Correct natally icon; animated mascot; faint, slowly drifting constellations | Same artwork and motion | **Partial:** mascot assets/Stage component exist; shared integration and Thinking Pysanky background treatment remain. |
| **Charts and visualization** | Natal, synastry and Today; real cusps/aspects; rotating **3D torus** plus legible 2D | Same chart logic and views | **Partial:** calculation components exist. Requested 3D visualization and final UI integration remain. |
| **Ephemeris engine** | Detached Swiss Ephemeris sources under `VENDORED/`, behind `EphemerisEngine` | Reuse the same engine contract and chart facts | **Partial:** web/native implementation work exists; complete edition integration remains. |
| **Conversation and tools** | Computed chart facts, prompt fence, DOM actions recorded in transcript/lore | Same persona, tools and fact boundary; hosted generation | **Partial:** shared contracts/local components exist; full conversation wiring and hosted adapter remain. |
| **Memory / lore / data** | Local knowledge graph + vector store; export/delete controls | Browser-local lore; retrieval context may go to the API | **Partial:** storage/retrieval components exist; complete controls and hosted wiring remain. |
| **Offline behavior** | Target: charts, chat and voice after required assets are installed | Hosted inference, STT and TTS require connectivity | **Required:** demonstrate these behaviors in the integrated editions. |
| **Payment / access** | Configurable trial → paid unlimited; RevenueCat entitlement truth; Stripe, RevenueCat, Polar, LemonSqueezy, PayPal, Square and coupons | Metered pay-per-reading/API access; Lightning / Alby and x402 workstream | **Partial:** local contracts/ledger work exists. Processor integration and hosted payment protocol/settlement remain. |
| **Build / delivery** | Linux, Windows, Android and local-inference web PWA | Hosted web app + API service | **Parallel workstreams required.** Local scaffold/build scripts exist; `apps/hosted` has no tracked implementation yet. Complete artifacts and deployment remain. |

**Current preview:** `apps/local`, with incomplete screen/service wiring. Existing
source components and frozen image references do not establish a finished or approved
screen implementation. Both editions must consume addressable UI source, including
motion/3D code, before that source is wired through architecture and checklist tasks.

The current direction is recorded in [D20–D23](DOCS/DECISIONS.md#2026-09-13--operator-correction-source-artifacts-and-companion-led-design).
D23 supersedes older “hosted later / seams only” scheduling and the speech-input
exclusion; architecture/checklist work must carry both editions forward together.
Update this matrix in the same change that selects a model/provider or changes an
implementation's status. Remaining exclusions: tarot, journal, composites/progressions,
light mode, iOS and macOS.

Contracts: [architecture](DOCS/ARCHITECTURE.md), [checklist](CHECKLIST.md),
[decisions](DOCS/DECISIONS.md). Agent instructions: [CLAUDE.md](CLAUDE.md).

## Versioning

`v<MAJOR.MINOR.BUILD>` stamped by `scripts/update-version.sh` into `version.txt` and
`version.json`; the app shows the full string bottom-right on every surface and in About.
Commits are prefixed `v{VERSION}: `. Release artifacts live in the tracked `dist/`
(binaries through git-LFS on forgejo.robin.mba), named `mba.robin.natally-v<version>-<qualifier>`.

## Provenance

Kintsugi (`mba.robin.kintsugitarot`) supplies the companion/onboarding design reference;
its implementation remains a clean-room rewrite. D21 additionally authorizes Thinking
Pysanky as the reference for the constellation background. The mascot artwork is the
operator's own and is shared with Kintsugi by design.

Copyright (C) 2026 Robin L. M. Cheung, MBA.
