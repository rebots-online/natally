# screen-checkout
**Intent:** the handoff surface while a purchase is in flight, or the manual unlock. TopBar (chip "Checkout") · Stage (Thinking while waiting, Idle for outcomes) · her aside · state body · one action. D11.
**Variants:** handoff (desktop/web hosted redirect: `[QR · runtime]` block + `[checkout link · runtime]` + "Open the page again" + license-key note) · iap-waiting (Android store sheet above; Cancel) · success (aside "Unlocked. Unlimited from here —"; gilt "Back to our conversation") · failure (ember-stroked reason card `[reason · runtime]`; Try again) · offline (honest absence card "No connection"; Try again) · enter-license-key (input `[license key · runtime]`, helper "Keys look like NATALLY-XXXX-XXXX-XXXX.", gilt "Unlock with key").
**Content classes:** computed facts (checkout link, reason — runtime markers), authored-static labels/helpers, honest absence (offline). No fake payment states: the frames carry runtime markers, never sample prose.
**Journeys:** J10.

## Frames (Figma `natally v1`, page `screen-checkout` 48:2)

- `handoff` — node `48:3` — https://www.figma.com/design/TmZDFVgkUeeL1VEYWtuaJL?node-id=48-3
- `iap-waiting` — node `48:25` — https://www.figma.com/design/TmZDFVgkUeeL1VEYWtuaJL?node-id=48-25
- `success` — node `48:42` — https://www.figma.com/design/TmZDFVgkUeeL1VEYWtuaJL?node-id=48-42
- `failure` — node `48:58` — https://www.figma.com/design/TmZDFVgkUeeL1VEYWtuaJL?node-id=48-58
- `offline` — node `48:77` — https://www.figma.com/design/TmZDFVgkUeeL1VEYWtuaJL?node-id=48-77
- `enter-license-key` — node `48:96` — https://www.figma.com/design/TmZDFVgkUeeL1VEYWtuaJL?node-id=48-96
