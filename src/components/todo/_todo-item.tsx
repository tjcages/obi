import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { cn, getCategoryColor, getMonoCategoryColor, getMonoCategories, subscribeMonoCategories, useSmartInput } from "../../lib";
import type { TodoItem as TodoItemType, SubTask } from "../../lib";
import { SmartInput, SmartText, type SmartEntity } from "../smart-input";
import { ScrollFade } from "../ui";
import { SwipeableEmailRow } from "../ui/_swipeable-email-row";

export function localISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  const [yr, mo, dy] = iso.split("-").map(Number);
  const target = new Date(yr, mo - 1, dy);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const tomorrow = new Date(today.getTime() + 86400000);

  if (target.getTime() === today.getTime()) return "Today";
  if (target.getTime() === tomorrow.getTime()) return "Tomorrow";
  if (target.getTime() === yesterday.getTime()) return "Yesterday";

  const diff = target.getTime() - today.getTime();
  const days = Math.round(diff / 86400000);
  if (days > 0 && days <= 6) {
    return target.toLocaleDateString("en-US", { weekday: "short" });
  }
  return target.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function parseSenderName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : from.split("@")[0];
}

function generateSubtaskId(): string {
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

interface TodoItemProps {
  todo: TodoItemType;
  categories?: string[];
  hideCategories?: boolean;
  /** Start with the title in editing mode */
  initialEditingTitle?: boolean;
  /** When true, skip the internal SwipeableEmailRow wrapper (swipe handled externally by ListItem). */
  disableSwipe?: boolean;
  onComplete: (id: string) => void;
  onUncomplete: (id: string) => void;
  onDelete: (id: string) => void;
  onDateChange: (id: string, date: string | null) => void;
  onUpdate: (id: string, updates: Partial<Pick<TodoItemType, "title" | "description" | "subtasks" | "categories">>) => void;
  onEmailClick?: (threadId: string, accountEmail?: string) => void;
  onSlackClick?: (slackRef: TodoItemType["sourceSlack"]) => void;
  onOpenWorkspace?: (category: string) => void;
}

export function TodoItemComponent({
  todo,
  categories: availableCategories = [],
  hideCategories = false,
  initialEditingTitle = false,
  disableSwipe = false,
  onComplete,
  onUncomplete,
  onDelete,
  onDateChange,
  onUpdate,
  onEmailClick,
  onSlackClick,
  onOpenWorkspace,
}: TodoItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(initialEditingTitle);
  const [titleDraft, setTitleDraft] = useState(todo.title);
  const isCompleted = todo.status === "completed";
  const monoCategories = useSyncExternalStore(subscribeMonoCategories, getMonoCategories, () => false);
  const { contacts, searchContacts, searchEmails } = useSmartInput();
  const subtasks = todo.subtasks ?? [];
  const completedSubtasks = subtasks.filter((s) => s.completed).length;
  const hasSubtasks = subtasks.length > 0;
  const todoCategories = todo.categories ?? [];
  const titleCommittedRef = useRef(false);

  useEffect(() => {
    if (editingTitle) titleCommittedRef.current = false;
  }, [editingTitle]);

  const commitTitle = useCallback((text?: string) => {
    if (titleCommittedRef.current) return;
    titleCommittedRef.current = true;
    const trimmed = (text ?? titleDraft).trim();
    if (trimmed && trimmed !== todo.title) {
      onUpdate(todo.id, { title: trimmed });
    } else if (!trimmed && !todo.title) {
      onDelete(todo.id);
    } else {
      setTitleDraft(todo.title);
    }
    setEditingTitle(false);
  }, [titleDraft, todo.id, todo.title, onUpdate, onDelete]);

  const handleTitleSmartChange = useCallback((text: string, entities: SmartEntity[]) => {
    setTitleDraft(text);
    const detectedCats = entities
      .filter((e): e is SmartEntity & { type: "category" } => e.type === "category")
      .map((e) => e.name);
    if (detectedCats.length > 0) {
      const current = todo.categories ?? [];
      const newCats = [...new Set([...current, ...detectedCats])];
      if (newCats.length !== current.length) {
        onUpdate(todo.id, { categories: newCats });
      }
    }
  }, [todo.id, todo.categories, onUpdate]);

  const toggleSubtask = useCallback(
    (subtaskId: string) => {
      const updated = subtasks.map((s) =>
        s.id === subtaskId ? { ...s, completed: !s.completed } : s,
      );
      onUpdate(todo.id, { subtasks: updated });
    },
    [todo.id, subtasks, onUpdate],
  );

  const addSubtask = useCallback(
    (title: string) => {
      const newSub: SubTask = { id: generateSubtaskId(), title, completed: false };
      onUpdate(todo.id, { subtasks: [...subtasks, newSub] });
    },
    [todo.id, subtasks, onUpdate],
  );

  const deleteSubtask = useCallback(
    (subtaskId: string) => {
      onUpdate(todo.id, { subtasks: subtasks.filter((s) => s.id !== subtaskId) });
    },
    [todo.id, subtasks, onUpdate],
  );

  const saveDescription = useCallback(
    (desc: string) => {
      onUpdate(todo.id, { description: desc || undefined });
    },
    [todo.id, onUpdate],
  );

  const toggleCategory = useCallback(
    (cat: string) => {
      const current = todo.categories ?? [];
      const next = current.includes(cat)
        ? current.filter((c) => c !== cat)
        : [...current, cat];
      onUpdate(todo.id, { categories: next.length > 0 ? next : undefined });
    },
    [todo.id, todo.categories, onUpdate],
  );

  const containerCls = cn(
    "rounded-xl ring",
    isCompleted
      ? "ring-transparent"
      : "ring-transparent hover:ring-border-100/80",
  );

  const innerContent = (
    <div className="group relative bg-background-100">
      <div className="flex gap-1 lg:pl-1 lg:pr-2.5 items-start">
        {/* Checkbox with touch-friendly hit area */}
        <button
          type="button"
          onClick={() => isCompleted ? onUncomplete(todo.id) : onComplete(todo.id)}
          className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <span
            className={cn(
              "flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 transition-all",
              isCompleted
                ? "border-green-400 bg-green-400 dark:border-green-500 dark:bg-green-500"
                : "border-foreground-300 hover:border-blue-400",
            )}
          >
            {isCompleted && (
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
        </button>

        {/* Content */}
        <div className="min-w-0 pt-2 flex-1">
          <div className="flex flex-col lg:flex-row lg:items-start lg:gap-2">
            {/* Title row — on mobile: title only; on desktop: categories + title inline */}
            <div className="flex min-w-0 flex-1 items-center gap-1 lg:flex-wrap lg:items-start">
              {/* Categories inline on desktop only */}
              {!hideCategories && todoCategories.map((cat) => {
                const color = monoCategories ? getMonoCategoryColor() : getCategoryColor(cat, availableCategories);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpenWorkspace?.(cat); }}
                    className={cn(
                      "hidden lg:inline-flex mr-1 shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-[22px] transition-opacity",
                      color.bg, color.text,
                      onOpenWorkspace && "hover:opacity-80 cursor-pointer",
                    )}
                    style={monoCategories ? undefined : color.style}
                  >
                    {cat}
                  </button>
                );
              })}
              {editingTitle && !isCompleted ? (
                <SmartInput
                  value={titleDraft}
                  onChange={handleTitleSmartChange}
                  onSubmit={(text) => commitTitle(text)}
                  onBlur={() => commitTitle()}
                  categories={availableCategories}
                  contacts={contacts}
                  onSearchContacts={searchContacts}
                  onSearchEmails={searchEmails}
                  autoFocus
                  className="min-w-0 flex-1 text-sm font-medium leading-[22px] text-foreground-100"
                />
              ) : (
                <TitleButton
                  isCompleted={isCompleted}
                  onSingleClick={() => setExpanded(!expanded)}
                  onDoubleClick={() => {
                    setTitleDraft(todo.title);
                    setEditingTitle(true);
                  }}
                >
                  <SmartText
                    text={todo.title}
                    categories={todo.categories}
                    allCategories={availableCategories}
                    entities={todo.entities}
                    className={cn(
                      "text-sm font-medium leading-[22px]",
                      isCompleted
                        ? "text-foreground-300 line-through"
                        : "text-foreground-100",
                    )}
                  />
                </TitleButton>
              )}
            </div>

            {/* Meta row — on mobile: categories first, then email/date badges; on desktop: just badges */}
            <ScrollFade className="flex shrink-0 items-center gap-1 lg:items-start lg:gap-1">
              {/* Categories on mobile only */}
              {!hideCategories && todoCategories.map((cat) => {
                const color = monoCategories ? getMonoCategoryColor() : getCategoryColor(cat, availableCategories);
                return (
                  <button
                    key={`m-${cat}`}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpenWorkspace?.(cat); }}
                    className={cn(
                      "inline-flex lg:hidden shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-[22px] transition-opacity",
                      color.bg, color.text,
                      onOpenWorkspace && "hover:opacity-80 cursor-pointer",
                    )}
                    style={monoCategories ? undefined : color.style}
                  >
                    {cat}
                  </button>
                );
              })}
              {todo.sourceEmails.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const email = todo.sourceEmails[0];
                    onEmailClick?.(email.threadId, email.accountEmail);
                  }}
                  className="inline-flex items-center gap-1 rounded bg-foreground-100/6 px-1.5 py-0.5 text-[11px] text-foreground-300 transition-colors hover:bg-foreground-100/10 hover:text-foreground-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <span className="max-w-[140px] truncate">
                    {parseSenderName(todo.sourceEmails[0].from)}
                  </span>
                </button>
              )}
              {todo.sourceSlack && todo.sourceSlack.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSlackClick?.(todo.sourceSlack);
                  }}
                  className="inline-flex items-center gap-1 rounded bg-[#4A154B]/8 px-1.5 py-0.5 text-[11px] text-[#4A154B] transition-colors hover:bg-[#4A154B]/15 dark:bg-[#4A154B]/20 dark:text-[#E8B4E9] dark:hover:bg-[#4A154B]/30"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z" />
                  </svg>
                  <span className="max-w-[140px] truncate">
                    {todo.sourceSlack[0].channelName ? `#${todo.sourceSlack[0].channelName}` : "Slack"}
                  </span>
                </button>
              )}
              {!isCompleted && todo.scheduledDate && (
                <DateQuickPicker
                  currentDate={todo.scheduledDate}
                  onSelect={(date) => onDateChange(todo.id, date)}
                  showAsDate
                  dateLabel={formatDate(todo.scheduledDate)}
                  isOverdue={isOverdue(todo.scheduledDate)}
                  muted={!isOverdue(todo.scheduledDate)}
                />
              )}
              <div className="flex max-w-0 items-center gap-1 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:ml-1 group-hover:max-w-24 group-hover:opacity-100">
                {!isCompleted && !todo.scheduledDate && (
                  <DateQuickPicker
                    currentDate={todo.scheduledDate}
                    onSelect={(date) => onDateChange(todo.id, date)}
                  />
                )}
                <button
                  type="button"
                  onClick={() => onDelete(todo.id)}
                  className="rounded-md p-1 text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
                  title="Archive"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="5" rx="1" />
                    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
                    <path d="M10 12h4" />
                  </svg>
                </button>
              </div>
            </ScrollFade>
          </div>

          {/* Inline metadata: subtask progress, AI badge, description preview */}
          {(hasSubtasks || (todo.agentSuggested && todo.userResponse === "accepted" && todo.sourceEmails.length === 0 && (!todo.sourceSlack || todo.sourceSlack.length === 0)) || (todo.description && !expanded)) && (
            <div className="mt-0.5 pb-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              {hasSubtasks && (
                <span className="inline-flex items-center gap-1 text-[11px] text-foreground-300">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 11 12 14 22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                  {completedSubtasks}/{subtasks.length}
                </span>
              )}
              {todo.agentSuggested && todo.userResponse === "accepted" && todo.sourceEmails.length === 0 && (!todo.sourceSlack || todo.sourceSlack.length === 0) && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-500 dark:bg-purple-950/30 dark:text-purple-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z" />
                  </svg>
                  AI
                </span>
              )}
              {todo.description && !expanded && (
                <span className="truncate text-[11px] text-foreground-300">
                  {todo.description}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Expanded detail: description + subtasks */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border-100 px-2 pb-2 pt-2 lg:px-3">
              {/* Category selector */}
              {availableCategories.length > 0 && !isCompleted && (
                <div className="mb-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {availableCategories.map((cat) => {
                      const color = monoCategories ? getMonoCategoryColor() : getCategoryColor(cat, availableCategories);
                      const isActive = todoCategories.includes(cat);
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => toggleCategory(cat)}
                          className={cn(
                            "rounded px-2 py-0.5 text-[10px] font-medium transition-all",
                            isActive
                              ? `${color.bg} ${color.text} ring-1 ring-current/25`
                              : "bg-foreground-100/5 text-foreground-300 hover:bg-foreground-100/10 hover:text-foreground-200",
                          )}
                          style={isActive && !monoCategories ? color.style : undefined}
                        >
                          {cat}
                        </button>
                      );
                    })}
                    {todoCategories.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onUpdate(todo.id, { categories: undefined })}
                        className="rounded-full p-0.5 text-foreground-300/40 transition-colors hover:text-foreground-300"
                        title="Clear categories"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Editable description */}
              <DescriptionEditor
                value={todo.description ?? ""}
                onSave={saveDescription}
                disabled={isCompleted}
              />

              {/* Subtasks */}
              <div className="mt-2">
                {subtasks.map((sub) => (
                  <SubtaskRow
                    key={sub.id}
                    subtask={sub}
                    onToggle={() => toggleSubtask(sub.id)}
                    onDelete={() => deleteSubtask(sub.id)}
                    disabled={isCompleted}
                  />
                ))}
                {!isCompleted && (
                  <AddSubtaskInput onAdd={addSubtask} />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );

  if (disableSwipe) {
    return <div className={containerCls}>{innerContent}</div>;
  }

  return (
    <SwipeableEmailRow
      onArchive={() => onDelete(todo.id)}
      onReply={() => isCompleted ? onUncomplete(todo.id) : onComplete(todo.id)}
      archiveLabel="Delete"
      replyLabel={isCompleted ? "Undo" : "Done"}
      rightSwipeVariant="complete"
      compact
      className="bg-background-100"
      containerClassName={containerCls}
      layoutAnimation={false}
    >
      {innerContent}
    </SwipeableEmailRow>
  );
}

