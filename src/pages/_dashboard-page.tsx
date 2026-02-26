import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { useNavStackContext } from "../components/nav-stack";
import {
  cn,
  useAccounts,
  useConversations,
  useIsMobile,
  useTodos,
  getCategoryColor,
  setCustomCategoryColors,
  type CategoryWorkspace as WorkspaceData,
  type ConversationSummary,
  type FeedItem,
  type TodoItem,
  type TodoSlackRef,
} from "../lib";
import { ProfileButton } from "../components/ui";
import { ThemeToggle } from "../components/ui/_theme-toggle";
import { SwipeableEmailRow } from "../components/ui/_swipeable-email-row";
import { EmailModal } from "../components/email/_email-modal";
import { EmailRow, groupByThread, type InboxEmail as EmailInboxEmail, type ThreadGroup } from "../components/email/_email-row";
import { setInboxCache } from "../components/email/_inbox-list";
import { SlackThreadModal } from "../components/email/_slack-thread-modal";
import { TodoItemComponent } from "../components/todo/_todo-item";

interface SlackThread {
  channelId: string;
  threadTs: string;
  channelName?: string;
  messages: { userId: string; userName: string; text: string; ts: string }[];
  receivedAt: string;
  processed: boolean;
}

function useInboxPreview() {
  const [emails, setEmails] = useState<EmailInboxEmail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/inbox?max=20", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { emails?: EmailInboxEmail[] };
        const fetched = data.emails ?? [];
        setEmails(fetched);
        setInboxCache(fetched);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  return { emails, loading };
}

function useSlackPreview() {
  const [threads, setThreads] = useState<SlackThread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/slack/threads", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { threads: SlackThread[] };
        setThreads(data.threads.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()).slice(0, 5));
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  return { threads, loading };
}

function useWorkspacePreviews(categories: string[]) {
  const [workspaces, setWorkspaces] = useState<Record<string, WorkspaceData>>({});

  useEffect(() => {
    if (categories.length === 0) return;
    const controller = new AbortController();
    for (const cat of categories) {
      void (async () => {
        try {
          const res = await fetch(`/api/workspace/${encodeURIComponent(cat)}`, { signal: controller.signal });
          if (!res.ok) return;
          const data = (await res.json()) as { workspace: WorkspaceData };
          if (data.workspace) {
            setWorkspaces((prev) => ({ ...prev, [cat]: data.workspace }));
          }
        } catch { /* ignore */ }
      })();
    }
    return () => controller.abort();
  }, [categories.join(",")]);

  return workspaces;
}

function parseSenderName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return from.split("@")[0];
}

