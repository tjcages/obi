import { useState } from "react";
import { formatRelative } from "../../../lib";
import { EmailContentRenderer } from "../../email/_email-content-renderer";

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

interface InlineEmailPreviewProps {
  from: string;
  to?: string;
  subject: string;
  date: string;
  snippet: string;
  bodyText?: string;
  highlight?: string;
}

export function InlineEmailPreview({
  from,
  to,
  subject,
  date,
  snippet,
  bodyText,
  highlight,
}: InlineEmailPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const sender = parseSender(from);
  const avatarColor = AVATAR_COLORS[hashString(from) % AVATAR_COLORS.length];
  const hasBody = bodyText && bodyText.trim().length > 0;

  return (
    <div className="overflow-hidden rounded-xl border border-border-100/60 bg-background-100/80 backdrop-blur-sm">
      {/* Header */}
      <div className="border-b border-border-100/40 px-4 py-3">
        <div className="text-[14px] font-semibold text-foreground-100">
          {subject || "(no subject)"}
        </div>
        <div className="mt-2 flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
            style={{ backgroundColor: avatarColor }}
          >
            {sender.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[13px] font-medium text-foreground-100">{sender.name}</span>
              <span className="truncate text-[11px] text-foreground-300">&lt;{sender.email}&gt;</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-foreground-300">
              {to && (
                <>
                  <span>to {to.split(",")[0].trim()}{to.includes(",") ? ` +${to.split(",").length - 1}` : ""}</span>
                  <span>&middot;</span>
                </>
              )}
              <span>{formatRelative(date)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Highlight callout */}
      {highlight && (
        <div className="border-b border-accent-100/15 bg-accent-100/4 px-4 py-2.5">
          <div className="flex items-start gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-accent-100/60">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <p className="text-[13px] leading-relaxed text-foreground-200 italic">
              {highlight}
            </p>
          </div>
        </div>
      )}

      {/* Body / Snippet */}
      <div className="px-4 py-3">
        {expanded && hasBody ? (
          <div className="text-[14px]">
            <EmailContentRenderer bodyHtml="" bodyText={bodyText!} />
          </div>
        ) : (
          <p className="text-[13px] leading-relaxed text-foreground-200">
            {snippet}
          </p>
        )}
      </div>

      {/* Expand toggle */}
      {hasBody && (
        <div className="border-t border-border-100/40 px-4 py-1.5">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[12px] font-medium text-accent-100/80 transition-colors hover:text-accent-100"
          >
            {expanded ? "Show less" : "Show full email"}
          </button>
        </div>
      )}
    </div>
  );
}
