import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { cn, useIsMobile } from "../../lib";
import type { ConnectedAccountPublic } from "../../lib";
import { useNavStackContext } from "../nav-stack";
import { ProfileButton } from "../ui/_profile-button";
import { MemoryToggleButton } from "./_memory-panel";
import { TodoToggleButton } from "../todo/_todo-panel";


interface HeaderProps {
  accounts: ConnectedAccountPublic[];
  activeEmails: string[];
  onMemoryToggle: () => void;
  onTodoToggle: () => void;
  onInboxToggle?: () => void;
  inboxActive?: boolean;
  todoActive?: boolean;
  onChatsToggle?: () => void;
  chatBadge?: number;
  activeCategoryWorkspace?: string | null;
  onBackFromCategory?: () => void;
  onSelectAccount: (email: string) => void;
  onSelectAll: () => void;
  onSetPrimary: (email: string) => void;
  onAddAccount: () => void;
  onRemoveAccount: (email: string) => void;
  onUpdateLabel: (email: string, label: string, color?: string) => void;
}

export function Header({
  accounts,
  activeEmails,
  onMemoryToggle,
  onTodoToggle,
  onInboxToggle,
  inboxActive,
  todoActive,
  onChatsToggle,
  chatBadge,
  activeCategoryWorkspace,
  onBackFromCategory,
  onSelectAccount,
  onSelectAll,
  onSetPrimary,
  onAddAccount,
  onRemoveAccount,
  onUpdateLabel,
}: HeaderProps) {
  const isMobile = useIsMobile();
  const navCtx = useNavStackContext();
  const primaryAccount = accounts.find((a) => a.isPrimary) ?? accounts[0];
  const isSingleAccountView =
    activeEmails.length === 1 && accounts.length > 1;
  const viewingAccount = isSingleAccountView
    ? accounts.find((a) => a.email === activeEmails[0]) ?? primaryAccount
    : primaryAccount;

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border-100/60 px-4 py-2.5 lg:px-5 lg:py-3">
      <div className="flex items-center gap-2">
        {activeCategoryWorkspace && onBackFromCategory ? (
          <button
            type="button"
            onClick={onBackFromCategory}
            className="-ml-2 flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-100"
            aria-label="Back to home"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
        ) : (
          <>
            {typeof window !== "undefined" && window.location.pathname === "/todos" && !navCtx && (
              <a
                href="/"
                className="-ml-2 flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Dashboard
              </a>
            )}
            {navCtx && (
              <button
                type="button"
                onClick={() => navCtx.pop()}
                className="-ml-2 flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Dashboard
              </button>
            )}
            {isSingleAccountView && viewingAccount ? (
              <div className="flex items-center gap-1.5 rounded-full border border-border-100 bg-background-200 px-3 py-1.5 lg:px-2.5 lg:py-1">
                <span
                  className="h-2.5 w-2.5 rounded-full lg:h-2 lg:w-2"
                  style={{ backgroundColor: viewingAccount.color || "#6d86d3" }}
                />
                <span className="text-sm font-medium text-foreground-200 lg:text-xs">
                  {viewingAccount.label || viewingAccount.email.split("@")[0]}
                </span>
                <button
                  type="button"
                  onClick={onSelectAll}
                  className="ml-0.5 rounded-full p-1 text-foreground-300 transition-colors hover:bg-background-300 hover:text-foreground-200"
                  title="Show all accounts"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="flex items-center gap-1 lg:gap-2">
        {/* Mobile-only nav icons — Todo & Memory hide on category pages */}
        {isMobile && (
          <LayoutGroup>
            <div className="flex items-center">
              {onInboxToggle && (
                <motion.button
                  layout
                  key="inbox"
                  type="button"
                  onClick={onInboxToggle}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                    inboxActive ? "text-accent-100 bg-accent-100/10" : "text-foreground-300 hover:bg-background-200 hover:text-foreground-200",
                  )}
                  aria-label="Inbox"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                  </svg>
                </motion.button>
              )}
              <AnimatePresence>
                {!activeCategoryWorkspace && (
                  <motion.button
                    layout
                    key="todos"
                    type="button"
                    onClick={onTodoToggle}
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 40 }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className={cn(
                      "flex h-10 items-center justify-center overflow-hidden rounded-lg transition-colors",
                      todoActive ? "text-accent-100 bg-accent-100/10" : "text-foreground-300 hover:bg-background-200 hover:text-foreground-200",
                    )}
                    aria-label="To-dos"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </motion.button>
                )}
              </AnimatePresence>
              {onChatsToggle && (
                <motion.button
                  layout
                  key="chats"
                  type="button"
                  onClick={onChatsToggle}
                  className="relative flex h-10 w-10 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
                  aria-label="Chats"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {chatBadge != null && chatBadge > 0 && (
                    <span className="absolute right-0.5 top-0.5 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-accent-100 px-1 text-[11px] font-bold text-white lg:right-1 lg:top-1 lg:h-3.5 lg:min-w-[14px] lg:text-[9px]">
                      {chatBadge > 9 ? "9+" : chatBadge}
                    </span>
                  )}
                </motion.button>
              )}
              <AnimatePresence>
                {!activeCategoryWorkspace && (
                  <motion.button
                    layout
                    key="memory"
                    type="button"
                    onClick={onMemoryToggle}
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 40 }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="flex h-10 items-center justify-center overflow-hidden rounded-lg text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
                    aria-label="Memory"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                      <line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </LayoutGroup>
        )}

        {/* Desktop nav buttons */}
        {!isMobile && <TodoToggleButton onClick={onTodoToggle} />}
        {!isMobile && <MemoryToggleButton onClick={onMemoryToggle} />}
        {!isMobile && (
          <a
            href="/internals"
            className="rounded-lg px-2.5 py-1 text-xs font-medium text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
            title="AI Internals Dashboard"
          >
            Internals
          </a>
        )}
        {/* Profile avatar */}
        <ProfileButton
          accounts={accounts}
          activeEmails={activeEmails}
          size={32}
          onSelectAccount={(email) => { if (accounts.length > 1) onSelectAccount(email); }}
          onSelectAll={onSelectAll}
          onSetPrimary={onSetPrimary}
          onAddAccount={onAddAccount}
          onRemoveAccount={onRemoveAccount}
          onUpdateLabel={onUpdateLabel}
        />
      </div>
    </header>
  );
}

