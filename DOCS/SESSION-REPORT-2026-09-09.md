# natally — session report: audit → reconcile → de novo checklist (2026-09-09 → 2026-09-10)

Session record for the operator-directed pass: comprehensive specification audit, ARCHITECTURE
reconciliation, `DOCS/sdk/` vendoring, de novo `CHECKLIST.md` recreation, the Admin-Manual TC2
amendment, and the expert spec-panel review. Written 2026-09-10; all work observed and committed
under stamps `v1.4.16444` (commits `430a345`, `ea6c7b7`, pushed to origin) and this report's own
handback stamp. Operator directives are recorded in §7 pending minting into `DOCS/DECISIONS.md`.

## 1. Summary

- **Audit** (`/sc:analyze`, max depth): the repo's tree honestly matched its declared state
  (no `src/`, 58 tasks untouched, version surfaces agreeing, secrets clean, citations verified
  against the Admin-Manual). Findings: 3 high, 8 medium, 8 low (§2).
- **ARCHITECTURE.md reconciled** to verified current state — 8 surgical edits, all
  documentation-consistency; **no hardening; Tauri 2 four-target build topology untouched** (§3).
- **`DOCS/sdk/sweph-wasm/` vendored** (TC7): README, `index.d.ts`, `LICENSE`, `package.json` of
  `sweph-wasm@2.6.9`, sha256-stamped in `PROVENANCE.md` (§4).
- **`CHECKLIST.md` recreated de novo** from the reconciled ARCHITECTURE.md — 58 tasks, every
  Spec anchored to its `§` source; both predecessor attempts preserved beside it (§5).
- **Admin-Manual amended** (`a64f80c`, pushed): TC2 restored the local Pieces DB read as the
  orchestrator's session-start **first line**, combined with codegraph, before any codebase
  read (§6).
- **Spec-panel review** (`/sc:spec-panel`, 7 experts, critique mode): overall 8.0/10; two HIGH
  requirement gaps identified and staged for disposition (§8 → §7 of the panel output).
- **Known gaps**: Postgres task_ledger host unreachable all session; `DOCS/TEST_RUBRIC.md`
  authoring and operator complement re-clearance remain the open gate-2 items (§9).

## 2. Audit findings (all subsequently dispositioned)

| # | Severity | Finding | Disposition |
|---|---|---|---|
| H1 | High | `DOCS/TEST_RUBRIC.md` absent — gate 2 incomplete (GR-1 pre-commitment before CODE) | **Open** — next gate-2 session |
| H2 | High | 7 task blocks ran Verify commands against unowned test files; I.4 owns-contradiction; ⛓ census mismatch (2 vs 4); T0.2 order-dependence | **Fixed** in the recreation (§5) |
| H3 | High | Frozen-complement contradiction: DESIGN.md Stage row vs STATE-LEDGER.json on node-ids 7:3 / 7:5 / 7:16 (Waking/Error) | **Routed** — §16.1; STATE-LEDGER canonical for code; operator verifies in Figma at re-clearance |
| M1 | Med | Counts wrong both directions: T0.4 "8 colour / 35 vars" (actual 36); "36 glyphs" (actual 35) | **Fixed** (§3, §5) |
| M2 | Med | `update-version.sh` guards point at pre-monorepo `src-tauri/` paths — silently no-op; `--check` absent; running it pre-impl would bump the stamp | **Fixed** via R.6 rewrite (§5) |
| M3 | Med | House-system closed set hedged (`'GO'?`, "Kroonenhouse-generic") | **Fixed** — pinned to the engine's real domain (§3, §4) |
| M4 | Med | `DOCS/sdk/` snapshots absent (TC7) | **Fixed** for sweph-wasm; wider snapshots at owning tasks (§16.8) |
| M5 | Med | Thinking-trigger contradiction (first-token vs request-sent); U.9 overstated "driven only by bus events" | **Fixed** — §10 + `StageSignal` (§3, §5) |
| M6 | Med | Remote-layout drift: README/STATE-LEDGER/DECISIONS describe a `github` remote that doesn't exist on this host | **Open** — doc alignment pass (item 5 of the original roadmap) |
| M7 | Med | `VITE_LICENSE_PUBKEY` had no owner; §15 omitted it | **Fixed** — §15 + T0.10 owns `.env.example` whole; B.3 Reads it |
| M8 | Med | APP_INVENTORY natally entry self-stale ("D9 fork unresolved" vs its own Status citing D14) | **Open** — one-line registry edit |
| L1–L8 | Low | `.env.example` blank trial-model footgun; vec-conditional table counts; lore summary line drift ×3; §17 ×8; C.3 grep brittleness; B.5a/C.1 prose debris; 12 px vs 11 px stamp carve-out; README "in the WebView" wording | **Fixed** in recreation / ARCHITECTURE edits, or noted |

