# natally — Figma tokens (frozen complement)

- **Figma file:** `natally v1` — key `TmZDFVgkUeeL1VEYWtuaJL` — <https://www.figma.com/design/TmZDFVgkUeeL1VEYWtuaJL>
- **Variable collection:** `natally Tokens` (`VariableCollectionId:2:2`), single mode `Dark` (`2:0`) — dark only (A4)
- **Code mirror (once `src/` exists):** Tailwind 4 `@theme` in `src/styles/tokens.css`; every variable carries its WEB code syntax.
- **Law:** every fill, stroke, radius, gap and size in the screen frames binds to a variable below. No raw hex in frames.

## Colour (COLOR)

| Variable | ID | Hex | Role | CSS |
|---|---|---|---|---|
| `midnight` | 2:3 | `#120C1C` | ground | `--color-midnight` |
| `midnight/2` | 2:4 | `#1C1428` | plates, cards | `--color-midnight-2` |
| `midnight/3` | 2:5 | `#271C36` | inputs, nested surfaces, chips | `--color-midnight-3` |
| `hairline` | 2:6 | `#322641` | 1 px strokes, rules, dividers | `--color-hairline` |
| `vellum` | 2:7 | `#F1E8D8` | text | `--color-vellum` |
| `vellum/muted` | 2:8 | `#A99DAE` | labels, meta, inactive | `--color-vellum-muted` |
| `gilt` | 2:9 | `#D4AF37` | **hers**: her margin glyph, luminaries, the one primary action, conjunctions | `--color-gilt` |
| `orbglow` | 2:10 | `#F2A38C` | **yours**: user turn stroke, focus ring, active person chip | `--color-orbglow` |
| `moonlight` | 2:11 | `#9FB4FF` | **the sky**: links, soft aspects, applying marker | `--color-moonlight` |
| `ember` | 2:12 | `#E2604F` | hard aspects, errors | `--color-ember` |
| `z/aries` … `z/pisces` | 2:13 … 2:24 | 12 hues at 30° (HSL 50% / 68%) | sign data-coding on ring and tables only | `--color-z-<sign>` |

## Shape, space, size (FLOAT)

| Variable | ID | Value | Scope | CSS |
|---|---|---|---|---|
| `radius/plate` | 2:25 | 12 | plates, sheets | `--radius-plate` |
| `radius/button` | 2:26 | 10 | buttons | `--radius-button` |
| `radius/chip` | 2:27 | 8 | chips, rows, inputs | `--radius-chip` |
| `radius/pill` | 2:28 | 999 | composer, avatar | `--radius-pill` |
| `space/1 2 3 4 6 8` | 2:29 … 2:34 | 4 8 12 16 24 32 | gaps and padding | `--spacing-<n>` |
| `stroke/hairline` | 2:35 | 1 | all chrome strokes | `--stroke-hairline` |
| `size/touch` | 2:36 | 44 | minimum control size | `--size-touch` |
| `size/stage` | 2:37 | 200 | mascot stage height (mobile) | `--size-stage` |
| `size/avatar` | 2:38 | 44 | collapsed mascot avatar | `--size-avatar` |

## Text styles

| Style | Font | Size / line | Use |
|---|---|---|---|
| `voice/display` | Fraunces SemiBold | 28 / 34 | splash wordmark, first-light greeting |
| `voice/title` | Fraunces SemiBold | 22 / 28 | screen titles |
| `voice/name` | Fraunces SemiBold | 18 / 24 | her name in the margin, plate title |
| `voice/aside` | Fraunces Italic | 16 / 24 | her one-line asides, honest-absence lines |
| `ui/body` | Nunito Sans Regular | 16 / 24 | conversation, settings copy |
| `ui/body-strong` | Nunito Sans SemiBold | 16 / 24 | button labels, person names |
| `ui/secondary` | Nunito Sans Regular | 14 / 20 | explainers, secondary copy |
| `ui/label` | Nunito Sans SemiBold | 12 / 16, +4% | section labels, chips (sentence case) |
| `data/stat` | IBM Plex Mono Medium | 13 / 18 | degrees, orbs, computed values (`tnum`) |
| `data/meta` | IBM Plex Mono Regular | 12 / 16 | table cells, timestamps |
| `data/micro` | IBM Plex Mono Regular | 11 / 14 | the version stamp only |

Floor for any other text: 12 px.

## Glyphs

`glyphs/natally-glyphs.svg` — 36 stroke glyphs (12 signs, 11 bodies, 2 nodes, 7 aspects, retrograde,
applying, separating) on a 24×24 grid, stroke 1.5, round caps, `currentColor`. Imported into
Figma as components on the **Glyphs** page; used at 16 / 20 / 28.

## Components (page `Components`, node ids in `natally v1`)

| Component | Node | Variants / notes |
|---|---|---|
| Button | 6:8 | primary (gilt) · secondary (hairline) · quiet |
| Chip | 6:13 | context chip; active = orbglow hairline |
| TopBar | 6:16 | menu · wordmark · context chip |
| Composer | 6:24 | plus · field · voice · one gilt send |
| Stage | 7:20 | State = Asleep 7:3 · Waking 7:5 · Idle 7:9 · Thinking 7:12 · Speaking 7:16 (Listening, Delighted, Error composed per `mascot/STATES.md`) |
| Turn/Her | 9:3 | gilt glyph in the margin, page text |
| Turn/You | 9:12 | right-aligned, orbglow hairline |
| Plate | 9:15 | title · body slot · provenance foot (`Placidus · 1990-05-02 14:32 · Malmö`) · Open |
| Wheel/structure | 10:5 | 272 px, AC/MC labels, cusps are placed by the engine at runtime |

Pages: Cover 0:1 · Tokens · Components · Journeys 4:18 · Glyphs · one page per `screen-*`. Frame ids per screen are listed in each `screens/<id>/SCREEN.md`; the full map is `STATE-LEDGER.json`.
