const AVATAR_COLORS = [
  "#6d86d3", "#7c3aed", "#059669", "#d97706",
  "#e11d48", "#0891b2", "#db2777", "#4f46e5",
  "#0d9488", "#ea580c",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function parseSender(from: string): { name: string; initials: string } {
  const match = from.match(/^"?([^"<]+)"?\s*<.*>$/);
  const name = match ? match[1].trim() : from.split("@")[0];
  const parts = name.split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  return { name, initials };
}

interface InlineQuoteBlockProps {
  text: string;
  from?: string;
  subject?: string;
  context?: string;
}

export function InlineQuoteBlock({ text, from, subject, context }: InlineQuoteBlockProps) {
  const sender = from ? parseSender(from) : null;
  const avatarColor = from ? AVATAR_COLORS[hashString(from) % AVATAR_COLORS.length] : null;

  return (
    <div className="overflow-hidden rounded-xl border border-accent-100/20 bg-accent-100/4">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="mt-1 flex h-5 shrink-0 items-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-accent-100/40">
            <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z"/>
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base leading-relaxed text-foreground-100 italic lg:text-[14px]">
            {text}
          </p>
          {(sender || subject) && (
            <div className="mt-2.5 flex items-center gap-2">
              {sender && avatarColor && (
                <div
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white lg:h-5 lg:w-5 lg:text-[8px]"
                  style={{ backgroundColor: avatarColor }}
                >
                  {sender.initials}
                </div>
              )}
              <span className="text-sm text-foreground-300 lg:text-[12px]">
                {sender ? sender.name : ""}
                {sender && subject ? " — " : ""}
                {subject && <span className="italic">{subject}</span>}
              </span>
            </div>
          )}
          {context && (
            <p className="mt-2 text-sm text-foreground-300/80 lg:text-[12px]">
              {context}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
