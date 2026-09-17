import type { GateResult } from "../../../packages/billing/src/trial.js";
import { evaluateGate } from "../../../packages/billing/src/trial.js";
import type { Turn } from "../../../packages/lore/src/types.js";
import { createCompanionBus } from "./companion/bus.js";
import { loadRuntimeConfig } from "./config.js";
import type { ConversationServices } from "./screens/conversation/types.js";

/**
 * Production composition root for the web lane. Assembles the conversation services
 * from the in-tree subsystems: the B.1 trial gate from build-baked config and the
 * C.4 companion bus.
 *
 * Persistence note (pre-first-light): sessions require a real Person (J1), and no
 * birth data exists until the first-light intake lands (U.4). Rather than fabricate
 * a person or birth data, the conversation runs on in-memory turns for now; the
 * X.1 repositories attach when the intake screen creates the first person.
 */

/** Honest absence (INC-19) spoken when no model is present; never an invented reading. */
const MODEL_ABSENCE_REPLY =
  "I'm listening, but I have no voice yet — my readings begin once my model arrives. Charts still work while I sleep.";

const SESSION_STORAGE_KEY = "natally.session";

function readStoredSessionId(): string {
  const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (stored) return stored;
  const id = `s-${crypto.randomUUID()}`;
  window.localStorage.setItem(SESSION_STORAGE_KEY, id);
  return id;
}

function newTurn(sessionId: string, role: Turn["role"], text: string): Turn {
  return { id: `t-${crypto.randomUUID()}`, sessionId, role, text, ts: Date.now() };
}

function createAccess() {
  const config = loadRuntimeConfig();
  const listeners = new Set<() => void>();
  let snapshot: GateResult | null = null;
  const recompute = () => {
    // No licensed token verification is wired yet (B.3 integration); the local trial
    // gate is evaluated over committed readings once B.2's ledger lands here.
    const next = evaluateGate(config.trial, [], () => Date.now(), false);
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  recompute();
  return {
    getSnapshot: (): GateResult | null => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    recompute,
  };
}

let composition: Promise<{ sessionId: string; services: ConversationServices }> | undefined;

export function createConversationComposition(): Promise<{
  sessionId: string;
  services: ConversationServices;
}> {
  composition ??= Promise.resolve(
    (() => {
      const bus = createCompanionBus();
      const access = createAccess();
      const sessionId = readStoredSessionId();
      const memoryTurns: Turn[] = [];

      // The web lane ships model-less until M.1's catalogue download lands (C.1 wiring):
      // the Stage shows Asleep and every submission answers with honest absence.
      bus.signal({ type: "model-presence", present: false });

      const services: ConversationServices = {
        bus,
        turns: {
          async list(targetSessionId: string) {
            return memoryTurns.filter((turn) => turn.sessionId === targetSessionId);
          },
        },
        access,
        async submit(text, context) {
          if (context.signal.aborted) return;
          const userTurn = newTurn(context.sessionId, "you", text);
          memoryTurns.push(userTurn);
          bus.emit({ type: "turn", turn: userTurn });
          if (context.signal.aborted) return;
          const reply = newTurn(context.sessionId, "her", MODEL_ABSENCE_REPLY);
          memoryTurns.push(reply);
          bus.emit({ type: "turn", turn: reply });
        },
      };
      return { sessionId, services };
    })(),
  );
  return composition;
}
