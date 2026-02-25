import { motion, AnimatePresence } from "motion/react";
import { formatRelative, cn } from "../../lib";
import { SwipeableEmailRow } from "../ui/_swipeable-email-row";

export interface InboxEmail {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  labelIds: string[];
  unread: boolean;
  accountEmail?: string;
}

export interface ThreadGroup {
  representative: InboxEmail;
  threadId: string;
  count: number;
  participants: string[];
  hasUnread: boolean;
  previousReply?: { from: string; snippet: string };
}

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

export function parseSenderName(from: string): { name: string; initials: string } {
  const match = from.match(/^"?([^"<]+)"?\s*<.*>$/);
  const name = match ? match[1].trim() : from.split("@")[0];
  const parts = name.split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  return { name, initials };
}

export function groupByThread(emails: InboxEmail[]): ThreadGroup[] {
  const map = new Map<string, InboxEmail[]>();
  for (const email of emails) {
    const list = map.get(email.threadId);
    if (list) list.push(email);
    else map.set(email.threadId, [email]);
  }

  const threads: ThreadGroup[] = [];
  for (const [threadId, msgs] of map) {
    msgs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const uniqueFroms = [...new Set(msgs.map((m) => m.from))];
    threads.push({
      representative: msgs[0],
      threadId,
      count: msgs.length,
      participants: uniqueFroms,
      hasUnread: msgs.some((m) => m.unread),
      previousReply: msgs.length > 1
        ? { from: msgs[1].from, snippet: msgs[1].snippet }
        : undefined,
    });
  }

  threads.sort(
    (a, b) =>
      new Date(b.representative.date).getTime() -
      new Date(a.representative.date).getTime(),
  );

  return threads;
}

export interface AccountColorMap {
  [email: string]: string;
}

// ---------------------------------------------------------------------------
// Sender grouping
// ---------------------------------------------------------------------------

function extractSenderEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).toLowerCase().trim();
}

export interface SenderGroup {
  senderKey: string;
  senderName: string;
  threads: ThreadGroup[];
  totalEmails: number;
  hasUnread: boolean;
  latestDate: string;
  summary: GroupSummary | null;
}

export interface GroupSummary {
  label: string;
  amounts?: { value: number; currency: string }[];
  total?: { value: number; currency: string };
}

const CURRENCY_RE = /(?:(?:\$|USD\s?)(\d[\d,]*\.?\d*)|(\d[\d,]*\.?\d*)\s*(?:USD|dollars?))/gi;

function extractAmounts(text: string): { value: number; currency: string }[] {
  const amounts: { value: number; currency: string }[] = [];
  let match;
  const re = new RegExp(CURRENCY_RE.source, CURRENCY_RE.flags);
  while ((match = re.exec(text)) !== null) {
    const raw = (match[1] || match[2]).replace(/,/g, "");
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0 && val < 1_000_000) {
      amounts.push({ value: val, currency: "USD" });
    }
  }
  return amounts;
}

function buildGroupSummary(threads: ThreadGroup[], senderName: string): GroupSummary | null {
  if (threads.length < 2) return null;

  const allAmounts: { value: number; currency: string }[] = [];
  for (const t of threads) {
    const text = `${t.representative.subject} ${t.representative.snippet}`;
    const raw = extractAmounts(text);
    // Deduplicate within each email — the snippet often echoes the subject,
    // so the same dollar figure shows up twice in the concatenated text.
    const seen = new Set<number>();
    for (const a of raw) {
      if (!seen.has(a.value)) {
        seen.add(a.value);
        allAmounts.push(a);
      }
    }
  }

  if (allAmounts.length >= 2) {
    const total = allAmounts.reduce((sum, a) => sum + a.value, 0);
    const currency = allAmounts[0].currency;
    return {
      label: `${allAmounts.length} transactions totaling`,
      amounts: allAmounts,
      total: { value: total, currency },
    };
  }

  return {
    label: `${threads.length} emails from ${senderName}`,
  };
}

