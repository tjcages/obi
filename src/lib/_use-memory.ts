import { useCallback, useEffect, useRef, useState } from "react";

export interface ConversationSummaryEntry {
  id: string;
  summary: string;
  date: string;
}

export type MemoryEventType =
  | "compaction"
  | "compaction_error"
  | "fact_extraction"
  | "fact_parse_fallback"
  | "fact_parse_error"
  | "fact_consolidation"
  | "summary_generated"
  | "memory_sync"
  | "memory_skip"
  | "memory_error"
  | "codemode_execution"
  | "codemode_error"
  | "token_refresh"
  | "chat_started"
  | "chat_error";

export interface MemoryEvent {
  id: string;
  timestamp: string;
  type: MemoryEventType;
  detail: string;
  data?: Record<string, unknown>;
}

export interface MemoryState {
  compactionSummary: string | null;
  userFacts: string[];
  conversationSummaries: ConversationSummaryEntry[];
  events: MemoryEvent[];
  _storageKeys: string[];
}

export const ALL_AGENT_ACTIONS = ["read", "send", "reply", "forward", "archive", "trash", "label", "star"] as const;
export type AgentAction = (typeof ALL_AGENT_ACTIONS)[number];

export interface PromptConfig {
  persona: string;
  tone: "concise" | "balanced" | "detailed";
  customInstructions: string;
  confirmBeforeActions: boolean;
  allowedActions: AgentAction[];
  priorityContacts: string[];
  focusTopics: string[];
  responseFormat: "bullets" | "narrative" | "structured";
  language: string;
  defaultEmailCount: number;
}

export interface PromptSnapshot {
  prompt: string;
  config: PromptConfig;
  defaultConfig: PromptConfig;
  memory: {
    compactionSummary: string | null;
    userFacts: string[];
    conversationSummaries: ConversationSummaryEntry[];
  };
}

export function useMemory(autoRefreshMs = 0, conversationRoomNames?: string[]) {
  const [memory, setMemory] = useState<MemoryState | null>(null);
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [promptSnapshot, setPromptSnapshot] = useState<PromptSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval>>(undefined);

  // Stable key for the room names array to avoid re-creating callbacks on every render
  const roomNamesKey = conversationRoomNames?.join("\0") ?? "";

  const fetchMemory = useCallback(async () => {
    try {
      const res = await fetch("/api/memory");
      if (!res.ok) throw new Error(`Memory fetch failed: ${res.status}`);
      const data = (await res.json()) as MemoryState;
      setMemory(data);
      if (!roomNamesKey && data.events) setEvents(data.events);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load memory");
    } finally {
      setLoading(false);
    }
  }, [roomNamesKey]);

  const fetchEvents = useCallback(async () => {
    try {
      if (roomNamesKey) {
        const rooms = roomNamesKey.split("\0");
        const allEvents: MemoryEvent[] = [];
        await Promise.all(
          rooms.map(async (room) => {
            try {
              const res = await fetch(
                `/agents/inbox-agent/${encodeURIComponent(room)}/memory/events`,
              );
              if (!res.ok) return;
              const data: MemoryEvent[] = await res.json();
              allEvents.push(...data);
            } catch { /* skip individual failures */ }
          }),
        );
        const seen = new Set<string>();
        const deduped = allEvents.filter((e) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        });
        deduped.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        setEvents(deduped);
      } else {
        const res = await fetch("/api/memory/events");
        if (!res.ok) return;
        const data = (await res.json()) as MemoryEvent[];
        setEvents(data);
      }
    } catch {
      // non-critical
    }
  }, [roomNamesKey]);

  const fetchPromptSnapshot = useCallback(async () => {
    try {
      const res = await fetch("/api/memory/prompt-snapshot");
      if (!res.ok) return;
      const data = (await res.json()) as PromptSnapshot;
      setPromptSnapshot(data);
    } catch {
      // non-critical
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([fetchMemory(), fetchEvents(), fetchPromptSnapshot()]);
  }, [fetchMemory, fetchEvents, fetchPromptSnapshot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefreshMs || autoRefreshMs <= 0) return;
    refreshTimer.current = setInterval(() => void refresh(), autoRefreshMs);
    return () => clearInterval(refreshTimer.current);
  }, [autoRefreshMs, refresh]);

  const updateFacts = useCallback(async (facts: string[]) => {
    try {
      const res = await fetch("/api/memory/facts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts }),
      });
      if (!res.ok) throw new Error(`Update failed: ${res.status}`);
      setMemory((prev) => (prev ? { ...prev, userFacts: facts } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update facts");
    }
  }, []);

  const deleteFact = useCallback(async (index: number) => {
    try {
      const res = await fetch(`/api/memory/facts/${index}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      const data = (await res.json()) as { facts: string[] };
      setMemory((prev) => (prev ? { ...prev, userFacts: data.facts } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete fact");
    }
  }, []);

  const updatePromptConfig = useCallback(async (config: PromptConfig) => {
    try {
      const res = await fetch("/api/memory/system-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error(`Update failed: ${res.status}`);
      await fetchPromptSnapshot();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update prompt config");
    }
  }, [fetchPromptSnapshot]);

  const resetPromptConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/memory/system-prompt", { method: "DELETE" });
      if (!res.ok) throw new Error(`Reset failed: ${res.status}`);
      await fetchPromptSnapshot();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reset prompt config");
    }
  }, [fetchPromptSnapshot]);

  return {
    memory,
    events,
    promptSnapshot,
    loading,
    error,
    updateFacts,
    deleteFact,
    updatePromptConfig,
    resetPromptConfig,
    refresh,
    fetchPromptSnapshot,
  };
}
