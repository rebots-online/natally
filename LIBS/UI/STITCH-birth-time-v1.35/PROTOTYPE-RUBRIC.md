# Birth-time prototype observation rubric

Precommitted before local adaptation and browser observation, 2026-10-05.
Scope: isolated time-step HTML prototype; no natal calculation, persistence,
model inference, or companion output is implemented or claimed here.
Authority: Robin's explicit Figma → Stitch → working HTML instruction and
2026-10-05 no-unit/no-smoke rule. Observe real UI, archive viewport screenshots
and a continuous screencast. No test suite, synthetic assertion runner or smoke
script. Inspect screenshot content before recording a result.

1. **BT-P1 Empty input:** initial time unspecified; Begin disabled. Open editor;
   hour/minute blank and Set time disabled until a complete deliberate input.
2. **BT-P2 Typed time:** select Type time; actual hour field receives focus.
   Enter 4, 17, PM; Set time commits 16:17. Begin becomes available only after
   commit. Press Begin; visible result is only the user's confirmed time.
3. **BT-P3 Invalid and incomplete:** reopen, enter hour 13 and minute 60;
   Set time disabled. Clear a field; switch Clock/Type; no stale valid fallback.
   Begin stays disabled during editing. Correct fields; valid draft can commit.
4. **BT-P4 Cancel:** change a committed value, Cancel, reopen; prior committed
   value remains. Cancel an initial uncommitted selection and reopen; blank again.
5. **BT-P5 Clock:** select hour 4, minute 15, increase twice, PM; Set time produces
   16:17. Show exact-minute state and visible Set time at mobile width.
6. **BT-P6 Day boundary:** deliberate 12:00 AM commits 00:00; deliberate 12:00 PM
   commits 12:00. No inferred default enters the committed value.
7. **BT-P7 Unknown:** check unknown; Begin enabled, time control unavailable,
   no known-time result remains visible. Begin shows only birth time unknown.
   Uncheck; restore prior confirmed time if present, otherwise empty/disabled.
8. **BT-P8 Layout and keyboard:** observe at 390×844 and 320×568, then desktop;
   no horizontal clipping, controls visibly reachable via scrolling; keyboard
   focus visible. Reduced motion stops decorative blinking. On a real Android
   device, tap typed input and observe OS keyboard plus reachable Set/Cancel.
   Desktop viewport resizing does not prove Android keyboard behavior.
9. **BT-P9 Content:** visible and hidden panels contain no fabricated birth
   facts, UTC/ephemeris claims, charts, chat replies, mock keyboard or release
   badge. Figma and Stitch identifiers remain outside product UI.

Evidence report: `dist/rubric-runs/birth-time-prototype-20261005/REPORT.md`.
Use one viewport still per material state, not a long full-page composite.
Record timecodes and seek links for the real screencast. Each row must separate
observed behavior from unobserved device behavior. No production SHIP-READY
verdict can follow from this isolated prototype. Any unobserved mandatory
prototype item keeps its rubric verdict DEFECTIVE.
