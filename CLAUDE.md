# natally — agent instructions

Authority order: `~/Admin-Manual/` is the organization-wide single source of truth (its index
is `MANUAL.md`); this file is the project layer — where it is silent, the manual governs.
Rules are cited by code with their operative clause inlined; full text lives in the manual:
`DOCS/CICD_CONVENTIONS.md` (CC-n), `DOCS/TOOLING_CONVENTIONS.md` (TC-n),
`DOCS/SPEC_CONVENTIONS.md` (SC-n), `DOCS/INCIDENTS.md` (INC-n), `DOCS/IDEOLOGIES.md` (I0–I3,
plus the unnumbered anti-fragility and purposive-reading ideologies); I-1…I-19 are global
workflow invariants. Project-local doctrines are marked **project-local** and never wear an
unmarked manual code.

Citation corrections and additions (2026-09-03): **I-0** is not a manual code — the
never-delete/outbox substance is ideology I3 + global priority rule 7 + CC12's outbox + INC-13,
now cited directly. **TC12 §9/§11** are not manual sections — the carve-out is TC12 item 6 and
the operator clearance gate is natally's own D3. **INC-19** is not yet minted in the manual
(it stops at INC-18) — the content law below is project-local, number reserved pending
write-back per INC-9. **CC15 does exist** ("Initial provisional production build (Milestone
1)", operator-directed 2026-07-29): the local Admin-Manual checkout was a month stale at
survey time and missed it; after integrating the mirror, CC14 and CC15 are adopted below.

## What this is

natally is a clean-room natal astrology + synastry companion app derived from **Kintsugi and
only Kintsugi** (`~/CascadeProjects/Kintsugi-Unbroken/tauri2/`). Kintsugi is studied for
lessons and anti-patterns; **no code is ported** (D2). No other project is a source or a
reference (D1). The companion (chatbot) and the animated mascot **named natally** are the
core USP (D4, D5, D6). Voice is required, Kokoro, native on all installed platforms, **never
WebView audio** (D7); on the web leg Kokoro runs in-browser via onnxruntime-web and
`speechSynthesis` is never called (D7a). Full decision log: `DOCS/DECISIONS.md`.

## Phase gates (I2, TC12, INC-1)

Architecting and coding are idempotent functions of explicit inputs; the codebase is an
artifact, the spec is the truth (I2). A small ask never bypasses a gate — that growth path is
INC-1.

1. `LIBS/UI/FIGMA/` holds the frozen screen set + `DESIGN.md` + `TOKENS.md` (the TC12 item-6
   operator carve-out: an operator-supplied comparable-tool UI set landing under `LIBS/UI/`
   in the same role). The operator **clears it in Figma** before any architecture work (D3).
   Screens outside the cleared set never appear later without re-approval.
2. `DOCS/ARCHITECTURE.md` (entity table with a content-provenance column) + `CHECKLIST.md`
   + `DOCS/TEST_RUBRIC.md` are written after clearance and before any `src/`. Their shape is
   bound by the Spec-shape section below.
3. Coders execute `CHECKLIST.md` tasks only. Marker ladder (SC2): `[ ]` task → `[/]`
   undertaken → `[X]` completed → `✅` validated. Assignment, execution, and validation are
   separate roles; a coder flips at most to `[X]` (its Verify command ran and its Accept line
   held); **`✅` is flipped only by the orchestrator on semantic validation from an observed
   run.** Markers are not evidence, and neither is a grep match (I-5 verify-by-running, I-12
   no-proxy-attestation, INC-7, SC4/GR-4) — only an observed run proves anything. Each
   coder/subagent receives exactly **one task block** and works only from that block plus
   this repo's docs — reading other task blocks is out of scope (coordination is closed at
   architecting time; Owns sets are pairwise disjoint). A perceived cross-task need is a
   checklist defect to report (`[/] blocked: <reason>`), never an improvisation.

## Always-on floor (global rules — never suspended by project specifics)

- **Verified truth.** State a result only after observing it — run the command, quote what it
  returned; say "unverified", "failed", or "skipped" exactly when it is.
