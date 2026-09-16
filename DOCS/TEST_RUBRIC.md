# natally — test rubric (Gate 2 document 3 of 3)

Formalizes the **cross-task acceptance matrix**. `CHECKLIST.md` task-level `Verify` lines are
the executable subset of this rubric; this document adds the tolerances, adversarial suites,
journey walks, budget asserts, and ban greps that span tasks. Normative same as
`DOCS/ARCHITECTURE.md`; written 2026-09-16 to complete gate 2 (AGENTS.md I2) before any `src/`.

Pass convention: a rubric item is **green** only when the named runner exits 0 (or the named
grep/count matches) on the current tree, run through the owning task's Verify command or the
I.4 full gate. No item may be marked green from a previous tree state (house: a green run only
proves the tree it ran on).

## TR-1 Ephemeris conformance (P.1, P.3, P.4; U.3 render)

| Item | Tolerance / rule |
|---|---|
| Planet/body ecliptic longitude vs Swiss Ephemeris reference | **± 0.01°** — active only once the operator supplies reference tables; until then **invariant mode** (below) holds and tightening is forbidden to fake |
| Invariant mode: positions | every `lon ∈ [0, 360)`; `|speed|` within per-body bounds table (planets ≤ 1°/day except Moon ≤ 16°/day; Chiron ≤ 0.1°/day) |
| Invariant mode: cusps | cusps strictly ascending modulo 360; `|normalize(mc − asc)| ≤ 180` |
| Wheel render (U.3) | cusp/aspect angles drawn from fixture ChartFacts match **± 0.5°** |
| Determinism (P.4) | same canonical inputs ⇒ same content-hash id, byte-identical facts; cache hit returns the identical object |
| Successor engine (future) | full reference suite above (§6) — 24-case minimum + all 12 house systems against published examples |

## TR-2 Fence adversarial suite (C.2)

`checkFence` must **pass** clean output and **fail** each of these classes (table-driven,
one violating sample each minimum):

1. Fabricated degree — a number not present in Tier 1.
2. Off-by-tolerance — a Tier 1 value altered by **> 0.01°** (0.01° exactly passes).
3. Wrong sign/house name — degree matches but the sign or house label is inconsistent.
4. Invented date — a date absent from Tier 1 inputs/facts.
5. Invented orb or applying/separating claim contradicted by Tier 1 speeds.
6. Lore contamination — an astrological claim sourced only from Tier 2 fragments.

Chain law: violation ⇒ exactly **one** regeneration with the violation quoted ⇒ still
violating ⇒ the honest-absence string ("I only say what your chart says"). Regeneration count
is asserted (≤ 1); absence string is asserted verbatim.

## TR-3 Billing & licensing (B.1–B.6)

| Item | Matrix |
|---|---|
| Trial gate (B.1) | ≥ 14 table cases covering count/time/rate/licensed, boundary readings (0 remaining, exactly-at-cooldown, day rollover); injected clock only |
| consume seam (B.2) | licensed ⇒ allowed; trial-active ⇒ allowed+remaining; exhausted ⇒ `trial-exhausted`; rate-limited ⇒ `rate-limited` + `nextReadingAt`; ledger append-only (no UPDATE path exists) |
| Token verify (B.3) | valid passes; tampered payload, wrong `iss`, wrong `sub`, expired, revoked-jti each rejected with distinct reason; offline verify never requires network |
| Codes (B.4) | mint → verify OK; reuse ⇒ `already-used`; bad charset (I/L/O/U) rejected; expired ⇒ `expired`; 4 outcomes exact |
| Hosted adapter (B.5a) | URL build; poll 2s backoff, 15 min cap; SSRF rejects `http`, loopback, RFC1918/private, link-local, reserved hosts |
| RC adapter (B.5b) | paywall → entitlement → mint → token flow with injected SDK; no entitlement ⇒ honest absence |
| Registry (B.5c) | blank config ⇒ rail absent from `paymentsAvailable()`; present ⇒ ordered inclusion |
| Bridge (B.6) | 6 webhook fixtures: valid HMAC accepted, bad signature 401, **double delivery is idempotent** (ledger PK `(processor, invoice_id)`); mint→verify roundtrip; redeem reuse rejected; denylist envelope signature verified |

## TR-4 Lore invariants (L.1–L.5)

- Merge threshold: cosine ≥ **0.92** same-kind ⇒ merge (earlier id kept, refs unioned, weight
  bumped); 0.919… ⇒ no merge. Boundary pairs are fixtures.
- Retrieval: k=8 vector ∪ 2-hop; person-scoped unless `q.general`; budget **1,500 tokens**
  (char/4 estimate) never exceeded; fragments carry `sourceTurnId`.
- Pipeline: exactly **one flush per turn** (asserted flush counter), insert-only SQL in one
  transaction; `deleteAll()` leaves **0 rows** in both tables and vectors (real deletion).
- Embedder contract: dim honored from config; L2 norm `1.0 ± 1e-6`; hash embedder appears in
  **zero `src/` files** (grep test).

## TR-5 Voice & Stage (V.1, V.2, U.9)

