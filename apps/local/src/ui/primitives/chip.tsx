// natally — Chip (U.1). STATE-LEDGER id: Chip 6:13.
// The context chip (TopBar slot, person chips). Active state = orbglow
// hairline (DESIGN.md "Colour": orbglow is yours — active person chip).
// ui/label text style: 12/16 Nunito Sans SemiBold, +4% tracking, sentence case.

import type { HTMLAttributes, ReactElement } from "react";

export type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  readonly active?: boolean;
};

export function Chip({ active = false, className, children, ...rest }: ChipProps): ReactElement {
  const stateClasses = active
    ? "border-[color:var(--color-orbglow)] text-[var(--color-vellum)]"
    : "border-[color:var(--color-hairline)] text-[var(--color-vellum-muted)]";
  return (
    <span
      data-ledger="Chip 6:13"
      data-active={active ? "true" : "false"}
      className={`inline-flex min-h-[var(--size-touch)] items-center gap-2 rounded-[var(--radius-chip)] border-[length:var(--stroke-hairline)] bg-[var(--color-midnight-3)] px-3 py-2 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[12px] leading-[16px] font-semibold tracking-[0.04em] ${stateClasses}${className === undefined ? "" : ` ${className}`}`}
      {...rest}
    >
      {children}
    </span>
  );
}
