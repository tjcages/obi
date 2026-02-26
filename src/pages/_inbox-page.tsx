import { useCallback, useRef, useState } from "react";
import {
  AccountBadges,
  EmailModal,
  InboxList,
  parseSenderName,
  type InboxListHandle,
  type ThreadGroup,
} from "../components";
import { useNavStackContext } from "../components/nav-stack";
import type { ComposeMode } from "../components/email/_email-modal";
import { cn, useAccounts, useUndoRedo } from "../lib";

interface InboxPageProps {
  userId: string;
}

export default function InboxPage({ userId }: InboxPageProps) {
  const navCtx = useNavStackContext();
  const accounts = useAccounts();
  const { pushUndo } = useUndoRedo();
  const inboxListRef = useRef<InboxListHandle>(null);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedAccountEmail, setSelectedAccountEmail] = useState<string | undefined>(undefined);
  const [initialComposeMode, setInitialComposeMode] = useState<ComposeMode | undefined>(undefined);

  const handleEmailClick = useCallback((thread: ThreadGroup) => {
    setSelectedThreadId(thread.threadId);
    setSelectedAccountEmail(thread.representative.accountEmail);
  }, []);

  const archiveThreads = useCallback(
    (threadIds: string[], accountParams: string[], _senderNames: string[], label: string) => {
      for (let i = 0; i < threadIds.length; i++) {
        void fetch(`/api/threads/${threadIds[i]}/archive${accountParams[i]}`, { method: "POST" });
        inboxListRef.current?.hideThread(threadIds[i]);
      }

      pushUndo({
        id: `archive-${threadIds.join("-")}-${Date.now()}`,
        label,
        onUndo: () => {
          for (let i = 0; i < threadIds.length; i++) {
            inboxListRef.current?.unhideThread(threadIds[i]);
            void fetch(`/api/threads/${threadIds[i]}/unarchive${accountParams[i]}`, { method: "POST" });
          }
        },
        onRedo: () => {
          for (let i = 0; i < threadIds.length; i++) {
            void fetch(`/api/threads/${threadIds[i]}/archive${accountParams[i]}`, { method: "POST" });
            inboxListRef.current?.hideThread(threadIds[i]);
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

  const handleReplyEmail = useCallback((thread: ThreadGroup) => {
    setSelectedThreadId(thread.threadId);
    setSelectedAccountEmail(thread.representative.accountEmail);
    setInitialComposeMode("reply-all");
  }, []);

  const emailModalOpen = !!selectedThreadId;

  return (
    <div className={cn("overflow-y-auto bg-background-100 text-foreground-100", navCtx ? "h-full" : "h-dvh")}>
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border-100/60 bg-background-100/80 px-4 py-2.5 backdrop-blur-lg lg:px-5 lg:py-3">
        <div className="flex items-center gap-2">
          {navCtx ? (
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
          ) : (
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
        </div>
        <h1 className="text-sm font-semibold text-foreground-100">Inbox</h1>
        <div className="w-20" />
      </header>

      <div className="mx-auto max-w-2xl px-1.5 py-4 sm:px-2.5">
        {accounts.accounts.length > 1 && (
          <div className="mb-4">
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
      </div>

      <EmailModal
        open={emailModalOpen}
        threadId={selectedThreadId ?? ""}
        accountEmail={selectedAccountEmail}
        pushed={false}
        initialComposeMode={initialComposeMode}
        onDismiss={() => { setSelectedThreadId(null); setSelectedAccountEmail(undefined); setInitialComposeMode(undefined); }}
        onArchive={selectedThreadId ? () => {
          const accountParam = selectedAccountEmail
            ? `?account=${encodeURIComponent(selectedAccountEmail)}`
            : "";
          archiveThreads([selectedThreadId], [accountParam], ["email"], "Archived email");
        } : undefined}
        onChatAbout={() => {}}
      />
    </div>
  );
}
