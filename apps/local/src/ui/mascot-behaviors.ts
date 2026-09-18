import type { StageState } from "../companion/bus.js";

/**
 * U.9 / §18.2 — the authored idle-behaviour set, verbatim from the enumeration:
 * lounging atop the composer, standing behind the gold circle, tending the
 * crystal ball, doom-scroll/texting, attention gestures, time-of-day mirroring,
 * cursor-grab/ride (desktop) and finger-pounce (touch). These are authored
 * gold-hairline vignettes projected over the real-footage idle core — no
 * AI-generated character art. The set is closed (SC1): appending a behaviour is
 * a decision-entry event.
 */
export const IDLE_BEHAVIORS = [
  "lounge",
  "wheel-stand",
  "tend",
  "doom-scroll",
  "attention",
  "dawn-yawn",
  "cursor-ride",
  "finger-pounce",
] as const;

export type IdleBehavior = (typeof IDLE_BEHAVIORS)[number];

/** Base cycle order; time-of-day and pointer behaviours override it. */
const BASE_CYCLE: readonly IdleBehavior[] = [
  "lounge",
  "wheel-stand",
  "tend",
  "doom-scroll",
  "attention",
];

/** §18.2 time-of-day mirroring: the dawn window yawns, teeth, groggy coffee. */
export const DAWN_HOUR_RANGE: readonly [number, number] = [5, 9];

export interface IdleBehaviorInput {
  /** Local hour of day (0–23) — the mirroring signal. */
  hour: number;
  /** `matchMedia("(pointer: fine)")` — desktop cursor hardware. */
  finePointer: boolean;
  /** `matchMedia("(pointer: coarse)")` — touch hardware. */
  coarsePointer: boolean;
  /** A pointer is currently engaging the mascot (hover or touch). */
  pointerEngaged: boolean;
  /** Vignette rotation counter; advances only while Idle and motion is on. */
  tick: number;
}

export function isDawn(hour: number): boolean {
  return hour >= DAWN_HOUR_RANGE[0] && hour < DAWN_HOUR_RANGE[1];
}

export function selectIdleBehavior(input: IdleBehaviorInput): IdleBehavior {
  const { hour, finePointer, coarsePointer, pointerEngaged, tick } = input;
  if (pointerEngaged && coarsePointer && !finePointer) return "finger-pounce";
  if (pointerEngaged && finePointer) return "cursor-ride";
  if (isDawn(hour)) return "dawn-yawn";
  const index = ((tick % BASE_CYCLE.length) + BASE_CYCLE.length) % BASE_CYCLE.length;
  return BASE_CYCLE[index] ?? "lounge";
}

/** Vignettes render for the Idle state only; other states own their overlays. */
export function behaviorForState(state: StageState, input: IdleBehaviorInput): IdleBehavior | null {
  return state === "Idle" ? selectIdleBehavior(input) : null;
}

export const BEHAVIOR_NOTES: Readonly<Record<IdleBehavior, string>> = Object.freeze({
  lounge: "lounging atop the composer",
  "wheel-stand": "standing behind the gold circle",
  tend: "tending the crystal ball",
  "doom-scroll": "doom-scrolling and texting",
  attention: "attention gestures at the porthole glass",
  "dawn-yawn": "dawn yawn and groggy coffee",
  "cursor-ride": "grabbing a ride on your cursor",
  "finger-pounce": "pouncing at your finger",
});
