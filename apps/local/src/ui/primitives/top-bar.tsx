// natally — TopBar (U.1). STATE-LEDGER id: TopBar 6:16.
// menu · wordmark · context chip (DESIGN.md "Layout"). One navigation system:
// the menu is the only nav affordance here, the wordmark is static, the chip
// is the screen-provided context slot. Sticky top, hairline under-rule.

import type { ReactElement, ReactNode } from "react";

export type TopBarProps = {
  readonly onMenu?: () => void;
  readonly chip?: ReactNode;
};

export function TopBar({ onMenu, chip }: TopBarProps): ReactElement {
  return (
    <header
      data-ledger="TopBar 6:16"
      className="sticky top-0 z-40 grid grid-cols-[44px_1fr_auto] items-center gap-2 border-b-[length:var(--stroke-hairline)] border-b-[color:var(--color-hairline)] bg-[var(--color-midnight)] px-4 py-2"
    >
      <button
        type="button"
        aria-label="Menu"
        onClick={onMenu}
        disabled={onMenu === undefined}
        className="inline-flex min-h-[var(--size-touch)] w-[var(--size-touch)] items-center justify-center rounded-[var(--radius-button)] bg-transparent text-[var(--color-vellum)] border-0 focus-visible:outline focus-visible:outline-[color:var(--color-orbglow)] disabled:opacity-50"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width={20}
          height={20}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <p className="m-0 text-center font-[family-name:'Fraunces',serif] text-[18px] leading-[24px] font-semibold text-[var(--color-vellum)]">
        natally
      </p>
      <div className="flex min-h-[var(--size-touch)] items-center">
        {chip === undefined ? null : chip}
      </div>
    </header>
  );
}