Verified clean: tree = declared state; `1.3.10001` across all version surfaces with
versionCode `100003` = `MAJOR*100000+MINOR`; tracked-`dist/` ignore pair works
(`git check-ignore` exit 1); zero secret-pattern matches; LICENSE = AGPL-3.0 and
`package.json.license` agrees; CLAUDE.md's citation set verified against the manual
(CC14/CC15, SC2/SC4, TC11, INC-1…INC-18 with INC-16 in both files, no INC-19 yet);
INC-17 registries updated in-session; JOURNEYS J1–J11 closed; routes closed set
identical in four places; INC-19 content law threaded end-to-end.

## 3. ARCHITECTURE.md reconciliation (8 edits)

1. Header — reconciliation dated, gate wording now "all three exist **and** the complement is
   re-cleared" (I2/TC12/D3).
2. §6 — **House systems pinned as a closed set of 12**, each 1:1 with a `HouseSystems` code of
   `sweph-wasm@2.6.9`: Placidus `P`, Koch `K`, Porphyry `O`, Regiomontanus `R`, Campanus `C`,
   Equal (Asc) `A`, Vehlow `V`, Whole Sign `W`, Topocentric `T`, Meridian `X`, Alcabitius `B`,
   Krusinski-Pisa-Goelzer `U`. The checklist's phantom "Kroonenhouse-generic" is resolved as
   garbled "Krusinski(-Goelzer)". Engine domain is wider (25 codes); a 13th chip is a
   decision-entry event (SC1).
3. §10 — Thinking = **request-sent, no tokens yet** (frozen STATES.md wording), not
   "first streamed token"; asleep/waking/listening ride **capability signals**; the
   `StageSignal` union (bus events ∪ capability signals) is named, defined by task C.4.
4. §8.4 — Settings lore summary line unified: `[turns · nodes]`, rendered from
   `stats() → {turns, nodes, edges}`.
5. §15 — `VITE_LICENSE_PUBKEY` added to the build-baked config surface.
6. §17 — conversation ×9 variants (incl. Desktop + 3 trial states).
7. §16 — item 1 extended (Stage node-id verification at re-clearance); item 2 now
   TEST_RUBRIC-only; item 8 added (wider `DOCS/sdk/` vendoring at owning tasks).
8. Header/§16 cross-references to the vendored snapshot.

## 4. Vendored SDK snapshot (TC7)

`DOCS/sdk/sweph-wasm/` — fetched from the exact published artifact (unpkg, `2.6.9`):
`README.md` (supported-systems table), `index.d.ts` (type surface; `HouseSystems` at line
2423 — 25 codes + a lowercase `i` quirk), `LICENSE`, `package.json`; sha256 per file in
`PROVENANCE.md`. **License finding:** the LICENSE file is **AGPL-3.0** (661 lines) — the
README badge claims MIT; the file governs, and D9/D14's AGPL posture is unaffected. The WASM
binary and bundled `seas_*.se1` tables are *not* vendored — they arrive via the pinned npm
dependency; P.1 documents the mount set in `tables.ts`.

## 5. CHECKLIST.md — recreation chain

Three attempts, all preserved on disk and in git (additive, I3; TC5 semantics):

1. `CHECKLIST.md.bak.20260909_163202` — the 2026-09-04 original (byte-identical `cp`).
2. `CHECKLIST.v1.4.16444.transcribed-from-predecessor.md` — intermediate attempt: the old
   text with audit fixes folded in. **Superseded**: the operator's directive was de novo
   derivation, and transcription keeps the old derivative as co-author.
