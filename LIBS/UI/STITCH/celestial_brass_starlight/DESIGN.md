---
name: Celestial Brass & Starlight
colors:
  surface: '#161021'
  surface-dim: '#161021'
  surface-bright: '#3d3648'
  surface-container-lowest: '#110b1b'
  surface-container-low: '#1f1929'
  surface-container: '#231d2d'
  surface-container-high: '#2e2738'
  surface-container-highest: '#393243'
  on-surface: '#eadef6'
  on-surface-variant: '#d0c5af'
  inverse-surface: '#eadef6'
  inverse-on-surface: '#342d3f'
  outline: '#99907c'
  outline-variant: '#4d4635'
  surface-tint: '#e9c349'
  primary: '#f2ca50'
  on-primary: '#3c2f00'
  primary-container: '#d4af37'
  on-primary-container: '#554300'
  inverse-primary: '#735c00'
  secondary: '#ffb59f'
  on-secondary: '#532112'
  secondary-container: '#723928'
  on-secondary-container: '#f4a58e'
  tertiary: '#c0cdff'
  on-tertiary: '#122b6e'
  tertiary-container: '#9bb0fb'
  on-tertiary-container: '#2b4184'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffe088'
  primary-fixed-dim: '#e9c349'
  on-primary-fixed: '#241a00'
  on-primary-fixed-variant: '#574500'
  secondary-fixed: '#ffdbd1'
  secondary-fixed-dim: '#ffb59f'
  on-secondary-fixed: '#380d02'
  on-secondary-fixed-variant: '#6f3726'
  tertiary-fixed: '#dce1ff'
  tertiary-fixed-dim: '#b5c4ff'
  on-tertiary-fixed: '#00164d'
  on-tertiary-fixed-variant: '#2d4386'
  background: '#161021'
  on-background: '#eadef6'
  surface-variant: '#393243'
typography:
  display-lg:
    fontFamily: Fraunces
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Fraunces
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Fraunces
    fontSize: 28px
    fontWeight: '500'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Fraunces
    fontSize: 22px
    fontWeight: '500'
    lineHeight: 30px
  headline-sm:
    fontFamily: Fraunces
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: Nunito Sans
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Nunito Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Nunito Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  oracle-voice:
    fontFamily: Fraunces
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0.01em
  astro-data-lg:
    fontFamily: IBM Plex Mono
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 22px
  astro-data-md:
    fontFamily: IBM Plex Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: IBM Plex Mono
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.08em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-tablet: 2rem
  margin-desktop: 3rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system embodies an intimate late-night astronomical parlor: an automated, warm mechanical seer seated beneath a domed brass observatory. The experience merges the precision of clockwork astrolabes with the tender, arcane intimacy of personal astrology. It resists both cold tech minimalism and whimsical fantasy clutter, balancing meticulous celestial telemetry with poetic consultation.

The emotional tone is calm, reverent, and quietly enchanted. Interactions feel ritualistic yet swift—like tuning a finely geared telescope. The aesthetic style blends **Tactile / Skeuomorphic subtleties** (brass inlays, talismanic dial rings, faint luminous mechanical glow) with **Deep Midnight Tonal Layering**. Dark ambient backgrounds host faint orbital traces and stellar dust, grounded by structured parchment-tinted typography.

## Colors

The interface operates strictly in dark mode, reflecting the nocturnal observatory atmosphere.

- **Primary (`#D4AF37` - Celestial Gold):** Reserved strictly for the oracle's identity, key sacred glyphs, active astronomical alignments, and the single primary action button per viewport. It carries an aura of aged brass and starlight; it should never be diluted through over-application.
- **Secondary (`#F2A38C` - Warm Coral):** Designates conversational reciprocation—specifically the user's voice bubbles, input prompts, and active focus boundaries. It injects warm human presence into the mechanical chamber.
- **Tertiary (`#9FB4FF` - Periwinkle Starlight):** Applied to celestial hyperlinks, planetary transits, and secondary interactive ephemera.
- **Neutral Foundation (`#120C1C` - Plum-Black Ground):** Deep, velvety cosmic void against which all surfaces rest.
- **Tonal Layers:**
  - Base canvas: `#120C1C`
  - Card surfaces: `#1C1428`
  - Elevated/Nested modules: `#271C36`
  - Micro-hairlines and borders: `#322641`
- **Text & Foreground:**
  - Main text / Foreground: `#F1E8D8` (Warm antique paper)
  - Secondary labels / Muted metadata: `#A99DAE` (Nebula violet-gray)
- **Feedback:**
  - Error state: `#E2604F` (Occult ember red, utilized solely for operational warnings and destructive states).

## Typography

The typographic hierarchy orchestrates three distinct personalities:

