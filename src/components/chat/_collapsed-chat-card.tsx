interface CollapsedChatCardProps {
  title: string;
  snippet: string;
  onTap: () => void;
  onArchive: () => void;
}

export function CollapsedChatCard({
  title,
  snippet,
  onTap,
  onArchive,
}: CollapsedChatCardProps) {
  return (
    <div className="group flex w-full items-center rounded-xl transition-colors hover:bg-foreground-100/3">
      <button
        type="button"
        onClick={onTap}
        className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-foreground-300/40">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-foreground-100 lg:text-[13px]">
            {title}
          </span>
          {snippet && (
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-foreground-300/60 lg:text-[12px]">
              {snippet}
            </p>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onArchive();
        }}
        aria-label="Archive conversation"
        className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-foreground-300/40 opacity-0 transition-all hover:bg-foreground-100/8 hover:text-foreground-200 group-hover:opacity-100"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 8V21H3V8" />
          <path d="M1 3h22v5H1z" />
          <path d="M10 12h4" />
        </svg>
      </button>
    </div>
  );
}
