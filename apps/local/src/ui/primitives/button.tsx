// natally — Button (U.1). STATE-LEDGER id: Button 6:8.
// Variants per the frozen Components page: primary (gilt — the one primary
// action per screen, DESIGN.md "Colour"), secondary (hairline), quiet.
// Every control is at least 44 px (--size-touch); the focus ring is orbglow.
// Colours/radii bind the frozen token vars only — no raw hex (ARCHITECTURE.md §3).

import type { ButtonHTMLAttributes, ReactElement } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
};

const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-[var(--color-gilt)] text-[var(--color-midnight)] border-0 font-semibold",
  secondary:
    "bg-[var(--color-midnight-3)] text-[var(--color-vellum)] border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)] font-semibold",
  quiet: "bg-transparent text-[var(--color-vellum-muted)] border-0 font-semibold",
};

const BUTTON_BASE_CLASSES = [
  "inline-flex items-center justify-center gap-2",
  "min-h-[var(--size-touch)] px-4 py-2",
  "rounded-[var(--radius-button)]",
  "font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif]",
  "text-[16px] leading-[24px]",
  "focus-visible:outline focus-visible:outline-[color:var(--color-orbglow)]",
  "disabled:opacity-50 disabled:cursor-not-allowed",
].join(" ");

export function Button({
  variant = "primary",
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      type={type}
      data-ledger="Button 6:8"
      data-variant={variant}
      className={`${BUTTON_BASE_CLASSES} ${VARIANT_CLASSES[variant]}${className === undefined ? "" : ` ${className}`}`}
      {...rest}
    >
      {children}
    </button>
  );
}
