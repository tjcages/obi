import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GmailChat,
  InboxList,
  MemoryPanel,
  MemoryToggleButton,
  type InboxEmail,
  type ThreadGroup,
} from "../components";
import {
  buildConversationTitle,
  cn,
  useConversations,
} from "../lib";
import { parseSenderName } from "../components/email/_email-row";

type SidebarTab = "inbox" | "chats";

interface ChatPageProps {
  userId: string;
  initialEmail?: InboxEmail | null;
  onClearEmail?: () => void;
}

export default function ChatPage({ userId, initialEmail, onClearEmail }: ChatPageProps) {
  const conv = useConversations({ userId, syncToUrl: true });
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<string | null>(null);
  const [isSidebarDrawerOpen, setIsSidebarDrawerOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("inbox");
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const initialEmailHandled = useRef(false);

  // Handle incoming email prompt
  useEffect(() => {
    if (!initialEmail || initialEmailHandled.current) return;
    initialEmailHandled.current = true;
    const isSearchPrompt = !initialEmail.from && !initialEmail.id;

    let title: string;
    let prompt: string;
    if (isSearchPrompt) {
      title = buildConversationTitle(initialEmail.subject);
      prompt = initialEmail.subject;
    } else {
      const { name: senderName } = parseSenderName(initialEmail.from);
      title = `Re: ${initialEmail.subject || senderName}`.slice(0, 64);
      prompt = `Tell me about this email from ${senderName} with subject "${initialEmail.subject}". The snippet says: "${initialEmail.snippet}"`;
    }

    conv.startConversation(title, prompt);
    onClearEmail?.();
  }, [initialEmail, onClearEmail, conv.startConversation]);

  // Close menus on click outside / escape
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-conversation-menu='true']")) return;
      setOpenConversationMenuId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenConversationMenuId(null);
        setIsSidebarDrawerOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const handleEmailClick = useCallback((thread: ThreadGroup) => {
    const email = thread.representative;
    const { name: senderName } = parseSenderName(email.from);
    const title = `Re: ${email.subject || senderName}`.slice(0, 64);
    const prompt = `Tell me about this email from ${senderName} with subject "${email.subject}". The snippet says: "${email.snippet}"`;
    conv.startConversation(title, prompt);
    setIsSidebarDrawerOpen(false);
    setSidebarTab("chats");
  }, [conv.startConversation]);

  const handleSelectConversation = useCallback((id: string) => {
    conv.selectConversation(id);
    setOpenConversationMenuId(null);
    setIsSidebarDrawerOpen(false);
  }, [conv.selectConversation]);

  const handleCreateConversation = useCallback(() => {
    conv.createBlankConversation();
    setOpenConversationMenuId(null);
    setIsSidebarDrawerOpen(false);
    setSidebarTab("chats");
  }, [conv.createBlankConversation]);

  const handleRename = useCallback((id: string) => {
    const conversation = conv.conversations.find((x) => x.id === id);
    if (!conversation || typeof window === "undefined") return;
    const nextTitle = window.prompt("Rename conversation", conversation.title);
    if (nextTitle === null) return;
    conv.renameConversation(id, nextTitle);
    setOpenConversationMenuId(null);
  }, [conv.conversations, conv.renameConversation]);

  const handleDelete = useCallback((id: string) => {
    if (typeof window === "undefined") return;
    const conversation = conv.conversations.find((x) => x.id === id);
    if (!conversation) return;
    if (!window.confirm(`Delete "${conversation.title}"?`)) return;
    conv.deleteConversation(id);
    setOpenConversationMenuId(null);
  }, [conv.conversations, conv.deleteConversation]);

  const goHome = useCallback(() => {
    window.history.pushState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3 py-3">
        <div className="inline-flex w-full rounded-lg border border-border-100/70 bg-background-200/40 p-0.5">
          {([
            { value: "inbox" as SidebarTab, label: "Inbox" },
            { value: "chats" as SidebarTab, label: `Chats${conv.sortedActive.length > 0 ? ` (${conv.sortedActive.length})` : ""}` },
          ]).map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setSidebarTab(tab.value)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                sidebarTab === tab.value
                  ? "bg-background-100 text-foreground-100 shadow-sm"
                  : "text-foreground-300 hover:text-foreground-200",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sidebarTab === "inbox" ? (
          <InboxList compact onEmailClick={handleEmailClick} maxResults={15} />
        ) : (
          <ConversationList
            conversations={conv.sortedActive}
            activeId={conv.activeConversationId}
            openMenuId={openConversationMenuId}
            onSelect={handleSelectConversation}
            onToggleMenu={(id) => setOpenConversationMenuId((prev) => (prev === id ? null : id))}
            onRename={handleRename}
            onDelete={handleDelete}
            onCreate={handleCreateConversation}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background-100 text-foreground-100">
      <header className="flex shrink-0 items-center justify-between border-b border-border-100/60 bg-background-100/80 px-4 py-2.5 backdrop-blur-lg">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={goHome} aria-label="Back to inbox" className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
          </button>
          <button type="button" onClick={() => setIsSidebarDrawerOpen(true)} aria-label="Open sidebar" className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200 md:hidden">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1 className="text-base font-semibold text-foreground-100">
            <span className="sr-only">chat.inbox.dog</span>
            <img src="https://inbox.dog/logo.svg" alt="chat.inbox.dog" className="h-5 w-auto dark:invert" />
          </h1>
          <button type="button" onClick={handleCreateConversation} className="ml-1 flex h-8 items-center gap-1.5 rounded-lg bg-foreground-100/5 px-3 text-[13px] font-medium text-foreground-200 transition-colors hover:bg-foreground-100/8 hover:text-foreground-100">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New
          </button>
        </div>
        <div className="flex items-center gap-0.5">
          <MemoryToggleButton onClick={() => setMemoryPanelOpen(true)} />
          <a href="/internals" className="flex h-8 items-center rounded-lg px-2.5 text-[12px] font-medium text-foreground-300/60 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200" title="AI Internals Dashboard">Internals</a>
          <a href="/logout" className="flex h-8 items-center rounded-lg px-2.5 text-[12px] text-foreground-300/60 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200">Log out</a>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-border-100/60 bg-background-200/50 md:flex">
          {renderSidebarContent()}
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          {sessionError && (
            <div className="shrink-0 border-b border-destructive-100/20 bg-destructive-100/5 px-4 py-2 text-sm text-destructive-100">
              {sessionError}
            </div>
          )}
          <div className="min-h-0 min-w-0 flex-1">
            <GmailChat
              key={conv.activeConversationId ?? ""}
              userId={userId}
              conversationId={conv.activeConversationId ?? ""}
              conversationReady={!conv.sessionSyncing}
              hasConversation={!!conv.activeConversationId}
              onUserMessage={conv.onConversationMessage}
              onCreateConversation={handleCreateConversation}
              autoSendPrompt={conv.pendingPrompt}
              onAutoSendComplete={conv.clearPendingPrompt}
            />
          </div>
        </div>
      </div>

      {/* Mobile sidebar drawer */}
      {isSidebarDrawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close sidebar" onClick={() => setIsSidebarDrawerOpen(false)} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <aside className="absolute left-0 top-0 flex h-full w-[280px] flex-col border-r border-border-100/40 bg-background-100/95 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between border-b border-border-100/50 px-4 py-3">
              <span className="text-[13px] font-semibold text-foreground-100">Menu</span>
              <button type="button" aria-label="Close" onClick={() => setIsSidebarDrawerOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      <MemoryPanel open={memoryPanelOpen} onClose={() => setMemoryPanelOpen(false)} />
    </div>
  );
}

function ConversationList({
  conversations,
  activeId,
  openMenuId,
  onSelect,
  onToggleMenu,
  onRename,
  onDelete,
  onCreate,
}: {
  conversations: { id: string; title: string }[];
  activeId: string | null;
  openMenuId: string | null;
  onSelect: (id: string) => void;
  onToggleMenu: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
}) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="mb-3 text-foreground-300/25">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
        <p className="text-sm font-medium text-foreground-300/60">No conversations yet</p>
        <p className="mt-1 text-[12px] text-foreground-300/40">Start a chat to get going</p>
        <button type="button" onClick={onCreate} className="mt-4 flex items-center gap-1.5 rounded-lg bg-foreground-100/5 px-4 py-2 text-[13px] font-medium text-foreground-200 transition-colors hover:bg-foreground-100/8 hover:text-foreground-100">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          New conversation
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1">
      {conversations.map((conversation) => {
        const isActive = conversation.id === activeId;
        return (
          <div key={conversation.id} className={cn("group relative flex items-center rounded-lg transition-colors", isActive ? "bg-foreground-100/8" : "hover:bg-foreground-100/4")}>
            <button type="button" onClick={() => onSelect(conversation.id)} className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0", isActive ? "text-foreground-200" : "text-foreground-300/40")}>
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              <span className={cn("flex-1 truncate text-[13.5px]", isActive ? "font-medium text-foreground-100" : "text-foreground-200/80")}>
                {conversation.title}
              </span>
            </button>
            <div className="relative shrink-0 pr-1" data-conversation-menu="true">
              <button
                type="button"
                aria-label={`Actions for ${conversation.title}`}
                onClick={() => onToggleMenu(conversation.id)}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md text-foreground-300/40 transition-all hover:bg-foreground-100/8 hover:text-foreground-200",
                  openMenuId !== conversation.id && "opacity-0 group-hover:opacity-100",
                )}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
              </button>
              {openMenuId === conversation.id && (
                <div className="absolute right-0 z-20 mt-1 w-32 rounded-xl border border-border-100/60 bg-background-100/95 p-1 shadow-xl backdrop-blur-xl">
                  <button type="button" onClick={() => onRename(conversation.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-foreground-200 transition-colors hover:bg-foreground-100/5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
                    Rename
                  </button>
                  <button type="button" onClick={() => onDelete(conversation.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-red-500 transition-colors hover:bg-red-500/5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
