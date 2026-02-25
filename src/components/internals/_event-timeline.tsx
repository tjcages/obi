import { useState } from "react";
import { cn, type MemoryEvent } from "../../lib";

const TYPE_STYLES: Record<string, { badge: string; dot: string }> = {
  chat_started:         { badge: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300", dot: "bg-slate-400" },
  compaction:           { badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300", dot: "bg-purple-400" },
  compaction_error:     { badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", dot: "bg-red-400" },
  fact_extraction:      { badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", dot: "bg-blue-400" },
  fact_parse_fallback:  { badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300", dot: "bg-orange-400" },
  fact_parse_error:     { badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", dot: "bg-red-400" },
  fact_consolidation:   { badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", dot: "bg-amber-400" },
  summary_generated:    { badge: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300", dot: "bg-green-400" },
  memory_sync:          { badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", dot: "bg-rose-400" },
  memory_skip:          { badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300", dot: "bg-yellow-400" },
  memory_error:         { badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", dot: "bg-red-400" },
  codemode_execution:   { badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300", dot: "bg-cyan-400" },
  codemode_error:       { badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", dot: "bg-red-400" },
  token_refresh:        { badge: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300", dot: "bg-teal-400" },
  chat_error:           { badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", dot: "bg-red-400" },
};

const TYPE_LABELS: Record<string, string> = {
  chat_started: "Chat",
  compaction: "Compaction",
  compaction_error: "Compaction Error",
  fact_extraction: "Fact Extraction",
  fact_parse_fallback: "Parse Fallback",
  fact_parse_error: "Parse Error",
  fact_consolidation: "Fact Consolidation",
  summary_generated: "Summary",
  memory_sync: "Memory Sync",
  memory_skip: "Extraction Skipped",
  memory_error: "Memory Error",
  codemode_execution: "Gmail API Call",
  codemode_error: "Codemode Error",
  token_refresh: "Token Refresh",
  chat_error: "Chat Error",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface EventTimelineProps {
  events: MemoryEvent[];
}

export function EventTimeline({ events }: EventTimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sorted = [...events].reverse();

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
        <div className="mb-2 rounded-full bg-background-200 p-3">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <p className="text-sm text-foreground-300">No memory events yet</p>
        <p className="mt-1 text-xs text-foreground-300">Events will appear as the AI processes conversations</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {sorted.map((event, i) => {
        const style = TYPE_STYLES[event.type] ?? TYPE_STYLES.compaction;
        const isExpanded = expandedId === event.id;
        const isLast = i === sorted.length - 1;

        return (
          <div key={event.id} className="relative flex gap-3 pl-1">
            {/* Timeline line + dot */}
            <div className="flex flex-col items-center">
              <div className={cn("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", style.dot)} />
              {!isLast && <div className="w-px flex-1 bg-border-100" />}
            </div>

            {/* Content */}
            <div className="flex-1 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", style.badge)}>
                  {TYPE_LABELS[event.type] ?? event.type}
                </span>
                <span className="text-xs text-foreground-300">{relativeTime(event.timestamp)}</span>
              </div>
              <p className="mt-1 text-sm text-foreground-200">{event.detail}</p>

              {event.data && (
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : event.id)}
                  className="mt-1 text-xs text-accent-100 hover:underline"
                >
                  {isExpanded ? "Hide details" : "Show details"}
                </button>
              )}

              {isExpanded && event.data && (
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-background-200 p-3 font-mono text-xs text-foreground-200">
                  {JSON.stringify(event.data, null, 2)}
                </pre>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
