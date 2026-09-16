// natally — TurnYou (U.1). STATE-LEDGER id: Turn/You 9:12.
// Your turn: right-aligned inside an orbglow hairline box (DESIGN.md
// "Transcript grammar"; orbglow is yours). The only orbglow border in the
// transcript — never a gilt one.

import type { ReactElement, ReactNode } from "react";

export type TurnYouProps = {
  readonly children: ReactNode;
  readonly className?: string;
};

export function TurnYou({ children, className }: TurnYouProps): ReactElement {
  return (
    <section
      data-ledger="Turn/You 9:12"
      data-turn="you"
      className={`ml-auto w-fit max-w-[85%] rounded-[var(--radius-chip)] border-[length:var(--stroke-hairline)] border-[color:var(--color-orbglow)] bg-[var(--color-midnight-2)] px-4 py-2${className === undefined ? "" : ` ${className}`}`}
    >
      <p className="m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[16px] leading-[24px] text-[var(--color-vellum)]">
        {children}
      </p>
    </section>
  );
}
