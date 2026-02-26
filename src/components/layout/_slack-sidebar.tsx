import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn, formatRelative, cleanSlackText } from "../../lib";
import { SwipeableEmailRow } from "../ui/_swipeable-email-row";

interface SlackMessage {
  userId: string;
  userName: string;
  text: string;
  ts: string;
}

interface SlackThread {
  channelId: string;
  threadTs: string;
  channelName?: string;
  triggerMessageTs: string;
  messages: SlackMessage[];
  receivedAt: string;
  processed: boolean;
}

interface SlackSidebarProps {
  onThreadClick?: (thread: SlackThread) => void;
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

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "\u2026";
}

function hashStr(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function getInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const SLACK_ICON_PATH = "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z";

const POLL_NORMAL = 30_000;
const POLL_FAST = 5_000;
const INITIAL_VISIBLE = 5;

export function SlackSidebar({ onThreadClick }: SlackSidebarProps) {
  const [threads, setThreads] = useState<SlackThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    Yesterday: true,
    "Previous 7 days": true,
    Older: true,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRateRef = useRef(POLL_NORMAL);

  const fetchThreads = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/slack/threads", { signal });
      if (!res.ok) {
        if (res.status === 401) return;
        throw new Error(`Failed to load Slack threads (${res.status})`);
      }
      const data = (await res.json()) as { threads: SlackThread[] };
      const sorted = data.threads.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
      setThreads(sorted);
      setError(null);

      const hasUnprocessed = sorted.some((t) => !t.processed);
      setProcessing(hasUnprocessed);

      const desiredRate = hasUnprocessed ? POLL_FAST : POLL_NORMAL;
      if (desiredRate !== pollRateRef.current) {
        pollRateRef.current = desiredRate;
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => void fetchThreads(), desiredRate);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetchThreads(controller.signal);
    intervalRef.current = setInterval(() => void fetchThreads(), POLL_NORMAL);

    return () => {
      controller.abort();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchThreads]);

  const paginatedThreads = threads.slice(0, visibleCount);
  const remaining = threads.length - visibleCount;

  const grouped = new Map<string, SlackThread[]>();
  for (const thread of paginatedThreads) {
    const group = getTimeGroup(thread.receivedAt);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(thread);
  }

  const timeGroups = ["Today", "Yesterday", "Previous 7 days", "Older"].filter(
    (g) => grouped.has(g),
  );

  if (loading && threads.length === 0) {
    return (
      <div className="py-6">
        <div className="flex items-center gap-2 px-5 mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-foreground-300/70">
            <path d={SLACK_ICON_PATH} />
          </svg>
          <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-300/50">
            Slack
          </span>
        </div>
        <div className="space-y-1 px-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="h-6 w-6 shrink-0 rounded-full bg-foreground-100/8" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3 w-24 rounded bg-foreground-100/8" />
                  <div className="h-2.5 w-full rounded bg-foreground-100/5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (threads.length === 0 && !error) return null;

  return (
    <div className="py-6">
      <div className="sticky top-0 z-20 bg-background-100 px-2 pb-3">
        <div className="flex items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-foreground-300/70">
              <path d={SLACK_ICON_PATH} />
            </svg>
            <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-300/50">
              Slack
            </span>
            {processing && (
              <div className="flex items-center gap-1.5" title="Analyzing messages...">
                <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-foreground-300/20 border-t-[#4A154B] dark:border-t-[#E8B4E9]" />
                <span className="text-[10px] text-foreground-300/40">analyzing</span>
              </div>
            )}
          </div>
          {threads.length > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#4A154B] px-1.5 text-[10px] font-semibold text-white">
              {threads.length}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="px-5 py-2">
          <p className="text-xs text-destructive-100">{error}</p>
          <button
            type="button"
            onClick={() => { setLoading(true); void fetchThreads(); }}
            className="mt-1 text-xs text-foreground-300 underline transition-colors hover:text-foreground-200"
          >
            Retry
          </button>
        </div>
      )}

      <nav className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-2 pb-3 opacity-40 transition-opacity duration-300 group-hover/inbox:opacity-100">
        {timeGroups.map((group, gi) => {
          const items = grouped.get(group)!;
          const isCollapsed = !!collapsedGroups[group];
          return (
            <div key={group}>
              {gi > 0 && <div className="mx-3 my-3 border-t border-foreground-300/10" />}
              <button
                type="button"
                onClick={() => setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }))}
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
                {!isCollapsed && items.map((thread) => (
                  <SlackThreadRow
                    key={`${thread.channelId}:${thread.threadTs}`}
                    thread={thread}
                    onClick={() => onThreadClick?.(thread)}
                  />
                ))}
              </AnimatePresence>
            </div>
          );
        })}

        {threads.length > INITIAL_VISIBLE && (
          <div className="mt-2 px-3">
            {remaining > 0 ? (
              <button
                type="button"
                onClick={() => setVisibleCount((v) => Math.min(v + 5, threads.length))}
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
      </nav>
    </div>
  );
}

function SlackThreadRow({
  thread,
  onClick,
}: {
  thread: SlackThread;
  onClick: () => void;
}) {
  const lastMsg = thread.messages[thread.messages.length - 1];
  const participants = [...new Set(thread.messages.map((m) => m.userName))];
  const channelLabel = thread.channelName ? `#${thread.channelName}` : "DM";
  const primaryUser = participants[0] ?? channelLabel;
  const initials = getInitials(primaryUser);

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.8 }}
    >
      <SwipeableEmailRow onArchive={() => {}} compact>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-foreground-100/5",
            !thread.processed && "animate-pulse",
          )}
        >
          <div className="relative shrink-0">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4A154B]/15 text-[9px] font-medium text-[#4A154B] dark:bg-[#E8B4E9]/15 dark:text-[#E8B4E9] transition-colors duration-300 group-hover/inbox:bg-[#4A154B]/25 dark:group-hover/inbox:bg-[#E8B4E9]/25">
              {initials}
            </div>
            {!thread.processed && (
              <div className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#4A154B] ring-2 ring-background-100 dark:bg-[#E8B4E9]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-foreground-100/60 shrink-0">
                {channelLabel}
              </span>
              <span className="text-foreground-100/15 text-[10px]">&middot;</span>
              <span className="truncate text-[12px] text-foreground-200">
                {participants.join(", ")}
              </span>
              {thread.messages.length > 1 && (
                <span className="shrink-0 rounded bg-foreground-100/8 px-1 py-px text-[9px] font-medium text-foreground-300">
                  {thread.messages.length}
                </span>
              )}
              <span className="ml-auto shrink-0 text-[10px] text-foreground-300/60">
                {formatRelative(thread.receivedAt)}
              </span>
            </div>
            <div className="truncate text-[12px] leading-snug text-foreground-300/70">
              {lastMsg ? truncateText(cleanSlackText(lastMsg.text), 120) : "No messages"}
            </div>
          </div>
        </button>
      </SwipeableEmailRow>
    </motion.div>
  );
}
