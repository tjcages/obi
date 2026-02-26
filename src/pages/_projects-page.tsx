import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  cn,
  useTodos,
  getCategoryColor,
  type CategoryWorkspace as WorkspaceData,
  type FeedItem,
  type TodoItem,
} from "../lib";
import { useNavStackContext } from "../components/nav-stack";
import { TodoItemComponent } from "../components/todo/_todo-item";

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

// ── Unified feed item with project attribution ──

interface UnifiedFeedEntry {
  item: FeedItem;
  project: string;
}

interface TodoGroup {
  project: string;
  todos: TodoItem[];
  totalPending: number;
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = today.getTime() - target.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function formatDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// ── Project tag pill ──

function ProjectTag({ name, allCategories }: { name: string; allCategories: string[] }) {
  const color = getCategoryColor(name, allCategories);
  return (
    <a
      href={`/projects/${encodeURIComponent(name)}`}
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-foreground-300/60 transition-colors hover:bg-foreground-100/5 hover:text-foreground-300"
    >
      <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color.hex }} />
      {name}
    </a>
  );
}

// ── Individual feed entry in the timeline ──

function FeedEntry({
  entry,
  allCategories,
}: {
  entry: UnifiedFeedEntry;
  allCategories: string[];
}) {
  const { item, project } = entry;

  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1.5">
        <ProjectTag name={project} allCategories={allCategories} />
        <span className="text-[10px] text-foreground-300/30">{formatTime(item.createdAt)}</span>
      </div>
      <a
        href={`/projects/${encodeURIComponent(project)}`}
        className="block rounded-xl px-1 -mx-1 transition-colors hover:bg-foreground-100/2 active:bg-foreground-100/3"
      >
        {item.type === "note" && item.content && (
          <p className="text-[15px] leading-relaxed text-foreground-100/80 whitespace-pre-line">
            {item.content}
          </p>
        )}
        {item.type === "image" && item.fileRef && (
          <img
            src={`/api/workspace/_/file/${encodeURIComponent(item.fileRef.key)}`}
            alt=""
            className="max-h-64 rounded-xl bg-foreground-100/5 object-contain"
            loading="lazy"
          />
        )}
        {item.type === "link" && item.linkRef && (
          <LinkCard linkRef={item.linkRef} />
        )}
        {item.type === "email" && item.emailRef && (
          <div className="flex items-center gap-2.5 py-1 text-[15px] text-foreground-200/70">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/40">
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            <span className="truncate">{item.emailRef.subject}</span>
          </div>
        )}
      </a>
    </div>
  );
}

function LinkCard({ linkRef }: { linkRef: FeedItem["linkRef"] }) {
  if (!linkRef) return null;
  let hostname = linkRef.url;
  try { hostname = new URL(linkRef.url).hostname; } catch { /* keep raw */ }
  const faviconSrc = linkRef.favicon || `https://icons.duckduckgo.com/ip3/${hostname}.ico`;

  return (
    <div className="flex items-center gap-3 rounded-xl bg-foreground-100/3 px-3.5 py-3">
      <img
        src={faviconSrc}
        alt=""
        className="h-5 w-5 shrink-0 rounded-md"
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] text-foreground-100">
          {linkRef.title || hostname}
        </div>
        <div className="truncate text-[11px] text-foreground-300/40">
          {hostname}
        </div>
      </div>
    </div>
  );
}

// ── Todo group within the feed ──

function TodoGroupEntry({
  group,
  allCategories,
  onComplete,
  onUncomplete,
  onDelete,
  onDateChange,
  onUpdate,
}: {
  group: TodoGroup;
  allCategories: string[];
  onComplete: (id: string) => void;
  onUncomplete: (id: string) => void;
  onDelete: (id: string) => void;
  onDateChange: (id: string, date: string | null) => void;
  onUpdate: (id: string, updates: Partial<Pick<TodoItem, "title" | "description" | "subtasks" | "categories">>) => void;
}) {
  return (
    <div className="py-2">
      <div className="mb-1.5">
        <ProjectTag name={group.project} allCategories={allCategories} />
      </div>
      <div className="-mx-1">
        {group.todos.map((t) => (
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
          />
        ))}
        {group.totalPending > group.todos.length && (
          <a
            href={`/projects/${encodeURIComponent(group.project)}`}
            className="ml-1 text-[12px] text-foreground-300/30 hover:text-foreground-300/50 transition-colors"
          >
            +{group.totalPending - group.todos.length} more tasks
          </a>
        )}
      </div>
    </div>
  );
}

