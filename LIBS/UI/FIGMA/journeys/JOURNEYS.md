# natally — user journeys (frozen with the screen set)

Every journey starts and ends in the conversation. Screens named here are the cleared set; no
other surface exists.

| ID | Journey | Path (screens) | What natally does | Honest-absence branch |
|---|---|---|---|---|
| J1 | First light | splash → first-light → conversation | Asks name, date, place, time (or unknown); after each answer returns a computed fact; on completion lays the natal plate on the page | time unknown ⇒ solar chart: no Ascendant, no houses, plate footer says so |
| J2 | Read my chart | conversation → plate-natal → atlas-natal → glossary-callout → conversation | Places the natal plate; Open expands the Atlas; tapping a glyph opens the callout; "Ask natally about this" posts the term back into the conversation | model absent ⇒ charts still work; her generated turns are absent, facts remain |
| J3 | Add a person | conversation (composer +) → people → first-light intake → people → conversation | Same intake as J1 for another person; the new person appears in the People list and the context chip | no birth time ⇒ that person's houses are absent everywhere |
| J4 | Synastry | conversation (context chip) → people (pick two) → conversation → atlas-synastry | Chip becomes "You + Sam"; natally lays the synastry plate (bi-wheel); Atlas shows cross-aspects and house overlays; no score, no label, ever | one person without time ⇒ overlays into that person's houses absent; the other direction computed |
| J5 | Today | conversation → atlas-today | Lays the today plate: transiting bodies against the natal chart with orb and applying/separating | no person selected ⇒ absence with a People action |
| J6 | Wake natally (model download) | conversation (Asleep) → settings (Model) → conversation (Waking → Idle) | Wake plate explains the on-device model; Download shows real progress; Stage goes Waking then Idle. Unlicensed: only the designated trial model is downloadable; other rows show the lock and route to /paywall (D11) | download fails ⇒ Error stage + reason; charts unaffected |
| J7 | Voice on / off | conversation (composer voice control) → settings (Voice) | Kokoro voice picker with preview; mute persists; Stage Speaking follows the real audio envelope | web ⇒ "natally speaks in the installed app" |
| J8 | Export / import | settings (Data) → people | Exports people + sessions + lore as JSON; import merges by person id (lore nodes by id) | none |
| J9 | Back and deep links | any → previous | Hash routes `/`, `/atlas/:plate`, `/people`, `/people/:id`, `/settings`, `/paywall`, `/checkout`, `/about`; Android back returns to the previous route; the conversation keeps its scroll | none |
| J10 | Trial → pay → unlock | conversation (TrialExhausted) → paywall → checkout (handoff / iap-waiting) → checkout (success) → conversation (Delighted, unlimited) | She offers the unlock in her own voice; checkout hands off to the processor (hosted redirect on desktop/web, store sheet on Android, RevenueCat paywall where configured); success returns to the conversation unlocked | payment fails ⇒ ember reason card + Try again; offline ⇒ honest absence "checkout needs the internet once"; later ⇒ /checkout/enter-license-key with the receipt key |
| J11 | Redeem a code | paywall (Enter a code) or settings (License · Enter a code) → conversation | Single input auto-detects individually-redeemable and hash-based codes; valid ⇒ unlock (Delighted); the code joins the consumed-codes ledger | invalid / already used / expired ⇒ ember line with the real reason (paywall code-error) |

The **Journeys** page in the Figma file draws J1, J2, J4 and J6 as frame-to-frame flows; the
others are single transitions already visible on their screens. J10 and J11 (2026-09-04, D11)
are text-only here, like J3, J5, J7, J8, J9 — their screens (paywall, checkout, trial variants)
are all in the complement.

## Figma

Page `Journeys` (4:18), frame `Journeys` 27:2 — rows J1 27:5 · J2 27:25 · J4 27:55 · J6 27:80. Render: `journeys.png`. J3, J5, J7, J8, J9 are text-only here; their screens are all in the frozen set and they add no frame the four drawn rows do not already touch.
