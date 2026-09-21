# Font provenance — S.1

The original six static faces and the onboarding's Playfair Display variable face are
self-hosted at `/fonts/`. There are no runtime font-service requests.

## Selection

The operator permitted authoritative upstream font sources when no local WOFF2
files were available. The local search checked `LIBS/UI/FIGMA`, all of `LIBS`,
the local app public/style asset directories, and repository font assets
(including ignored files, excluding Git internals and dependency directories).
No local WOFF2, WOFF, TTF, or OTF files were found.
The family/style mapping was checked against the typography rows in
`LIBS/UI/FIGMA/TOKENS.md` and `LIBS/UI/FIGMA/DESIGN.md`.

Fraunces uses the upstream unsoftened 9pt static cuts, at 600 normal and 400
italic. The 9pt optical design is fixed in these files; there are no variable
axes. Nunito Sans uses the upstream standard-width Regular (400) and SemiBold
(600) static cuts. IBM Plex Mono uses the complete (not Unicode-subset) Regular
(400) and Medium (500) WOFF2 files. Each file retains its complete upstream
character coverage; no glyph subsetting was performed. CSS aliases the upstream
internal family names to the three exact family names required by S.1.

## Sources and licenses

Retrieved at 2026-09-13T03:02:30+00:00.
Every download below is pinned to an immutable upstream commit. License files
are copied verbatim and retain the upstream copyright notices and SIL OFL 1.1.

