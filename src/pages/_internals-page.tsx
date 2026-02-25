import { useCallback, useMemo, useState } from "react";
import {
  EmailDiagnostics,
  EventTimeline,
  MemoryInspector,
  PipelineFlow,
  SystemPromptViewer,
} from "../components";
import {
  conversationListStorageKey,
  toConversationRoomName,
  useMemory,
} from "../lib";

interface InternalsPageProps {
  userId: string;
}

function getConversationRoomNames(userId: string): string[] {
  if (typeof window === "undefined") return [userId];
  try {
    const raw = window.localStorage.getItem(conversationListStorageKey(userId));
    if (!raw) return [userId];
    const convos = JSON.parse(raw) as Array<{ id: string }>;
    const rooms = convos
      .map((c) => toConversationRoomName(userId, c.id))
      .filter(Boolean);
    if (!rooms.includes(userId)) rooms.push(userId);
    return rooms;
  } catch {
    return [userId];
  }
}

export default function InternalsPage({ userId }: InternalsPageProps) {
  const roomNames = useMemo(() => getConversationRoomNames(userId), [userId]);
  const { memory, events, promptSnapshot, updateFacts, deleteFact, updatePromptConfig, resetPromptConfig, refresh, fetchPromptSnapshot } =
    useMemory(30_000, roomNames);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refresh(), fetchPromptSnapshot()]);
    setRefreshing(false);
  }, [refresh, fetchPromptSnapshot]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background-100 text-foreground-100">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="rounded-lg p-1.5 text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
            title="Back to inbox"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </a>
          <h1 className="text-base font-semibold text-foreground-100">AI Internals</h1>
          <span className="rounded-full bg-accent-100/10 px-2 py-0.5 text-xs font-medium text-accent-100">
            {userId}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200 disabled:opacity-50"
          >
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
              className={refreshing ? "animate-spin" : ""}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
          <a
            href="/"
            className="rounded-lg px-3 py-1.5 text-sm text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
          >
            Home
          </a>
        </div>
      </header>

      {/* Dashboard grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-4 lg:grid-rows-2">
        {/* Pipeline Flow — spans 2 cols on large */}
        <section className="flex flex-col border-b border-border-100 lg:col-span-2 lg:border-b-0 lg:border-r">
          <SectionHeader title="Pipeline Flow" subtitle="Click nodes for details" />
          <div className="min-h-0 flex-1">
            <PipelineFlow memory={memory} promptSnapshot={promptSnapshot} />
          </div>
        </section>

        {/* Event Timeline */}
        <section className="flex flex-col border-b border-border-100 lg:border-b-0 lg:border-r">
          <SectionHeader title="Event Timeline" subtitle={`${events.length} events`} />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <EventTimeline events={events} />
          </div>
        </section>

        {/* Email Diagnostics */}
        <section className="flex flex-col border-b border-border-100 lg:border-b-0">
          <SectionHeader title="Email Access" subtitle="Gmail diagnostics" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EmailDiagnostics />
          </div>
        </section>

        {/* Memory Inspector — spans 2 cols on large */}
        <section className="flex flex-col lg:col-span-2 lg:border-r lg:border-t border-border-100">
          <SectionHeader title="Memory Inspector" subtitle="View and edit stored memory" />
          <div className="min-h-0 flex-1">
            <MemoryInspector
              memory={memory}
              onUpdateFacts={updateFacts}
              onDeleteFact={deleteFact}
            />
          </div>
        </section>

        {/* System Prompt — spans 2 cols on large */}
        <section className="flex flex-col lg:col-span-2 lg:border-t border-border-100">
          <SectionHeader title="System Prompt" subtitle="As sent to the model" />
          <div className="min-h-0 flex-1">
            <SystemPromptViewer
              snapshot={promptSnapshot}
              onSave={updatePromptConfig}
              onReset={resetPromptConfig}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border-100 px-4 py-2.5">
      <h2 className="text-sm font-semibold text-foreground-100">{title}</h2>
      <span className="text-xs text-foreground-300">{subtitle}</span>
    </div>
  );
}
