import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn, useIsMobile } from "../../lib";
import {
  getTimeGroup,
  type ConversationSummary,
} from "../../lib/_use-conversations";
import { SwipeableEmailRow } from "../ui/_swipeable-email-row";

interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  archivedConversations: ConversationSummary[];
  activeConversationId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  activeCategory?: string | null;
}

export function ConversationSidebar({
  conversations,
  archivedConversations,
  activeConversationId,
  onNewChat,
  onSelect,
  onArchive,
  onUnarchive,
  activeCategory,
}: ConversationSidebarProps) {
  const isMobile = useIsMobile();
  const [visibleCount, setVisibleCount] = useState(5);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    Yesterday: true,
    "Previous 7 days": true,
    Older: true,
  });
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  const filteredConversations = activeCategory
    ? conversations.filter((c) => c.category === activeCategory)
    : conversations;

  const filteredArchived = activeCategory
    ? archivedConversations.filter((c) => c.category === activeCategory)
    : archivedConversations;

  const headerLabel = activeCategory ? `${activeCategory} Chats` : "Chats";

  return (
    <aside className={cn(
      "flex flex-col",
      isMobile ? "h-full w-full" : "sticky top-4 h-fit w-full shrink-0 pt-8",
    )}>
      {/* Header — hidden on mobile since the drawer has its own title */}
      {!isMobile && (
        <div className="sticky top-0 z-20 bg-background-100 px-2 pb-3">
          <div className="mb-2 flex items-center justify-between px-3">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/70">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-300/50">
                {headerLabel}
              </span>
            </div>
            {filteredConversations.length > 0 && (
              <span className="text-[10px] text-foreground-300/40">
                {filteredConversations.length}
              </span>
            )}
          </div>
        </div>
      )}

      <nav className={cn(
        "overflow-y-auto pb-3",
        isMobile ? "min-h-0 flex-1 px-1" : "max-h-[calc(100dvh-20vh)] px-2",
      )}>
        {filteredConversations.length === 0 && filteredArchived.length === 0 ? (
          <div className={cn("flex flex-col items-center justify-center text-center", isMobile ? "py-16" : "px-3 py-12")}>
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="mb-3 text-foreground-300/30">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            <p className="text-sm font-medium text-foreground-300/60">
              {activeCategory ? `No ${activeCategory} conversations yet` : "No conversations yet"}
            </p>
            <p className="mt-1 text-xs text-foreground-300/40">Start a new chat to get going</p>
          </div>
        ) : (
          <>
            <GroupedConversationList
              conversations={filteredConversations.slice(0, visibleCount)}
              activeId={activeConversationId}
              collapsedGroups={collapsedGroups}
              onToggleGroup={(group) =>
                setCollapsedGroups((prev) => ({
                  ...prev,
                  [group]: !prev[group],
                }))
              }
              onSelect={onSelect}
              onArchive={onArchive}
              isMobile={isMobile}
            />

            {filteredConversations.length > 5 && (
              <div className="mt-2 px-3">
                {visibleCount < filteredConversations.length ? (
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleCount((v) =>
                        Math.min(v + 5, filteredConversations.length),
                      )
                    }
                    className={cn("text-foreground-300/50 transition-colors hover:text-foreground-200", isMobile ? "text-sm" : "text-[12px]")}
                  >
                    Show more ({filteredConversations.length - visibleCount} remaining)
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setVisibleCount(5)}
                    className={cn("text-foreground-300/50 transition-colors hover:text-foreground-200", isMobile ? "text-sm" : "text-[12px]")}
                  >
                    Show less
                  </button>
                )}
              </div>
            )}

            {filteredArchived.length > 0 && (
              <>
                <div className="mx-3 my-3 border-t border-foreground-300/10" />
                <button
                  type="button"
                  onClick={() => setArchivedExpanded((v) => !v)}
                  className={cn(
                    "mb-1 flex w-full items-center gap-1.5 px-3 font-medium uppercase tracking-wider text-foreground-300/50 transition-colors hover:text-foreground-300",
                    isMobile ? "py-2 text-xs" : "text-[11px]",
                  )}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0 transition-transform duration-200", archivedExpanded ? "rotate-0" : "-rotate-90")}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                  Archived
                  <span className="ml-auto text-[10px] font-normal normal-case tracking-normal text-foreground-300/40">
                    {filteredArchived.length}
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {archivedExpanded && (
                    <motion.div
                      key="archived-list"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.8 }}
                      className="overflow-hidden"
                    >
                      <ArchivedConversationList
                        conversations={filteredArchived}
                        onSelect={(id) => {
                          onUnarchive(id);
                          onSelect(id);
                        }}
                        isMobile={isMobile}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </>
        )}
      </nav>

      {/* New chat button — sticky bottom on mobile, inline on desktop */}
      <div className={cn(
        isMobile
          ? "sticky bottom-0 border-t border-border-100/60 bg-background-100/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-lg"
          : "px-2 pt-8",
      )}>
        <button
          type="button"
          onClick={onNewChat}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-xl font-medium transition-colors",
            isMobile
              ? "bg-accent-100 py-3.5 text-sm text-white active:bg-accent-100/90"
              : "bg-background-200 px-3 py-2 text-[13px] text-foreground-300/70 hover:bg-foreground-100/10 hover:text-foreground-200",
          )}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width={isMobile ? 18 : 15} height={isMobile ? 18 : 15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New chat
        </button>
      </div>
    </aside>
  );
}

