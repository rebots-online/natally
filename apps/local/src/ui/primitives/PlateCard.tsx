import { type ReactNode, useId } from "react";
import { Button } from "./Button";

export interface PlateCardProps {
  title: string;
  children: ReactNode;
  provenance: ReactNode;
  onOpen: () => void;
  openLabel?: string;
  placed?: boolean;
}

/** STATE-LEDGER.json components.Plate = 9:15; provenance is supplied runtime data. */
export function PlateCard({
  title,
  children,
  provenance,
  onOpen,
  openLabel = "Open",
  placed = false,
}: PlateCardProps) {
  const titleId = useId();
  return (
    <article className={`ui-plate${placed ? " ui-plate--placed" : ""}`} aria-labelledby={titleId}>
      <header className="ui-plate__header">
        <h2 id={titleId} className="ui-plate__title">
          {title}
        </h2>
        <Button variant="quiet" onClick={onOpen} aria-label={`${openLabel} ${title}`}>
          {openLabel}
        </Button>
      </header>
      <div className="ui-plate__body">{children}</div>
      <footer className="ui-plate__provenance">{provenance}</footer>
    </article>
  );
}
