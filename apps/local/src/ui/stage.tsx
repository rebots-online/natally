// natally — U.9: the Stage (mascot). ARCHITECTURE.md §10 + LIBS/UI/FIGMA/mascot/
// STATES.md (normative real-vs-composed table): eight states, every one bound to
// a real event, none fabricated by this component.
//
//   idle      real idle loop (natally-idle-400.webp); reduced-motion → frame 0 still
//   asleep    composed: loop paused on frame 0, lids drawn, orb desaturated 60% /
//             brightness 55% (bus `model-load asleep` — no model downloaded)
//   waking    composed: paused (frame 62 still), orb brightness eases 55%→100%
//             with the REAL progress fraction carried by the bus state
//   listening composed: loop playing, 2° tilt, orb hue +8° — composer focus is
//           NOT a bus event (bus.ts documents this); the host enters it via the
//           `listening` prop. It never masks a stronger real inference state.
//   thinking  composed: loop playing, orbglow swirl overlay (bus `token`)
//   speaking  composed: orb glow + mouth scale follow the live RMS envelope
//             (bus `envelope` events: rms 0–1 → orb scale 1.0–1.15, mouth
//             open-height 0.1–1.0). The reduced StageState deliberately
//             collapses rms; the instantaneous value is read from the bus's
//             typed `envelope` subscription — still bus-only, no timers.
//   delighted composed: one-shot 600 ms scale + gilt ring flash, then the bus
//             host's scheduled `stage-idle` returns to idle (bus.ts contract)
//   error     composed: loop paused, orb dimmed, gilt seam crack (bus `error`)
//
// The composed overlays (lids, swirl, mouth line, gilt ring, seam crack) are
// inline SVG/CSS stand-ins for the Figma-drawn vector layers pending export;
// the idle loop artwork itself is never edited. The runtime asset is the
// derived idle-loop webp; `natally-source-loop.mp4` stays in LIBS/UI/FIGMA/
// mascot/ for regeneration only and is never shipped. Purely decorative
// motion (swirl rotation, delight flash, plate transitions, tilt) is dropped
// under `reducedMotion`; envelope-driven scale is kept — it visualises live
// audio data, not canned motion.

import { useEffect, useState, useSyncExternalStore } from "react";
import idleLoopUrl from "../assets/mascot/natally-idle-400.webp";
import stillFrame0Url from "../assets/mascot/natally-still-400.png";
import stillMidUrl from "../assets/mascot/natally-still-mid-400.png";
import type { CompanionBus, StageName } from "../companion/bus";

