import { type FormEvent, useId, useState } from "react";
import type { GazetteerEntry } from "../../content/index.js";

/** The operator's draft of themselves; the composition owns validation and charts. */
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

/**
 * U.4 first-light intake on the conversation surface (J1). Input law (operator
 * 2026-09-16): the birth date is a structured picker, never free text; birth time
 * is a picker plus an honest unknown; place picks from the gazetteer so latitude,
 * longitude and timezone come from data, never guesses.
 */
export function FirstLight({ gazetteer, busy, error, onCreate }: FirstLightProps) {
  const listId = useId();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [unknownTime, setUnknownTime] = useState(false);
  const [place, setPlace] = useState("");
  const match = gazetteer.find(
    (entry) => `${entry.name}, ${entry.countryCode}`.toLowerCase() === place.trim().toLowerCase(),
  );
  const ready =
    !busy &&
    name.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    match !== undefined &&
    (!unknownTime ? /^\d{2}:\d{2}$/.test(time) : true);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !match) return;
    onCreate({
      name: name.trim(),
      date,
      time: unknownTime || !time ? null : time,
      unknownTime,
      placeId: match.id,
    });
  };

  return (
    <section className="first-light" aria-label="First light">
      <h1 className="first-light__title">First light</h1>
      <p className="first-light__intro">
        Before natally can read your sky, she needs to know where and when it began. Everything
        stays on this device.
      </p>
      <form className="first-light__form" onSubmit={submit}>
        <label className="first-light__label" htmlFor="first-light-name">
          Your name
        </label>
        <input
          id="first-light-name"
          className="first-light__field"
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          required
        />
        <label className="first-light__label" htmlFor="first-light-date">
          Birth date
        </label>
        <input
          id="first-light-date"
          className="first-light__field"
          type="date"
          value={date}
          min="1800-01-01"
          max="2400-12-31"
          onChange={(event) => setDate(event.target.value)}
          required
        />
        <label className="first-light__label" htmlFor="first-light-time">
          Birth time
        </label>
        <input
          id="first-light-time"
          className="first-light__field"
          type="time"
          value={time}
          disabled={unknownTime}
          onChange={(event) => setTime(event.target.value)}
        />
        <label className="first-light__check">
          <input
            type="checkbox"
            checked={unknownTime}
            onChange={(event) => setUnknownTime(event.target.checked)}
          />{" "}
          I don't know my birth time — she'll read the sky without houses
        </label>
        <label className="first-light__label" htmlFor="first-light-place">
          Birth place
        </label>
        <input
          id="first-light-place"
          className="first-light__field"
          list={listId}
          value={place}
          placeholder="City, country"
          autoComplete="off"
          onChange={(event) => setPlace(event.target.value)}
          required
        />
        <datalist id={listId}>
          {gazetteer.map((entry) => (
            <option key={entry.id} value={`${entry.name}, ${entry.countryCode}`} />
          ))}
        </datalist>
        <button className="first-light__submit" type="submit" disabled={!ready}>
          {busy ? "Drawing your sky…" : "Begin"}
        </button>
        {error ? (
          <p className="first-light__error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

export default FirstLight;
