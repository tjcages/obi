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
    <div className="group flex w-full items-center">
      <button
        type="button"
        onClick={onTap}
        className="flex min-w-0 flex-1 flex-col p-4 text-left"
      >
        <span className="truncate text-base font-medium text-foreground-100 lg:text-sm">
          {title}
        </span>
        {snippet && (
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-foreground-300 lg:text-xs">
            {snippet}
          </p>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onArchive();
        }}
        aria-label="Archive conversation"
        className="mr-3 shrink-0 rounded-md p-1.5 text-foreground-300 opacity-0 transition-all hover:bg-background-200 hover:text-foreground-200 group-hover:opacity-100"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="20" height="5" rx="1" />
          <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
          <path d="M10 12h4" />
        </svg>
      </button>
    </div>
  );
}
