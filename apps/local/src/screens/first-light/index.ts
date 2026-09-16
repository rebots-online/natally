// natally — first-light module (U.4). Exports the intake screen for the two
// journeys that mount it: J1 (first run, the wiring mounts it before any
// person exists) and J3 (add a person — PeopleScreen's Add seam re-uses the
// same intake, per SCREEN.md "Journeys").
//
// The frozen route set (U.1 router) has no path for this screen — "/", the
// conversation, is home, and "/people" serves the library — so nothing is
// registered here; the wiring layer (I.1) mounts FirstLightScreen directly
// with the real X.1 repo and P.4 compute bindings.

export {
  FirstLightScreen,
  type FirstLightScreenProps,
  type SunFact,
  sunFact,
} from "./first-light-screen";
export type {
  FirstLightCompute,
  InstantFact,
  IntakeAnswers,
  IntakeStep,
  PlaceSuggestion,
} from "./types";
