# Design System: Natally birth-time editor

Source chain: original Natally Figma `TmZDFVgkUeeL1VEYWtuaJL`, frame `15:148`
(retrieved 2026-10-05), architecture §18.6.1 typewriter amendment, then Google
Stitch project `8460014353109836944`. The Alby marketplace project is excluded.
This document scopes a proposed birth-time repair, preserving the existing intake.

## 1. Visual theme and atmosphere

Quiet, airy, dark celestial intake. One question at a time, left aligned. Preserve
the shipped typewriter presentation, not the older Figma conversation layout.
Figma supplies time-or-unknown semantics; the newer architecture supplies layout.
Density 3, variance 2, motion 2. No marketing copy or fictional birth data.

## 2. Color palette and roles

- Charcoal `#111415`: main canvas, from the existing intake.
- Violet `#7c3aed`: subdued background aura only, existing visual identity.
- Gold `#d4af37`: active control, selected clock value, hairline and focus.
- Vellum `#f1e8d8`: primary text, from Figma.
- Muted vellum `#c5bdcd`: labels and secondary actions.
- Midnight `#120c1c`: editor surface, from Figma.
- Hairline `#322641`: neutral control borders, from Figma.

## 3. Typography

Playfair Display for the existing intake prompt, clamp(2rem, 5vw, 3rem).
Nunito Sans for controls at 16px, IBM Plex Mono for editable time at 32px.
Self-host all fonts. Keep copy above 12px and action labels at least 16px.
Existing Natally tokens override generic skill defaults about serif and violet.

## 4. Component styling

Use an app-owned time editor with a clear `Clock` / `Type time` choice.
Typed hours and minutes are real HTML text inputs with numeric inputmode,
never a drawing of a keyboard and never a native input[type=time] modal.
AM and PM are explicit real controls. Clock has selectable hours 1–12 and
minute precision 00–59, with accessible buttons and minute adjustment controls.
Every interactive target is at least 44px. Distinct gold focus outline.

`Set time` commits the editor draft. `Cancel` discards changes and restores the
committed value. `Begin` belongs to the parent intake and only enables after a
valid committed time or explicit `I don’t know my birth time`. No default time
may silently become a birth fact. Opening clock selection may suggest a value
only as uncommitted input; blank typing remains visibly blank.

## 5. Layout

Single column, fluid width, max-width 42rem. Editor fits 320px-wide viewports;
when the software keyboard reduces height, content scrolls and actions remain
reachable. Use min-height:100dvh, not a fixed-height image. No horizontal scroll.
No giant page capture combining every state; each state gets a viewport still.

## 6. Motion and interaction

Use short opacity transitions; respect reduced motion. Input focus follows a
direct tap on `Type time` or the field. Set and Cancel are always explicit.
Switching modes retains the uncommitted draft. AM/PM conversion supports
midnight (12 AM → 00:00) and noon (12 PM → 12:00). Persist canonical HH:mm only.

## 7. Prohibited patterns

No fake OS status bars, fake keyboard, invented chart/companion replies, mock
completion screen, compatibility copy, external runtime assets, or Alby branding.
No generated promotional tagline. The HTML export must have working inputs,
buttons and connected event handlers. An illustration alone is insufficient.