/* ─── Description Editor ─── */

function DescriptionEditor({
  value,
  onSave,
  disabled,
}: {
  value: string;
  onSave: (desc: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const { contacts, searchContacts, searchEmails } = useSmartInput();

  const commit = useCallback((text?: string) => {
    const trimmed = (text ?? draft).trim();
    if (trimmed !== value) onSave(trimmed);
    setEditing(false);
  }, [draft, value, onSave]);

  if (disabled) {
    return value ? (
      <p className="text-xs leading-relaxed text-foreground-300">{value}</p>
    ) : null;
  }

  return (
    <div
      className={cn(
        "w-full rounded-md px-2 py-1 text-left text-xs transition-colors",
        editing
          ? "bg-background-200/40"
          : value
            ? "cursor-text text-foreground-200 hover:bg-background-200/60"
            : "cursor-text text-foreground-300 hover:bg-background-200/60",
      )}
      onClick={() => { if (!editing) { setDraft(value); setEditing(true); } }}
    >
      {editing ? (
        <SmartInput
          value={draft}
          onChange={(text) => setDraft(text)}
          onSubmit={(text) => commit(text)}
          multiline
          contacts={contacts}
          onSearchContacts={searchContacts}
          onSearchEmails={searchEmails}
          autoFocus
          placeholder="Add a description..."
          className="text-foreground-100"
        />
      ) : (
        <span>{value || "Add a description..."}</span>
      )}
    </div>
  );
}

/* ─── Subtask Row ─── */

function SubtaskRow({
  subtask,
  onToggle,
  onDelete,
  disabled,
}: {
  subtask: SubTask;
  onToggle: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="group/sub flex items-center gap-0.5 py-0.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex h-8 w-8 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            "flex h-3.5 w-3.5 items-center justify-center rounded border transition-all",
            subtask.completed
              ? "border-green-400 bg-green-400 dark:border-green-500 dark:bg-green-500"
              : "border-foreground-300 hover:border-blue-400",
            disabled && "opacity-50",
          )}
        >
          {subtask.completed && (
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
      </button>
      <span className={cn(
        "flex-1 text-xs",
        subtask.completed ? "text-foreground-300 line-through" : "text-foreground-200",
      )}>
        {subtask.title}
      </span>
      {!disabled && (
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-0.5 text-foreground-300 opacity-0 transition-opacity hover:text-foreground-200 group-hover/sub:opacity-100"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ─── Add Subtask Input ─── */

function AddSubtaskInput({ onAdd }: { onAdd: (title: string) => void }) {
  const [active, setActive] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active && inputRef.current) inputRef.current.focus();
  }, [active]);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onAdd(trimmed);
      setValue("");
    } else {
      setActive(false);
    }
  };

  if (!active) {
    return (
      <button
        type="button"
        onClick={() => setActive(true)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-foreground-300 transition-colors hover:bg-background-200/60 hover:text-foreground-200"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add subtask
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-foreground-300">
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          if (e.key === "Escape") { setValue(""); setActive(false); }
        }}
        className="flex-1 bg-transparent text-xs text-foreground-100 outline-none placeholder:text-foreground-300"
        placeholder="Subtask title..."
      />
    </div>
  );
}

/* ─── Title Button (distinguishes single vs double click) ─── */

const DOUBLE_CLICK_MS = 200;

function TitleButton({
  isCompleted,
  onSingleClick,
  onDoubleClick,
  children,
}: {
  isCompleted: boolean;
  onSingleClick: () => void;
  onDoubleClick: () => void;
  children: React.ReactNode;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (!isCompleted) onDoubleClick();
    } else {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onSingleClick();
      }, DOUBLE_CLICK_MS);
    }
  }, [isCompleted, onSingleClick, onDoubleClick]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <button type="button" onClick={handleClick} className="min-w-0 flex-1 text-left">
      {children}
    </button>
  );
}

