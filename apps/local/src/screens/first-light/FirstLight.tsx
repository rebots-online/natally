import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { GazetteerEntry } from "../../content/index.js";
import "./first-light.css";

export interface IntakeDraft {
  readonly name: string;
  readonly date: string;
  readonly time: string | null;
  readonly unknownTime: boolean;
  readonly placeId: string | null;
}

export interface FirstLightProps {
  readonly gazetteer: readonly GazetteerEntry[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCreate: (draft: IntakeDraft) => void;
}

export const QUESTION_SEQUENCE = [
  { kind: "name", prompt: "What may I call you?", type: "text", placeholder: "your name…" },
  { kind: "date", prompt: "When were you born?", type: "date", placeholder: "" },
  { kind: "place", prompt: "Where were you born?", type: "text", placeholder: "a city…" },
  { kind: "time", prompt: "What time were you born?", type: "time", placeholder: "" },
] as const;

const stars = Array.from({ length: 24 }, (_, index) => {
  const seed = (multiplier: number) => (Math.sin((index + 1) * multiplier) + 1) / 2;
  return {
    id: index,
    x: seed(127.1) * 100,
    y: seed(311.7) * 100,
    size: 1 + seed(73.3) * 2,
    duration: 8 + seed(19.9) * 12,
    delay: seed(53.1) * -8,
  };
});

const normalizePlaceLabel = (value: string) =>
  value.trim().normalize("NFC").toLocaleLowerCase("en");

/** U.4-TW: clean-room presentation; the existing composition still owns persistence. */
export function FirstLight({ gazetteer, busy, error, onCreate }: FirstLightProps) {
  const id = useId();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ name: "", date: "", place: "", time: "" });
  const [unknownTime, setUnknownTime] = useState(false);
  const [typed, setTyped] = useState({ step: -1, count: 0 });
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [selection, setSelection] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const composition = useRef(false);
  const advancing = useRef(false);
  const sent = useRef(false);
  const current = QUESTION_SEQUENCE[step] ?? QUESTION_SEQUENCE[0];
  const answer = answers[current.kind];
  const count = reducedMotion ? current.prompt.length : typed.step === step ? typed.count : 0;
  const promptDone = count >= current.prompt.length;
  const enabled = !busy && !submitted && !(current.kind === "time" && unknownTime);
  const textInput = current.type === "text";
  const placeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of gazetteer) {
      const base = normalizePlaceLabel(`${entry.name}, ${entry.countryCode}`);
      counts.set(base, (counts.get(base) ?? 0) + 1);
    }
    return gazetteer.map((entry) => {
      const base = `${entry.name}, ${entry.countryCode}`;
      return {
        entry,
        label: (counts.get(normalizePlaceLabel(base)) ?? 0) > 1 ? `${base} — ${entry.tzid}` : base,
      };
    });
  }, [gazetteer]);
  const match = placeOptions.find(
    (option) => normalizePlaceLabel(option.label) === normalizePlaceLabel(answers.place),
  );
  const invalidPlace = current.kind === "place" && answers.place.trim().length > 0 && !match;
  const valid =
    current.kind === "name"
      ? answer.trim().length > 0
      : current.kind === "date"
        ? /^\d{4}-\d{2}-\d{2}$/.test(answer) && answer >= "1800-01-01" && answer <= "2400-12-31"
        : current.kind === "place"
          ? match !== undefined
          : unknownTime || /^([01]\d|2[0-3]):[0-5]\d$/.test(answer);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    advancing.current = false;
    composition.current = false;
    setScroll(0);
    setTyped({ step, count: 0 });
    if (reducedMotion) return;
    let revealed = 0;
    const timer = window.setInterval(() => {
      revealed += 1;
      setTyped({ step, count: revealed });
      if (revealed >= current.prompt.length) window.clearInterval(timer);
    }, 55);
    return () => window.clearInterval(timer);
  }, [step, current.prompt, reducedMotion]);

  useEffect(() => {
    if (promptDone && enabled && input.current?.id === `first-light-${current.kind}`)
      input.current.focus();
  }, [promptDone, current.kind, enabled]);

  useEffect(() => {
    if (error && !busy) {
      sent.current = false;
      setSubmitted(false);
    }
  }, [busy, error]);

  const syncCaret = (field: HTMLInputElement) => {
    setSelection(field.selectionStart ?? field.value.length);
    setScroll(field.scrollLeft);
  };

  const advance = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!promptDone || !valid || busy || sent.current || composition.current || advancing.current)
      return;
    if (!event.currentTarget.checkValidity()) return;
    if (step < QUESTION_SEQUENCE.length - 1) {
      advancing.current = true;
      setStep(step + 1);
      return;
    }
    if (!match) return;
    sent.current = true;
    setSubmitted(true);
    onCreate({
      name: answers.name.trim(),
      date: answers.date,
      time: unknownTime ? null : answers.time,
      unknownTime,
      placeId: match.entry.id,
    });
  };

  return (
    <section className="first-light" aria-label="First light">
      <div className="first-light__backdrop" aria-hidden="true">
        <div className="first-light__aura" />
        <svg
          className="first-light__veins"
          viewBox="0 0 1000 1000"
          preserveAspectRatio="xMidYMid slice"
        >
          <title>Decorative gold veins</title>
          <defs>
            <path
              id={`${id}-vein`}
              d="M80 0 138 180 108 330 195 470 160 620 225 800 200 1000 M138 180 270 225 335 350 M108 330 35 425 0 560 M160 620 310 680 375 825 M1000 100 885 235 930 380 810 510 860 710 780 1000 M885 235 745 290 710 420 M810 510 680 560 615 720 M860 710 980 785 1000 900"
            />
            <filter id={`${id}-glow`}>
              <feGaussianBlur stdDeviation="8" />
            </filter>
          </defs>
          <use href={`#${id}-vein`} stroke="#E8A33D" strokeWidth="6" filter={`url(#${id}-glow)`} />
          <use href={`#${id}-vein`} stroke="#FFE08A" strokeWidth="1.8" />
        </svg>
        {stars.map((star) => (
          <span
            key={star.id}
            className="first-light__star"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: star.size,
              height: star.size,
              animationDuration: `${star.duration}s`,
              animationDelay: `${star.delay}s`,
            }}
          />
        ))}
      </div>
      <div className="first-light__content">
        <h1 className="first-light__prompt">
          <span className="first-light__sr">{current.prompt}</span>
          <span aria-hidden="true">
            {current.prompt.slice(0, count)}
            {!promptDone && <span className="first-light__caret" />}
          </span>
        </h1>
        {promptDone && (
          <form
            className="first-light__form"
            onSubmit={advance}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.nativeEvent.isComposing ||
                  composition.current ||
                  event.repeat ||
                  event.nativeEvent.keyCode === 229)
              )
                event.preventDefault();
            }}
          >
            <div className="first-light__answer" data-picker={!textInput}>
              <input
                key={current.kind}
                ref={input}
                id={`first-light-${current.kind}`}
                className="first-light__field"
                aria-label={current.prompt}
                aria-invalid={invalidPlace || undefined}
                aria-describedby={invalidPlace ? `${id}-place-error` : undefined}
                type={current.type}
                value={answer}
                autoComplete="off"
                list={current.kind === "place" ? `${id}-places` : undefined}
                min={current.kind === "date" ? "1800-01-01" : undefined}
                max={current.kind === "date" ? "2400-12-31" : undefined}
                disabled={!enabled}
                required={!(current.kind === "time" && unknownTime)}
                onChange={(event) => {
                  const field = event.currentTarget;
                  setAnswers({ ...answers, [current.kind]: field.value });
                  syncCaret(field);
                }}
                onSelect={(event) => syncCaret(event.currentTarget)}
                onScroll={(event) => syncCaret(event.currentTarget)}
                onFocus={(event) => syncCaret(event.currentTarget)}
                onCompositionStart={() => {
                  composition.current = true;
                }}
                onCompositionEnd={() => {
                  composition.current = false;
                }}
              />
              {textInput && (
                <div className="first-light__mirror" aria-hidden="true">
                  <span
                    className="first-light__mirror-text"
                    style={{ transform: `translateX(${-scroll}px)` }}
                  >
                    {answer ? (
                      <>
                        <span className="first-light__invisible">{answer.slice(0, selection)}</span>
                        {enabled && <span className="first-light__caret" />}
                        <span className="first-light__invisible">{answer.slice(selection)}</span>
                      </>
                    ) : (
                      <>
                        <span className="first-light__placeholder">{current.placeholder}</span>
                        {enabled && <span className="first-light__caret" />}
                      </>
                    )}
                  </span>
                </div>
              )}
              {!textInput && enabled && (
                <span className="first-light__picker-caret first-light__caret" aria-hidden="true" />
              )}
            </div>
            {current.kind === "place" && (
              <>
                <datalist id={`${id}-places`}>
                  {placeOptions.map(({ entry, label }) => (
                    <option key={entry.id} value={label} />
                  ))}
                </datalist>
                {invalidPlace && (
                  <p id={`${id}-place-error`} className="first-light__field-error">
                    Choose a place from the suggestions.
                  </p>
                )}
              </>
            )}
            {current.kind === "time" && (
              <label className="first-light__unknown">
                <input
                  type="checkbox"
                  checked={unknownTime}
                  disabled={busy || submitted}
                  onChange={(event) => setUnknownTime(event.target.checked)}
                />
                I don’t know my birth time
              </label>
            )}
            <div className="first-light__actions">
              {step > 0 && (
                <button
                  type="button"
                  className="first-light__back"
                  disabled={busy || submitted}
                  onClick={() => {
                    advancing.current = true;
                    setStep(step - 1);
                  }}
                >
                  Back
                </button>
              )}
              <button
                className="first-light__submit"
                type="submit"
                disabled={!valid || busy || submitted}
              >
                {busy || submitted
                  ? "Drawing your sky…"
                  : step === QUESTION_SEQUENCE.length - 1
                    ? "Begin"
                    : "Next"}
              </button>
            </div>
          </form>
        )}
        {error && (
          <p className="first-light__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

export default FirstLight;
