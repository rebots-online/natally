# natally — test rubric / gauntlet (Gate 2 document 3 of 3)

Pre-committed 2026-09-11 before CODE begins (GR-1, SC4). Task-level Verify lines in
`CHECKLIST.md` are the executable subset of this rubric; this document is the cross-task
acceptance matrix that decides the terminal verdict. Authority: GR-1..GR-7 (manual
`SPEC_CONVENTIONS/final-test-rubric-gauntlet.md`), TC11 (evidence), I-12 (no proxy
attestation).

## Verdict law

- Terminal verdicts are exactly **SHIP-READY** or **DEFECTIVE** — no waiver (GR-3).
- Every PASS is a **direct semantic observation** of the behaviour on the working
  artifact; absence of an error is never a PASS (GR-4, I-12).
- Any single failed or unobserved item ⇒ **DEFECTIVE** until fixed and the **full** rubric
  re-run (partial re-runs never flip a verdict).
- Markers and grep matches attest nothing by themselves; the driven session is the
  evidence.

## Run protocol and evidence (TC11)

- Target: the **built web app** (`dist/web`, CC15 Milestone-1 lineage) driven end-to-end in
  a real browser session; native captures (Linux first, then Android) are spliced in for
  native-only items (V.1, T0.3 host, R.3 install).
- The whole driven session is screencast and archived git-tracked at
  `dist/rubric-runs/v<VERSION>-<device>-<UTC stamp>/` with TC5-style names
  (`NN-<sectionItem>-<desc>.mp4` + per-item stills). The run report cites evidence files by
  name for every verdict. Secret-bearing segments are quarantined to gitignored `.tmp/`,
  referenced by filename + sha256 only (HR-6).
- Environment: fresh app-data; `.env` per `.env.example` with `VITE_TRIAL_MODE=count`,
  `VITE_TRIAL_READINGS=2`, `VITE_TRIAL_MODEL=<trial model>`; bridge + mirror reachable;
  release.lock respected for any build (§14).

## R1 — Ephemeris conformance (§6)

1. 24-fixture invariant suite green on the working artifact (positions in [0,360),
   per-body speed bounds, cusps ascending modulo, `|normalize(mc-asc)| ≤ 180`).
2. When the operator's reference tables are supplied: all 24 cases within 0.01°.
3. House cusps for all 12 pinned systems (§6 set) against published examples.
4. Time-unknown person ⇒ solar chart: no ASC/MC/cusps anywhere that person appears
   (J1/J3/J4 branches); `assertNoHouses` throws.

## R2 — Design-token mirror (§3, TOKENS.md, STATE-LEDGER.json)

1. `tokens.css` mirrors the frozen 36 variables: names equal the `CSS` column, hex equal
   the hex column (T0.4).
2. All 35 glyphs render at 16/20/28 from the vendored SVG set; no unicode stand-ins.
3. Primitives match the Components page 1:1 with STATE-LEDGER ids in doc comments; raw hex
   outside `tokens.css`: zero hits.

## R3 — Journey walks (J1–J11, JOURNEYS.md)

Each journey is driven start→end in the conversation; every step gets a still; every
absence branch is forced and observed:

- J1 first light (unknown-time branch) · J2 plate→Atlas→callout→ask · J3 add person ·
  J4 synastry bi-wheel, one person without time (their overlays absent, other direction
  computed, no score/label) · J5 today · J6 model download (Waking→Idle on real progress;
  lock rows route to `/paywall`) · J7 voice on/off (Speaking follows the real envelope) ·
  J8 export→wipe→import (equivalence + conflict report observed) · J9 back/deep-links ·
  J10 trial→pay→unlock (Delighted once) · J11 redeem (valid + each invalid outcome).

## R4 — Content law (INC-19) and the fence (§7.2)

1. Every user-visible string classifies as computed / authored-labelled / generated /
   honest absence; computed values render in Plex Mono; her turns carry the gilt margin
   glyph; no canned interpretation, no compatibility scores anywhere.
