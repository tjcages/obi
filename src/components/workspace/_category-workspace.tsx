import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn, getCategoryColor } from "../../lib";
import type { FeedItem, TodoEntity, TodoItem, UseWorkspaceReturn } from "../../lib";
import { FeedComposer } from "./_feed-composer";
import { FeedItemRenderer, PostedImageGallery } from "./_feed-item";
import { CategorySettings, type DefaultMode } from "./_category-settings";
import { TodoItemComponent } from "../todo/_todo-item";
import { List, ListItem } from "../ui";

const IMAGE_CLUSTER_MS = 2 * 60 * 1000;
const DRAFT_TODO_ID = "__draft__";
const TODOS_GROUP_KEY = "__todos_group__";
const IMAGE_BREAK = "__brk__";

type TimelineEntry =
  | { kind: "todos"; key: string }
  | { kind: "feed"; item: FeedItem; key: string }
  | { kind: "images"; items: FeedItem[]; key: string };

interface CategoryWorkspaceProps {
  category: string;
  allCategories: string[];
  onBack: () => void;
  onEmailClick?: (threadId: string, accountEmail?: string) => void;
  workspace: UseWorkspaceReturn;
  todos?: TodoItem[];
  onCompleteTodo?: (id: string) => Promise<void>;
  onUncompleteTodo?: (id: string) => Promise<void>;
  onDeleteTodo?: (id: string) => void;
  onUpdateTodo?: (id: string, updates: Partial<Pick<TodoItem, "title" | "description" | "subtasks" | "categories" | "scheduledDate">>) => Promise<void>;
  onCreateTodo?: (params: { title: string; categories?: string[]; entities?: TodoEntity[] }) => void;
  onReorderTodos?: (orderedIds: string[]) => Promise<void>;
  onStartChat?: (title: string, prompt: string) => void;
  onRenameCategory?: (oldName: string, newName: string) => void;
  onChangeCustomColor?: (category: string, hex: string | null) => void;
  onDeleteCategory?: (category: string) => void;
  customCategoryColors?: Record<string, string>;
}