// ── Main page ──

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function ProjectsPage(_props: { userId: string }) {
  const navCtx = useNavStackContext();
  const todoState = useTodos();
  const categories = todoState.preferences.todoCategories ?? [];
  const workspacePreviews = useWorkspacePreviews(categories);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const submitNew = () => {
    const trimmed = newName.trim();
    if (!trimmed || categories.includes(trimmed)) {
      setNewName("");
      setAdding(false);
      return;
    }
    void todoState.saveCategories([...categories, trimmed]).then(() => {
      window.location.href = `/projects/${encodeURIComponent(trimmed)}`;
    });
  };

  // Build unified timeline: all feed items from all projects, sorted by date
  const timeline = useMemo(() => {
    const allEntries: UnifiedFeedEntry[] = [];

    for (const cat of categories) {
      const ws = workspacePreviews[cat];
      if (!ws?.feed) continue;
      for (const item of ws.feed) {
        if (item.type === "file") continue;
        allEntries.push({ item, project: cat });
      }
    }

    allEntries.sort((a, b) =>
      new Date(b.item.createdAt).getTime() - new Date(a.item.createdAt).getTime(),
    );

    // Group by date
    type TimelineSection = {
      dateLabel: string;
      dateKey: string;
      entries: UnifiedFeedEntry[];
    };

    const sections: TimelineSection[] = [];
    let currentKey = "";

    for (const entry of allEntries) {
      const key = formatDateKey(entry.item.createdAt);
      if (key !== currentKey) {
        currentKey = key;
        sections.push({
          dateLabel: formatDateLabel(entry.item.createdAt),
          dateKey: key,
          entries: [],
        });
      }
      sections[sections.length - 1].entries.push(entry);
    }

    return sections;
  }, [categories, workspacePreviews]);

  // Build todo groups per project (shown once at top)
  const todoGroups = useMemo(() => {
    const groups: TodoGroup[] = [];
    for (const cat of categories) {
      const pending = todoState.todos.filter(
        (t) => t.status === "pending" && t.categories?.includes(cat),
      );
      if (pending.length === 0) continue;
      groups.push({
        project: cat,
        todos: pending.slice(0, 3),
        totalPending: pending.length,
      });
    }
    return groups;
  }, [categories, todoState.todos]);

  const hasAnyContent = timeline.length > 0 || todoGroups.length > 0;

  return (
    <div className={cn("overflow-y-auto bg-background-100 text-foreground-100", navCtx ? "h-full" : "h-dvh")}>
      {/* Header */}
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 pt-8 pb-2 sm:px-6">
        <div className="flex items-center gap-2">
          {navCtx ? (
            <button
              type="button"
              onClick={() => navCtx.pop()}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200"
              aria-label="Back"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          ) : (
            <a
              href="/"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200"
              aria-label="Back"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </a>
          )}
          <h1 className="text-xl font-semibold text-foreground-100">Projects</h1>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200"
          aria-label="New project"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </header>

      {/* New project inline input */}
      {adding && (
        <div className="mx-auto w-full max-w-2xl px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-foreground-300/20 px-5 py-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground-100/5">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/40">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); submitNew(); }
                if (e.key === "Escape") { setNewName(""); setAdding(false); }
              }}
              onBlur={() => {
                if (newName.trim()) submitNew();
                else setAdding(false);
              }}
              placeholder="New project name..."
              className="min-w-0 flex-1 bg-transparent text-[17px] font-medium text-foreground-100 outline-none placeholder:text-foreground-300/30"
            />
          </div>
        </div>
      )}

      {/* Project chips — quick navigation */}
      {categories.length > 0 && (
        <div className="mx-auto w-full max-w-2xl px-4 pt-3 pb-1 sm:px-6">
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat) => {
              const color = getCategoryColor(cat, categories);
              return (
                <a
                  key={cat}
                  href={`/projects/${encodeURIComponent(cat)}`}
                  className="inline-flex items-center gap-2 rounded-full bg-foreground-100/4 px-3 py-1.5 text-[13px] font-medium text-foreground-100 transition-colors hover:bg-foreground-100/8 active:bg-foreground-100/10"
                >
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color.hex }} />
                  {cat}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Unified feed */}
      <motion.main
        className="mx-auto w-full max-w-2xl px-4 py-4 pb-16 sm:px-6"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {/* Pending tasks across all projects */}
        {todoGroups.length > 0 && (
          <div className="mb-4 space-y-1">
            {todoGroups.map((group) => (
              <TodoGroupEntry
                key={group.project}
                group={group}
                allCategories={categories}
                onComplete={(id) => void todoState.completeTodo(id)}
                onUncomplete={(id) => void todoState.uncompleteTodo(id)}
                onDelete={(id) => void todoState.deleteTodo(id)}
                onDateChange={(id, date) => void todoState.updateTodo(id, { scheduledDate: date })}
                onUpdate={(id, updates) => void todoState.updateTodo(id, updates)}
              />
            ))}
          </div>
        )}

        {/* Chronological feed grouped by date */}
        {timeline.map((section) => (
          <div key={section.dateKey}>
            <div className="sticky top-0 z-10 -mx-4 px-4 py-2 sm:-mx-6 sm:px-6">
              <span className="text-[11px] font-medium text-foreground-300/30">
                {section.dateLabel}
              </span>
            </div>
            <div className="divide-y divide-foreground-100/5">
              {section.entries.map((entry) => (
                <FeedEntry
                  key={entry.item.id}
                  entry={entry}
                  allCategories={categories}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Empty state */}
        {!hasAnyContent && categories.length > 0 && !adding && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-[15px] text-foreground-300/50">No activity yet across your projects</p>
            <p className="mt-1 text-[13px] text-foreground-300/30">
              Add notes, links, and tasks to your projects to see them here
            </p>
          </div>
        )}

        {categories.length === 0 && !adding && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-[15px] text-foreground-300/50">No projects yet</p>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-3 rounded-lg bg-foreground-100/5 px-4 py-2 text-[14px] font-medium text-foreground-200 transition-colors hover:bg-foreground-100/8"
            >
              Create your first project
            </button>
          </div>
        )}
      </motion.main>
    </div>
  );
}
