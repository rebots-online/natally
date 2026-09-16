// natally — U.2 injected seams for the conversation screen (ARCHITECTURE.md §4,
// §5, §9.2). Everything a screen needs that another task owns arrives as a
// structural prop: the wiring layer (I.1) binds the real instances later, the
// screen never imports their modules. Shapes are mirrors, not re-exports —
// the owning packages do not expose these on their public surfaces yet.

import type { Turn } from "@natally/lore/types";

// ---------------------------------------------------------------------------
// B.1 trial gate (packages/billing/src/trial.ts `evaluateGate` result shape)
// ---------------------------------------------------------------------------

/**
 * The designed gate states (§9.2): B.1's `GateState` union. Mirrored
 * structurally — `@natally/billing` does not export its `trial.ts` surface,
 * and this screen must not reach past a package's public exports.
 */
export type TrialGateState = "trial-active" | "trial-exhausted" | "rate-limited" | "licensed";

/**
 * One B.1 `GateResult`, mirrored: `remaining` appears only on
 * `trial-active` (count mode: readings left; time mode: days left),
 * `nextReadingAt` only on `rate-limited` (the RateLimited aside's instant).
 */
export interface TrialGateResult {
  readonly state: TrialGateState;
  readonly remaining?: number;
  readonly nextReadingAt?: number;
}

// ---------------------------------------------------------------------------
// X.1 transcript store (the persistence-side transcript view)
// ---------------------------------------------------------------------------

/**
 * The transcript view X.1's store structurally provides: every persisted
 * turn in transcript order, hydrated once at mount. The live feed is the C.4
 * bus (`turn` events); the bus, not this screen, is where new turns arrive —
 * so this is a read view only (§5 append-only law is the store's business).
 */
export interface TranscriptSink {
  list(): readonly Turn[];
}

// ---------------------------------------------------------------------------
// Context people and plates laid on the page
// ---------------------------------------------------------------------------

/** The person context a conversation is scoped to (§5 Person, name only). */
export interface PersonRef {
  readonly id: string;
  readonly name: string;
}

/**
 * One plate laid on the page (§5 Plate): a midnight/2 card with a computed
 * provenance foot and the Open affordance. `presentPlate` (C.3's seam) is
 * called with the plate id when Open is pressed.
 */
export interface ConversationPlate {
  readonly id: string;
  readonly kind: "natal" | "synastry" | "today";
  readonly chartId: string;
  readonly title: string;
  /** Computed-fact foot, e.g. "Placidus · 1990-05-02 14:32 · Malmö". */
  readonly provenance: string;
}
