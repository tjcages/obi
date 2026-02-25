import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AccountBadges,
  CategoryWorkspace,
  ResourcesSidebar,
  CompactInboxSidebar,
  ConversationSidebar,
  EmailModal,
  GmailChat,
  Header,
  InboxList,
  List,
  ListItem,
  MemoryPanel,
  SlackSidebar,
  SlackThreadModal,
  TodoPanel,
  UnifiedInput,
  WeekStrip,
  parseSenderName,
  type CompactInboxHandle,
  type InboxListHandle,
  type ThreadGroup,
} from "../components";
import { Drawer } from "../components/ui/_drawer";
import type { ComposeMode } from "../components/email/_email-modal";
import type { TodoSlackRef } from "../lib";
import { cn, useMediaQuery, useTodos, useSuggestions, useConversations, useAccounts, useScan, useWorkspace, useResizablePanel, useUndoRedo, setCustomCategoryColors, getCategoryColor, type TodoItem } from "../lib";

// function formatScanAge(iso: string): string {
//   const diffMs = Date.now() - new Date(iso).getTime();
//   if (diffMs < 60_000) return "just now";
//   const mins = Math.round(diffMs / 60_000);
//   if (mins < 60) return `${mins}m ago`;
//   const hrs = Math.round(mins / 60);
//   return `${hrs}h ago`;
// }

function RightColumnCategories({
  categories,
  todos,
  onOpenWorkspace,
  onSaveCategories,
}: {
  categories: string[];
  todos: TodoItem[];
  onOpenWorkspace: (category: string) => void;
  onSaveCategories: (categories: string[]) => Promise<void>;
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
    void onSaveCategories([...categories, trimmed]);
    setNewName("");
    setAdding(false);
  };

  const handleReorder = useCallback((orderedIds: string[]) => {
    void onSaveCategories(orderedIds);
  }, [onSaveCategories]);

  const pendingByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const cat of categories) map[cat] = 0;
    for (const t of todos) {
      if (t.status !== "pending" || !t.categories) continue;
      for (const c of t.categories) {
        if (c in map) map[c]++;
      }
    }
    return map;
  }, [categories, todos]);

  if (categories.length === 0 && !onSaveCategories) return null;

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between px-0.5">
        <span className="text-[10px] font-medium uppercase tracking-widest text-foreground-300">
          Workspaces
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <List
          direction="grid"
          containerless
          reorderable
          onReorder={handleReorder}
          renderDragOverlay={(id) => {
            const color = getCategoryColor(id, categories);
            const count = pendingByCategory[id] ?? 0;
            return (
              <div
                className={cn(
                  "flex flex-col rounded-xl p-3 text-left",
                  color.bg, color.text,
                )}
                style={color.style}
              >
                <span className="truncate text-[13px] font-semibold leading-tight">{id}</span>
                <span className="mt-1 text-[11px] opacity-60">
                  {count > 0 ? `${count} task${count !== 1 ? "s" : ""}` : "No tasks"}
                </span>
              </div>
            );
          }}
        >
          {categories.map((cat) => {
            const color = getCategoryColor(cat, categories);
            const count = pendingByCategory[cat] ?? 0;
            return (
              <ListItem key={cat} itemId={cat} className="overflow-visible">
                <button
                  type="button"
                  onClick={() => onOpenWorkspace(cat)}
                  className={cn(
                    "flex w-full flex-col rounded-xl p-3 text-left transition-all",
                    "hover:shadow-md hover:scale-[1.02] active:scale-[0.98]",
                    color.bg, color.text,
                  )}
                  style={color.style}
                >
                  <span className="truncate text-[13px] font-semibold leading-tight">{cat}</span>
                  <span className="mt-1 text-[11px] opacity-60">
                    {count > 0 ? `${count} task${count !== 1 ? "s" : ""}` : "No tasks"}
                  </span>
                </button>
              </ListItem>
            );
          })}
        </List>
        {adding ? (
          <div className="flex items-center rounded-xl border border-dashed border-border-100 p-3">
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addCategory(); }
                if (e.key === "Escape") { setNewName(""); setAdding(false); }
              }}
              onBlur={() => {
                if (newName.trim()) addCategory();
                else setAdding(false);
              }}
              placeholder="Name..."
              className="w-full bg-transparent text-[13px] text-foreground-100 outline-none placeholder:text-foreground-300/40"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={cn(
              "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-3 transition-colors",
              "border-border-100/60 text-foreground-300/50",
              "hover:border-foreground-300/40 hover:text-foreground-300",
            )}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="mt-1 text-[11px]">Add</span>
          </button>
        )}
      </div>
    </div>
  );
}