function formatTodayHeading(): string {
  const d = new Date();
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${weekday} ${mm}.${dd}.${d.getFullYear()}`;
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "Just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getDayLabel(): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const target = today;
  if (target.getTime() === today.getTime()) return "Today";
  if (target.getTime() === tomorrow.getTime()) return "Tomorrow";
  return target.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

// ── Widget shell ──

function useNavLink(href: string, title?: string) {
  const navCtx = useNavStackContext();
  if (!navCtx) return { href, onClick: undefined };

  let screenId = href;
  const variant: "slide" | "cover" = "cover";
  if (href === "/todos" || href.startsWith("/todos?")) screenId = "todos";
  else if (href === "/inbox") screenId = "inbox";
  else if (href === "/projects") screenId = "projects";
  else if (href.startsWith("/projects/")) {
    const name = decodeURIComponent(href.replace(/^\/projects\//, ""));
    screenId = `project:${name}`;
  }
  else if (href === "/settings") screenId = "settings";
  else return { href, onClick: undefined };

  return {
    href: undefined,
    onClick: () => navCtx.push(screenId, { title: title ?? screenId, variant }),
  };
}

function NavLink({
  href,
  title,
  className,
  children,
}: {
  href: string;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const link = useNavLink(href, title);
  if (link.onClick) {
    return (
      <button type="button" onClick={link.onClick} className={cn(className, "text-left")}>
        {children}
      </button>
    );
  }
  return (
    <a href={link.href} className={className}>
      {children}
    </a>
  );
}

function WidgetCard({
  children,
  className,
  style,
  href,
  onClick,
  span = 2,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  href?: string;
  onClick?: () => void;
  span?: 1 | 2;
}) {
  const link = useNavLink(href ?? "", href);

  const base = cn(
    "rounded-xl p-3 text-left transition-colors duration-150",
    "hover:bg-foreground-100/3",
    span === 2 ? "col-span-2" : "col-span-1",
    className,
  );

  if (href && link.onClick) {
    return (
      <button type="button" onClick={link.onClick} className={cn(base, "w-full")} style={style}>
        {children}
      </button>
    );
  }

  if (href) {
    return (
      <a href={href} className={cn(base, "block no-underline")} style={style}>
        {children}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cn(base, "w-full")} style={style}>
      {children}
    </button>
  );
}

function WidgetHeader({
  icon,
  label,
  count,
  countColor,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  countColor?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-foreground-300/70">{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-widest text-foreground-300">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {count != null && count > 0 && (
          <span
            className={cn(
              "flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold text-white",
              countColor ?? "bg-accent-100",
            )}
          >
            {count}
          </span>
        )}
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/40">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </div>
  );
}

// ── Todo Widget ──

function EmailSparkleIcon() {
  return (
    <span className="relative inline-flex items-center justify-center text-foreground-300">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
      <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 16 16" fill="currentColor" className="absolute -right-1.5 -top-1.5 text-accent-100">
        <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z" />
      </svg>
    </span>
  );
}

function SuggestedTodoRow({
  todo,
  onAccept,
  onDismiss,
  onEmailClick,
}: {
  todo: TodoItem;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onEmailClick?: (threadId: string, accountEmail?: string) => void;
}) {
  const email = todo.sourceEmails[0];
  const sender = email ? parseSenderName(email.from) : undefined;

  return (
    <SwipeableEmailRow
      onArchive={() => onDismiss(todo.id)}
      archiveLabel="Dismiss"
      compact
      className="bg-background-100"
      containerClassName="rounded-xl"
    >
      <div className="group flex items-start gap-2 py-2.5 pl-2 pr-1">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium leading-snug text-foreground-100 lg:text-[13px]">
            {todo.title}
          </span>
          {sender && (
            <span className="mt-0.5 block truncate text-[11px] text-foreground-300/60 lg:text-[10px]">
              {sender}{email?.subject ? ` — ${email.subject}` : ""}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (email) onEmailClick?.(email.threadId, email.accountEmail);
          }}
          className="mt-0.5 flex shrink-0 items-center justify-center"
          title={email?.subject || "From email"}
        >
          <EmailSparkleIcon />
        </button>

        <button
          type="button"
          onClick={() => onAccept(todo.id)}
          className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-foreground-300/40 transition-colors hover:bg-accent-100/10 hover:text-accent-100"
          title="Add to to-dos"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      </div>
    </SwipeableEmailRow>
  );
}

function TodoWidget({
  todos,
  categories,
  onComplete,
  onUncomplete,
  onDelete,
  onDateChange,
  onUpdate,
  onCreate,
  onAcceptSuggestion,
  onDismissSuggestion,
  onEmailClick,
  onSlackClick,
}: {
  todos: TodoItem[];
  categories: string[];
  onComplete: (id: string) => void;
  onUncomplete: (id: string) => void;
  onDelete: (id: string) => void;
  onDateChange: (id: string, date: string | null) => void;
  onUpdate: (id: string, updates: Partial<Pick<TodoItem, "title" | "description" | "subtasks" | "categories">>) => void;
  onCreate: (title: string) => void;
  onAcceptSuggestion: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
  onEmailClick?: (threadId: string, accountEmail?: string) => void;
  onSlackClick?: (slackRef: TodoItem["sourceSlack"]) => void;
}) {
  const pending = useMemo(() => todos.filter((t) => t.status === "pending"), [todos]);
  const completed = useMemo(
    () => todos
      .filter((t) => t.status === "completed")
      .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime()),
    [todos],
  );
  const emailSuggestions = useMemo(
    () => todos.filter((t) => t.status === "suggested" && t.sourceEmails.length > 0),
    [todos],
  );
  const [visibleCount, setVisibleCount] = useState(6);
  const preview = pending.slice(0, visibleCount);
  const remaining = pending.length - visibleCount;
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [completedVisibleCount, setCompletedVisibleCount] = useState(6);
  const completedPreview = completed.slice(0, completedVisibleCount);
  const completedRemaining = completed.length - completedVisibleCount;

  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const handleSubmit = useCallback(() => {
    const trimmed = newTitle.trim();
    if (trimmed) {
      onCreate(trimmed);
      setNewTitle("");
    }
    setAdding(false);
  }, [newTitle, onCreate]);

  return (
    <div className="col-span-2">
      {/* Header with add button */}
      <div className="mb-1 flex items-center justify-between">
        <NavLink
          href="/todos"
          title="To-dos"
          className="-ml-2 flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground-100 transition-colors hover:bg-foreground-100/5"
        >
          {getDayLabel()}
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/40">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </NavLink>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="relative flex h-11 w-11 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200"
          aria-label="Add to-do"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Inline add input */}
      <AnimatePresence>
        {adding && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <form
              className="mb-2 flex items-center gap-2 rounded-lg bg-foreground-100/3 px-3 py-2"
              onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
            >
              <input
                ref={inputRef}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setNewTitle(""); setAdding(false); } }}
                onBlur={() => { if (!newTitle.trim()) setAdding(false); }}
                placeholder="What needs to be done?"
                className="flex-1 bg-transparent text-sm text-foreground-100 outline-none placeholder:text-foreground-300/40"
              />
              <button
                type="submit"
                disabled={!newTitle.trim()}
                className="rounded-md px-2 py-0.5 text-[12px] font-medium text-accent-100 transition-colors hover:bg-accent-100/10 disabled:opacity-30"
              >
                Add
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Suggested from email — inline at top */}
      {emailSuggestions.length > 0 && (
        <div className="-mx-1">
          <AnimatePresence initial={false}>
            {emailSuggestions.map((todo) => (
              <motion.div
                key={todo.id}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                <SuggestedTodoRow
                  todo={todo}
                  onAccept={onAcceptSuggestion}
                  onDismiss={onDismissSuggestion}
                  onEmailClick={onEmailClick}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Todo list — uses the full TodoItemComponent */}
      <div className="-mx-1">
        <AnimatePresence initial={false}>
          {preview.map((todo) => (
            <motion.div
              key={todo.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="overflow-hidden"
            >
              <TodoItemComponent
                todo={todo}
                categories={categories}
                hideTodayBadge
                hideDate
                compactView
                onComplete={onComplete}
                onUncomplete={onUncomplete}
                onDelete={onDelete}
                onDateChange={onDateChange}
                onUpdate={onUpdate}
                onEmailClick={onEmailClick}
                onSlackClick={onSlackClick}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {preview.length === 0 && completed.length === 0 && (
        <p className="py-4 text-center text-[13px] text-foreground-300/50">All clear</p>
      )}

      {/* See more */}
      {remaining > 0 ? (
        <button
          type="button"
          onClick={() => setVisibleCount((c) => c + 6)}
          className="mt-1 flex min-h-[44px] w-full items-center justify-center gap-1 rounded-lg text-[13px] font-medium text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200"
        >
          See more ({remaining})
        </button>
      ) : null}

      {/* Completed section */}
      {completed.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setCompletedExpanded((v) => !v)}
            className="-ml-2 flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200"
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
              className={cn(
                "text-foreground-300/40 transition-transform duration-200",
                completedExpanded && "rotate-90",
              )}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Completed
            <span className="ml-0.5 text-[12px] font-normal text-foreground-300/50">
              {completed.length}
            </span>
          </button>

          <AnimatePresence initial={false}>
            {completedExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                <div className="-mx-1">
                  {completedPreview.map((todo) => (
                    <TodoItemComponent
                      key={todo.id}
                      todo={todo}
                      categories={categories}
                      hideTodayBadge
                      hideDate
                      compactView
                      onComplete={onComplete}
                      onUncomplete={onUncomplete}
                      onDelete={onDelete}
                      onDateChange={onDateChange}
                      onUpdate={onUpdate}
                      onEmailClick={onEmailClick}
                      onSlackClick={onSlackClick}
                    />
                  ))}
                </div>
                {completedRemaining > 0 && (
                  <button
                    type="button"
                    onClick={() => setCompletedVisibleCount((c) => c + 6)}
                    className="mt-1 flex min-h-[44px] w-full items-center justify-center gap-1 rounded-lg text-[13px] font-medium text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200"
                  >
                    See more ({completedRemaining})
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ── Email Widget ──

// ── Mail Widget (real email rows) ──

function MailWidget({
  emails,
  onEmailClick,
  onArchive,
}: {
  emails: EmailInboxEmail[];
  onEmailClick: (thread: ThreadGroup) => void;
  onArchive: (thread: ThreadGroup) => void;
}) {
  const threads = useMemo(() => groupByThread(emails), [emails]);
  const [visibleCount, setVisibleCount] = useState(5);
  const visible = threads.slice(0, visibleCount);
  const remaining = threads.length - visibleCount;

  if (threads.length === 0) return null;

  return (
    <div className="col-span-2">
      {/* Header */}
      <div className="mb-1 flex items-center justify-between">
        <NavLink
          href="/inbox"
          title="Mail"
          className="-ml-2 flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground-100 transition-colors hover:bg-foreground-100/5"
        >
          Mail
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/40">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </NavLink>
      </div>

      {/* Email list */}
      <div className="-mx-1">
        <AnimatePresence initial={false}>
          {visible.map((thread) => (
            <SwipeableEmailRow
              key={thread.threadId}
              onArchive={() => onArchive(thread)}
              compact
              className="bg-background-100"
              containerClassName="rounded-xl"
              layoutAnimation={false}
            >
              <EmailRow
                thread={thread}
                compact
                onClick={onEmailClick}
              />
            </SwipeableEmailRow>
          ))}
        </AnimatePresence>
      </div>

      {/* See more */}
      {remaining > 0 ? (
        <button
          type="button"
          onClick={() => setVisibleCount((c) => c + 6)}
          className="mt-1 flex min-h-[44px] w-full items-center justify-center gap-1 rounded-lg text-[13px] font-medium text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200"
        >
          See more ({remaining})
        </button>
      ) : null}
    </div>
  );
}

// ── Project Cards ──

function projectRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function NewProjectButton({
  categories,
  onSaveCategories,
}: {
  categories: string[];
  onSaveCategories: (categories: string[]) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || categories.includes(trimmed)) {
      setName("");
      setAdding(false);
      return;
    }
    void onSaveCategories([...categories, trimmed]).then(() => {
      window.location.href = `/projects/${encodeURIComponent(trimmed)}`;
    });
  };

  if (adding) {
    return (
      <div className="flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit(); }
            if (e.key === "Escape") { setName(""); setAdding(false); }
          }}
          onBlur={() => {
            if (name.trim()) submit();
            else setAdding(false);
          }}
          placeholder="Project name..."
          className="w-32 rounded-lg bg-foreground-100/5 px-3 py-2 text-[13px] font-medium text-foreground-100 outline-none placeholder:text-foreground-300/30"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setAdding(true)}
      className="relative flex h-11 w-11 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200"
      aria-label="New project"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  );
}

function ProjectsSection({
  categories,
  allCategories,
  workspacePreviews,
  todos,
  onSaveCategories,
  onComplete,
  onUncomplete,
  onDelete,
  onDateChange,
  onUpdate,
  onEmailClick,
  onSlackClick,
}: {
  categories: string[];
  allCategories: string[];
  workspacePreviews: Record<string, WorkspaceData>;
  todos: TodoItem[];
  onSaveCategories: (categories: string[]) => Promise<void>;
  onComplete: (id: string) => void;
  onUncomplete: (id: string) => void;
  onDelete: (id: string) => void;
  onDateChange: (id: string, date: string | null) => void;
  onUpdate: (id: string, updates: Partial<Pick<TodoItem, "title" | "description" | "subtasks" | "categories">>) => void;
  onEmailClick?: (threadId: string, accountEmail?: string) => void;
  onSlackClick?: (slackRef: TodoItem["sourceSlack"]) => void;
}) {
  // Build unified recent feed across all projects
  const recentFeed = useMemo(() => {
    const entries: { item: FeedItem; project: string }[] = [];
    for (const cat of categories) {
      const ws = workspacePreviews[cat];
      if (!ws?.feed) continue;
      for (const item of ws.feed) {
        if (item.type === "file") continue;
        entries.push({ item, project: cat });
      }
    }
    entries.sort((a, b) =>
      new Date(b.item.createdAt).getTime() - new Date(a.item.createdAt).getTime(),
    );
    return entries.slice(0, 8);
  }, [categories, workspacePreviews]);

  // Pending tasks across all projects
  const pendingByProject = useMemo(() => {
    const groups: { project: string; todos: TodoItem[] }[] = [];
    for (const cat of categories) {
      const pending = todos.filter(
        (t) => t.status === "pending" && t.categories?.includes(cat),
      );
      if (pending.length > 0) groups.push({ project: cat, todos: pending.slice(0, 2) });
    }
    return groups;
  }, [categories, todos]);

  const hasContent = recentFeed.length > 0 || pendingByProject.length > 0;

  return (
    <div className="col-span-2 mt-4 overflow-hidden">
      {/* Section header — matches todo header style */}
      <div className="mb-1 flex items-center justify-between">
        <NavLink
          href="/projects"
          title="Projects"
          className="-ml-2 flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground-100 transition-colors hover:bg-foreground-100/5"
        >
          Projects
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/40">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </NavLink>
        <NewProjectButton
          categories={categories}
          onSaveCategories={onSaveCategories}
        />
      </div>

      {/* Project chips — quick navigation */}
      {categories.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {categories.map((cat) => {
            const color = getCategoryColor(cat, allCategories);
            return (
              <NavLink
                key={cat}
                href={`/projects/${encodeURIComponent(cat)}`}
                title={cat}
                className="inline-flex items-center gap-1.5 rounded-full bg-foreground-100/4 px-2.5 py-1 text-[12px] font-medium text-foreground-100 transition-colors hover:bg-foreground-100/8"
              >
                <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color.hex }} />
                {cat}
              </NavLink>
            );
          })}
        </div>
      )}

      {/* Pending tasks — grouped by project */}
      {pendingByProject.map(({ project, todos: projectTodos }) => (
        <div key={`tasks-${project}`} className="mb-2">
          <ProjectTagPill name={project} allCategories={allCategories} />
          <div className="-mx-1">
            {projectTodos.map((t) => (
              <TodoItemComponent
                key={t.id}
                todo={t}
                categories={allCategories}
                hideCategories
                hideTodayBadge
                hideDate
                compactView
                disableSwipe
                onComplete={onComplete}
                onUncomplete={onUncomplete}
                onDelete={onDelete}
                onDateChange={onDateChange}
                onUpdate={onUpdate}
                onEmailClick={onEmailClick}
                onSlackClick={onSlackClick}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Recent activity feed — unified across all projects */}
      {recentFeed.length > 0 && (
        <div className="divide-y divide-foreground-100/5">
          {recentFeed.map(({ item, project }) => (
            <div key={item.id} className="py-2">
              <div className="flex items-center justify-between mb-1">
                <ProjectTagPill name={project} allCategories={allCategories} />
                <span className="text-[10px] text-foreground-300/30">
                  {projectRelativeTime(item.createdAt)}
                </span>
              </div>
              <NavLink
                href={`/projects/${encodeURIComponent(project)}`}
                title={project}
                className="block"
              >
                {item.type === "note" && item.content && (
                  <p className="text-[14px] leading-relaxed text-foreground-100/70 line-clamp-2">
                    {item.content}
                  </p>
                )}
                {item.type === "image" && item.fileRef && (
                  <img
                    src={`/api/workspace/_/file/${encodeURIComponent(item.fileRef.key)}`}
                    alt=""
                    className="max-h-32 max-w-full rounded-lg bg-foreground-100/5 object-contain"
                    loading="lazy"
                  />
                )}
                {item.type === "link" && item.linkRef && (() => {
                  const ref = item.linkRef;
                  let hostname = ref.url;
                  try { hostname = new URL(ref.url).hostname; } catch { /* keep raw */ }
                  return (
                    <div className="flex items-center gap-2.5 rounded-lg bg-foreground-100/3 px-3 py-2">
                      <img
                        src={ref.favicon || `https://icons.duckduckgo.com/ip3/${hostname}.ico`}
                        alt=""
                        className="h-4 w-4 shrink-0 rounded-sm"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-foreground-200">
                        {ref.title || hostname}
                      </span>
                    </div>
                  );
                })()}
                {item.type === "email" && item.emailRef && (
                  <div className="flex items-center gap-2 text-[14px] text-foreground-200/60">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/40">
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                    <span className="truncate">{item.emailRef.subject}</span>
                  </div>
                )}
              </NavLink>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!hasContent && categories.length === 0 && (
        <p className="py-4 text-center text-[13px] text-foreground-300/40">
          No projects yet
        </p>
      )}
    </div>
  );
}