export function CategoryWorkspace({
  category,
  allCategories,
  onBack,
  onEmailClick,
  workspace: ws,
  todos = [],
  onCompleteTodo,
  onUncompleteTodo,
  onDeleteTodo,
  onUpdateTodo,
  onCreateTodo,
  onReorderTodos,
  onStartChat,
  onRenameCategory,
  onChangeCustomColor,
  onDeleteCategory,
  customCategoryColors,
}: CategoryWorkspaceProps) {
  const color = getCategoryColor(category, allCategories);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const [defaultMode, setDefaultMode] = useState<DefaultMode>("todo");
  const description = ws.workspace?.description;

  const [showCompleted, setShowCompleted] = useState(false);
  const [draftTodo, setDraftTodo] = useState<TodoItem | null>(null);

  const categoryTodos = useMemo(
    () => todos.filter(
      (t) => t.categories?.includes(category) && t.status !== "archived",
    ),
    [todos, category],
  );

  const pendingTodos = useMemo(
    () => {
      const base = categoryTodos.filter((t) => t.status === "pending" || t.status === "suggested");
      if (draftTodo) return [draftTodo, ...base];
      return base;
    },
    [categoryTodos, draftTodo],
  );

  const completedTodos = useMemo(
    () => categoryTodos.filter((t) => t.status === "completed"),
    [categoryTodos],
  );

  const feed = ws.workspace?.feed ?? [];

  const fileItems = useMemo(() => feed.filter((i) => i.type === "file"), [feed]);
  const linkItems = useMemo(() => feed.filter((i) => i.type === "link"), [feed]);
  const timelineFeed = useMemo(() => feed.filter((i) => i.type !== "file" && i.type !== "link"), [feed]);
  const hasFiles = fileItems.length > 0;
  const hasLinks = linkItems.length > 0;
  const isEmpty = timelineFeed.length === 0 && categoryTodos.length === 0 && !hasFiles && !hasLinks;

  const pinnedFeed = useMemo(
    () => timelineFeed.filter((f) => f.pinned),
    [timelineFeed],
  );

  const unpinnedFeed = useMemo(
    () => timelineFeed.filter((f) => !f.pinned),
    [timelineFeed],
  );

  type PinnedEntry =
    | { kind: "feed"; item: FeedItem; key: string }
    | { kind: "images"; items: FeedItem[]; key: string };

  const pinnedEntries = useMemo(() => {
    if (pinnedFeed.length === 0) return [] as PinnedEntry[];

    const customOrder = ws.workspace?.timelineOrder;
    const entries: PinnedEntry[] = [];
    let imageCluster: FeedItem[] = [];

    const flushImages = () => {
      if (imageCluster.length === 0) return;
      entries.push({ kind: "images", items: [...imageCluster], key: `pinned-imgs-${imageCluster[0].id}` });
      imageCluster = [];
    };

    if (customOrder && customOrder.length > 0) {
      const pinnedMap = new Map(pinnedFeed.map((f) => [f.id, f]));
      const seen = new Set<string>();

      for (const id of customOrder) {
        if (id === IMAGE_BREAK) {
          flushImages();
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        const item = pinnedMap.get(id);
        if (!item) {
          flushImages();
          continue;
        }
        if (item.type === "image") {
          imageCluster.push(item);
        } else {
          flushImages();
          entries.push({ kind: "feed", item, key: item.id });
        }
      }

      for (const item of pinnedFeed) {
        if (seen.has(item.id)) continue;
        if (item.type === "image") {
          imageCluster.push(item);
        } else {
          flushImages();
          entries.push({ kind: "feed", item, key: item.id });
        }
      }
      flushImages();
    } else {
      const sorted = [...pinnedFeed].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      let lastImageTs = 0;

      for (const item of sorted) {
        if (item.type === "image") {
          const ts = new Date(item.createdAt).getTime();
          if (imageCluster.length > 0 && Math.abs(ts - lastImageTs) > IMAGE_CLUSTER_MS) {
            flushImages();
          }
          imageCluster.push(item);
          lastImageTs = ts;
        } else {
          flushImages();
          entries.push({ kind: "feed", item, key: item.id });
        }
      }
      flushImages();
    }

    return entries;
  }, [pinnedFeed, ws.workspace?.timelineOrder]);

  const hasTodos = pendingTodos.length > 0 || completedTodos.length > 0 || !!onCreateTodo;

  const timeline = useMemo(() => {
    const feedItems = [...unpinnedFeed];
    const customOrder = ws.workspace?.timelineOrder;

    type OrderedItem = { kind: "feed"; item: FeedItem } | { kind: "todos" } | { kind: "break" };

    const orderedItems: OrderedItem[] = [];

    if (customOrder && customOrder.length > 0) {
      const feedMap = new Map(feedItems.map((f) => [f.id, f]));
      const seen = new Set<string>();
      let todosPlaced = false;

      for (const id of customOrder) {
        if (id === IMAGE_BREAK) {
          orderedItems.push({ kind: "break" });
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        if (id === TODOS_GROUP_KEY) {
          if (hasTodos) { orderedItems.push({ kind: "todos" }); todosPlaced = true; }
          continue;
        }
        const f = feedMap.get(id);
        if (f) orderedItems.push({ kind: "feed", item: f });
      }
      for (const f of feedItems) {
        if (!seen.has(f.id)) orderedItems.unshift({ kind: "feed", item: f });
      }
      if (hasTodos && !todosPlaced) {
        orderedItems.unshift({ kind: "todos" });
      }
    } else {
      feedItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (hasTodos) orderedItems.push({ kind: "todos" });
      orderedItems.push(...feedItems.map((item) => ({ kind: "feed" as const, item })));
    }

    const entries: TimelineEntry[] = [];
    let imageCluster: FeedItem[] = [];
    let lastImageTs = 0;

    const flushImages = () => {
      if (imageCluster.length === 0) return;
      entries.push({ kind: "images", items: [...imageCluster], key: `images-${imageCluster[0].id}` });
      imageCluster = [];
      lastImageTs = 0;
    };

    for (const item of orderedItems) {
      if (item.kind === "break") {
        flushImages();
      } else if (item.kind === "todos") {
        flushImages();
        entries.push({ kind: "todos", key: TODOS_GROUP_KEY });
      } else if (item.item.type === "image") {
        const ts = new Date(item.item.createdAt).getTime();
        if (!customOrder && imageCluster.length > 0 && Math.abs(ts - lastImageTs) > IMAGE_CLUSTER_MS) {
          flushImages();
        }
        imageCluster.push(item.item);
        lastImageTs = ts;
      } else {
        flushImages();
        entries.push({ kind: "feed", item: item.item, key: item.item.id });
      }
    }
    flushImages();

    return entries;
  }, [unpinnedFeed, ws.workspace?.timelineOrder, hasTodos]);

  const handleReorder = useCallback(
    (orderedKeys: string[]) => {
      const currentOrder = ws.workspace?.timelineOrder ?? [];
      const expandedIds: string[] = [];

      const breakAfterIds = new Set<string>();
      for (let i = 0; i < currentOrder.length; i++) {
        if (currentOrder[i] === IMAGE_BREAK) {
          for (let j = i - 1; j >= 0; j--) {
            if (currentOrder[j] !== IMAGE_BREAK) { breakAfterIds.add(currentOrder[j]); break; }
          }
        }
      }

      for (const key of orderedKeys) {
        if (key === TODOS_GROUP_KEY) {
          expandedIds.push(TODOS_GROUP_KEY);
          continue;
        }
        const entry = timeline.find((e) => e.key === key);
        if (entry?.kind === "images") {
          for (const img of entry.items) expandedIds.push(img.id);
          const lastId = entry.items[entry.items.length - 1].id;
          if (breakAfterIds.has(lastId)) expandedIds.push(IMAGE_BREAK);
        } else if (entry) {
          expandedIds.push(key);
        }
      }

      while (expandedIds.length > 0 && expandedIds[expandedIds.length - 1] === IMAGE_BREAK) {
        expandedIds.pop();
      }

      void ws.reorderTimeline(expandedIds);
    },
    [timeline, ws.reorderTimeline, ws.workspace?.timelineOrder],
  );

  const handleExtractImage = useCallback(
    (imageId: string, clusterIds: string[], direction: "above" | "below") => {
      const currentOrder = [...(ws.workspace?.timelineOrder ?? [])];
      if (currentOrder.length === 0) return;

      const imgIdx = currentOrder.indexOf(imageId);
      if (imgIdx < 0) return;

      currentOrder.splice(imgIdx, 1);

      const remaining = clusterIds.filter((id) => id !== imageId);
      if (remaining.length === 0) return;

      if (direction === "above") {
        const anchorIdx = currentOrder.indexOf(remaining[0]);
        if (anchorIdx >= 0) {
          currentOrder.splice(anchorIdx, 0, imageId, IMAGE_BREAK);
        }
      } else {
        const anchorIdx = currentOrder.indexOf(remaining[remaining.length - 1]);
        if (anchorIdx >= 0) {
          currentOrder.splice(anchorIdx + 1, 0, IMAGE_BREAK, imageId);
        }
      }

      void ws.reorderTimeline(currentOrder);
    },
    [ws.workspace?.timelineOrder, ws.reorderTimeline],
  );

  const renderFeedDragOverlay = useCallback(
    (id: string) => {
      const entry = timeline.find((e) => e.key === id);
      if (!entry || entry.kind === "todos") return null;
      if (entry.kind === "images") {
        return <PostedImageGallery items={entry.items} onDelete={async () => {}} />;
      }
      return (
        <FeedItemRenderer
          item={entry.item}
          onUpdate={async () => {}}
          onDelete={async () => {}}
        />
      );
    },
    [timeline],
  );

  return (
    <div className="relative pt-4 pb-16">
      {/* Accent gradient glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] opacity-[0.07]"
        style={{
          background: `radial-gradient(ellipse 80% 50% at 50% -20%, ${color.hex} 0%, transparent 70%)`,
        }}
      />

      {/* Header */}
      <div className="mb-2">
        <div className="flex items-center justify-between">
          <span className={cn("rounded px-2.5 py-1 text-sm font-semibold", color.bg, color.text)} style={color.style}>
            {category}
          </span>
          <button
            ref={settingsBtnRef}
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              settingsOpen
                ? "bg-foreground-100/10 text-foreground-100"
                : "text-foreground-300/40 hover:text-foreground-300",
            )}
            title="Category settings"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>

        {/* Description (read-only, editable via settings) */}
        {description && (
          <p className="mt-1.5 text-sm text-foreground-300">{description}</p>
        )}
      </div>

      {/* Settings popover */}
      <CategorySettings
        open={settingsOpen}
        category={category}
        allCategories={allCategories}
        description={description}
        defaultMode={defaultMode}
        customHex={customCategoryColors?.[category]}
        anchorRef={settingsBtnRef}
        onClose={() => setSettingsOpen(false)}
        onRename={(oldName, newName) => {
          onRenameCategory?.(oldName, newName);
          setSettingsOpen(false);
        }}
        onChangeCustomColor={(cat, hex) => onChangeCustomColor?.(cat, hex)}
        onChangeDescription={(desc) => void ws.updateDescription(desc)}
        onChangeDefaultMode={setDefaultMode}
        onDelete={(cat) => {
          onDeleteCategory?.(cat);
          onBack();
        }}
      />

      {/* Composer */}
      <FeedComposer
        category={category}
        allCategories={allCategories}
        defaultMode={defaultMode}
        onAddNote={ws.addNote}
        onAddLink={ws.addLink}
        onUploadFile={ws.uploadFile}
        onCreateTodo={onCreateTodo}
        onStartChat={onStartChat}
      />

      {/* Workspace stats caption */}
      {ws.workspace && !isEmpty && (
        <WorkspaceStats
          feed={feed}
          todoCount={categoryTodos.length}
          updatedAt={ws.workspace.updatedAt}
          createdAt={ws.workspace.createdAt}
        />
      )}

      {/* Resources: inline collapsible on mobile, fixed sidebar on desktop */}
      {(hasFiles || hasLinks) && (
        <>
          <div className="lg:hidden">
            <InlineResources
              fileItems={fileItems}
              linkItems={linkItems}
              onDelete={ws.deleteItem}
            />
          </div>
          <div className="hidden lg:block">
            <ResourcesSidebar
              fileItems={fileItems}
              linkItems={linkItems}
              onDelete={ws.deleteItem}
            />
          </div>
        </>
      )}

      {/* Main feed — reorderable timeline */}
      <div className="mt-4">
        {ws.loading && !ws.workspace ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-100 border-t-blue-500" />
          </div>
        ) : isEmpty && completedTodos.length === 0 ? (
          <div className="mt-8 px-4 py-12 text-center">
            <div className="text-sm text-foreground-300/60">No activity yet</div>
            <p className="mt-1 text-xs text-foreground-300/40">
              Write a note, drop files, or add to-dos with this category
            </p>
          </div>
        ) : (
          <>
            {/* Pinned items — always at top, outside reorderable list */}
            {pinnedEntries.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {pinnedEntries.map((entry) => {
                  if (entry.kind === "images") {
                    return (
                      <PostedImageGallery
                        key={entry.key}
                        items={entry.items}
                        onDelete={ws.deleteItem}
                        onUpdate={ws.updateItem}
                      />
                    );
                  }
                  return (
                    <FeedItemRenderer
                      key={entry.key}
                      item={entry.item}
                      onUpdate={ws.updateItem}
                      onDelete={ws.deleteItem}
                      onEmailClick={onEmailClick}
                      categoryColor={color}
                    />
                  );
                })}
              </div>
            )}

            {/* Unified feed — todos group is static, other items are draggable */}
            {timeline.length > 0 && (
              <List
                gap="gap-1.5"
                className="mt-3"
                reorderable
                onReorder={handleReorder}
                renderDragOverlay={renderFeedDragOverlay}
              >
                {timeline.map((entry) => {
                  if (entry.kind === "todos") {
                    return (
                      <ListItem key={TODOS_GROUP_KEY} itemId={TODOS_GROUP_KEY} static className="my-6">
                        <List
                          gap="gap-0"
                          className="[&>*+*]:-mt-px"
                          reorderable={!!onReorderTodos}
                          onReorder={(ids) => void onReorderTodos?.(ids)}
                          renderDragOverlay={(id) => {
                            const t = pendingTodos.find((x) => x.id === id);
                            return t ? (
                              <TodoItemComponent
                                todo={t}
                                categories={allCategories}
                                hideCategories
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
                          {pendingTodos.map((todo) => (
                            <ListItem
                              key={todo.id}
                              itemId={todo.id}
                              onSwipeLeft={() => {
                                if (todo.id === DRAFT_TODO_ID) { setDraftTodo(null); return; }
                                onDeleteTodo?.(todo.id);
                              }}
                              swipeLeftLabel="Delete"
                              onSwipeRight={() => {
                                if (todo.id === DRAFT_TODO_ID) return;
                                void (todo.status === "completed" ? onUncompleteTodo?.(todo.id) : onCompleteTodo?.(todo.id));
                              }}
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
                                categories={allCategories}
                                hideCategories
                                disableSwipe
                                initialEditingTitle={todo.id === DRAFT_TODO_ID}
                                onComplete={(id) => { if (id === DRAFT_TODO_ID) return; void onCompleteTodo?.(id); }}
                                onUncomplete={(id) => { if (id === DRAFT_TODO_ID) return; void onUncompleteTodo?.(id); }}
                                onDelete={(id) => { if (id === DRAFT_TODO_ID) { setDraftTodo(null); return; } onDeleteTodo?.(id); }}
                                onDateChange={(id, date) => { if (id === DRAFT_TODO_ID) return; void onUpdateTodo?.(id, { scheduledDate: date }); }}
                                onUpdate={(id, updates) => {
                                  if (id === DRAFT_TODO_ID) {
                                    setDraftTodo(null);
                                    if (updates.title?.trim()) {
                                      void onCreateTodo?.({
                                        title: updates.title.trim(),
                                        categories: draftTodo?.categories,
                                      });
                                    }
                                    return;
                                  }
                                  void onUpdateTodo?.(id, updates);
                                }}
                                onEmailClick={onEmailClick}
                              />
                            </ListItem>
                          ))}
                        </List>
                        <TodoClusterFooter
                          completedTodos={completedTodos}
                          allCategories={allCategories}
                          showCompleted={showCompleted}
                          onToggleCompleted={() => setShowCompleted((v) => !v)}
                          onCompleteTodo={onCompleteTodo}
                          onUncompleteTodo={onUncompleteTodo}
                          onDeleteTodo={onDeleteTodo}
                          onUpdateTodo={onUpdateTodo}
                          onEmailClick={onEmailClick}
                          onAddTodo={onCreateTodo ? () => {
                            setDraftTodo({
                              id: DRAFT_TODO_ID,
                              title: "",
                              status: "pending",
                              categories: [category],
                              sortOrder: Date.now(),
                              createdAt: new Date().toISOString(),
                              sourceEmails: [],
                              scheduledDate: null,
                              agentSuggested: false,
                              userResponse: null,
                            });
                          } : undefined}
                        />
                      </ListItem>
                    );
                  }

                  if (entry.kind === "images") {
                    return (
                      <ListItem key={entry.key} itemId={entry.key}>
                        <PostedImageGallery
                          items={entry.items}
                          onDelete={ws.deleteItem}
                          onUpdate={ws.updateItem}
                          onExtract={handleExtractImage}
                        />
                      </ListItem>
                    );
                  }

                  return (
                    <ListItem
                      key={entry.key}
                      itemId={entry.key}
                    >
                      <FeedItemRenderer
                        item={entry.item}
                        onUpdate={ws.updateItem}
                        onDelete={ws.deleteItem}
                        onEmailClick={onEmailClick}
                        categoryColor={color}
                      />
                    </ListItem>
                  );
                })}
              </List>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Todo Cluster Footer ─────────────────────────────────

function TodoClusterFooter({
  completedTodos,
  allCategories,
  showCompleted,
  onToggleCompleted,
  onCompleteTodo,
  onUncompleteTodo,
  onDeleteTodo,
  onUpdateTodo,
  onEmailClick,
  onAddTodo,
}: {
  completedTodos: TodoItem[];
  allCategories: string[];
  showCompleted: boolean;
  onToggleCompleted: () => void;
  onCompleteTodo?: (id: string) => Promise<void>;
  onUncompleteTodo?: (id: string) => Promise<void>;
  onDeleteTodo?: (id: string) => void;
  onUpdateTodo?: (id: string, updates: Partial<Pick<TodoItem, "title" | "description" | "subtasks" | "categories" | "scheduledDate">>) => Promise<void>;
  onEmailClick?: (threadId: string, accountEmail?: string) => void;
  onAddTodo?: () => void;
}) {
  return (
    <div>
      {/* Footer bar */}
      <div className="flex items-center justify-between px-3 py-1.5">
        {completedTodos.length > 0 ? (
          <button
            type="button"
            onClick={onToggleCompleted}
            className="flex items-center gap-1.5 text-[11px] text-foreground-300/50 transition-colors hover:text-foreground-300"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn("transition-transform", showCompleted && "rotate-90")}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {completedTodos.length} completed
          </button>
        ) : (
          <span />
        )}
        {onAddTodo && (
          <button
            type="button"
            onClick={onAddTodo}
            className="flex items-center gap-1 text-[11px] text-foreground-300/50 transition-colors hover:text-foreground-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add to-do
          </button>
        )}
      </div>

      {/* Completed todos dropdown */}
      <AnimatePresence>
        {showCompleted && completedTodos.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border-100/50 pt-1 -space-y-px">
              {completedTodos.map((todo) => (
                <TodoItemComponent
                  key={todo.id}
                  todo={todo}
                  categories={allCategories}
                  hideCategories
                  onComplete={(id) => void onCompleteTodo?.(id)}
                  onUncomplete={(id) => void onUncompleteTodo?.(id)}
                  onDelete={(id) => onDeleteTodo?.(id)}
                  onDateChange={(id, date) => void onUpdateTodo?.(id, { scheduledDate: date })}
                  onUpdate={(id, updates) => void onUpdateTodo?.(id, updates)}
                  onEmailClick={onEmailClick}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Workspace Stats ─────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function WorkspaceStats({
  feed,
  todoCount,
  updatedAt,
  createdAt,
}: {
  feed: FeedItem[];
  todoCount: number;
  updatedAt: string;
  createdAt: string;
}) {
  const uploads = feed.filter((i) => i.type === "image" || i.type === "file").length;
  const notes = feed.filter((i) => i.type === "note").length;
  const links = feed.filter((i) => i.type === "link").length;

  const stats: string[] = [];
  stats.push(`Updated ${relativeTime(updatedAt)}`);
  if (todoCount > 0) stats.push(`${todoCount} to-do${todoCount !== 1 ? "s" : ""}`);
  if (notes > 0) stats.push(`${notes} note${notes !== 1 ? "s" : ""}`);
  if (uploads > 0) stats.push(`${uploads} upload${uploads !== 1 ? "s" : ""}`);
  if (links > 0) stats.push(`${links} link${links !== 1 ? "s" : ""}`);

  const created = new Date(createdAt);
  const age = Date.now() - created.getTime();
  if (age > 7 * 24 * 60 * 60 * 1000) {
    stats.push(`Created ${created.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
  }

  return (
    <div className="flex mt-2 flex-wrap items-center gap-x-1.5 px-1 text-[11px] text-foreground-300/40">
      {stats.map((stat, i) => (
        <span key={stat} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-foreground-300/20">·</span>}
          {stat}
        </span>
      ))}
    </div>
  );
}

// ─── Inline Resources (mobile collapsible) ─────────────────

function InlineResources({
  fileItems,
  linkItems,
  onDelete,
}: {
  fileItems: FeedItem[];
  linkItems: FeedItem[];
  onDelete: (id: string) => Promise<void>;
}) {
  const [linksOpen, setLinksOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const hasLinks = linkItems.length > 0;
  const hasFiles = fileItems.length > 0;

  return (
    <div className="mt-3 flex flex-col gap-2">
      {hasLinks && (
        <div className="rounded-lg border border-border-100/60 bg-background-100">
          <button
            type="button"
            onClick={() => setLinksOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2.5"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/60">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span className="flex-1 text-left text-xs font-medium text-foreground-200">
              Links
            </span>
            <span className="rounded-full bg-foreground-100/8 px-1.5 py-0.5 text-[10px] font-medium text-foreground-300">
              {linkItems.length}
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={cn("text-foreground-300/40 transition-transform", linksOpen && "rotate-180")}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <AnimatePresence>
            {linksOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                <div className="border-t border-border-100/40 px-2 py-1.5">
                  {linkItems.map((item) => {
                    const ref = item.linkRef;
                    if (!ref) return null;
                    let hostname = ref.url;
                    try { hostname = new URL(ref.url).hostname; } catch { /* keep raw */ }
                    const faviconSrc = ref.favicon || `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
                    return (
                      <div key={item.id} className="group/link relative">
                        <a
                          href={ref.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors active:bg-foreground-100/5"
                        >
                          <img
                            src={faviconSrc}
                            alt=""
                            className="h-4 w-4 shrink-0 rounded-sm"
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] text-foreground-200">
                              {ref.title || hostname}
                            </div>
                            <div className="truncate text-[10px] text-foreground-300/40">
                              {hostname}
                            </div>
                          </div>
                        </a>
                        <button
                          type="button"
                          onClick={() => void onDelete(item.id)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-foreground-300/30 opacity-0 transition-opacity group-hover/link:opacity-100 hover:text-red-500"
                          title="Remove"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {hasFiles && (
        <div className="rounded-lg border border-border-100/60 bg-background-100">
          <button
            type="button"
            onClick={() => setFilesOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2.5"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/60">
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
            </svg>
            <span className="flex-1 text-left text-xs font-medium text-foreground-200">
              Files
            </span>
            <span className="rounded-full bg-foreground-100/8 px-1.5 py-0.5 text-[10px] font-medium text-foreground-300">
              {fileItems.length}
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={cn("text-foreground-300/40 transition-transform", filesOpen && "rotate-180")}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <AnimatePresence>
            {filesOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                <div className="border-t border-border-100/40 px-2 py-1.5">
                  {fileItems.map((item) => {
                    const ref = item.fileRef;
                    if (!ref) return null;
                    const href = `/api/workspace/_/file/${encodeURIComponent(ref.key)}`;
                    return (
                      <div key={item.id} className="group/file relative">
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors active:bg-foreground-100/5"
                        >
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground-100/10">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300">
                              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                            </svg>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] text-foreground-200">
                              {ref.filename}
                            </div>
                            <div className="text-[10px] text-foreground-300/50">
                              {formatFileSize(ref.size)}
                            </div>
                          </div>
                        </a>
                        <button
                          type="button"
                          onClick={() => void onDelete(item.id)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-foreground-300/30 opacity-0 transition-opacity group-hover/file:opacity-100 hover:text-red-500"
                          title="Remove"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ─── Resources Sidebar (right-edge, mirrors inbox sidebar) ──

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ResourcesSidebar({
  fileItems,
  linkItems,
  onDelete,
}: {
  fileItems: FeedItem[];
  linkItems: FeedItem[];
  onDelete: (id: string) => Promise<void>;
}) {
  const hasFiles = fileItems.length > 0;
  const hasLinks = linkItems.length > 0;

  return (
    <aside className="group/resources fixed right-4 top-[calc(2rem+56px)] z-10 h-fit w-[260px] shrink-0">
      {/* Links section */}
      {hasLinks && (
        <>
          <div className="px-2 pb-1">
            <div className="flex items-center justify-between px-3">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/70">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-300/50">
                  Links
                </span>
              </div>
              <span className="text-[10px] text-foreground-300/40">{linkItems.length}</span>
            </div>
          </div>
          <nav className="max-h-[40vh] overflow-y-auto px-2 pb-3 opacity-40 transition-opacity duration-300 group-hover/resources:opacity-100">
            <div className="space-y-0.5 px-1">
              {linkItems.map((item) => {
                const ref = item.linkRef;
                if (!ref) return null;
                let hostname = ref.url;
                try { hostname = new URL(ref.url).hostname; } catch { /* keep raw url */ }
                const faviconSrc = ref.favicon || `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
                return (
                  <div key={item.id} className="group/link relative">
                    <a
                      href={ref.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-lg px-3 py-[7px] transition-colors hover:bg-foreground-100/5"
                    >
                      {/* OG image preview */}
                      {ref.image && (
                        <div className="mb-1.5 overflow-hidden rounded-md">
                          <img
                            src={ref.image}
                            alt=""
                            className="h-[100px] w-full object-cover"
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <img
                          src={faviconSrc}
                          alt=""
                          className="h-4 w-4 shrink-0 rounded-sm"
                          loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] text-foreground-200 group-hover/link:text-accent-100">
                            {ref.title || hostname}
                          </div>
                        </div>
                      </div>
                      {ref.description && (
                        <div className="mt-0.5 pl-6 line-clamp-2 text-[11px] leading-snug text-foreground-300/60">
                          {ref.description}
                        </div>
                      )}
                      <div className="mt-0.5 pl-6 truncate text-[10px] text-foreground-300/40">
                        {hostname}
                      </div>
                    </a>
                    <button
                      type="button"
                      onClick={() => void onDelete(item.id)}
                      className="absolute right-2 top-2 rounded-md p-1 text-foreground-300/30 opacity-0 transition-opacity group-hover/link:opacity-100 hover:text-red-500"
                      title="Remove"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </nav>
        </>
      )}

      {/* Divider between sections */}
      {hasLinks && hasFiles && (
        <div className="mx-5 mb-5 mt-1 border-t border-foreground-300/10" />
      )}

      {/* Files section */}
      {hasFiles && (
        <>
          <div className="px-2 pb-1">
            <div className="flex items-center justify-between px-3">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/70">
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                  <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                </svg>
                <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-300/50">
                  Files
                </span>
              </div>
              <span className="text-[10px] text-foreground-300/40">{fileItems.length}</span>
            </div>
          </div>
          <nav className="max-h-[35vh] overflow-y-auto px-2 pb-3 opacity-40 transition-opacity duration-300 group-hover/resources:opacity-100">
            <div className="space-y-0.5 px-1">
              {fileItems.map((item) => {
                const ref = item.fileRef;
                if (!ref) return null;
                const href = `/api/workspace/_/file/${encodeURIComponent(ref.key)}`;
                return (
                  <div key={item.id} className="group/file relative">
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2.5 rounded-lg px-3 py-[7px] transition-colors hover:bg-foreground-100/5"
                    >
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground-100/10 transition-colors duration-300 group-hover/resources:bg-foreground-100/15">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300">
                          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-foreground-200">
                          {ref.filename}
                        </div>
                        <div className="text-[10px] text-foreground-300/50">
                          {formatFileSize(ref.size)}
                        </div>
                      </div>
                    </a>
                    <button
                      type="button"
                      onClick={() => void onDelete(item.id)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-foreground-300/30 opacity-0 transition-opacity group-hover/file:opacity-100 hover:text-red-500"
                      title="Remove"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </nav>
        </>
      )}
    </aside>
  );
}
