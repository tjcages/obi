import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animate, AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import {
  CategoryWorkspace,
  EmailModal,
  Header,
  SlackThreadModal,
} from "../components";
import { useNavStackContext } from "../components/nav-stack";
import {
  cn,
  useAccounts,
  useConversations,
  useIsMobile,
  useTodos,
  useWorkspace,
  setCustomCategoryColors,
  type FeedItem,
  type TodoItem,
  type TodoSlackRef,
} from "../lib";
import type { ComposeMode } from "../components/email/_email-modal";
import { parseSenderName } from "../components/email/_email-row";

interface ProjectPageProps {
  userId: string;
  projectName?: string;
}

export default function ProjectPage({ userId, projectName: projectNameProp }: ProjectPageProps) {
  const navCtx = useNavStackContext();
  const projectName = projectNameProp ?? decodeURIComponent(
    window.location.pathname.replace(/^\/projects\//, ""),
  );

  const accounts = useAccounts();
  const todoState = useTodos();
  const conv = useConversations({ userId });
  const workspace = useWorkspace(projectName);
  const isMobile = useIsMobile();

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedAccountEmail, setSelectedAccountEmail] = useState<string | undefined>(undefined);
  const [initialComposeMode, setInitialComposeMode] = useState<ComposeMode | undefined>(undefined);
  const [slackModalRef, setSlackModalRef] = useState<TodoSlackRef[] | null>(null);

  useEffect(() => {
    setCustomCategoryColors(todoState.preferences.categoryColors ?? {});
  }, [todoState.preferences.categoryColors]);

  useEffect(() => {
    void fetch("/api/workspace/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: projectName }),
    });
  }, [projectName]);

  const handleStartConversation = useCallback(
    (title: string, prompt: string) => {
      conv.startConversation(title, prompt, projectName);
      setSelectedThreadId(null);
    },
    [conv.startConversation, projectName],
  );

  const handleChatAboutEmail = useCallback(
    (email: { from: string; subject: string; snippet: string }) => {
      const { name: senderName } = parseSenderName(email.from);
      const title = `Re: ${email.subject || senderName}`.slice(0, 64);
      const prompt = `Tell me about this email from ${senderName} with subject "${email.subject}". The snippet says: "${email.snippet}"`;
      conv.startConversation(title, prompt, projectName);
    },
    [conv.startConversation, projectName],
  );

  const handleCompleteTodo = useCallback(
    async (id: string) => {
      await todoState.completeTodo(id);
    },
    [todoState],
  );

  const handleUncompleteTodo = useCallback(
    async (id: string) => {
      await todoState.uncompleteTodo(id);
    },
    [todoState],
  );

  const handleDeleteTodo = useCallback(
    (id: string) => {
      void todoState.deleteTodo(id);
    },
    [todoState],
  );

  const navigateToProject = useCallback((newName: string) => {
    window.location.href = `/projects/${encodeURIComponent(newName)}`;
  }, []);

  const feed = workspace.workspace?.feed ?? [];
  const linkItems = useMemo(() => feed.filter((i) => i.type === "link"), [feed]);
  const fileItems = useMemo(() => feed.filter((i) => i.type === "file"), [feed]);
  const hasResources = linkItems.length > 0 || fileItems.length > 0;

  const workspaceContent = (
    <CategoryWorkspace
      category={projectName}
      allCategories={todoState.preferences.todoCategories ?? []}
      onBack={() => { if (navCtx) navCtx.pop(); else window.location.href = "/"; }}
      onEmailClick={(threadId, accountEmail) => {
        setSelectedThreadId(threadId);
        setSelectedAccountEmail(accountEmail);
      }}
      workspace={workspace}
      todos={todoState.todos}
      onCompleteTodo={handleCompleteTodo}
      onUncompleteTodo={handleUncompleteTodo}
      onDeleteTodo={handleDeleteTodo}
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
        navigateToProject(newName);
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
        if (navCtx) navCtx.pop(); else window.location.href = "/";
      }}
      hideDesktopResources={isMobile}
    />
  );

  return (
    <div className={cn("flex flex-col bg-background-100 text-foreground-100", navCtx ? "h-full" : "h-dvh")}>
      <Header
        accounts={accounts.accounts}
        activeEmails={accounts.activeEmails}
        onMemoryToggle={() => {}}
        onTodoToggle={() => {}}
        inboxActive={false}
        todoActive={false}
        onInboxToggle={() => {}}
        onChatsToggle={() => {}}
        activeCategoryWorkspace={projectName}
        onBackFromCategory={() => { if (navCtx) navCtx.pop(); else window.location.href = "/"; }}
        onSelectAccount={accounts.selectAccount}
        onSelectAll={accounts.selectAllAccounts}
        onSetPrimary={accounts.setPrimary}
        onAddAccount={accounts.addAccount}
        onRemoveAccount={accounts.removeAccount}
        onUpdateLabel={accounts.updateLabel}
      />

      {isMobile && hasResources ? (
        <ProjectCarousel
          feedContent={workspaceContent}
          linkItems={linkItems}
          fileItems={fileItems}
          onDeleteItem={workspace.deleteItem}
        />
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <motion.div
            className="mx-auto max-w-2xl px-4 pb-16"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {workspaceContent}
          </motion.div>
        </main>
      )}

      <EmailModal
        open={!!selectedThreadId}
        threadId={selectedThreadId ?? ""}
        accountEmail={selectedAccountEmail}
        pushed={false}
        initialComposeMode={initialComposeMode}
        onDismiss={() => { setSelectedThreadId(null); setSelectedAccountEmail(undefined); setInitialComposeMode(undefined); }}
        onChatAbout={handleChatAboutEmail}
        onPinToWorkspace={(email) => {
          void workspace.pinEmail(email);
        }}
      />

      <SlackThreadModal
        open={!!slackModalRef}
        slackRef={slackModalRef?.[0] ?? null}
        onDismiss={() => setSlackModalRef(null)}
      />
    </div>
  );
}

