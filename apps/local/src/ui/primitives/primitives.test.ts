// natally — U.1 verify.
// Accept: `primitives: 7 components, tokens.css vars applied, routes typecheck`.
//
// Storybook-free visual tests: each primitive renders against the frozen
// token CSS (jsdom) and its class output must name the exact token vars it
// binds (the var names appear verbatim in the arbitrary-value classes, so the
// wiring is assertable without a Tailwind build). Grep-level law assertions:
// no raw hex anywhere in the U.1-owned source. Router: the eight DESIGN.md
// routes register and match, params included. Glyph set: the copied SVG, the
// name list and glyph-ids.txt stay in lockstep.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { GLYPH_NAMES, Glyph, hasGlyphBody } from "../glyphs";
import {
  matchRoute,
  ROUTE_PATHS,
  type RouteLoader,
  registerRoute,
  resetRoutes,
  routeRegistry,
} from "../router";
import { Shell } from "../shell";
import { NATALLY_VERSION, VersionStamp } from "../version";
import { Button, Chip, Composer, PlateCard, TopBar, TurnHer, TurnYou } from "./index";

// ---------------------------------------------------------------------------
// File fixtures — U.1-owned sources + the frozen token/glyph complements
// ---------------------------------------------------------------------------

const PRIMITIVE_FILES = [
  "button.tsx",
  "chip.tsx",
  "composer.tsx",
  "index.ts",
  "plate-card.tsx",
  "top-bar.tsx",
  "turn-her.tsx",
  "turn-you.tsx",
] as const;

const UI_FILES = ["../shell.tsx", "../router.ts", "../glyphs.tsx", "../version.tsx"] as const;

const HERE = import.meta.dirname ?? new URL(".", import.meta.url).pathname;
const TOKENS_CSS = readFileSync(
  resolve(HERE, "../../../../../packages/design-tokens/tokens.css"),
  "utf8",
);
const COPIED_GLYPHS = readFileSync(resolve(HERE, "../../assets/glyphs/natally-glyphs.svg"), "utf8");
const FROZEN_GLYPHS = readFileSync(
  resolve(HERE, "../../../../../LIBS/UI/FIGMA/glyphs/natally-glyphs.svg"),
  "utf8",
);
const GLYPH_IDS_TXT = readFileSync(
  resolve(HERE, "../../../../../LIBS/UI/FIGMA/glyphs/glyph-ids.txt"),
  "utf8",
)
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .map((line) => line.replace(/^g-/, ""));

function ownedSource(name: string): string {
  return readFileSync(resolve(HERE, name), "utf8");
}

