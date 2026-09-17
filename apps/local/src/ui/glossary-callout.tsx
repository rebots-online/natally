import { type KeyboardEvent, useId, useState } from "react";
import glossaryData from "../data/glossary.json";
import "./glossary-callout.css";

/**
 * U.7 — the shared glossary callout. Entries are the ARCHITECTURE §5 GlossaryEntity:
 { term, body, glyph }, provenance `authored` (INC-19), so every callout renders its
 authored label next to the body. The bundled JSON is validated at module evaluation;
 corruption is an error, never a silently emptied glossary.
 */

export interface GlossaryEntry {
  readonly term: string;
  readonly body: string;
  readonly glyph: string;
}

/** INC-19 authored label rendered with every glossary body. */
export const glossaryProvenance = Object.freeze({
  kind: "authored-static" as const,
  label: "Authored-static education.",
});

const TERMS = ["Ascendant", "Placidus", "Synastry", "Retrograde", "Midheaven"] as const;

function entry(value: unknown, index: number): GlossaryEntry {
  const context = `glossary[${index}]`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${context}: expected an object`);
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    !Object.hasOwn(record, "term") ||
    !Object.hasOwn(record, "body") ||
    !Object.hasOwn(record, "glyph")
  ) {
    throw new TypeError(`${context}: expected exactly term, body, glyph`);
  }
  for (const field of ["term", "body", "glyph"] as const) {
    const text = record[field];
    if (typeof text !== "string" || text.trim().length === 0 || text !== text.trim()) {
      throw new TypeError(`${context}.${field}: expected a nonempty, trimmed string`);
    }
  }
  return Object.freeze({
    term: record.term as string,
    body: record.body as string,
    glyph: record.glyph as string,
  });
}

function load(): readonly GlossaryEntry[] {
  const entries = glossaryData.map(entry);
  const seen = new Set<string>();
  for (const { term } of entries) {
    if (seen.has(term)) throw new TypeError(`glossary: duplicate term ${term}`);
    seen.add(term);
  }
  for (const term of TERMS) {
    if (!seen.has(term)) throw new TypeError(`glossary: missing required term ${term}`);
  }
  return Object.freeze(entries);
}

export const GLOSSARY_ENTRIES: readonly GlossaryEntry[] = load();

export interface GlossaryCalloutProps {
  entry: GlossaryEntry;
  className?: string;
}

/**
 * Hover/focus tooltip showing the entry's authored body. Keyboard-accessible:
 * the trigger is a real button, focus opens the tooltip, Escape closes it, and
 * aria-describedby links trigger to tooltip while it is open.
 */
export function GlossaryCallout({ entry, className = "" }: GlossaryCalloutProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <span className={`ui-glossary ${className}`.trim()}>
      <button
        type="button"
        className="ui-glossary__trigger"
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      >
        <span aria-hidden="true" className="ui-glossary__glyph">
          {entry.glyph}
        </span>
        {entry.term}
        {open && (
          <span role="tooltip" id={tooltipId} className="ui-glossary__tooltip">
            <strong className="ui-glossary__label">{glossaryProvenance.label}</strong>
            {entry.body}
          </span>
        )}
      </button>
    </span>
  );
}
