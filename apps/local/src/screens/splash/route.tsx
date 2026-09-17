import { type ComponentType, useCallback } from "react";
import type { RouteScreenProps } from "../../ui/router.js";
import { Splash } from "./Splash.js";

/**
 * Route adapter for the splash (D21 onboarding). Navigation routes through the
 * hash router — the existing post-splash surface is `/` (the conversation).
 * Registration itself belongs to the generated route registry (I.1); this file
 * is the screen-side adapter only, and regenerating the registry never edits it.
 */
const SplashRouteScreen: ComponentType<RouteScreenProps> = () => {
  const complete = useCallback(() => {
    window.location.hash = "#/";
  }, []);
  return <Splash onComplete={complete} />;
};

export default SplashRouteScreen;
