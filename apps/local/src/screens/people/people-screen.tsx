// natally — U.4: the people library (SCREEN.md screen-people, normative).
// List (name · Sun sign glyph · birth date · place · time-known marker),
// add a person (J3 — the same first-light intake, via the injected Add seam),
// edit (prefilled intake), remove with the export-first nudge (the J8 export
// seam is offered BEFORE real deletion — §8.4: deletion is real deletion, so
// the nudge stands between the press and peopleRepo.remove), and choose who
// the conversation is about.
//
// The Sun sign glyph is a computed fact (INC-19): it arrives through the
// injected `sunSignOf` resolver (the wiring reads the person's chart facts —
// ephemeris-engine material, never re-derived here). Unresolved ⇒ the row
// shows the honest absence, never a guessed glyph. Everything else is
// authored labelling; no interpretation, no score anywhere.
//
// Deps are injected: the X.1 PeopleRepo (structural type import), the export
// seam (J8 document delivery, wiring-bound), the navigation seams. This
// module registers the two frozen routes it serves: /people and /people/:id
// (the prefilled intake — ./index.ts).

import type { ZodiacSign } from "@natally/design-tokens";
import type { Person } from "@natally/lore/types";
import { type ReactElement, useState } from "react";
import type { PeopleRepo } from "../../data/people";
import { Glyph } from "../../ui/glyphs";
import { Button } from "../../ui/primitives/button";
import { Chip } from "../../ui/primitives/chip";
import { TopBar } from "../../ui/primitives/top-bar";

// ---------------------------------------------------------------------------
// Authored copy (INC-19 provenance `authored`, labelled at render)
// ---------------------------------------------------------------------------

const EMPTY_COPY = "No one here yet. First light — tell natally who the chart is for.";

/** The export-first nudge, shown before a remove is carried out. */
const NUDGE_COPY =
  "Your people are yours. Export them before this one is removed — the row is deleted for real, not hidden.";

const TIME_KNOWN_LABEL = "time known";
const TIME_UNKNOWN_LABEL = "no birth time";

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export type PeopleScreenProps = {
  /** The X.1 people repository — the library's source of truth. */
  readonly peopleRepo: PeopleRepo;
  /**
   * The computed Sun sign per person id (the wiring resolves it from the
   * person's ChartFacts); `undefined` ⇒ the row shows honest absence.
   */
  readonly sunSignOf?: (personId: string) => ZodiacSign | undefined;
  /** J3: opens the first-light intake for a new person. */
  readonly onAdd?: () => void;
  /** Opens the prefilled intake for an existing person (/people/:id). */
  readonly onEdit?: (personId: string) => void;
  /** J8 seam: delivers the export document (wiring-bound; export FIRST). */
  readonly exportAll?: () => Promise<void>;
};

export function PeopleScreen({
  peopleRepo,
  sunSignOf,
  onAdd,
  onEdit,
  exportAll,
}: PeopleScreenProps): ReactElement {
  // Refreshed on every render-affecting action; the repo is the truth, this
  // snapshot only sequences the list rows.
  const [people, setPeople] = useState<readonly Person[]>(() => peopleRepo.list());
  const [pendingRemove, setPendingRemove] = useState<Person | undefined>(undefined);
  const [exported, setExported] = useState(false);

  function refresh(): void {
    setPeople(peopleRepo.list());
  }

  function removePending(): void {
    if (pendingRemove === undefined) {
      return;
    }
    peopleRepo.remove(pendingRemove.id);
    setPendingRemove(undefined);
    refresh();
  }

  async function exportNow(): Promise<void> {
    if (exportAll === undefined) {
      return;
    }
    await exportAll();
    setExported(true);
  }

  const empty = people.length === 0;

  return (
    <div data-testid="people-screen" data-variant={empty ? "empty" : "list"}>
      <TopBar chip={<Chip active>People</Chip>} />
      <div className="mx-auto w-full max-w-[560px] px-4 py-6">
        {onAdd !== undefined ? (
          <div className="mb-4">
            <Button onClick={onAdd} data-testid="people-add">
              Add a person
            </Button>
          </div>
        ) : null}

        {empty ? (
          <p
            data-testid="people-empty"
            data-provenance="authored"
            className="m-0 font-[family-name:'Fraunces',serif] italic text-[16px] leading-[24px] text-[var(--color-vellum-muted)]"
          >
            {EMPTY_COPY}
          </p>
        ) : (
          <ul data-testid="people-list" className="m-0 flex list-none flex-col gap-2 p-0">
            {people.map((person) => {
              const sign = sunSignOf?.(person.id);
              return (
                <li
                  key={person.id}
                  data-testid="person-row"
                  data-person-id={person.id}
                  data-time-known={person.birth.timeKnown ? "true" : "false"}
                  className="flex items-center gap-3 rounded-[var(--radius-chip)] border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)] bg-[var(--color-midnight-3)] px-3 py-2"
                >
                  {sign !== undefined ? (
                    <span aria-hidden="true" className="text-[var(--color-gilt)]">
                      <Glyph name={sign} size={20} />
                    </span>
                  ) : (
                    <span
                      data-testid="person-sign-absent"
                      aria-hidden="true"
                      className="font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[12px] leading-[16px] text-[var(--color-vellum-muted)]"
                    >
                      —
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span
                      data-testid="person-name"
                      className="block font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[16px] leading-[24px] font-semibold text-[var(--color-vellum)]"
                    >
                      {person.name}
                    </span>
                    <span
                      data-testid="person-line"
                      className="block font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[12px] leading-[16px] text-[var(--color-vellum-muted)]"
                    >
                      {person.birth.date} · {person.birth.place}
                    </span>
                  </span>
                  <span
                    data-testid="person-time-marker"
                    className="font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[12px] leading-[16px] text-[var(--color-vellum-muted)]"
                  >
                    {person.birth.timeKnown ? TIME_KNOWN_LABEL : TIME_UNKNOWN_LABEL}
                  </span>
                  {onEdit !== undefined ? (
                    <Button
                      variant="quiet"
                      onClick={() => onEdit(person.id)}
                      data-testid={`person-edit-${person.id}`}
                    >
                      Edit
                    </Button>
                  ) : null}
                  <Button
                    variant="quiet"
                    onClick={() => setPendingRemove(person)}
                    data-testid={`person-remove-${person.id}`}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {pendingRemove !== undefined ? (
          <div
            data-testid="remove-nudge"
            role="dialog"
            aria-label={`Remove ${pendingRemove.name}`}
            className="mt-4 flex flex-col gap-3 rounded-[var(--radius-chip)] border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)] bg-[var(--color-midnight-2)] px-4 py-4"
          >
            <p
              data-testid="remove-nudge-copy"
              data-provenance="authored"
              className="m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[14px] leading-[20px] text-[var(--color-vellum)]"
            >
              {NUDGE_COPY}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {exportAll !== undefined ? (
                <Button
                  variant="secondary"
                  onClick={() => void exportNow()}
                  data-testid="remove-export"
                >
                  Export first
                </Button>
              ) : null}
              <Button onClick={removePending} data-testid="remove-confirm">
                Remove {pendingRemove.name}
              </Button>
              <Button
                variant="quiet"
                onClick={() => setPendingRemove(undefined)}
                data-testid="remove-cancel"
              >
                Cancel
              </Button>
            </div>
            {exported ? (
              <p
                data-testid="remove-exported"
                data-provenance="computed"
                className="m-0 font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[12px] leading-[16px] text-[var(--color-vellum-muted)]"
              >
                export delivered
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
