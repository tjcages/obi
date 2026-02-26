import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib";

export function SettingsRow({
  label,
  desc,
  children,
  stacked,
  onClick,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
  stacked?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-normal text-foreground-100 lg:text-[13.5px] lg:font-medium">{label}</div>
        {desc && (
          <div className="mt-0.5 text-[13px] leading-snug text-foreground-300 lg:text-[12.5px]">
            {desc}
          </div>
        )}
      </div>
      <div className={cn("shrink-0", onClick && "pointer-events-none")}>{children}</div>
    </>
  );

  const rowClass = cn(
    "min-h-[44px] px-4 py-3 lg:min-h-0 lg:px-5 lg:py-[14px]",
    onClick
      ? "flex w-full items-center justify-between gap-4 text-left transition-colors active:bg-foreground-100/5"
      : stacked
        ? "flex flex-col items-start gap-3"
        : "flex items-center justify-between gap-4 lg:gap-6",
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={rowClass}>
        {content}
      </button>
    );
  }

  return <div className={rowClass}>{content}</div>;
}

export function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 divide-y divide-border-100/50 overflow-hidden rounded-xl border border-border-100/70 lg:mb-6 lg:rounded-lg">
      {children}
    </div>
  );
}

export function SectionLabel({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-end justify-between px-1">
      <span className="text-[13px] font-normal uppercase tracking-wide text-foreground-300/60 lg:text-[12.5px]">{children}</span>
      {right}
    </div>
  );
}

export function SettingsDropdown<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1 text-[15px] text-foreground-300 transition-colors",
          "lg:min-h-0 lg:gap-1.5 lg:rounded-md lg:border lg:border-border-100/70 lg:bg-background-200/60 lg:px-3 lg:py-[5px] lg:pr-8 lg:text-[13px] lg:text-foreground-100",
        )}
      >
        {selected?.label ?? value}
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-30 lg:hidden">
          <path d="M9 18l6-6-6-6" />
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="hidden opacity-40 lg:block lg:absolute lg:right-2.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-[240px] min-w-[200px] overflow-y-auto rounded-xl border border-border-100/70 bg-background-100 py-1 shadow-xl lg:min-w-[160px] lg:rounded-lg">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3.5 py-3 text-left text-[15px] transition-colors lg:px-3 lg:py-[7px] lg:text-[13px]",
                opt.value === value
                  ? "bg-accent-100/10 font-medium text-accent-100"
                  : "text-foreground-200 active:bg-foreground-100/5 lg:hover:bg-foreground-100/5",
              )}
            >
              {opt.value === value && (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
              <span className={opt.value === value ? "" : "pl-[22px]"}>
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer rounded-full transition-colors duration-200 lg:h-[22px] lg:w-[42px]",
        checked ? "bg-green-500" : "bg-foreground-100/20",
      )}
    >
      <span
        className={cn(
          "pointer-events-none mt-[2px] ml-[2px] inline-block h-[27px] w-[27px] rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200 lg:h-[18px] lg:w-[18px]",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function SettingsTextInput({
  value,
  onChange,
  placeholder,
  align = "left",
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  align?: "left" | "right";
  width?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "w-full rounded-lg border border-border-100/70 bg-background-200/60 px-3 py-2.5 text-sm text-foreground-100 placeholder:text-foreground-300/40 focus:border-accent-100/50 focus:outline-none lg:w-auto lg:rounded-md lg:py-[5px] lg:text-[13px]",
        align === "right" && "text-right",
      )}
      style={width ? { width } : undefined}
    />
  );
}

export function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft("");
  };

  return (
    <div className="px-4 py-3.5 lg:px-5 lg:py-4">
      {tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {tags.map((tag, i) => (
            <span
              key={`${tag}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground-100/10 px-2.5 py-1 text-[13px] text-foreground-200 lg:rounded-md lg:px-2 lg:py-0.5 lg:text-[12px]"
            >
              {tag}
              <button
                type="button"
                onClick={() => onChange(tags.filter((_, j) => j !== i))}
                className="flex h-5 w-5 items-center justify-center rounded-full text-foreground-300 transition-colors hover:bg-foreground-100/10 hover:text-foreground-100 lg:h-auto lg:w-auto"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="min-h-[44px] flex-1 rounded-lg border border-border-100/70 bg-background-200/60 px-3 py-2.5 text-sm text-foreground-100 placeholder:text-foreground-300/40 focus:border-accent-100/50 focus:outline-none lg:min-h-0 lg:rounded-md lg:py-[5px] lg:text-[13px]"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="min-h-[44px] rounded-lg border border-border-100/70 px-4 py-2.5 text-sm text-foreground-300 transition-colors hover:text-foreground-100 disabled:opacity-30 lg:min-h-0 lg:rounded-md lg:px-3 lg:py-[5px] lg:text-[12px]"
        >
          Add
        </button>
      </div>
    </div>
  );
}
