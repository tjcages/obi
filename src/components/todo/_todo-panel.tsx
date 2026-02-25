import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn, getCategoryColor, useIsMobile, useSmartInput } from "../../lib";
import type { TodoItem, TodoEmailRef, TodoEntity } from "../../lib";
import { SmartInput, type SmartEntity } from "../smart-input";
import { List, ListItem } from "../ui/_list";
import { ScrollFade } from "../ui";
import { TodoItemComponent } from "./_todo-item";
import { TodoSuggestionCard } from "./_todo-suggestion-card";
import { TodoCalendar } from "./_todo-calendar";
import { TodoCheckbox } from "./_todo-checkbox";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toLocalDateStr(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

  if (date.getTime() === tomorrow.setHours(0, 0, 0, 0)) return "Tomorrow";
  if (date.getTime() === yesterday.setHours(0, 0, 0, 0)) return "Yesterday";

  return `${SHORT_DAYS[date.getDay()]}, ${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}`;
}

interface ScanResultSummary {
  suggested: number;
  emailsScanned: number;
  skippedDuplicate: number;
}

interface TodoPanelProps {
  todos: TodoItem[];
  /** When set, treats this date as "today" for grouping purposes. */
  activeDate?: string | null;
  loading: boolean;
  scanning?: boolean;
  lastScanResult?: ScanResultSummary | null;
  categories?: string[];
  lastUsedCategory?: string | null;
  createTodo: (todo: { title: string; description?: string; scheduledDate?: string; categories?: string[]; sourceEmails?: TodoEmailRef[]; entities?: TodoEntity[] }) => Promise<TodoItem | null>;
  updateTodo: (id: string, updates: Partial<Pick<TodoItem, "title" | "description" | "subtasks" | "categories" | "status" | "scheduledDate">>) => Promise<void>;
  deleteTodo: (id: string) => void;
  completeTodo: (id: string) => Promise<void>;
  uncompleteTodo: (id: string) => Promise<void>;
  reorderTodos: (orderedIds: string[]) => Promise<void>;
  acceptSuggestion: (id: string) => Promise<void>;
  acceptAndCompleteSuggestion: (id: string) => Promise<void>;
  declineSuggestion: (id: string, reason?: string) => Promise<void>;
  onEmailClick?: (threadId: string, accountEmail?: string) => void;
  onSlackClick?: (slackRef: TodoItem["sourceSlack"]) => void;
  onRefreshSuggestions?: () => void;
  onSaveCategories?: (categories: string[]) => Promise<void>;
  onOpenWorkspace?: (category: string) => void;
  hideCategoryBar?: boolean;
}