- RMS envelope math identical on both legs (shared fixture PCM; per 20 ms window, normalized
  0–1; ± 1e-3 cross-leg agreement on the same samples).
- Sentence chunking: never splits mid-word; queue drains in order; mute suppresses playback
  but not the transcript.
- Stage states map 1:1 to bus events (STATES.md): first token ⇒ Thinking; envelope active ⇒
  Speaking; chart-computed/unlock ⇒ Delighted; engine failure ⇒ Error; asleep = no model.
- Reduced-motion: frame 0, no plate slide (asserted in U.9 tests).
- `speechSynthesis`: **0 hits** in `apps/**/src/**` (`scripts/grep-no-speechsynthesis.sh`).

## TR-6 Screens & INC-19 rendering (U.1–U.9)

- Variant counts render against scripted bus events: conversation **9**, paywall **7**,
  checkout **6**, atlas **3**, stage **8**; settings sections exactly **6**.
- Provenance classes render distinctly (§5): `computed` → Plex Mono; `generated` → Fraunces
  margin glyph; `authored` → labelled section; `absence` → the screen's honest-absence
  treatment. A test fixture per class on the conversation screen.
- No compatibility score, no canned interpretation anywhere (INC-19): grep-level test in U.3
  asserts the Atlas emits aspects without score/label fields.
- Type floor 12 px; one navigation system; version stamp `data/micro` bottom-right (U.1).
- Routes (J9): exactly `/`, `/atlas/:plate`, `/people`, `/people/:id`, `/settings`,
  `/paywall`, `/checkout`, `/about`; deep-link to each keeps conversation scroll on back.

## TR-7 Journey walks (J1–J11)

Each journey is walked as a scripted jsdom (or, where marked, manual device) pass:

| ID | Walk asserts |
|---|---|
| J1 | 4-step intake yields Person + first computed fact after each answer; unknown time ⇒ solar branch (no ASC/MC/cusps; plate footer states it) |
| J2 | plate laid → Open → Atlas → glyph → callout → "Ask natally" posts term to conversation; model absent ⇒ facts still render, her turns absent |
| J3 | second-person intake from People; new person in list + context chip; their houses absent if time unknown |
| J4 | two-person chip → synastry plate (bi-wheel); cross-aspects + one-directional house overlays; **no score/label** |
| J5 | today plate with transits (orb + applying/separating); no person ⇒ absence + People action |
| J6 | download progress real (% from bytes); trial lock routes to `/paywall`; fail ⇒ Error + reason; charts unaffected |
| J7 | voice preview plays; mute persists across restart; web leg shows the honest line (never `speechSynthesis`) |
| J8 | export → wipe → import restores equivalently (X.1 roundtrip; merge-by-id, never deletes) |
| J9 | deep-link every route; back preserves conversation scroll |
| J10 | TrialExhausted → paywall → checkout handoff (redirect/iap per rail) → success ⇒ Delighted + unlimited; fail ⇒ ember reason + Try again; offline ⇒ honest absence |
| J11 | code entry auto-detects kind; valid ⇒ unlock; each bad outcome (invalid/used/expired) ⇒ ember line with the real reason |

J1–J11 initially automated on the web leg; device legs (desktop, Android) get manual walks at
release time recorded against this table.

## TR-8 Budgets & performance (I.4, §12)

- Built web initial JS **≤ 300 KB gz** (`scripts/assert-budget.mjs`; fails the build gate).
- Ephemeris WASM + tables, llama runtime, Kokoro weights: absent from the initial bundle
  (assert by bundle inspection); loaded lazily, sha256-verified, cached.
- First plate ≤ 150 ms after tables warm (desktop-class; manual measurement recorded at
  release review — not a unit gate).
- Lore writes ≤ 1 flush/turn; retrieval ≤ 1,500 tokens (unit-gated, TR-4).

## TR-9 Static bans & lint greps (CI wake set, R.7)

| Grep | Rule |
|---|---|
| `speechSynthesis` | 0 hits in `apps/**/src/**` (ts, tsx, rs) |
| `fetch\|WebSocket\|open(` in `apps/local/src/companion/tools.ts` | 0 hits (tools have no network) |
| `__TAURI__` outside `apps/local/src/capabilities.ts` | 0 hits |
| hash-embedder import in any `src/` | 0 hits |
| `hf_\|sk-\|BEGIN.*PRIVATE KEY` in tracked files | 0 hits (`.env` gitignored) |
| license-lint (R.7) | `sweph` import ⇒ `license == AGPL-3.0-or-later`, and vice versa — both directions enforced |
| raw hex outside `tokens.css` (`#rrggbb` in `src/**` excluding tokens re-export) | 0 hits (§3 law) |

## TR-10 Merge gate

`src/` PRs merge only when: every touched task is `[X]` ✅ (Verify matched Accept), **I.4
green end-to-end** (typecheck + lint + all suites + budget + ban greps), and the TR-1–TR-9
items owning those surfaces are green. Journey walks (TR-7) may trail to release review for
device legs only, recorded here.
