// natally — U.4: the first-light intake (J1 first run; J3 add-a-person reuses
// the same intake). SCREEN.md screen-first-light is normative: a four-question
// conversation — name → birth date → birth place (snap-to-city) → birth time
// or "I don't know" — with NO progress bar (it is a conversation).
//
//   * each answer returns one instant fact the moment it can be computed,
//     via the injected FirstLightCompute seam (P.4 buildFacts over the §6
//     engine — this screen computes no astronomy itself); when an answer
//     alone yields nothing, the fact line is the honest absence note;
//   * the time question's unknown branch notes the solar-chart consequence
//     (J1: no rising sign, no houses — planets still exact);
//   * a privacy explainer sits under each question, two lanes of authored
//     local wording (what it is used for / computed with; that it stays on
//     the device) — labelled authored, never passed off as computed (INC-19);
//   * completion yields the Person (injected X.1 PeopleRepo; the caller owns
//     identity, so the id comes from the injected newPersonId seam) plus the
//     first ChartFacts (injected compute) — the Sun line renders mono,
//     labelled computed; time unknown ⇒ no house cusps anywhere (§6).
//
// Deps are injected (structural shapes in ./types.ts + the X.1 PeopleRepo
// type); the wiring layer binds the real instances. There is no route in the
// frozen route set for this screen — the wiring mounts it directly (./index.ts).

import { ZODIAC, type ZodiacSign } from "@natally/design-tokens";
import type { ChartFacts } from "@natally/ephemeris/types";
import type { Person } from "@natally/lore/types";
import { type FormEvent, type ReactElement, useId, useState } from "react";
import type { PeopleRepo } from "../../data/people";
import { Glyph, type GlyphName } from "../../ui/glyphs";
import { Button } from "../../ui/primitives/button";
import { Chip } from "../../ui/primitives/chip";
import { TopBar } from "../../ui/primitives/top-bar";
import { TurnHer } from "../../ui/primitives/turn-her";
import { TurnYou } from "../../ui/primitives/turn-you";
import type {
  FirstLightCompute,
  InstantFact,
  IntakeAnswers,
  IntakeStep,
  PlaceSuggestion,
} from "./types";

// ---------------------------------------------------------------------------
// Authored content (INC-19 provenance `authored`, labelled at render)
// ---------------------------------------------------------------------------

/** The four questions, frozen conversation order (SCREEN.md frames). */
const QUESTIONS: Readonly<Record<IntakeStep, string>> = {
  name: "What should I call you?",
  date: "When were you born?",
  place: "Where were you born?",
  time: "Do you know the time you were born?",
};

/**
 * The privacy explainer under each question — two lanes of authored local
 * wording (SCREEN.md: "what it is used for, what it is computed with, that it
 * stays on the device"). The `local` lane is the on-device lane of the local
 * product; the hosted leg would carry its own lane wording.
 */
const PRIVACY_EXPLAINERS: Readonly<
  Record<IntakeStep, { readonly use: string; readonly local: string }>
> = {
  name: {
    use: "Used to label your charts and conversations — never computed with.",
    local: "It stays on this device, in your local database.",
  },
  date: {
    use: "Computed with — it places the planets on your birth date.",
    local: "It stays on this device; the computation runs locally.",
  },
  place: {
    use: "Computed with — it orients the sky for your birthplace.",
    local: "It stays on this device; nothing is sent anywhere.",
  },
  time: {
    use: "Computed with — it derives the Ascendant and the house cusps.",
    local: "It stays on this device — no account, no upload.",
  },
};

const STEP_ORDER: readonly IntakeStep[] = ["name", "date", "place", "time"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}$/;

// ---------------------------------------------------------------------------
// Presentation helpers over computed facts (regrouping only — no new astronomy)
// ---------------------------------------------------------------------------

const SIGN_NAMES: readonly ZodiacSign[] = Object.keys(ZODIAC) as readonly ZodiacSign[];

/** A ZodiacSign's name is a member of the frozen glyph set (the 12 sign glyphs). */
function signGlyph(sign: ZodiacSign): GlyphName {
  return sign;
}

/** The completed chart's Sun: its sign and its degree-in-sign text. */
export type SunFact = {
  readonly sign: ZodiacSign;
  readonly text: string;
};

