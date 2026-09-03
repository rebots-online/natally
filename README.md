# natally

**natally** (natal-ly) is a natal astrology and synastry companion. natally is a person: the
animated fortune-teller with the crystal ball who reads your sky to you, out loud, in
conversation. Charts are the things she shows you while she talks.

- Identity: `mba.robin.natally` (Tauri identifier, Android applicationId, package name)
- Targets: Linux (AppImage, deb), Windows 11 (exe + NSIS cross-built on Linux; msi + msix on a
  Windows host), Android (apk, aab), web (charts + text companion; voice is native-only)
- License: **AGPL-3.0-or-later** (Swiss Ephemeris via `sweph-wasm` is AGPL; see `LICENSE`)
- Origin: `https://forgejo.robin.mba/rcheung/natally.git`, branch `master`

## What ships in v1

| Capability | How |
|---|---|
| Natal chart | Swiss Ephemeris (WASM) in the WebView; real house cusps for 12 house systems; no fabricated angles when birth time is unknown |
| Synastry | Two people; cross-chart aspects with orbs; true house overlays from cusps; no scores, no labels |
| Today | Current sky against a natal chart; hits with orb and applying/separating |
| Companion | On-device language model (native llama.cpp on desktop and Android; WASM on web) speaking only from computed facts; a three-tier prompt fence; honest absence when no model is present |
| Voice | Kokoro, synthesised and played natively in Rust on every installed platform; never WebView audio |
| Mascot | natally, the same character as the Kintsugi oracle, with states driven only by real events |

Out of scope for v1: tarot, journal, billing, composites and progressions, speech input,
light mode, iOS and macOS.

## Status

Governance bootstrap. Design pass in Figma is in progress under `LIBS/UI/FIGMA/`; the frozen
screen set is cleared by the operator **before** `DOCS/ARCHITECTURE.md` and `CHECKLIST.md`
exist, and no `src/` is written before those exist (TC12, I2).

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
