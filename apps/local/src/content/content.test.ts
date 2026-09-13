import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import gazetteerData from "./gazetteer.json";
import glossaryData from "./glossary.json";
import {
  type GazetteerEntry,
  gazetteerAttribution,
  getGlossaryEntry,
  glossaryProvenance,
  loadGazetteer,
  loadGlossary,
} from "./index";

const signs = [
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
];
const bodies = [
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
  "chiron",
];
const aspects = [
  ["conjunction", 0],
  ["opposition", 180],
  ["trine", 120],
  ["square", 90],
  ["sextile", 60],
  ["quincunx", 150],
  ["semisextile", 30],
] as const;

describe("glossary content", () => {
  it("content: 35 entries, all four fields present, gazetteer loads", () => {
    const entries = loadGlossary();
    expect(entries).toHaveLength(35);
    expect(entries).toEqual(glossaryData);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(["glyphId", "synastryNotes", "title", "whatItIs"]);
      for (const field of Object.values(entry)) {
        expect(typeof field).toBe("string");
        expect(field.trim().length).toBeGreaterThan(0);
      }
    }
    expect(loadGazetteer()).toEqual(gazetteerData);
    expect(loadGazetteer()).toHaveLength(107);
  });

  it("covers the frozen SVG symbol set exactly once, including nodes and motion", () => {
    const svg = readFileSync(
      new URL("../../../../LIBS/UI/FIGMA/glyphs/natally-glyphs.svg", import.meta.url),
      "utf8",
    );
    const frozenIds = [...svg.matchAll(/<symbol\s+id="([^"]+)"/g)].map((match) => match[1]);
    const expected = [
      ...signs,
      ...bodies,
      "north-node",
      "south-node",
      ...aspects.map(([name]) => name),
      "retrograde",
      "applying",
      "separating",
    ]
      .map((name) => `g-${name}`)
      .sort();
    const actual = loadGlossary()
      .map((entry) => entry.glyphId)
      .sort();
    expect(frozenIds).toHaveLength(35);
    expect(new Set(actual).size).toBe(35);
    expect(actual).toEqual(frozenIds.sort());
    expect(actual).toEqual(expected);
  });

  it("labels both authored prose fields and has distinct, substantial entries", () => {
    const entries = loadGlossary();
    expect(glossaryProvenance.kind).toBe("authored-static");
    for (const entry of entries) {
      expect(entry.whatItIs.startsWith(`${glossaryProvenance.label} `)).toBe(true);
      expect(entry.synastryNotes.startsWith(`${glossaryProvenance.label} `)).toBe(true);
      expect(entry.whatItIs.length).toBeGreaterThan(120);
      expect(entry.synastryNotes.length).toBeGreaterThan(100);
      expect(`${entry.whatItIs} ${entry.synastryNotes}`).not.toMatch(
        /\b(?:TODO|TBD|lorem ipsum)\b|\byou (?:are|will|must)\b|\bcompatibility score\b|\d+(?:\.\d+)?%/i,
      );
    }
    expect(new Set(entries.map((entry) => entry.title)).size).toBe(35);
    expect(new Set(entries.map((entry) => entry.whatItIs)).size).toBe(35);
    expect(new Set(entries.map((entry) => entry.synastryNotes)).size).toBe(35);
  });

  it.each(signs.map((name, index) => [name, index * 30, (index + 1) * 30] as const))(
    "%s teaches its actual zodiac sector, %i° to %i°",
    (name, start, end) => {
      const entry = getGlossaryEntry(`g-${name}`);
      expect(entry).toBeDefined();
      expect(entry?.whatItIs).toContain(`${start}° up to ${end}°`);
    },
  );

  it.each(aspects)("%s teaches the correct %i° target", (name, angle) => {
    expect(getGlossaryEntry(`g-${name}`)?.whatItIs).toContain(`target separation of ${angle}°`);
  });

  it("distinguishes astronomical bodies, calculated nodes, and motion", () => {
    expect(getGlossaryEntry("g-sun")?.whatItIs).toContain("star");
    expect(getGlossaryEntry("g-moon")?.whatItIs).toContain("natural satellite");
    expect(getGlossaryEntry("g-pluto")?.whatItIs).toContain("dwarf planet");
    expect(getGlossaryEntry("g-chiron")?.whatItIs).toContain("centaur");
    expect(getGlossaryEntry("g-north-node")?.whatItIs).toContain("south to north");
    expect(getGlossaryEntry("g-south-node")?.whatItIs).toContain("north to south");
    expect(getGlossaryEntry("g-south-node")?.whatItIs).toContain("180°");
    expect(getGlossaryEntry("g-retrograde")?.whatItIs).toContain("longitude is decreasing");
    expect(getGlossaryEntry("g-applying")?.whatItIs).toContain("orb is decreasing");
    expect(getGlossaryEntry("g-separating")?.whatItIs).toContain("orb is increasing");
  });

  it("keeps unknown glyphs absent and exposes immutable entries", () => {
    expect(getGlossaryEntry("g-unknown")).toBeUndefined();
    expect(getGlossaryEntry("constructor")).toBeUndefined();
    expect(getGlossaryEntry("__proto__")).toBeUndefined();
    const entries = loadGlossary();
    expect(Object.isFrozen(entries)).toBe(true);
    expect(entries.every(Object.isFrozen)).toBe(true);
    expect(Reflect.set(entries[0]!, "title", "Changed")).toBe(false);
    expect(getGlossaryEntry("g-aries")?.title).toBe("Aries");
  });
});

