# screen-first-light
**Intent:** first-run conversation. natally asks for name, birth date, birth place (snap-to-city), birth time (or "I don't know"). Each answer returns a computed fact the moment it can be computed (Sun sign after the date; Ascendant after time + place). A privacy explainer sits under each question: what it is used for, what it is computed with, that it stays on the device.
**Variants:** name · date (+ Sun fact) · place (city dropdown) · time unknown (solar-chart note: no rising sign, no houses, planets still exact).
**Content classes:** authored-static (questions, explainers), computed-fact (the reward line), generated slot marked at runtime only. No progress bar (it is a conversation).
**Journeys:** J1, J3 (add a person reuses the same intake).
