// natally — U.4 injected seams for the first-light intake (ARCHITECTURE.md §5,
// §6; SCREEN.md screen-first-light). Everything a screen needs that another
// task owns arrives as a structural prop: the wiring layer mounts the screen
// with the real instances later (J1 first run; J3 add-a-person), and the
// screen never imports their modules. Shapes are structural, not re-exports —
// P.4's builder and the §6 engine seam stay behind this interface.

import type { ChartFacts } from "@natally/ephemeris/types";
import type { Person } from "@natally/lore/types";
import type { GlyphName } from "../../ui/glyphs";

/** The four intake questions, in frozen conversation order (SCREEN.md frames). */
export type IntakeStep = "name" | "date" | "place" | "time";

/** The answers given so far; a key is absent until its step is answered. */
export type IntakeAnswers = {
  readonly name?: string;
  /** Civil birth date, ISO-8601 `YYYY-MM-DD` (§5 Person.birth.date). */
  readonly date?: string;
  /** Chosen place label (§5 Person.birth.place — the wiring resolves coordinates). */
  readonly place?: string;
  /** Local birth time `HH:MM` — present only on the known-time branch. */
  readonly time?: string;
  /** False ⇒ the solar-chart branch (J1/J3: no Ascendant, no houses). */
  readonly timeKnown?: boolean;
};

/**
 * One instant fact under an answer (SCREEN.md: "a computed fact the moment it
 * can be computed"). `provenance` follows INC-19: `computed` renders as Plex
 * Mono engine material; `absence` is the honest "an answer alone yields
 * nothing (yet)" note and renders in the aside treatment — never as a fact.
 */
export type InstantFact = {
  readonly provenance: "computed" | "absence";
  readonly text: string;
  /** Sign/body glyph from the frozen set when the fact is a sign (e.g. the Sun sign). */
  readonly glyph?: GlyphName;
};

/**
 * One snap-to-city suggestion for the place step's dropdown (SCREEN.md place
 * frame). The wiring owns the gazetteer; the screen only offers the labels.
 */
export interface PlaceSuggestion {
  readonly label: string;
}

/**
 * The compute seam (P.4 `buildFacts` over the §6 EphemerisEngine, wired
 * downstream). The screen computes no astronomy itself — every degree it
 * shows arrives through these two calls.
 */
export interface FirstLightCompute {
  /**
   * The fact (or honest absence note) for the just-answered step, given the
   * answers accumulated so far — honest about what an answer ALONE yields.
   */
  instantFact(step: IntakeStep, answers: IntakeAnswers): InstantFact;
  /** The first ChartFacts for the completed person (§5/§6; solar ⇒ no cusps). */
  chartFacts(person: Person): Promise<ChartFacts>;
}