describe("gazetteer content and runtime places", () => {
  const userPlace: GazetteerEntry = {
    id: "user:greenwich-meridian",
    name: "Greenwich meridian",
    countryCode: "GB",
    lat: 51.4779,
    lon: 0,
    tzid: "Europe/London",
  };

  it("validates every real seed record's fields, coordinates, identity, and zone rules", () => {
    const entries = loadGazetteer();
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(new Set(entries.map((entry) => `${entry.countryCode}:${entry.name}`)).size).toBe(
      entries.length,
    );
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual([
        "countryCode",
        "id",
        "lat",
        "lon",
        "name",
        "tzid",
      ]);
      expect(entry.id).toMatch(/^geonames:\d+$/);
      expect(entry.name.trim()).toBe(entry.name);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.countryCode).toMatch(/^[A-Z]{2}$/);
      expect(Number.isFinite(entry.lat)).toBe(true);
      expect(Number.isFinite(entry.lon)).toBe(true);
      expect(Math.abs(entry.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(entry.lon)).toBeLessThanOrEqual(180);
      expect(() => new Intl.DateTimeFormat("en", { timeZone: entry.tzid }).format(0)).not.toThrow();
    }
    expect(new Set(entries.map((entry) => entry.tzid.split("/")[0]))).toEqual(
      new Set(["America", "Europe", "Atlantic", "Africa", "Asia", "Australia", "Pacific"]),
    );
  });

  it.each([
    ["Toronto", "CA", 43.70643, -79.39864, "America/Toronto"],
    ["Malmö", "SE", 55.60587, 13.00073, "Europe/Stockholm"],
    ["Nairobi", "KE", -1.28333, 36.81667, "Africa/Nairobi"],
    ["Kathmandu", "NP", 27.70169, 85.3206, "Asia/Kathmandu"],
    ["Sydney", "AU", -33.86785, 151.20732, "Australia/Sydney"],
    ["São Paulo", "BR", -23.5475, -46.63611, "America/Sao_Paulo"],
    ["Wellington", "NZ", -41.28664, 174.77557, "Pacific/Auckland"],
  ] as const)(
    "preserves the verified GeoNames location for %s",
    (name, countryCode, lat, lon, tzid) => {
      expect(loadGazetteer().find((entry) => entry.name === name)).toMatchObject({
        name,
        countryCode,
        lat,
        lon,
        tzid,
      });
    },
  );

  it("retains attribution, licensing, and the coordinate precision limitation", () => {
    expect(gazetteerAttribution.credit).toContain("GeoNames");
    expect(gazetteerAttribution.license).toBe("CC-BY-4.0");
    expect(gazetteerAttribution.source).toBe(
      "https://download.geonames.org/export/dump/cities15000.zip",
    );
    expect(gazetteerAttribution.modifications).toContain("107 cities");
    expect(gazetteerAttribution.coordinateNote).toContain("City reference coordinates");
  });

  it("returns newly supplied places on subsequent loads, preserving zero longitude and the seed", () => {
    const before = structuredClone(gazetteerData);
    const supplied = [{ ...userPlace }];
    const loaded = loadGazetteer(supplied);
    expect(loaded).toHaveLength(108);
    expect(loaded.find((entry) => entry.id === userPlace.id)).toEqual(userPlace);
    expect(loaded.find((entry) => entry.id === userPlace.id)?.lon).toBe(0);
    supplied[0]!.name = "A later user edit";
    expect(loaded.find((entry) => entry.id === userPlace.id)?.name).toBe("Greenwich meridian");
    expect(loadGazetteer(supplied).find((entry) => entry.id === userPlace.id)?.name).toBe(
      "A later user edit",
    );
    expect(gazetteerData).toEqual(before);
    expect(loadGazetteer()).toHaveLength(107);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(loaded.every(Object.isFrozen)).toBe(true);
  });

  it("retains distinct places with identical names and applies ID-based corrections deterministically", () => {
    const london = loadGazetteer().find((entry) => entry.name === "London")!;
    const namesake = { ...userPlace, name: "London" };
    expect(loadGazetteer([namesake]).filter((entry) => entry.name === "London")).toHaveLength(2);
    const corrected = { ...london, name: "London (user reference point)", lat: 51.5, lon: -0.1 };
    const first = loadGazetteer([corrected]);
    expect(first).toHaveLength(107);
    expect(first.find((entry) => entry.id === london.id)).toEqual(corrected);
    expect(loadGazetteer([corrected])).toEqual(first);
    expect(loadGazetteer().find((entry) => entry.id === london.id)).toEqual(london);
  });

  it.each([
    ["lat", 91],
    ["lat", -91],
    ["lat", Number.NaN],
    ["lat", "51.5"],
    ["lon", 181],
    ["lon", -181],
    ["lon", Number.POSITIVE_INFINITY],
    ["countryCode", ""],
    ["countryCode", "gbr"],
    ["countryCode", "gb"],
    ["name", "   "],
    ["id", ""],
    ["tzid", "Mars/Olympus"],
    ["tzid", "+05:30"],
    ["tzid", "EST"],
  ])("rejects malformed runtime %s=%s without silently dropping the place", (field, value) => {
    const invalid = { ...userPlace, [field]: value } as unknown as GazetteerEntry;
    expect(() => loadGazetteer([invalid])).toThrow(new RegExp(field));
  });

  it("rejects missing or extra fields, invalid records, and duplicate runtime IDs", () => {
    const { tzid: _tzid, ...missingZone } = userPlace;
    expect(() => loadGazetteer([missingZone as GazetteerEntry])).toThrow(/exactly/);
    expect(() => loadGazetteer([{ ...userPlace, score: 90 } as GazetteerEntry])).toThrow(/exactly/);
    expect(() => loadGazetteer([null as unknown as GazetteerEntry])).toThrow(/object/);
    expect(() => loadGazetteer(null as unknown as GazetteerEntry[])).toThrow(/array/);
    expect(() => loadGazetteer([userPlace, userPlace])).toThrow(/duplicate ID/);
  });
});