function ProjectTagPill({ name, allCategories }: { name: string; allCategories: string[] }) {
  const color = getCategoryColor(name, allCategories);
  return (
    <NavLink
      href={`/projects/${encodeURIComponent(name)}`}
      title={name}
      className="inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-foreground-300/50 transition-colors hover:text-foreground-300/80"
    >
      <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color.hex }} />
      {name}
    </NavLink>
  );
}

// ── Slack Widget ──

function SlackWidget({ threads }: { threads: SlackThread[] }) {
  if (threads.length === 0) return null;

  return (
    <WidgetCard href="/todos">
      <WidgetHeader
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z" />
          </svg>
        }
        label="Slack"
        count={threads.length}
        countColor="bg-[#4A154B]"
      />
      <ul className="space-y-2">
        {threads.slice(0, 3).map((t) => {
          const channel = t.channelName ? `#${t.channelName}` : "DM";
          const lastMsg = t.messages[t.messages.length - 1];
          const participants = [...new Set(t.messages.map((m) => m.userName))];
          return (
            <li key={`${t.channelId}:${t.threadTs}`} className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-foreground-100/60 shrink-0">{channel}</span>
                <span className="text-foreground-100/15 text-[10px]">&middot;</span>
                <span className="truncate text-[12px] text-foreground-200">
                  {participants.join(", ")}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-foreground-300/40">
                  {formatRelativeTime(t.receivedAt)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[12px] leading-snug text-foreground-300/60">
                {lastMsg?.text?.slice(0, 80) ?? ""}
              </p>
            </li>
          );
        })}
      </ul>
    </WidgetCard>
  );
}

