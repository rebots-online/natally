# natally

**natally** (natal-ly) is a natal astrology and synastry companion. natally is a person: the
animated fortune-teller with the crystal ball who reads your sky to you, out loud, in
conversation. Charts are the things she shows you while she talks.

- Identity: `mba.robin.natally` (Tauri identifier, Android applicationId, package name)
- Monorepo, two complementary product lines (D10): the **local app** — Linux (AppImage, deb),
  Windows 11 (exe + NSIS cross-built on Linux; msi + msix on a Windows host), Android (apk,
  aab), and web PWA, all four legs running **local inference** with Kokoro voice on every leg
  (D7a) — plus a future **hosted web-only SaaS** (Alby Market / Bitcoin LN / x402,
  pay-per-reading) whose seams are laid in `DOCS/ARCHITECTURE.md` and whose design is a
  separate later pass.
- License: **AGPL-3.0-or-later for now** (Swiss Ephemeris via `sweph-wasm` is AGPL). Target: proprietary once an in-house ephemeris supersedes Swiss Ephemeris (D9, seam per D14). Public repo either way.
- Origin: `https://forgejo.robin.mba/rcheung/natally.git`, branch `master`

## What ships in v1

| Capability | How |
|---|---|
| Natal chart | Swiss Ephemeris (WASM) in the WebView; real house cusps for 12 house systems; no fabricated angles when birth time is unknown |
| Synastry | Two people; cross-chart aspects with orbs; true house overlays from cusps; no scores, no labels |
| Today | Current sky against a natal chart; hits with orb and applying/separating |
| Companion | On-device language model (native llama.cpp on desktop and Android; WASM on web) speaking only from computed facts; a three-tier prompt fence; honest absence when no model is present. Tool-using agent with standard full DOM read/write; atomic chat-turboquant inference (quantized weights + KV-cache compression). Very approachable voice and animated mascot, ultra relatable (D13) |
| Voice | Kokoro on every leg. Native: synthesised and played in Rust. Web: Kokoro in the browser via onnxruntime-web. The browser's own speech engine is never used (D7, D7a) |
| Mascot | natally, the same character as the Kintsugi oracle, with states driven only by real events |
| Lore | GraphRAG-type lore: every turn recorded to a local knowledge graph + vector store; the companion actively engages with it (D12). Client-side on local storage in both product lines |
| Licensing | Unlicensed trial (operator-configured gate: readings-count / time / rate-limit, one designated trial model) then paid unlimited unlock; Stripe, RevenueCat, Polar.sh, LemonSqueezy, PayPal, Square via `.env`; individually-redeemable and hash-based coupons (D11) |

Out of scope for v1: tarot, journal, composites and progressions, speech input, light mode,
iOS and macOS. (Billing moved into scope by D11.)

## Status

Governance bootstrap. Design complement under `LIBS/UI/FIGMA/` frozen 2026-09-03 and cleared;
2026-09-04 amendments (D10–D14) add the paywall/checkout/coupon/trial/license screens as
specs-first with Figma frames pending backfill and re-clearance. `DOCS/ARCHITECTURE.md`
follows the amended complement; no `src/` is written before it and `CHECKLIST.md` exist
(TC12, I2).

Decisions: `DOCS/DECISIONS.md`. Agent instructions: `CLAUDE.md`.

## Versioning

`v<MAJOR.MINOR.BUILD>` stamped by `scripts/update-version.sh` into `version.txt` and
`version.json`; the app shows the full string bottom-right on every surface and in About.
Commits are prefixed `v{VERSION}: `. Release artifacts live in the tracked `dist/`
(binaries through git-LFS on forgejo.robin.mba), named `mba.robin.natally-v<version>-<qualifier>`.

## Provenance

Kintsugi (`mba.robin.kintsugitarot`) is the only reference project. natally is a clean-room
rewrite: lessons from Kintsugi are recorded as decisions and fixtures; no code is copied.
The mascot artwork is the operator's own and is shared with Kintsugi by design.

Copyright (C) 2026 Robin L. M. Cheung, MBA.
