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
  dashboardSectionOrder?: string[];
  todoCategories?: string[];
}

const STORAGE_KEY_TODOS = "todos:items";
const STORAGE_KEY_ARCHIVED = "todos:archived";
const STORAGE_KEY_PREFERENCES = "todos:preferences";
const STORAGE_KEY_CATEGORIES = "todos:categories";
const STORAGE_KEY_CATEGORY_COLORS = "todos:category-colors";

const MAX_ARCHIVED = 200;
const MAX_PATTERNS = 50;

const DEFAULT_PREFERENCES: TodoPreferences = {
  declinedPatterns: [],
  acceptedPatterns: [],
  preferredScheduling: "same day",
  autoSuggest: true,
  addToTop: true,
};

export function generateTodoId(): string {
  return `todo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadTodos(storage: DurableObjectStorage): Promise<TodoItem[]> {
  return (await storage.get<TodoItem[]>(STORAGE_KEY_TODOS)) ?? [];
}

export async function saveTodos(storage: DurableObjectStorage, items: TodoItem[]): Promise<void> {
  await storage.put(STORAGE_KEY_TODOS, items);
}

export async function loadArchivedTodos(storage: DurableObjectStorage): Promise<TodoItem[]> {
  return (await storage.get<TodoItem[]>(STORAGE_KEY_ARCHIVED)) ?? [];
}

export async function loadPreferences(storage: DurableObjectStorage): Promise<TodoPreferences> {
  const prefs = await storage.get<TodoPreferences>(STORAGE_KEY_PREFERENCES);
  return prefs ?? { ...DEFAULT_PREFERENCES };
}

export async function savePreferences(
  storage: DurableObjectStorage,
  prefs: TodoPreferences,
): Promise<void> {
  await storage.put(STORAGE_KEY_PREFERENCES, prefs);
}

export async function addTodo(
  storage: DurableObjectStorage,
  todo: Omit<TodoItem, "id" | "sortOrder" | "createdAt">,
  options?: { addToTop?: boolean },
): Promise<TodoItem> {
  const items = await loadTodos(storage);
  const addToTop = options?.addToTop ?? true;

  if (addToTop) {
    const minOrder = items.reduce((min, t) => Math.min(min, t.sortOrder), 0);
    const newTodo: TodoItem = {
      ...todo,
      id: generateTodoId(),
      sortOrder: minOrder - 1,
      createdAt: new Date().toISOString(),
    };
    items.unshift(newTodo);
    await saveTodos(storage, items);
    return newTodo;
  }

  const maxOrder = items.reduce((max, t) => Math.max(max, t.sortOrder), 0);
  const newTodo: TodoItem = {
    ...todo,
    id: generateTodoId(),
    sortOrder: maxOrder + 1,
    createdAt: new Date().toISOString(),
  };
  items.push(newTodo);
  await saveTodos(storage, items);
  return newTodo;
}

export async function updateTodo(
  storage: DurableObjectStorage,
  id: string,
  updates: Partial<Pick<TodoItem, "title" | "description" | "subtasks" | "categories" | "status" | "scheduledDate" | "sortOrder" | "completedAt" | "archivedAt">>,
): Promise<TodoItem | null> {
  const items = await loadTodos(storage);
  const idx = items.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...updates };
  await saveTodos(storage, items);
  return items[idx];
}

export async function deleteTodo(
  storage: DurableObjectStorage,
  id: string,
): Promise<boolean> {
  const items = await loadTodos(storage);
  const filtered = items.filter((t) => t.id !== id);
  if (filtered.length === items.length) return false;
  await saveTodos(storage, filtered);
  return true;
}

export async function completeTodo(
  storage: DurableObjectStorage,
  id: string,
): Promise<TodoItem | null> {
  return updateTodo(storage, id, {
    status: "completed",
    completedAt: new Date().toISOString(),
  });
}

export async function reorderTodos(
  storage: DurableObjectStorage,
  orderedIds: string[],
): Promise<TodoItem[]> {
  const items = await loadTodos(storage);
  const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
  for (const item of items) {
    const newOrder = orderMap.get(item.id);
    if (newOrder !== undefined) item.sortOrder = newOrder;
  }
  items.sort((a, b) => a.sortOrder - b.sortOrder);
  await saveTodos(storage, items);
  return items;
}

export async function acceptSuggestion(
  storage: DurableObjectStorage,
  id: string,
): Promise<TodoItem | null> {
  const items = await loadTodos(storage);
  const idx = items.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const todo = items[idx];
  todo.status = "pending";
  todo.userResponse = "accepted";
  const minOrder = Math.min(0, ...items.filter((t) => t.status === "pending").map((t) => t.sortOrder)) - 1;
  todo.sortOrder = minOrder;
  await saveTodos(storage, items);

  const prefs = await loadPreferences(storage);
  const pattern = extractPattern(todo);
  if (pattern && !prefs.acceptedPatterns.includes(pattern)) {
    prefs.acceptedPatterns = [...prefs.acceptedPatterns, pattern].slice(-MAX_PATTERNS);
    await savePreferences(storage, prefs);
  }
  return todo;
}

export async function declineSuggestion(
  storage: DurableObjectStorage,
  id: string,
  reason?: string,
): Promise<TodoItem | null> {
  const items = await loadTodos(storage);
  const idx = items.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const todo = items[idx];
  todo.status = "archived";
  todo.userResponse = "declined";
  todo.declinedReason = reason;
  todo.archivedAt = new Date().toISOString();

  const remaining = items.filter((t) => t.id !== id);
  await saveTodos(storage, remaining);

  const archived = await loadArchivedTodos(storage);
  archived.push(todo);
  await storage.put(STORAGE_KEY_ARCHIVED, archived.slice(-MAX_ARCHIVED));

  const prefs = await loadPreferences(storage);
  const pattern = extractPattern(todo);
  if (pattern && !prefs.declinedPatterns.includes(pattern)) {
    prefs.declinedPatterns = [...prefs.declinedPatterns, pattern].slice(-MAX_PATTERNS);
    await savePreferences(storage, prefs);
  }
  return todo;
}

export async function unacceptSuggestion(
  storage: DurableObjectStorage,
  id: string,
): Promise<TodoItem | null> {
  const items = await loadTodos(storage);
  const idx = items.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const todo = items[idx];
  todo.status = "suggested";
  todo.userResponse = null;
  todo.completedAt = undefined;
  await saveTodos(storage, items);
  return todo;
}

export async function undeclineSuggestion(
  storage: DurableObjectStorage,
  id: string,
): Promise<TodoItem | null> {
  const archived = await loadArchivedTodos(storage);
  const idx = archived.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const todo = archived[idx];
  todo.status = "suggested";
  todo.userResponse = null;
  todo.declinedReason = undefined;
  todo.archivedAt = undefined;

  archived.splice(idx, 1);
  await storage.put(STORAGE_KEY_ARCHIVED, archived);

  const items = await loadTodos(storage);
  items.push(todo);
  await saveTodos(storage, items);

  return todo;
}

function extractPattern(todo: TodoItem): string | null {
  const title = todo.title.toLowerCase();
  const patterns = [
    { match: /reply|respond/i, label: "reply requests" },
    { match: /follow.?up/i, label: "follow-ups" },
    { match: /meeting|call|schedule/i, label: "meeting-related" },
    { match: /review|approve|sign/i, label: "approvals and reviews" },
    { match: /deadline|due|by\s/i, label: "deadlines" },
    { match: /rsvp|attend|event/i, label: "events and RSVPs" },
    { match: /pay|invoice|bill/i, label: "payments and billing" },
    { match: /newsletter|unsubscribe|promo/i, label: "newsletters and promotions" },
  ];
  for (const p of patterns) {
    if (p.match.test(title)) return p.label;
  }
  if (todo.sourceEmails.length > 0) {
    const from = todo.sourceEmails[0].from.toLowerCase();
    if (from.includes("noreply") || from.includes("no-reply")) return "automated notifications";
  }
  return null;
}

export async function clearSuggestions(storage: DurableObjectStorage): Promise<number> {
  const items = await loadTodos(storage);
  const kept = items.filter((t) => t.status !== "suggested");
  const removed = items.length - kept.length;
  if (removed > 0) await saveTodos(storage, kept);
  return removed;
}

export async function archiveCompletedTodos(storage: DurableObjectStorage): Promise<number> {
  const items = await loadTodos(storage);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const toArchive: TodoItem[] = [];
  const toKeep: TodoItem[] = [];

  for (const item of items) {
    if (item.status === "completed" && item.completedAt && item.completedAt < todayStart) {
      toArchive.push({ ...item, status: "archived", archivedAt: now.toISOString() });
    } else {
      toKeep.push(item);
    }
  }

  if (toArchive.length === 0) return 0;

  await saveTodos(storage, toKeep);
  const archived = await loadArchivedTodos(storage);
  archived.push(...toArchive);
  await storage.put(STORAGE_KEY_ARCHIVED, archived.slice(-MAX_ARCHIVED));

  return toArchive.length;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titlesAreSimilar(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return true;
  if (na.length === 0 || nb.length === 0) return false;
  if (na.includes(nb) || nb.includes(na)) return true;

  const wordsA = new Set(na.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const smaller = Math.min(wordsA.size, wordsB.size);
  return intersection / smaller >= 0.7;
}

export async function addSuggestedTodos(
  storage: DurableObjectStorage,
  suggestions: Array<{
    title: string;
    description?: string;
    scheduledDate?: string;
    categories?: string[];
    sourceEmail?: {
      messageId: string;
      threadId: string;
      subject: string;
      from: string;
      snippet: string;
      accountEmail?: string;
    };
    sourceSlack?: TodoSlackRef;
  }>,
): Promise<TodoItem[]> {
  const items = await loadTodos(storage);
  const archived = await loadArchivedTodos(storage);

  // Only block re-suggestion for pending/suggested todos and explicitly
  // declined archived todos. Completed todos should NOT block new suggestions
  // — the user may need a fresh action on the same email thread.
  const trackedEmailIds = new Set<string>();
  const trackedSlackTs = new Set<string>();

  for (const todo of items) {
    if (todo.status === "completed") continue;
    for (const ref of todo.sourceEmails) {
      trackedEmailIds.add(ref.messageId);
      trackedEmailIds.add(ref.threadId);
    }
    if (todo.sourceSlack) {
      for (const ref of todo.sourceSlack) {
        trackedSlackTs.add(ref.messageTs);
        trackedSlackTs.add(ref.threadTs);
      }
    }
  }

  for (const todo of archived) {
    if (todo.userResponse !== "declined") continue;
    for (const ref of todo.sourceEmails) {
      trackedEmailIds.add(ref.messageId);
      trackedEmailIds.add(ref.threadId);
    }
    if (todo.sourceSlack) {
      for (const ref of todo.sourceSlack) {
        trackedSlackTs.add(ref.messageTs);
        trackedSlackTs.add(ref.threadTs);
      }
    }
  }

  const nonArchivedTitles = items.map((t) => t.title);

  const deduplicated = suggestions.filter((s) => {
    if (s.sourceEmail) {
      if (trackedEmailIds.has(s.sourceEmail.messageId) || trackedEmailIds.has(s.sourceEmail.threadId)) {
        console.log(`[todos] Skipping duplicate suggestion (email match): "${s.title}"`);
        return false;
      }
    }
    if (s.sourceSlack) {
      if (trackedSlackTs.has(s.sourceSlack.messageTs) || trackedSlackTs.has(s.sourceSlack.threadTs)) {
        console.log(`[todos] Skipping duplicate suggestion (slack match): "${s.title}"`);
        return false;
      }
    }
    if (nonArchivedTitles.some((existing) => titlesAreSimilar(existing, s.title))) {
      console.log(`[todos] Skipping duplicate suggestion (similar title): "${s.title}"`);
      return false;
    }
    return true;
  });

  if (deduplicated.length === 0) return [];

  const maxOrder = items.reduce((max, t) => Math.max(max, t.sortOrder), 0);
  const now = new Date().toISOString();

  const newTodos: TodoItem[] = deduplicated.map((s, i) => ({
    id: generateTodoId(),
    title: s.title,
    description: s.description,
    categories: s.categories?.length ? s.categories : undefined,
    status: "suggested" as const,
    sourceEmails: s.sourceEmail
      ? [{
          messageId: s.sourceEmail.messageId,
          threadId: s.sourceEmail.threadId,
          subject: s.sourceEmail.subject,
          from: s.sourceEmail.from,
          snippet: s.sourceEmail.snippet,
          accountEmail: s.sourceEmail.accountEmail ?? "",
        }]
      : [],
    sourceSlack: s.sourceSlack ? [s.sourceSlack] : undefined,
    scheduledDate: s.scheduledDate ?? null,
    sortOrder: maxOrder + i + 1,
    agentSuggested: true,
    userResponse: null,
    suggestedAt: now,
    createdAt: now,
  }));

  items.push(...newTodos);
  await saveTodos(storage, items);
  return newTodos;
}

function formatTodoForPrompt(todo: TodoItem): string {
  const parts = [`- [${todo.id}] "${todo.title}"`];
  if (todo.status !== "pending") parts.push(`(${todo.status})`);
  if (todo.scheduledDate) parts.push(`scheduled: ${todo.scheduledDate}`);
  if (todo.categories && todo.categories.length > 0) parts.push(`[${todo.categories.join(", ")}]`);
  if (todo.description) parts.push(`— ${todo.description}`);
  if (todo.subtasks && todo.subtasks.length > 0) {
    const done = todo.subtasks.filter((s) => s.completed).length;
    parts.push(`(${done}/${todo.subtasks.length} subtasks done)`);
  }
  if (todo.sourceEmails.length > 0) {
    const src = todo.sourceEmails[0];
    parts.push(`from: ${src.from} re: "${src.subject}"`);
  }
  if (todo.sourceSlack && todo.sourceSlack.length > 0) {
    const src = todo.sourceSlack[0];
    const channel = src.channelName ? `#${src.channelName}` : src.channelId;
    parts.push(`slack: ${src.from} in ${channel}`);
  }
  return parts.join(" ");
}

