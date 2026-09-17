# U.9 Stage assets

These files are byte-for-byte copies of the frozen operator-owned assets in
`LIBS/UI/FIGMA/mascot/`. `STATES.md` is copied unchanged with them.

| File | SHA-256 | Use |
| --- | --- | --- |
| `natally-idle-400.webp` | `a40780bad977525afdd6c7f92ed47a4b0ba090b1453921a0ad4248208301f873` | Original derived animated idle loop |
| `natally-still-400.png` | `11868146604c5f0237f1af3f37e2252f7d3394ff8304d5d570f16a4cae392b66` | Original frame-zero still for reduced motion, offscreen/hidden, asleep, waking, error |
| `natally-source-loop.mp4` | `1364c68499a3caccfc8c4de8b0759c31c4db941b8721c3bacdf544df0d334afa` | Same original idle footage, muted and played at 0.8× for Thinking |
| `STATES.md` | `10432e3a0638c973e06c2792f092eba850940b2d1886beb05e7cf29cd04aa451` | Frozen state/composition specification |

There is only one source pose. No new footage, alternate mascot images, or
generated animation assets were created. The MP4 is the source of the WebP,
used because an animated WebP image has no browser playback-rate control.

The frozen folder does not contain separate SVG exports of the Figma vector
overlays. The SVG/CSS layers in `../../ui/stage.tsx` are implementation-authored
compositions of the STATES.md table over the unchanged footage. They are not
claimed to be exported Figma artwork. Their orb/eye/mouth coordinates reference
the 400×400 frame-zero image. Exact Figma vector replacement, if those exports
are subsequently supplied, does not require changing the source footage.
