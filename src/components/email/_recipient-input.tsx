import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib";

interface Recipient {
  email: string;
  name?: string;
}

interface RecipientInputProps {
  label: string;
  recipients: Recipient[];
  onChange: (recipients: Recipient[]) => void;
  placeholder?: string;
  className?: string;
}

function parseRecipient(raw: string): Recipient | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const angleMatch = trimmed.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  if (angleMatch) {
    const email = angleMatch[2].trim();
    if (!email.includes("@")) return null;
    return { email, name: angleMatch[1].trim() || undefined };
  }

  if (trimmed.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { email: trimmed };
  }

  return null;
}

function RecipientPill({
  recipient,
  onRemove,
}: {
  recipient: Recipient;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-background-200 px-2 py-0.5 text-xs text-foreground-100">
      <span className="max-w-[160px] truncate">
        {recipient.name || recipient.email}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded-sm p-0.5 text-foreground-300 transition-colors hover:bg-background-300 hover:text-foreground-100"
        aria-label={`Remove ${recipient.email}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </span>
  );
}

export function RecipientInput({
  label,
  recipients,
  onChange,
  placeholder = "Add recipient...",
  className,
}: RecipientInputProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addRecipient = useCallback(
    (raw: string) => {
      const parsed = parseRecipient(raw);
      if (!parsed) return false;
      if (recipients.some((r) => r.email.toLowerCase() === parsed.email.toLowerCase())) {
        return true;
      }
      onChange([...recipients, parsed]);
      return true;
    },
    [recipients, onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
        if (inputValue.trim()) {
          e.preventDefault();
          if (addRecipient(inputValue)) {
            setInputValue("");
          }
        }
      } else if (e.key === "Backspace" && !inputValue && recipients.length > 0) {
        onChange(recipients.slice(0, -1));
      }
    },
    [inputValue, recipients, onChange, addRecipient],
  );

  const handleBlur = useCallback(() => {
    if (inputValue.trim()) {
      if (addRecipient(inputValue)) {
        setInputValue("");
      }
    }
  }, [inputValue, addRecipient]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData("text");
      const parts = text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        e.preventDefault();
        let added = false;
        for (const part of parts) {
          if (addRecipient(part)) added = true;
        }
        if (added) setInputValue("");
      }
    },
    [addRecipient],
  );

  const removeRecipient = useCallback(
    (index: number) => {
      onChange(recipients.filter((_, i) => i !== index));
    },
    [recipients, onChange],
  );

  return (
    <div
      className={cn(
        "flex items-start gap-2 px-4 py-2",
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      <span className="shrink-0 pt-0.5 text-xs text-foreground-300">{label}:</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {recipients.map((r, i) => (
          <RecipientPill
            key={r.email}
            recipient={r}
            onRemove={() => removeRecipient(i)}
          />
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onPaste={handlePaste}
          placeholder={recipients.length === 0 ? placeholder : ""}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-foreground-100 outline-none placeholder:text-foreground-300"
        />
      </div>
    </div>
  );
}

export type { Recipient };