// ── Chats Widget ──

function ChatsWidget({
  conversations,
  userId,
}: {
  conversations: ConversationSummary[];
  userId: string;
}) {
  const recent = conversations.slice(0, 4);

  return (
    <WidgetCard href="/todos?panel=chats">
      <WidgetHeader
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        }
        label="Chats"
        count={conversations.length || undefined}
      />
      {recent.length > 0 ? (
        <ul className="space-y-1.5">
          {recent.map((c) => (
            <li key={c.id} className="flex items-baseline gap-2">
              <span className="text-[13px] text-foreground-200 truncate line-clamp-1">
                {c.title}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-foreground-300/50">No conversations yet</p>
      )}
    </WidgetCard>
  );
}

// ── Settings / Profile row ──

function UtilityRow() {
  const settingsIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );

  return (
    <div className="col-span-2 mt-2 flex items-center justify-center gap-6 border-t border-foreground-100/6 pt-4">
      <NavLink
        href="/settings"
        title="Settings"
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-foreground-300 transition-colors hover:bg-foreground-100/3 hover:text-foreground-200"
      >
        {settingsIcon}
        Settings
      </NavLink>
      <a
        href="/internals"
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-foreground-300 transition-colors hover:bg-foreground-100/3 hover:text-foreground-200"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
        Internals
      </a>
      <ThemeToggle className="shrink-0 h-auto! w-auto! rounded-lg px-3 py-2 hover:bg-foreground-100/3" />
    </div>
  );
}

// ── Widget Carousel (iOS-style horizontal paging) ──

interface CarouselPageDef {
  id: string;
  label: string;
  content: React.ReactNode;
}

function DotIndicator({
  count,
  offsetX,
  pageWidth,
}: {
  count: number;
  offsetX: ReturnType<typeof useMotionValue<number>>;
  pageWidth: number;
}) {
  const progress = useTransform(offsetX, (ox) => {
    if (pageWidth === 0) return 0;
    return -ox / pageWidth;
  });

  return (
    <div className="pointer-events-none absolute bottom-3 left-0 right-0 flex items-center justify-center gap-2">
      {Array.from({ length: count }, (_, i) => (
        <CarouselDot key={i} index={i} progress={progress} />
      ))}
    </div>
  );
}

function CarouselDot({
  index,
  progress,
}: {
  index: number;
  progress: ReturnType<typeof useTransform<number, number>>;
}) {
  const width = useTransform(progress, (p) => {
    const dist = Math.abs(p - index);
    const t = Math.max(0, 1 - dist);
    return 6 + t * 14;
  });
  const opacity = useTransform(progress, (p) => {
    const dist = Math.abs(p - index);
    return 0.2 + Math.max(0, 1 - dist) * 0.8;
  });

  return (
    <motion.div
      className="h-[6px] rounded-full bg-foreground-100/20 backdrop-blur-md"
      style={{ width, opacity }}
    />
  );
}

function CarouselPageWrapper({
  page,
  index,
  offsetX,
  pageWidth,
}: {
  page: CarouselPageDef;
  index: number;
  offsetX: ReturnType<typeof useMotionValue<number>>;
  pageWidth: number;
}) {
  const scale = useTransform(offsetX, (ox) => {
    if (pageWidth === 0) return 1;
    const viewPos = -ox;
    const pageCenter = index * pageWidth;
    const dist = Math.abs(viewPos - pageCenter) / pageWidth;
    return 1 - Math.min(dist, 1) * 0.06;
  });

  const borderRadius = useTransform(offsetX, (ox) => {
    if (pageWidth === 0) return 0;
    const viewPos = -ox;
    const pageCenter = index * pageWidth;
    const dist = Math.abs(viewPos - pageCenter) / pageWidth;
    return Math.min(dist, 1) * 24;
  });

  const pageOpacity = useTransform(offsetX, (ox) => {
    if (pageWidth === 0) return 1;
    const viewPos = -ox;
    const pageCenter = index * pageWidth;
    const dist = Math.abs(viewPos - pageCenter) / pageWidth;
    return 1 - Math.min(dist, 1) * 0.15;
  });

  return (
    <motion.div
      className="h-full shrink-0 overflow-y-auto overscroll-contain px-2.5"
      style={{
        width: pageWidth || "100%",
        scale,
        borderRadius,
        opacity: pageOpacity,
      }}
    >
      <div className="pb-4">
        {page.content}
      </div>
    </motion.div>
  );
}

function WidgetCarousel({ pages }: { pages: CarouselPageDef[] }) {
  const offsetX = useMotionValue(0);
  const currentPageRef = useRef(0);
  const [currentPageLabel, setCurrentPageLabel] = useState(pages[0]?.label ?? "");
  const containerRef = useRef<HTMLDivElement>(null);
  const pageWidthRef = useRef(0);
  const [pageWidth, setPageWidth] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const w = containerRef.current.offsetWidth;
        pageWidthRef.current = w;
        setPageWidth(w);
        offsetX.set(-(currentPageRef.current * w));
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || pages.length <= 1) return;

    let startX = 0;
    let startY = 0;
    let decided = false;
    let isHorizontal = false;
    let startOffset = 0;
    let lastDx = 0;
    let lastTime = 0;
    let velocityX = 0;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      decided = false;
      isHorizontal = false;
      lastDx = 0;
      lastTime = Date.now();
      velocityX = 0;
      startOffset = offsetX.get();
      animate(offsetX, startOffset, { duration: 0 });
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!decided) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          decided = true;
          isHorizontal = Math.abs(dx) > Math.abs(dy);
          if (!isHorizontal) return;
        } else {
          return;
        }
      }

      if (!isHorizontal) return;
      e.preventDefault();

      const now = Date.now();
      const dt = now - lastTime;
      if (dt > 0) velocityX = ((dx - lastDx) / dt) * 1000;
      lastDx = dx;
      lastTime = now;

      const pw = pageWidthRef.current;
      const maxOffset = 0;
      const minOffset = -((pages.length - 1) * pw);
      let newOffset = startOffset + dx;

      if (newOffset > maxOffset) {
        newOffset = maxOffset + (newOffset - maxOffset) * 0.25;
      } else if (newOffset < minOffset) {
        newOffset = minOffset + (newOffset - minOffset) * 0.25;
      }

      offsetX.set(newOffset);
    };

    const onTouchEnd = () => {
      if (!decided || !isHorizontal) return;
      const pw = pageWidthRef.current;
      if (pw === 0) return;

      const current = offsetX.get();
      const rawPage = -current / pw;
      let targetPage = currentPageRef.current;

      if (Math.abs(velocityX) > 500) {
        targetPage = velocityX < 0
          ? Math.min(currentPageRef.current + 1, pages.length - 1)
          : Math.max(currentPageRef.current - 1, 0);
      } else {
        targetPage = Math.round(rawPage);
        targetPage = Math.max(0, Math.min(targetPage, pages.length - 1));
      }

      currentPageRef.current = targetPage;
      setCurrentPageLabel(pages[targetPage]?.label ?? "");
      animate(offsetX, -(targetPage * pw), {
        type: "spring",
        stiffness: 300,
        damping: 35,
      });
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [pages.length, offsetX]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Page label */}
      <div className="px-4 pb-1">
        <AnimatePresence mode="wait">
          <motion.span
            key={currentPageLabel}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="block text-[11px] font-medium uppercase tracking-widest text-foreground-300/50"
          >
            {currentPageLabel}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Carousel track */}
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
        <motion.div
          className="flex h-full"
          style={{ x: offsetX }}
        >
          {pages.map((page, i) => (
            <CarouselPageWrapper
              key={page.id}
              page={page}
              index={i}
              offsetX={offsetX}
              pageWidth={pageWidth}
            />
          ))}
        </motion.div>
      </div>

      {/* Dot indicators */}
      <DotIndicator
        count={pages.length}
        offsetX={offsetX}
        pageWidth={pageWidth}
      />
    </div>
  );
}

