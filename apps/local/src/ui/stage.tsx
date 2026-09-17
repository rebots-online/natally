import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import idleLoop from "../assets/mascot/natally-idle-400.webp";
import sourceLoop from "../assets/mascot/natally-source-loop.mp4";
import frameZero from "../assets/mascot/natally-still-400.png";
import { type CompanionBus, companionBus, type StageState } from "../companion/bus.js";

export interface StageProps {
  /** Omit to use C.4's shared bus; injected instances support isolated sessions. */
  bus?: CompanionBus;
  className?: string;
  style?: CSSProperties;
  /** A screen-owned plate. Stage supplies only its motion-aware entrance. */
  plate?: ReactNode;
}

const labels = {
  Idle: "Idle",
  Asleep: "Asleep — no model downloaded",
  Waking: "Waking — loading model",
  Listening: "Listening — composer focused",
  Thinking: "Thinking — awaiting response",
  Speaking: "Speaking",
  Delighted: "Delighted — chart computed",
  Error: "Error — companion unavailable",
} satisfies Record<StageState, string>;

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

function useStageSnapshot(bus: CompanionBus) {
  const subscribe = useCallback(
    (notify: () => void) => {
      let frame: number | undefined;
      let active = true;
      const watchLoading = () => {
        frame = undefined;
        if (!active) return;
        notify();
        if (bus.getSnapshot().state === "Waking") frame = requestAnimationFrame(watchLoading);
      };
      const unsubscribeState = bus.stageState$.subscribe((state) => {
        notify();
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = state === "Waking" ? requestAnimationFrame(watchLoading) : undefined;
      });
      // stageState$ emits only transitions. RMS levels and repeated errors/charts
      // still update the snapshot while retaining the same state.
      const unsubscribeEvents = [
        bus.subscribe("envelope-level", notify),
        bus.subscribe("error", notify),
        bus.subscribe("chart-computed", notify),
      ];
      return () => {
        active = false;
        unsubscribeState();
        for (const unsubscribe of unsubscribeEvents) unsubscribe();
        if (frame !== undefined) cancelAnimationFrame(frame);
      };
    },
    [bus],
  );
  // C.4 does not expose snapshot notifications for capability-only progress.
  // The Waking-only frame reader observes actual fractions; it never advances them.
  return useSyncExternalStore(subscribe, bus.getSnapshot, bus.getSnapshot);
}

const styles = `
.natally-stage { position: relative; isolation: isolate; color: var(--color-vellum, #eee5d5); font-size: 14px; }
.natally-stage__mascot { position: relative; width: min(100%, 400px); aspect-ratio: 1; margin-inline: auto; }
.natally-stage__pose, .natally-stage__media, .natally-stage__vectors { position: absolute; inset: 0; width: 100%; height: 100%; }
.natally-stage__media { object-fit: contain; }
.natally-stage__vectors { pointer-events: none; overflow: visible; }
.natally-stage__orb { position: absolute; left: 39.5%; top: 62.25%; width: 22.5%; height: 22.5%; border-radius: 50%; pointer-events: none; }
.natally-stage__swirl { position: absolute; inset: 0; border-radius: inherit; background: radial-gradient(ellipse at 30% 20%, #b7a3efaa, transparent 65%); }
.natally-stage__status { display: block; text-align: center; margin-block: 8px; }
.natally-stage__plate { position: relative; }
@keyframes natally-stage-swirl { to { transform: rotate(360deg); } }
@keyframes natally-stage-delight { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
@keyframes natally-stage-flash { 0%, 100% { opacity: 0; } 35% { opacity: 1; } }
@keyframes natally-stage-slide { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  .natally-stage *, .natally-stage *::before, .natally-stage *::after { animation: none !important; transition: none !important; }
  .natally-stage__pose, .natally-stage__orb, .natally-stage__mouth { transform: none !important; }
}
`;