3. `CHECKLIST.md` (live, commit `ea6c7b7`) — **derived de novo from the reconciled
   ARCHITECTURE.md**: every Spec opens with its `§` anchor; §5's entity table is the
   ownership partition; §2's dependency rule is the phase structure. 58 tasks, all `[ ]`,
   four ⛓ integrators (I.1–I.4), pairwise-disjoint Owns sets, `verify`-scope ownership
   grants for every test file (T0.5–T0.10, P.2/P.3/P.4, L.1–L.5, B.1–B.6, C.1–C.4, U.1–U.9,
   M.1, X.1/X.2, G.1, I.1/I.3), Reads added where a Verify consumes another task's contract
   file (I.1←T0.2, I.2/V.1←T0.3, I.4←T0.1+V.2, B.3←T0.10, R.7←T0.1).

A mechanical ownership-closure validator was built and run during the transcription attempt
(`.tmp/validate-checklist.py`, 28 flags, then retracted): the operator ruled that at
ARCHITECT phase **there is nothing to test — the enumeration is consumed onto the checklist
or the checklist is wrong**; a lossy matcher over an exactly-enumerated document only adds
noise (21 of 28 flags were matcher artifacts), and any residual need-to-check is itself
evidence of an under-specified block, which a coder hitting the same ambiguity could not
resolve from one self-contained task. The unbacked "closure was validated mechanically"
attestation sentence was removed from the protocol section for the same reason (I-12: no
proxy attestation). Validator and retraction are recorded here as session history; no
validator ships in the repo.

## 6. Admin-Manual amendment (`a64f80c`, pushed to `github:Robin-s-AI-World/Admin-Manual`)

