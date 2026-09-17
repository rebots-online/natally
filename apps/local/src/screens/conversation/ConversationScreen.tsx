import { type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Glyph } from "../../ui/glyphs.js";
import { Button } from "../../ui/primitives/Button.js";
import { Chip } from "../../ui/primitives/Chip.js";
import { Composer } from "../../ui/primitives/Composer.js";
import { PlateCard } from "../../ui/primitives/PlateCard.js";
import { TurnYou } from "../../ui/primitives/TurnYou.js";
import { Stage } from "../../ui/stage.js";
import type { ConversationContent, ConversationScreenProps, ConversationVariant, GateResult, TrialPolicy } from "./types.js";
import { errorReason, useConversation } from "./use-conversation.js";
import "./conversation.css";

function useDesktop() {
  const [query] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 960px)") : null);
  const subscribe = useCallback((notify: () => void) => {
    query?.addEventListener("change", notify);
    return () => query?.removeEventListener("change", notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => query?.matches ?? false, () => false);
}

/** Also usable by the parent-owned U.1 TopBar without adding another navigation system. */
export function ConversationContextChip({ gate, label = "You", onClick }: { gate: GateResult | null; label?: string; onClick?: () => void }) {
  return <Chip active onClick={onClick} disabled={!onClick} aria-label="Conversation context">
    {gate && gate.state !== "licensed" ? "Trial" : label}
  </Chip>;
}

function GeneratedTurn({ children, streaming = false }: { children: ReactNode; streaming?: boolean }) {
  return <article className="conversation__her" data-provenance="generated" aria-label="natally's message" aria-busy={streaming}>
    <Glyph name="sun" className="conversation__glyph" />
    <div><div className="conversation__name">natally</div><p>{children}</p></div>
  </article>;
}

function Content({ content }: { content: ConversationContent }) {
  if (content.kind === "authored-static") return <div data-provenance="authored-static">
    <strong className="conversation__education-label">{content.label}</strong><p>{content.text}</p>
  </div>;
  return <p data-provenance={content.kind} className={content.kind === "absence" ? "conversation__aside" : undefined}>{content.text}</p>;
}

function TrialEnded({ policy }: { policy?: TrialPolicy }) {
  if (policy?.mode !== "count" || policy.readings === undefined) return <>Your trial has ended.</>;
  // The frozen three-reading wording applies only to the actual three-reading policy.
  return policy.readings === 3 ? <>Your three trial readings are used.</> :
    <>Your <span className="conversation__data" data-provenance="computed">{policy.readings}</span> trial readings are used.</>;
}

/** A session switch remounts local drafts/readers; late SQL/model results cannot cross sessions. */
export function ConversationScreen(props: ConversationScreenProps) {
  return <ConversationSession key={props.sessionId} {...props} />;
}

function ConversationSession(props: ConversationScreenProps) {
  const { services, sessionId } = props;
  const { bus } = services;
  const state = useConversation(services, sessionId);
  const desktop = useDesktop();
  const [scrolled, setScrolled] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const sending = useRef(false);
  const runningAction = useRef(false);
  const lifecycle = useRef<AbortController | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const nearEnd = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => {
      controller.abort();
      // Focus is a real capability observation. Teardown must not leave Listening stuck.
      bus.signal({ type: "composer-focus", focused: false });
    };
  }, [bus, services]);

  useEffect(() => {
    const element = scroll.current;
    if (element && nearEnd.current) element.scrollTop = element.scrollHeight;
  }, [state.turns, state.plates, state.stream]);

  const gate = state.gate;
  const blocked = gate?.state === "trial-exhausted" || gate?.state === "rate-limited";
  const unavailable = state.stage === "Asleep" || state.stage === "Waking" || state.stage === "Error" || state.modelPresent !== true;
  const disabled = blocked || !gate || unavailable || state.loading || !!state.historyError || pending || state.stage === "Thinking" || !!state.stream;
  useEffect(() => {
    if (disabled && bus.getSnapshot().composerFocused) bus.signal({ type: "composer-focus", focused: false });
  }, [disabled, bus]);

  let variant: ConversationVariant;
  if (state.engineError !== null) variant = "Error";
  else if (state.stage === "Asleep") variant = "Asleep";
  else if (gate?.state === "trial-exhausted") variant = "TrialExhausted";
  else if (gate?.state === "rate-limited") variant = "RateLimited";
  else if (state.stage === "Speaking") variant = "Speaking";
  else if (state.stage === "Thinking" || state.stream) variant = "Thinking";
  else if (desktop) variant = "Desktop";
  else if (gate?.state === "trial-active") variant = "TrialIdle";
  else variant = "Idle";

  async function runAction(action: (() => void | Promise<void>) | undefined, name: string) {
    if (!action || runningAction.current) return;
    const signal = lifecycle.current!.signal;
    runningAction.current = true;
    setActiveAction(name);
    setActionError(null);
    try { await action(); }
    catch (error) { if (!signal.aborted) setActionError(errorReason(error)); }
    finally {
      runningAction.current = false;
      if (!signal.aborted) setActiveAction(null);
    }
  }

  async function submit(value: string) {
    const text = value.trim();
    const currentGate = services.access.getSnapshot();
    const snapshot = bus.getSnapshot();
    // Re-read the gate in the event handler: a store change can precede React's next render.
    if (!text || disabled || sending.current || !currentGate ||
      (currentGate.state !== "licensed" && currentGate.state !== "trial-active") ||
      snapshot.modelPresent !== true || snapshot.error !== null || snapshot.state === "Waking") return;
    const signal = lifecycle.current!.signal;
    sending.current = true;
    setPending(true);
    setActionError(null);
    const clearAcceptedDraft = () => setDraft((previous) => previous.trim() === text ? "" : previous);
    const stop = bus.subscribe("turn", ({ turn }) => {
      if (!signal.aborted && turn.sessionId === sessionId && turn.role === "you" && turn.text === text) clearAcceptedDraft();
    });
    try {
      // No optimistic turn, model state, timestamp or generated reply is fabricated here.
      await services.submit(text, { sessionId, signal });
      if (!signal.aborted) clearAcceptedDraft();
    } catch (error) {
      if (!signal.aborted) setActionError(errorReason(error));
    } finally {
      stop();
      sending.current = false;
      if (!signal.aborted) setPending(false);
    }
  }

  const collapsed = scrolled && !desktop;
  const stage = <Stage bus={bus} className={`conversation__stage${collapsed ? " conversation__stage--avatar" : ""}`} />;
  const context = <ConversationContextChip gate={gate} label={props.contextLabel} onClick={props.onContext} />;
  const items = [
    ...state.turns.filter((turn) => turn.role !== "tool").map((turn) => ({ kind: "turn" as const, id: turn.id, ts: turn.ts, turn })),
    ...state.plates.map((plate) => ({ kind: "plate" as const, id: plate.id, ts: plate.ts, plate })),
  ].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));

  return <section className="conversation" aria-label="Conversation" data-conversation-variant={variant}
    data-layout={desktop ? "Desktop" : "Mobile"} data-rail={props.peopleAndSessions != null} data-atlas={props.atlas != null}>
    {props.peopleAndSessions != null && <aside className="conversation__rail" aria-label="People and sessions">{props.peopleAndSessions}</aside>}
    <div className="conversation__column">
      <div className="conversation__header">
        {props.renderHeader ? props.renderHeader(context, collapsed ? stage : null) : <>{collapsed && stage}{context}</>}
      </div>
      <div className="conversation__scroll" ref={scroll} tabIndex={0} aria-label="Conversation page" onScroll={(event) => {
        const element = event.currentTarget;
        setScrolled(element.scrollTop > 200);
        nearEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      }}>
        <div className="conversation__stage-space">{!collapsed && stage}</div>
        <div className="conversation__transcript" role="log" aria-label="Transcript" aria-live="polite" aria-relevant="additions text">
          {state.stage === "Asleep" && <section className="conversation__absence-plate" data-provenance="absence" aria-label="Wake natally">
            <h2>natally is asleep</h2>
            <p>She thinks with a language model that runs on this device. Download one to wake her.</p>
            {props.model ? <div className="conversation__model">
              <span className="conversation__data" data-provenance="computed">{[props.model.label, props.model.quant, props.model.bytes === undefined ? null : `${props.model.bytes.toLocaleString()} bytes`].filter((part) => part != null).join(" · ")}</span>
              <Button variant={blocked ? "secondary" : "primary"} disabled={!props.onDownloadModel || activeAction !== null} onClick={() => void runAction(() => props.onDownloadModel!(props.model!.id), "download")}>
                {activeAction === "download" ? "Downloading…" : "Download"}
              </Button>
            </div> : <p className="conversation__aside">No model is selected. Choose one in Settings.</p>}
            <p className="conversation__aside">Charts work without her. Pick a different model in Settings.</p>
          </section>}
          {state.engineError !== null && <section className="conversation__absence-plate conversation__absence-plate--error" data-provenance="absence" role="alert">
            <h2>natally can’t respond right now</h2><p className="conversation__aside">{state.engineError}</p>
            <Button disabled={!props.onRetry || activeAction !== null} onClick={() => void runAction(props.onRetry, "retry")}>Try again</Button>
          </section>}
          {state.loading && <p className="conversation__aside" data-provenance="absence" role="status">Loading conversation…</p>}
          {state.historyError !== null && <div className="conversation__absence-plate conversation__absence-plate--error" data-provenance="absence" role="alert">
            <p className="conversation__aside">{state.historyError}</p><Button onClick={state.reloadHistory}>Try loading again</Button>
          </div>}
          {props.content?.map((content, index) => <Content key={index} content={content} />)}
          {items.map((item) => item.kind === "turn" ? <div key={`turn:${item.id}`} data-turn-id={item.id}>
            {item.turn.role === "you" ? <TurnYou>{item.turn.text}</TurnYou> : <GeneratedTurn>{item.turn.text}</GeneratedTurn>}
          </div> : <div key={`plate:${item.id}`} data-plate-id={item.id}>
            <PlateCard title={item.plate.title} provenance={<span data-provenance="computed">{item.plate.provenance}</span>} onOpen={() => props.onOpenPlate(item.id)}>
              {item.plate.body}
              <div className="conversation__content">{item.plate.content.map((content, index) => <Content key={index} content={content} />)}</div>
            </PlateCard>
          </div>)}
          {!!state.stream && <GeneratedTurn streaming>{state.stream}</GeneratedTurn>}
          {variant === "Thinking" && <p className="conversation__aside" data-provenance="absence" role="status">{state.stream ? "Responding…" : "Thinking…"}</p>}
          {state.plateError !== null && <p className="conversation__aside" data-provenance="absence" role="alert">{state.plateError}</p>}
          {!state.loading && !state.historyError && !items.length && !state.stream && state.stage !== "Asleep" && !state.engineError && !props.content?.length &&
            <p className="conversation__aside" data-provenance="absence">No conversation yet.</p>}
        </div>
      </div>
      <footer className="conversation__footer">
        {actionError !== null && <p className="conversation__aside" data-provenance="absence" role="alert">{actionError}</p>}
        {gate?.state === "trial-exhausted" ? <div className="conversation__locked">
          <p className="conversation__aside" data-provenance="absence"><TrialEnded policy={props.trialPolicy} /></p>
          <Button variant="primary" onClick={props.onUnlock}>Unlock natally</Button>
          <Button variant="quiet" onClick={props.onEnterCode}>or enter a code</Button>
        </div> : <>
          {gate?.state === "rate-limited" && <p className="conversation__aside" data-provenance="absence">Your next reading unlocks <time className="conversation__data" data-provenance="computed" dateTime={new Date(gate.nextReadingAt).toISOString()}>{new Date(gate.nextReadingAt).toLocaleString()}</time>.</p>}
          {!gate && <p className="conversation__aside" data-provenance="absence">Reading access is unavailable.</p>}
          {state.modelPresent === null && <p className="conversation__aside" data-provenance="absence">Companion availability is not known yet.</p>}
          <Composer value={draft} onChange={setDraft} onSend={(text) => void submit(text)} disabled={disabled} label="Ask natally"
            onAttach={props.onAttach ? () => void runAction(props.onAttach, "attach") : undefined}
            onVoice={props.onVoice ? () => void runAction(props.onVoice, "voice") : undefined} voiceActive={props.voiceActive}
            onFocus={() => bus.signal({ type: "composer-focus", focused: true })} onBlur={() => bus.signal({ type: "composer-focus", focused: false })} />
        </>}
      </footer>
    </div>
    {props.atlas != null && <aside className="conversation__atlas" aria-label="Atlas">{props.atlas}</aside>}
  </section>;
}

export default ConversationScreen;
