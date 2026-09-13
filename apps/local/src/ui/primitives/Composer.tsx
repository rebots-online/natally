import { type KeyboardEvent, useId } from "react";
import { Button } from "./Button";

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
  onAttach?: () => void;
  onVoice?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  voiceActive?: boolean;
  disabled?: boolean;
  label?: string;
}

/** STATE-LEDGER.json components.Composer = 6:24; plus, field, voice, one gilt send. */
export function Composer({
  value,
  onChange,
  onSend,
  onAttach,
  onVoice,
  onFocus,
  onBlur,
  voiceActive = false,
  disabled = false,
  label = "Message",
}: ComposerProps) {
  const fieldId = useId();
  const canSend = !disabled && value.trim().length > 0;
  const send = () => {
    if (canSend) onSend(value);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      send();
    }
  };
  return (
    <form
      className="ui-composer"
      aria-label="Compose message"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <Button
        variant="quiet"
        aria-label="Add attachment"
        disabled={disabled || !onAttach}
        onClick={onAttach}
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
          <path d="M12 4v16M4 12h16" />
        </svg>
      </Button>
      <label className="ui-sr-only" htmlFor={fieldId}>
        {label}
      </label>
      <textarea
        id={fieldId}
        className="ui-composer__field"
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <Button
        variant="quiet"
        aria-label="Voice input"
        aria-pressed={voiceActive}
        disabled={disabled || !onVoice}
        onClick={onVoice}
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
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8" />
        </svg>
      </Button>
      <Button variant="primary" type="submit" aria-label="Send message" disabled={!canSend}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M12 20V4M5 11l7-7 7 7" />
        </svg>
      </Button>
    </form>
  );
}