// ── Project Carousel (Feed ↔ Resources) ──

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ProjectCarousel({
  feedContent,
  linkItems,
  fileItems,
  onDeleteItem,
}: {
  feedContent: React.ReactNode;
  linkItems: FeedItem[];
  fileItems: FeedItem[];
  onDeleteItem: (id: string) => Promise<void>;
}) {
  const offsetX = useMotionValue(0);
  const currentPageRef = useRef(0);
  const [currentLabel, setCurrentLabel] = useState("Feed");
  const containerRef = useRef<HTMLDivElement>(null);
  const pageWidthRef = useRef(0);
  const [pageWidth, setPageWidth] = useState(0);

  const pages = useMemo(() => {
    const p = [{ id: "feed", label: "Feed" }];
    if (linkItems.length > 0 || fileItems.length > 0) {
      p.push({ id: "resources", label: "Resources" });
    }
    return p;
  }, [linkItems.length, fileItems.length]);

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
      setCurrentLabel(pages[targetPage]?.label ?? "");
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

  const progress = useTransform(offsetX, (ox) => {
    if (pageWidth === 0) return 0;
    return -ox / pageWidth;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Dot indicator + label */}
      {pages.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 pt-1 pb-1">
          {pages.map((p, i) => (
            <ProjectDot key={p.id} index={i} progress={progress} />
          ))}
        </div>
      )}

      {/* Carousel track */}
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
        <motion.div className="flex h-full" style={{ x: offsetX }}>
          {/* Page 1: Feed */}
          <ProjectPage_
            index={0}
            offsetX={offsetX}
            pageWidth={pageWidth}
          >
            <div className="mx-auto max-w-2xl px-4 pb-16">
              {feedContent}
            </div>
          </ProjectPage_>

          {/* Page 2: Resources */}
          {(linkItems.length > 0 || fileItems.length > 0) && (
            <ProjectPage_
              index={1}
              offsetX={offsetX}
              pageWidth={pageWidth}
            >
              <ResourcesPage
                linkItems={linkItems}
                fileItems={fileItems}
                onDelete={onDeleteItem}
              />
            </ProjectPage_>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function ProjectDot({
  index,
  progress,
}: {
  index: number;
  progress: ReturnType<typeof useTransform<number, number>>;
}) {
  const width = useTransform(progress, (p) => {
    const dist = Math.abs(p - index);
    return 6 + Math.max(0, 1 - dist) * 14;
  });
  const opacity = useTransform(progress, (p) => {
    const dist = Math.abs(p - index);
    return 0.2 + Math.max(0, 1 - dist) * 0.8;
  });

  return (
    <motion.div
      className="h-[6px] rounded-full bg-foreground-100"
      style={{ width, opacity }}
    />
  );
}

function ProjectPage_({
  children,
  index,
  offsetX,
  pageWidth,
}: {
  children: React.ReactNode;
  index: number;
  offsetX: ReturnType<typeof useMotionValue<number>>;
  pageWidth: number;
}) {
  const scale = useTransform(offsetX, (ox) => {
    if (pageWidth === 0) return 1;
    const viewPos = -ox;
    const pageCenter = index * pageWidth;
    const dist = Math.abs(viewPos - pageCenter) / pageWidth;
    return 1 - Math.min(dist, 1) * 0.04;
  });

  const borderRadius = useTransform(offsetX, (ox) => {
    if (pageWidth === 0) return 0;
    const viewPos = -ox;
    const pageCenter = index * pageWidth;
    const dist = Math.abs(viewPos - pageCenter) / pageWidth;
    return Math.min(dist, 1) * 20;
  });

  const pageOpacity = useTransform(offsetX, (ox) => {
    if (pageWidth === 0) return 1;
    const viewPos = -ox;
    const pageCenter = index * pageWidth;
    const dist = Math.abs(viewPos - pageCenter) / pageWidth;
    return 1 - Math.min(dist, 1) * 0.12;
  });

  return (
    <motion.div
      className="h-full shrink-0 overflow-y-auto overscroll-contain"
      style={{
        width: pageWidth || "100%",
        scale,
        borderRadius,
        opacity: pageOpacity,
      }}
    >
      {children}
    </motion.div>
  );
}

// ── Resources Page (swipe-to page) ──

function ResourcesPage({
  linkItems,
  fileItems,
  onDelete,
}: {
  linkItems: FeedItem[];
  fileItems: FeedItem[];
  onDelete: (id: string) => Promise<void>;
}) {
  const hasLinks = linkItems.length > 0;
  const hasFiles = fileItems.length > 0;

  return (
    <div className="mx-auto max-w-2xl px-4 pt-4 pb-16">
      {/* Links */}
      {hasLinks && (
        <div>
          <div className="mb-2 flex items-center gap-2 px-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/50">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span className="text-[13px] font-medium text-foreground-200">Links</span>
            <span className="text-[11px] text-foreground-300/40">{linkItems.length}</span>
          </div>
          <div className="space-y-0.5">
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
                    className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors active:bg-foreground-100/5"
                  >
                    <img
                      src={faviconSrc}
                      alt=""
                      className="h-5 w-5 shrink-0 rounded-md"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] text-foreground-100">
                        {ref.title || hostname}
                      </div>
                      <div className="truncate text-[12px] text-foreground-300/40">
                        {hostname}
                      </div>
                    </div>
                  </a>
                  <button
                    type="button"
                    onClick={() => void onDelete(item.id)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-foreground-300/30 opacity-0 transition-opacity group-hover/link:opacity-100 hover:text-red-500"
                    title="Remove"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Divider */}
      {hasLinks && hasFiles && (
        <div className="my-4 border-t border-foreground-100/5" />
      )}

      {/* Files */}
      {hasFiles && (
        <div>
          <div className="mb-2 flex items-center gap-2 px-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/50">
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
            </svg>
            <span className="text-[13px] font-medium text-foreground-200">Files</span>
            <span className="text-[11px] text-foreground-300/40">{fileItems.length}</span>
          </div>
          <div className="space-y-0.5">
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
                    className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors active:bg-foreground-100/5"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground-100/5">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300">
                        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] text-foreground-100">
                        {ref.filename}
                      </div>
                      <div className="text-[12px] text-foreground-300/40">
                        {formatFileSize(ref.size)}
                      </div>
                    </div>
                  </a>
                  <button
                    type="button"
                    onClick={() => void onDelete(item.id)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-foreground-300/30 opacity-0 transition-opacity group-hover/file:opacity-100 hover:text-red-500"
                    title="Remove"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasLinks && !hasFiles && (
        <div className="flex items-center justify-center py-20 text-[14px] text-foreground-300/40">
          No links or files yet
        </div>
      )}
    </div>
  );
}
