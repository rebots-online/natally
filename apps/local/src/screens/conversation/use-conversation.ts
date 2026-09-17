import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ConversationPlate, ConversationServices, Turn } from "./types.js";

function mergeById<T extends { id: string; ts: number }>(
  older: readonly T[],
  newer: readonly T[],
): T[] {
  const values = new Map(older.map((value) => [value.id, value]));
  for (const value of newer) values.set(value.id, value);
  return [...values.values()].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
}

export function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useConversation(services: ConversationServices, sessionId: string) {
  const { bus, access } = services;
  const stage = useSyncExternalStore(
    bus.stageState$.subscribe,
    bus.stageState$.getSnapshot,
    bus.stageState$.getSnapshot,
  );
  const subscribeAccess = useCallback((notify: () => void) => access.subscribe(notify), [access]);
  const readAccess = useCallback(() => access.getSnapshot(), [access]);
  const gate = useSyncExternalStore(subscribeAccess, readAccess, readAccess);
  const [modelPresent, setModelPresent] = useState(bus.getSnapshot().modelPresent);
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [plates, setPlates] = useState<readonly ConversationPlate[]>([]);
  const [stream, setStream] = useState("");
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [plateError, setPlateError] = useState<string | null>(null);
  const [engineError, setEngineError] = useState(bus.getSnapshot().error);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let frame: number | undefined;
    let active = true;
    const observe = () => {
      frame = undefined;
      if (!active) return;
      const present = bus.getSnapshot().modelPresent;
      setModelPresent(present);
      // C.4 has no capability-only subscription: unknown -> present can retain Idle.
      // Stop reading frames as soon as bootstrap supplies an actual observation.
      if (present === null) frame = requestAnimationFrame(observe);
    };
    const stop = bus.stageState$.subscribe(() => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observe();
    });
    return () => {
      active = false;
      stop();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [bus]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is the retry trigger — its presence in this effect's deps is intentional.
  useEffect(() => {
    let active = true;
    // Register first: an event during an asynchronous SQL read must win over its older row.
    const liveTurns: Turn[] = [];
    const livePlates: ConversationPlate[] = [];
    const plateRequests = new Map<string, number>();
    const unsubscribe = [
      bus.subscribe("turn", ({ turn }) => {
        if (turn.sessionId !== sessionId) return;
        liveTurns.push(turn);
        setTurns((previous) => mergeById(previous, [turn]));
        if (turn.role === "her" || turn.role === "you") setStream("");
      }),
      bus.subscribe("token", ({ token }) => setStream((previous) => previous + token)),
      bus.subscribe("error", ({ message }) => setEngineError(message)),
      bus.subscribe("chart-computed", ({ chartId }) => {
        if (!services.plates) {
          setPlateError("Chart details are unavailable.");
          return;
        }
        const revision = (plateRequests.get(chartId) ?? 0) + 1;
        plateRequests.set(chartId, revision);
        void Promise.resolve()
          .then(() => services.plates?.get(chartId))
          .then((plate) => {
            if (!active || plateRequests.get(chartId) !== revision) return;
            if (!plate) {
              setPlateError("Chart details are unavailable.");
            } else if (plate.sessionId === sessionId) {
              livePlates.push(plate);
              setPlates((previous) => mergeById(previous, [plate]));
              setPlateError(null);
            }
          })
          .catch((error: unknown) => {
            if (active && plateRequests.get(chartId) === revision)
              setPlateError(errorReason(error));
          });
      }),
      bus.stageState$.subscribe(() => setEngineError(bus.getSnapshot().error)),
    ];
    setLoading(true);
    setHistoryError(null);
    // A reload preserves already observed events and does not reset the live response.
    void Promise.resolve()
      .then(() => services.turns.list(sessionId))
      .then((history) => {
        if (active)
          setTurns((previous) =>
            mergeById(
              history.filter((turn) => turn.sessionId === sessionId),
              mergeById(previous, liveTurns),
            ),
          );
      })
      .catch((error: unknown) => {
        if (active) setHistoryError(errorReason(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    if (services.plates) {
      void Promise.resolve()
        .then(() => services.plates?.list(sessionId))
        .then((history = []) => {
          if (active)
            setPlates((previous) =>
              mergeById(
                history.filter((plate) => plate.sessionId === sessionId),
                mergeById(previous, livePlates),
              ),
            );
        })
        .catch((error: unknown) => {
          if (active) setPlateError(errorReason(error));
        });
    }
    return () => {
      active = false;
      for (const stop of unsubscribe) stop();
    };
  }, [services, bus, sessionId, reload]);

  return {
    stage,
    gate,
    modelPresent,
    turns,
    plates,
    stream,
    loading,
    historyError,
    plateError,
    engineError,
    reloadHistory: () => setReload((value) => value + 1),
  };
}
