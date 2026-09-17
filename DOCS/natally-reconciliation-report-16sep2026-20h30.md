# natally — two-checkout reconciliation report

**Produced:** 2026-09-16 20h30 EDT · **Author:** Claude (asrock session) · **Scope:** rule
which of the two natally checkouts on this machine to retain and continue, catalog what
the other still holds of value, and plan the reconciliation to exactly one.
**Method:** read-only survey of both trees + registries (two parallel survey agents, then
direct verification of every load-bearing claim); live gate re-run where safe. Evidence
law: every claim below traces to an observed command output from this session or to the
09-13 audit's `[observed]` entries (so labeled); nothing is asserted from memory.

**Surveyed paths (this machine = asrock, 192.168.0.57 — `hostname`, `ip -4 -brief addr`):**

- **A** = `/home/robin/CascadeProjects/natally` — asrock's registered live checkout
  (APP_INVENTORY:193, hostname-verified 2026-09-14).
- **B** = `/home/robin/Desktop/devProjects/natally` — a clone whose registered owner is
  **msi4090** (192.168.0.173) per the same registry line; its presence on asrock is the
  **operator's express creation** (operator 2026-09-16; see §4).

---

## 1. Executive ruling

**Retain A. Retire B from asrock (additively — never delete). B contributes exactly one
thing: its ~9 MB uncommitted working layer, preserved as a branch and ported
task-by-task under CHECKLIST discipline.**

Three facts make this airtight:

1. **Zero commit-level divergence.** B's entire history (24 commits) is contained in A,
   verified hash-by-hash. B has no unique commits; the fork point is B's own HEAD
   `ffaeb0e`. A is strictly ahead by 7 commits (`6931b1d`, `568b7e8`, `ef92499`,
   `dc334d3`, `6f261b4`, `9aba56e`, `00d58de`).
2. **A alone carries the current sources of truth**: the D20 STITCH structured UI export
   (`LIBS/UI/STITCH/`, 25 screens — absent from B entirely), the post-09-13
   CLAUDE.md/README/DECISIONS state (through D23), and the HF-token milestone.
3. **Registry fit.** The hostname-verified APP_INVENTORY assigns CascadeProjects to this
   machine. B's path belongs to msi4090; its asrock copy was the operator's express
   creation (one-disk consolidation) and now needs a durable, registered disposition
   (§8) rather than remaining an off-registry duplicate.

B's value is real but entirely unpushed: a 3-day-old dirty working tree (22 modified +
55 untracked paths ≈ 9 MB) that contains the only semantic audit of the codebase ever
run, plus a D20-era design-led implementation layer — currently one mishap away from
oblivion. That layer is the merge-in.

## 2. Inventory

| | **A** `~/CascadeProjects/natally` | **B** `~/Desktop/devProjects/natally` |
|---|---|---|
| Repo type | standalone clone (GitHub, 2026-09-03 20:11 — reflog) | standalone clone (GitHub, 2026-09-08 22:22 — reflog) |
| HEAD | `00d58de` · 2026-09-15 22:07:44 EDT | `ffaeb0e` · 2026-09-13 01:36:25 EDT |
| Version | v1.13.21288 (4 surfaces agree) | v1.13.21288 (same) |
| Commits | 31 (contains all of B) | 24 (all contained in A) |
| Local branches | `master` only | `master` only |
| Remotes | origin=forgejo, github=mirror | origin=forgejo **(token embedded in URL)**, github=mirror |
| Remote sync | github current; **origin behind 2** (`9aba56e`, `00d58de`) | in sync with both at `ffaeb0e` |
| Working tree | clean tracked; 3 untracked ZCode tool dirs (~4 KB) | **dirty: 22 M (+294/−30) + 55 ?? ≈ 9 MB** |
| Stash / tags | 0 / 0 | 0 / 0 |
| LFS | 397 (`seas_*.se1`) | 397 (same) |
| CHECKLIST | 27 ✅ · 5 [X] · 1 [/] · 32 [ ] | 27 ✅ · 5 [X] · 2 [/] · 32 [ ] (working-tree edits) |
| Gate-2 docs | present (ARCHITECTURE, TEST_RUBRIC, DECISIONS→D23, sdk/) | present (same, one commit behind in content) |
| STITCH export | **present** (25 screen folders, 51 files) | **absent** |
| dist/ · CI | none yet (gitignore prepared; CC3 task open) | none |
| apps/hosted | absent (D22/D23 pending) | absent |

## 3. Divergence analysis

