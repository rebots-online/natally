import type { ReactNode } from "react";
import { Button } from "./Button";

export interface TopBarProps {
  context?: ReactNode;
  onMenu: () => void;
  menuOpen?: boolean;
  menuId?: string;
}

/** STATE-LEDGER.json components.TopBar = 6:16; menu, wordmark, context chip. */
export function TopBar({ context, onMenu, menuOpen = false, menuId }: TopBarProps) {
  return (
    <header className="ui-topbar">
      <Button
        variant="quiet"
        onClick={onMenu}
        aria-label="Menu"
        aria-expanded={menuOpen}
        aria-controls={menuId}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </Button>
      <span className="ui-topbar__wordmark">
        {typeof document === "undefined" ? "" : document.title}
      </span>
      <div className="ui-topbar__context">{context}</div>
    </header>
  );
}
