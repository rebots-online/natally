// natally — PlateCard (U.1). STATE-LEDGER id: Plate 9:15.
// title · body slot · provenance foot · Open. Plates are the cards natally
// lays on the page (DESIGN.md): midnight/2 card, Fraunces voice/name title,
// provenance foot as a computed fact (Plex Mono data/meta, INC-19), and the
// Open action that slides the plate into the Atlas panel.

import type { ReactElement, ReactNode } from "react";
import { Button } from "./button";

export type PlateCardProps = {
  readonly title: string;
  /** Computed-fact foot, e.g. "Placidus · 1990-05-02 14:32 · Malmö". */
  readonly provenance: string;
  readonly onOpen: () => void;
  readonly openLabel?: string;
  readonly children?: ReactNode;
};

export function PlateCard({
  title,
  provenance,
  onOpen,
  openLabel = "Open",
  children,
}: PlateCardProps): ReactElement {
  return (
    <article
      data-ledger="Plate 9:15"
      className="flex flex-col gap-3 rounded-[var(--radius-plate)] border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)] bg-[var(--color-midnight-2)] p-4"
    >
      <h3 className="m-0 font-[family-name:'Fraunces',serif] text-[18px] leading-[24px] font-semibold text-[var(--color-vellum)]">
        {title}
      </h3>
      <div className="min-w-0">{children}</div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t-[length:var(--stroke-hairline)] border-t-[color:var(--color-hairline)] pt-2">
        <span
          data-provenance="computed"
          className="font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[12px] leading-[16px] text-[var(--color-vellum-muted)]"
        >
          {provenance}
        </span>
        <Button variant="secondary" onClick={onOpen}>
          {openLabel}
        </Button>
      </footer>
    </article>
  );
}
