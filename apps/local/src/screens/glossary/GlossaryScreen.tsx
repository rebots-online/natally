// natally — the glossary callout (U.7). SCREEN.md screen-glossary-callout is
// normative: tapping any glyph or term opens a callout — the glyph, the name,
// "What it is" and "In synastry" (authored-static education, identical for
// every user, labelled — INC-19 provenance class `authored`,
// ARCHITECTURE.md §5) — and "Ask natally about this", which posts the term
// into the conversation.
//
// Seam contract (simplest honest one): an injected `askNatally` prop; the
// wiring layer (I.1) binds it to appending a user turn carrying the term
// into the open session, which the conversation screen picks up from the C.4
// bus / transcript. This module never imports the bus or the data layer. The
// seam absent ⇒ the control renders disabled — an inert control never
// pretends (U.2's law). Tests assert the injected fn receives the term.
//
// Not a route: the frozen route set (U.1 router) has no glossary path. The
// callout mounts over its caller (the overAtlas frame), opened by glyphId.
// Content is G.1's bundled glossary (`loadGlossary`) — exactly the 35 frozen
// glyph ids of LIBS/UI/FIGMA/glyphs/glyph-ids.txt, 1:1. An unknown glyphId
// renders the labelled absence — no invented entry (INC-19).

import type { ReactElement, ReactNode } from "react";
import { loadGlossary } from "../../content";
import { GLYPH_NAMES, Glyph } from "../../ui/glyphs";
import { Button } from "../../ui/primitives/button";

export type GlossaryScreenProps = {
  /** The frozen glyph id to open (glyph-ids.txt form, e.g. "g-aries"). */
  readonly glyphId: string;
  /** Injected seam: posts the term into the conversation (a user turn). */
  readonly askNatally?: (term: string) => void;
};

const BODY =
  "font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[14px] leading-[20px] text-[var(--color-vellum)]";
const MONO_MICRO =
  "font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[12px] leading-[16px]";

/** "g-aries" → "aries" against the frozen set; undefined when unknown. */
function glyphNameOf(glyphId: string): (typeof GLYPH_NAMES)[number] | undefined {
  return GLYPH_NAMES.find((name) => `g-${name}` === glyphId);
}

function SectionHeading({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <h3 className="m-0 mb-1 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[14px] leading-[20px] font-semibold text-[var(--color-vellum)]">
      {children}
    </h3>
  );
}

/** One authored-static body section: labelled, then its paragraph. */
function AuthoredBody({
  heading,
  testId,
  text,
}: {
  readonly heading: string;
  readonly testId: string;
  readonly text: string;
}): ReactElement {
  return (
    <section data-testid={testId} className="mt-4">
      <SectionHeading>{heading}</SectionHeading>
      <span
        data-provenance="authored"
        className={`${MONO_MICRO} uppercase tracking-[0.08em] text-[var(--color-vellum-muted)]`}
      >
        authored
      </span>
      <p data-provenance="authored" className={`${BODY} m-0 mt-1`}>
        {text}
      </p>
    </section>
  );
}

export function GlossaryScreen({ glyphId, askNatally }: GlossaryScreenProps): ReactElement {
  const name = glyphNameOf(glyphId);
  const entry = loadGlossary().find((candidate) => candidate.glyphId === glyphId);

  if (entry === undefined || name === undefined) {
    // Labelled honest absence (INC-19): the frozen set is closed; a callout
    // for a glyph outside it is a caller bug, never invented content.
    return (
      <div className="natally-absence" data-testid="glossary-absence" data-absence={glyphId}>
        <p className={`${BODY} m-0 text-[var(--color-vellum-muted)]`}>
          No glossary entry for this glyph.
        </p>
      </div>
    );
  }

  return (
    <article data-testid="glossary-callout" data-glyph-id={entry.glyphId}>
      <header className="flex items-center gap-3">
        <Glyph name={name} size={28} className="text-[var(--color-gilt)]" />
        <h2
          data-testid="glossary-term"
          className="m-0 font-[family-name:'Fraunces',serif] text-[20px] leading-[28px] font-semibold text-[var(--color-vellum)]"
        >
          {entry.term}
        </h2>
      </header>

      <AuthoredBody heading="What it is" testId="glossary-what" text={entry.whatItIs} />
      {entry.synastryNote === undefined ? null : (
        <AuthoredBody heading="In synastry" testId="glossary-synastry" text={entry.synastryNote} />
      )}

      <div className="mt-5">
        <Button
          variant="primary"
          data-testid="glossary-ask"
          disabled={askNatally === undefined}
          onClick={() => askNatally?.(entry.term)}
        >
          Ask natally about this
        </Button>
      </div>
    </article>
  );
}
