import type { ReactNode } from "react";
import "./primitives.css";

export interface TurnYouProps {
  children: ReactNode;
}

/** STATE-LEDGER.json components['Turn/You'] = 9:12; right-aligned orbglow hairline. */
export function TurnYou({ children }: TurnYouProps) {
  return (
    <article className="ui-turn-you" aria-label="Your message">
      {children}
    </article>
  );
}
