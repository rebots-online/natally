import type { ButtonHTMLAttributes } from "react";
import "./primitives.css";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

/** STATE-LEDGER.json components.Chip = 6:13; active context uses orbglow. */
export function Chip({ active = false, type = "button", className = "", ...props }: ChipProps) {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={active}
      className={`ui-chip${active ? " ui-chip--active" : ""} ${className}`.trim()}
    />
  );
}
