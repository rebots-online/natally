import type { ButtonHTMLAttributes } from "react";
import "./primitives.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "quiet";
}

/** STATE-LEDGER.json components.Button = 6:8; gilt / hairline / quiet variants. */
export function Button({
  variant = "secondary",
  type = "button",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`ui-button ui-button--${variant} ${className}`.trim()}
    />
  );
}
