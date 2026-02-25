import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn, formatRelative, cleanSlackText } from "../../lib";

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
  refreshInterval?: number;
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
  return text.slice(0, max).trimEnd() + "…";
}

export function SlackSidebar({
  onThreadClick,
  refreshInterval = 60_000,
}: SlackSidebarProps) {
  const [threads, setThreads] = useState<SlackThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchThreads = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/slack/threads", { signal });
      if (!res.ok) {
        if (res.status === 401) return;
        throw new Error(`Failed to load Slack threads (${res.status})`);
      }
      const data = (await res.json()) as { threads: SlackThread[] };
      setThreads(data.threads.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()));
      setError(null);
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

    if (refreshInterval > 0) {
      intervalRef.current = setInterval(() => void fetchThreads(), refreshInterval);
    }

    return () => {
      controller.abort();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchThreads, refreshInterval]);

  const grouped = threads.reduce<Record<string, SlackThread[]>>((acc, thread) => {
    const group = getTimeGroup(thread.receivedAt);
    (acc[group] ??= []).push(thread);
    return acc;
  }, {});

  const timeGroups = ["Today", "Yesterday", "Previous 7 days", "Older"].filter(
    (g) => grouped[g]?.length,
  );

  if (loading && threads.length === 0) {
    return (
      <div className="px-4 py-6">
        <div className="flex items-center gap-2 px-1 mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-foreground-300/70">
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z" />
          </svg>
          <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-300/50">
            Slack
          </span>
        </div>
        <div className="space-y-1.5 px-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-foreground-100/5" />
          ))}
        </div>
      </div>
    );
  }

  if (threads.length === 0 && !error) return null;

  return (
    <div className="py-6">
      {/* Header — matches inbox sidebar header pattern */}
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-foreground-300/70">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z" />
            </svg>
            <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-300/50">
              Slack
            </span>
          </div>
          {threads.length > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#4A154B] px-1.5 text-[10px] font-semibold text-white">
              {threads.length}
            </span>
          )}
        </div>
      </div>

      {error && (
        <p className="px-5 text-xs text-red-400">{error}</p>
      )}

      <nav className="px-2 opacity-40 transition-opacity duration-300 group-hover/inbox:opacity-100">
        <AnimatePresence initial={false}>
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {timeGroups.map((group) => (
              <div key={group}>
                {timeGroups.length > 1 && (
                  <div className="px-4 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-foreground-100/25">
                    {group}
                  </div>
                )}
                {grouped[group]!.map((thread) => {
                  const lastMsg = thread.messages[thread.messages.length - 1];
                  const participants = [...new Set(thread.messages.map((m) => m.userName))];
                  const channelLabel = thread.channelName ? `#${thread.channelName}` : "DM";

                  return (
                    <button
                      key={`${thread.channelId}:${thread.threadTs}`}
                      type="button"
                      onClick={() => onThreadClick?.(thread)}
                      className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-foreground-100/5"
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0 truncate">
                          <span className="text-[11px] font-medium text-foreground-100/50 shrink-0">
                            {channelLabel}
                          </span>
                          <span className="text-foreground-100/15 text-[10px]">·</span>
                          <span className="text-[11px] text-foreground-100/40 truncate">
                            {participants.join(", ")}
                          </span>
                        </div>
                        <span className="text-[10px] text-foreground-100/25 shrink-0">
                          {formatRelative(thread.receivedAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-foreground-100/60 line-clamp-2">
                        {lastMsg ? truncateText(cleanSlackText(lastMsg.text), 120) : "No messages"}
                      </p>
                    </button>
                  );
                })}
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </nav>
    </div>
  );
}