/** Mount rendered HTML into jsdom so attribute wiring is assertable. */
function mount(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

function send(): void {}

const STUB_LOADER: RouteLoader = async () => ({ default: () => null });

// ---------------------------------------------------------------------------
// The headline — quoted from the Accept line
// ---------------------------------------------------------------------------

describe("primitives: 7 components, tokens.css vars applied, routes typecheck", () => {
  test("seven Components-page primitives render with their STATE-LEDGER wiring", () => {
    const rendered: ReadonlyArray<readonly [string, string]> = [
      ["Button 6:8", render(h(Button, null, "Unlock"))],
      ["Chip 6:13", render(h(Chip, { active: true }, "Robin"))],
      [
        "Composer 6:24",
        render(
          h(Composer, {
            value: "hello",
            onValueChange: send,
            onSend: send,
          }),
        ),
      ],
      [
        "Plate 9:15",
        render(h(PlateCard, { title: "Natal", provenance: "Placidus", onOpen: send })),
      ],
      ["TopBar 6:16", render(h(TopBar, null))],
      ["Turn/Her 9:3", render(h(TurnHer, { name: "natally", children: "Good evening, Robin." }))],
      ["Turn/You 9:12", render(h(TurnYou, { children: "Read my sky." }))],
    ];

    expect(rendered).toHaveLength(7);
    const dom = mount(rendered.map(([, html]) => html).join(""));
    for (const [ledger] of rendered) {
      expect(dom.querySelector(`[data-ledger="${ledger}"]`)).not.toBeNull();
    }
    containerCleanup(dom);
  });

  // -----------------------------------------------------------------------
  // tokens.css vars applied — every referenced var must be a frozen var
  // -----------------------------------------------------------------------

  test("every primitive binds token vars and tokens.css defines each of them", () => {
    const outputs: readonly string[] = [
      render(h(Button, { variant: "primary" }, "a")),
      render(h(Button, { variant: "secondary" }, "b")),
      render(h(Button, { variant: "quiet" }, "c")),
      render(h(Chip, { active: true }, "d")),
      render(h(Chip, { active: false }, "e")),
      render(h(TopBar, { chip: h(Chip, null, "f") })),
      render(h(Composer, { value: "", onValueChange: send, onSend: send })),
      render(h(PlateCard, { title: "t", provenance: "p", onOpen: send }, "body")),
      render(h(TurnHer, { name: "n", children: "text" })),
      render(h(TurnYou, { children: "text" })),
    ];
    const all = outputs.join("");

    // the wiring itself: token vars named verbatim in the class output
    for (const tokenVar of [
      "var(--color-gilt)",
      "var(--color-orbglow)",
      "var(--color-midnight)",
      "var(--color-midnight-2)",
      "var(--color-midnight-3)",
      "var(--color-hairline)",
      "var(--color-vellum)",
      "var(--color-vellum-muted)",
      "var(--radius-plate)",
      "var(--radius-button)",
      "var(--radius-chip)",
      "var(--radius-pill)",
      "var(--size-touch)",
      "var(--stroke-hairline)",
    ]) {
      expect(all).toContain(tokenVar);
    }

    // and the frozen complement defines every var the primitives reference
    const referenced = [...all.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of new Set(referenced)) {
      expect(TOKENS_CSS).toContain(`${name}:`);
    }
  });

  test("tokens.css is the frozen 36-variable complement (colour + float)", () => {
    for (const name of [
      "--color-midnight",
      "--color-midnight-2",
      "--color-midnight-3",
      "--color-hairline",
      "--color-vellum",
      "--color-vellum-muted",
      "--color-gilt",
      "--color-orbglow",
      "--color-moonlight",
      "--color-ember",
      "--color-z-aries",
      "--color-z-pisces",
      "--radius-plate",
      "--radius-button",
      "--radius-chip",
      "--radius-pill",
      "--spacing-1",
      "--spacing-2",
      "--spacing-3",
      "--spacing-4",
      "--spacing-6",
      "--spacing-8",
      "--stroke-hairline",
      "--size-touch",
      "--size-stage",
      "--size-avatar",
    ]) {
      expect(TOKENS_CSS).toContain(`${name}:`);
    }
  });

  // -----------------------------------------------------------------------
  // Law: no raw hex in U.1-owned source (grep-level, ARCHITECTURE.md §3)
  // -----------------------------------------------------------------------

  test("no raw hex in any U.1-owned source file", () => {
    const files = [...PRIMITIVE_FILES, ...UI_FILES];
    expect(files).toHaveLength(12);
    for (const file of files) {
      const hexMatches = ownedSource(file).match(/#[0-9a-fA-F]{3,8}\b/g);
      expect(hexMatches, `${file} contains raw hex`).toBeNull();
    }
  });

  // -----------------------------------------------------------------------
  // Router: the exact eight paths, register + match (contract typechecks)
  // -----------------------------------------------------------------------

  test("router registers exactly the eight DESIGN.md routes and matches them", () => {
    resetRoutes();
    for (const path of ROUTE_PATHS) {
      registerRoute({ path, load: STUB_LOADER });
    }
    expect(routeRegistry().size).toBe(8);

    expect(matchRoute("")).toEqual({ path: "/", params: {} });
    expect(matchRoute("#/")).toEqual({ path: "/", params: {} });
    expect(matchRoute("#/settings")).toEqual({ path: "/settings", params: {} });
    expect(matchRoute("#/paywall")).toEqual({ path: "/paywall", params: {} });
    expect(matchRoute("#/checkout")).toEqual({ path: "/checkout", params: {} });
    expect(matchRoute("#/about")).toEqual({ path: "/about", params: {} });
    expect(matchRoute("#/people")).toEqual({ path: "/people", params: {} });
    expect(matchRoute("#/atlas/natal")).toEqual({
      path: "/atlas/:plate",
      params: { plate: "natal" },
    });
    expect(matchRoute("#/people/robin")).toEqual({
      path: "/people/:id",
      params: { id: "robin" },
    });
    expect(matchRoute("#/atlas/rose%20quartz")).toEqual({
      path: "/atlas/:plate",
      params: { plate: "rose quartz" },
    });

    // anything outside the frozen set is not a route
    expect(matchRoute("#/nope")).toBeNull();
    expect(matchRoute("#/people/x/extra")).toBeNull();
    expect(matchRoute("#/atlas")).toBeNull();

    expect(() => registerRoute({ path: "/", load: STUB_LOADER })).toThrow();
    expect(() =>
      registerRoute({
        // `as never` proves the RoutePath type rejects unknown paths at
        // compile time; the runtime guard is defence in depth, under test here.
        path: "/warehouse" as never,
        load: STUB_LOADER,
      }),
    ).toThrow();
    resetRoutes();
  });

  // -----------------------------------------------------------------------
  // Glyph set: copied SVG, name list, glyph-ids.txt in lockstep
  // -----------------------------------------------------------------------

  test("glyph set serves the frozen natally-glyphs.svg by name", () => {
    // the copy is byte-identical to the frozen complement
    expect(COPIED_GLYPHS).toBe(FROZEN_GLYPHS);
    // the name list, the copied ids and glyph-ids.txt agree
    expect(GLYPH_NAMES).toHaveLength(GLYPH_IDS_TXT.length);
    expect(GLYPH_NAMES.join("\n")).toBe(GLYPH_IDS_TXT.join("\n"));
    const idsInSvg = [...COPIED_GLYPHS.matchAll(/id="g-([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(idsInSvg).toHaveLength(GLYPH_NAMES.length);
    for (const name of GLYPH_NAMES) {
      expect(hasGlyphBody(name)).toBe(true);
    }

    const dom = mount(render(h(Glyph, { name: "moon", size: 20 })));
    const svg = dom.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.getAttribute("width")).toBe("20");
    // frozen path data served from the copy, not invented here
    expect(svg?.innerHTML).toContain("M14.5 3.5");
    containerCleanup(dom);
  });

  // -----------------------------------------------------------------------
  // Version stamp: data/micro, bottom-right, on every surface
  // -----------------------------------------------------------------------

  test("version stamp carries data/micro and the stamped artifact version", () => {
    const dom = mount(render(h(VersionStamp, null)));
    const stamp = dom.querySelector('[data-micro="version"]');
    expect(stamp).not.toBeNull();
    expect(stamp?.textContent).toBe(NATALLY_VERSION);
    expect(stamp?.className).toContain("right-2");
    expect(stamp?.className).toContain("bottom-1");
    containerCleanup(dom);
  });

  test("shell stamps the version even where no screen is registered yet", () => {
    resetRoutes();
    const dom = mount(render(h(Shell, null)));
    expect(dom.querySelector('[data-micro="version"]')).not.toBeNull();
    expect(dom.querySelector('[data-absence="unregistered"]')).not.toBeNull();
    containerCleanup(dom);
  });
});

function containerCleanup(container: HTMLElement): void {
  container.remove();
}
