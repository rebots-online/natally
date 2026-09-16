// natally — U.2: the conversation screen (home). SCREEN.md screen-conversation
// is normative: TopBar (menu · wordmark · context chip) · Stage (U.9, real
// events only) · transcript · composer · version stamp (the shell mounts the
// stamp outside routed screens — version.tsx).
//
// Transcript grammar (DESIGN.md, frozen):
//   * her turns   — TurnHer: page text + gilt glyph margin (generated →
//                   Fraunces, INC-19). Computed facts inline in her text are
//                   persisted as `backtick` spans (the transcript grammar for
//                   computed inline material) and render in IBM Plex Mono with
//                   data-provenance="computed" — never styled as her prose.
//   * your turns  — TurnYou: right-aligned, orbglow hairline (orbglow is yours).
//   * tool turns  — §7.3: every recorded DOM write lands in the transcript,
//                   rendered as a quiet Plex Mono line (system material).
//   * plates      — PlateCard: midnight/2 card, computed provenance foot,
//                   Open → the injected `presentPlate` seam (C.3).
//   * absence     — the voice/aside treatment: Fraunces italic (Asleep wake
//                   plate, Error plate, TrialExhausted aside, RateLimited
//                   aside). Every absence string below is the SCREEN.md
//                   frozen copy or a labelled honest absence — no canned
//                   interpretation anywhere (INC-19).
//
// Composer gating (§9.2, §7.4): TrialExhausted replaces the composer with her
// aside + gilt "Unlock natally" + quiet "or enter a code"; RateLimited keeps
// the composer (the gate is on readings, not on her — §7.4) and shows the
// next-reading aside. The composer renders disabled while the engine is
// asleep, erroring, or mid-generation — an inert control never pretends.
//
// All deps are injected (structural shapes in ./types.ts): the C.4 bus, the
// B.1 `GateResult` mirror (TrialGateResult), the X.1 transcript view,
// presentPlate / onSend / onUnlock / onEnterCode / onDownloadModel / onRetry
// seams. ./index.ts is the route module with the documented default bindings.

