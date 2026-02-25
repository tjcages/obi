import { useEffect, useState } from "react";
import { formatRelative } from "../../lib";
import { EmailContentRenderer } from "./_email-content-renderer";

interface EmailMessageAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  date: string;
  bodyHtml: string;
  bodyText: string;
  unread: boolean;
  labelIds: string[];
  attachments?: EmailMessageAttachment[];
}

const AVATAR_COLORS = [
  "#6d86d3", "#7c3aed", "#059669", "#d97706",
  "#e11d48", "#0891b2", "#db2777", "#4f46e5",
  "#0d9488", "#ea580c",
];

function hashStr(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function parseSender(from: string): { name: string; email: string; initials: string } {
  const match = from.match(/^"?([^"<]+)"?\s*<([^>]+)>$/);
  const name = match ? match[1].trim() : from.split("@")[0];
  const email = match ? match[2] : from;
  const parts = name.split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  return { name, email, initials };
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk",
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me", "fastmail.com",
  "mail.com", "zoho.com", "yandex.com",
]);

function parseCompany(email: string): { name: string; url: string } | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return null;
  const raw = domain.split(".")[0];
  if (!raw || raw.length < 2) return null;
  return {
    name: raw.charAt(0).toUpperCase() + raw.slice(1),
    url: `https://${domain}`,
  };
}

function SkeletonDetail() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      <div className="space-y-3">
        <div className="h-6 w-3/4 rounded bg-background-300" />
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-background-300" />
          <div className="space-y-1.5">
            <div className="h-4 w-32 rounded bg-background-300" />
            <div className="h-3 w-48 rounded bg-background-200" />
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <div className="h-4 w-full rounded bg-background-200" />
        <div className="h-4 w-5/6 rounded bg-background-200" />
        <div className="h-4 w-4/6 rounded bg-background-200" />
        <div className="h-4 w-full rounded bg-background-200" />
        <div className="h-4 w-3/4 rounded bg-background-200" />
      </div>
    </div>
  );
}

interface EmailDetailProps {
  messageId: string;
  onBack: () => void;
  onChatAbout: (email: { from: string; subject: string; snippet: string }) => void;
}

export function EmailDetail({ messageId, onBack, onChatAbout }: EmailDetailProps) {
  const [email, setEmail] = useState<EmailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/messages/${messageId}`);
        if (!res.ok) {
          if (res.status === 401) {
            window.location.assign("/logout");
            return;
          }
          throw new Error(`Failed to load email (${res.status})`);
        }
        const data = (await res.json()) as EmailMessage;
        if (!cancelled) setEmail(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load email");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [messageId]);

  if (loading) return <SkeletonDetail />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-destructive-100">{error}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-3 text-sm text-foreground-300 underline transition-colors hover:text-foreground-200"
        >
          Back to inbox
        </button>
      </div>
    );
  }

  if (!email) return null;

  const sender = parseSender(email.from);
  const company = parseCompany(sender.email);
  const avatarColor = AVATAR_COLORS[hashStr(email.from) % AVATAR_COLORS.length];

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-100 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg p-1.5 text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/>
            <path d="M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <span className="text-base text-foreground-300 lg:text-sm">Back</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onChatAbout({ from: email.from, subject: email.subject, snippet: email.snippet })}
          className="rounded-lg bg-accent-100 px-4 py-2 text-base font-medium text-white transition-colors hover:bg-accent-100/90 lg:px-3.5 lg:py-1.5 lg:text-sm"
        >
          Chat about this
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <h1 className="text-xl font-semibold tracking-tight text-foreground-100">
            {email.subject || "(no subject)"}
          </h1>

          <div className="mt-4 flex items-start gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white"
              style={{ backgroundColor: avatarColor }}
            >
              {sender.initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="group/sender relative">
                  <span className="cursor-default font-medium text-foreground-100">
                    {sender.name}
                  </span>
                  <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] text-neutral-200 opacity-0 shadow-lg transition-opacity duration-150 group-hover/sender:opacity-100 dark:bg-neutral-700">
                    {sender.email}
                  </div>
                </div>
                {company && (
                  <a
                    href={company.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-500 no-underline transition-colors hover:bg-blue-100 hover:text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900/50 dark:hover:text-blue-300 lg:px-2 lg:py-0.5 lg:text-[11px]"
                  >
                    {company.name}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-sm text-foreground-300 lg:text-xs">
                <span>to {parseSender(email.to.split(",")[0].trim()).name}{email.to.includes(",") ? " +" + (email.to.split(",").length - 1) : ""}</span>
                <span>&middot;</span>
                <span>{formatRelative(email.date)}</span>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <EmailContentRenderer
              bodyHtml={email.bodyHtml}
              bodyText={email.bodyText}
              attachments={email.attachments}
              messageId={email.id}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
