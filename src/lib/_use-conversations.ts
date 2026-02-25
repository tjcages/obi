import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_CONVERSATION_ID,
  activeConversationStorageKey,
  buildConversationTitle,
  conversationListStorageKey,
  normalizeConversationId,
} from "./_conversations";

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: number;
  lastSnippet?: string;
  archived?: boolean;
  category?: string | null;
};

function normalizeConversations(input: unknown): ConversationSummary[] {
  if (!Array.isArray(input)) return [];
  const next: ConversationSummary[] = [];
  for (const value of input) {
    const row = value as Partial<ConversationSummary>;
    const id = normalizeConversationId(row.id);
    if (!id) continue;
    const title =
      typeof row.title === "string" && row.title.trim()
        ? row.title.trim().slice(0, 64)
        : id === DEFAULT_CONVERSATION_ID
          ? "Inbox"
          : "New conversation";
    const updatedAt = typeof row.updatedAt === "number" ? row.updatedAt : 0;
    next.push({
      id,
      title,
      updatedAt,
      lastSnippet: typeof row.lastSnippet === "string" ? row.lastSnippet : "",
      archived: row.archived === true,
      category: typeof row.category === "string" ? row.category : null,
    });
  }
  return next;
}

export function sortConversations(items: ConversationSummary[]): ConversationSummary[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
}

function getInitialConversations(userId: string): ConversationSummary[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(conversationListStorageKey(userId));
  if (!raw) return [];
  try {
    return sortConversations(normalizeConversations(JSON.parse(raw)));
  } catch {
    return [];
  }
}

