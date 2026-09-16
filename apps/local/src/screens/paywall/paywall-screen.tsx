// natally — the paywall screen (U.6, SCREEN.md screen-paywall, normative;
// J10/J11). Where natally offers the unlock, in her voice: TopBar (context
// chip "Trial") · Stage (Idle) · her aside · the "Trial · where you are"
// plate (computed facts, Plex Mono) · the "Unlimited · what it is" plate
// (labelled authored-static education) · ONE gilt primary "Unlock natally" ·
// secondary "Enter a code" · quiet "Restore purchases" · the honest
// processor-availability line. The version stamp is the shell's (version.tsx)
// — a screen never mounts a second one.
//
// Commerce law (DESIGN.md "Commerce surfaces"): exactly one gilt primary per
// screen — the unlock CTA (or, in the enter-code states, the code card's
// "Apply code", which replaces the purchase block); prices, offering names,
// counters, the processor list and failure reasons are runtime data (Plex
// Mono markers); no countdown, no crossed-out prices, no pressure copy.
//
// All deps are injected (structural mirrors in ./types.ts): the B.1 gate
// mirror, the B.5c registry seam (ways-to-pay readout, purchase, redeem),
// the C.4 bus (a valid code publishes `unlock` — the Delighted moment, §10),
// and the handoff/restore/back seams. The wiring (I.1) binds the real
// instances; nothing here invents a state (INC-19).

import type { CheckoutSession } from "@natally/billing";
import { type FormEvent, type ReactElement, type ReactNode, useState } from "react";
import { Button, Chip, TopBar, TurnHer } from "../../ui/primitives";
import { Stage } from "../../ui/stage";
import {
  type EmberSource,
  formatDay,
  type PaywallScreenProps,
  type PaywallVariant,
  paymentsAvailable,
  type RedeemResult,
  redeemReason,
  type TrialGate,
} from "./types";

// ---------------------------------------------------------------------------
// Frozen type ramp fragments (TOKENS.md text styles)
// ---------------------------------------------------------------------------

const MONO_MICRO = [
  "font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace]",
  "text-[12px] leading-[16px]",
].join(" ");
const LABEL = [
  "font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif]",
  "text-[12px] leading-[16px] font-semibold tracking-[0.04em]",
].join(" ");
const CARD = [
  "flex flex-col gap-3 rounded-[var(--radius-plate)]",
  "border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)]",
  "bg-[var(--color-midnight-2)] p-4",
].join(" ");

// ---------------------------------------------------------------------------
// Variant derivation (SCREEN.md `Variants`; the conversation screen's law —
// the desktop name labels the layout frame of the resting base only)
// ---------------------------------------------------------------------------

/**
 * The frozen variant as a pure function of the real inputs: the B.1 gate,
 * the code-card state (entered / errored), and the desktop layout. Pure —
 * no clock, no DOM, no bus reads.
 */
export function derivePaywallVariant(
  gate: TrialGate,
  codeMode: boolean,
  codeErrorShown: boolean,
  desktop: boolean,
): PaywallVariant {
  const resting = gate.state === "trial-active" && !codeMode && !codeErrorShown;
  if (desktop && resting) {
    return "desktop";
  }
  if (gate.state === "licensed") {
    return "already-unlocked";
  }
  if (codeErrorShown) {
    return "code-error";
  }
  if (codeMode) {
    return "enter-code";
  }
  switch (gate.state) {
    case "trial-exhausted":
      return "trial-exhausted";
    case "rate-limited":
      return "rate-limited";
    case "trial-active":
      return "trial-active";
  }
}

/** Her aside, per state — authored in her voice, warm, offered once. */
function asideFor(gate: TrialGate): string {
  switch (gate.state) {
    case "trial-active":
      return "Your trial is still open. Whenever you want the whole sky, the unlock is right here.";
    case "trial-exhausted":
      return "You've used your trial readings. Whenever you're ready, we can keep going.";
    case "rate-limited":
      return "The sky can wait a moment — your next reading opens soon. Everything else stays yours.";
    case "licensed":
      return "You're unlimited. Nothing to buy here — everything from here is ours to explore.";
  }
}

