// natally — the Atlas (U.3). The full instrument for one chart, in three
// views (SCREEN.md screen-atlas-natal / -synastry / -today, normative):
//
//   natal    — wheel + Positions (body · sign · degree · house · speed) +
//              Houses (cusp · sign · degree) + Aspects + the 12-house-system
//              chip selector. timeUnknown ⇒ the Houses table is replaced by
//              the honest-absence treatment (J1/J3: solar chart, no cusps,
//              no ASC/MC anywhere that person appears); engine error ⇒ the
//              ember reason line, no fabricated facts.
//   synastry — two people (J4): bi-wheel (A inner, B outer), cross-aspect
//              table, house overlays in BOTH directions, each direction
//              honest about a missing birth time (one-directional overlays,
//              J4). NO score, NO compatibility label — ever (INC-19).
//   today    — today's sky against one natal chart (J5): bi-wheel, hits list
//              (transit body · aspect · natal body · orb · motion), date and
//              place of "now"; no person ⇒ absence with a People action.
//
// The screen is props-driven: data arrives already computed from the
// EphemerisEngine seam (§6) — this module computes no astronomy. The route
// adapter (atlas-route.tsx) mounts it for /atlas/:plate and renders the
// labelled honest absence until the app data provider hands it records.

import type { Aspect, ChartFacts, HouseSystem } from "@natally/ephemeris/types";
import type { Person } from "@natally/lore/types";
import type { ReactElement, ReactNode } from "react";
import { Glyph } from "../../ui/glyphs";
import { Button } from "../../ui/primitives/button";
import { Chip } from "../../ui/primitives/chip";
import { TopBar } from "../../ui/primitives/top-bar";
import { AspectsTable, HouseSystemPicker, Wheel } from "../../ui/wheel";
import {
  chartMomentIso,
  formatDegree,
  formatPlace,
  formatSpeed,
  houseOf,
  isRetrograde,
  signOf,
} from "./chart-math";

/** The three Atlas views (SCREEN.md set). */
export type AtlasView = "natal" | "synastry" | "today";

export type AtlasScreenProps = {
  /** Route params; `plate` is the deep-linked plate id (J9). */
  readonly params: Readonly<Record<string, string>>;
  readonly view: AtlasView;
  /** The chart owner (natal/today) or person A (synastry). */
  readonly person?: Person;
  /** The owner's computed facts (natal/today) or person A's (synastry). */
  readonly facts?: ChartFacts;
  /** Engine failure reason (atlas-natal `engine error` variant). */
  readonly error?: string;
  /** Person B (synastry). */
  readonly otherPerson?: Person;
  /** Person B's computed facts (synastry). */
  readonly otherFacts?: ChartFacts;
  /** Cross-chart aspects, computed behind the §6 seam by the caller. */
  readonly crossAspects?: readonly Aspect[];
  /** Today's sky (the bi-wheel outer ring / transit chart). */
  readonly todayFacts?: ChartFacts;
  /** Transit hits, computed behind the §6 seam by the caller. */
  readonly hits?: readonly Aspect[];
  /** Controlled house-system selection (the chip selector). */
  readonly houseSystem?: HouseSystem;
  readonly onHouseSystemSelect?: (system: HouseSystem) => void;
  /** J5: the People action inside the no-person absence. */
  readonly onOpenPeople?: () => void;
  /** J9: back returns to the conversation at the same scroll. */
  readonly onBack?: () => void;
};

function Absence({
  reason,
  children,
}: {
  readonly reason: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div className="natally-absence" data-absence={reason}>
      <p className="m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[14px] leading-[20px] text-[var(--color-vellum-muted)]">
        {children}
      </p>
    </div>
  );
}

function PeopleAction({
  onOpenPeople,
}: {
  readonly onOpenPeople?: () => void;
}): ReactElement | null {
  if (onOpenPeople === undefined) {
    return null;
  }
  return (
    <Button variant="secondary" onClick={onOpenPeople} data-testid="atlas-people-action">
      People
    </Button>
  );
}

function SectionHeading({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <h4 className="m-0 mb-2 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[14px] leading-[20px] font-semibold text-[var(--color-vellum)]">
      {children}
    </h4>
  );
}

const MONO_TABLE =
  "w-full border-collapse font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[12px] leading-[16px] text-[var(--color-vellum)]";

