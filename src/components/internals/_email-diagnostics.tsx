import { useCallback, useEffect, useState } from "react";
import { cn, type MemoryEvent } from "../../lib";

interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

interface InboxStats {
  totalMessages: number;
  unreadMessages: number;
  totalThreads: number;
  unreadThreads: number;
}

interface SystemLabel {
  name: string;
  messages: number;
  unread: number;
}

interface DiagnosticsData {
  connected: boolean;
  error?: string;
  profile: GmailProfile | null;
  inbox: InboxStats | null;
  labelCount: number;
  systemLabels: SystemLabel[];
  recentCodemodeCalls: MemoryEvent[];
}

export function EmailDiagnostics() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  const fetchDiagnostics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/email-diagnostics");
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const d = (await res.json()) as DiagnosticsData;
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load diagnostics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDiagnostics();
  }, [fetchDiagnostics]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground-300 border-t-accent-100" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="px-4 py-8 text-center text-sm text-destructive-100">{error}</div>
    );
  }

  if (!data) return null;

  if (!data.connected) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-foreground-300">Gmail not connected</p>
        {data.error && <p className="mt-1 text-xs text-destructive-100">{data.error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Connection Status */}
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-green-500" />
        <span className="text-sm font-medium text-foreground-100">Connected</span>
        {data.profile && (
          <span className="rounded-full bg-background-200 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-foreground-300">{data.profile.emailAddress}</span>
        )}
        <button
          type="button"
          onClick={() => void fetchDiagnostics()}
          className="ml-auto shrink-0 whitespace-nowrap rounded px-2 py-1 text-xs text-accent-100 transition-colors hover:bg-accent-100/10"
        >
          Re-run
        </button>
      </div>

      {/* Account Stats */}
      {data.profile && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-widest text-foreground-300">
            Account Totals
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Total Messages" value={data.profile.messagesTotal.toLocaleString()} />
            <StatCard label="Total Threads" value={data.profile.threadsTotal.toLocaleString()} />
          </div>
        </div>
      )}

      {/* Inbox Stats */}
      {data.inbox && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-widest text-foreground-300">
            Inbox
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Inbox Messages" value={data.inbox.totalMessages.toLocaleString()} />
            <StatCard label="Unread" value={data.inbox.unreadMessages.toLocaleString()} highlight />
            <StatCard label="Inbox Threads" value={data.inbox.totalThreads.toLocaleString()} />
            <StatCard label="Unread Threads" value={data.inbox.unreadThreads.toLocaleString()} />
          </div>
        </div>
      )}

      {/* Labels */}
      {data.systemLabels.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-widest text-foreground-300">
            Labels ({data.labelCount} total)
          </h4>
          <div className="flex flex-wrap gap-2">
            {data.systemLabels
              .filter((l) => (l.messages ?? 0) > 0)
              .sort((a, b) => (b.messages ?? 0) - (a.messages ?? 0))
              .slice(0, 12)
              .map((l) => (
                <span
                  key={l.name}
                  className="rounded-full bg-background-200 px-2.5 py-1 text-xs text-foreground-200"
                >
                  {l.name}{" "}
                  <span className="font-mono text-foreground-300">{l.messages?.toLocaleString()}</span>
                  {(l.unread ?? 0) > 0 && (
                    <span className="ml-1 font-mono text-accent-100">({l.unread} new)</span>
                  )}
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Recent Codemode Calls */}
      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-widest text-foreground-300">
          Recent Gmail API Calls ({data.recentCodemodeCalls.length})
        </h4>
        {data.recentCodemodeCalls.length === 0 ? (
          <p className="text-xs text-foreground-300">No API calls recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {[...data.recentCodemodeCalls].reverse().map((call) => {
              const isExpanded = expandedCallId === call.id;
              const apiPaths = (call.data?.apiPaths as string[]) ?? [];
              const durationMs = call.data?.durationMs as number | undefined;
              const hasError = !!call.data?.error;

              return (
                <div
                  key={call.id}
                  className="rounded-lg border border-border-100 bg-background-200 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <div className={cn("h-1.5 w-1.5 shrink-0 rounded-full", hasError ? "bg-destructive-100" : "bg-green-500")} />
                    <span className="flex-1 truncate font-mono text-xs text-foreground-200">
                      {apiPaths.length > 0 ? apiPaths.join(" | ") : call.detail}
                    </span>
                    {durationMs !== undefined && (
                      <span className="shrink-0 font-mono text-xs text-foreground-300">{durationMs}ms</span>
                    )}
                    <span className="shrink-0 text-xs text-foreground-300">
                      {relativeTime(call.timestamp)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedCallId(isExpanded ? null : call.id)}
                      className="shrink-0 text-xs text-accent-100 hover:underline"
                    >
                      {isExpanded ? "Hide" : "Details"}
                    </button>
                  </div>
                  {isExpanded && call.data && (
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-background-100 p-2 font-mono text-xs text-foreground-200">
                      {JSON.stringify(call.data, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg bg-background-200 px-3 py-2">
      <div className="text-xs text-foreground-300">{label}</div>
      <div className={cn("font-mono text-lg font-semibold", highlight ? "text-accent-100" : "text-foreground-100")}>
        {value}
      </div>
    </div>
  );
}

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
