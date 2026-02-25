import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "../../lib";
import {
  EmailRow,
  SenderGroupRow,
  groupByThread,
  groupBySender,
  isSenderGroup,
  type InboxEmail,
  type ThreadGroup,
  type AccountColorMap,
} from "./_email-row";
import { List, ListItem } from "../ui/_list";

export interface InboxListHandle {
  hideThread: (threadId: string) => void;
  unhideThread: (threadId: string) => void;
}

interface InboxListProps {
  compact?: boolean;
  onEmailClick?: (thread: ThreadGroup) => void;
  onArchive?: (thread: ThreadGroup) => void;
  onArchiveGroup?: (threads: ThreadGroup[]) => void;
  onReply?: (thread: ThreadGroup) => void;
  refreshInterval?: number;
  maxResults?: number;
  activeAccountEmails?: string[];
  accountColors?: AccountColorMap;
  listRef?: React.Ref<InboxListHandle>;
}

function SkeletonRow({ compact }: { compact?: boolean }) {
  return (
    <div
      className={cn("flex w-full items-center gap-3 border-b border-border-200 last:border-b-0 animate-pulse", compact ? "px-2 py-2.5 lg:px-3" : "px-2.5 py-3 lg:px-4 lg:py-3.5")}
    >
      {!compact && (
        <div className="h-9 w-9 shrink-0 rounded-full bg-background-300" />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-24 rounded bg-background-300" />
          <div className="ml-auto h-3 w-10 rounded bg-background-200" />
        </div>
        <div className="h-3.5 w-48 rounded bg-background-200" />
        {!compact && (
          <div className="h-3 w-64 rounded bg-background-200" />
        )}
      </div>
    </div>
  );
}

export function InboxList({
  compact,
  onEmailClick,
  onArchive,
  onArchiveGroup,
  onReply,
  refreshInterval = 60_000,
  maxResults = 20,
  activeAccountEmails,
  accountColors,
  listRef,
}: InboxListProps) {
  const [emails, setEmails] = useState<InboxEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [hiddenThreadIds, setHiddenThreadIds] = useState<Set<string>>(new Set());

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

  const handleArchive = useCallback(
    (item: ThreadGroup) => {
      setHiddenThreadIds((prev) => {
        const next = new Set(prev);
        next.add(item.threadId);
        return next;
      });
      onArchive?.(item);
    },
    [onArchive],
  );

  const threads = groupByThread(emails);
  const senderGrouped = groupBySender(threads);
  const [expandedSenders, setExpandedSenders] = useState<Set<string>>(new Set());

  const toggleSenderExpand = useCallback((key: string) => {
    setExpandedSenders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col">
        {Array.from({ length: compact ? 6 : 8 }).map((_, i) => (
          <SkeletonRow key={i} compact={compact} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
        <p className="text-sm text-destructive-100">{error}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void fetchInbox();
          }}
          className="mt-2 text-sm text-foreground-300 underline transition-colors hover:text-foreground-200"
        >
          Retry
        </button>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
        <p className="text-sm text-foreground-300">Your inbox is empty</p>
      </div>
    );
  }

  const visibleItems = senderGrouped.filter((item) => {
    if (isSenderGroup(item)) {
      return item.threads.some((t) => !hiddenThreadIds.has(t.threadId));
    }
    return !hiddenThreadIds.has(item.threadId);
  });

  return (
    <div className="flex flex-col">
      <List gap="gap-0">
        {visibleItems.map((item, idx) => {
          if (isSenderGroup(item)) {
            const visibleThreads = item.threads.filter((t) => !hiddenThreadIds.has(t.threadId));
            const archiveGroup = () => {
              if (onArchiveGroup) {
                onArchiveGroup(visibleThreads);
              } else {
                for (const t of visibleThreads) handleArchive(t);
              }
            };
            return (
              <ListItem
                key={`sg-${item.senderKey}`}
                itemId={`sg-${item.senderKey}`}
                onSwipeLeft={archiveGroup}
              >
                <SenderGroupRow
                  group={item}
                  compact={compact}
                  onClick={onEmailClick}
                  onArchive={handleArchive}
                  onReply={onReply}
                  index={idx}
                  accountColors={accountColors}
                  expanded={expandedSenders.has(item.senderKey)}
                  onToggleExpand={() => toggleSenderExpand(item.senderKey)}
                  hiddenThreadIds={hiddenThreadIds}
                />
              </ListItem>
            );
          }
          return (
            <ListItem
              key={item.threadId}
              itemId={item.threadId}
              onSwipeLeft={() => handleArchive(item)}
              onSwipeRight={onReply ? () => onReply(item) : undefined}
            >
              <EmailRow
                thread={item}
                compact={compact}
                onClick={onEmailClick}
                index={idx}
                accountColors={accountColors}
              />
            </ListItem>
          );
        })}
      </List>
    </div>
  );
}
