import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type CompanionBus, companionBus, type StageSnapshot } from "../../companion/bus.js";
import "./splash.css";

const motionQuery = "(prefers-reduced-motion: reduce)";
const freezeOnServer = () => true;

function useReducedMotion() {
  const [query] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(motionQuery)
      : null,
  );
  const subscribe = useCallback(
    (notify: () => void) => {
      query?.addEventListener("change", notify);
      return () => query?.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => query?.matches ?? true, freezeOnServer);
}

// Mirrors ui/stage.tsx's store shape without adding a second navigation or signal
// source; the capability snapshot is the single source the splash paces by.

export interface SplashProps {
  /** Omit to use C.4's shared bus; injected instances support isolated sessions. */
  bus?: CompanionBus;
  /** Called once when the full text is revealed AND a real capability is ready. */
  onComplete?: () => void;
  /** The big bold Fraunces display line the typewriter reveals (D21). */
  title?: string;
  tagline?: string;
}

type CapabilityReading = Readonly<{
  chars: number;
  ready: boolean;
  engineLoad: number | null;
  modelPresent: boolean | null;
  error: string | null;
}>;

/**
 * The typewriter law: characters advance only when a real capability-signal
 * value changes. The reader observes the bus snapshot (C.4's StageSignal
 * projection — engine/model load progress, model presence); it never advances a
 * fraction and never fabricates one. A stalled load therefore shows an honest
 * stall: the same number of characters, frame after frame, until a real event
 * moves the fraction.
 */
function useCapabilityReading(bus: CompanionBus, totalChars: number): CapabilityReading {
  const [reading, setReading] = useState<CapabilityReading>(() => ({
    chars: 0,
    ready: false,
    engineLoad: null,
    modelPresent: null,
    error: null,
  }));

  useEffect(() => {
    let active = true;
    let frame: number | undefined;
    let last: CapabilityReading | null = null;

    const derive = (): CapabilityReading => {
      const snapshot: StageSnapshot = bus.getSnapshot();
      const engineLoad = snapshot.engineLoad;
      const modelPresent = snapshot.modelPresent;
      // The character count is a pure function of the observed fraction (or an
      // observed presence) — never of elapsed time.
      const chars =
        engineLoad !== null
          ? Math.min(Math.floor(engineLoad * totalChars), totalChars)
          : modelPresent
            ? totalChars
            : 0;
      const ready = modelPresent === true || engineLoad === 1;
      return {
        chars,
        ready,
        engineLoad,
        modelPresent,
        error: snapshot.error,
      };
    };

    const tick = () => {
      frame = undefined;
      if (!active) return;
      const current = derive();
      if (
        last === null ||
        current.chars !== last.chars ||
        current.ready !== last.ready ||
        current.engineLoad !== last.engineLoad ||
        current.modelPresent !== last.modelPresent ||
        current.error !== last.error
      ) {
        last = current;
        setReading(current);
      }
      // Keep observing until a real capability is ready; the loop only reads.
      if (!current.ready) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    // State transitions arm an immediate re-read so completions are not held
    // to the next animation frame boundary.
    const unsubscribeState = bus.stageState$.subscribe(() => {
      if (frame === undefined && active) frame = requestAnimationFrame(tick);
    });
    return () => {
      active = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      unsubscribeState();
    };
  }, [bus, totalChars]);

  return reading;
}

/**
 * U.8: onboarding splash. D21 typewriter over big bold Fraunces display type,
 * paced strictly by real capability signals (§18.1's law as applied to the
 * splash: no timers, no fabricated progress). Reduced motion renders the full
 * text statically but still gates completion on the same real signals.
 */
export function Splash({
  bus = companionBus,
  onComplete,
  title = "natally",
  tagline = "Your sky, read in conversation. Everything stays on this device.",
}: SplashProps) {
  const totalChars = title.length;
  const reading = useCapabilityReading(bus, totalChars);
  const reducedMotion = useReducedMotion();
  const completed = useRef(false);

  const shown = reducedMotion ? totalChars : reading.chars;

  useEffect(() => {
    if (!onComplete || completed.current) return;
    if (shown === totalChars && reading.ready) {
      completed.current = true;
      onComplete();
    }
  }, [onComplete, shown, totalChars, reading.ready]);

  const status = reading.error
    ? reading.error
    : reading.engineLoad !== null && reading.engineLoad < 1
      ? `Waking the companion — ${Math.round(reading.engineLoad * 100)}%`
      : reading.ready
        ? "natally is ready."
        : reading.modelPresent === false
          ? "The companion model isn't on this device yet."
          : "Waiting for the device to report its capabilities…";

  return (
    <section className="splash" data-reduced-motion={reducedMotion} aria-label="Welcome">
      <h1 className="splash__title">
        <span className="splash__typed" aria-hidden="true">
          {title.slice(0, shown)}
        </span>
        <span className="splash__caret" aria-hidden="true" data-done={shown === totalChars} />
        <span className="splash__sr">{title}</span>
      </h1>
      <p className="splash__tagline">{tagline}</p>
      <p className="splash__status" role="status">
        {status}
      </p>
    </section>
  );
}

export default Splash;
