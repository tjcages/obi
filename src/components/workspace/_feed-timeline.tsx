import { useMemo, useState } from "react";
import { cn } from "../../lib";
import type { FeedItem, FeedItemLinkRef } from "../../lib";
import { List, ListItem } from "../ui/_list";
import { FeedItemRenderer } from "./_feed-item";

interface FeedTimelineProps {
  items: FeedItem[];
  onUpdateItem: (itemId: string, updates: { content?: string; linkRef?: FeedItemLinkRef }) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
  onEmailClick?: (threadId: string, accountEmail?: string) => void;
}

interface TimelineGroup {
  type: "date-header";
  label: string;
  key: string;
}

interface TimelineCluster {
  type: "cluster";
  items: FeedItem[];
  key: string;
}

interface TimelineImageGrid {
  type: "image-grid";
  items: FeedItem[];
  key: string;
}

type TimelineEntry = TimelineGroup | TimelineCluster | TimelineImageGrid;

const GROUP_WINDOW_MS = 30 * 60 * 1000;

function formatDateHeader(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - itemDay.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function buildTimeline(items: FeedItem[]): TimelineEntry[] {
  const feedItems = items.filter((i) => i.type !== "link" && i.type !== "file");
  if (feedItems.length === 0) return [];

  const sorted = [...feedItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const entries: TimelineEntry[] = [];
  let currentDay = "";
  let currentCluster: FeedItem[] = [];
  let currentType = "";

  const flushCluster = () => {
    if (currentCluster.length === 0) return;
    if (currentCluster[0].type === "image" && currentCluster.length >= 2) {
      entries.push({
        type: "image-grid",
        items: [...currentCluster],
        key: `img-grid-${currentCluster[0].id}`,
      });
    } else {
      entries.push({
        type: "cluster",
        items: [...currentCluster],
        key: currentCluster[0].id,
      });
    }
    currentCluster = [];
  };

  for (const item of sorted) {
    const itemDay = dayKey(item.createdAt);

    if (itemDay !== currentDay) {
      flushCluster();
      currentDay = itemDay;
      entries.push({
        type: "date-header",
        label: formatDateHeader(item.createdAt),
        key: `header-${itemDay}`,
      });
      currentType = "";
    }

    if (currentCluster.length > 0) {
      const lastItem = currentCluster[currentCluster.length - 1];
      const timeDiff = Math.abs(
        new Date(lastItem.createdAt).getTime() - new Date(item.createdAt).getTime(),
      );

      if (item.type === currentType && timeDiff <= GROUP_WINDOW_MS) {
        currentCluster.push(item);
        continue;
      }

      flushCluster();
    }

    currentCluster.push(item);
    currentType = item.type;
  }

  flushCluster();
  return entries;
}

export function FeedTimeline({ items, onUpdateItem, onDeleteItem, onEmailClick }: FeedTimelineProps) {
  const timeline = useMemo(() => buildTimeline(items), [items]);

  if (timeline.length === 0) return null;

  return (
    <div className="mt-6">
      <List gap="gap-3">
        {timeline.map((entry) => {
          if (entry.type === "date-header") {
            return (
              <ListItem key={entry.key} itemId={entry.key}>
                <div className="flex items-center gap-3 px-1 py-1">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-300/60">
                    {entry.label}
                  </span>
                  <div className="h-px flex-1 bg-border-100/60" />
                </div>
              </ListItem>
            );
          }

          if (entry.type === "image-grid") {
            return (
              <ListItem key={entry.key} itemId={entry.key}>
                <ImageGrid items={entry.items} onDelete={onDeleteItem} />
              </ListItem>
            );
          }

          const clusterItems = entry.items;
          const isSingle = clusterItems.length === 1;

          return (
            <ListItem key={entry.key} itemId={entry.key}>
              {clusterItems.map((item, idx) => (
                <FeedItemRenderer
                  key={item.id}
                  item={item}
                  onUpdate={onUpdateItem}
                  onDelete={onDeleteItem}
                  onEmailClick={onEmailClick}
                  clustered={
                    isSingle
                      ? "only"
                      : idx === 0
                        ? "first"
                        : idx === clusterItems.length - 1
                          ? "last"
                          : "middle"
                  }
                />
              ))}
            </ListItem>
          );
        })}
      </List>
    </div>
  );
}

function ImageGrid({ items, onDelete }: { items: FeedItem[]; onDelete: (id: string) => Promise<void> }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const cols = items.length === 2 ? "grid-cols-2"
    : items.length === 3 ? "grid-cols-3"
    : "grid-cols-2 sm:grid-cols-3";

  return (
    <div className={cn("grid gap-1.5 rounded-lg overflow-hidden", cols)}>
      {items.map((item) => {
        const ref = item.fileRef;
        if (!ref) return null;
        const src = `/api/workspace/_/file/${encodeURIComponent(ref.key)}`;
        const isExpanded = expandedId === item.id;

        return (
          <div key={item.id} className="group/img relative">
            <button
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : item.id)}
              className="w-full"
            >
              <img
                src={src}
                alt={ref.filename}
                className={cn(
                  "w-full rounded-md object-cover transition-all",
                  isExpanded ? "max-h-[400px]" : "aspect-square max-h-48",
                )}
                loading="lazy"
              />
            </button>
            <button
              type="button"
              onClick={() => void onDelete(item.id)}
              className="absolute right-1.5 top-1.5 rounded-full bg-black/50 p-1 text-white/70 opacity-0 backdrop-blur-sm transition-opacity group-hover/img:opacity-100 hover:text-white"
              title="Remove"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
