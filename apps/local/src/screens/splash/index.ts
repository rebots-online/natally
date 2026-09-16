// natally — splash module (U.8). Exports the launch screen for the wiring
// layer. Nothing is registered here: the frozen route set (U.1 router) has no
// splash path — "/" is the conversation (DESIGN.md "Layout"), and the splash
// is mandatory launch chrome that routes AWAY to conversation or first-light
// once the engine is ready, after which it unmounts. I.1 mounts it directly,
// the same posture screens/first-light documents for its route-less screen.

export { default, SplashScreen } from "./splash-screen";
export {
  type CountPeople,
  createSilentEngineEvents,
  type SplashEngineEvent,
  type SplashEngineEvents,
  type SplashScreenProps,
  type SplashVariant,
} from "./types";