function formatCurrency(value: number, currency: string): string {
  if (currency === "USD") return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${value.toFixed(2)} ${currency}`;
}

export function groupBySender(threads: ThreadGroup[], minGroupSize = 2): (ThreadGroup | SenderGroup)[] {
  const senderMap = new Map<string, ThreadGroup[]>();
  const senderNames = new Map<string, string>();

  for (const thread of threads) {
    const key = extractSenderEmail(thread.representative.from);

    const existing = senderMap.get(key);
    if (existing) {
      existing.push(thread);
    } else {
      senderMap.set(key, [thread]);
    }

    if (!senderNames.has(key)) {
      senderNames.set(key, parseSenderName(thread.representative.from).name);
    }
  }

  const result: (ThreadGroup | SenderGroup)[] = [];
  const grouped = new Set<string>();

  for (const thread of threads) {
    const key = extractSenderEmail(thread.representative.from);

    if (grouped.has(key)) continue;

    const group = senderMap.get(key)!;
    if (group.length >= minGroupSize) {
      grouped.add(key);
      const senderName = senderNames.get(key) || key;
      const totalEmails = group.reduce((sum, t) => sum + t.count, 0);
      const latestDate = group.reduce((latest, t) => {
        const d = t.representative.date;
        return d > latest ? d : latest;
      }, group[0].representative.date);

      result.push({
        senderKey: key,
        senderName,
        threads: group,
        totalEmails,
        hasUnread: group.some((t) => t.hasUnread),
        latestDate,
        summary: buildGroupSummary(group, senderName),
      });
    } else {
      grouped.add(key);
      result.push(thread);
    }
  }

  return result;
}

export function isSenderGroup(item: ThreadGroup | SenderGroup): item is SenderGroup {
  return "senderKey" in item;
}

// ---------------------------------------------------------------------------
// SenderGroupRow – collapsed view of multiple threads from one sender
// ---------------------------------------------------------------------------

interface SenderGroupRowProps {
  group: SenderGroup;
  compact?: boolean;
  onClick?: (thread: ThreadGroup) => void;
  onArchive?: (thread: ThreadGroup) => void;
  onReply?: (thread: ThreadGroup) => void;
  index?: number;
  accountColors?: AccountColorMap;
  expanded?: boolean;
  onToggleExpand?: () => void;
  hiddenThreadIds?: Set<string>;
}

export function SenderGroupRow({
  group,
  compact,
  onClick,
  onArchive,
  onReply,
  index = 0,
  accountColors,
  expanded,
  onToggleExpand,
  hiddenThreadIds,
}: SenderGroupRowProps) {
  const { senderName, threads, totalEmails, hasUnread, latestDate, summary } = group;
  const { initials } = parseSenderName(threads[0].representative.from);
  const avatarColor = AVATAR_COLORS[hashString(threads[0].representative.from) % AVATAR_COLORS.length];

  const accountEmails = [...new Set(threads.map((t) => t.representative.accountEmail).filter(Boolean))];
  const showAccountDots = accountColors && Object.keys(accountColors).length > 1 && accountEmails.length > 0;

  return (
    <div>
      {/* Collapsed header */}
      <button
        type="button"
        onClick={onToggleExpand}
        className={cn("group relative flex w-full items-center gap-3 border-b border-border-200 text-left transition-colors hover:bg-background-200/70", compact ? "px-2 py-3 lg:px-3 lg:py-2.5" : "px-2.5 py-3.5 lg:px-4 lg:py-3.5", expanded && "bg-background-200/60")}
      >
        {/* Left accent bar */}
        <div
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
          style={{ backgroundColor: avatarColor, opacity: 0.5 }}
        />

        {!compact && (
          <div className="relative shrink-0 self-start mt-0.5">
            {/* Stacked card shadows behind the avatar */}
            <div
              className="absolute left-[3px] top-[3px] h-10 w-10 rounded-full opacity-20 lg:h-9 lg:w-9"
              style={{ backgroundColor: avatarColor }}
            />
            <div
              className="absolute left-[6px] top-[6px] h-10 w-10 rounded-full opacity-10 lg:h-9 lg:w-9"
              style={{ backgroundColor: avatarColor }}
            />
            <div
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-white ring-2 ring-background-100 lg:h-9 lg:w-9 lg:text-xs"
              style={{ backgroundColor: avatarColor }}
            >
              {initials}
            </div>
            <div className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[11px] font-semibold leading-none text-white ring-1 ring-background-100 dark:bg-blue-500 lg:h-[18px] lg:min-w-[18px] lg:text-[10px]">
              {threads.length}
            </div>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {hasUnread && (
              <div className="h-2 w-2 shrink-0 rounded-full bg-accent-100 lg:h-1.5 lg:w-1.5" />
            )}
            <span
              className={cn("truncate text-base lg:text-sm", hasUnread ? "font-semibold text-foreground-100" : "text-foreground-300")}
            >
              {senderName}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 lg:px-1.5 lg:text-[10px]">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                <path d="M16 3h4a2 2 0 0 1 2 2v2H2V5a2 2 0 0 1 2-2h4" />
              </svg>
              {threads.length}
            </span>
            {showAccountDots && (
              <div className="ml-auto flex items-center gap-0.5">
                {accountEmails.map((email) => (
                  <span
                    key={email}
                    className="h-2.5 w-2.5 shrink-0 rounded-full lg:h-2 lg:w-2"
                    style={{ backgroundColor: accountColors![email!] }}
                    title={`via ${email}`}
                  />
                ))}
              </div>
            )}
            <span className={cn(showAccountDots ? "ml-1" : "ml-auto", "shrink-0 text-sm text-foreground-300 lg:text-xs")}>
              {formatRelative(latestDate)}
            </span>
          </div>

          {/* Summary line */}
          {summary && (
            <div className="mt-0.5 flex items-center gap-1.5">
              {summary.total ? (
                <span className="truncate text-base text-foreground-200 lg:text-sm">
                  <span className="font-medium">{summary.label}</span>{" "}
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(summary.total.value, summary.total.currency)}
                  </span>
                </span>
              ) : (
                <span className="truncate text-base text-foreground-300 lg:text-sm">
                  {summary.label}
                </span>
              )}
            </div>
          )}

          {/* Subject preview (most recent) */}
          {!compact && (
            <div className="mt-0.5 truncate text-sm text-foreground-300/70 lg:text-xs">
              {threads[0].representative.subject || "(no subject)"}
            </div>
          )}
        </div>

        {/* Expand chevron */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("hidden shrink-0 text-foreground-300 transition-transform lg:block", expanded && "rotate-90")}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      {/* Expanded children */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="border-b border-border-200 bg-background-200/40"
          >
            {/* Transaction breakdown when amounts exist */}
            {summary?.amounts && summary.amounts.length >= 2 && (
              <div className="flex flex-wrap gap-1.5 border-b border-border-200/60 px-4 py-2.5 lg:py-2">
                {summary.amounts.map((a, i) => (
                  <span
                    key={i}
                    className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 lg:px-2 lg:py-0.5 lg:text-[11px]"
                  >
                    {formatCurrency(a.value, a.currency)}
                  </span>
                ))}
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-800/40 dark:text-emerald-300 lg:px-2 lg:py-0.5 lg:text-[11px]">
                  = {formatCurrency(summary.total!.value, summary.total!.currency)}
                </span>
              </div>
            )}

            <AnimatePresence mode="popLayout">
              {threads
                .filter((t) => !hiddenThreadIds?.has(t.threadId))
                .map((thread, i) => (
                  <SwipeableEmailRow
                    key={thread.threadId}
                    onArchive={() => onArchive?.(thread)}
                    onReply={() => onReply?.(thread)}
                    compact
                  >
                    <EmailRow
                      thread={thread}
                      compact
                      onClick={onClick}
                      index={i}
                      accountColors={accountColors}
                    />
                  </SwipeableEmailRow>
                ))}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface EmailRowProps {
  thread: ThreadGroup;
  compact?: boolean;
  onClick?: (thread: ThreadGroup) => void;
  index?: number;
  accountColors?: AccountColorMap;
}

export function EmailRow({ thread, compact, onClick, index = 0, accountColors }: EmailRowProps) {
  const { representative, count, participants, hasUnread, previousReply } = thread;
  const { name, initials } = parseSenderName(representative.from);
  const avatarColor = AVATAR_COLORS[hashString(representative.from) % AVATAR_COLORS.length];
  const accountColor = representative.accountEmail && accountColors ? accountColors[representative.accountEmail] : null;
  const showAccountDot = !!accountColor && Object.keys(accountColors || {}).length > 1;

  const participantLabel =
    count > 1 && participants.length > 1
      ? participants
          .slice(0, 3)
          .map((p) => parseSenderName(p).name.split(" ")[0])
          .join(", ") + (participants.length > 3 ? ` +${participants.length - 3}` : "")
      : name;

  const prevSenderName = previousReply
    ? parseSenderName(previousReply.from).name.split(" ")[0]
    : null;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{
        opacity: { duration: 0.25, ease: "easeOut", delay: index * 0.03 },
        height: { type: "spring", stiffness: 500, damping: 40, mass: 0.8, delay: index * 0.03 },
        layout: { type: "spring", stiffness: 500, damping: 40, mass: 0.8 },
      }}
      style={{ overflow: "hidden" }}
    >
      <button
        type="button"
        onClick={() => onClick?.(thread)}
        className={cn("group flex w-full items-center gap-3 border-b border-border-200 text-left transition-colors last:border-b-0 hover:bg-background-200/70", compact ? "px-2 py-3 lg:px-3 lg:py-2.5" : "px-2.5 py-3.5 lg:px-4 lg:py-3.5")}
      >
        {!compact && (
          <div className="relative shrink-0 self-start mt-0.5">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-white lg:h-9 lg:w-9 lg:text-xs"
              style={{ backgroundColor: avatarColor }}
            >
              {initials}
            </div>
            {count > 1 && (
              <div className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground-200 px-1 text-[11px] font-semibold leading-none text-background-100 lg:h-[18px] lg:min-w-[18px] lg:text-[10px]">
                {count}
              </div>
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {hasUnread && (
              <div className="h-2 w-2 shrink-0 rounded-full bg-accent-100 lg:h-1.5 lg:w-1.5" />
            )}
            <span
              className={cn("truncate text-base lg:text-sm", hasUnread ? "font-semibold text-foreground-100" : "text-foreground-300")}
            >
              {participantLabel}
            </span>
            {compact && count > 1 && (
              <span className="shrink-0 rounded bg-background-300 px-1.5 py-0.5 text-xs font-medium text-foreground-300 lg:px-1 lg:py-px lg:text-[10px]">
                {count}
              </span>
            )}
            {showAccountDot && (
              <span
                className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full lg:h-2 lg:w-2"
                style={{ backgroundColor: accountColor! }}
                title={`via ${representative.accountEmail}`}
              />
            )}
            <span className={cn(showAccountDot ? "ml-1" : "ml-auto", "shrink-0 text-sm text-foreground-300 lg:text-xs")}>
              {formatRelative(representative.date)}
            </span>
          </div>
          <div
            className={cn("mt-0.5 truncate text-base lg:text-sm", hasUnread ? "font-medium text-foreground-200" : "text-foreground-300")}
          >
            {representative.subject || "(no subject)"}
          </div>
          {!compact && (
            <div className="mt-0.5 truncate text-sm text-foreground-300/70 lg:text-xs">
              {representative.snippet}
            </div>
          )}
          {!compact && previousReply && (
            <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-background-200 px-2.5 py-1.5 lg:px-2 lg:py-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/50">
                <polyline points="15 10 20 15 15 20" />
                <path d="M4 4v7a4 4 0 004 4h12" />
              </svg>
              <span className="truncate text-xs text-foreground-300/60 lg:text-[11px]">
                <span className="font-medium text-foreground-300/80">{prevSenderName}:</span>{" "}
                {previousReply.snippet}
              </span>
            </div>
          )}
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="hidden shrink-0 text-foreground-300 opacity-0 transition-opacity group-hover:opacity-100 lg:block"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </motion.div>
  );
}
