# Original Natally birth-time prototype

Open `index.html` through a local static server. The current session serves it at
http://127.0.0.1:43827/ on asrock. To start it elsewhere from this directory:

```sh
python3 -m http.server 43827 --bind 127.0.0.1
```

This is the isolated time-step prototype, not a deployed app release. Use the
Clock or Type time controls, explicitly choose AM/PM, then Set time and Begin.
Begin displays only the time actually entered, or explicit unknown, and emits
`birth-time-submit` on `document` with `{time: string|null, unknownTime: boolean}`.
It does not calculate a chart, store a person, or start a companion conversation.

Source sequence: original Figma frame → Google Stitch screen → adapted HTML.
Exact identifiers and hashes are in `SOURCE.json`; design constraints in
`DESIGN.md`; future production bindings in `DOCS/ARCHITECTURE.md §23`.

- `index.html`: runnable, adapted refined export; all fonts are local.
- `stitch-refined-source.html.txt`: byte-for-byte refined Stitch download.
- `stitch-export.html`: rejected first-generation source, retained for provenance;
  do not use as a preview entrypoint. It contains unsupported copy and draft bugs
  removed by the refined export. Preview images also preserve their source state.
- `figma-time-unknown.png`: retrieved original reference, not the newer layout.
- `PROTOTYPE-RUBRIC.md`: precommitted visual/interaction requirements.

Evidence: `dist/rubric-runs/birth-time-prototype-20261005/REPORT.md` from repo root.
Desktop/mobile-width browser journeys observed; actual Android keyboard remains
unverified. No unit or smoke tests were run for this prototype.

Production integration and 1.35 checklist are not delivered here. Robin requires
the current build deployed to natally.surge.sh first; Surge rejected this host's
account because it does not own that domain. See `DOCS/DELIVERY-2026-10-05.md`.
