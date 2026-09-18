import {
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import sourceLoop from "../assets/mascot/natally-source-loop.mp4";
import frameZero from "../assets/mascot/natally-still-400.png";
import {
  type CompanionBus,
  companionBus,
  type StageSnapshot,
  type StageState,
} from "../companion/bus.js";
import { behaviorForState, type IdleBehavior } from "./mascot-behaviors.js";
import { IdleBehaviorVignette } from "./mascot-vignettes.js";

export interface StageProps {
  /** Omit to use C.4's shared bus; injected instances support isolated sessions. */
  bus?: CompanionBus;
  className?: string;
  style?: CSSProperties;
  /** A screen-owned plate. Stage supplies only its motion-aware entrance. */
  plate?: ReactNode;
  /** U.9 §18.2: the sprite MascotRenderer is pluggable; this is the default. */
  renderer?: MascotRenderer;
}

/**
 * §18.2 sprite MascotRenderer contract. The renderer owns the character art
 * (media + authored overlays); the Stage owns signal reduction, motion gating
 * and the surrounding chrome, so renderers stay swappable and no renderer can
 * fabricate a state transition.
 */
export interface MascotRendererProps {
  readonly state: StageState;
  readonly snapshot: StageSnapshot;
  /** Combined gate: reduced-motion × intersection × document visibility. */
  readonly motion: boolean;
}
export type MascotRenderer = ComponentType<MascotRendererProps>;

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
.natally-stage__mascot { position: relative; width: min(100%, 400px); aspect-ratio: 1; margin-inline: auto; border-radius: 50%; overflow: hidden; }
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
@keyframes natally-stage-asleep-eyes { 0%, 55%, 100% { transform: translateY(0); } 65%, 85% { transform: translateY(2.5px); } 75% { transform: translateY(1px); } }
@keyframes natally-stage-asleep-twitch { 0%, 88%, 100% { transform: rotate(0deg); } 91% { transform: rotate(1.6deg); } 94% { transform: rotate(-0.8deg); } }
@keyframes natally-stage-asleep-hug { 0%, 70%, 100% { transform: translateY(0); } 78% { transform: translateY(14px) rotate(9deg); } 86% { transform: translateY(-3px) rotate(-2deg); } }
@keyframes natally-behavior-drift { 0%, 100% { opacity: 0.9; transform: translateY(0); } 50% { opacity: 0.55; transform: translateY(-5px); } }
@keyframes natally-behavior-sparkle { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
@keyframes natally-behavior-knock { 0%, 100% { transform: translate(0, 0); } 8% { transform: translate(3px, 2px); } 16% { transform: translate(-2px, 1px); } 24% { transform: translate(2px, -1px); } 32% { transform: translate(0, 0); } }
@keyframes natally-behavior-ride { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-10px, -7px); } }
@keyframes natally-behavior-pounce { 0%, 58%, 100% { transform: translateY(16px); } 68%, 78% { transform: translateY(-4px); } }
@media (prefers-reduced-motion: reduce) {
  .natally-stage *, .natally-stage *::before, .natally-stage *::after { animation: none !important; transition: none !important; }
  .natally-stage__pose, .natally-stage__orb, .natally-stage__mouth { transform: none !important; }
}
`;

/** §18.2 idle vignette pacing (authored art rotation, never a companion state). */
const IDLE_VIGNETTE_MS = 9000;

function usePointerTraits() {
  const [traits, setTraits] = useState(() => ({
    fine:
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(pointer: fine)").matches
        : false,
    coarse:
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(pointer: coarse)").matches
        : false,
  }));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const fine = window.matchMedia("(pointer: fine)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () => setTraits({ fine: fine.matches, coarse: coarse.matches });
    fine.addEventListener("change", update);
    coarse.addEventListener("change", update);
    return () => {
      fine.removeEventListener("change", update);
      coarse.removeEventListener("change", update);
    };
  }, []);
  return traits;
}

/** The default §18.2 renderer: real footage core + authored sprite overlays. */
export function FootageMascotRenderer({ state, snapshot, motion }: MascotRendererProps) {
  const [tick, setTick] = useState(0);
  const [pointerEngaged, setPointerEngaged] = useState(false);
  const pointer = usePointerTraits();
  const idle = state === "Idle";
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Vignettes rotate only while she is Idling and motion is allowed.
    if (!idle || !motion) return;
    timer.current = setInterval(() => setTick((value) => value + 1), IDLE_VIGNETTE_MS);
    return () => {
      if (timer.current !== null) clearInterval(timer.current);
      timer.current = null;
    };
  }, [idle, motion]);

  const behavior: IdleBehavior | null = behaviorForState(state, {
    hour: new Date().getHours(),
    finePointer: pointer.fine,
    coarsePointer: pointer.coarse,
    pointerEngaged,
    tick,
  });

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
  const gradientId = useId();

  return (
    <div
      className="natally-stage__pose"
      style={{ transform: state === "Listening" && motion ? "rotate(2deg)" : "none" }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setPointerEngaged(true);
      }}
      onPointerLeave={() => setPointerEngaged(false)}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") {
          setPointerEngaged(true);
          window.setTimeout(() => setPointerEngaged(false), 2400);
        }
      }}
    >
      <div
        className="natally-stage__pose"
        style={{ animation: delight ? "natally-stage-delight 600ms ease-in-out 1" : "none" }}
      >
        {motion ? (
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
              if (element) element.playbackRate = state === "Thinking" ? 0.8 : 1;
            }}
          />
        ) : (
          <img
            className="natally-stage__media"
            src={frameZero}
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
          {/* Authored vector compositions per STATES.md + §18.2, over real footage. */}
          <defs>
            <radialGradient id={gradientId}>
              <stop stopColor="#b7a3ef" stopOpacity="0" />
              <stop offset="1" stopColor="#b7a3ef" stopOpacity="0.6" />
            </radialGradient>
          </defs>
          {state === "Asleep" && (
            <g data-stage-overlay="Asleep">
              <g
                fill="#bcb2a1"
                stroke="#645454"
                strokeWidth="3"
                style={{
                  transformOrigin: "200px 195px",
                  animation: motion ? "natally-stage-asleep-eyes 6s ease-in-out infinite" : "none",
                }}
              >
                <path d="M137 184 Q157 168 176 184 L175 204 Q156 216 138 202 Z" />
                <path d="M230 184 Q249 168 266 184 L266 202 Q248 216 230 204 Z" />
                <path d="M139 201 Q157 212 175 201 M231 201 Q248 212 265 201" fill="none" />
              </g>
              <g
                fill="none"
                stroke="#d7b978"
                strokeWidth="2.5"
                strokeLinecap="round"
                style={{
                  transformOrigin: "200px 200px",
                  animation: motion
                    ? "natally-stage-asleep-twitch 7s ease-in-out infinite"
                    : "none",
                }}
              >
                {/* Sleep twitch marks; the hug arc below runs the near-drop-and-hug. */}
                <path d="M120 156 q-8 -10 -4 -20 M282 152 q8 -10 4 -20" opacity="0.7" />
              </g>
              <g
                fill="none"
                stroke="#d7b978"
                strokeWidth="2.5"
                style={{
                  transformOrigin: "203px 294px",
                  animation: motion ? "natally-stage-asleep-hug 11s ease-in-out infinite" : "none",
                }}
              >
                <circle cx="203" cy="294" r="46" opacity="0.5" />
                <path d="M170 320 Q203 336 236 320" opacity="0.8" />
              </g>
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
          {behavior !== null && <IdleBehaviorVignette behavior={behavior} motion={motion} />}
        </svg>
      </div>
    </div>
  );
}

/** U.9: a projection of C.4's StageSignal snapshot, with no synthetic state transitions. */
export function Stage({ bus = companionBus, className, style, plate, renderer }: StageProps) {
  const snapshot = useStageSnapshot(bus);
  const reducedMotion = useReducedMotion();
  const mascot = useRef<HTMLDivElement>(null);
  const [intersecting, setIntersecting] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "visible",
  );
  const [chartRevision, setChartRevision] = useState(0);
  const Renderer = renderer ?? FootageMascotRenderer;

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

  return (
    <section
      className={["natally-stage", className].filter(Boolean).join(" ")}
      style={style}
      data-stage-state={state}
      data-reduced-motion={reducedMotion}
      data-motion={motion}
      aria-label="Companion stage"
    >
      <style>{styles}</style>
      <div
        ref={mascot}
        className="natally-stage__mascot"
        role="img"
        aria-label={`natally: ${labels[state]}`}
      >
        {/* chartRevision remounts the renderer per actual chart so each Delighted
            flash is a fresh node (C.4 law: one flash per real chart-computed). */}
        <Renderer key={chartRevision} state={state} snapshot={snapshot} motion={motion} />
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
