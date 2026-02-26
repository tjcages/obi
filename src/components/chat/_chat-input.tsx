import { useRef, useLayoutEffect, useCallback } from "react";
import { ArrowUp } from "@phosphor-icons/react";
import { cn, useIsMobile } from "../../lib";

const MAX_ROWS = 6;
const LINE_HEIGHT = 24;
const PADDING_Y = 24;
const MIN_HEIGHT = LINE_HEIGHT + PADDING_Y;
const MIN_HEIGHT_MOBILE = LINE_HEIGHT * 2 + PADDING_Y;
const MAX_HEIGHT = LINE_HEIGHT * MAX_ROWS + PADDING_Y;

const RING_SIZE = 22;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ContextProgressRing({ percent }: { percent: number }) {
  const offset = RING_CIRCUMFERENCE - (percent / 100) * RING_CIRCUMFERENCE;
  const color =
    percent > 85
      ? "stroke-red-400"
      : percent > 60
        ? "stroke-amber-400"
        : "stroke-foreground-300/60";

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
    <div className="shrink-0 border-t border-border-100/60 px-4 py-3">
      <form
        className="flex items-end gap-2"
        onSubmit={onSubmit}
      >
        <div className="flex min-w-0 flex-1 items-end rounded-2xl border border-border-100/80 bg-background-200/80 transition-all focus-within:border-foreground-300/40 focus-within:bg-background-100 focus-within:shadow-lg">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your inbox..."
            disabled={disabled}
            rows={1}
            aria-label="Chat message"
            className="flex-1 resize-none bg-transparent py-3 pl-4 pr-2 text-[15px] leading-[24px] text-foreground-100 outline-none placeholder:text-foreground-300/50 disabled:opacity-40"
            style={{ minHeight: minH, maxHeight: MAX_HEIGHT }}
          />
          <div className="flex shrink-0 items-center gap-1.5 pb-2 pr-2">
            <ContextProgressRing percent={boundedPercent} />
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
                canSend
                  ? "bg-foreground-100 text-background-100 hover:bg-foreground-100/90"
                  : "bg-foreground-100/8 text-foreground-300/50",
              )}
            >
              <ArrowUp size={16} weight="bold" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
