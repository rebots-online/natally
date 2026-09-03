# screen-splash
**Intent:** mandatory app chrome on launch: product name, mark, full version string, copyright, and the real engine-load progress. Doubles as the loading state.
**Variants:** loading (progress bar = real ephemeris + model load fraction) · ready (transitions to screen-conversation).
**Content classes:** authored-static (name, copyright), computed-fact (version from `version.json`, progress fraction). No prose.
**Journeys:** J1 (first launch), every launch.
**Frame ids:** see STATE-LEDGER.json `screens.screen-splash`.
