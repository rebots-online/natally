// natally — the chart wheel renderer (U.3). STATE-LEDGER: screen-atlas-natal /
// screen-plate-natal wheel structure. One SVG instrument, 272 px canonical
// (SCREEN.md), shared by the natal plate card and the three Atlas views:
//
//   - zodiac ramp: 12 sign segments in the frozen zodiac token ramp
//     (--color-z-<sign> via @natally/design-tokens ZODIAC_VAR — no raw hex);
//   - house cusps drawn at RUNTIME angles from ChartFacts.cusps;
//   - AC / MC labels on the primary chart's 1st / 10th cusp longitudes;
//   - bi-wheel mode (synastry / today): the primary chart speaks inside,
//     an overlay chart (the other person / today's sky) speaks in an outer
//     band, and the shared zodiac ramp always rings the outside;
//   - AspectsTable: pair · orb° · applying|separating — computed facts only.
//     NO score, NO interpretation label anywhere (INC-19);
//   - HouseSystemPicker: the 12 HOUSE_SYSTEMS as chips, selection reported
//     through a prop callback (re-casting stays the caller's seam).
//
// Geometry (exact, normative for the ±0.5° TR-1 wheel render rule):
//
//   A body or cusp at ecliptic longitude λ ∈ [0, 360) maps to the math angle
//   (y up, counterclockwise from 3 o'clock / east):
//
//       mathAngle(λ) = (180 + λ) mod 360
//
//   so Aries 0° sits at 9 o'clock (the Ascendant's home when ASC ≈ 0° Aries)
//   and longitude increases counterclockwise — the classical wheel. The SVG
//   point at radius r is:
//
//       x = cx + r·cos(mathAngle), y = cy − r·sin(mathAngle)   (y is down)
//
//   Cusp spokes are drawn as a line pointing at 12 o'clock (math angle 90°)
//   inside <g transform="rotate(A cx cy)">. SVG rotate(A) is clockwise in
//   y-down space, so the rotated line lands at math angle (90 − A). Solving
//   90 − A ≡ 180 + λ gives the spoke transform used everywhere below:
//
//       A(λ) = (270 − λ) mod 360
//
//   Tests parse A out of the transform and invert it; the formulas here are
//   the single source of that arithmetic.

import { ZODIAC_VAR, type ZodiacSign } from "@natally/design-tokens";
import type { Aspect, ChartFacts, HouseSystem } from "@natally/ephemeris/types";
import { HOUSE_SYSTEM_NAMES, HOUSE_SYSTEMS } from "@natally/ephemeris/types";
import type { ReactElement } from "react";
import { Glyph } from "./glyphs";
import { Chip } from "./primitives/chip";

/** Canonical wheel edge (SCREEN.md); the plate and Atlas use the default. */
const DEFAULT_SIZE = 272;
/** Zodiac ramp band width. */
const RAMP_WIDTH = 14;
/** Spokes start off-centre so the hub stays clean. */
const HUB_RADIUS = 6;
/** Bi-wheel radii: primary spokes end where the overlay band begins. */
const BIWHEEL_PRIMARY_RADIUS = 100;
const OVERLAY_BAND_INNER = 104;
const OVERLAY_BAND_OUTER = 119;
const SIGN_GLYPH_SIZE = 12;

/** The 12 signs in zodiac order (aries = 0°–30° … pisces = 330°–360°). */
export const SIGNS = Object.keys(ZODIAC_VAR) as readonly ZodiacSign[];

/** Normalise any degree count into [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** The SVG rotate() degrees that point a 12-o'clock spoke at longitude λ. */
export function spokeAngle(lambda: number): number {
  return normalizeDeg(270 - lambda);
}

/** Inverse of spokeAngle: the longitude a parsed rotate() degree encodes. */
export function angleToLongitude(angle: number): number {
  return normalizeDeg(270 - angle);
}

type Point = { readonly x: number; readonly y: number };