2. **Fence adversarial suite** — per class ≥ 3 samples, all caught by the 0.01° checker
   (violations quoted, one regeneration, then honest absence): (a) fabricated degree;
   (b) plausible-but-absent house; (c) date drift; (d) sign/house-name substitution.
3. Trial-gate worked example: *Given* 0 remaining readings, *When* a plate-grounded
   request arrives, *Then* the composer is replaced pre-inference and no Reading charge
   stands after an ungrounded turn (§9.2 charge/compensate observed in the ledger).

## R5 — Billing, licensing, codes (§9)

1. Gate matrices (count/time/rate/licensed) exact against the designed states (B.1).
2. Charge lifecycle on the ledger: charge row on plate-grounded request; compensating row
   on ungrounded turn; append-only throughout (B.2).
3. Token: RFC 8032 vectors pass; tampered/expired/revoked rejected; deny-list enforced at
   the §9.3 cadence; no-OS-keychain storage path disclosed in About (B.3).
4. Codes: mint→verify→reuse-rejected; 4 outcomes map to the code-error variant with the
   real reason (B.4).
5. Rails honesty: blank-URL rails hidden from "Ways to pay" (B.5c); RC path
   paywall→entitlement→mint→token (B.5b).
6. Bridge: 6 webhook fixtures idempotent; refund/chargeback revokes the jti onto the
   signed deny-list (B.6).

## R6 — Voice and the Stage (§10, D7/D7a)

1. Kokoro synthesis + playback native (V.1) and in-browser via onnxruntime-web (V.2);
   `speechSynthesis` grep: 0 hits on all legs.
2. Stage: 8 states driven only by `StageSignal` (STATES.md real-vs-composed table);
   `Speaking` spans `envelope-start`→`envelope-end`; orb/mouth follow the RMS envelope;
   reduced-motion freezes frame 0 and disables the plate slide.
3. Asleep ⇒ no model loaded; Waking tracks real engine/model progress only (no fabricated
   progress anywhere — splash included).

## R7 — Privacy, data, local-only (§11, §8.4)

1. Network egress observed == allowlist only (mirror + bridge + configured checkout hosts);
   no telemetry/analytics/crash reporter beacons.
2. Companion tools: `dom.read` masks secrets; `dom.write` records `Turn(role=tool)` and
   confirms destructive ops; tools import no network surface.
3. Export→wipe→import restores equivalently; divergence conflicts reported, existing wins
   (X.1); `removePerson` cascades lore node + incident edges + cached charts and keeps the
   transcript (X.1, U.4); delete-everything leaves 0 rows across all tables (X.2).

## R8 — Performance and accessibility budgets (§12, DESIGN a11y floor)

1. Built web initial JS ≤ 300 KB gz (assert script).
2. Ephemeris/inference never block the UI thread; first plate ≤ 150 ms after tables warm
   (desktop-class).
3. Controls ≥ 44 px; visible orbglow focus ring; measured contrast on `midnight` meets
   DESIGN.md's stated ratios (vellum 14:1, gilt 8.5:1, orbglow 9:1, moonlight 9:1,
   ember 5.5:1, muted 6.5:1); version stamp selectable; body floor 12 px (11 px
   `data/micro` stamp exempt).

## R9 — Build, release, license posture (§14, §6, CC12–CC15)

1. CC15 Milestone-1: manual production-signed build of the **web** app staged in tracked
   `dist/` with `NOT-A-RELEASE.md` and the append-only tweak log; **single success gate:
   the mp4 rubric screencast with timecode + seek-link table**.
2. Artifacts slug-first `mba.robin.natally-v<VERSION>-<qualifier>` in tracked `dist/`
   (LFS on forgejo); stamped by `scripts/update-version.sh` only.
3. `license-lint`: AGPL + sweph consistency state OK; dormant CI uninvoked (TC14).
4. Version surfaces agree (`--check`): version.txt = version.json = package.json =
   tauri.conf.json = Cargo.toml.

## Rubric maintenance

Any amendment to this rubric after CODE begins is a decision-entry event (SC1): it is
recorded in `DOCS/DECISIONS.md` with the operator's date, and the affected checklist
Accepts are reconciled in the same session (D18 lineage).
