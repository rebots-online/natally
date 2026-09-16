// natally — splash seams (U.8). Structural dependency-injection types for the
// launch screen; the screen itself owns no engine, no store and no router.
//
// SplashEngineEvents is the mount-event seam the splash binds its progress to.
// `packages/ephemeris/src/host/protocol.ts` (P.3's {id, op, params}/{id, ok,
// result} protocol) does not exist yet, so per the task notes this seam is
// designed here and documented for wiring: P.3's host adapters it by calling
// `subscribe(fn)` and emitting one event per real table mount, exactly the
// shape below — the splash renders pct only when the source provides it and
// never invents a fraction (ARCHITECTURE.md §12, INC-19).

export type SplashEngineEvent =
  | { readonly stage: "mounting"; readonly table: string; readonly pct?: number }
  | { readonly stage: "mounted"; readonly table: string; readonly pct?: number }
  /** Terminal: every table is mounted; the splash routes by people count. */
  | { readonly stage: "ready" };

/** Subscription seam: returns the unsubscribe function. */
export type SplashEngineEvents = {
  readonly subscribe: (fn: (event: SplashEngineEvent) => void) => () => void;
};

/**
 * The documented default until P.3 is wired (I.1): a source that never emits.
 * The splash then renders honest absence — indeterminate bar, no pct, no
 * routing — and fakes no progress while the engine seam is unbound.
 */
export function createSilentEngineEvents(): SplashEngineEvents {
  return {
    subscribe: () => () => {},
  };
}

/** The X.1 people-count seam: how many charts exist (0 ⇒ first light, J1). */
export type CountPeople = () => number;

/** SCREEN.md variants: the two device classes in the frozen frame set. */
export type SplashVariant = "mobile" | "desktop";

export type SplashScreenProps = {
  /**
   * The engine mount-event source — progress binds ONLY to these events.
   * Default: the silent source above (honest indeterminate until wired).
   */
  readonly engineEvents?: SplashEngineEvents;
  /** People count (X.1). Default: () => 0 — the conservative J1 posture. */
  readonly countPeople?: CountPeople;
  /** Ready with no people. Default no-op: first-light has no route; I.1
   *  mounts the intake screen directly (see screens/first-light/index.ts). */
  readonly onFirstLight?: () => void;
  /** Ready with ≥1 person. Default: hash navigation to "/" — the one
   *  navigation system over the frozen route set (U.1 router). */
  readonly onConversation?: () => void;
  /** Frozen frame set: loading / ready / desktop. Default: "mobile". */
  readonly variant?: SplashVariant;
  /** Override for tests; production renders the stamped artifact version. */
  readonly version?: string;
};
