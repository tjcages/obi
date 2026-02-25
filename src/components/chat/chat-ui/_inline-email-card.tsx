import { cn, formatRelative } from "../../../lib";

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

function parseSender(from: string): { name: string; initials: string; email: string } {
  const match = from.match(/^"?([^"<]+)"?\s*<([^>]+)>$/);
  const name = match ? match[1].trim() : from.split("@")[0];
  const email = match ? match[2] : from;
  const parts = name.split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  return { name, initials, email };
}

export interface InlineEmailCardProps {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread?: boolean;
}

export function InlineEmailCard({ from, subject, snippet, date, unread }: InlineEmailCardProps) {
  const sender = parseSender(from);
  const avatarColor = AVATAR_COLORS[hashString(from) % AVATAR_COLORS.length];

  return (
    <div className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/5 dark:hover:bg-white/3">
      <div
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
        style={{ backgroundColor: avatarColor }}
      >
        {sender.initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {unread && (
            <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-100" />
          )}
          <span className={cn("truncate text-[13px]", unread ? "font-semibold text-foreground-100" : "text-foreground-200")}>
            {sender.name}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-foreground-300">
            {formatRelative(date)}
          </span>
        </div>
        <div className={cn("mt-0.5 truncate text-[13px]", unread ? "font-medium text-foreground-100" : "text-foreground-200")}>
          {subject || "(no subject)"}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-foreground-300/70">
          {snippet}
        </div>
      </div>
    </div>
  );
}