interface HomePageProps {
  userId: string;
}

export default function HomePage({ userId }: HomePageProps) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isWideDesktop = useMediaQuery("(min-width: 1280px)");
  const leftPanel = useResizablePanel({
    storageKey: "obi:left-panel-width",
    defaultWidth: 260,
    minWidth: 200,
    maxWidth: 400,
  });
  const suggestions = useSuggestions();
  const todoState = useTodos();

  useEffect(() => {
    setCustomCategoryColors(todoState.preferences.categoryColors ?? {});
  }, [todoState.preferences.categoryColors]);

  const scanState = useScan({
    onScanComplete: () => void todoState.refresh(),
  });
  const accounts = useAccounts();
  const conv = useConversations({ userId });

  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [todoPanelOpen, setTodoPanelOpen] = useState(true);
  const [inboxPanelOpen, setInboxPanelOpen] = useState(false);
  const [activeCategoryWorkspace, setActiveCategoryWorkspace] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("category");
  });
  const [selectedCalDate, setSelectedCalDate] = useState<string | null>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedAccountEmail, setSelectedAccountEmail] = useState<string | undefined>(undefined);
  const [initialComposeMode, setInitialComposeMode] = useState<ComposeMode | undefined>(undefined);
  const [slackModalRef, setSlackModalRef] = useState<TodoSlackRef[] | null>(null);

  const navigateToCategory = useCallback((category: string | null) => {
    setActiveCategoryWorkspace(category);
    const url = new URL(window.location.href);
    if (category) {
      url.searchParams.set("category", category);
    } else {
      url.searchParams.delete("category");
    }
    window.history.pushState(null, "", url.toString());
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const cat = new URLSearchParams(window.location.search).get("category");
      setActiveCategoryWorkspace(cat);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const activeWorkspace = useWorkspace(activeCategoryWorkspace);

  useEffect(() => {
    void fetch("/api/workspace/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: activeCategoryWorkspace }),
    });
  }, [activeCategoryWorkspace]);

  const inboxListRef = useRef<InboxListHandle>(null);
  const compactInboxRef = useRef<CompactInboxHandle>(null);
  const { pushUndo } = useUndoRedo();

  // ── Escape key ──

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") conv.closeConversation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conv.closeConversation]);

  // ── Email / archive handlers ──

  const handleEmailClick = useCallback((thread: ThreadGroup) => {
    setSelectedThreadId(thread.threadId);
    setSelectedAccountEmail(thread.representative.accountEmail);
  }, []);

  const archiveThreads = useCallback(
    (threadIds: string[], accountParams: string[], senderNames: string[], label: string) => {
      for (let i = 0; i < threadIds.length; i++) {
        void fetch(`/api/threads/${threadIds[i]}/archive${accountParams[i]}`, { method: "POST" });
        inboxListRef.current?.hideThread(threadIds[i]);
        compactInboxRef.current?.hideThread(threadIds[i]);
      }

      pushUndo({
        id: `archive-${threadIds.join("-")}-${Date.now()}`,
        label,
        onUndo: () => {
          for (let i = 0; i < threadIds.length; i++) {
            inboxListRef.current?.unhideThread(threadIds[i]);
            compactInboxRef.current?.unhideThread(threadIds[i]);
            void fetch(`/api/threads/${threadIds[i]}/unarchive${accountParams[i]}`, { method: "POST" });
          }
        },
        onRedo: () => {
          for (let i = 0; i < threadIds.length; i++) {
            void fetch(`/api/threads/${threadIds[i]}/archive${accountParams[i]}`, { method: "POST" });
            inboxListRef.current?.hideThread(threadIds[i]);
            compactInboxRef.current?.hideThread(threadIds[i]);
          }
        },
      });
    },
    [pushUndo],
  );

  const handleArchiveEmail = useCallback(
    (thread: ThreadGroup) => {
      const accountParam = thread.representative.accountEmail
        ? `?account=${encodeURIComponent(thread.representative.accountEmail)}`
        : "";
      const senderName = parseSenderName(thread.representative.from).name;
      archiveThreads([thread.threadId], [accountParam], [senderName], `Archived "${senderName}"`);
    },
    [archiveThreads],
  );

  const handleArchiveGroup = useCallback(
    (threads: ThreadGroup[]) => {
      const threadIds = threads.map((t) => t.threadId);
      const accountParams = threads.map((t) =>
        t.representative.accountEmail
          ? `?account=${encodeURIComponent(t.representative.accountEmail)}`
          : "",
      );
      const senderNames = threads.map((t) => parseSenderName(t.representative.from).name);
      const groupName = senderNames[0] ?? "group";
      const label =
        threads.length === 1
          ? `Archived "${groupName}"`
          : `Archived ${threads.length} from "${groupName}"`;
      archiveThreads(threadIds, accountParams, senderNames, label);
    },
    [archiveThreads],
  );

  // ── Todo delete with undo ──

  const handleDeleteTodoWithUndo = useCallback(
    (id: string) => {
      const todo = todoState.todos.find((t: TodoItem) => t.id === id);
      if (!todo) return void todoState.deleteTodo(id);

      const label = `Deleted "${todo.title.length > 30 ? `${todo.title.slice(0, 30)}…` : todo.title}"`;
      void todoState.deleteTodo(id);

      pushUndo({
        id: `todo-del-${id}-${Date.now()}`,
        label,
        onUndo: () => void todoState.restoreTodo(todo),
        onRedo: () => void todoState.deleteTodo(id),
      });
    },
    [todoState, pushUndo],
  );

  // ── Conversation archive with undo ──

  const handleArchiveConversationWithUndo = useCallback(
    (id: string) => {
      const conversation = conv.conversations.find((c) => c.id === id);
      const title = conversation?.title ?? "conversation";
      const label = `Archived "${title.length > 30 ? `${title.slice(0, 30)}…` : title}"`;

      conv.archiveConversation(id);

      pushUndo({
        id: `conv-arch-${id}-${Date.now()}`,
        label,
        onUndo: () => conv.unarchiveConversation(id),
        onRedo: () => conv.archiveConversation(id),
      });
    },
    [conv, pushUndo],
  );

  // ── Reply handler (swipe-to-reply opens email modal with compose pre-activated) ──

  const handleReplyEmail = useCallback((thread: ThreadGroup) => {
    setSelectedThreadId(thread.threadId);
    setSelectedAccountEmail(thread.representative.accountEmail);
    setInitialComposeMode("reply-all");
  }, []);

  const handleChatAboutEmail = useCallback(
    (email: { from: string; subject: string; snippet: string }) => {
      const { name: senderName } = parseSenderName(email.from);
      const title = `Re: ${email.subject || senderName}`.slice(0, 64);
      const prompt = `Tell me about this email from ${senderName} with subject "${email.subject}". The snippet says: "${email.snippet}"`;
      conv.startConversation(title, prompt, activeCategoryWorkspace);
    },
    [conv.startConversation, activeCategoryWorkspace],
  );

  const handleStartConversation = useCallback(
    (title: string, prompt: string) => {
      conv.startConversation(title, prompt, activeCategoryWorkspace);
      setSelectedThreadId(null);
    },
    [conv.startConversation, activeCategoryWorkspace],
  );

  function archiveSourceEmails(todo?: TodoItem) {
    if (!todo?.sourceEmails?.length) return;
    for (const email of todo.sourceEmails) {
      if (email.threadId && email.accountEmail) {
        fetch(`/api/threads/${encodeURIComponent(email.threadId)}/archive?account=${encodeURIComponent(email.accountEmail)}`, { method: "POST" }).catch(() => {});
      }
    }
  }

  function archiveSourceSlack(todo?: TodoItem) {
    if (!todo?.sourceSlack?.length) return;
    for (const ref of todo.sourceSlack) {
      fetch("/api/slack/archive-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: ref.channelId, threadTs: ref.threadTs }),
      }).catch(() => {});
    }
  }

  function unarchiveSourceEmails(todo?: TodoItem) {
    if (!todo?.sourceEmails?.length) return;
    for (const email of todo.sourceEmails) {
      if (email.threadId && email.accountEmail) {
        fetch(`/api/threads/${encodeURIComponent(email.threadId)}/unarchive?account=${encodeURIComponent(email.accountEmail)}`, { method: "POST" }).catch(() => {});
      }
    }
  }

  function truncateLabel(text: string, max = 30) {
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  const handleAcceptAndComplete = useCallback(
    async (id: string) => {
      const todo = todoState.todos.find((t: TodoItem) => t.id === id);
      await todoState.acceptSuggestion(id);
      await todoState.completeTodo(id);
      archiveSourceEmails(todo);
      archiveSourceSlack(todo);

      const title = todo?.title ?? "todo";
      pushUndo({
        id: `suggest-ac-${id}-${Date.now()}`,
        label: `Completed "${truncateLabel(title)}"`,
        onUndo: () => {
          void todoState.unacceptSuggestion(id);
          unarchiveSourceEmails(todo);
        },
        onRedo: () => {
          void todoState.acceptSuggestion(id).then(() => todoState.completeTodo(id));
          archiveSourceEmails(todo);
          archiveSourceSlack(todo);
        },
      });
    },
    [todoState, pushUndo],
  );

  const handleCompleteTodo = useCallback(
    async (id: string) => {
      const todo = todoState.todos.find((t: TodoItem) => t.id === id);
      await todoState.completeTodo(id);
      archiveSourceEmails(todo);
      archiveSourceSlack(todo);

      const title = todo?.title ?? "todo";
      pushUndo({
        id: `todo-done-${id}-${Date.now()}`,
        label: `Completed "${truncateLabel(title)}"`,
        onUndo: () => {
          void todoState.uncompleteTodo(id);
          unarchiveSourceEmails(todo);
        },
        onRedo: () => {
          void todoState.completeTodo(id);
          archiveSourceEmails(todo);
          archiveSourceSlack(todo);
        },
      });
    },
    [todoState, pushUndo],
  );

  const handleUncompleteTodo = useCallback(
    async (id: string) => {
      const todo = todoState.todos.find((t: TodoItem) => t.id === id);
      await todoState.uncompleteTodo(id);
      unarchiveSourceEmails(todo);

      const title = todo?.title ?? "todo";
      pushUndo({
        id: `todo-undone-${id}-${Date.now()}`,
        label: `Uncompleted "${truncateLabel(title)}"`,
        onUndo: () => {
          void todoState.completeTodo(id);
          archiveSourceEmails(todo);
        },
        onRedo: () => {
          void todoState.uncompleteTodo(id);
          unarchiveSourceEmails(todo);
        },
      });
    },
    [todoState, pushUndo],
  );

  const handleAcceptSuggestion = useCallback(
    async (id: string) => {
      const todo = todoState.todos.find((t: TodoItem) => t.id === id);
      await todoState.acceptSuggestion(id);
      archiveSourceSlack(todo);

      const title = todo?.title ?? "suggestion";
      pushUndo({
        id: `suggest-accept-${id}-${Date.now()}`,
        label: `Accepted "${truncateLabel(title)}"`,
        onUndo: () => void todoState.unacceptSuggestion(id),
        onRedo: () => {
          void todoState.acceptSuggestion(id);
          archiveSourceSlack(todo);
        },
      });
    },
    [todoState, pushUndo],
  );

  const handleDeclineSuggestion = useCallback(
    async (id: string, reason?: string) => {
      const todo = todoState.todos.find((t: TodoItem) => t.id === id);
      await todoState.declineSuggestion(id, reason);
      archiveSourceSlack(todo);

      const title = todo?.title ?? "suggestion";
      pushUndo({
        id: `suggest-decline-${id}-${Date.now()}`,
        label: `Dismissed "${truncateLabel(title)}"`,
        onUndo: () => {
          if (todo) void todoState.undeclineSuggestion(id, todo);
        },
        onRedo: () => {
          void todoState.declineSuggestion(id, reason);
          archiveSourceSlack(todo);
        },
      });
    },
    [todoState, pushUndo],
  );

  const handleSlackClick = useCallback(
    (refs?: TodoSlackRef[]) => {
      if (refs?.length) setSlackModalRef(refs);
    },
    [],
  );

  const [mobileConvDrawerOpen, setMobileConvDrawerOpen] = useState(false);

  const chatPanelOpen = !!conv.activeConversationId;
  const emailModalOpen = !!selectedThreadId;
  const showRightColumn = isWideDesktop && !chatPanelOpen;

  return (
    <div className="flex h-dvh flex-col bg-background-100 text-foreground-100">
      <Header
        accounts={accounts.accounts}
        activeEmails={accounts.activeEmails}
        onMemoryToggle={() => setMemoryPanelOpen(true)}
        onTodoToggle={() => {
          if (isDesktop) { setTodoPanelOpen((v) => !v); }
          else { setTodoPanelOpen(true); setInboxPanelOpen(false); }
        }}
        inboxActive={inboxPanelOpen}
        todoActive={todoPanelOpen}
        onInboxToggle={() => {
          if (isDesktop) { setInboxPanelOpen((v) => !v); }
          else { setInboxPanelOpen(true); setTodoPanelOpen(false); }
        }}
        onChatsToggle={() => setMobileConvDrawerOpen(true)}
        chatBadge={conv.sortedActive.length || undefined}
        activeCategoryWorkspace={activeCategoryWorkspace}
        onBackFromCategory={() => setActiveCategoryWorkspace(null)}
        onSelectAccount={accounts.selectAccount}
        onSelectAll={accounts.selectAllAccounts}
        onSetPrimary={accounts.setPrimary}
        onAddAccount={accounts.addAccount}
        onRemoveAccount={accounts.removeAccount}
        onUpdateLabel={accounts.updateLabel}
      />

      <div className="flex min-h-0 flex-1">
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn("pt-0", isDesktop ? "flex px-4" : "mx-auto max-w-2xl px-2")}>

            {/* Desktop left sidebar: compact inbox + conversation list */}
            {isDesktop && (
              <div
                className="sticky top-8 z-10 shrink-0 self-start overflow-y-auto overflow-x-hidden [&_aside]:static [&_aside]:pt-0 [&_nav]:max-h-none"
                style={{
                  width: leftPanel.width,
                  maxHeight: "calc(100dvh - 1rem - 64px)",
                }}
              >
                <motion.div
                  animate={{
                    height: activeCategoryWorkspace ? 0 : "auto",
                    opacity: activeCategoryWorkspace ? 0 : 1,
                  }}
                  initial={false}
                  transition={{
                    type: "spring",
                    stiffness: 280,
                    damping: 32,
                    mass: 0.9,
                    opacity: { duration: activeCategoryWorkspace ? 0.15 : 0.25, ease: "easeOut" },
                  }}
                  className="overflow-hidden"
                >
                  <CompactInboxSidebar
                    listRef={compactInboxRef}
                    onEmailClick={handleEmailClick}
                    onArchive={handleArchiveEmail}
                    onArchiveGroup={handleArchiveGroup}
                    onReply={handleReplyEmail}
                    activeAccountEmails={accounts.activeEmails.length > 0 ? accounts.activeEmails : undefined}
                    accountColors={accounts.accountColors}
                  />
                  <SlackSidebar />
                  <div className="mx-3 my-1 border-t border-foreground-300/10" />
                </motion.div>
                <ConversationSidebar
                  conversations={conv.sortedActive}
                  archivedConversations={conv.sortedArchived}
                  activeConversationId={conv.activeConversationId}
                  onNewChat={() => conv.createBlankConversation(activeCategoryWorkspace)}
                  onSelect={conv.selectConversation}
                  onArchive={handleArchiveConversationWithUndo}
                  onUnarchive={conv.unarchiveConversation}
                  activeCategory={activeCategoryWorkspace}
                />
              </div>
            )}

            {/* Desktop chat panel */}
            <AnimatePresence>
              {isDesktop && chatPanelOpen && conv.activeConversationId && (
                <motion.div
                  key="chat-panel"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 440, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{
                    width: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
                    opacity: { duration: 0.2, ease: "easeOut" },
                  }}
                  className="ml-1 shrink-0 self-start overflow-hidden pt-8"
                  style={{ position: "sticky", top: "1rem" }}
                >
                  <div
                    className="flex w-[440px] flex-col rounded-xl border border-border-100/60 bg-background-100"
                    style={{ maxHeight: "calc(100dvh - 1rem - 56px - 32px - 64px)", height: "72vh" }}
                  >
                    <div className="flex shrink-0 items-center justify-between border-b border-border-100/40 px-4 py-2.5">
                      <span className="truncate text-[13px] font-semibold text-foreground-100">
                        {conv.activeConversation?.title ?? "Conversation"}
                      </span>
                      <button
                        type="button"
                        onClick={conv.closeConversation}
                        className="rounded-md p-1 text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
                        aria-label="Close chat"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                    <div className="min-h-0 flex-1">
                      <GmailChat
                        key={conv.activeConversationId}
                        userId={userId}
                        conversationId={conv.activeConversationId}
                        conversationReady={!conv.sessionSyncing}
                        hasConversation
                        onUserMessage={conv.onConversationMessage}
                        autoSendPrompt={conv.pendingPrompt}
                        onAutoSendComplete={conv.clearPendingPrompt}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Resize handle between left group (sidebar + chat) and main content */}
            {isDesktop && (
              <div
                onMouseDown={leftPanel.handleMouseDown}
                className={cn(
                  "sticky top-0 z-20 flex w-12 shrink-0 cursor-col-resize items-center justify-center self-stretch",
                  "group",
                )}
                style={{ maxHeight: "calc(100dvh - 1rem - 64px)" }}
              >
                <div
                  className={cn(
                    "h-full w-px transition-colors duration-150",
                    leftPanel.isDragging
                      ? "bg-accent-100/60"
                      : "bg-foreground-300/10 group-hover:bg-foreground-300/25",
                  )}
                />
              </div>
            )}

            {/* Main content column */}
            <div className="min-w-0 flex-1 pl-3">
                {activeCategoryWorkspace ? (
                  <div className="mx-auto max-w-2xl" key={`workspace-${activeCategoryWorkspace}`}>
                    <CategoryWorkspace
                      category={activeCategoryWorkspace}
                      allCategories={todoState.preferences.todoCategories ?? []}
                      onBack={() => navigateToCategory(null)}
                      onEmailClick={(threadId, accountEmail) => {
                        setSelectedThreadId(threadId);
                        setSelectedAccountEmail(accountEmail);
                      }}
                      workspace={activeWorkspace}
                      todos={todoState.todos}
                      onCompleteTodo={handleCompleteTodo}
                      onUncompleteTodo={handleUncompleteTodo}
                      onDeleteTodo={handleDeleteTodoWithUndo}
                      onUpdateTodo={todoState.updateTodo}
                      onCreateTodo={(params) => void todoState.createTodo(params)}
                      onReorderTodos={todoState.reorderTodos}
                      onStartChat={handleStartConversation}
                      onRenameCategory={(oldName, newName) => {
                        const cats = [...(todoState.preferences.todoCategories ?? [])];
                        const idx = cats.indexOf(oldName);
                        if (idx >= 0) cats[idx] = newName;
                        void todoState.saveCategories(cats);
                        for (const t of todoState.todos) {
                          if (t.categories?.includes(oldName)) {
                            void todoState.updateTodo(t.id, {
                              categories: t.categories.map((c) => c === oldName ? newName : c),
                            });
                          }
                        }
                        navigateToCategory(newName);
                      }}
                      onChangeCustomColor={(cat, hex) => {
                        const updated = { ...(todoState.preferences.categoryColors ?? {}) };
                        if (hex) updated[cat] = hex; else delete updated[cat];
                        setCustomCategoryColors(updated);
                        void todoState.saveCategoryColor(cat, hex);
                      }}
                      customCategoryColors={todoState.preferences.categoryColors}
                      onDeleteCategory={(cat) => {
                        const cats = (todoState.preferences.todoCategories ?? []).filter((c) => c !== cat);
                        void todoState.saveCategories(cats);
                        navigateToCategory(null);
                      }}
                    />
                  </div>
                ) : (
                  <div key="home-content" className="mx-auto max-w-2xl">
              {/* Inline week strip (mobile + regular desktop) */}
              {!showRightColumn && (
                <WeekStrip
                  selectedDate={selectedCalDate}
                  onSelectDate={setSelectedCalDate}
                  todos={todoState.todos}
                  className="pb-2 pt-1"
                />
              )}

              {/* Desktop inline input — mobile uses floating bottom sheet */}
              {isDesktop && (
                <UnifiedInput
                  suggestions={suggestions}
                  categories={todoState.preferences.todoCategories ?? []}
                  lastUsedCategory={todoState.lastUsedCategory}
                  onStartConversation={handleStartConversation}
                  onCreateTodo={(params) => void todoState.createTodo({ ...params, scheduledDate: params.scheduledDate ?? selectedCalDate ?? undefined })}
                  onSaveCategories={todoState.saveCategories}
                  todoPanelOpen={todoPanelOpen}
                  onOpenTodoPanel={() => setTodoPanelOpen(true)}
                />
              )}

              {/* Todos */}
              <AnimatePresence>
                {todoPanelOpen && (
                  <motion.div
                    className="pt-2 lg:pt-4"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  >
                    <TodoPanel
                      todos={todoState.todos}
                      activeDate={selectedCalDate}
                      loading={todoState.loading}
                      scanning={scanState.scanning}
                      lastScanResult={scanState.lastScanResult}
                      categories={todoState.preferences.todoCategories ?? []}
                      lastUsedCategory={todoState.lastUsedCategory}
                      createTodo={(params) => todoState.createTodo({ ...params, scheduledDate: params.scheduledDate ?? selectedCalDate ?? undefined })}
                      updateTodo={todoState.updateTodo}
                      deleteTodo={handleDeleteTodoWithUndo}
                      completeTodo={handleCompleteTodo}
                      uncompleteTodo={handleUncompleteTodo}
                      reorderTodos={todoState.reorderTodos}
                      acceptSuggestion={handleAcceptSuggestion}
                      acceptAndCompleteSuggestion={handleAcceptAndComplete}
                      declineSuggestion={handleDeclineSuggestion}
                      onRefreshSuggestions={() => {
                        void fetch("/api/todos/suggestions/clear", { method: "POST" })
                          .then(() => todoState.refresh())
                          .then(() => scanState.triggerScan());
                      }}
                      onSaveCategories={todoState.saveCategories}
                      onOpenWorkspace={navigateToCategory}
                      onEmailClick={(threadId, accountEmail) => {
                        setSelectedThreadId(threadId);
                        setSelectedAccountEmail(accountEmail);
                      }}
                      onSlackClick={handleSlackClick}
                      hideCategoryBar={showRightColumn}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Inbox */}
              <div className={cn(isDesktop ? "pt-6 pb-16" : "pt-4 pb-40")}>
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-xs font-medium uppercase tracking-widest text-foreground-300">
                    Inbox
                  </h2>
                  <button
                    type="button"
                    onClick={() => setInboxPanelOpen((v) => !v)}
                    className="rounded-md p-1 text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
                    title={inboxPanelOpen ? "Hide inbox" : "Show inbox"}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points={inboxPanelOpen ? "6 9 12 15 18 9" : "6 15 12 9 18 15"} />
                    </svg>
                  </button>
                </div>
                <AnimatePresence>
                  {inboxPanelOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    >
                      {accounts.accounts.length > 0 && (
                        <div className="mb-3 px-1">
                          <AccountBadges
                            accounts={accounts.accounts}
                            activeEmails={accounts.activeEmails}
                            onToggle={accounts.toggleAccount}
                            onSelectAll={accounts.selectAllAccounts}
                            onAddAccount={accounts.addAccount}
                            onRemoveAccount={accounts.removeAccount}
                            onUpdateLabel={accounts.updateLabel}
                          />
                        </div>
                      )}
                      <div className="overflow-hidden rounded-xl border border-border-100/80 bg-background-100">
                        <InboxList
                          listRef={inboxListRef}
                          onEmailClick={handleEmailClick}
                          onArchive={handleArchiveEmail}
                          onArchiveGroup={handleArchiveGroup}
                          onReply={handleReplyEmail}
                          activeAccountEmails={accounts.activeEmails.length > 0 ? accounts.activeEmails : undefined}
                          accountColors={accounts.accountColors}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
                  </div>
                )}
            </div>

            {/* Right sidebar: calendar + category grid */}
            {showRightColumn && !activeCategoryWorkspace && (
              <div
                className="sticky top-0 z-10 shrink-0 self-start overflow-y-auto px-4"
                style={{
                  width: 300,
                  maxHeight: "calc(100dvh - 1rem - 64px)",
                }}
              >
                <WeekStrip
                  selectedDate={selectedCalDate}
                  onSelectDate={setSelectedCalDate}
                  todos={todoState.todos}
                  className="pt-8"
                />
                <RightColumnCategories
                  categories={todoState.preferences.todoCategories ?? []}
                  todos={todoState.todos}
                  onOpenWorkspace={navigateToCategory}
                  onSaveCategories={todoState.saveCategories}
                />
              </div>
            )}

          </div>
        </main>
      </div>

      {/* Modals & panels */}
      <EmailModal
        open={emailModalOpen}
        threadId={selectedThreadId ?? ""}
        accountEmail={selectedAccountEmail}
        pushed={chatPanelOpen}
        initialComposeMode={initialComposeMode}
        onDismiss={() => { setSelectedThreadId(null); setSelectedAccountEmail(undefined); setInitialComposeMode(undefined); }}
        onArchive={selectedThreadId ? () => {
          const accountParam = selectedAccountEmail
            ? `?account=${encodeURIComponent(selectedAccountEmail)}`
            : "";
          archiveThreads([selectedThreadId], [accountParam], ["email"], "Archived email");
        } : undefined}
        onChatAbout={handleChatAboutEmail}
        onPinToWorkspace={activeCategoryWorkspace ? (email) => {
          void activeWorkspace.pinEmail(email);
        } : undefined}
      />

      <SlackThreadModal
        open={!!slackModalRef}
        slackRef={slackModalRef?.[0] ?? null}
        onDismiss={() => setSlackModalRef(null)}
      />

      <MemoryPanel
        open={memoryPanelOpen}
        onClose={() => setMemoryPanelOpen(false)}
        accounts={accounts.accounts}
        onAddAccount={accounts.addAccount}
        onRemoveAccount={accounts.removeAccount}
        onUpdateLabel={accounts.updateLabel}
      />

      {/* Mobile chat overlay */}
      <AnimatePresence>
        {!isDesktop && chatPanelOpen && conv.activeConversationId && (
          <motion.div
            key="mobile-chat"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-0 z-50 flex flex-col bg-background-100"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border-100 px-2 py-2">
              <button
                type="button"
                onClick={conv.closeConversation}
                className="-ml-1 flex h-11 w-11 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
                aria-label="Back"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5" />
                  <path d="M12 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="truncate text-sm font-medium text-foreground-100">
                {conv.activeConversation?.title ?? "Conversation"}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <GmailChat
                key={`m-${conv.activeConversationId}`}
                userId={userId}
                conversationId={conv.activeConversationId}
                conversationReady={!conv.sessionSyncing}
                hasConversation
                onUserMessage={conv.onConversationMessage}
                autoSendPrompt={conv.pendingPrompt}
                onAutoSendComplete={conv.clearPendingPrompt}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile conversations drawer */}
      {!isDesktop && (
        <Drawer open={mobileConvDrawerOpen} onOpenChange={setMobileConvDrawerOpen}>
          <Drawer.Content className="h-[80dvh]">
            <Drawer.Header>
              <Drawer.Title className="text-sm font-semibold text-foreground-100">Conversations</Drawer.Title>
            </Drawer.Header>
            <Drawer.Body>
              <ConversationSidebar
                conversations={conv.sortedActive}
                archivedConversations={conv.sortedArchived}
                activeConversationId={conv.activeConversationId}
                onNewChat={() => { conv.createBlankConversation(activeCategoryWorkspace); setMobileConvDrawerOpen(false); }}
                onSelect={(id) => { conv.selectConversation(id); setMobileConvDrawerOpen(false); }}
                onArchive={handleArchiveConversationWithUndo}
                onUnarchive={conv.unarchiveConversation}
                activeCategory={activeCategoryWorkspace}
              />
            </Drawer.Body>
          </Drawer.Content>
        </Drawer>
      )}

      {/* Mobile floating bottom sheet input */}
      {!isDesktop && !activeCategoryWorkspace && !chatPanelOpen && (
        <UnifiedInput
          suggestions={suggestions}
          categories={todoState.preferences.todoCategories ?? []}
          lastUsedCategory={todoState.lastUsedCategory}
          onStartConversation={handleStartConversation}
          onCreateTodo={(params) => void todoState.createTodo({ ...params, scheduledDate: params.scheduledDate ?? selectedCalDate ?? undefined })}
          onSaveCategories={todoState.saveCategories}
          todoPanelOpen={todoPanelOpen}
          onOpenTodoPanel={() => setTodoPanelOpen(true)}
          floating
        />
      )}
    </div>
  );
}