function GroupedConversationList({
  conversations,
  activeId,
  collapsedGroups,
  onToggleGroup,
  onSelect,
  onArchive,
  isMobile,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (group: string) => void;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
  isMobile: boolean;
}) {
  const grouped = new Map<string, ConversationSummary[]>();
  for (const c of conversations) {
    const g = getTimeGroup(c.updatedAt);
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(c);
  }

  let groupIdx = 0;
  return Array.from(grouped.entries()).map(([group, items]) => {
    const gi = groupIdx++;
    const isCollapsed = !!collapsedGroups[group];
    return (
      <div key={group}>
        {gi > 0 && <div className="mx-3 my-3 border-t border-foreground-300/10" />}
        <button
          type="button"
          onClick={() => onToggleGroup(group)}
          className={cn(
            "mb-1 flex w-full items-center gap-1.5 px-3 font-medium uppercase tracking-wider text-foreground-300/50 transition-colors hover:text-foreground-300",
            isMobile ? "py-2 text-xs" : "text-[11px]",
          )}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0 transition-transform duration-200", isCollapsed ? "-rotate-90" : "rotate-0")}>
            <path d="M6 9l6 6 6-6" />
          </svg>
          {group}
          {isCollapsed && (
            <span className="ml-auto text-[10px] font-normal normal-case tracking-normal text-foreground-300/40">
              {items.length}
            </span>
          )}
        </button>
        <AnimatePresence initial={false}>
          {!isCollapsed &&
            items.map((conv) => {
              const isActive = conv.id === activeId;
              return (
                <motion.div
                  key={conv.id}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.8 }}
                >
                  <SwipeableEmailRow onArchive={() => onArchive(conv.id)} compact>
                    <div className="group flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => onSelect(conv.id)}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left transition-colors",
                          isMobile ? "px-3 py-3.5 text-[15px]" : "px-3 py-2.5 text-[13.5px]",
                          isActive
                            ? "bg-foreground-100/8 font-medium text-foreground-100"
                            : "text-foreground-300/80 hover:text-foreground-200",
                        )}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width={isMobile ? 18 : 16} height={isMobile ? 18 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">
                          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                        </svg>
                        <span className="flex-1 truncate">{conv.title}</span>
                      </button>
                      {!isMobile && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onArchive(conv.id);
                          }}
                          className="shrink-0 rounded-md p-1 text-transparent transition-all group-hover:text-foreground-300/50 hover:text-foreground-200!"
                          aria-label="Archive conversation"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 8V21H3V8" />
                            <path d="M1 3h22v5H1z" />
                            <path d="M10 12h4" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </SwipeableEmailRow>
                </motion.div>
              );
            })}
        </AnimatePresence>
      </div>
    );
  });
}

function ArchivedConversationList({
  conversations,
  onSelect,
  isMobile,
}: {
  conversations: ConversationSummary[];
  onSelect: (id: string) => void;
  isMobile: boolean;
}) {
  const grouped = new Map<string, ConversationSummary[]>();
  for (const c of conversations) {
    const g = getTimeGroup(c.updatedAt);
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(c);
  }

  let groupIdx = 0;
  return Array.from(grouped.entries()).map(([group, items]) => {
    const gi = groupIdx++;
    return (
      <div key={group}>
        {gi > 0 && <div className="mx-3 my-2 border-t border-foreground-300/5" />}
        <div className="mb-0.5 px-3 pt-1 text-[10px] font-medium uppercase tracking-wider text-foreground-300/35">
          {group}
        </div>
        {items.map((conv) => (
          <motion.div
            key={conv.id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.8 }}
          >
            <button
              type="button"
              onClick={() => onSelect(conv.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg text-left text-foreground-300/50 transition-colors hover:text-foreground-200",
                isMobile ? "px-3 py-3.5 text-[15px]" : "px-3 py-2.5 text-[13px]",
              )}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width={isMobile ? 16 : 14} height={isMobile ? 16 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-40">
                <path d="M21 8V21H3V8" />
                <path d="M1 3h22v5H1z" />
                <path d="M10 12h4" />
              </svg>
              <span className="flex-1 truncate">{conv.title}</span>
            </button>
          </motion.div>
        ))}
      </div>
    );
  });
}