import type { Turn } from "@natally/lore/types";
import {
  type FocusEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { CompanionBus, StageState } from "../../companion/bus";
import { Button, Chip, Composer, PlateCard, TopBar, TurnHer, TurnYou } from "../../ui/primitives";
import { Stage } from "../../ui/stage";
import type { ConversationPlate, PersonRef, TranscriptSink, TrialGateResult } from "./types";
import { type ConversationVariant, deriveVariant, formatGateInstant } from "./variant";

// ---------------------------------------------------------------------------
// Frozen type ramp fragments (TOKENS.md text styles)
// ---------------------------------------------------------------------------

const MONO_MICRO = [
  "font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace]",
  "text-[12px] leading-[16px]",
].join(" ");
const MONO_INLINE = "font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[14px]";
const ASIDE = [
  "font-[family-name:'Fraunces',serif] italic text-[16px] leading-[24px]",
  "text-[var(--color-vellum)]",
].join(" ");

// ---------------------------------------------------------------------------
// INC-19 inline renderer: computed facts in her turns → Plex Mono
// ---------------------------------------------------------------------------

/**
 * Splits her turn text on the transcript grammar's `` `computed` `` spans.
 * Even indexes are her generated prose (inherits the TurnHer type); odd
 * indexes are computed facts and render in Plex Mono, labelled computed.
 */
export function ComputedInline({ text }: { readonly text: string }): ReactElement {
  const parts = text.split(/`([^`]+)`/g);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} data-provenance="computed" className={MONO_INLINE}>
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Turn renderers
// ---------------------------------------------------------------------------

function TurnView({
  turn,
  spoken,
}: {
  readonly turn: Turn;
  readonly spoken: boolean;
}): ReactElement {
  if (turn.role === "her") {
    return (
      <div data-speaking={spoken ? "true" : "false"}>
        <TurnHer name="natally">
          <ComputedInline text={turn.text} />
        </TurnHer>
      </div>
    );
  }
  if (turn.role === "you") {
    return <TurnYou>{turn.text}</TurnYou>;
  }
  // role "tool" — §7.3: recorded DOM writes land in the transcript, quiet mono.
  return (
    <p
      data-turn="tool"
      data-provenance="computed"
      className={`m-0 ${MONO_MICRO} text-[var(--color-vellum-muted)]`}
    >
      {turn.text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Absence plates and asides (frozen SCREEN.md copy)
// ---------------------------------------------------------------------------

function WakePlate({
  modelId,
  onDownload,
}: {
  readonly modelId: string;
  readonly onDownload: () => void;
}): ReactElement {
  return (
    <section
      data-testid="wake-plate"
      className="flex flex-col gap-3 self-start rounded-[var(--radius-plate)] border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)] bg-[var(--color-midnight-2)] p-4"
    >
      <p data-absence="asleep" className={`m-0 ${ASIDE}`}>
        natally wakes once her model is on this device.
      </p>
      <p data-testid="model-row" className={`m-0 ${MONO_MICRO} text-[var(--color-vellum-muted)]`}>
        {modelId.length > 0 ? (
          <>
            <span>Trial model </span>
            <span data-provenance="computed">{modelId}</span>
          </>
        ) : (
          <span data-absence="model-unconfigured">no model configured</span>
        )}
      </p>
      <Button
        variant="primary"
        data-testid="download-model"
        onClick={onDownload}
        className="self-start"
      >
        Download
      </Button>
    </section>
  );
}

function ErrorPlate({
  detail,
  onRetry,
}: {
  readonly detail: string | undefined;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <section
      data-testid="error-plate"
      className="flex flex-col gap-3 self-start rounded-[var(--radius-plate)] border-[length:var(--stroke-hairline)] border-[color:var(--color-ember)] bg-[var(--color-midnight-2)] p-4"
    >
      <p
        data-testid="error-reason"
        data-provenance="computed"
        className={`m-0 ${MONO_MICRO} text-[var(--color-vellum)]`}
      >
        {detail ?? (
          <span data-absence="reason-unavailable">the engine failed without a reason</span>
        )}
      </p>
      <Button variant="primary" data-testid="try-again" onClick={onRetry} className="self-start">
        Try again
      </Button>
    </section>
  );
}

function TrialExhaustedBlock({
  onUnlock,
  onEnterCode,
}: {
  readonly onUnlock: () => void;
  readonly onEnterCode: () => void;
}): ReactElement {
  return (
    <div data-testid="trial-exhausted" className="flex flex-col gap-2 px-4 pb-4">
      <p data-absence="trial-exhausted" className={`m-0 ${ASIDE}`}>
        Your three trial readings are used.
      </p>
      <Button variant="primary" data-testid="unlock" onClick={onUnlock} className="self-start">
        Unlock natally
      </Button>
      <Button variant="quiet" data-testid="enter-code" onClick={onEnterCode} className="self-start">
        or enter a code
      </Button>
    </div>
  );
}

function RateLimitedAside({
  nextReadingAt,
}: {
  readonly nextReadingAt: number | undefined;
}): ReactElement {
  return (
    <p data-testid="rate-limit-aside" data-absence="rate-limited" className={`m-0 ${ASIDE}`}>
      {"your next reading unlocks "}
      <span data-provenance="computed" className={MONO_INLINE}>
        {nextReadingAt === undefined ? (
          <span data-absence="date-unavailable">a date this device cannot compute</span>
        ) : (
          formatGateInstant(nextReadingAt)
        )}
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Context chip (TopBar slot)
// ---------------------------------------------------------------------------

function ContextChip({
  gate,
  person,
  people,
}: {
  readonly gate: TrialGateResult;
  readonly person: PersonRef | undefined;
  readonly people: readonly PersonRef[] | undefined;
}): ReactNode {
  if (gate.state !== "licensed") {
    const label = gate.remaining === undefined ? "Trial" : `Trial · ${gate.remaining}`;
    return (
      <Chip data-testid="trial-chip" data-gate={gate.state}>
        {label}
      </Chip>
    );
  }
  if (people !== undefined && people.length > 0) {
    return (
      <>
        {people.map((one) => (
          <Chip key={one.id} data-testid="person-chip">
            {one.name}
          </Chip>
        ))}
      </>
    );
  }
  if (person !== undefined) {
    return <Chip data-testid="person-chip">{person.name}</Chip>;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Screen props
// ---------------------------------------------------------------------------

export type ConversationScreenProps = {
  /** The C.4 companion bus — the Stage's and transcript's live feed. */
  readonly bus: CompanionBus;
  /** The B.1 gate result (§9.2); carries `remaining` / `nextReadingAt`. */
  readonly gate: TrialGateResult;
  /** The X.1 transcript view, hydrated once at mount. */
  readonly sink: TranscriptSink;
  /** The send seam: the wiring records your turn and the pipeline answers. */
  readonly onSend: (text: string) => void;
  /** C.3's seam: Open slides the plate into the Atlas panel. */
  readonly presentPlate: (plateId: string) => void;
  /** TrialExhausted "Unlock natally" (routes to /paywall in the wiring). */
  readonly onUnlock: () => void;
  /** TrialExhausted "or enter a code" (routes to /checkout in the wiring). */
  readonly onEnterCode: () => void;
  /** Asleep Download (the M.1 mirror download seam). */
  readonly onDownloadModel: () => void;
  /** Error "Try again" (the engine restart seam). */
  readonly onRetry: () => void;
  /** The designated model id for the Asleep model row (§9.1 trialModel). */
  readonly modelId?: string;
  /** The person this conversation is scoped to (context chip, licensed). */
  readonly person?: PersonRef;
  /** Desktop pair (Robin + Sam, STATE-LEDGER Desktop 26:430). */
  readonly people?: readonly PersonRef[];
  /** Plates laid on the page (§5 Plate, in-transcript cards). */
  readonly plates?: readonly ConversationPlate[];
  /** The desktop composition (Stage fixed 430, centred). */
  readonly desktop?: boolean;
  /** Honors prefers-reduced-motion (passed through to the Stage). */
  readonly reducedMotion?: boolean;
};

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function ConversationScreen({
  bus,
  gate,
  sink,
  onSend,
  presentPlate,
  onUnlock,
  onEnterCode,
  onDownloadModel,
  onRetry,
  modelId = "",
  person,
  people,
  plates,
  desktop = false,
  reducedMotion = false,
}: ConversationScreenProps): ReactElement {
  // Stage state: the bus's replay-buffered derivation is the sole source.
  const busState: StageState = useSyncExternalStore(
    (onChange) => bus.stageState$.subscribe(onChange),
    () => bus.stageState$.current(),
  );

  // Transcript: hydrated once from the X.1 view, then fed by C.4 `turn`
  // events (deduped by id — the transcript is immutable history).
  const [turns, setTurns] = useState<readonly Turn[]>(() => sink.list());
  const [draft, setDraft] = useState<
    { readonly turnId: string; readonly text: string } | undefined
  >(undefined);
  const [value, setValue] = useState("");
  const [listening, setListening] = useState(false);

  useEffect(
    () =>
      bus.subscribe("token", (event) => {
        setDraft((previous) =>
          previous?.turnId === event.turnId
            ? { turnId: previous.turnId, text: previous.text + event.text }
            : { turnId: event.turnId, text: event.text },
        );
      }),
    [bus],
  );
  useEffect(
    () =>
      bus.subscribe("turn", (event) => {
        setDraft((previous) => (previous?.turnId === event.turn.id ? undefined : previous));
        setTurns((previous) =>
          previous.some((one) => one.id === event.turn.id) ? previous : [...previous, event.turn],
        );
      }),
    [bus],
  );

  const variant: ConversationVariant = deriveVariant({ stage: busState.stage, gate, desktop });

  // Composer gating (§9.2 / §7.4): TrialExhausted replaces the composer; the
  // engine states render it disabled — inert, never pretending.
  const composerReplaced = gate.state === "trial-exhausted";
  const composerDisabled =
    busState.stage === "asleep" || busState.stage === "error" || busState.stage === "thinking";

  function send(): void {
    const text = value.trim();
    if (text.length === 0 || composerDisabled) {
      return;
    }
    onSend(text);
    setValue("");
  }

  function composerFocus(event: FocusEvent<HTMLDivElement>): void {
    // STATES.md `listening`: composer focus is a UI event, host-entered.
    if (event.type === "focus") {
      setListening(true);
    } else {
      setListening(false);
    }
  }

  // The line being spoken: the streaming draft, else her latest turn.
  const spokenTurnId =
    draft?.turnId ?? [...turns].reverse().find((one) => one.role === "her")?.id ?? "";

  return (
    <div
      data-screen="conversation"
      data-variant={variant}
      className="flex min-h-dvh flex-col bg-[var(--color-midnight)] text-[var(--color-vellum)]"
    >
      <TopBar chip={<ContextChip gate={gate} person={person} people={people} />} />
      <main
        className={
          desktop ? "flex flex-1 flex-row items-stretch gap-6 px-6 py-4" : "flex flex-1 flex-col"
        }
      >
        <div
          data-testid="stage-mount"
          className={
            desktop
              ? "w-[430px] shrink-0 self-center [&_img]:h-auto [&_img]:w-full"
              : "w-[var(--size-stage)] self-center [&_img]:h-auto [&_img]:w-full"
          }
        >
          <Stage bus={bus} reducedMotion={reducedMotion} listening={listening} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            role="log"
            aria-label="Conversation transcript"
            data-testid="transcript"
            className="flex flex-1 flex-col gap-1 px-4 py-2"
          >
            {busState.stage === "asleep" ? (
              <WakePlate modelId={modelId} onDownload={onDownloadModel} />
            ) : null}
            {busState.stage === "error" ? (
              <ErrorPlate detail={busState.detail} onRetry={onRetry} />
            ) : null}
            {turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} spoken={turn.id === spokenTurnId} />
            ))}
            {draft === undefined ? null : draft.text.length === 0 ? (
              <p
                data-testid="streaming-indicator"
                aria-live="polite"
                className={`m-0 ${MONO_MICRO} text-[var(--color-vellum-muted)]`}
              >
                natally is writing
              </p>
            ) : (
              <div data-testid="streaming-turn" data-turn-id={draft.turnId}>
                <TurnHer name="natally">
                  <ComputedInline text={draft.text} />
                </TurnHer>
              </div>
            )}
            {(plates ?? []).map((plate) => (
              <PlateCard
                key={plate.id}
                title={plate.title}
                provenance={plate.provenance}
                onOpen={() => {
                  presentPlate(plate.id);
                }}
              >
                <p
                  data-provenance="computed"
                  className={`m-0 ${MONO_MICRO} text-[var(--color-vellum-muted)]`}
                >
                  {plate.kind} · chart {plate.chartId}
                </p>
              </PlateCard>
            ))}
            {variant === "rate-limited" ? (
              <RateLimitedAside nextReadingAt={gate.nextReadingAt} />
            ) : null}
          </div>
          {composerReplaced ? (
            <TrialExhaustedBlock onUnlock={onUnlock} onEnterCode={onEnterCode} />
          ) : (
            <div className="px-4 pb-4" onFocusCapture={composerFocus} onBlurCapture={composerFocus}>
              <Composer
                value={value}
                onValueChange={setValue}
                onSend={send}
                disabled={composerDisabled}
                placeholder="Ask natally"
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
