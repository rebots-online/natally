import type { ReactNode } from "react";
import { Glyph, type GlyphName } from "../glyphs";
import "./primitives.css";

export interface TurnHerProps {
  children: ReactNode;
  glyph?: GlyphName;
  streaming?: boolean;
}

/** STATE-LEDGER.json components['Turn/Her'] = 9:3; generated page text, never a bubble. */
export function TurnHer({ children, glyph = "sun", streaming = false }: TurnHerProps) {
  return (
    <article className="ui-turn-her" aria-busy={streaming}>
      <Glyph name={glyph} className="ui-turn-her__glyph" />
      <div>
        <div className="ui-turn-her__name">
          {typeof document === "undefined" ? "" : document.title}
        </div>
        <div className="ui-turn-her__body">{children}</div>
      </div>
    </article>
  );
}
