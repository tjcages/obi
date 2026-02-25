import { useEffect, useMemo, useState } from "react";
import { parseSenderName, type InboxEmail } from "../components/email/_email-row";

const STATIC_SUGGESTIONS = [
  "How many unread emails do I have?",
  "Summarize my last 5 emails",
  "What needs my attention?",
  "Find emails I haven't replied to",
  "Do I have any starred emails?",
  "Draft a reply to my latest email",
];

function buildDynamicSuggestions(emails: InboxEmail[]): string[] {
  const suggestions: string[] = [];
  if (emails.length === 0) return suggestions;

  const unread = emails.filter((e) => e.unread);
  if (unread.length > 0) {
    suggestions.push(
      `Summarize my ${unread.length} unread email${unread.length > 1 ? "s" : ""}`,
    );
  }

  const senders = new Map<string, number>();
  for (const e of emails) {
    const { name } = parseSenderName(e.from);
    senders.set(name, (senders.get(name) ?? 0) + 1);
  }
  const topSenders = [...senders.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (const [name, count] of topSenders) {
    if (count > 1) {
      suggestions.push(`Summarize emails from ${name}`);
    } else {
      suggestions.push(`What did ${name} say?`);
    }
  }

  const recent = emails.slice(0, 3);
  for (const e of recent) {
    if (e.subject) {
      const subj =
        e.subject.length > 40 ? e.subject.slice(0, 40) + "…" : e.subject;
      suggestions.push(`Tell me about "${subj}"`);
    }
  }

  return suggestions;
}

export function useSuggestions(): string[] {
  const [emails, setEmails] = useState<InboxEmail[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/inbox?max=15", {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { emails: InboxEmail[] };
        setEmails(data.emails);
      } catch {
        // fall back to static only
      }
    })();
    return () => controller.abort();
  }, []);

  return useMemo(() => {
    const dynamic = buildDynamicSuggestions(emails);
    const seen = new Set(dynamic);
    const combined = [...dynamic];
    for (const s of STATIC_SUGGESTIONS) {
      if (!seen.has(s)) {
        combined.push(s);
        seen.add(s);
      }
    }
    return combined.slice(0, 12);
  }, [emails]);
}