**Committed history:** fork point = `ffaeb0e` (= B's HEAD, 2026-09-13 01:36). A's 7
ahead commits are: the claudedocs operator addendum (`6931b1d`), the merge that absorbed
msi4090's v1.4–v1.13 arc via origin (`568b7e8`, 2026-09-14), README/D22-D23 matrices
(`ef92499`), CLAUDE.md currency (`dc334d3`, `6f261b4`), the D20 STITCH export
(`9aba56e`), and the HF-token state note (`00d58de`). B contributes zero commits.

**B's reflog is the missing history link:** it contains the entire 2026-09-09→13
implementation arc (v1.4 → v1.13) made inside that clone — the arc APP_INVENTORY
attributes to msi4090. msi4090 pushed it to forgejo; asrock absorbed it via the
2026-09-14 merge. The clone itself (reflog intact) later appeared on asrock.

**Working-tree divergence (the merge-in surface):** B's 77-path uncommitted layer =
the D20-era design-led pass: `src/screens/`, `src/voice/`, `src/data/`,
`stage.tsx`/`stage.test.tsx`, `ui/mascot.tsx`, `companion/inference-web.ts` + `lane.ts`,
src-tauri `inference/ plugins/ permissions/ registry_generated.rs capabilities/`,
ephemeris native engine (`Cargo.toml build.rs engine.rs host/native.ts`), lore embed +
sqlite-vec + tests, billing token + tests, full icon sets (android/ios/icns — mascot
branding per D21), `DOCS/sdk/sqlite-vec/`, `AGENTS.md`, `scripts/generate-design-gallery.py`,
`scripts/grep-no-speechsynthesis.sh`, and the two documents of record:

- **`DOCS/ANALYSIS-REPORT-2026-09-13-v1.13.21288.md`** — the only semantic audit ever
  run against this codebase (`/sc:analyze`, 4 full-read agents + gate executions +
  per-task Verify re-runs; claims labeled `[observed]`/`[agent-verified]`/
  `[unverified]`).
- **`DOCS/DESIGN-INDEX.md` + `DESIGN-GALLERY.html`** — generated provenance index of
  the frozen Figma complement (also records the 09-13 Figma-connector degradation:
  "empty Cover page").

**Transplant cleanliness (verified):** `git -C A diff --name-only ffaeb0e 00d58de` = 54
files; intersection with B's 22 modified files = **∅**. The layer applies onto A's
master with zero file-level conflicts.

### 3.1 Is B buildable / mergeable to its master?

- **Buildable: NO — gate-red, re-observed live 2026-09-16.** B's root typecheck
  (`tsc --noEmit -p tsconfig.base.json`) exits 2 with 10 errors: 9× TS5097
  (`allowImportingTsExtensions` missing in **committed** `tsconfig.base.json`) + 1×
  TS2307 (`app.tsx:5` `@natally/local-shell` unmapped in the root sweep; `app.tsx` is
  one of the 22 modified). `scripts/check.sh` therefore dies at step 1. Audit-observed
  09-13 (tree unchanged since — census and reflog confirm): Biome 33E/56W; L.1 Verify
  fails 3/16 (`_migrations` expectation vs migration 3 — F-12); U.2 fails 1/22
  (`ERR_INVALID_URL_SCHEME` reading the frozen Figma ledger — F-13). The redness is
  narrow — the audit's verdict: *"deficits are ledger- and gate-shaped, not
  code-shaped"* (2 config defects + 2 test defects on exceptionally clean code).
- **Mergeable: mechanically YES; as a passing state NO.** The 77 changes sit atop B's
  own HEAD (no conflicts possible) and apply cleanly onto A's master (∅ overlap). But
  SC2/TC10 forbid a red-gate tree on master — and part of the redness lives in
  committed files. Treatment: **commit to a preservation branch** (durability), fix
  F-1/F-12/F-13 (two-line tsconfig fix + path mapping; one test expectation; one URL
  import), then port. ✅ only ever from observed runs.

### 3.2 Attestation provenance (operator question: grep or semantic/CodeGraph?)

**Neither, mostly.** Per the 09-13 audit (§3.2, F-11/F-12): of 25 ✅ blocks, **only 2
record Observed output** (T0.1, T0.V) — and T0.V is itself a **BREACH** (no Verify or
Accept lines exist at all). Others were signed off with no recorded run evidence;
several explicitly at "proxy tier" (T0.2 typecheck-only, T0.3 indirect, S.1's Verify is
an `ls | wc -l`). The sole semantic evaluation of the codebase is the audit itself
(full-read agents + gate/test executions — **not CodeGraph**; `.codegraph/` exists in
both checkouts but was never the method of record). The ledger diverged from disk in
both directions: L.1 `[X]` fails on re-run (F-12) while ≥8 blocks sit `[ ]` despite
implemented-and-passing artifacts (L.2, B.3, V.2, U.9, X.1, I.2, C.1). True census: 60
blocks (CLAUDE.md's "58" predates T0.V + U.10 — F-26).

**Consequence:** neither checkout's CHECKLIST is trustworthy as-is. The audit is the
only attestation baseline — it is currently trapped in B's uncommitted layer and rides
into A as part of the merge-in; markers are then re-derived from its §3.2 verdict table.

## 4. Provenance & registry analysis (single source of truth)

- **APP_INVENTORY.md:193** (2026-09-14 correction, hostname-verified): checkout
  attributions were once swapped; correct state: asrock=CascadeProjects (live),
  msi4090=Desktop/devProjects (live). This session confirms the asrock half by
  hostname+IP.
- **PORTFOLIO.md:71 still carries the pre-correction swapped attribution** ("Desktop
  (this host) · CascadeProjects (msi4090)") and a stale status row (v1.12.21175 /
  `898e0a5`). Registry drift — correction proposed in §8, not silently applied (INC-17).
- **CREDENTIALS/natally.md** exists (touched 2026-09-15 22:06, immediately before A's
  HEAD commit about it).
- **No `PROJECTS/natally/` folder existed** — the operator's callout this session.
  natally's record was scattered (inventory section + portfolio row + credential file)
  while its session reports accreted in-repo; nothing ever tried to land in a project
  folder, so the gap was invisible. **This report bootstraps the folder** (its Admin-Manual
  placement below is the first artifact in it), and §8 proposes the global rule.
- **B's presence on asrock is the operator's express creation** (operator 2026-09-16:
  deliberate, part of the same effort to constrain development to one disk even when
  working from another machine). B is msi4090's **ZCode-IDE checkout** — the
  `.zcode/`/`.v2c/`/`.video_agent/` droppings are ZCode artifacts from those sessions —
  copied to asrock after 09-13 with `.git`/reflog intact. The registry gap is that
  APP_INVENTORY records no trace of this deliberate copy. Caution that stands:
  **verify with msi4090 before any deletion-class action** — the original may still
  live there, possibly with later state.

## 5. Retention rationale

| Criterion | A | B |
|---|---|---|
| Committed history | superset (31 ⊇ 24) | subset |
| Unique commits | 7 | **0** |
| D20 STITCH structured UI source | ✅ | ❌ (with Figma expired, A is the **only** holder) |
| Docs currency (CLAUDE.md, DECISIONS, README) | current (D23, HF token) | one epoch stale |
| Registered for this machine | ✅ (hostname-verified) | ❌ (msi4090's path) |
| Auditability | clean tree | 9 MB dirty + token in remote URL |
| Buildable | n/a (its tree ≈ B's clean base + docs/STITCH commits) | gate-red (§3.1) |

## 6. Merge-in list (everything B holds that A lacks)

**Take as-is (docs/tools/snapshots — no conflicts possible):**
1. `DOCS/ANALYSIS-REPORT-2026-09-13-v1.13.21288.md` — the attestation baseline (§3.2);
   its F-1/F-2/F-12/F-13 findings drive the gate fixes.
2. `DOCS/DESIGN-INDEX.md`, `DOCS/DESIGN-GALLERY.html`, `scripts/generate-design-gallery.py`
   — generated provenance index over the frozen complement.
3. `scripts/grep-no-speechsynthesis.sh` — the D7a ban-enforcement grep (V.2 owns it).
4. `DOCS/sdk/sqlite-vec/` — local SDK snapshot per TC7.
5. `AGENTS.md` — agent-runtime parity doc (review, then adopt or adapt).

**Take after review (implementation layer — port under CHECKLIST/D20 discipline):**
6. Screens/UI: `src/screens/**`, `stage.tsx`+test, `ui/mascot.tsx` — review against the
   D20 STITCH-first pipeline; UI source of record moves to the Stitch v2 export (§10),
   these become wiring references, not the design source.
7. Voice: `src/voice/**` (V.2's Kokoro-web work).
8. Data/lore/billing/ephemeris: `src/data/**` (X.1 — audit: 20/20 pass), lore embed +
   sqlite-vec + tests (L.2), billing token + tests (B.3), ephemeris native engine
   (`packages/ephemeris/native/**`, `host/native.ts`).
9. src-tauri: `inference/**` (C.1), `plugins/**`, `permissions/**`,
   `registry_generated.rs` (I.2), `capabilities/{ephemeris,lore}.json`.
10. Companion: `inference-web.ts`, `lane.ts` (C.1 web lane).
11. Icons: full android/ios/icns mascot-branded sets (D21) — regular blobs, matching the
    mascot-out-of-LFS precedent (`a75b599`); ~5 MB, within github capacity.
12. `CHECKLIST.md` working-tree edits (2 `[/]`) + the 22 modified tracked files'
    diffs (+294/−30) — apply with the layer.

**Preserve as provenance regardless:** the entire layer branches into A as
`msi4090-uncommitted-2026-09-13` (§8 step 3) — durable, diffable, never lost.

## 7. Security note

B's `origin` URL embeds a plaintext forgejo access token
(`https://rcheung:<redacted-40-hex>@forgejo.robin.mba/...` in `.git/config`). Not a
repo leak, but a hygiene exposure (`git remote -v` echoes it into any transcript).
Fix in §8 step 2. A's remotes are clean (no embedded credentials).

## 8. Reconciliation plan (for a separately-approved execution session)

1. **Snapshot first (I3/CC12/INC-13 — copy, never move):**
   `cp -a /home/robin/Desktop/devProjects/natally ~/outbox/natally/msi4090-desktop-checkout-2026-09-16-snapshot/`
   (`.git` included — preserves B's unique reflog, the only copy of the 09-09→13 arc's
   local history).
2. **Strip the embedded token** in B and the snapshot: `git remote set-url origin
   https://forgejo.robin.mba/rcheung/natally.git`.
3. **Make the layer durable as a branch:** in B, commit all 77 paths to a local branch
   `msi4090-uncommitted-2026-09-13` (message: `v1.13.21288: preservation commit —
   msi4090's uncommitted 2026-09-13 layer (22 M + 55 untracked), committed for
   durability before port; gate-red per ANALYSIS-REPORT F-1/F-2/F-12/F-13`), then
   `git -C A fetch <B-path> msi4090-uncommitted-2026-09-13:msi4090-uncommitted-2026-09-13`.
   LFS note: the layer's icons are regular blobs (§6.11) — no new LFS objects.
4. **Fix the narrow redness on the branch:** F-1 (`allowImportingTsExtensions` in
   `tsconfig.base.json` + `@natally/local-shell` path mapping), F-12 (L.1 `_migrations`
   expectation — fix the test, not migration 3), F-13 (U.2 ledger URL import). Re-run
   the gates; quote outputs.
5. **Port task-by-task onto A's master** per CHECKLIST ownership; re-derive markers from
   the audit's §3.2 verdict table (LAG blocks → verify → flip; T0.V gets real
   Verify/Accept lines or loses ✅). ✅ only from observed runs (SC2/GR-4).
6. **Quarantine B on asrock, additively:** leave in place; drop a `RELOCATED.md` marker
   ("superseded by ~/CascadeProjects/natally; preservation branch + outbox snapshot
   exist; do not work here"). **Deletion only by operator decision, only after msi4090
   is verified** (§4). Never delete the outbox snapshot (I3).
7. **Registry same-session updates (INC-17):** APP_INVENTORY — record the disposition
   of the operator's express asrock copy (archived per §8.1/§8.6; msi4090 retains its
   registered path); PORTFOLIO:71 — fix the swapped attribution + refresh the status
   row to current HEAD.
8. **Incident write-backs (INC-9 — proposed, not silently applied):**
   a. *Project-folder-at-registration:* every APP_INVENTORY project gets
      `~/Admin-Manual/PROJECTS/<slug>/` at first registration; cross-cutting reports
      land dual-homed (in-repo `DOCS/` + the project folder). (Operator 2026-09-16:
      "the ONLY acceptable placing … intuitively obvious in global rules.")
   b. *Register cross-machine copies:* the operator's deliberate asrock copy of
      msi4090's checkout was sound in intent (one-disk consolidation) but carried 9 MB
      of sole-copy uncommitted work with no registry trace — deliberate copies get an
      APP_INVENTORY note at creation time so their disposition is always known.
   c. *Uncommitted-work durability breach:* the 09-13 session ended with 76 files of
      completed work uncommitted (TC10's own audit point 4) — three days one `rm` away
      from oblivion.
9. **Rollback recipe:** every step is additive (snapshot, branch, marker). Rollback =
   delete nothing: stop porting; A's master untouched until step 5's scoped commits;
   `git -C A branch -D msi4090-uncommitted-2026-09-13` only if the operator rules the
   branch itself unwanted (the outbox snapshot remains regardless).
10. **Verification of done:** A shows branch `msi4090-uncommitted-2026-09-13` containing
    all 77 paths; `git -C A diff master msi4090-uncommitted-2026-09-13 --stat` ≈ B's
    +294/−30 + untracked; B carries `RELOCATED.md`; outbox snapshot exists; registry
    rows updated; gates green on the branch.

## 9. State notes (A, as of 2026-09-16)

- **Forgejo DOWN** (operator: IBM M3 running all Proxmox servers is down, forgejo
  included). github mirror carries meanwhile; **no GitHub LFS stands**; within-capacity
  content rides as regular blobs (operator directive). Queued for forgejo's return:
  `9aba56e`, `00d58de`, + this report's commit.
- Figma paid account **expired** — see §10; contents fully local; the "opportunistic
  re-freeze / Stage node-id verification in Figma" open item is now impossible in Figma
  and is re-pointed at the frozen local complement + STITCH export.
- A's untracked `.v2c/ .video_agent/ .zcode/` are ZCode tool droppings (plugin markers
  + one session-plan file, ~4 KB) — leave untracked; candidate `.gitignore` additions.
- Still open in A: CC3 dormant CI siblings (`.github`+`.forgejo` workflows), tracked
  `dist/` (gitignore prepared, nothing staged), `apps/hosted` (D22/D23).

## 10. UI-source ruling (operator directive 2026-09-16): Stitch v2 pass

**Do the frozen Figma artifacts have elements or only screenshots?** Screenshots, for
visuals: 41 flattened PNGs (+2 SVG, 1 WEBP, 1 MP4). The element-level content in
`FIGMA/` is non-visual structure only (TOKENS.md 36-var table, STATE-LEDGER.json,
`natally-glyphs.svg`, 13 SCREEN.md specs, STATES.md, mascot footage). No component tree
ever left Figma — Figma Make never ran, the connector was already degraded 09-13, and
the paid expiry closes that door permanently. **A's `LIBS/UI/STITCH` export is
elements-class** (real DOM: conversation sample = 46 divs, header/main/nav, 6 buttons,
3 imgs; frozen type ramp Fraunces/Nunito/Plex carried).

**The proposed Stitch regeneration pass IS necessary** — the existing export fails both
operator conditions (verified across all 25 `code.html`): (1) **verbatim checklist
entities: 0/25** carry TopBar/PlateCard/TurnHer/TurnYou/shell (DOM speaks Stitch's own
vocabulary); (2) **aesthetic parity: never gated**, and structurally 25/25 screens are
Material-3 tokenized with **0** `--color-*` @theme vars — disconnected from the frozen
36-var token system.

**Stitch v2 contract (post-report follow-up #1):** frozen PNGs uploaded as visual
references; generation prompts carry the CHECKLIST entity names verbatim (U.1
primitives Button/Chip/TopBar/Composer/PlateCard/TurnHer/TurnYou, shell, stage, wheel;
U.2–U.8 screen vocabulary); strongest model per operator ("nano banana + most
up-to-date Pro Gemini, not Flash"); acceptance gate: visually equal-or-better than the
frozen renders, else iterate (`generate_variants`/`edit_screens`). Kickoff caveats to
resolve: the Stitch MCP surface here exposes only Flash-tier `modelId`s — verify Pro
reachability (omit modelId for default, or drive the Stitch web UI where model choice
is exposed); no image-upload tool on the MCP — hybrid web-side upload + MCP generation/
pull (as the original 09-14 export was). Output lands **additively as a
semantic-suffixed successor** (TC5) — the existing export is never overwritten.

## 11. Distribution

This report is dual-homed per the operator's 2026-09-16 placement ruling:

1. In-repo: `DOCS/natally-reconciliation-report-16sep2026-20h30.md` (retained checkout,
   committed, pushed to the github mirror — forgejo queued per §9).
2. Single source of truth: `~/Admin-Manual/PROJECTS/natally/natally-reconciliation-report-16sep2026-20h30.md`
   (first artifact in the bootstrapped project folder; byte-identical copy).

Post-report follow-up queue: **#1** Stitch v2 pass (§10) · **#2** reconciliation
execution (§8) · **#3** registry write-backs (§8.7–8.8).