export interface StageProps {
  /** The companion bus (C.4) — the Stage's ONLY driver for its 7 bus states. */
  readonly bus: CompanionBus;
  /** Honors prefers-reduced-motion: frame-0 still, no decorative animations. */
  readonly reducedMotion?: boolean;
  /**
   * STATES.md `listening` (composer focused). Composer focus is a UI event,
   * not a bus event — bus.ts delegates host entry; see component header.
   */
  readonly listening?: boolean;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The eight rendered states: the bus's seven + host-entered listening. */
type StageView = StageName | "listening";

/** rms 0–1 → orb scale 1.0–1.15 (task spec; STATES.md speaking row). */
function orbScale(rms: number): string {
  return `scale(${(1 + 0.15 * clamp01(rms)).toFixed(3)})`;
}

/** rms 0–1 → mouth open-height factor 0.1–1.0 (task spec). */
function mouthOpen(rms: number): string {
  return `scaleY(${(0.1 + 0.9 * clamp01(rms)).toFixed(3)})`;
}

const MOTION_CSS = `
@keyframes natally-swirl {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes natally-delight {
  0% { transform: scale(1); }
  50% { transform: scale(1.04); }
  100% { transform: scale(1); }
}
@keyframes natally-ring-flash {
  0% { opacity: 0; }
  50% { opacity: 1; }
  100% { opacity: 0; }
}
.stage-anim-swirl { animation: natally-swirl 6s linear infinite; }
.stage-anim-delight { animation: natally-delight 600ms ease-in-out 1; }
.stage-anim-ring-flash { animation: natally-ring-flash 600ms ease-in-out 1; }
.stage-motion [data-overlay] { transition: opacity 160ms ease, transform 160ms ease; }
`;

export function Stage({ bus, reducedMotion = false, listening = false }: StageProps) {
  // The bus's replay-buffered stage state is the sole source of the state name.
  const busState = useSyncExternalStore(
    (onChange) => bus.stageState$.subscribe(onChange),
    () => bus.stageState$.current(),
  );
  // Live RMS envelope for the speaking scale — bus-delivered, never invented.
  const [rms, setRms] = useState(0);
  useEffect(() => bus.subscribe("envelope", (event) => setRms(event.rms)), [bus]);

  // Host-entered listening: only from idle, never over a real inference state.
  const stage: StageView = listening && busState.stage === "idle" ? "listening" : busState.stage;

  // Per-state artwork + plate composition (STATES.md source column): asleep and
  // error pause on frame 0; waking pauses mid-loop (frame 62); reduced-motion
  // always shows frame 0.
  const src =
    stage === "waking" && !reducedMotion
      ? stillMidUrl
      : reducedMotion || stage === "asleep" || stage === "error"
        ? stillFrame0Url
        : idleLoopUrl;

  let plateFilter = "";
  let plateTransform = "";
  if (stage === "asleep") {
    plateFilter = "saturate(0.4) brightness(0.55)"; // desaturated 60%, brightness 55%
  } else if (stage === "waking") {
    // Real progress fraction drives the ease 55% → 100%.
    plateFilter = `brightness(${(0.55 + 0.45 * clamp01(busState.progress ?? 0)).toFixed(3)})`;
  } else if (stage === "listening") {
    plateFilter = "hue-rotate(8deg)";
    if (!reducedMotion) {
      plateTransform = "rotate(2deg)";
    }
  } else if (stage === "error") {
    plateFilter = "brightness(0.6)";
  }

  const speaking = stage === "speaking";
  const delighted = stage === "delighted";
  const thinking = stage === "thinking";
  const asleep = stage === "asleep";

  const motionClass = reducedMotion ? "" : " stage-motion";
  const swirlClass = thinking && !reducedMotion ? " stage-anim-swirl" : "";
  const delightClass = delighted && !reducedMotion ? " stage-anim-delight" : "";
  const ringClass = delighted && !reducedMotion ? " stage-anim-ring-flash" : "";

  return (
    <div
      className={`natally-stage${motionClass}`}
      data-stage={stage}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      role="img"
      aria-label={`natally, ${stage}`}
    >
      <style>{MOTION_CSS}</style>
      <div
        className={`natally-stage-plate${delightClass}`}
        data-testid="stage-plate"
        style={{
          filter: plateFilter === "" ? undefined : plateFilter,
          transform: plateTransform === "" ? undefined : plateTransform,
        }}
      >
        {/* The real idle loop / paused frame. The loop artwork is never edited. */}
        <img
          data-testid="stage-figure"
          src={src}
          alt=""
          draggable={false}
          width={400}
          height={400}
        />
        {/* Composed overlay: asleep lids (Figma vector layer, pending export). */}
        {asleep ? (
          <svg
            data-overlay="lids"
            data-testid="stage-lids"
            viewBox="0 0 400 400"
            aria-hidden="true"
          >
            <rect x="140" y="168" width="48" height="14" rx="7" fill="rgba(240,236,228,0.55)" />
            <rect x="212" y="168" width="48" height="14" rx="7" fill="rgba(240,236,228,0.55)" />
          </svg>
        ) : null}
        {/* Composed overlay: thinking orbglow swirl (6 s radial rotation). */}
        {thinking ? (
          <div
            data-overlay="swirl"
            data-testid="stage-swirl"
            className={swirlClass.trim()}
            style={{
              position: "absolute",
              left: "35%",
              top: "32%",
              width: "30%",
              height: "30%",
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(212,175,55,0.45) 0%, rgba(212,175,55,0) 70%)",
            }}
          />
        ) : null}
        {/* Composed overlay: speaking mouth line (open-height follows rms). */}
        {speaking ? (
          <div
            data-overlay="mouth"
            data-testid="stage-mouth"
            style={{
              position: "absolute",
              left: "44%",
              top: "58%",
              width: "12%",
              height: "12px",
              borderRadius: "6px",
              background: "rgba(240,236,228,0.9)",
              transform: mouthOpen(rms),
              transformOrigin: "center",
            }}
          />
        ) : null}
        {/* Composed overlay: delighted gilt ring (600 ms one-shot flash). */}
        {delighted ? (
          <div
            data-overlay="ring"
            data-testid="stage-ring"
            className={ringClass.trim()}
            style={{
              position: "absolute",
              left: "25%",
              top: "22%",
              width: "50%",
              height: "50%",
              borderRadius: "50%",
              border: "3px solid rgba(212,175,55,0.9)",
              opacity: reducedMotion ? 0.9 : undefined,
            }}
          />
        ) : null}
        {/* Composed overlay: error gilt seam crack. */}
        {stage === "error" ? (
          <svg
            data-overlay="crack"
            data-testid="stage-crack"
            viewBox="0 0 400 400"
            aria-hidden="true"
          >
            <polyline
              points="200,150 186,182 208,206 188,236 204,258"
              fill="none"
              stroke="rgba(212,175,55,0.9)"
              strokeWidth="3"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        {/* Envelope-driven orb glow: scale 1.0–1.15 from the live rms. */}
        <div
          data-overlay="glow"
          data-testid="stage-orb"
          style={{
            position: "absolute",
            left: "35%",
            top: "32%",
            width: "30%",
            height: "30%",
            borderRadius: "50%",
            boxShadow: "0 0 24px 8px rgba(212,175,55,0.35)",
            transform: speaking ? orbScale(rms) : undefined,
            transformOrigin: "center",
          }}
        />
      </div>
      {stage === "error" && busState.detail !== undefined ? (
        <span data-error-detail={busState.detail} />
      ) : null}
    </div>
  );
}

export default Stage;
