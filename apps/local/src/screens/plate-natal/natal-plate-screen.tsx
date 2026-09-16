// natally — the natal plate as laid in the transcript (U.3, SCREEN.md
// screen-plate-natal, normative; J2). One PlateCard: title (voice/name), the
// wheel structure (sign ring in the zodiac ramp, house cusps, AC/MC), the
// provenance foot as a computed fact (Plex Mono, INC-19), and the Open action
// that slides the plate into the Atlas.
//
// Variants (frozen): withHouses · timeUnknown. Time unknown ⇒ solar chart:
// the wheel is ring-only (no cusps, no AC/MC — the Wheel renders the honest
// absence itself) and the footer says so (J1/J3).

import type { ChartFacts } from "@natally/ephemeris/types";
import { HOUSE_SYSTEM_NAMES } from "@natally/ephemeris/types";
import type { Person } from "@natally/lore/types";
import type { ReactElement } from "react";
import { PlateCard } from "../../ui/primitives/plate-card";
import { Wheel } from "../../ui/wheel";

export type NatalPlateScreenProps = {
  readonly person: Person;
  /** The person's computed facts (§6); cusps presence picks the variant. */
  readonly facts: ChartFacts;
  /** Open slides the plate into the Atlas (J2: conversation → atlas). */
  readonly onOpen: () => void;
};

/** The provenance foot, exactly the computed facts the chart was cast from. */
export function natalPlateProvenance(person: Person, facts: ChartFacts): string {
  const { date, time, place } = person.birth;
  if (facts.cusps === undefined) {
    return `time unknown · solar chart · ${date} · ${place}`;
  }
  const parts = [HOUSE_SYSTEM_NAMES[facts.inputs.system], date];
  if (time !== undefined) {
    parts.push(time);
  }
  parts.push(place);
  return parts.join(" · ");
}

export function NatalPlateScreen({ person, facts, onOpen }: NatalPlateScreenProps): ReactElement {
  const variant = facts.cusps === undefined ? "timeUnknown" : "withHouses";
  return (
    <div data-testid="natal-plate" data-variant={variant} className="w-full max-w-[360px]">
      <PlateCard
        title={person.name}
        provenance={natalPlateProvenance(person, facts)}
        onOpen={onOpen}
      >
        <Wheel facts={facts} />
      </PlateCard>
    </div>
  );
}