/** The trial plate's computed rows (§9.1/§9.2) — exactly what is real. */
export function trialPlateRows(gate: TrialGate, used: number, limit: number): string[] {
  switch (gate.state) {
    case "rate-limited":
      return gate.nextReadingAt === undefined
        ? ["[next reading · unavailable · runtime]"]
        : [`[next reading · ${formatDay(gate.nextReadingAt)} · runtime]`];
    case "licensed":
      return [];
    case "trial-exhausted":
      return [`[readings used · ${used} of ${limit} · runtime]`];
    case "trial-active":
      return gate.remaining === undefined
        ? [`[readings used · ${used} of ${limit} · runtime]`]
        : [`[readings left · ${gate.remaining} of ${limit} · runtime]`];
  }
}

// ---------------------------------------------------------------------------
// Small owned pieces
// ---------------------------------------------------------------------------

/** A content card in the plate treatment, without the transcript Open action. */
function PaywallPlate(props: {
  readonly title: string;
  readonly children: ReactNode;
  readonly testId: string;
}): ReactElement {
  return (
    <section data-testid={props.testId} className={CARD}>
      <h3 className="m-0 font-[family-name:'Fraunces',serif] text-[18px] leading-[24px] font-semibold text-[var(--color-vellum)]">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function RuntimeLine(props: {
  readonly children: string;
  readonly testId?: string;
  readonly absence?: string;
}): ReactElement {
  return (
    <p
      data-testid={props.testId}
      data-absence={props.absence}
      data-provenance="computed"
      className={`m-0 ${MONO_MICRO} text-[var(--color-vellum-muted)]`}
    >
      {props.children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function PaywallScreen({
  gate,
  trial,
  offering,
  registry,
  bus,
  onHandoff,
  onUnlocked,
  onRestore,
  onBack,
  layout = "mobile",
}: PaywallScreenProps): ReactElement {
  const [codeMode, setCodeMode] = useState(false);
  const [codeValue, setCodeValue] = useState("");
  const [working, setWorking] = useState(false);
  const [ember, setEmber] = useState<{ source: EmberSource; reason: string } | null>(null);

  const codeErrorShown = ember?.source === "redeem";
  const variant = derivePaywallVariant(gate, codeMode, codeErrorShown, layout === "desktop");
  const rails = paymentsAvailable(registry.availableIds);
  const canPurchase = registry.availableIds.length > 0 && offering !== undefined;

  /** Gate→CTA (J10): the first present rail in canonical order, honestly. */
  async function unlock(): Promise<void> {
    const rail = registry.availableIds[0];
    if (rail === undefined || offering === undefined || working) {
      return; // disabled CTA never fires; no fake purchase
    }
    setWorking(true);
    try {
      const session: CheckoutSession = await registry.purchase(rail, offering);
      onHandoff(session);
    } catch (error) {
      setEmber({
        source: "purchase",
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setWorking(false);
    }
  }

  /** Enter-a-code state (J11): the injected B.4 redeem, four outcomes. */
  async function applyCode(event: FormEvent): Promise<void> {
    event.preventDefault();
    const code = codeValue.trim();
    if (code.length === 0 || working) {
      return;
    }
    setWorking(true);
    try {
      const result: RedeemResult = await registry.redeem(code);
      if (result.outcome === "valid") {
        bus.publish({ type: "unlock" }); // Delighted on unlock (§10)
        onUnlocked?.();
      } else {
        setEmber({ source: "redeem", reason: redeemReason(result) });
      }
    } finally {
      setWorking(false);
    }
  }

  const licensed = gate.state === "licensed";
  const aside = asideFor(gate);

  return (
    <div
      data-screen="paywall"
      data-variant={variant}
      data-layout={layout}
      className="mx-auto flex w-full max-w-[430px] flex-col gap-4 px-4 pb-16 pt-4"
    >
      <TopBar chip={<Chip data-testid="paywall-chip">Trial</Chip>} />
      <Stage bus={bus} />

      <TurnHer name="natally">{aside}</TurnHer>

      {ember !== null && (
        <p
          data-testid="paywall-ember"
          data-ember-source={ember.source}
          data-reason={ember.reason}
          className={`m-0 ${MONO_MICRO} text-[var(--color-ember)]`}
        >
          [{ember.reason} · runtime]
        </p>
      )}

      {!licensed && (
        <PaywallPlate title="Trial · where you are" testId="paywall-plate-trial">
          <div className="flex flex-col gap-1">
            {trialPlateRows(gate, trial.used, trial.limit).map((row) => (
              <RuntimeLine key={row}>{row}</RuntimeLine>
            ))}
            <RuntimeLine>{`[trial model · ${trial.trialModel} · runtime]`}</RuntimeLine>
          </div>
        </PaywallPlate>
      )}

      <PaywallPlate title="Unlimited · what it is" testId="paywall-plate-unlimited">
        <p className={`m-0 ${LABEL} text-[var(--color-vellum-muted)]`}>What it is</p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          <li className="text-[14px] leading-[20px] text-[var(--color-vellum)]">
            Readings — every conversation, uncounted.
          </li>
          <li className="text-[14px] leading-[20px] text-[var(--color-vellum)]">
            Models — the whole catalogue, not only the trial model.
          </li>
          <li className="text-[14px] leading-[20px] text-[var(--color-vellum)]">
            Lore — your story graph, kept and shared with her.
          </li>
          <li className="text-[14px] leading-[20px] text-[var(--color-vellum)]">
            Voice — Kokoro, hers, on every leg.
          </li>
        </ul>
        <RuntimeLine testId="paywall-offering">
          {offering === undefined
            ? "[offering · unavailable · runtime]"
            : `[${offering.id} · ${offering.priceString} · runtime]`}
        </RuntimeLine>
      </PaywallPlate>

      {licensed ? (
        <Button data-testid="paywall-back" onClick={onBack}>
          Back to our conversation
        </Button>
      ) : codeMode ? (
        <form onSubmit={applyCode} className="flex flex-col gap-2">
          <div className={CARD}>
            <input
              data-testid="paywall-code-input"
              value={codeValue}
              onChange={(event) => {
                setCodeValue(event.target.value);
                if (ember?.source === "redeem") {
                  setEmber(null); // an edited code is no longer the judged one
                }
              }}
              placeholder="[your code · runtime]"
              aria-label="Your code"
              className="w-full rounded-[var(--radius-button)] border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)] bg-[var(--color-midnight)] px-3 py-2 font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[14px] leading-[20px] text-[var(--color-vellum)] focus-visible:outline focus-visible:outline-[color:var(--color-orbglow)]"
            />
            <p className="m-0 text-[14px] leading-[20px] text-[var(--color-vellum-muted)]">
              Single-use and hash-based codes both work.
            </p>
            <Button data-testid="paywall-apply-code" type="submit" disabled={working}>
              Apply code
            </Button>
          </div>
        </form>
      ) : (
        <>
          <Button data-testid="paywall-unlock" onClick={unlock} disabled={!canPurchase || working}>
            Unlock natally
          </Button>
          <Button
            data-testid="paywall-enter-code"
            variant="secondary"
            onClick={() => {
              setCodeMode(true);
              setEmber(null);
            }}
          >
            Enter a code
          </Button>
          <Button
            data-testid="paywall-restore"
            variant="quiet"
            onClick={onRestore}
            disabled={onRestore === undefined}
          >
            Restore purchases
          </Button>
        </>
      )}

      {!licensed && (
        <RuntimeLine
          testId="paywall-ways-to-pay"
          absence={rails.length === 0 ? "rails-absent" : undefined}
        >
          {rails.length === 0
            ? "No payment rails are wired on this install."
            : `Ways to pay: ${rails.join(" · ")}`}
        </RuntimeLine>
      )}
    </div>
  );
}
