// natally — TurnHer (U.1). STATE-LEDGER id: Turn/Her 9:3.
// Her turn: page text in the margin grammar — her voice/name and a gilt glyph
// in the left margin, never a bubble (DESIGN.md anti-patterns). The text is
// generated transcript attributed to her (INC-19).

import type { ReactElement, ReactNode } from "react";
import { Glyph, type GlyphName } from "../glyphs";

export type TurnHerProps = {
  /** Her name in the margin (voice/name, Fraunces). */
  readonly name: string;
  /** Margin glyph from the frozen set; defaults to her moon. */
  readonly glyph?: GlyphName;
  readonly children: ReactNode;
};

export function TurnHer({ name, glyph = "moon", children }: TurnHerProps): ReactElement {
  return (
    <section data-ledger="Turn/Her 9:3" data-turn="her" className="flex gap-3 py-2">
      <span aria-hidden="true" className="shrink-0 pt-[2px] text-[var(--color-gilt)]">
        <Glyph name={glyph} size={20} />
      </span>
      <div className="min-w-0">
        <p className="m-0 font-[family-name:'Fraunces',serif] text-[18px] leading-[24px] font-semibold text-[var(--color-vellum)]">
          {name}
        </p>
        <p className="m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[16px] leading-[24px] text-[var(--color-vellum)]">
          {children}
        </p>
      </div>
    </section>
  );
}