/** U.9: a projection of C.4's StageSignal snapshot, with no synthetic state transitions. */
export function Stage({ bus = companionBus, className, style, plate }: StageProps) {
  const snapshot = useStageSnapshot(bus);
  const reducedMotion = useReducedMotion();
  const mascot = useRef<HTMLDivElement>(null);
  const [intersecting, setIntersecting] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "visible",
  );
  const [chartRevision, setChartRevision] = useState(0);
  const gradientId = useId();

  useEffect(() => {
    const update = () => setDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    update();
    if (typeof IntersectionObserver === "undefined") {
      setIntersecting(true);
      return () => document.removeEventListener("visibilitychange", update);
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === mascot.current) setIntersecting(entry.isIntersecting);
      }
    });
    if (mascot.current) observer.observe(mascot.current);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(
    () =>
      bus.subscribe("chart-computed", () => {
        if (bus.getSnapshot().state === "Delighted") setChartRevision((revision) => revision + 1);
      }),
    [bus],
  );

  const state = snapshot.state;
  const motion = !reducedMotion && intersecting && documentVisible;
  const paused = !motion || state === "Asleep" || state === "Waking" || state === "Error";
  const envelope = state === "Speaking" && motion ? snapshot.envelopeLevel : 0;
  const orbScale = 1 + 0.12 * envelope;
  const mouthFrame = envelope === 0 ? 0 : envelope < 0.5 ? 1 : 2;
  const brightness =
    state === "Waking"
      ? 0.55 + 0.45 * (snapshot.engineLoad ?? 0)
      : state === "Asleep" || state === "Error"
        ? 0.55
        : 1;
  const orbFilter = `brightness(${brightness}) saturate(${state === "Asleep" ? 0.4 : 1}) hue-rotate(${state === "Listening" ? 8 : 0}deg)`;
  const delight = state === "Delighted" && motion;

  return (
    <section
      className={["natally-stage", className].filter(Boolean).join(" ")}
      style={style}
      data-stage-state={state}
      data-reduced-motion={reducedMotion}
      aria-label="Companion stage"
    >
      <style>{styles}</style>
      <div
        ref={mascot}
        className="natally-stage__mascot"
        role="img"
        aria-label={`natally: ${labels[state]}`}
      >
        <div
          className="natally-stage__pose"
          style={{ transform: state === "Listening" && motion ? "rotate(2deg)" : "none" }}
        >
          <div
            key={chartRevision}
            className="natally-stage__pose"
            style={{ animation: delight ? "natally-stage-delight 600ms ease-in-out 1" : "none" }}
          >
            {state === "Thinking" && !paused ? (
              <video
                className="natally-stage__media"
                src={sourceLoop}
                poster={frameZero}
                muted
                loop
                autoPlay
                playsInline
                preload="auto"
                aria-hidden="true"
                tabIndex={-1}
                ref={(element) => {
                  if (element) element.playbackRate = 0.8;
                }}
              />
            ) : (
              <img
                className="natally-stage__media"
                src={paused ? frameZero : idleLoop}
                width={400}
                height={400}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
            )}
            <div
              className="natally-stage__orb"
              data-stage-orb=""
              data-envelope={snapshot.envelopeLevel}
              style={{
                transform: `scale(${orbScale})`,
                backdropFilter: orbFilter,
                WebkitBackdropFilter: orbFilter,
                boxShadow: state === "Speaking" ? "0 0 18px 4px #b7a3ef88" : "none",
              }}
            >
              {state === "Thinking" && (
                <span
                  className="natally-stage__swirl"
                  style={{ animation: motion ? "natally-stage-swirl 6s linear infinite" : "none" }}
                />
              )}
            </div>
            <svg
              className="natally-stage__vectors"
              viewBox="0 0 400 400"
              aria-hidden="true"
              focusable="false"
            >
              {/* New vector compositions from STATES.md, not footage or claimed Figma exports. */}
              <defs>
                <radialGradient id={gradientId}>
                  <stop stopColor="#b7a3ef" stopOpacity="0" />
                  <stop offset="1" stopColor="#b7a3ef" stopOpacity="0.6" />
                </radialGradient>
              </defs>
              {state === "Asleep" && (
                <g data-stage-overlay="Asleep" fill="#bcb2a1" stroke="#645454" strokeWidth="3">
                  <path d="M137 184 Q157 168 176 184 L175 204 Q156 216 138 202 Z" />
                  <path d="M230 184 Q249 168 266 184 L266 202 Q248 216 230 204 Z" />
                  <path d="M139 201 Q157 212 175 201 M231 201 Q248 212 265 201" fill="none" />
                </g>
              )}
              {state === "Waking" && (
                <circle
                  data-stage-overlay="Waking"
                  cx="203"
                  cy="294"
                  r="46"
                  fill="none"
                  stroke="#d7b978"
                  strokeWidth="2"
                  pathLength="1"
                  strokeDasharray={`${snapshot.engineLoad ?? 0} 1`}
                  transform="rotate(-90 203 294)"
                />
              )}
              {state === "Listening" && (
                <path
                  data-stage-overlay="Listening"
                  d="M280 179 Q300 197 280 215"
                  fill="none"
                  stroke="#b7a3ef"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              )}
              {state === "Speaking" && (
                <g data-stage-overlay="Speaking">
                  <circle
                    cx="203"
                    cy="294"
                    r="46"
                    fill={`url(#${gradientId})`}
                    stroke="#b7a3ef"
                    style={{ transform: `scale(${orbScale})`, transformOrigin: "203px 294px" }}
                  />
                  <path
                    className="natally-stage__mouth"
                    data-mouth-frame={mouthFrame}
                    d={
                      mouthFrame === 0
                        ? "M190 224 Q202 232 214 224"
                        : mouthFrame === 1
                          ? "M190 224 Q202 229 214 224 Q202 236 190 224 Z"
                          : "M190 224 Q202 230 214 224 Q202 239 190 224 Z"
                    }
                    fill={mouthFrame === 0 ? "none" : "#382e3c"}
                    stroke="#382e3c"
                    strokeWidth="2"
                    style={{ transform: `scaleY(${1 + envelope})`, transformOrigin: "202px 224px" }}
                  />
                </g>
              )}
              {state === "Delighted" && (
                <circle
                  data-stage-overlay="Delighted"
                  cx="200"
                  cy="200"
                  r="185"
                  fill="none"
                  stroke="#d7b978"
                  strokeWidth="4"
                  style={{
                    opacity: motion ? 0 : 1,
                    animation: delight ? "natally-stage-flash 600ms ease-out 1" : "none",
                  }}
                />
              )}
              {state === "Error" && (
                <path
                  data-stage-overlay="Error"
                  d="M205 251 L196 272 L212 285 L199 306 L208 337"
                  fill="none"
                  stroke="#d7b978"
                  strokeWidth="3"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </div>
        </div>
      </div>
      <span className="natally-stage__status" role="status" aria-live="polite" aria-atomic="true">
        {labels[state]}
      </span>
      {plate != null && (
        <div
          className="natally-stage__plate"
          data-stage-plate=""
          style={{ animation: reducedMotion ? "none" : "natally-stage-slide 220ms ease-out 1" }}
        >
          {plate}
        </div>
      )}
    </section>
  );
}
