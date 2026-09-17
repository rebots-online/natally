import type { ReactNode } from "react";
import type { GateResult } from "../../../../../packages/billing/src/trial.js";
import type { TrialPolicy } from "../../../../../packages/billing/src/types.js";
import type { Turn } from "../../../../../packages/lore/src/types.js";
import type { CompanionBus } from "../../companion/bus.js";

export type ConversationVariant =
  | "Idle"
  | "Thinking"
  | "Speaking"
  | "Asleep"
  | "Error"
  | "TrialIdle"
  | "TrialExhausted"
  | "RateLimited"
  | "Desktop";

/** These labels describe provenance, never inferred from a tool's arbitrary text. */
export type ConversationContent =
  | { kind: "computed"; text: string }
  | { kind: "authored-static"; label: "What it is" | "In synastry"; text: string }
  | { kind: "absence"; text: string };

export interface ConversationPlate {
  id: string;
  sessionId: string;
  ts: number;
  title: string;
  provenance: string;
  content: readonly ConversationContent[];
  /** A real computed wheel/table supplied by the plate module, never a sample chart. */
  body?: ReactNode;
}

export interface ConversationAccess {
  /** Stable snapshot; null is an unresolved gate, never an implied entitlement. */
  getSnapshot(): GateResult | null;
  subscribe(listener: () => void): () => void;
}

export interface ConversationServices {
  /** Publication bus after C.2 validation; never connect C.1's private candidate bus. */
  bus: CompanionBus;
  /** X.1 TurnsRepository satisfies this interface directly. History is read, not re-emitted. */
  turns: { list(sessionId: string): Promise<readonly Turn[]> };
  access: ConversationAccess;
  /** Parent persists turns and publishes accepted events on bus. Resolve after publication.
   * Rejection must not silently resubmit an already accepted reading. Honor signal on teardown. */
  submit(text: string, context: { sessionId: string; signal: AbortSignal }): Promise<void>;
  plates?: {
    list(sessionId: string): Promise<readonly ConversationPlate[]>;
    get(chartId: string): Promise<ConversationPlate | null>;
  };
}

export interface ConversationScreenProps {
  sessionId: string;
  services: ConversationServices;
  contextLabel?: string;
  trialPolicy?: TrialPolicy;
  /** M.1 manifest-derived model row; absence does not select a fallback model. */
  model?: { id: string; label: string; quant?: string; bytes?: number } | null;
  onDownloadModel?: (modelId: string) => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  onUnlock: () => void;
  onEnterCode: () => void;
  onOpenPlate: (plateId: string) => void;
  onContext?: () => void;
  onAttach?: () => void | Promise<void>;
  onVoice?: () => void | Promise<void>;
  voiceActive?: boolean;
  /** Current engine facts / labelled education / honest absence, supplied with provenance. */
  content?: readonly ConversationContent[];
  /** Parent supplies U.1 topbar/navigation and the desktop data panels. No router is created here. */
  renderHeader?: (context: ReactNode, collapsedStage: ReactNode) => ReactNode;
  peopleAndSessions?: ReactNode;
  atlas?: ReactNode;
}

export type { GateResult, TrialPolicy, Turn };
