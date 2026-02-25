import { InlineEmailCard, type InlineEmailCardProps } from "./_inline-email-card";

interface InlineEmailListProps {
  title?: string;
  emails: InlineEmailCardProps[];
}

export function InlineEmailList({ title, emails }: InlineEmailListProps) {
  if (emails.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border-100/60 bg-background-100/80 backdrop-blur-sm">
      {title && (
        <div className="border-b border-border-100/40 px-4 py-2">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-foreground-300">
            {title}
          </span>
        </div>
      )}
      <div className="divide-y divide-border-100/30">
        {emails.map((email) => (
          <InlineEmailCard key={email.id || `${email.from}-${email.date}`} {...email} />
        ))}
      </div>
      {emails.length > 0 && (
        <div className="border-t border-border-100/40 px-4 py-1.5 text-center">
          <span className="text-[11px] text-foreground-300/60">
            {emails.length} email{emails.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