function PositionsTable({ facts }: { readonly facts: ChartFacts }): ReactElement {
  return (
    <section data-testid="positions-table">
      <SectionHeading>Positions</SectionHeading>
      <table className={MONO_TABLE}>
        <thead>
          <tr className="text-left text-[var(--color-vellum-muted)]">
            <th scope="col" className="py-1 pr-2 font-semibold">
              Body
            </th>
            <th scope="col" className="py-1 pr-2 font-semibold">
              Sign
            </th>
            <th scope="col" className="py-1 pr-2 font-semibold">
              Degree
            </th>
            <th scope="col" className="py-1 pr-2 font-semibold">
              House
            </th>
            <th scope="col" className="py-1 font-semibold">
              Speed
            </th>
          </tr>
        </thead>
        <tbody>
          {facts.positions.map((position) => {
            const cusps = facts.cusps;
            return (
              <tr
                key={position.body}
                data-testid="position-row"
                data-body={position.body}
                data-sign={signOf(position.lon)}
                data-degree={formatDegree(position.lon)}
                data-house={
                  cusps === undefined ? "absent" : String(houseOf(position.lon, cusps.cusps))
                }
                data-speed={formatSpeed(position.speed)}
                className="border-t-[length:var(--stroke-hairline)] border-t-[color:var(--color-hairline)]"
              >
                <td className="py-1 pr-2">{position.body}</td>
                <td className="py-1 pr-2">{signOf(position.lon)}</td>
                <td className="py-1 pr-2">{formatDegree(position.lon)}</td>
                <td className="py-1 pr-2">
                  {cusps === undefined ? "—" : String(houseOf(position.lon, cusps.cusps))}
                </td>
                <td className="py-1">
                  {formatSpeed(position.speed)}
                  {isRetrograde(position) ? (
                    <span className="ml-1 inline-flex align-middle">
                      <Glyph name="retrograde" size={12} />
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function HousesTable({ facts }: { readonly facts: ChartFacts }): ReactElement {
  const cusps = facts.cusps;
  if (cusps === undefined) {
    // J1/J3 honest absence: time unknown ⇒ solar chart, no houses anywhere
    // this person appears (SCREEN.md atlas-natal timeUnknown variant).
    return (
      <section data-testid="houses-absence">
        <Absence reason="houses-time-unknown">
          Time unknown — this is a solar chart: no houses, no Ascendant, no MC.
        </Absence>
      </section>
    );
  }
  return (
    <section data-testid="houses-table">
      <SectionHeading>Houses</SectionHeading>
      <table className={MONO_TABLE}>
        <thead>
          <tr className="text-left text-[var(--color-vellum-muted)]">
            <th scope="col" className="py-1 pr-2 font-semibold">
              Cusp
            </th>
            <th scope="col" className="py-1 pr-2 font-semibold">
              Sign
            </th>
            <th scope="col" className="py-1 font-semibold">
              Degree
            </th>
          </tr>
        </thead>
        <tbody>
          {cusps.cusps.map((lambda, index) => (
            <tr
              key={String(index)}
              data-testid="house-row"
              data-house={index + 1}
              data-sign={signOf(lambda)}
              data-degree={formatDegree(lambda)}
              className="border-t-[length:var(--stroke-hairline)] border-t-[color:var(--color-hairline)]"
            >
              <td className="py-1 pr-2">{index + 1}</td>
              <td className="py-1 pr-2">{signOf(lambda)}</td>
              <td className="py-1">{formatDegree(lambda)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function NatalView({
  person,
  facts,
  error,
  houseSystem,
  onHouseSystemSelect,
}: Pick<
  AtlasScreenProps,
  "person" | "facts" | "error" | "houseSystem" | "onHouseSystemSelect"
>): ReactElement {
  if (error !== undefined) {
    return (
      <div className="natally-absence" data-error-detail={error}>
        <p className="m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[14px] leading-[20px] text-[var(--color-ember)]">
          The chart engine failed: {error}
        </p>
      </div>
    );
  }
  if (person === undefined || facts === undefined) {
    return <Absence reason="no-chart">No chart is loaded for this plate yet.</Absence>;
  }
  const system = houseSystem ?? facts.inputs.system;
  return (
    <div className="flex flex-col gap-6">
      <Wheel facts={facts} />
      <PositionsTable facts={facts} />
      <HousesTable facts={facts} />
      <AspectsTable aspects={facts.aspects} heading="Aspects" />
      <section data-testid="house-system-section">
        <SectionHeading>House system</SectionHeading>
        <HouseSystemPicker value={system} onSelect={onHouseSystemSelect} />
      </section>
    </div>
  );
}

function OverlaySection({
  heading,
  movingFacts,
  basePerson,
  baseFacts,
}: {
  readonly heading: string;
  readonly movingFacts: ChartFacts;
  readonly basePerson: Person;
  readonly baseFacts: ChartFacts;
}): ReactElement {
  const baseCusps = baseFacts.cusps;
  if (baseCusps === undefined) {
    // J4 honest absence: overlays INTO a person without a birth time are not
    // computed; the other direction below still is (one-directional overlays).
    // The absence names the person whose birth time is missing — the base —
    // never the moving person (honesty about who is missing what).
    return (
      <section data-testid="overlay-absence">
        <SectionHeading>{heading}</SectionHeading>
        <Absence reason="overlay-time-unknown">
          No birth time for {basePerson.name} — overlays into their houses are not computed.
        </Absence>
      </section>
    );
  }
  return (
    <section data-testid="overlay-table">
      <SectionHeading>{heading}</SectionHeading>
      <table className={MONO_TABLE}>
        <thead>
          <tr className="text-left text-[var(--color-vellum-muted)]">
            <th scope="col" className="py-1 pr-2 font-semibold">
              Body
            </th>
            <th scope="col" className="py-1 font-semibold">
              House
            </th>
          </tr>
        </thead>
        <tbody>
          {movingFacts.positions.map((position) => (
            <tr
              key={position.body}
              data-testid="overlay-row"
              data-body={position.body}
              data-house={String(houseOf(position.lon, baseCusps.cusps))}
              className="border-t-[length:var(--stroke-hairline)] border-t-[color:var(--color-hairline)]"
            >
              <td className="py-1 pr-2">{position.body}</td>
              <td className="py-1">{String(houseOf(position.lon, baseCusps.cusps))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SynastryView({
  person,
  facts,
  otherPerson,
  otherFacts,
  crossAspects,
}: Pick<
  AtlasScreenProps,
  "person" | "facts" | "otherPerson" | "otherFacts" | "crossAspects"
>): ReactElement {
  if (
    person === undefined ||
    facts === undefined ||
    otherPerson === undefined ||
    otherFacts === undefined
  ) {
    return <Absence reason="need-two-people">Synastry needs two people with charts.</Absence>;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2" data-testid="synastry-people">
        <Chip active>{person.name}</Chip>
        <Chip active>{otherPerson.name}</Chip>
      </div>
      {/* J4 bi-wheel: person A inner, person B outer. No score, no label. */}
      <Wheel facts={facts} overlay={otherFacts} />
      <AspectsTable
        aspects={crossAspects ?? []}
        heading="Cross aspects"
        emptyNote="No cross aspects within orb."
      />
      <OverlaySection
        heading={`${otherPerson.name}'s planets in ${person.name}'s houses`}
        movingFacts={otherFacts}
        basePerson={person}
        baseFacts={facts}
      />
      <OverlaySection
        heading={`${person.name}'s planets in ${otherPerson.name}'s houses`}
        movingFacts={facts}
        basePerson={otherPerson}
        baseFacts={otherFacts}
      />
    </div>
  );
}

function TodayView({
  person,
  facts,
  todayFacts,
  hits,
  onOpenPeople,
}: Pick<
  AtlasScreenProps,
  "person" | "facts" | "todayFacts" | "hits" | "onOpenPeople"
>): ReactElement {
  if (person === undefined) {
    // J5: no person ⇒ labelled absence with the People action.
    return (
      <Absence reason="no-person">
        No person is selected. Choose a person to see today&apos;s sky against their chart.
        <PeopleAction onOpenPeople={onOpenPeople} />
      </Absence>
    );
  }
  if (facts === undefined || todayFacts === undefined) {
    return <Absence reason="no-chart">No chart is loaded for this plate yet.</Absence>;
  }
  return (
    <div className="flex flex-col gap-6">
      <p
        data-testid="today-moment"
        data-provenance="computed"
        className="m-0 font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[12px] leading-[16px] text-[var(--color-vellum-muted)]"
      >
        {chartMomentIso(todayFacts)} · {formatPlace(todayFacts.inputs.place)}
      </p>
      {/* J5 bi-wheel: the natal chart inner, today's sky outer. */}
      <Wheel facts={facts} overlay={todayFacts} />
      <AspectsTable aspects={hits ?? []} heading="Hits" emptyNote="No transit hits within orb." />
    </div>
  );
}

export function AtlasScreen(props: AtlasScreenProps): ReactElement {
  const { view, person, otherPerson, onBack } = props;
  const context =
    view === "synastry"
      ? person !== undefined && otherPerson !== undefined
        ? `${person.name} + ${otherPerson.name}`
        : undefined
      : person?.name;
  return (
    <div data-testid="atlas-screen" data-atlas-view={view} data-plate={props.params.plate ?? ""}>
      <TopBar chip={context === undefined ? undefined : <Chip active>{context}</Chip>} />
      <div className="mx-auto w-full max-w-[720px] px-4 py-6">
        {onBack === undefined ? null : (
          <div className="mb-4">
            <Button variant="quiet" onClick={onBack} data-testid="atlas-back">
              Back
            </Button>
          </div>
        )}
        {view === "natal" ? (
          <NatalView
            person={props.person}
            facts={props.facts}
            error={props.error}
            houseSystem={props.houseSystem}
            onHouseSystemSelect={props.onHouseSystemSelect}
          />
        ) : null}
        {view === "synastry" ? (
          <SynastryView
            person={props.person}
            facts={props.facts}
            otherPerson={props.otherPerson}
            otherFacts={props.otherFacts}
            crossAspects={props.crossAspects}
          />
        ) : null}
        {view === "today" ? (
          <TodayView
            person={props.person}
            facts={props.facts}
            todayFacts={props.todayFacts}
            hits={props.hits}
            onOpenPeople={props.onOpenPeople}
          />
        ) : null}
      </div>
    </div>
  );
}