1. **The Oracle (Fraunces):** Used for ritual greetings, horoscopic pronouncements, and section titles. Rendered in warm paper `#F1E8D8` with soft optical sizing that feels cast in gold leaf or etched on heavy deckle-edge vellum.
2. **The Human Conduit (Nunito Sans):** Carries conversational flows, analytical breakdowns, and general UI descriptions. Its warm, rounded humanist terminals ensure lengthy transit interpretations remain effortless to read in low light.
3. **The Astrolabe Telemetry (IBM Plex Mono):** Captures planetary coordinates, houses, aspect degrees (e.g., `24° 12' 08"`), and timestamps. Always set with slight letter spacing and crisp geometry, invoking antique mechanical ledger printouts.

## Layout & Spacing

The layout is built upon a balanced fluid system structured to resemble modular brass plates and navigation consoles.

- **Mobile (< 768px):** Single-column fluid stack with `1rem` margins and `1rem` vertical gaps. Cards fill the width cleanly to maximize legibility of ephemeris data.
- **Tablet (768px - 1024px):** 6-column fluid structure with `2rem` margins. The mascot/dialogue container sits persistently alongside the celestial chart canvas.
- **Desktop (> 1024px):** 12-column grid capped at `1280px` max-width with `3rem` margins. Splits cleanly into the central observatory viewport (8 columns) and the oracle dialogue deck (4 columns).

Vertical rhythm adheres strictly to multiples of `4px` / `8px`, reinforcing the mechanical clockwork cadence of the interface.

## Elevation & Depth

Visual hierarchy uses deep tonal steps paired with faint metallic specular edges instead of drop shadows:

- **Ground (Canvas):** Pure `#120C1C`, peppered with a CSS radial noise grain and 1px SVG constellation lines at 4% opacity.
- **Level 1 (Talismanic Plates):** `#1C1428` surfaces framed by a crisp `1px` border of `#322641`. Shadows are directional and tinted: `0 4px 24px -2px rgba(10, 6, 16, 0.7)`.
- **Level 2 (Nested Devices & Insets):** `#271C36` with inset shading `inset 0 1px 2px rgba(0, 0, 0, 0.4)` and a `1px` border in `#322641`. Used for telemetry readouts and user response blocks.
- **Level 3 (Floating Instruments & Modals):** `#271C36` enhanced with a starlight halo: `0 0 0 1px rgba(212, 175, 55, 0.15), 0 12px 32px rgba(8, 4, 14, 0.85)`.

## Shapes

The interface embraces a unified talismanic curvature. Cards, dial holders, and content slabs utilize a `12px` (`0.75rem` / `rounded-lg`) corner radius, evoking rounded brass printing plates and polished obsidian stones.

- **Cards and Slabs:** Fixed `12px` border-radius to preserve the talismanic feel without ballooning into excessive playfulness.
- **Pills / Radians:** Used exclusively for aspect badges, degree tags, and cyclical selectors (`9999px` radius).
- **Mechanical Fasteners:** Micro-elements (such as card corner indicators or degree ticks) use small diamond or geometric accents to punctuate the geometry.

## Components

### Buttons
- **Sole Primary Action (Singular per view):** Background in Celestial Gold (`#D4AF37`), label in Plum-Black (`#120C1C`, `Nunito Sans` 700 weight). Radius of `12px`. Hover state applies a soft radial aura: `box-shadow: 0 0 16px rgba(212, 175, 55, 0.35)`.
- **Secondary Actions:** Background of `#271C36`, border `1px solid #322641`, text in `#F1E8D8`. Hover transitions border to `#9FB4FF`.
- **Ghost / Chronos Actions:** Monospaced `#A99DAE` with text underline in periwinkle on hover.

### Chips & Aspect Badges
- Constructed with `#271C36` fills, `1px solid #322641`, rounded to full pills (`9999px`).
- Astronomical labels (e.g., `☌ CONJUNCTION`, `△ TRINE`) render in `IBM Plex Mono` (`label-caps`) with glyphs tinted in Periwinkle `#9FB4FF` or Gold `#D4AF37`.

### Conversational Feed (Oracle & User)
- **Oracle Speech Turn:** Set against bare plate background with the oracle's nameplate stamped in `#D4AF37` and speech rendered in `Fraunces` (`oracle-voice`, `#F1E8D8`).
- **User Speech Turn:** Anchored in a `#271C36` card with a gentle left border highlight in Warm Coral (`#F2A38C`). Text rendered in `Nunito Sans`.

### Input Fields & Astrolabe Selectors
- Background `#1C1428` with an inner shadow and `1px` border of `#322641`.
- Placeholder text in `#A99DAE`. 
- Focus state: Border transitions smoothly to Warm Coral (`#F2A38C`) accompanied by an outer ring `0 0 0 2px rgba(242, 163, 140, 0.25)`. Never use harsh blue outlines.

### Cards & Talismanic Plates
- Always structured with `#1C1428` base, `12px` corner radii, and `#322641` border.
- Card headers feature astronomical telemetry (degree coordinates, house markers) aligned to the right in `IBM Plex Mono` `#A99DAE`.

### Selection Controls (Checkboxes & Radios)
- Custom mechanical switches: `1px solid #322641` bounding box that fills with `#D4AF37` on active state, presenting a sharp astronomical diamond tick in `#120C1C`.