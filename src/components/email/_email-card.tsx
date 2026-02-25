import type { EmailSummary } from "../../domain";
import { formatRelative } from "../../lib";

export function EmailCard({ email }: { email: EmailSummary }) {
  return (
    <div className="min-w-0 flex flex-col gap-0.5 rounded border border-border-100 bg-background-200 px-3 py-2">
      <div className="flex justify-between text-sm">
        <span className="truncate max-w-[60%] text-foreground-200">{email.from}</span>
        <span className="shrink-0 text-foreground-300">{formatRelative(email.date)}</span>
      </div>
      <div className="truncate text-base text-foreground-100">{email.subject}</div>
      <div className="truncate text-sm text-foreground-300">{email.snippet}</div>
    </div>
  );
}