/* ─── Helpers ─── */

function isOverdue(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  return target < today;
}

export function DateQuickPicker({
  currentDate,
  onSelect,
  showAsDate = false,
  dateLabel,
  isOverdue: overdue = false,
  muted = false,
  size = "default",
}: {
  currentDate: string | null;
  onSelect: (date: string | null) => void;
  showAsDate?: boolean;
  dateLabel?: string;
  isOverdue?: boolean;
  muted?: boolean;
  size?: "default" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const [showCal, setShowCal] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - 160),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setOpen(false);
        setShowCal(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); setShowCal(false); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const now = new Date();
  const todayStr = localISODate(now);
  const tomorrowStr = localISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const nextWeekStr = localISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));

  function handleCalSelect(date: Date | undefined) {
    if (date) onSelect(localISODate(date));
    setOpen(false);
    setShowCal(false);
  }

  const selectedAsDate = currentDate ? (() => {
    const [y, m, d] = currentDate.split("-").map(Number);
    return new Date(y, m - 1, d);
  })() : undefined;

  const isLg = size === "lg";
  const iconSize = isLg ? 15 : showAsDate ? 10 : 13;

  return (
    <div ref={triggerRef}>
      {showAsDate && dateLabel ? (
        <button
          type="button"
          onClick={() => { setOpen(!open); setShowCal(false); }}
          className={cn(
            "inline-flex items-center font-medium transition-colors",
            isLg
              ? "gap-1.5 rounded-[9px] px-3 py-1.5 text-[14px]"
              : "gap-1 rounded-md px-1.5 py-0.5 text-[11px]",
            muted
              ? "bg-foreground-100/5 text-foreground-300 hover:bg-foreground-100/10 hover:text-foreground-200"
              : overdue
                ? "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
                : "bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:hover:bg-blue-950/50",
          )}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {dateLabel}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { setOpen(!open); setShowCal(false); }}
          className={cn(
            "text-foreground-300 transition-colors hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-950/30 dark:hover:text-blue-400",
            isLg ? "rounded-[9px] p-2" : "rounded-md p-1",
          )}
          title="Set date"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
      )}

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed"
          style={{ top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999 }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.12 }}
            className="flex items-start"
          >
            <div className="w-40 rounded-lg border border-border-100 bg-background-100 py-1 shadow-lg">
              {[
                { label: "Today", value: todayStr },
                { label: "Tomorrow", value: tomorrowStr },
                { label: "Next week", value: nextWeekStr },
              ].map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { onSelect(value); setOpen(false); setShowCal(false); }}
                  className={cn(
                    "flex w-full items-center px-3 py-1.5 text-xs transition-colors hover:bg-background-200",
                    currentDate === value ? "font-medium text-blue-600 dark:text-blue-400" : "text-foreground-200",
                  )}
                >
                  {label}
                  {currentDate === value && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ml-auto text-blue-500">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}

              <div className="my-1 border-t border-border-100" />

              <button
                type="button"
                onClick={() => setShowCal(!showCal)}
                className={cn(
                  "flex w-full items-center gap-1.5 px-3 py-1.5 text-xs transition-colors hover:bg-background-200",
                  showCal ? "font-medium text-blue-600 dark:text-blue-400" : "text-foreground-200",
                )}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                Pick a date…
              </button>

              {currentDate && (
                <>
                  <div className="my-1 border-t border-border-100" />
                  <button
                    type="button"
                    onClick={() => { onSelect(null); setOpen(false); setShowCal(false); }}
                    className="flex w-full items-center px-3 py-1.5 text-xs text-foreground-300 transition-colors hover:bg-background-200"
                  >
                    Remove date
                  </button>
                </>
              )}
            </div>

            <AnimatePresence>
              {showCal && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="ml-1 origin-left"
                >
                  <div className="rounded-lg border border-border-100 bg-background-100 p-2 shadow-lg">
                    <div className="rdp-theme">
                      <DayPicker
                        mode="single"
                        selected={selectedAsDate}
                        onSelect={handleCalSelect}
                        defaultMonth={selectedAsDate ?? now}
                        showOutsideDays
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>,
        document.body,
      )}
    </div>
  );
}