export function createConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `c_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  }
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function getTimeGroup(timestamp: number): string {
  if (!timestamp) return "Older";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (timestamp >= startOfToday) return "Today";
  if (timestamp >= startOfToday - 86_400_000) return "Yesterday";
  if (timestamp >= startOfToday - 6 * 86_400_000) return "Previous 7 days";
  return "Older";
}

export interface UseConversationsOptions {
  userId: string;
  /** When true, persist the active conversation id to URL search params */
  syncToUrl?: boolean;
}

export interface UseConversationsReturn {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  activeConversation: ConversationSummary | undefined;
  sortedActive: ConversationSummary[];
  sortedArchived: ConversationSummary[];
  pendingPrompt: string | null;
  sessionSyncing: boolean;
  startConversation: (title: string, prompt: string, category?: string | null) => string;
  createBlankConversation: (category?: string | null) => string;
  selectConversation: (id: string) => void;
  closeConversation: () => void;
  archiveConversation: (id: string) => void;
  unarchiveConversation: (id: string) => void;
  renameConversation: (id: string, newTitle: string) => void;
  deleteConversation: (id: string) => void;
  onConversationMessage: (text: string) => void;
  clearPendingPrompt: () => void;
}

export function useConversations({
  userId,
  syncToUrl = false,
}: UseConversationsOptions): UseConversationsReturn {
  const [conversations, setConversations] = useState<ConversationSummary[]>(
    () => getInitialConversations(userId),
  );
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    if (syncToUrl && typeof window !== "undefined") {
      const fromUrl = normalizeConversationId(
        new URLSearchParams(window.location.search).get("c"),
      );
      if (fromUrl) return fromUrl;
    }
    return null;
  });
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [sessionSyncing, setSessionSyncing] = useState(false);

  const sortedActive = useMemo(
    () => sortConversations(conversations.filter((c) => !c.archived)),
    [conversations],
  );
  const sortedArchived = useMemo(
    () => sortConversations(conversations.filter((c) => c.archived)),
    [conversations],
  );
  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  // Persist conversation list to localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      conversationListStorageKey(userId),
      JSON.stringify(conversations),
    );
  }, [userId, conversations]);

  // Persist active conversation id
  useEffect(() => {
    if (typeof window === "undefined" || !activeConversationId) return;
    window.localStorage.setItem(
      activeConversationStorageKey(userId),
      activeConversationId,
    );
    if (syncToUrl) {
      const params = new URLSearchParams(window.location.search);
      if (activeConversationId === DEFAULT_CONVERSATION_ID) {
        params.delete("c");
      } else {
        params.set("c", activeConversationId);
      }
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`;
      window.history.replaceState(null, "", nextUrl);
    }
  }, [userId, activeConversationId, syncToUrl]);

  // Sync session with server when conversation changes
  useEffect(() => {
    const validId =
      activeConversationId && normalizeConversationId(activeConversationId);
    if (!validId || activeConversationId === DEFAULT_CONVERSATION_ID) {
      setSessionSyncing(false);
      return;
    }
    const activeConv = conversations.find((c) => c.id === activeConversationId);
    const category = activeConv?.category ?? null;
    let cancelled = false;
    setSessionSyncing(true);
    void (async () => {
      try {
        const res = await fetch("/api/chat/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: activeConversationId, category }),
        });
        if (!res.ok && res.status === 409) {
          if (!cancelled) window.location.assign("/logout");
          return;
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setSessionSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConversationId, conversations]);

  const startConversation = useCallback((title: string, prompt: string, category?: string | null) => {
    const id = createConversationId();
    setConversations((prev) =>
      sortConversations([
        { id, title, updatedAt: Date.now(), lastSnippet: "", category: category ?? null },
        ...prev.filter((x) => x.id !== id),
      ]),
    );
    setActiveConversationId(id);
    setPendingPrompt(prompt);
    return id;
  }, []);

  const createBlankConversation = useCallback((category?: string | null) => {
    const id = createConversationId();
    setConversations((prev) =>
      sortConversations([
        { id, title: "New conversation", updatedAt: Date.now(), lastSnippet: "", category: category ?? null },
        ...prev.filter((x) => x.id !== id),
      ]),
    );
    setActiveConversationId(id);
    setPendingPrompt(null);
    return id;
  }, []);

  const selectConversation = useCallback((id: string) => {
    setActiveConversationId((prev) => (prev === id ? null : id));
    setPendingPrompt(null);
  }, []);

  const closeConversation = useCallback(() => {
    setActiveConversationId(null);
    setPendingPrompt(null);
  }, []);

  const archiveConversation = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, archived: true } : c)),
    );
    setActiveConversationId((prev) => (prev === id ? null : prev));
  }, []);

  const unarchiveConversation = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, archived: false } : c)),
    );
  }, []);

  const renameConversation = useCallback((id: string, newTitle: string) => {
    const title = newTitle.trim().slice(0, 64);
    if (!title) return;
    setConversations((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, title, updatedAt: Math.max(item.updatedAt, Date.now()) }
          : item,
      ),
    );
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const remaining = sortConversations(prev.filter((x) => x.id !== id));
      return remaining;
    });
    setActiveConversationId((prev) => (prev === id ? null : prev));
  }, []);

  const onConversationMessage = useCallback(
    (text: string) => {
      setConversations((prev) =>
        prev.map((item) => {
          if (item.id !== activeConversationId) return item;
          const shouldSetTitle = item.title === "New conversation";
          return {
            ...item,
            title: shouldSetTitle ? buildConversationTitle(text) : item.title,
            updatedAt: Date.now(),
          };
        }),
      );
    },
    [activeConversationId],
  );

  const clearPendingPrompt = useCallback(() => {
    setPendingPrompt(null);
  }, []);

  return {
    conversations,
    activeConversationId,
    activeConversation,
    sortedActive,
    sortedArchived,
    pendingPrompt,
    sessionSyncing,
    startConversation,
    createBlankConversation,
    selectConversation,
    closeConversation,
    archiveConversation,
    unarchiveConversation,
    renameConversation,
    deleteConversation,
    onConversationMessage,
    clearPendingPrompt,
  };
}