| Family | Authoritative repository | Pinned commit | Local license |
| --- | --- | --- | --- |
| Fraunces | [undercasetype/Fraunces](https://github.com/undercasetype/Fraunces) | `7ccdec31c6028118dce3e47fe864e3744460371d` | [OFL-Fraunces.txt](OFL-Fraunces.txt) |
| Nunito Sans | [googlefonts/NunitoSans](https://github.com/googlefonts/NunitoSans) | `058bd7a2f33d6ad5ef1df985b3db403622016a8c` | [OFL-NunitoSans.txt](OFL-NunitoSans.txt) |
| IBM Plex Mono | [IBM/plex](https://github.com/IBM/plex) | `bf260093582f04622aacc1e9f9ca604d7ccd0c42` | [OFL-IBMPlexMono.txt](OFL-IBMPlexMono.txt) |

### File sources and hashes

SHA-256 values below identify both the downloaded source and the delivered file.

- **`fraunces-semibold.woff2`** — Fraunces, 600 normal
  - Source: [fonts/webfonts/Fraunces9pt-SemiBold.woff2](https://raw.githubusercontent.com/undercasetype/Fraunces/7ccdec31c6028118dce3e47fe864e3744460371d/fonts/webfonts/Fraunces9pt-SemiBold.woff2)
  - Source SHA-256: `b9ee78c72c09468665218bf44e47c523112412adf9887a0f0ac5f73b0ada2b76`
  - WOFF2 SHA-256: `b9ee78c72c09468665218bf44e47c523112412adf9887a0f0ac5f73b0ada2b76`
  - WOFF2 bytes: 42364
  - Processing: verbatim upstream WOFF2; only the local filename differs.

- **`fraunces-italic.woff2`** — Fraunces, 400 italic
  - Source: [fonts/webfonts/Fraunces9pt-Italic.woff2](https://raw.githubusercontent.com/undercasetype/Fraunces/7ccdec31c6028118dce3e47fe864e3744460371d/fonts/webfonts/Fraunces9pt-Italic.woff2)
  - Source SHA-256: `b41b5ed32808164f32d3f3db34c352a522cad9936ad130e8ee2f3e8c969d6126`
  - WOFF2 SHA-256: `b41b5ed32808164f32d3f3db34c352a522cad9936ad130e8ee2f3e8c969d6126`
  - WOFF2 bytes: 48128
  - Processing: verbatim upstream WOFF2; only the local filename differs.

- **`nunito-sans-regular.woff2`** — Nunito Sans, 400 normal
  - Source: [fonts/ttf/NunitoSans-Regular.ttf](https://raw.githubusercontent.com/googlefonts/NunitoSans/058bd7a2f33d6ad5ef1df985b3db403622016a8c/fonts/ttf/NunitoSans-Regular.ttf)
  - Source SHA-256: `cfc5795f8333c94332ec2d2634056a9a7637484f89fa0f6f7d1a4efcfdfb0efa`
  - WOFF2 SHA-256: `3faaa39b9cadd8064ce3558099c30ffc01d6bf1c31437b19f7d0c3210310338e`
  - WOFF2 bytes: 47264
  - Processing: lossless TTF-to-WOFF2 container conversion; no subsetting or instancing.

- **`nunito-sans-semibold.woff2`** — Nunito Sans, 600 normal
  - Source: [fonts/ttf/NunitoSans-SemiBold.ttf](https://raw.githubusercontent.com/googlefonts/NunitoSans/058bd7a2f33d6ad5ef1df985b3db403622016a8c/fonts/ttf/NunitoSans-SemiBold.ttf)
  - Source SHA-256: `93caaab594719e9aa140f35ce44f89bfa4f55d382ea3b02487ff55fd123dbd0b`
  - WOFF2 SHA-256: `08b079ec364f530f2ff475f33cb11ec324f0f7ad315f184ac25aed94a4e73ff2`
  - WOFF2 bytes: 47632
  - Processing: lossless TTF-to-WOFF2 container conversion; no subsetting or instancing.

- **`ibm-plex-mono-regular.woff2`** — IBM Plex Mono, 400 normal
  - Source: [packages/plex-mono/fonts/complete/woff2/IBMPlexMono-Regular.woff2](https://raw.githubusercontent.com/IBM/plex/bf260093582f04622aacc1e9f9ca604d7ccd0c42/packages/plex-mono/fonts/complete/woff2/IBMPlexMono-Regular.woff2)
  - Source SHA-256: `ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350`
  - WOFF2 SHA-256: `ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350`
  - WOFF2 bytes: 49248
  - Processing: verbatim upstream WOFF2; only the local filename differs.

- **`ibm-plex-mono-medium.woff2`** — IBM Plex Mono, 500 normal
  - Source: [packages/plex-mono/fonts/complete/woff2/IBMPlexMono-Medium.woff2](https://raw.githubusercontent.com/IBM/plex/bf260093582f04622aacc1e9f9ca604d7ccd0c42/packages/plex-mono/fonts/complete/woff2/IBMPlexMono-Medium.woff2)
  - Source SHA-256: `33faf307fa6031fb4062276d7320a6d632de890cbb347576fd80cfa01077bc25`
  - WOFF2 SHA-256: `33faf307fa6031fb4062276d7320a6d632de890cbb347576fd80cfa01077bc25`
  - WOFF2 bytes: 50400
  - Processing: verbatim upstream WOFF2; only the local filename differs.

### License sources

- [OFL-Fraunces.txt](https://raw.githubusercontent.com/undercasetype/Fraunces/7ccdec31c6028118dce3e47fe864e3744460371d/OFL.txt)
  - SHA-256: `bdf4c22802eaf804f998195871c6b8938aac2ac14b2d78a8bd66a6f1eced833b`
- [OFL-NunitoSans.txt](https://raw.githubusercontent.com/googlefonts/NunitoSans/058bd7a2f33d6ad5ef1df985b3db403622016a8c/OFL.txt)
  - SHA-256: `efbb0c9e864cef973982d9a17567e6be5c3d1759695574586f3f18c7ecca064b`
- [OFL-IBMPlexMono.txt](https://raw.githubusercontent.com/IBM/plex/bf260093582f04622aacc1e9f9ca604d7ccd0c42/packages/plex-mono/fonts/complete/woff2/license.txt)
  - SHA-256: `91c25c350d3cac39da2736d74f7ba37ef648f5237a4e330a240615bc8d8c4360`

## Nunito Sans conversion

Conversion used the already installed `/usr/bin/python3`, FontTools 4.63.0, and
Brotli 1.1.0. No packages were installed or added to the project. For each pinned
Nunito Sans TTF above, the following in-memory operation produced the delivered
WOFF2 bytes, preserving the source timestamp, names, outlines, and character map:

```python
from io import BytesIO
from fontTools.ttLib import TTFont

font = TTFont(BytesIO(source_bytes), recalcBBoxes=False, recalcTimestamp=False)
font.ensureDecompiled()
font.flavor = "woff2"
output = BytesIO()
font.save(output)
woff2_bytes = output.getvalue()
```

## Parent integration

In the parent-owned `apps/local/src/styles/global.css`, add the import at the
reserved `/* S.1 fonts */` contract, in the leading import section before
ordinary CSS rules:

```css
/* S.1 fonts */
@import "./fonts.css";
```

S.1 owns the font files, licenses, this provenance file, and `fonts.css`.
The parent owns the `global.css` import and integration verification.

## Playfair Display — U.4-TW, 2026-09-18

Self-hosted variable normal face, weights 400–900, Latin subset from Google Fonts v40.
The versioned source is
`https://fonts.gstatic.com/s/playfairdisplay/v40/nuFiD-vYSZviVYUb_rj3ij__anPXDTzYgA.woff2`.
It is stored verbatim as `playfair-display-latin.woff2` (38,404 bytes); other scripts use
the Georgia/serif fallback. The license is retained in `OFL-PlayfairDisplay.txt` from
Google Fonts commit `1e1aa08e994ff7db50116e86ccc7b52a4e4ae5b8`. No runtime CDN requests.

WOFF2 SHA-256: `e0c764a8e9e1cce92163c55bac4b2ad6cd4cf8c696ce2289ab5c41565e65b7e2`.
License SHA-256: `566be814f8e96e93dfa16101331557eb6b5467e9e03f627c0910fe93ca12300e`.
