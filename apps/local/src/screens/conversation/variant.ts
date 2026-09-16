// natally — U.2 variant derivation (SCREEN.md screen-conversation, normative;
// STATE-LEDGER `screens["screen-conversation"]` node ids 13:2, 13:193, 13:215,
// 13:332, 13:448, 26:430, 51:613, 51:727, 51:846).
//
// The nine frozen variants are a pure function of two real inputs only:
//   * the Stage's bus state (C.4 `stageState$`) — Asleep, Error, Thinking,
//     Speaking are real events, never fabricated (STATES.md law);
//   * the B.1 gate result (§9.2) — TrialIdle, TrialExhausted, RateLimited.
// Idle is the licensed/resting frame; Desktop (26:430) is the layout frame —
// the desktop composition of the resting licensed screen (Stage fixed 430,
// centred; person chips). A non-resting state under a desktop viewport keeps
// its state name in `data-variant` (the layout stays desktop; the frozen
// frame set names states, not per-state desktop frames).
//
// Precedence: real event states (asleep > error > thinking > speaking) over
// gate states (exhausted > rate-limited > trial-active) — an engine state is
// never masked by a billing state, and vice versa a trial state never claims
// the Stage. Pure: no clock, no DOM, no bus reads.

import type { StageName } from "../../companion/bus";
import type { TrialGateResult } from "./types";

/** The nine frozen variant names (SCREEN.md `Variants`), kebab-cased. */
export type ConversationVariant =
  | "idle"
  | "thinking"
  | "speaking"
  | "asleep"
  | "error"
  | "trial-idle"
  | "trial-exhausted"
  | "rate-limited"
  | "desktop";

export type VariantInputs = {
  readonly stage: StageName;
  readonly gate: TrialGateResult;
  readonly desktop?: boolean;
};

/**
 * Derive the frozen variant for the current bus + gate state (see module
 * header for the precedence law and the Desktop carve-out).
 */
export function deriveVariant({
  stage,
  gate,
  desktop = false,
}: VariantInputs): ConversationVariant {
  if (desktop && stage === "idle" && gate.state === "licensed") {
    return "desktop";
  }
  if (stage === "asleep") {
    return "asleep";
  }
  if (stage === "error") {
    return "error";
  }
  if (stage === "thinking") {
    return "thinking";
  }
  if (stage === "speaking") {
    return "speaking";
  }
  if (gate.state === "trial-exhausted") {
    return "trial-exhausted";
  }
  if (gate.state === "rate-limited") {
    return "rate-limited";
  }
  if (gate.state === "trial-active") {
    return "trial-idle";
  }
  return "idle";
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Local `YYYY-MM-DD · HH:MM` for the RateLimited aside's computed instant
 * (§9.2 next-date aside; INC-19: the date is a computed fact → Plex Mono at
 * the call site, this function only formats it). Local wall clock, 24 h.
 */
export function formatGateInstant(epochMs: number): string {
  const at = new Date(epochMs);
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} · ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}
