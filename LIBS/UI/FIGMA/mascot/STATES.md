# natally — mascot states

**Source (operator IP, shared with Kintsugi by decision D5):** `natally-source-loop.mp4`
(544×544, 24 fps, 124 frames, 5.175 s, one continuous idle loop: breathing, hand hover over
the orb, orb glow drift). Inspection of frames 0 / 40 / 80 / 120 shows the **same pose
throughout**: the source contains **one state**, not several.

Derived here: `natally-idle-400.webp` (animated, loop), `natally-still-400.png` (frame 0),
`natally-still-mid-400.png` (frame 62), `natally-icon-1024-rgba.png` (icon source).

## State table — what is real, what is composed

| State | Trigger (real event) | Source | Composition on top of the idle loop |
|---|---|---|---|
| idle | engine ready, nothing pending | **real** idle loop | none |
| asleep | no model downloaded | composed | loop paused on frame 0; eyes mask (two vellum-muted lids drawn in Figma, positioned over the eyes); orb desaturated 60%, brightness 55% |
| waking | engine or model loading | composed | loop paused; orb brightness eases 55% → 100% with the real progress fraction |
| listening | composer focused | composed | loop playing; slight 2° tilt toward the composer; orb hue shifts +8° toward orbglow |
| thinking | request sent, no tokens yet | composed | loop playing at 0.8×; a slow orbglow swirl overlay on the orb (radial gradient rotating 6 s) |
| speaking | Kokoro audio playing | composed | loop playing; orb glow scale follows the audio RMS envelope (1.0 → 1.12); mouth line (drawn in Figma, 3 frames) cycles with the envelope |
| delighted | a chart just computed | composed | one-shot 600 ms scale 1.0 → 1.04 → 1.0 with a gilt ring flash |
| error | engine or model failure | composed | loop paused; orb dimmed; a gilt "seam" crack drawn in Figma over the orb |

All overlays are Figma-drawn vector layers exported to SVG at implementation; the loop itself
is never edited. New source footage with distinct poses would replace the composed rows one by
one; until then these are the honest states.
