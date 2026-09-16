// natally — Composer (U.1). STATE-LEDGER id: Composer 6:24.
// plus · field · voice · one gilt send (the screen's one gilt primary).
// Pill shape (--radius-pill). Affordances without a wired handler render
// disabled — honest absence (INC-19: an inert control never pretends).
// Enter submits; the send button is disabled while empty or when disabled.

import type { FormEvent, ReactElement } from "react";

export type ComposerProps = {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onSend: () => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly onAttach?: () => void;
  readonly onVoice?: () => void;
};

const ICON_BUTTON_CLASSES = [
  "inline-flex min-h-[var(--size-touch)] min-w-[var(--size-touch)] items-center justify-center",
  "rounded-[var(--radius-pill)] bg-transparent text-[var(--color-vellum-muted)] border-0",
  "focus-visible:outline focus-visible:outline-[color:var(--color-orbglow)]",
  "disabled:opacity-50 disabled:cursor-not-allowed",
].join(" ");

export function Composer({
  value,
  onValueChange,
  onSend,
  disabled = false,
  placeholder,
  onAttach,
  onVoice,
}: ComposerProps): ReactElement {
  const sendDisabled = disabled || value.trim().length === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!sendDisabled) {
      onSend();
    }
  }

  return (
    <form
      data-ledger="Composer 6:24"
      onSubmit={handleSubmit}
      className="flex items-center gap-1 rounded-[var(--radius-pill)] border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)] bg-[var(--color-midnight-3)] p-1 pl-2"
    >
      <button
        type="button"
        aria-label="Attach"
        onClick={onAttach}
        disabled={disabled || onAttach === undefined}
        className={ICON_BUTTON_CLASSES}
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
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <input
        type="text"
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Message natally"
        className="min-h-[var(--size-touch)] min-w-0 flex-1 bg-transparent text-[var(--color-vellum)] border-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[16px] leading-[24px] outline-none placeholder:text-[color:var(--color-vellum-muted)] focus-visible:outline-none"
      />
      <button
        type="button"
        aria-label="Voice"
        onClick={onVoice}
        disabled={disabled || onVoice === undefined}
        className={ICON_BUTTON_CLASSES}
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
          <path d="M4 12c2-4 3-4 5 0s3 4 5 0 3-4 5 0" />
        </svg>
      </button>
      <button
        type="submit"
        aria-label="Send"
        disabled={sendDisabled}
        className="inline-flex min-h-[var(--size-touch)] min-w-[var(--size-touch)] items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-gilt)] text-[var(--color-midnight)] border-0 focus-visible:outline focus-visible:outline-[color:var(--color-orbglow)] disabled:opacity-50 disabled:cursor-not-allowed"
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
          strokeLinejoin="round"
        >
          <path d="M5 19L19 5M11.5 5H19v7.5" />
        </svg>
      </button>
    </form>
  );
}
