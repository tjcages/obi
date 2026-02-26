import { useCallback, useEffect, useRef, useState } from "react";

export interface TodoEmailRef {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  accountEmail: string;
}

export interface TodoSlackRef {
  channelId: string;
  threadTs: string;
  messageTs: string;
  from: string;
  text: string;
  channelName?: string;
  permalink?: string;
}

export interface SubTask {
  id: string;
  title: string;
  completed: boolean;
}

export type TodoEntity =
  | { type: "person"; name: string; email: string }
  | { type: "email"; id: string; threadId: string; subject: string; from?: string }
  | { type: "category"; name: string }
  | { type: "link"; url: string };

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  subtasks?: SubTask[];
  categories?: string[];
  entities?: TodoEntity[];
  status: "suggested" | "pending" | "completed" | "archived";
  sourceEmails: TodoEmailRef[];
  sourceSlack?: TodoSlackRef[];
  scheduledDate: string | null;
  sortOrder: number;
  agentSuggested: boolean;
  userResponse: "accepted" | "declined" | null;
  suggestedAt?: string;
  declinedReason?: string;
  createdAt: string;
  completedAt?: string;
  archivedAt?: string;
}

export interface TodoPreferences {
  declinedPatterns: string[];
  acceptedPatterns: string[];
  preferredScheduling: string;
  autoSuggest: boolean;
  addToTop: boolean;
  todoCategories?: string[];
  categoryColors?: Record<string, string>;
}

interface UseTodosReturn {
  todos: TodoItem[];
  preferences: TodoPreferences;
  loading: boolean;
  error: string | null;
  lastUsedCategory: string | null;
  refresh: (opts?: { skipIfMutating?: boolean }) => Promise<void>;
  createTodo: (todo: { title: string; description?: string; scheduledDate?: string; categories?: string[]; sourceEmails?: TodoEmailRef[]; entities?: TodoEntity[] }) => Promise<TodoItem | null>;
  updateTodo: (id: string, updates: Partial<Pick<TodoItem, "title" | "description" | "subtasks" | "categories" | "status" | "scheduledDate">>) => Promise<void>;
  deleteTodo: (id: string) => Promise<void>;
  restoreTodo: (todo: TodoItem) => Promise<void>;
  completeTodo: (id: string) => Promise<void>;
  uncompleteTodo: (id: string) => Promise<void>;
  reorderTodos: (orderedIds: string[]) => Promise<void>;
  acceptSuggestion: (id: string) => Promise<void>;
  unacceptSuggestion: (id: string) => Promise<void>;
  declineSuggestion: (id: string, reason?: string) => Promise<void>;
  undeclineSuggestion: (id: string, originalTodo: TodoItem) => Promise<void>;
  saveCategories: (categories: string[]) => Promise<void>;
  saveCategoryColor: (category: string, hex: string | null) => Promise<void>;
}

const DEFAULT_PREFS: TodoPreferences = {
  declinedPatterns: [],
  acceptedPatterns: [],
  preferredScheduling: "same day",
  autoSuggest: true,
  addToTop: true,
};

// ── Client-authoritative sort order ───────────────────────
// The user's drag-to-reorder is the ultimate source of truth.
// We persist the ordered IDs to localStorage so they survive
// page reloads, and we preserve client sortOrders across polls
// so the 15-second refresh never overwrites the user's order.

const SORT_ORDER_KEY = "obi:todo-sort-order";

function persistUserOrder(orderedIds: string[]): void {
  try { localStorage.setItem(SORT_ORDER_KEY, JSON.stringify(orderedIds)); } catch { /* noop */ }
}

