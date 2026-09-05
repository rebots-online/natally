# natally — design system (frozen complement, TC12 Figma carve-out)

## The idea
natally is a person: a warm robotic fortune-teller with a crystal ball who reads your sky to
you, aloud, in conversation. The interface is her notebook at an observatory desk: the page
you talk on, and the plates (chart wheel, aspect table, transit list, bi-wheel) she lays down
on it while she talks. **The conversation is the app.** There are no astrology tabs.

## Colour
Plum-black ground (`midnight`) drawn from her turban; warm paper text (`vellum`); three
semantic accents: `gilt` is **hers** (margin glyph, luminaries, the single primary action per
screen), `orbglow` is **yours** (the user's turn, focus, the active person chip), `moonlight`
is **the sky** (links, soft aspects, applying). `ember` marks hard aspects and errors only.
The 12-hue zodiac ramp codes data on the ring and in tables, never decoration. Dark only.

Contrast on `midnight`: vellum 14:1 · gilt 8.5:1 · orbglow 9:1 · moonlight 9:1 · ember 5.5:1
· vellum/muted 6.5:1. Gilt may carry body-size text.

## Type
Three voices. **Fraunces** (SemiBold, Italic) is natally's voice: her name, titles, plate
titles, asides. **Nunito Sans** is the interface. **IBM Plex Mono** is the ephemeris: every
degree, orb, time, table. Floor 12 px. Labels are sentence case, +4% tracking; never
all-caps everywhere. Fonts are self-hosted woff2; no CDN.

## Shape
Plates 12, buttons 10, chips/inputs 8, composer pill. Hairlines 1 px `hairline`. No glow
borders, no glassmorphism, no gradients as fills. A drop shadow appears only on the plate
being placed (effect style `plate/placed`).

## Layout
**Mobile (430):** top bar (menu · wordmark · context chip) → Stage (200 px, collapses to a 44 px
avatar in the top bar on scroll) → transcript → composer.
**Desktop (≥ 960):** People + Sessions rail (left) · conversation (centre) · Atlas panel
(right, opens when a plate is opened).
**Transcript grammar:** her turns run as page text with her `voice/name` and a gilt glyph in
the left margin (no bubbles); your turns are right-aligned inside an `orbglow` hairline box;
plates are `midnight/2` cards with a `voice/name` title line and an "Open" action.
Routes: `/`, `/atlas/:plate`, `/people`, `/people/:id`, `/settings`, `/paywall`, `/checkout`,
`/about` (hash router; Android back works).

## Commerce surfaces (D11)
`/paywall` and `/checkout` speak in her voice, never in a storefront's. The one gilt primary
per screen is the unlock CTA; prices, offering names, trial counters, processor lists and
failure reasons are **runtime data** (Plex Mono bracketed markers in frames, never sample
prose). No countdown timers, no crossed-out prices, no pressure copy — she offers, warmly,
once. Trial states live in the conversation (context chip + honest asides), not as a modal.
Unlock success returns to the conversation; the mascot's Delighted moment is the only
celebration.

## Signature: the Stage
The mascot's state is driven only by real events: asleep (no model) · waking (loading, real
progress) · idle · listening (composer focused) · thinking (request sent) · speaking (Kokoro
audio playing; orb and mouth follow the RMS envelope) · delighted (chart computed) · error.
See `mascot/STATES.md` for what is real footage and what is composed.

## Content law (INC-19)
Every string is exactly one of: **computed fact** (Plex Mono, from the engine), **authored
static** education (labelled "What it is" / "In synastry"), **generated** transcript
(attributed to natally, streamed), or **honest absence**. No canned interpretation, no
compatibility scores, no sample prose in frames: where a content system is absent the frame
shows the absence state.

## Anti-patterns (do not produce)
Tabs per feature · a second navigation system · bubbles for her turns · gold as a fill on
large areas · violet glow halos · text under 12 px · caps-tracked labels everywhere · unicode
astrological glyphs in place of the glyph set · the browser speech engine (`speechSynthesis`) on any leg · a progress bar on first
light (real progress bars only on model download and engine load) · placeholder prose.

## Accessibility floor
Body text ≥ 4.5:1; every control ≥ 44 px; visible `orbglow` focus ring; reduced motion
freezes the idle loop on frame 0 and disables the plate slide; the honest-failure plate is
visually distinct from any loading state; the version stamp is selectable.