Per operator directive ("Pieces is back — restore checking Pieces database files locally as
a first line in combination with codegraph before even looking at the codebase"):

- **TC2** (`DOCS/TOOLING_CONVENTIONS.md` row + `pieces-as-first-resort.md`): the direct
  local read of the Pieces database files (`~/Documents/com.pieces.os/production/Pieces/
  vector_db/*.sqlite`, `-readonly`) is **promoted back to the session-start first line** for
  the orchestrator, run **in combination with codegraph (TC8), before any raw codebase
  read**. Structured MCP endpoints become the richer follow-up layer; `ask_pieces_ltm`
  stays last-resort; architect/coder negative scope (§0) unchanged. Dated amendment note in
  the detail file; CHANGELOG entry under [Unreleased] → Changed.

## 7. Operator directives recorded this session (pending DECISIONS.md minting)

| Candidate | Directive (date) | Substance |
|---|---|---|
| D15 (proposed) | 2026-09-09 | Roadmap item 2 executed "don't block — vendor in": fold audit fixes directly into the recreated checklist; vendor the sweph-wasm snapshot rather than blocking the house-system pin. |
| D16 (proposed) | 2026-09-09 | **No hardening; never break Tauri 2 multi-platform compatibility.** Documentation reconciliation only; build topology, stamping scheme, and all six billing rails untouched. |
| D17 (proposed) | 2026-09-09 | **ARCHITECT-phase doctrine:** the enumeration is consumed onto the checklist or the checklist is wrong — no test-like or matcher activity at this phase; coders see exactly one self-contained task block and nothing else; anything a checker would have to resolve must be resolved in the enumeration. |
| D18 (proposed) | 2026-09-09 | Checklist is recreated **de novo from ARCHITECTURE.md** on major change — never transcribed from its predecessor; predecessors preserved beside with semantic names. |

These were **minted 2026-09-11 into `DOCS/DECISIONS.md` as D15–D18** (operator directives,
recorded verbatim-in-substance).

## 8. Spec-panel review (2026-09-10) — findings staged for disposition

Panel: Wiegers, Adzic, Cockburn, Fowler, Hohpe, Nygard, Crispin — critique mode, overall 8.0/10.
Full output in the session transcript; condensed:

- **HIGH (Wiegers/Cockburn):** reading-charge semantics under-determined — the gate runs
  pre-inference (§9.2) but a "reading" is charged on the first *Tier-1-grounded* turn that
  references a plate; the charge lifecycle (reserve → commit → compensate, or another
  trigger) must be specified before B.1/B.2 dispatch. **Operator/architect fill.**
- **HIGH (Cockburn):** single-person removal cascade (sessions, turns, lore nodes/edges,
  cached charts) unspecified; X.2 covers only delete-everything. **Architect fill.**
- **HIGH (Adzic/Wiegers):** import-merge conflicts (same personId, divergent data) undefined
  in `importDocument`. **Architect fill.**
- **MED-HIGH (Hohpe):** refund/chargeback → deny-list revocation flow unspecified (bridge
  mints but nothing moves a jti onto the deny-list). **Operator decision.**
- **MED (Hohpe/Fowler):** envelope begin/end semantics (Speaking→Idle trigger); unified
  error taxonomy (deferred as viable — INC-19 rendering already implies one treatment).
- **MED (Nygard):** native keychain absent on some Linux hosts — fallback posture (honest
  absence vs encrypted file) needs a ruling; deny-list refresh cadence; free-space
  precondition for model downloads.
- **LOW-MED (Crispin):** rubric prerequisites — fence adversarial corpus classes, a gate
  worked example, published Ed25519 test vectors (RFC 8032) over generated keypairs.

No files were modified by the panel (its own boundary: review only).

## 9. Gaps and open items (unchanged plus new)

1. `DOCS/TEST_RUBRIC.md` authoring — the remaining gate-2 sibling (H1).
2. Operator re-clearance + re-freeze of the amended complement — including the Stage
   node-id verification (H3) and disposition of §8's operator-decision rows.
3. Postgres **task_ledger** (`192.168.0.249:5432` — Proxmox CT 112, `alpine-postgresql`)
   returned with the fleet; **re-recorded 2026-09-11** (ledger ids 1975–1977).
   **CC13 restored the same day** (operator correction: the tokens were valid — the
   extraction had baked the CREDENTIALS table's markdown backticks into the value);
   `rcheung/natally` created de-novo on the v15 instance (id 54, no-migration instance)
   and `master` pushed. `origin` authoritative + `github` code-only public mirror,
   histories identical. See DECISIONS 2026-09-11.
4. Doc-alignment pass from the original roadmap item 5 (M6, M8): README origin line,
   STATE-LEDGER `remotes` block, DECISIONS superseding note, APP_INVENTORY D9 field.
5. Wider `DOCS/sdk/` snapshots land at their owning tasks (§16.8), not before.

## 10. Lineage and rollback

- natally: `c39efa0` (v1.3.10001, pre-session) → `430a345` → `ea6c7b7` (v1.4.16444) → this
  report's stamp. Rollback for the checklist chain:
  `cp CHECKLIST.md.bak.20260909_163202 CHECKLIST.md`; for ARCHITECTURE reconciliation:
  `git revert 430a345` (or `git show 430a345^:DOCS/ARCHITECTURE.md`).
- Admin-Manual: `aa11cf5` → `a64f80c`; rollback `git revert a64f80c`.
- Nothing was deleted anywhere in either repo this session (I3: additive only).

---

## Appendix A — spec-panel review, full text (2026-09-10)

Verbatim record of the `/sc:spec-panel` output as delivered (panel of seven — Wiegers, Adzic,
Cockburn, Fowler, Hohpe, Nygard, Crispin — critique mode, against `DOCS/ARCHITECTURE.md`
@ `430a345` + `CHECKLIST.md` @ `ea6c7b7`). Summary disposition lives in §8 above.

```yaml
specification_review:
  spec: DOCS/ARCHITECTURE.md (§1–§17) + CHECKLIST.md (58 tasks, de novo derivation)
  review_date: "2026-09-10"
  panel: [wiegers, adzic, cockburn, fowler, hohpe, nygard, crispin]
  mode: critique
quality_assessment:
  overall: 8.0/10
  clarity: 8.5        # closed sets, pinned enumerations, §-anchored derivation
  completeness: 7.5   # two behavioral gaps (below), one lifecycle gap
  testability: 8.0    # per-task Verify/Accept + frozen fixtures; rubric pending
  consistency: 8.5    # counts/contracts now agree across all surfaces
```

### A.1 Requirements analysis

**WIEGERS — the reading-charge semantics are under-determined (HIGH).**
§9.2 says the gate runs **pre-inference**, but a "reading" is charged when the companion
produces her "first Tier-1-grounded turn… that references at least one plate." At
pre-inference time you cannot yet know whether the turn will ground on a plate; §7.4
compounds it ("free chat that reads no chart is ungated"). Specify the charge lifecycle:
*reserve* at pre-inference when a plate is in scope → *commit* on first grounded turn →
*compensate* (house never-delete law) when the turn turns out ungated, or define a different
trigger. As written, B.1/B.2 coders must invent billing semantics.

**ADZIC — the two most intricate chains have no worked examples (MEDIUM-HIGH).**
The conformance fixtures are exemplary (24 pinned cases), but the fence violation→regen→
absence chain and the trial-gate ledger have zero worked scenarios anywhere — and
`TEST_RUBRIC.md` (their natural home) doesn't exist yet. One Given/When/Then each belongs in
the rubric spec at minimum: e.g. *Given 0 remaining readings, When a plate-grounded request
arrives, Then composer is replaced pre-inference and no Reading row is written.*

**COCKBURN — two actor lifecycles are missing (HIGH / MEDIUM).**
(1) **Single-person removal**: People list has add/edit/remove, but nothing specifies what
removal does to that person's sessions, turns, lore nodes/edges, and cached charts. X.2 only
covers delete-*everything*. (2) **Import conflicts**: `importDocument` "merges by personId…
never deletes" — same personId with divergent birth data is undefined. Both are user-visible
data-integrity behaviors; both need rules before X.1/X.2/U.4 dispatch.

### A.2 Architecture analysis

**FOWLER — seam discipline is genuinely strong; two smaller notes.**
`EphemerisEngine`, `billing.consume`, `LoreStore`, `PurchaseAdapter`, and the capability
layer are clean interface segregation, and the hosted-SaaS evolution hooks (frozen now, per
R2) are the right evolutionary call. (a) The `packages/lore/src/ddl.ts` app-table
co-location is a real layering wart — acceptable as a documented disjointness trade-off,
but it should be *named* as such in §2, not only inside T0.9. (b) There is no unified error
taxonomy: `ConsumeResult.reason`, CompanionEvent `error`, download failures, and engine
failures are each ad-hoc shapes. A single `NatallyError {kind, detail, provenance}` would
let the fence, Stage, and paywall render one honest-absence treatment (INC-19 rendering
currently implies one).

**HOHPE — two integration contracts are unfinished (MEDIUM-HIGH / MEDIUM).**
(1) **Refund/chargeback → revocation**: the bridge mints on verified purchase events and
publishes a signed deny-list, but no flow specifies who moves a jti *onto* the deny-list
after a refund. Without it, "paid" is forever. (2) **Envelope begin/end**: `Speaking` ends
when the RMS envelope stops, but the CompanionEvent `envelope` member's begin/end (or
level-with-silence-threshold) semantics are unspecified — C.4's Speaking→Idle transition
depends on it. Also minor: mirror download retry policy (attempts/backoff) after a failed
sha256 is unstated.

### A.3 Failure-mode analysis

**NYGARD — the offline-first posture is right; three operational edges.**
(1) **Native keychain on Linux** (§9.3): "OS keychain" is unspecified where no
secret-service exists — and a plaintext fallback is unacceptable. Specify the posture
(honest absence with re-enter-code, or an encrypted file store) before B.3. (2) **Deny-list
refresh cadence** — "checked when online" needs a when: app start, before checkout, and
N-hourly are the natural set. (3) **Disk exhaustion** during GB-scale model downloads on
Android — add a free-space precondition to M.1 or accept the failure loudly in its error
path.

### A.4 Testing analysis

**CRISPIN — pre-committed Accepts are strong; two rubric prerequisites.**
(1) Crypto and code-minting tests should use **published Ed25519 test vectors** (RFC 8032)
rather than generated keypairs, so B.3/B.4 tests are reproducible. (2) The fence adversarial
suite needs its corpus *classes* named now (fabricated degree; plausible-but-absent house;
date drift; sign/house-name substitution) so TEST_RUBRIC.md can size it — otherwise the
rubric author (next gate-2 session) invents coverage.

### A.5 Panel consensus, disagreements, roadmap

```yaml
expert_consensus:
  - "Charge/commit/compensate lifecycle for a Reading is the one requirement a coder cannot derive from the current text"
  - "Person-removal cascade and import-conflict rules are missing user-facing data-integrity specs"
  - "Seam architecture, closed sets, and provenance threading are exemplarily consistent — no structural rework needed"
disagreements:
  - "Fowler would unify the error taxonomy now; Nygard would defer until the rubric exercises real failure paths — defer is viable since C.2/U-tasks already render absence per INC-19"
improvement_roadmap:
  operator_decisions: [refund→deny-list policy, keychain fallback posture]
  architect_fill_next_edit: [reading charge lifecycle (§9.2), person-removal cascade + import conflicts (§5/§8.4), envelope begin/end (§10), deny-list cadence (§9.3)]
  rubric_prereqs: [fence corpus classes, gate worked example, Ed25519 published vectors]
```

Per the panel's boundaries, no files were modified by the review itself.