function loadUserOrder(): string[] | null {
  try {
    const raw = localStorage.getItem(SORT_ORDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function applyUserOrder(todos: TodoItem[], userOrder: string[]): TodoItem[] {
  const orderMap = new Map(userOrder.map((id, i) => [id, i]));
  return todos.map((t) => {
    const uo = orderMap.get(t.id);
    return uo !== undefined ? { ...t, sortOrder: uo } : t;
  });
}

export function useTodos(): UseTodosReturn {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [preferences, setPreferences] = useState<TodoPreferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUsedCategory, setLastUsedCategory] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const pendingMutations = useRef(0);
  const refreshSeqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async (opts?: { skipIfMutating?: boolean }) => {
    if (opts?.skipIfMutating && pendingMutations.current > 0) return;
    const seq = ++refreshSeqRef.current;
    try {
      const res = await fetch("/api/todos", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { todos: TodoItem[]; preferences: TodoPreferences };
      const suggested = data.todos.filter((t) => t.status === "suggested");
      if (suggested.length > 0) {
        console.log(`[useTodos] refresh seq=${seq} (current=${refreshSeqRef.current}): ${data.todos.length} todos, ${suggested.length} suggested`, suggested.map((s) => s.title));
      }
      if (!mountedRef.current || seq !== refreshSeqRef.current) {
        if (suggested.length > 0) console.warn(`[useTodos] DISCARDING refresh seq=${seq} (current=${refreshSeqRef.current}, mounted=${mountedRef.current}) — had ${suggested.length} suggestions!`);
        return;
      }
      if (pendingMutations.current > 0) return;
      setTodos((prev) => {
        const prevSuggested = prev.filter((t) => t.status === "suggested").length;
        if (prev.length === 0) {
          const saved = loadUserOrder();
          const result = saved ? applyUserOrder(data.todos, saved) : data.todos;
          if (suggested.length > 0 || prevSuggested > 0) console.log(`[useTodos] setTodos (initial path): prev=${prev.length} (${prevSuggested} suggested) → next=${result.length} (${result.filter((t) => t.status === "suggested").length} suggested)`);
          return result;
        }
        const clientSorts = new Map(prev.map((t) => [t.id, t.sortOrder]));
        const result = data.todos.map((t) => {
          const so = clientSorts.get(t.id);
          return so !== undefined ? { ...t, sortOrder: so } : t;
        });
        if (suggested.length > 0 || prevSuggested > 0) console.log(`[useTodos] setTodos (merge path): prev=${prev.length} (${prevSuggested} suggested) → next=${result.length} (${result.filter((t) => t.status === "suggested").length} suggested)`);
        return result;
      });
      setPreferences(data.preferences);
      setError(null);
    } catch (e) {
      if (mountedRef.current && seq === refreshSeqRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load todos");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll for new agent suggestions every 15 seconds.
  // Skip polls while mutations are in flight to avoid overwriting optimistic state.
  useEffect(() => {
    const interval = setInterval(() => {
      void refresh({ skipIfMutating: true });
    }, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const createTodo = useCallback(async (input: { title: string; description?: string; scheduledDate?: string; categories?: string[]; sourceEmails?: TodoEmailRef[]; entities?: TodoEntity[] }) => {
    pendingMutations.current++;
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { todo: TodoItem };
      setTodos((prev) =>
        preferences.addToTop !== false
          ? [data.todo, ...prev]
          : [...prev, data.todo],
      );
      if (input.categories?.length) {
        setLastUsedCategory(input.categories[0]);
      }
      return data.todo;
    } catch {
      await refresh();
      return null;
    } finally {
      pendingMutations.current--;
    }
  }, [refresh, preferences.addToTop]);

  const updateTodo = useCallback(async (id: string, updates: Partial<Pick<TodoItem, "title" | "description" | "subtasks" | "categories" | "status" | "scheduledDate">>) => {
    pendingMutations.current++;
    setTodos((prev) => prev.map((t) => t.id === id ? { ...t, ...updates } : t));
    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      await refresh();
    } finally {
      pendingMutations.current--;
    }
  }, [refresh]);

  const deleteTodo = useCallback(async (id: string) => {
    pendingMutations.current++;
    setTodos((prev) => prev.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/todos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      await refresh();
    } finally {
      pendingMutations.current--;
    }
  }, [refresh]);

  const restoreTodo = useCallback(async (todo: TodoItem) => {
    pendingMutations.current++;
    setTodos((prev) => {
      if (prev.some((t) => t.id === todo.id)) return prev;
      return [...prev, todo];
    });
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(todo),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      await refresh();
    } finally {
      pendingMutations.current--;
    }
  }, [refresh]);

  const completeTodo = useCallback(async (id: string) => {
    pendingMutations.current++;
    setTodos((prev) =>
      prev.map((t) => t.id === id ? { ...t, status: "completed" as const, completedAt: new Date().toISOString() } : t),
    );
    try {
      const res = await fetch(`/api/todos/${id}/complete`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      await refresh();
    } finally {
      pendingMutations.current--;
    }
  }, [refresh]);

  const uncompleteTodo = useCallback(async (id: string) => {
    pendingMutations.current++;
    setTodos((prev) =>
      prev.map((t) => t.id === id ? { ...t, status: "pending" as const, completedAt: undefined } : t),
    );
    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending", completedAt: null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      await refresh();
    } finally {
      pendingMutations.current--;
    }
  }, [refresh]);

  const reorderTodos = useCallback(async (orderedIds: string[]) => {
    persistUserOrder(orderedIds);
    pendingMutations.current++;
    setTodos((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]));
      const reordered: TodoItem[] = [];
      for (const id of orderedIds) {
        const t = map.get(id);
        if (t) reordered.push({ ...t, sortOrder: reordered.length });
      }
      for (const t of prev) {
        if (!orderedIds.includes(t.id)) reordered.push(t);
      }
      return reordered;
    });
    try {
      const res = await fetch("/api/todos/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      if (!res.ok) {
        console.warn("[reorder] server returned", res.status);
        return;
      }
      // Merge server-confirmed sortOrders so the next poll won't overwrite them
      const data = (await res.json()) as { todos: TodoItem[] };
      const confirmedOrder = new Map(data.todos.map((t: TodoItem) => [t.id, t.sortOrder]));
      setTodos((prev) =>
        prev.map((t) => {
          const so = confirmedOrder.get(t.id);
          return so !== undefined ? { ...t, sortOrder: so } : t;
        }),
      );
    } catch (err) {
      console.warn("[reorder] failed, will reconcile on next refresh", err);
    } finally {
      pendingMutations.current--;
    }
  }, []);

  const acceptSuggestion = useCallback(async (id: string) => {
    pendingMutations.current++;
    setTodos((prev) => {
      const minOrder = Math.min(0, ...prev.filter((t) => t.status === "pending").map((t) => t.sortOrder)) - 1;
      return prev.map((t) => t.id === id ? { ...t, status: "pending" as const, userResponse: "accepted" as const, sortOrder: minOrder } : t);
    });
    try {
      const res = await fetch(`/api/todos/${id}/accept`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      await refresh();
    } finally {
      pendingMutations.current--;
    }
  }, [refresh]);

  const unacceptSuggestion = useCallback(async (id: string) => {
    pendingMutations.current++;
    setTodos((prev) =>
      prev.map((t) => t.id === id ? { ...t, status: "suggested" as const, userResponse: null, completedAt: undefined } : t),
    );
    try {
      const res = await fetch(`/api/todos/${id}/unaccept`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      await refresh();
    } finally {
      pendingMutations.current--;
    }
  }, [refresh]);

  const declineSuggestion = useCallback(async (id: string, reason?: string) => {
    pendingMutations.current++;
    setTodos((prev) => prev.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/todos/${id}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      await refresh();
    } finally {
      pendingMutations.current--;
    }
  }, [refresh]);

  const undeclineSuggestion = useCallback(async (id: string, originalTodo: TodoItem) => {
    pendingMutations.current++;
    setTodos((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      return [...prev, { ...originalTodo, status: "suggested" as const, userResponse: null, declinedReason: undefined, archivedAt: undefined }];
    });
    try {
      const res = await fetch(`/api/todos/${id}/undecline`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      await refresh();
    } finally {
      pendingMutations.current--;
    }
  }, [refresh]);

  const saveCategories = useCallback(async (categories: string[]) => {
    pendingMutations.current++;
    setPreferences((prev) => ({ ...prev, todoCategories: categories }));
    try {
      await fetch("/api/todos/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories }),
      });
    } catch {
      await refresh();
    } finally {
      pendingMutations.current--;
    }
  }, [refresh]);

  const saveCategoryColor = useCallback(async (category: string, hex: string | null) => {
    pendingMutations.current++;
    let updated: Record<string, string> = {};
    setPreferences((prev) => {
      const colors = { ...(prev.categoryColors ?? {}) };
      if (hex) colors[category] = hex;
      else delete colors[category];
      updated = colors;
      return { ...prev, categoryColors: colors };
    });
    try {
      await fetch("/api/todos/category-colors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colors: updated }),
      });
    } catch {
      await refresh();
    } finally {
      pendingMutations.current--;
    }
  }, [refresh]);

  return {
    todos,
    preferences,
    loading,
    error,
    lastUsedCategory,
    refresh,
    createTodo,
    updateTodo,
    deleteTodo,
    restoreTodo,
    completeTodo,
    uncompleteTodo,
    reorderTodos,
    acceptSuggestion,
    unacceptSuggestion,
    declineSuggestion,
    undeclineSuggestion,
    saveCategories,
    saveCategoryColor,
  };
}