/** "11.42° Taurus" — the completed chart's Sun, in sign and degree. */
export function sunFact(facts: ChartFacts): SunFact {
  const sun = facts.positions.find((position) => position.body === "sun");
  if (sun === undefined) {
    throw new Error("first-light: the completed chart carries no Sun position");
  }
  const sign = SIGN_NAMES[Math.floor(sun.lon / 30)];
  if (sign === undefined) {
    throw new Error(`first-light: no sign for Sun longitude ${String(sun.lon)}`);
  }
  // Token keys are lowercase; the display name capitalises the word.
  const name = `${sign.charAt(0).toUpperCase()}${sign.slice(1)}`;
  return { sign, text: `${(sun.lon % 30).toFixed(2)}° ${name}` };
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export type FirstLightScreenProps = {
  /** The X.1 people repository — completion writes the Person through it. */
  readonly peopleRepo: PeopleRepo;
  /** The P.4 compute seam: instant facts per answer, ChartFacts at completion. */
  readonly compute: FirstLightCompute;
  /** Identity is the caller's (PeopleRepo contract) — the wiring mints ids. */
  readonly newPersonId: () => string;
  /** J1 (first run) or J3 (add a person) — recorded on the root element. */
  readonly mode?: "first-run" | "add-person";
  /** Edit mode: an existing person, prefilled; completion updates, id kept. */
  readonly initial?: Person;
  /** Snap-to-city suggestions for the place dropdown; unbound ⇒ plain text. */
  readonly placeSuggestions?: (query: string) => Promise<readonly PlaceSuggestion[]>;
  /** Wiring seam: navigates on completion (J1 → home; J3 → back to People). */
  readonly onComplete?: (person: Person, facts: ChartFacts) => void;
  /** Wiring seam: leaves the intake untouched (back out of the add flow). */
  readonly onCancel?: () => void;
};

type Phase = "intake" | "charting" | "done";

type Completion = {
  readonly person: Person;
  readonly facts: ChartFacts;
};

export function FirstLightScreen({
  peopleRepo,
  compute,
  newPersonId,
  mode = "first-run",
  initial,
  placeSuggestions,
  onComplete,
  onCancel,
}: FirstLightScreenProps): ReactElement {
  const inputId = useId();
  const [phase, setPhase] = useState<Phase>("intake");
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<IntakeAnswers>(() => {
    if (initial === undefined) {
      return {};
    }
    return {
      name: initial.name,
      date: initial.birth.date,
      place: initial.birth.place,
      ...(initial.birth.timeKnown && initial.birth.time !== undefined
        ? { time: initial.birth.time }
        : {}),
    };
  });
  const [factsByStep, setFactsByStep] = useState<Partial<Record<IntakeStep, InstantFact>>>({});
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<readonly PlaceSuggestion[]>([]);
  const [completion, setCompletion] = useState<Completion | undefined>(undefined);

  const step: IntakeStep = STEP_ORDER[stepIndex] ?? "name";
  const done = phase !== "intake";

  // Validity of the current draft per step — a disabled control is honest.
  const draftValid =
    step === "name" || step === "place"
      ? draft.trim().length > 0
      : step === "date"
        ? ISO_DATE.test(draft)
        : ISO_TIME.test(draft);

  function advance(next: IntakeAnswers, answeredStep: IntakeStep): void {
    const fact = compute.instantFact(answeredStep, next);
    setFactsByStep((previous) => ({ ...previous, [answeredStep]: fact }));
    setAnswers(next);
    setDraft("");
    setSuggestions([]);
    setStepIndex((index) => Math.min(index + 1, STEP_ORDER.length));
  }

  function submitDraft(event: FormEvent): void {
    event.preventDefault();
    if (phase !== "intake" || !draftValid) {
      return;
    }
    if (step === "time") {
      // The known-time branch: a valid HH:MM completes the intake.
      void completeTime(true);
      return;
    }
    advance({ ...answers, [step]: draft.trim() }, step);
  }

  function pickSuggestion(label: string): void {
    if (phase !== "intake") {
      return;
    }
    advance({ ...answers, place: label }, "place");
  }

  /**
   * The time step's two branches both complete the intake: a known time, or
   * the honest "I don't know" (the solar-chart branch, J1).
   */
  async function completeTime(timeKnown: boolean): Promise<void> {
    if (phase !== "intake") {
      return;
    }
    const next: IntakeAnswers = {
      ...answers,
      timeKnown,
      ...(timeKnown ? { time: draft } : {}),
    };
    advance(next, "time");

    const person: Person = {
      id: initial?.id ?? newPersonId(),
      name: next.name ?? "",
      birth: {
        date: next.date ?? "",
        place: next.place ?? "",
        timeKnown,
        ...(timeKnown ? { time: next.time } : {}),
      },
    };
    setPhase("charting");
    const facts = await compute.chartFacts(person);
    // The repo is the caller's last line of defence: create throws on a
    // duplicate id; update reports whether the row existed.
    if (initial === undefined) {
      peopleRepo.create(person);
    } else if (!peopleRepo.update(person)) {
      throw new Error(`first-light: cannot update missing person ${initial.id}`);
    }
    setCompletion({ person, facts });
    setPhase("done");
    onComplete?.(person, facts);
  }

  function searchPlace(query: string): void {
    setDraft(query);
    if (placeSuggestions === undefined || query.trim().length === 0) {
      setSuggestions([]);
      return;
    }
    void placeSuggestions(query)
      .then((found) => {
        setSuggestions(found);
      })
      .catch(() => {
        // An unresponsive gazetteer is honest absence: plain text still works.
        setSuggestions([]);
      });
  }

  const firstFact = completion === undefined ? undefined : sunFact(completion.facts);

  return (
    <div
      data-testid="first-light-screen"
      data-mode={mode}
      data-phase={phase}
      data-step={done ? "complete" : step}
    >
      <TopBar
        chip={completion === undefined ? undefined : <Chip active>{completion.person.name}</Chip>}
      />
      <div className="mx-auto w-full max-w-[560px] px-4 py-6">
        {STEP_ORDER.map((visited, index) => {
          if (!done && index > stepIndex) {
            return null;
          }
          const answer = answers[visited];
          const fact = factsByStep[visited];
          const isCurrent = !done && index === stepIndex;
          return (
            <div key={visited} data-testid={`intake-${visited}`}>
              <TurnHer name="natally" glyph={visited === "date" ? "sun" : undefined}>
                {QUESTIONS[visited]}
              </TurnHer>
              {/* Privacy explainer: two lanes of authored local wording. */}
              <div
                data-testid={`privacy-${visited}`}
                data-provenance="authored"
                className="mb-2 ml-8 flex flex-col gap-1"
              >
                <p
                  data-lane="use"
                  className="m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[12px] leading-[16px] text-[var(--color-vellum-muted)]"
                >
                  {PRIVACY_EXPLAINERS[visited].use}
                </p>
                <p
                  data-lane="local"
                  className="m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[12px] leading-[16px] text-[var(--color-vellum-muted)]"
                >
                  {PRIVACY_EXPLAINERS[visited].local}
                </p>
              </div>
              {answer !== undefined ? (
                <TurnYou>
                  {visited === "time" && answers.timeKnown === false ? "I don't know" : answer}
                </TurnYou>
              ) : null}
              {fact !== undefined ? (
                fact.provenance === "computed" ? (
                  <p
                    data-testid={`fact-${visited}`}
                    data-provenance="computed"
                    className="m-0 ml-8 flex items-center gap-2 font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[12px] leading-[16px] text-[var(--color-vellum)]"
                  >
                    {fact.glyph !== undefined ? <Glyph name={fact.glyph} size={16} /> : null}
                    {fact.text}
                  </p>
                ) : (
                  <p
                    data-testid={`fact-${visited}`}
                    data-provenance="absence"
                    className="m-0 ml-8 font-[family-name:'Fraunces',serif] italic text-[14px] leading-[20px] text-[var(--color-vellum-muted)]"
                  >
                    {fact.text}
                  </p>
                )
              ) : null}
              {isCurrent ? null : <div className="mb-4" />}
            </div>
          );
        })}

        {phase === "intake" ? (
          <form onSubmit={submitDraft} className="mt-4 flex flex-col gap-3">
            <input
              id={inputId}
              type={step === "date" ? "date" : step === "time" ? "time" : "text"}
              value={draft}
              onChange={(event) =>
                step === "place" ? searchPlace(event.target.value) : setDraft(event.target.value)
              }
              placeholder={step === "place" ? "City" : undefined}
              aria-label={QUESTIONS[step]}
              data-testid="intake-input"
              className="min-h-[var(--size-touch)] w-full rounded-[var(--radius-button)] border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)] bg-[var(--color-midnight-2)] px-4 py-2 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[16px] leading-[24px] text-[var(--color-vellum)] focus-visible:outline focus-visible:outline-[color:var(--color-orbglow)]"
            />
            {step === "place" && suggestions.length > 0 ? (
              <div data-testid="place-suggestions" className="flex flex-col gap-1">
                {suggestions.map((suggestion) => (
                  <Button
                    key={suggestion.label}
                    variant="secondary"
                    onClick={() => pickSuggestion(suggestion.label)}
                    data-testid="place-suggestion"
                  >
                    {suggestion.label}
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!draftValid} data-testid="intake-continue">
                {step === "time" ? "That's the time" : "Continue"}
              </Button>
              {step === "time" ? (
                <Button
                  variant="secondary"
                  onClick={() => void completeTime(false)}
                  data-testid="intake-time-unknown"
                >
                  I don&apos;t know
                </Button>
              ) : null}
              {onCancel !== undefined && stepIndex === 0 ? (
                <Button variant="quiet" onClick={onCancel} data-testid="intake-cancel">
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}

        {phase === "charting" ? (
          <p
            data-testid="charting-status"
            className="m-0 mt-4 font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[12px] leading-[16px] text-[var(--color-vellum-muted)]"
          >
            computing your chart…
          </p>
        ) : null}

        {phase === "done" && completion !== undefined && firstFact !== undefined ? (
          <div
            data-testid="intake-complete"
            data-person-id={completion.person.id}
            className="mt-4 flex flex-col gap-2"
          >
            <p
              data-testid="first-fact"
              data-provenance="computed"
              className="m-0 flex items-center gap-2 font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[14px] leading-[20px] text-[var(--color-vellum)]"
            >
              <Glyph name={signGlyph(firstFact.sign)} size={16} />
              Sun {firstFact.text}
            </p>
            {completion.facts.cusps === undefined ? (
              <p
                data-testid="no-houses"
                data-provenance="absence"
                className="m-0 font-[family-name:'Fraunces',serif] italic text-[14px] leading-[20px] text-[var(--color-vellum-muted)]"
              >
                Time unknown — a solar chart: no rising sign, no house cusps. The planets stay
                exact.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
