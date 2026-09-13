import gazetteerData from "./gazetteer.json";
import glossaryData from "./glossary.json";

/** The four fields of each glossary-callout entry; prose includes its provenance label. */
export interface GlossaryEntry {
  readonly glyphId: string;
  readonly title: string;
  readonly whatItIs: string;
  readonly synastryNotes: string;
}

/** WGS84 degrees, north/east positive; tzid names time-zone rules, never a fixed offset. */
export interface GazetteerEntry {
  readonly id: string;
  readonly name: string;
  readonly countryCode: string;
  readonly lat: number;
  readonly lon: number;
  readonly tzid: string;
}

export const glossaryProvenance = Object.freeze({
  kind: "authored-static" as const,
  label: "Authored-static education.",
});

/** Attribution for the bundled gazetteer; these links are metadata, never fetched at runtime. */
export const gazetteerAttribution = Object.freeze({
  title: "GeoNames cities15000",
  source: "https://download.geonames.org/export/dump/cities15000.zip",
  license: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  credit: "Contains GeoNames geographical data, licensed under CC BY 4.0.",
  modifications:
    "Selected 107 cities and six fields; names use selected GeoNames name variants; IDs have a geonames: prefix.",
  coordinateNote: "City reference coordinates, not a street address or a precise birth location.",
});

function record(
  value: unknown,
  fields: readonly string[],
  context: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${context}: expected an object`);
  }
  const entry = value as Record<string, unknown>;
  if (
    Object.keys(entry).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(entry, field))
  ) {
    throw new TypeError(`${context}: expected exactly ${fields.join(", ")}`);
  }
  return entry;
}

function nonempty(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    throw new TypeError(`${context}: expected a nonempty, trimmed string`);
  }
  return value;
}

function education(value: unknown, context: string): string {
  const text = nonempty(value, context);
  if (
    !text.startsWith(`${glossaryProvenance.label} `) ||
    text.length <= glossaryProvenance.label.length + 1
  ) {
    throw new TypeError(`${context}: expected labelled authored-static education`);
  }
  return text;
}

function coordinate(value: unknown, limit: number, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new TypeError(`${context}: expected a finite number between ${-limit} and ${limit}`);
  }
  return value;
}

function glossaryEntry(value: unknown, index: number): GlossaryEntry {
  const context = `glossary[${index}]`;
  const entry = record(value, ["glyphId", "title", "whatItIs", "synastryNotes"], context);
  const glyphId = nonempty(entry.glyphId, `${context}.glyphId`);
  if (!/^g-[a-z]+(?:-[a-z]+)*$/.test(glyphId)) {
    throw new TypeError(`${context}.glyphId: expected a frozen SVG symbol ID`);
  }
  return Object.freeze({
    glyphId,
    title: nonempty(entry.title, `${context}.title`),
    whatItIs: education(entry.whatItIs, `${context}.whatItIs`),
    synastryNotes: education(entry.synastryNotes, `${context}.synastryNotes`),
  });
}

function placeEntry(value: unknown, index: number): GazetteerEntry {
  const context = `gazetteer[${index}]`;
  const entry = record(value, ["id", "name", "countryCode", "lat", "lon", "tzid"], context);
  const countryCode = nonempty(entry.countryCode, `${context}.countryCode`);
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new TypeError(`${context}.countryCode: expected a two-letter uppercase country code`);
  }
  const tzid = nonempty(entry.tzid, `${context}.tzid`);
  // Reject numeric offset identifiers: a birthplace needs historical zone rules.
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(tzid)) {
    throw new TypeError(`${context}.tzid: expected an IANA area/location identifier`);
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: tzid });
  } catch {
    throw new TypeError(`${context}.tzid: unrecognized IANA time zone ${tzid}`);
  }
  return Object.freeze({
    id: nonempty(entry.id, `${context}.id`),
    name: nonempty(entry.name, `${context}.name`),
    countryCode,
    lat: coordinate(entry.lat, 90, `${context}.lat`),
    lon: coordinate(entry.lon, 180, `${context}.lon`),
    tzid,
  });
}

function unique<T>(entries: readonly T[], key: (entry: T) => string, context: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = key(entry);
    if (seen.has(id)) throw new TypeError(`${context}: duplicate ID ${id}`);
    seen.add(id);
  }
}

/** Validate the bundled JSON directly; never substitute an empty catalogue on corruption. */
export function loadGlossary(): readonly GlossaryEntry[] {
  const entries = glossaryData.map(glossaryEntry);
  if (entries.length !== 35) throw new TypeError("glossary: expected 35 entries");
  unique(entries, (entry) => entry.glyphId, "glossary");
  return Object.freeze(entries);
}

/** Unknown glyphs produce honest absence instead of a made-up definition. */
export function getGlossaryEntry(glyphId: string): GlossaryEntry | undefined {
  return loadGlossary().find((entry) => entry.glyphId === glyphId);
}

/**
 * Include places supplied by the caller's runtime store in each returned catalogue.
 * The caller owns persistence and stable IDs; a supplied ID can correct a seed entry.
 * Duplicate IDs within either input are errors. Equal names with different IDs are
 * retained: different places can share a name. Inputs and seed JSON remain unchanged.
 */
export function loadGazetteer(
  userPlaces: readonly GazetteerEntry[] = [],
): readonly GazetteerEntry[] {
  if (!Array.isArray(userPlaces))
    throw new TypeError("gazetteer: expected an array of user places");
  const seed = gazetteerData.map(placeEntry);
  const supplied = userPlaces.map(placeEntry);
  unique(seed, (entry) => entry.id, "gazetteer seed");
  unique(supplied, (entry) => entry.id, "user places");
  const entries = new Map(seed.map((entry) => [entry.id, entry]));
  for (const entry of supplied) entries.set(entry.id, entry);
  return Object.freeze([...entries.values()]);
}