/** Screen point for longitude λ at radius r (see the module geometry doc). */
function pointAt(cx: number, cy: number, lambda: number, r: number): Point {
  const rad = ((180 + lambda) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

/** One 30° annulus sector of the zodiac ramp, filled with the sign token. */
function signSegment(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  signIndex: number,
): ReactElement {
  const sign = SIGNS[signIndex];
  if (sign === undefined) {
    throw new Error(`wheel: no sign at index ${String(signIndex)}`);
  }
  const l1 = signIndex * 30;
  const l2 = l1 + 30;
  const a1 = pointAt(cx, cy, l1, rOuter);
  const a2 = pointAt(cx, cy, l2, rOuter);
  const b2 = pointAt(cx, cy, l2, rInner);
  const b1 = pointAt(cx, cy, l1, rInner);
  const d =
    `M ${a1.x.toFixed(3)} ${a1.y.toFixed(3)} ` +
    `A ${rOuter} ${rOuter} 0 0 1 ${a2.x.toFixed(3)} ${a2.y.toFixed(3)} ` +
    `L ${b2.x.toFixed(3)} ${b2.y.toFixed(3)} ` +
    `A ${rInner} ${rInner} 0 0 0 ${b1.x.toFixed(3)} ${b1.y.toFixed(3)} Z`;
  return (
    <path key={sign} data-wheel-sign={sign} d={d} fill={`var(${ZODIAC_VAR[sign]})`} stroke="none" />
  );
}

function signGlyph(cx: number, cy: number, signIndex: number, r: number): ReactElement {
  const sign = SIGNS[signIndex];
  if (sign === undefined) {
    throw new Error(`wheel: no sign at index ${String(signIndex)}`);
  }
  const mid = pointAt(cx, cy, signIndex * 30 + 15, r);
  return (
    <g
      key={`glyph-${sign}`}
      transform={`translate(${(mid.x - SIGN_GLYPH_SIZE / 2).toFixed(3)} ${(mid.y - SIGN_GLYPH_SIZE / 2).toFixed(3)})`}
      className="text-[var(--color-midnight)]"
    >
      <Glyph name={sign} size={SIGN_GLYPH_SIZE} />
    </g>
  );
}

function cuspSpokes(
  facts: ChartFacts,
  ring: "inner" | "outer",
  rSpokeEnd: number,
  cx: number,
  cy: number,
): ReadonlyArray<ReactElement> {
  const cusps = facts.cusps?.cusps;
  if (cusps === undefined) {
    return [];
  }
  return cusps.map((lambda, index): ReactElement => {
    const angle = spokeAngle(lambda);
    const principal = index === 0 || index === 9;
    return (
      <g
        key={`${ring}-${String(index)}`}
        data-wheel-cusp={index + 1}
        data-wheel-cusp-ring={ring}
        data-wheel-cusp-angle={angle.toFixed(4)}
        transform={`rotate(${angle.toFixed(4)} ${cx} ${cy})`}
      >
        <line
          x1={cx}
          y1={cy - rSpokeEnd}
          x2={cx}
          y2={cy - (ring === "outer" ? OVERLAY_BAND_INNER - 3 : HUB_RADIUS)}
          stroke="var(--color-vellum-muted)"
          strokeWidth={principal ? 1.5 : 0.75}
          strokeDasharray={ring === "outer" ? "3 3" : undefined}
        />
      </g>
    );
  });
}

function principalLabel(
  cx: number,
  cy: number,
  lambda: number,
  rOuter: number,
  which: "AC" | "MC",
): ReactElement {
  const angle = spokeAngle(lambda);
  return (
    <g data-wheel-principal={which} transform={`rotate(${angle.toFixed(4)} ${cx} ${cy})`}>
      <text
        x={cx}
        y={cy - rOuter - 6}
        textAnchor="middle"
        fontSize={12}
        className="font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace]"
        fill="var(--color-vellum)"
      >
        {which}
      </text>
    </g>
  );
}

/** One chart's wheel. `overlay` turns it into a bi-wheel (synastry / today). */
export type WheelProps = {
  /** The inner (primary) chart: its cusps draw the main spokes and AC/MC. */
  readonly facts: ChartFacts;
  /** Outer-ring chart — the other person (synastry) or today's sky (today). */
  readonly overlay?: ChartFacts;
  /** Rendered square edge; the frozen structure is 272. */
  readonly size?: number;
};

export function Wheel({ facts, overlay, size = DEFAULT_SIZE }: WheelProps): ReactElement {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  const rampOuter = r - 1;
  const rampInner = rampOuter - RAMP_WIDTH;
  const hasOverlay = overlay !== undefined;
  const primary = facts.cusps;

  return (
    <svg
      data-testid="wheel"
      data-wheel-cusps={primary === undefined ? "absent" : "present"}
      data-wheel-overlay={hasOverlay ? "true" : "false"}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Chart wheel"
      className="block"
    >
      {SIGNS.map((_sign, index) => signSegment(cx, cy, rampOuter, rampInner, index))}
      {SIGNS.map((_sign, index) => signGlyph(cx, cy, index, (rampOuter + rampInner) / 2))}
      {primary === undefined
        ? null
        : cuspSpokes(facts, "inner", hasOverlay ? BIWHEEL_PRIMARY_RADIUS : rampInner, cx, cy)}
      {overlay === undefined || overlay.cusps === undefined
        ? null
        : cuspSpokes(overlay, "outer", OVERLAY_BAND_OUTER, cx, cy)}
      {primary === undefined ? null : principalLabel(cx, cy, primary.asc, rampOuter, "AC")}
      {primary === undefined ? null : principalLabel(cx, cy, primary.mc, rampOuter, "MC")}
    </svg>
  );
}

/**
 * The aspects table: pair · orb° · applying|separating — computed facts only.
 * INC-19: there is deliberately no score, no strength, no interpretation
 * label on a row; the test suite asserts the row attribute set stays exactly
 * the six computed fields.
 */
export type AspectsTableProps = {
  readonly aspects: readonly Aspect[];
  readonly heading: string;
  /** Honest-absence line when no aspects are within orb. */
  readonly emptyNote?: string;
};

export function AspectsTable({ aspects, heading, emptyNote }: AspectsTableProps): ReactElement {
  return (
    <section data-testid="aspects-table" data-aspect-count={String(aspects.length)}>
      <h4 className="m-0 mb-2 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[14px] leading-[20px] font-semibold text-[var(--color-vellum)]">
        {heading}
      </h4>
      {aspects.length === 0 ? (
        <p
          data-absence="no-aspects"
          className="m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[12px] leading-[16px] text-[var(--color-vellum-muted)]"
        >
          {emptyNote ?? "No aspects within orb."}
        </p>
      ) : (
        <table className="w-full border-collapse font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[12px] leading-[16px] text-[var(--color-vellum)]">
          <thead>
            <tr className="text-left text-[var(--color-vellum-muted)]">
              <th scope="col" className="py-1 pr-2 font-semibold">
                Pair
              </th>
              <th scope="col" className="py-1 pr-2 font-semibold">
                Orb
              </th>
              <th scope="col" className="py-1 font-semibold">
                Motion
              </th>
            </tr>
          </thead>
          <tbody>
            {aspects.map((aspect, index) => (
              <tr
                key={`${aspect.a}-${aspect.type}-${aspect.b}-${String(index)}`}
                data-testid="aspect-row"
                data-aspect-a={aspect.a}
                data-aspect-b={aspect.b}
                data-aspect-type={aspect.type}
                data-orb={aspect.orb.toFixed(2)}
                data-direction={aspect.applying ? "applying" : "separating"}
                className="border-t-[length:var(--stroke-hairline)] border-t-[color:var(--color-hairline)]"
              >
                <td className="flex items-center gap-1 py-1 pr-2">
                  <Glyph name={aspect.a} size={16} />
                  <Glyph name={aspect.type} size={16} />
                  <Glyph name={aspect.b} size={16} />
                </td>
                <td className="py-1 pr-2">{aspect.orb.toFixed(2)}°</td>
                <td className="py-1">{aspect.applying ? "applying" : "separating"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** The 12 house systems as chips; selection reports back via `onSelect`. */
export type HouseSystemPickerProps = {
  readonly value: HouseSystem;
  readonly onSelect?: (system: HouseSystem) => void;
};

export function HouseSystemPicker({ value, onSelect }: HouseSystemPickerProps): ReactElement {
  // fieldset is the semantic group element (biome useSemanticElements); the
  // m-0 border-0 p-0 resets keep the rendered box identical to a bare flex div.
  return (
    <fieldset
      aria-label="House system"
      data-testid="house-system-picker"
      className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
    >
      {HOUSE_SYSTEMS.map((code) => (
        <Chip
          key={code}
          active={code === value}
          role="button"
          tabIndex={0}
          aria-pressed={code === value ? "true" : "false"}
          data-house-system={code}
          onClick={onSelect === undefined ? undefined : () => onSelect(code)}
        >
          {code} · {HOUSE_SYSTEM_NAMES[code]}
        </Chip>
      ))}
    </fieldset>
  );
}
