# screen-splash
**Intent:** mandatory app chrome on launch: product name, mark, full version string, copyright, and the real engine-load progress. Doubles as the loading state.
**Variants:** loading (progress bar = real ephemeris + model load fraction) · ready (transitions to screen-conversation).
**Content classes:** authored-static (name, copyright), computed-fact (version from `version.json`, progress fraction). No prose.
**Journeys:** J1 (first launch), every launch.

## Frames (Figma `natally v1`)

- `loading` — node `17:11` — https://www.figma.com/design/TmZDFVgkUeeL1VEYWtuaJL?node-id=17-11
- `ready` — node `17:22` — https://www.figma.com/design/TmZDFVgkUeeL1VEYWtuaJL?node-id=17-22
- `desktop` — node `17:33` — https://www.figma.com/design/TmZDFVgkUeeL1VEYWtuaJL?node-id=17-33