export function TodoPanel({
  todos,
  activeDate,
  loading,
  scanning,
  lastScanResult,
  categories = [],
  lastUsedCategory,
  createTodo,
  updateTodo,
  deleteTodo,
  completeTodo,
  uncompleteTodo,
  reorderTodos,
  acceptSuggestion,
  acceptAndCompleteSuggestion,
  declineSuggestion,
  onRefreshSuggestions,
  onEmailClick,
  onSlackClick,
  onSaveCategories,
  onOpenWorkspace,
  hideCategoryBar,
}: TodoPanelProps) {
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarTodoId, setCalendarTodoId] = useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);
  const [addingTodo, setAddingTodo] = useState(false);
  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [newTodoCategories, setNewTodoCategories] = useState<string[]>(
    lastUsedCategory ? [lastUsedCategory] : [],
  );
  const { contacts, searchContacts, searchEmails } = useSmartInput();

  useEffect(() => {
    if (lastUsedCategory) setNewTodoCategories([lastUsedCategory]);
    else setNewTodoCategories([]);
  }, [lastUsedCategory]);

  const today = todayStr();
  const groupAnchor = activeDate ?? today;
  const isViewingToday = groupAnchor === today;

  const { suggested, todayTodos, upcoming, unscheduled, completed } = useMemo(() => {
    const suggested: TodoItem[] = [];
    const todayItems: TodoItem[] = [];
    const upcomingItems: TodoItem[] = [];
    const unscheduledItems: TodoItem[] = [];
    const completedItems: TodoItem[] = [];

    for (const t of todos) {
      if (t.status === "suggested") {
        suggested.push(t);
      } else if (t.status === "completed") {
        const localDate = t.completedAt ? toLocalDateStr(t.completedAt) : null;
        if (localDate === groupAnchor) {
          completedItems.push(t);
        }
      } else if (t.status === "pending") {
        if (!t.scheduledDate) {
          unscheduledItems.push(t);
        } else if (t.scheduledDate === groupAnchor) {
          todayItems.push(t);
        } else if (isViewingToday && t.scheduledDate < today) {
          todayItems.push(t);
        } else if (t.scheduledDate > groupAnchor) {
          upcomingItems.push(t);
        }
      }
    }

    todayItems.sort((a, b) => a.sortOrder - b.sortOrder);
    unscheduledItems.sort((a, b) => a.sortOrder - b.sortOrder);
    upcomingItems.sort((a, b) => {
      const dateCompare = (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? "");
      return dateCompare !== 0 ? dateCompare : a.sortOrder - b.sortOrder;
    });
    completedItems.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

    return { suggested, todayTodos: todayItems, upcoming: upcomingItems, unscheduled: unscheduledItems, completed: completedItems };
  }, [todos, groupAnchor, isViewingToday, today]);


  const handleDateChange = useCallback((id: string, date: string | null) => {
    void updateTodo(id, { scheduledDate: date });
  }, [updateTodo]);

  const handleUpdate = useCallback((id: string, updates: Partial<Pick<TodoItem, "title" | "description" | "subtasks" | "categories">>) => {
    void updateTodo(id, updates);
  }, [updateTodo]);

  const todoDates = useMemo(
    () => todos.filter((t) => t.scheduledDate && t.status !== "archived").map((t) => t.scheduledDate!),
    [todos],
  );

  const calendarTodo = calendarTodoId ? todos.find((t) => t.id === calendarTodoId) : null;
  const totalActive = todayTodos.length + upcoming.length + unscheduled.length;
  const isEmpty = suggested.length === 0 && totalActive === 0 && completed.length === 0;
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-100 border-t-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category management */}
      {!hideCategoryBar && (categories.length > 0 || onSaveCategories) && (
        <CategoryBar
          categories={categories}
          onSave={onSaveCategories}
          onOpenWorkspace={onOpenWorkspace}
        />
      )}

      {/* Agent suggestions */}
      {suggested.length > 0 && (
        <div>
          <SectionHeader
            label="Suggested"
            count={suggested.length}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="text-blue-400">
                <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z" />
              </svg>
            }
            onRefresh={onRefreshSuggestions}
            refreshing={scanning}
          />
          <List
            gap="gap-2"
            reorderable
            onReorder={(ids) => void reorderTodos(ids)}
            renderDragOverlay={(id) => {
              const t = suggested.find((x) => x.id === id);
              return t ? (
                <TodoSuggestionCard
                  todo={t}
                  onAccept={() => {}}
                  onAcceptAndComplete={() => {}}
                  onDecline={() => {}}
                  onUpdate={() => {}}
                />
              ) : null;
            }}
          >
            {suggested.map((todo) => (
              <ListItem key={todo.id} itemId={todo.id}>
                <TodoSuggestionCard
                  todo={todo}
                  onAccept={acceptSuggestion}
                  onAcceptAndComplete={acceptAndCompleteSuggestion}
                  onDecline={declineSuggestion}
                  onUpdate={handleUpdate}
                  onEmailClick={onEmailClick}
                  onSlackClick={onSlackClick}
                />
              </ListItem>
            ))}
          </List>
        </div>
      )}

      {/* Selected day's todos */}
      <div>
        <SectionHeader label={isViewingToday ? "Today" : formatDateLabel(groupAnchor)} count={todayTodos.length} scanning={scanning} />
        {todayTodos.length > 0 ? (
          <List
            gap="gap-0"
            className="[&>*+*]:-mt-px"
            reorderable
            onReorder={(ids) => void reorderTodos(ids)}
            renderDragOverlay={(id) => {
              const t = todayTodos.find((x) => x.id === id);
              return t ? (
                <TodoItemComponent
                  todo={t}
                  categories={categories}
                  disableSwipe
                  onComplete={() => {}}
                  onUncomplete={() => {}}
                  onDelete={() => {}}
                  onDateChange={() => {}}
                  onUpdate={() => {}}
                />
              ) : null;
            }}
          >
            {todayTodos.map((todo) => (
              <ListItem
                key={todo.id}
                itemId={todo.id}
                onSwipeLeft={() => deleteTodo(todo.id)}
                swipeLeftLabel="Delete"
                onSwipeRight={() => todo.status === "completed" ? uncompleteTodo(todo.id) : completeTodo(todo.id)}
                swipeRightLabel={todo.status === "completed" ? "Undo" : "Done"}
                rightSwipeVariant="complete"
                compactSwipe
                swipeBgClass="bg-background-100"
                swipeContainerClass={cn(
                  "rounded-xl border",
                  todo.status === "completed"
                    ? "border-transparent"
                    : "border-transparent hover:border-border-100/80 hover:shadow-sm",
                )}
              >
                <TodoItemComponent
                  todo={todo}
                  categories={categories}
                  disableSwipe
                  onComplete={completeTodo}
                  onUncomplete={uncompleteTodo}
                  onDelete={deleteTodo}
                  onDateChange={handleDateChange}
                  onUpdate={handleUpdate}
                  onEmailClick={onEmailClick}
                  onSlackClick={onSlackClick}
                  onOpenWorkspace={onOpenWorkspace}
                />
              </ListItem>
            ))}
          </List>
        ) : isViewingToday && isEmpty ? (
          scanning ? (
            <div className="flex items-center justify-center gap-2.5 rounded-xl border border-dashed border-blue-200/60 bg-blue-50/30 px-4 py-8 dark:border-blue-800/30 dark:bg-blue-950/10">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-500 dark:border-blue-800 dark:border-t-blue-400" />
              <span className="text-sm text-foreground-300">Scanning inbox...</span>
            </div>
          ) : lastScanResult && lastScanResult.suggested === 0 ? (
            <div className="rounded-xl border border-dashed border-green-200/60 bg-green-50/30 px-4 py-8 text-center dark:border-green-800/30 dark:bg-green-950/10">
              <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-600 dark:text-green-400">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="text-sm font-medium text-foreground-200">Inbox is clear</div>
              <p className="mt-0.5 text-xs text-foreground-300/70">
                Scanned {lastScanResult.emailsScanned} email{lastScanResult.emailsScanned !== 1 ? "s" : ""} — nothing needs your attention right now
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border-100 px-4 py-8 text-center">
              <div className="text-sm text-foreground-300">
                No to-dos yet
              </div>
              <p className="mt-1 text-xs text-foreground-300/70">
                Use the input above to add one, or chat with your inbox agent to discover tasks
              </p>
            </div>
          )
        ) : (
          <div className="rounded-xl border border-dashed border-border-100 px-4 py-6 text-center">
            <div className="text-sm text-foreground-300">
              Nothing scheduled{!isViewingToday ? ` for ${formatDateLabel(groupAnchor)}` : ""}
            </div>
            <p className="mt-1 text-xs text-foreground-300/70">
              Add a to-do below to get started
            </p>
          </div>
        )}

        {/* Inline add todo */}
        {addingTodo ? (
          <div className="mt-1.5 rounded-lg border border-border-100 bg-background-100 px-3 py-2">
            <div className="flex items-center gap-2">
              <TodoCheckbox variant="muted" className="mt-px shrink-0" />
              <SmartInput
                value={newTodoTitle}
                onChange={(text) => setNewTodoTitle(text)}
                onSubmit={(text, entities) => {
                  if (text.trim()) {
                    const cats = newTodoCategories.length > 0 ? newTodoCategories : undefined;
                    const sourceEmails = entitiesToSourceEmails(entities);
                    const todoEntities: TodoEntity[] = entities.map((e) => {
                      if (e.type === "person") return { type: "person", name: e.name, email: e.email };
                      if (e.type === "email") return { type: "email", id: e.id, threadId: e.threadId, subject: e.subject, from: e.from };
                      if (e.type === "category") return { type: "category", name: e.name };
                      return { type: "link", url: e.url };
                    });
                    void createTodo({
                      title: text.trim(),
                      scheduledDate: groupAnchor,
                      categories: cats,
                      sourceEmails: sourceEmails.length > 0 ? sourceEmails : undefined,
                      entities: todoEntities.length > 0 ? todoEntities : undefined,
                    }).then(() => {
                      setNewTodoTitle("");
                      setNewTodoCategories([]);
                      setAddingTodo(false);
                    });
                  }
                }}
                categories={categories}
                contacts={contacts}
                onSearchContacts={searchContacts}
                onSearchEmails={searchEmails}
                onCategoriesDetected={(cats) => setNewTodoCategories(cats)}
                placeholder="What needs to be done?"
                className="min-w-0 flex-1 text-sm text-foreground-100"
                autoFocus
              />
            </div>
            {categories.length > 0 && (
              <div className="mt-1.5 flex items-center gap-1 pl-[26px]">
                {categories.map((cat) => {
                  const color = getCategoryColor(cat, categories);
                  const isSelected = newTodoCategories.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() =>
                        setNewTodoCategories((prev) =>
                          prev.includes(cat)
                            ? prev.filter((c) => c !== cat)
                            : [...prev, cat],
                        )
                      }
                      className={cn(
                        "rounded px-2 py-0.5 text-[10px] font-medium transition-all",
                        isSelected
                          ? `${color.bg} ${color.text} ring-1 ring-current/25`
                          : "bg-foreground-100/5 text-foreground-300 hover:bg-foreground-100/10 hover:text-foreground-200",
                      )}
                      style={isSelected ? color.style : undefined}
                    >
                      {cat}
                    </button>
                  );
                })}
                {newTodoCategories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setNewTodoCategories([])}
                    className="ml-0.5 rounded p-0.5 text-foreground-300/50 transition-colors hover:text-foreground-300"
                    title="Clear categories"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setNewTodoCategories(lastUsedCategory ? [lastUsedCategory] : []);
              setAddingTodo(true);
            }}
            className="mt-1.5 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-foreground-300/60 transition-colors hover:bg-foreground-100/5 hover:text-foreground-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="text-xs">Add a to-do</span>
          </button>
        )}
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowUpcoming(!showUpcoming)}
            className="mb-2 flex w-full items-center gap-1.5 px-1"
          >
            <span className="text-xs font-medium uppercase tracking-widest text-foreground-300">
              Upcoming
            </span>
            <span className="text-[10px] text-foreground-300/70">
              ({upcoming.length})
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn("ml-auto text-foreground-300 transition-transform", showUpcoming && "rotate-180")}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <AnimatePresence initial={false}>
            {showUpcoming && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                <List gap="gap-0" className="[&>*+*]:-mt-px">
                  {upcoming.map((todo) => (
                    <ListItem
                      key={todo.id}
                      itemId={todo.id}
                    >
                      <TodoItemComponent
                        todo={todo}
                        categories={categories}
                        onComplete={completeTodo}
                        onUncomplete={uncompleteTodo}
                        onDelete={deleteTodo}
                        onDateChange={handleDateChange}
                        onUpdate={handleUpdate}
                        onEmailClick={onEmailClick}
                        onSlackClick={onSlackClick}
                        onOpenWorkspace={onOpenWorkspace}
                      />
                    </ListItem>
                  ))}
                </List>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Unscheduled */}
      {unscheduled.length > 0 && (
        <div>
          <SectionHeader label="No date" count={unscheduled.length} />
          <List gap="gap-0" className="[&>*+*]:-mt-px">
            {unscheduled.map((todo) => (
              <ListItem
                key={todo.id}
                itemId={todo.id}
                onSwipeLeft={() => deleteTodo(todo.id)}
                swipeLeftLabel="Delete"
                onSwipeRight={() => completeTodo(todo.id)}
                swipeRightLabel="Done"
                rightSwipeVariant="complete"
                compactSwipe
                swipeBgClass="bg-background-100"
                swipeContainerClass="rounded-xl border border-transparent hover:border-border-100/80 hover:shadow-sm"
              >
                <TodoItemComponent
                  todo={todo}
                  categories={categories}
                  disableSwipe
                  onComplete={completeTodo}
                  onUncomplete={uncompleteTodo}
                  onDelete={deleteTodo}
                  onDateChange={handleDateChange}
                  onUpdate={handleUpdate}
                  onEmailClick={onEmailClick}
                  onSlackClick={onSlackClick}
                  onOpenWorkspace={onOpenWorkspace}
                />
              </ListItem>
            ))}
          </List>
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowCompleted(!showCompleted)}
            className="mb-2 flex w-full items-center gap-1.5 px-1"
          >
            <span className="text-xs font-medium uppercase tracking-widest text-foreground-300">
              Completed
            </span>
            <span className="text-[10px] text-foreground-300/70">
              ({completed.length})
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn("ml-auto text-foreground-300 transition-transform", showCompleted && "rotate-180")}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <AnimatePresence initial={false}>
            {showCompleted && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                <List gap="gap-0" className="[&>*+*]:-mt-3">
                  {completed.map((todo) => (
                    <ListItem
                      key={todo.id}
                      itemId={todo.id}
                    >
                      <TodoItemComponent
                        todo={todo}
                        categories={categories}
                        onComplete={completeTodo}
                        onUncomplete={uncompleteTodo}
                        onDelete={deleteTodo}
                        onDateChange={handleDateChange}
                        onUpdate={handleUpdate}
                        onEmailClick={onEmailClick}
                        onSlackClick={onSlackClick}
                        onOpenWorkspace={onOpenWorkspace}
                      />
                    </ListItem>
                  ))}
                </List>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Calendar popover for specific todo */}
      <AnimatePresence>
        {showCalendar && calendarTodo && (
          <CalendarPopover
            todo={calendarTodo}
            todoDates={todoDates}
            onSelectDate={(date) => {
              handleDateChange(calendarTodo.id, date);
              setShowCalendar(false);
              setCalendarTodoId(null);
            }}
            onClose={() => { setShowCalendar(false); setCalendarTodoId(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CategoryBar({
  categories,
  onSave,
  onOpenWorkspace,
}: {
  categories: string[];
  onSave?: (categories: string[]) => Promise<void>;
  onOpenWorkspace?: (category: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const addCategory = () => {
    const trimmed = newName.trim();
    if (!trimmed || categories.includes(trimmed)) {
      setNewName("");
      return;
    }
    void onSave?.([...categories, trimmed]);
    setNewName("");
  };

  const handleReorder = useCallback((orderedIds: string[]) => {
    void onSave?.(orderedIds);
  }, [onSave]);

  const [atEnd, setAtEnd] = useState(true);
  const isMobile = useIsMobile();

  const addButton = (
    <div className="shrink-0">
      {adding ? (
        <input
          ref={inputRef}
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCategory();
            }
            if (e.key === "Escape") { setNewName(""); setAdding(false); }
          }}
          onBlur={() => {
            if (newName.trim()) addCategory();
            setAdding(false);
          }}
          placeholder={categories.length > 0 ? "New category..." : "e.g. Work, Personal..."}
          className="w-32 rounded border border-border-100 bg-background-100 px-2 py-0.5 text-[11px] text-foreground-100 outline-none placeholder:text-foreground-300/50 focus:border-accent-100/50"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={cn(
            "inline-flex shrink-0 whitespace-nowrap items-center gap-1 rounded border border-dashed px-2 py-0.5 text-[11px] transition-colors",
            categories.length === 0
              ? "border-foreground-300/30 text-foreground-300 hover:border-foreground-300/50 hover:text-foreground-200"
              : "border-border-100 text-foreground-300/50 hover:border-foreground-300/40 hover:text-foreground-300",
          )}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {categories.length === 0 ? "Add categories" : "Add"}
        </button>
      )}
    </div>
  );

  const categoryList = (
    <List
      gap="gap-1"
      direction="horizontal"
      className={isMobile ? "flex-nowrap" : "flex-wrap"}
      reorderable={!!onSave}
      onReorder={handleReorder}
      renderDragOverlay={(id) => {
        const color = getCategoryColor(id, categories);
        return (
          <div
            className={cn(
              "inline-flex items-center rounded-lg px-3.5 py-1.5 text-sm font-medium",
              color.bg, color.text,
            )}
            style={color.style}
          >
            {id}
          </div>
        );
      }}
    >
      {categories.map((cat) => {
        const color = getCategoryColor(cat, categories);
        return (
          <ListItem key={cat} itemId={cat} className="w-auto shrink-0 overflow-visible">
            <button
              type="button"
              onClick={() => onOpenWorkspace?.(cat)}
              className={cn(
                "inline-flex shrink-0 whitespace-nowrap items-center rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all",
                color.bg, color.text, "opacity-80 hover:opacity-100",
              )}
              style={color.style}
            >
              {cat}
            </button>
          </ListItem>
        );
      })}
    </List>
  );

  if (isMobile) {
    return (
      <div className="flex items-center gap-1.5">
        <ScrollFade className="min-w-0 flex-1" onAtEnd={setAtEnd}>
          {categoryList}
          {(atEnd || adding) && <div className="pl-1">{addButton}</div>}
        </ScrollFade>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        {categoryList}
      </div>
      <div className="ml-auto">{addButton}</div>
    </div>
  );
}

function SectionHeader({ label, count, icon, scanning, onRefresh, refreshing }: {
  label: string;
  count: number;
  icon?: React.ReactNode;
  scanning?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="group/section mb-2 flex items-center gap-1.5 px-1">
      {icon}
      <span className="text-xs font-medium uppercase tracking-widest text-foreground-300">
        {label}
      </span>
      {count > 0 && (
        <span className="text-[10px] text-foreground-300/70">
          ({count})
        </span>
      )}
      {scanning && !onRefresh && (
        <div className="h-3 w-3 animate-spin rounded-full border border-foreground-300/30 border-t-blue-500" />
      )}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh suggestions"
          className={cn(
            "ml-auto rounded p-0.5 transition-all",
            refreshing
              ? "text-blue-400"
              : "text-foreground-300/0 group-hover/section:text-foreground-300/50 hover:text-foreground-200!",
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(refreshing && "animate-spin")}
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      )}
    </div>
  );
}

function CalendarPopover({
  todo,
  todoDates,
  onSelectDate,
  onClose,
}: {
  todo: TodoItem;
  todoDates: string[];
  onSelectDate: (date: string | null) => void;
  onClose: () => void;
}) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -8 }}
        transition={{ type: "spring", stiffness: 400, damping: 35 }}
        className="relative z-50 rounded-xl border border-border-100 bg-background-100 p-3 shadow-xl"
      >
        <div className="mb-2 text-xs font-medium text-foreground-200">
          Schedule: {todo.title}
        </div>
        <TodoCalendar
          selectedDate={todo.scheduledDate}
          onSelectDate={onSelectDate}
          todoDates={todoDates}
        />
      </motion.div>
    </>
  );
}

function entitiesToSourceEmails(entities: SmartEntity[]): TodoEmailRef[] {
  return entities
    .filter((e): e is SmartEntity & { type: "email" } => e.type === "email")
    .map((e) => ({
      messageId: e.id,
      threadId: e.threadId,
      subject: e.subject,
      from: e.from ?? "",
      snippet: "",
      accountEmail: "",
    }));
}

/** Standalone toggle button for the header */
export function TodoToggleButton({ onClick, count }: { onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative rounded-lg px-2.5 py-1 text-xs font-medium text-foreground-200 transition-colors hover:bg-background-200 hover:text-foreground-100"
      title="To-dos"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      {count !== undefined && count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-bold text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}
