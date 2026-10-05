# Birth-time prototype rubric observations — 2026-10-05

**Evidence classification:** design-prototype observations only. The static HTTP
server served the exported HTML artifact, not a Vite development process and
not the built Natally application. These files do **not** satisfy TC11's built-app
release gauntlet, regardless of their archive location or use of rubric rows.
The production gauntlet is unrun. No release acceptance or production completion
may be inferred from these recordings. This clarification changes no observation.

**Prototype verdict: DEFECTIVE** under the precommitted rubric's rule that a
mandatory unobserved item prevents completion: BT-P8 Android keyboard behavior
has not been observed. The desktop/browser portion worked in the journeys below.
No integrated-product SHIP-READY verdict is asserted; no production source changed.

Artifact: `LIBS/UI/STITCH-birth-time-v1.35/index.html`, SHA-256
`0d7611da003e579847071e79dfbf32a6a32eda4a7913fea19ec571d25cb6e804`.
Driver: Codex using the supported in-app browser on asrock, local HTTP server
127.0.0.1:43827. Viewports: 390×844, 320×568, 1200×900. Rubric precommit `c3f834f`.
No unit, smoke, assertion or conformance suite was run. Browser interaction and
DOM snapshots accompanied direct visual inspection of each cited screenshot.

## Observations

| ID | Requirement / driver | Observed result and exact evidence | Severity |
|---|---|---|---|
| BT-P1 | Empty input / browser | Initial Begin disabled, blank draft, Set disabled. [Initial](01-empty.png), [empty clock](14-cancel-empty.png); clips 01 and 04. | BLOCKER |
| BT-P2 | Typed time / browser | Type time focuses a real hour input; entered 4:17 PM, Set commits, Begin shows **16:17 (04:17 PM)** and disables repeat submission. [Typed](03-typed-0417-pm.png), [submitted](04-confirmed-1617.png); clip 01. | BLOCKER |
| BT-P3 | Invalid/incomplete / browser | 13:60 disables Set, survives mode switches; clearing hour remains incomplete; Begin disabled while editing. [Invalid](05-invalid.png), [retained](06-invalid-retained.png), [incomplete](07-incomplete-retained.png); clip 02. | BLOCKER |
| BT-P4 | Cancel / browser | Invalid edit canceled then reopened restores 4:17 PM; uncommitted clock selection canceled then reopened is blank. [Restored](08-cancel-restored.png), [empty](14-cancel-empty.png); clips 02 and 04. | HIGH |
| BT-P5 | Exact-minute clock / browser | Real circular buttons: hour 4, minute 15, +1 twice, PM; committed result 16:17. [Clock](13-clock-0417.png), [submitted](15-clock-confirmed.png), [actions reachable at 320px](20-clock-actions-320.png); clips 04 and 06. | BLOCKER |
| BT-P6 | Midnight/noon / browser | 12:00 AM → **00:00**, 12:00 PM → **12:00**. [Midnight](09-midnight.png), [noon](10-noon.png); clip 03. | HIGH |
| BT-P7 | Unknown / browser | Explicit unknown disables time entry and permits Begin; result only “Birth time unknown”. Unchecking restores committed noon, or an empty disabled state when none exists. [Unknown](11-unknown.png), [known restored](12-known-restored.png), [no prior time](19-unknown-unchecked-empty.png); clips 03 and 05. | BLOCKER |
| BT-P8 | Responsive/keyboard / browser + actual Android | At 320px dial and typing fit; scrolling/Tab reaches visible Cancel/Set; desktop arrow focus moves 12→1; reduced-motion caret animation is none. [Narrow clock](16-clock-320.png), [visible actions/focus](18-keyboard-focus.png), [desktop keyboard](21-desktop-keyboard-clock.png), [desktop typing](22-desktop-type.png). **Actual Android keyboard unobserved**: `adb devices -l` returned an empty device list. Resize is not device evidence. | BLOCKER |
| BT-P9 | Content / browser + source review | Active index's clock, type, unknown and outcome panels contain only interface labels or actual user input; no release badge, fake keyboard, ephemeris/UTC claims, chart or companion transcript. Raw rejected source is preserved as provenance, explicitly excluded from runnable entrypoints. | HIGH |

## Screencast index

These are continuous CDP screencast segments of the actual browser interactions,
encoded with the captured frame timestamps. They are **not still-image slideshows**.
Each segment covers a complete driven journey; gaps between tool calls/commentary
are omitted by stopping and restarting recording. Thus this is a segmented
prototype observation, not a continuous full-product release gauntlet.
Recordings are real-time and short; pause at the linked stills for legible review.

| Clip / seek link | Timecode range | Journey |
|---|---|---|
| [01](01-empty-and-typed.mp4#t=0,2) | 00:00–00:02.00 | Initial empty → typing → commit → 16:17 |
| [02](02-invalid-and-cancel.mp4#t=0,3.4) | 00:00–00:03.40 | Invalid → switch modes → incomplete → cancel/restore |
| [03](03-boundaries-and-unknown.mp4#t=0,4) | 00:00–00:04.00 | Midnight → noon → unknown → restored known time |
| [04](04-clock-and-empty-cancel.mp4#t=0,4.8) | 00:00–00:04.80 | Clock → Cancel blank → clock → 16:17 |
| [05](05-narrow-layout.mp4#t=0,2.28) | 00:00–00:02.28 | 320px layouts / keyboard focus / unknown without prior time |
| [06](06-clock-actions-and-desktop.mp4#t=0,2.88) | 00:00–00:02.88 | Reachable clock actions / desktop arrows / reduced motion |

`segments.json` records encoded duration/size. Each segment directory contains
the real JPEG frames, timestamp log, and ffconcat manifest. No frames were
fabricated. Videos are letterboxed to 1200×900 for consistent playback.

The first attempt allowed a recorder to outlive its browser-tool call; a later
raw-CDP command was denied because the browser's origin-policy check was
unavailable. `frames/interrupted-recording.json` preserves that error and its two
frames. It is excluded from acceptance evidence. Retrying through the same
supported interface with recording contained inside each awaited tool call
succeeded for all six segments (55, 94, 119, 139, 68, 65 frames, no recorded errors).
No browser security controls were disabled or bypassed. Viewport and media
overrides were reset after observation.

Precision about the retry: the same raw-CDP capability was used through the
documented browser interface. The supported stop command then succeeded, and
subsequent start/frame/ack/stop commands were accepted within awaited calls.
Those successful responses establish permission for those individual commands;
they do not establish the root cause of the earlier policy-check failure. The
review's later phrase “no raw-CDP path was retried” is inaccurate.

## Remaining acceptance

Connect the actual Android device and use this same prototype: open Type time,
observe its real software keyboard, enter a value, reach Set/Cancel with the
keyboard present, and capture the complete sequence. Production integration
then requires the original Natally full rubric, including the chart and companion
journeys; the isolated time editor cannot certify those systems.

Attestation: Codex observed the cited browser screenshots and driven behaviors
on asrock on 2026-10-05. Positive statements above refer only to those exact
observations. Android behavior, production deployment/integration, model replies,
voice and persistence are not established by this record.
