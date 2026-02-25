import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn, formatRelative } from "../../lib";
import {
  groupByThread,
  groupBySender,
  isSenderGroup,
  parseSenderName,
  type InboxEmail,
  type ThreadGroup,
  type SenderGroup,
  type AccountColorMap,
} from "../email/_email-row";
import { SwipeableEmailRow } from "../ui/_swipeable-email-row";

export interface CompactInboxHandle {
  hideThread: (threadId: string) => void;
  unhideThread: (threadId: string) => void;
}

interface CompactInboxSidebarProps {
  onEmailClick?: (thread: ThreadGroup) => void;
  onArchive?: (thread: ThreadGroup) => void;
  onArchiveGroup?: (threads: ThreadGroup[]) => void;
  onReply?: (thread: ThreadGroup) => void;
  activeAccountEmails?: string[];
  accountColors?: AccountColorMap;
  listRef?: React.Ref<CompactInboxHandle>;
  refreshInterval?: number;
  maxResults?: number;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getTimeGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= weekAgo) return "Previous 7 days";
  return "Older";
}

const INITIAL_VISIBLE = 5;
const LOAD_MORE_COUNT = 5;

export function CompactInboxSidebar({
  onEmailClick,
  onArchive,
  onArchiveGroup,
  onReply,
  activeAccountEmails,
  accountColors,
  listRef,
  refreshInterval = 60_000,
  maxResults = 20,
}: CompactInboxSidebarProps) {
  const [emails, setEmails] = useState<InboxEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [hiddenThreadIds, setHiddenThreadIds] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    Yesterday: true,
    "Previous 7 days": true,
    Older: true,
  });

  const accountsParam = activeAccountEmails?.length
    ? `&accounts=${activeAccountEmails.join(",")}`
    : "";

  const fetchInbox = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/inbox?max=${maxResults}${accountsParam}`, { signal });
        if (!res.ok) {
          if (res.status === 401) {
            window.location.assign("/logout");
            return;
          }
          throw new Error(`Failed to load inbox (${res.status})`);
        }
        const data = (await res.json()) as { emails: InboxEmail[] };
        setEmails(data.emails);
        setHiddenThreadIds(new Set());
        setError(null);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to load inbox");
      } finally {
        setLoading(false);
      }
    },
    [maxResults, accountsParam],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetchInbox(controller.signal);

    if (refreshInterval > 0) {
      intervalRef.current = setInterval(
        () => void fetchInbox(),
        refreshInterval,
      );
    }

    return () => {
      controller.abort();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchInbox, refreshInterval]);

  useImperativeHandle(listRef, () => ({
    hideThread: (threadId: string) => {
      setHiddenThreadIds((prev) => {
        const next = new Set(prev);
        next.add(threadId);
        return next;
      });
    },
    unhideThread: (threadId: string) => {
      setHiddenThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(threadId);
        return next;
      });
    },
  }), []);

  const threads = groupByThread(emails);
  const items = groupBySender(threads);

  const visibleItems = items.filter((item) => {
    if (isSenderGroup(item)) {
      return item.threads.some((t) => !hiddenThreadIds.has(t.threadId));
    }
    return !hiddenThreadIds.has(item.threadId);
  });

  const paginatedItems = visibleItems.slice(0, visibleCount);
  const remaining = visibleItems.length - visibleCount;

  const grouped = new Map<string, (ThreadGroup | SenderGroup)[]>();
  for (const item of paginatedItems) {
    const dateStr = isSenderGroup(item)
      ? item.latestDate
      : item.representative.date;
    const group = getTimeGroup(dateStr);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(item);
  }

  const unreadCount = threads.filter((t) => t.hasUnread && !hiddenThreadIds.has(t.threadId)).length;

  return (
    <aside className="group/inbox sticky top-4 h-fit w-full shrink-0 pt-8">
      <div className="sticky top-0 z-20 bg-background-100 px-2 pb-3">
        <div className="flex items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/70">
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-300/50">
              Inbox
            </span>
          </div>
          {unreadCount > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-100 px-1.5 text-[10px] font-semibold text-white">
              {unreadCount}
            </span>
          )}
        </div>
      </div>

      {/* The list fades in on hover via the group/inbox ancestor */}
      <nav className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-2 pb-3 opacity-40 transition-opacity duration-300 group-hover/inbox:opacity-100">
        {loading ? (
          <div className="space-y-1 px-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 shrink-0 rounded-full bg-background-300" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3 w-20 rounded bg-background-300" />
                    <div className="h-2.5 w-full rounded bg-background-200" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-destructive-100">{error}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void fetchInbox();
              }}
              className="mt-2 text-xs text-foreground-300 underline transition-colors hover:text-foreground-200"
            >
              Retry
            </button>
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="px-3 py-12 text-center text-xs text-foreground-300/60">
            Inbox empty
          </p>
        ) : (
          <>
            <TimeGroupedList
              grouped={grouped}
              collapsedGroups={collapsedGroups}
              onToggleGroup={(group) =>
                setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }))
              }
              hiddenThreadIds={hiddenThreadIds}
              accountColors={accountColors}
              onEmailClick={onEmailClick}
              onArchive={onArchive}
              onArchiveGroup={onArchiveGroup}
              onReply={onReply}
            />

            {/* Show more / show less */}
            {visibleItems.length > INITIAL_VISIBLE && (
              <div className="mt-2 px-3">
                {remaining > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleCount((v) =>
                        Math.min(v + LOAD_MORE_COUNT, visibleItems.length),
                      )
                    }
                    className="text-[12px] text-foreground-300/50 transition-colors hover:text-foreground-200"
                  >
                    Show more ({remaining} remaining)
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setVisibleCount(INITIAL_VISIBLE)}
                    className="text-[12px] text-foreground-300/50 transition-colors hover:text-foreground-200"
                  >
                    Show less
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </nav>
    </aside>
  );
}

function TimeGroupedList({
  grouped,
  collapsedGroups,
  onToggleGroup,
  hiddenThreadIds,
  accountColors,
  onEmailClick,
  onArchive,
  onArchiveGroup,
  onReply,
}: {
  grouped: Map<string, (ThreadGroup | SenderGroup)[]>;
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (group: string) => void;
  hiddenThreadIds: Set<string>;
  accountColors?: AccountColorMap;
  onEmailClick?: (thread: ThreadGroup) => void;
  onArchive?: (thread: ThreadGroup) => void;
  onArchiveGroup?: (threads: ThreadGroup[]) => void;
  onReply?: (thread: ThreadGroup) => void;
}) {
  let groupIdx = 0;
  return (
    <>
      {Array.from(grouped.entries()).map(([group, items]) => {
        const gi = groupIdx++;
        const isCollapsed = !!collapsedGroups[group];
        return (
          <div key={group}>
            {gi > 0 && <div className="mx-3 my-3 border-t border-foreground-300/10" />}
            <button
              type="button"
              onClick={() => onToggleGroup(group)}
              className="mb-1 flex w-full items-center gap-1 px-3 text-[11px] font-medium uppercase tracking-wider text-foreground-300/50 transition-colors hover:text-foreground-300"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0 transition-transform duration-200", isCollapsed ? "-rotate-90" : "rotate-0")}>
                <path d="M6 9l6 6 6-6" />
              </svg>
              {group}
              {isCollapsed && (
                <span className="ml-auto text-[10px] font-normal normal-case tracking-normal text-foreground-300/40">
                  {items.length}
                </span>
              )}
            </button>
            <AnimatePresence initial={false}>
              {!isCollapsed &&
                items.map((item) => {
                  if (isSenderGroup(item)) {
                    return (
                      <CompactSenderGroup
                        key={`sg-${item.senderKey}`}
                        group={item}
                        hiddenThreadIds={hiddenThreadIds}
                        accountColors={accountColors}
                        onEmailClick={onEmailClick}
                        onArchive={onArchive}
                        onArchiveGroup={onArchiveGroup}
                        onReply={onReply}
                      />
                    );
                  }
                  return (
                    <CompactEmailItem
                      key={item.threadId}
                      thread={item}
                      accountColors={accountColors}
                      onEmailClick={onEmailClick}
                      onArchive={onArchive}
                      onReply={onReply}
                    />
                  );
                })}
            </AnimatePresence>
          </div>
        );
      })}
    </>
  );
}

function CompactEmailItem({
  thread,
  accountColors,
  onEmailClick,
  onArchive,
  onReply,
}: {
  thread: ThreadGroup;
  accountColors?: AccountColorMap;
  onEmailClick?: (thread: ThreadGroup) => void;
  onArchive?: (thread: ThreadGroup) => void;
  onReply?: (thread: ThreadGroup) => void;
}) {
  const { representative, count, hasUnread } = thread;
  const { name, initials } = parseSenderName(representative.from);
  const showAccountDot = representative.accountEmail
    && accountColors
    && Object.keys(accountColors).length > 1;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.8 }}
    >
      <SwipeableEmailRow
        onArchive={() => onArchive?.(thread)}
        onReply={() => onReply?.(thread)}
        compact
      >
        <button
          type="button"
          onClick={() => onEmailClick?.(thread)}
          className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-foreground-100/5"
        >
          <div className="relative shrink-0">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground-100/10 text-[9px] font-medium text-foreground-300 transition-colors duration-300 group-hover/inbox:bg-foreground-100/15">
              {initials}
            </div>
            {hasUnread && (
              <div className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent-100 ring-2 ring-background-100" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className={cn(
                "truncate text-[13px]",
                hasUnread ? "font-semibold text-foreground-100" : "text-foreground-200"
              )}>
                {name}
              </span>
              {count > 1 && (
                <span className="shrink-0 rounded bg-foreground-100/8 px-1 py-px text-[9px] font-medium text-foreground-300">
                  {count}
                </span>
              )}
              {showAccountDot && (
                <span
                  className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full opacity-0 transition-opacity duration-300 group-hover/inbox:opacity-100"
                  style={{ backgroundColor: accountColors[representative.accountEmail!] }}
                />
              )}
              <span className={cn(
                showAccountDot ? "ml-0.5" : "ml-auto",
                "shrink-0 text-[10px] text-foreground-300/60"
              )}>
                {formatRelative(representative.date)}
              </span>
            </div>
            <div className={cn(
              "truncate text-[12px] leading-snug",
              hasUnread ? "text-foreground-200" : "text-foreground-300/70"
            )}>
              {representative.subject || "(no subject)"}
            </div>
          </div>
        </button>
      </SwipeableEmailRow>
    </motion.div>
  );
}

function CompactSenderGroup({
  group,
  hiddenThreadIds,
  accountColors,
  onEmailClick,
  onArchive,
  onArchiveGroup,
  onReply,
}: {
  group: SenderGroup;
  hiddenThreadIds: Set<string>;
  accountColors?: AccountColorMap;
  onEmailClick?: (thread: ThreadGroup) => void;
  onArchive?: (thread: ThreadGroup) => void;
  onArchiveGroup?: (threads: ThreadGroup[]) => void;
  onReply?: (thread: ThreadGroup) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { senderName, threads, hasUnread, latestDate, summary } = group;
  const { initials } = parseSenderName(threads[0].representative.from);

  const visibleThreads = threads.filter((t) => !hiddenThreadIds.has(t.threadId));

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.8 }}
    >
      <SwipeableEmailRow
        onArchive={() => {
          if (onArchiveGroup) onArchiveGroup(visibleThreads);
          else visibleThreads.forEach((t) => onArchive?.(t));
        }}
        compact
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "group flex w-full items-center gap-2.5 rounded-lg px-3 py-[7px] text-left transition-colors hover:bg-foreground-100/5",
            expanded && "bg-foreground-100/3"
          )}
        >
          <div className="relative shrink-0">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground-100/10 text-[9px] font-medium text-foreground-300 transition-colors duration-300 group-hover/inbox:bg-foreground-100/15">
              {initials}
            </div>
            <div className="absolute -bottom-1 -right-1.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-foreground-300/60 px-0.5 text-[8px] font-bold leading-none text-background-100 ring-1 ring-background-100 transition-colors duration-300 group-hover/inbox:bg-blue-600 group-hover/inbox:text-white dark:group-hover/inbox:bg-blue-500">
              {threads.length}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {hasUnread && (
                <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-100" />
              )}
              <span className={cn(
                "truncate text-[13px]",
                hasUnread ? "font-semibold text-foreground-100" : "text-foreground-200"
              )}>
                {senderName}
              </span>
              <span className="shrink-0 text-[10px] text-foreground-300/60 ml-auto">
                {formatRelative(latestDate)}
              </span>
            </div>
            <div className="truncate text-[12px] leading-snug text-foreground-300/70">
              {summary?.total ? (
                <>
                  <span>{summary.label}</span>{" "}
                  <span className="font-medium text-foreground-300 transition-colors duration-300 group-hover/inbox:text-emerald-600 dark:group-hover/inbox:text-emerald-400">
                    ${summary.total.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                </>
              ) : summary?.label ? (
                summary.label
              ) : (
                threads[0].representative.subject || "(no subject)"
              )}
            </div>
          </div>

          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("shrink-0 text-foreground-300/40 transition-transform", expanded && "rotate-90")}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </SwipeableEmailRow>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="ml-5 border-l border-foreground-300/10 pl-1"
          >
            {visibleThreads.map((thread) => (
              <CompactEmailItem
                key={thread.threadId}
                thread={thread}
                accountColors={accountColors}
                onEmailClick={onEmailClick}
                onArchive={onArchive}
                onReply={onReply}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