- **Complete work.** No placeholders, no TODO stubs, no mocked returns.
- **Additive stewardship (I3).** Never delete files or artifacts: `cp` to
  `~/outbox/natally/` (CC12's outbox; **copy, never move** — INC-13). Snapshot before any
  destructive step and print the rollback recipe (global priority rule 7).
- **Escalate, never invent (I-4); no self-rescue (I-6).** A gap in spec or artifacts is an
  escalation block and a stop — never a silent invention.
- **Purposive rule reading.** A rule read so literally that it defeats its own goal is being
  misread — but D1–D9 are operator decisions, not rules: on conflict, halt and ask; never
  reinterpret them.
- **No `/tmp` work.** Use project `.tmp/` or the session scratchpad; intermediates are
  `STAGING_`-prefixed; artifacts representing significant compute never rest in `.tmp/`
  (INC-16) — they land in tracked `dist/` immediately.

## House rules that bite here

**Conventions adopted** (each also gets its adoption entry in `DOCS/ARCHITECTURE.md` once that
file exists; until then `DOCS/DECISIONS.md` D-entries are the record): CC2, CC3, CC7, CC9,
CC11, CC12, CC13, CC14, CC15 · TC5, TC7, TC10, TC11, TC12 (item-6 carve-out), TC13, TC14 · SC1–SC4 ·
ideologies I2, I3, anti-unnecessary-fragility, purposive-rule-reading. **Incidents encoded:**
INC-1, INC-7, INC-11, INC-13, INC-16 (both files), INC-17, INC-18 · plus the project-local
content law (INC-19, below).

- **Versioning** (CC2, CC7, CC9; `~/Admin-Manual/versioning/`; `~/.claude/BUILD_CONVENTIONS.md`
  is read first, in-session, before any build or versioning action — INC-18):
  `scripts/update-version.sh` is the vendored canonical stamper — the bump lives inside it;
  MINOR +1 unconditionally, BUILD = epoch-minutes % 100000, MAJOR manual; one stamp per
  handback. The user-facing string is exactly `v<MAJOR.MINOR.BUILD>`; `versionCode` is never
  user-facing. Commits are prefixed `v{MAJOR.MINOR.BUILD}: `. Multi-platform manual builds run
  under `release.lock` so every platform ships the same stamp.
- **Git** (TC10, CC13): commit and push at every task completion and handback; `git add`
  scoped to the task's files, never `-A`; a push failure is reported as a durability gap.
  Branch `master`. Standing state: forgejo.robin.mba is down, so **origin currently points at
  `github.com/rebots-online/natally`** (code-only; `GIT_LFS_SKIP_PUSH=1`, no LFS objects to
  GitHub). When forgejo returns, restore CC13 shape: origin = forgejo (HTTPS, token), GitHub =
  `github` mirror with LFS resolved to forgejo (`.lfsconfig` already in place); re-push LFS.
- **Artifacts** (CC12, CC3, INC-16): `dist/` is **tracked**; binaries go through git-LFS.
  Artifact names are slug-first: `mba.robin.natally-v<version>-<qualifier>`. Unstamped
  artifacts are never left behind; wrongly-stamped ones move to `~/outbox/natally/` on sight —
  never deleted. The Vite config sets `build.emptyOutDir: false` explicitly (INC-16: the
  default wipes output directories; tracked `dist/` doubles the blast radius); no
  `rm -rf dist/`, no destructive clean scripts. Manual builds go through
  `scripts/build-*.sh` only — never an ad-hoc path on a release surface (INC-18). **CC15:**
  natally's first end-to-end, production-signed build is a manual *Milestone-1 provisional
  production build* staged in tracked `dist/` with `NOT-A-RELEASE.md`, never published, an
  append-only tweak log under `DOCS/`, and a single success gate: an mp4 screencast of the
  built web app demonstrating every rubrical requirement with a timecode + seek-link table
  (TC11 v1.1 shape). **CC14:** every release handback carries the complete stamped
  multiplatform set + production redeploy when applicable + the TEST_RUBRIC gauntlet run on
  the working artifacts with TC11 evidence — no smoke-test substitute. CC3: when
  the workspace first builds, author the dormant `.forgejo/workflows/` sibling alongside
  `.github/workflows/`; CI stays uninvoked until a public release (TC14). Regenerated
  artifacts are never overwritten in place — rename both with semantic suffixes (TC5).
- **Fragility ethos** (anti-unnecessary-fragility): any third-party URL eliminable from the
  runtime or install path is eliminated. Fonts self-hosted under `public/fonts/`; no CDN. The
  model mirror `RobinsAIWorld/natally-models` is frozen with `manifest.json` carrying sha256
  per file. No third-party URL in an entity-table `Do` clause — bounce it before dispatching
  to a coder. Dev servers bind high, non-patterned ports (I-16, INC-11: never 3000/5173/8080
  or patterned values).
- **Secrets** (I-15): `.env` (gitignored) is fed from
  `~/Admin-Manual/CREDENTIALS/natally.md` (to be created when the HF write token arrives).
  Cleartext-canonical values live in the manual — never in this repo, never in transcripts.
- **Content law (INC-19 — project-local, number reserved, pending write-back per INC-9):**
  every user-visible string is a computed fact, labelled authored-static education, a
  generated companion transcript, or honest absence. No canned interpretation, no
  compatibility scores.
- Type floor 12 px; one navigation system; one conversation; the Stage's mascot states are
  driven only by real events.

## Spec shape for the Phase-1 documents

- `DOCS/ARCHITECTURE.md`: entity table with a content-provenance column, authored **one
  module at a time** with no placeholders, never whole-cloth by a single agent (TC13). Every
  enumeration is a closed set; adding a variant is a decision-entry event, never a silent
  append (SC1). Every non-source surface names its source file and is mechanically generated
  — single source of truth for `STATE-LEDGER.json`, `TOKENS.md`, version surfaces (SC3).
  `DOCS/sdk/` snapshots are downloaded during architecture so production code comments
  deep-link **local** SDK docs, never rotting web URLs (TC7). The ephemeris fork (D9's open
  consequence: Astrodienst license vs permissive engine vs the operator's in-house
  successor) is resolved before this file is written.
- `CHECKLIST.md`: every task carries a Verify command and an Accept clause that observes a
  committed, durable end-state (SC2 AP-1) — never transient state, never a proxy.
- `DOCS/TEST_RUBRIC.md`: pre-committed before CODE begins (GR-1); run after every task is ✅;
  terminal verdicts are exactly SHIP-READY or DEFECTIVE (GR-3); PASS requires direct semantic
  observation — absence of an error is never a PASS (GR-4); the driven session is screencast
  and archived git-tracked under `dist/rubric-runs/v<VERSION>-<device>-<stamp>/` (TC11 v1.1:
  browser-use driven against the web-app target — a screencast of the web-app version alone is
  an acceptable gate deliverable, native captures spliced in) — a verdict whose evidence file
  does not exist is not a verdict.

## Registry and write-back obligations

- `~/Admin-Manual/PROJECTS/APP_INVENTORY.md` and `~/Admin-Manual/DOCS/PORTFOLIO.md` are
  updated **in the same session** that changes natally's location, remotes, credentials, or
  dependencies (INC-17); PORTFOLIO rank changes are proposed, never silently applied.
- Cross-cutting rule-shaped learnings from this project route to the Admin-Manual with an
  accompanying incident (INC-9) — they never accrete as project-local memory or unmarked
  codes.

## License

AGPL-3.0-or-later for now, proprietary as the target once the in-house ephemeris replaces
Swiss Ephemeris (D9). The incumbent `sweph-wasm` is pinned behind a swappable
`EphemerisEngine` seam (D14); while `sweph-wasm` is in the tree the repo stays AGPL and
public. The successor search is no longer a gate — a successor (Astrodienst-licensed build,
`astronomy-engine` + in-house houses, or the operator's in-house engine) lands behind the
seam without re-architecting.

## Current state

- **2026-09-03 — Phase 0.5 done, frozen.** Figma file `natally v1` (key
  `TmZDFVgkUeeL1VEYWtuaJL`): tokens, type ramp, glyph set, nine components, eleven
  `screen-*` frame sets (+ desktop conversation), Journeys page. Renders, `SCREEN.md`,
  `TOKENS.md`, `STATE-LEDGER.json` under `LIBS/UI/FIGMA/`.
- **2026-09-04 — Amended under TC12 §10 (D10–D14, operator):** monorepo — local app + future
  hosted LN/x402 SaaS whose seams only are laid now (D10); monetization in scope for the
  local app — trial gate → paid unlimited, six processor rails, coupons, RevenueCat paywall
  (D11, supersedes D4's "billing is v2" for this product); shared client-side GraphRAG lore
  (D12); companion as tool-using agent with DOM r/w, atomic chat-turboquant, persona law
  (D13); `sweph-wasm` pinned behind the `EphemerisEngine` seam (D14, resolves D9's open
  consequence). New surfaces (paywall, checkout, coupon, trial states, Settings License +
  Lore) entered **specs-first** with frames already backfilled (`/paywall`, `/checkout`,
  J10/J11, trial + license nodes in `STATE-LEDGER.json`) — **operator re-clearance and
  re-freeze of the amended complement still pending.**
- `DOCS/ARCHITECTURE.md` (2026-09-04) and `CHECKLIST.md` exist; `DOCS/TEST_RUBRIC.md` is the
  remaining gate-2 sibling. Nothing under `src/` before all three exist and the complement is
  re-cleared (I2, TC12, D3).
- Open items: operator re-clearance + re-freeze of the D10–D14 complement; TEST_RUBRIC.md
  authoring; HF write token + `CREDENTIALS/natally.md` creation; forgejo return (restore CC13
  remotes + LFS re-push); hosted-product design pass (Alby Market / x402 — separate
  conversation); unify the two workstations' remote layouts (msi4090: `origin`=forgejo +
  `github` mirror; this host: `origin`=GitHub) when forgejo returns.