export function buildTodoPreferenceContext(prefs: TodoPreferences, todos: TodoItem[]): string {
  const parts: string[] = [];

  const pending = todos.filter((t) => t.status === "pending");
  const suggested = todos.filter((t) => t.status === "suggested");
  const completed = todos.filter((t) => t.status === "completed");

  if (pending.length > 0) {
    parts.push(`Active to-do items (${pending.length}):`);
    for (const t of pending) {
      parts.push(formatTodoForPrompt(t));
    }
  }

  if (suggested.length > 0) {
    parts.push(`\nPending suggestions awaiting user review (${suggested.length}):`);
    for (const t of suggested) {
      parts.push(formatTodoForPrompt(t));
    }
  }

  if (completed.length > 0) {
    const recent = completed
      .filter((t) => t.completedAt)
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
      .slice(0, 5);
    if (recent.length > 0) {
      parts.push(`\nRecently completed (last ${recent.length}):`);
      for (const t of recent) {
        parts.push(`- "${t.title}" completed ${t.completedAt ? new Date(t.completedAt).toLocaleDateString() : "recently"}`);
      }
    }
  }

  if (pending.length === 0 && suggested.length === 0 && completed.length === 0) {
    parts.push("The user has no to-do items yet.");
  }

  if (pending.length > 0 || suggested.length > 0) {
    parts.push(
      "\nIMPORTANT: Before calling suggest_todos, review the active and pending items above. Do NOT suggest a todo that duplicates or closely matches an existing item. If an item already covers the same action, skip it.",
    );
  }

  if (prefs.declinedPatterns.length > 0) {
    parts.push(
      `\nThe user has previously declined suggestions related to: ${prefs.declinedPatterns.join(", ")}. Avoid suggesting similar items unless the context is clearly different.`,
    );
  }

  if (prefs.acceptedPatterns.length > 0) {
    parts.push(
      `The user tends to accept suggestions related to: ${prefs.acceptedPatterns.join(", ")}. Prioritize these types of actionable items.`,
    );
  }

  if (!prefs.autoSuggest) {
    parts.push("The user has disabled automatic to-do suggestions. Only suggest todos when explicitly asked.");
  }

  return parts.join("\n");
}

export async function loadCategories(storage: DurableObjectStorage): Promise<string[]> {
  return (await storage.get<string[]>(STORAGE_KEY_CATEGORIES)) ?? [];
}

export async function saveCategories(storage: DurableObjectStorage, categories: string[]): Promise<void> {
  await storage.put(STORAGE_KEY_CATEGORIES, categories);
}

export async function loadCategoryColors(storage: DurableObjectStorage): Promise<Record<string, string>> {
  return (await storage.get<Record<string, string>>(STORAGE_KEY_CATEGORY_COLORS)) ?? {};
}

export async function saveCategoryColors(storage: DurableObjectStorage, colors: Record<string, string>): Promise<void> {
  await storage.put(STORAGE_KEY_CATEGORY_COLORS, colors);
}

export function getNextMidnight(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime();
}
