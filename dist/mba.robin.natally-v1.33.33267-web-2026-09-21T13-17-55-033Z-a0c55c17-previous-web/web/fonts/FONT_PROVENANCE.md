# FONT_PROVENANCE.md — S.1 font provenance

Every woff2 under `apps/local/public/fonts/` is documented here: family, file,
source URL, license, download date. Sources are the OFL originals — the same
SIL Open Font License 1.1 families the operator's Figma set uses. No operator
font bundle exists in-repo (architect ruling, 2026-09-16): the sanctioned source
is the OFL originals in `github.com/google/fonts`
(`ofl/fraunces`, `ofl/nunitosans`, `ofl/ibmplexmono`).

All six files are **static instanced latin-subset woff2** (not the full variable
fonts): fetched on 2026-09-16 from `fonts.gstatic.com` via the Google Fonts
CSS2 API with a static-instancing user agent, at the fixed weights/styles below.
Each file starts with the `wOF2` magic bytes. Files are self-hosted and served
from `public/fonts/` — no CDN imports, ever (§3 fonts law).

## Files

| # | Family | File | Style | Bytes | sha256 | Source URL | License | Downloaded |
|---|--------|------|-------|-------|--------|------------|---------|------------|
| 1 | Fraunces | `fraunces-semibold-latin.woff2` | normal 600 (SemiBold) | 18096 | `3a1de7711d147bad4422825045f87597fd77cca72e7c96d3b0a81735d00dda82` | https://fonts.gstatic.com/s/fraunces/v38/6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib1603gg7S2nfgRYIcaRyTCf7T.woff2 | OFL-1.1 | 2026-09-16 |
| 2 | Fraunces | `fraunces-italic-latin.woff2` | italic 400 (the unqualified "Italic" slot in the spec; regular italic, not semibold-italic) | 22852 | `475b154af19c6b4ef371db22078b5044a078ce2467e11ef22a7b87f77837caf3` | https://fonts.gstatic.com/s/fraunces/v38/6NVf8FyLNQOQZAnv9ZwNjucMHVn85Ni7emAe9lKqZTnbB-gzTK0K1ChJdt9vIVYX9G37lvd9sPEKsxx664UJf1hLTc7RrU8.woff2 | OFL-1.1 | 2026-09-16 |
| 3 | Nunito Sans | `nunitosans-regular-latin.woff2` | normal 400 | 13892 | `d9976dd1dc9c0d65046b52810e7cc69cfc229ee9939628ffe637e17efe4ef1ed` | https://fonts.gstatic.com/s/nunitosans/v19/pe1mMImSLYBIv1o4X1M8ce2xCx3yop4tQpF_MeTm0lfGWVpNn64CL7U8upHZIbMV51Q42ptCp5F5bxqqtQ1yiU4G1ilXs1Ul.woff2 | OFL-1.1 | 2026-09-16 |
| 4 | Nunito Sans | `nunitosans-semibold-latin.woff2` | normal 600 (SemiBold) | 14008 | `e03e312b8b7abd8b69ecef4060ded626f80e45723becd13676ad8273cf568a6e` | https://fonts.gstatic.com/s/nunitosans/v19/pe1mMImSLYBIv1o4X1M8ce2xCx3yop4tQpF_MeTm0lfGWVpNn64CL7U8upHZIbMV51Q42ptCp5F5bxqqtQ1yiU4GCC5Xs1Ul.woff2 | OFL-1.1 | 2026-09-16 |
| 5 | IBM Plex Mono | `ibmplexmono-regular-latin.woff2` | normal 400 | 14708 | `08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7` | https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2 | OFL-1.1 | 2026-09-16 |
| 6 | IBM Plex Mono | `ibmplexmono-medium-latin.woff2` | normal 500 (Medium) | 14888 | `01d285447409c8a588692162439a038b8cbd7871309ee20267b0d2d91c6e8e22` | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgg.woff2 | OFL-1.1 | 2026-09-16 |

## CSS2 API queries used (reproducibility)

- `family=Fraunces:opsz,wght@9..144,600`
- `family=Fraunces:ital,opsz,wght@1,9..144,400`
- `family=Nunito+Sans:opsz,wght@6..12,400`
- `family=Nunito+Sans:opsz,wght@6..12,600`
- `family=IBM+Plex+Mono:wght@400`
- `family=IBM+Plex+Mono:wght@500`

Each query was requested with `display=swap`; the `/* latin */` subset URL was
extracted from the response and downloaded. Coverage of the latin subset:
U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,
U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212,
U+2215, U+FEFF, U+FFFD. Glyphs outside the subset fall back to the system
stack — acceptable for v1; no CDN fetch is ever performed.

## Licenses

- Fraunces — SIL Open Font License 1.1 (upstream: `github.com/google/fonts/ofl/fraunces`, OFL.txt).
- Nunito Sans — SIL Open Font License 1.1 (upstream: `github.com/google/fonts/ofl/nunitosans`, OFL.txt).
- IBM Plex Mono — SIL Open Font License 1.1 (upstream: `github.com/google/fonts/ofl/ibmplexmono`, OFL.txt).

License text not redistributed in-repo; it is verbatim at the upstream paths
above. If any file is ever regenerated, update its row (URL, sha256, date) —
never substitute a different family (task S.1 law).