// ── Dashboard Page ──

interface DashboardPageProps {
  userId: string;
}

export default function DashboardPage({ userId }: DashboardPageProps) {
  const accounts = useAccounts();
  const todoState = useTodos();
  const conv = useConversations({ userId });
  const inbox = useInboxPreview();
  const slack = useSlackPreview();
  const isMobile = useIsMobile();

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedAccountEmail, setSelectedAccountEmail] = useState<string | undefined>(undefined);
  const [slackModalRef, setSlackModalRef] = useState<TodoSlackRef[] | null>(null);

  useEffect(() => {
    setCustomCategoryColors(todoState.preferences.categoryColors ?? {});
  }, [todoState.preferences.categoryColors]);

  const categories = todoState.preferences.todoCategories ?? [];
  const workspacePreviews = useWorkspacePreviews(categories);

  const lastActivity = useMemo(() => {
    const timestamps: string[] = [];
    for (const t of todoState.todos) {
      if (t.completedAt) timestamps.push(t.completedAt);
      if (t.createdAt) timestamps.push(t.createdAt);
    }
    for (const e of inbox.emails) {
      if (e.date) timestamps.push(e.date);
    }
    for (const t of slack.threads) {
      if (t.receivedAt) timestamps.push(t.receivedAt);
    }
    if (timestamps.length === 0) return null;
    timestamps.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    return timestamps[0];
  }, [todoState.todos, inbox.emails, slack.threads]);

  const todoWidget = (
    <TodoWidget
      todos={todoState.todos}
      categories={categories}
      onComplete={(id) => void todoState.completeTodo(id)}
      onUncomplete={(id) => void todoState.uncompleteTodo(id)}
      onDelete={(id) => void todoState.deleteTodo(id)}
      onDateChange={(id, date) => void todoState.updateTodo(id, { scheduledDate: date })}
      onUpdate={(id, updates) => void todoState.updateTodo(id, updates)}
      onCreate={(title) => void todoState.createTodo({ title })}
      onAcceptSuggestion={(id) => void todoState.acceptSuggestion(id)}
      onDismissSuggestion={(id) => void todoState.declineSuggestion(id)}
      onEmailClick={(threadId, accountEmail) => {
        setSelectedThreadId(threadId);
        setSelectedAccountEmail(accountEmail);
      }}
      onSlackClick={(slackRef) => {
        setSlackModalRef(slackRef ?? null);
      }}
    />
  );

  const mailWidget = !inbox.loading ? (
    <MailWidget
      emails={inbox.emails}
      onEmailClick={(thread) => {
        setSelectedThreadId(thread.threadId);
        setSelectedAccountEmail(thread.representative.accountEmail);
      }}
      onArchive={(thread) => {
        void fetch(`/api/inbox/archive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadIds: [thread.threadId],
            accountEmail: thread.representative.accountEmail,
          }),
        });
      }}
    />
  ) : null;

  const projectsWidget = (
    <ProjectsSection
      categories={categories}
      allCategories={categories}
      workspacePreviews={workspacePreviews}
      todos={todoState.todos}
      onSaveCategories={todoState.saveCategories}
      onComplete={(id) => void todoState.completeTodo(id)}
      onUncomplete={(id) => void todoState.uncompleteTodo(id)}
      onDelete={(id) => void todoState.deleteTodo(id)}
      onDateChange={(id, date) => void todoState.updateTodo(id, { scheduledDate: date })}
      onUpdate={(id, updates) => void todoState.updateTodo(id, updates)}
      onEmailClick={(threadId, accountEmail) => {
        setSelectedThreadId(threadId);
        setSelectedAccountEmail(accountEmail);
      }}
      onSlackClick={(slackRef) => {
        setSlackModalRef(slackRef ?? null);
      }}
    />
  );

  const slackWidget = !slack.loading && slack.threads.length > 0
    ? <SlackWidget threads={slack.threads} />
    : null;
  const chatsWidget = <ChatsWidget conversations={conv.sortedActive} userId={userId} />;

  const allSections: Record<string, { label: string; content: React.ReactNode | null }> = {
    todos: { label: "Todos", content: todoWidget },
    mail: { label: "Mail", content: mailWidget },
    projects: { label: "Projects", content: projectsWidget },
    slack: { label: "Slack", content: slackWidget },
    chats: { label: "Chats", content: chatsWidget },
  };

  const savedOrder = todoState.preferences.dashboardSectionOrder;
  const sectionOrder = savedOrder?.length
    ? [...savedOrder, ...Object.keys(allSections).filter((id) => !savedOrder.includes(id))]
    : ["todos", "mail", "projects", "slack", "chats"];

  const carouselPages: CarouselPageDef[] = sectionOrder
    .filter((id) => allSections[id]?.content != null)
    .map((id) => ({ id, label: allSections[id].label, content: allSections[id].content! }));

  const orderedDesktopWidgets = sectionOrder
    .filter((id) => allSections[id]?.content != null)
    .map((id) => <React.Fragment key={id}>{allSections[id].content}</React.Fragment>);

  return (
    <div className={cn("h-dvh bg-background-100 text-foreground-100", isMobile ? "flex flex-col" : "overflow-y-auto")}>
      {/* Header */}
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 pt-8 pb-2 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground-100">
            {formatTodayHeading()}
          </h1>
          <div className="mt-0.5 flex items-center gap-2">
            {lastActivity && (
              <p className="flex items-center gap-1.5 text-[13px] text-foreground-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-100 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-100" />
                </span>
                Updated {formatRelativeTime(lastActivity)}
              </p>
            )}
          </div>
        </div>
        <ProfileButton accounts={accounts.accounts} />
      </header>

      {/* Mobile: swipeable carousel */}
      {isMobile ? (
        <WidgetCarousel pages={carouselPages} />
      ) : (
        /* Desktop: vertical grid */
        <motion.main
          className="mx-auto w-full max-w-2xl px-2.5 py-6 pb-16 sm:px-4"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <div className="grid grid-cols-2 gap-2">
            {orderedDesktopWidgets}
            <UtilityRow />
          </div>
        </motion.main>
      )}

      <EmailModal
        open={!!selectedThreadId}
        threadId={selectedThreadId ?? ""}
        accountEmail={selectedAccountEmail}
        pushed={false}
        onDismiss={() => { setSelectedThreadId(null); setSelectedAccountEmail(undefined); }}
        onChatAbout={() => {}}
      />

      <SlackThreadModal
        open={!!slackModalRef}
        slackRef={slackModalRef?.[0] ?? null}
        onDismiss={() => setSlackModalRef(null)}
      />
    </div>
  );
}
