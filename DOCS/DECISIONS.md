# natally — Decision log (append-only)

Each entry: date, who decided, the decision, and what it rules out. Later entries never
silently override earlier ones; they cite them.

## 2026-09-02 — Operator decisions at project inception (session with Claude Fable 5.1)

| # | Decision | Rules out |
|---|---|---|
| D1 | natally is a clean-room derivation of **Kintsugi and only Kintsugi**. | Any other project as source, reference, or comparison. |
| D2 | **Reference only, rewrite everything.** Kintsugi is studied for lessons and anti-patterns; natally re-implements directly on upstream libraries. Lessons become architecture decisions and test fixtures. | Porting any Kintsugi module, type, or script. |
| D3 | The UI complement is built as a **Figma Design file via MCP** and **cleared by the operator in Figma** before `DOCS/ARCHITECTURE.md` (TC12 §9; Figma carve-out §11). | Architecting before clearance; screens added after clearance without re-approval. |
| D4 | **v1 scope:** natal, synastry, today's transits; on-device chatbot companion; animated mascot; native voice. Tarot, journal, billing are v2 checklists. | Stubs or placeholders for v2 features. |
| D5 | **Mascot:** the same character as the Kintsugi oracle (one companion across the operator's universe), **named natally** in this app. Artwork is operator IP and may be reused. | A second character; a "cadre of fortune-tellers". |
| D6 | **Interaction model:** primarily chatbot delivery of information. Charts are shown inside the conversation and open into an Atlas view. | Tab-per-feature navigation; tables-first screens. |
| D7 | **Voice is part of the character.** Kokoro on all installed platforms, synthesised **and played natively in Rust**. Never WebView audio ("it will ruin the effect"). | WebView `<audio>`/WebAudio on any installed platform; text-only voice fallback on native. |
| D8 | **Windows packaging by build host:** Linux host → `.exe` + NSIS via cargo-xwin; Windows 11 host → `.msi` + Store-compatible `.msix`. The build script detects the host OS. | A single Windows leg that ignores the host. |

### Assumptions recorded at plan approval (2026-09-03), standing unless the operator objects

| # | Assumption |
|---|---|
| A1 | The **web PWA leg has no voice**: browsers can only play through the WebView, which D7 forbids. The web leg ships charts + text companion; the voice control shows honest absence. |
| A2 | Namespace `mba.robin.natally`; origin `https://forgejo.robin.mba/rcheung/natally.git`; branch `master`; license AGPL-3.0-or-later (forced by sweph-wasm). |
| A3 | Frozen model mirror `RobinsAIWorld/natally-models` on Hugging Face (GGUF, Kokoro ONNX, voices, `manifest.json` with sha256). A working HF write token is an operator precondition (both PATs in Admin-Manual returned 401 on 2026-08-18). |
| A4 | Dark only: the character is drawn for night; gold seams need a dark ground. |

### Design tokens fixed at the Figma pass (2026-09-03)

Recorded in `LIBS/UI/FIGMA/DESIGN.md` and `TOKENS.md`; the code `@theme` block mirrors them
one-to-one once `src/` exists.
