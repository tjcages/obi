import { useRef, useLayoutEffect, useCallback } from "react";
import { cn, useIsMobile } from "../../lib";

const MAX_ROWS = 6;
const LINE_HEIGHT = 24;
const PADDING_Y = 24;
const MIN_HEIGHT = LINE_HEIGHT + PADDING_Y;
const MIN_HEIGHT_MOBILE = LINE_HEIGHT * 2 + PADDING_Y;
const MAX_HEIGHT = LINE_HEIGHT * MAX_ROWS + PADDING_Y;

const RING_SIZE = 24;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ContextProgressRing({ percent }: { percent: number }) {
  const offset = RING_CIRCUMFERENCE - (percent / 100) * RING_CIRCUMFERENCE;
  const color =
    percent > 85
      ? "stroke-red-400"
      : percent > 60
        ? "stroke-amber-400"
        : "stroke-foreground-300";

  if (percent < 1) return null;

  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      className="shrink-0"
      aria-label={`Context window ${Math.round(percent)}% used`}
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={RING_STROKE}
        className="stroke-border-100"
      />
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={offset}
        className={cn("transition-all duration-300", color)}
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
}

interface ChatInputProps {
  input: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  disabled?: boolean;
  contextPercent?: number;
}

export function ChatInput({
  input,
  onChange,
  onSubmit,
  disabled,
  contextPercent = 0,
}: ChatInputProps) {
  const boundedPercent = Math.max(0, Math.min(100, contextPercent));
  const canSend = !disabled && input.trim().length > 0;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();
  const minH = isMobile ? MIN_HEIGHT_MOBILE : MIN_HEIGHT;

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0";
    const scrollH = el.scrollHeight;
    el.style.height = `${Math.min(Math.max(scrollH, minH), MAX_HEIGHT)}px`;
  }, [minH]);

  useLayoutEffect(() => resize(), [input, resize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        const form = e.currentTarget.form;
        if (form) form.requestSubmit();
      }
    }
  };

  return (
    <form
      className="flex shrink-0 items-end gap-2.5 border-t border-border-100 px-4 py-3"
      onSubmit={onSubmit}
    >
      <textarea
        ref={textareaRef}
        value={input}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder="Ask about your inbox..."
        disabled={disabled}
        rows={1}
        aria-label="Chat message"
        className="flex-1 resize-none rounded-xl border border-border-100 bg-background-200 px-4 py-3 text-[15px] leading-[24px] text-foreground-100 outline-none transition-[height,border-color] duration-150 ease-out placeholder:text-foreground-300 focus:border-accent-100 disabled:opacity-50"
        style={{ minHeight: minH, maxHeight: MAX_HEIGHT }}
      />
      <div className="mb-0.5 flex items-center gap-2.5">
        <ContextProgressRing percent={boundedPercent} />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-100 text-white transition-colors hover:bg-accent-100/90 disabled:cursor-not-allowed disabled:bg-background-300 disabled:text-foreground-300"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </form>
  );
}
