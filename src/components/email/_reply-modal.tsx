import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useDragControls } from "motion/react";
import { formatRelative, cn, useIsMobile } from "../../lib";
import { EmailContentRenderer } from "./_email-content-renderer";
import { Drawer } from "../ui/_drawer";

const DISMISS_THRESHOLD = 100;
const VELOCITY_THRESHOLD = 400;
const openSpring = { type: "spring" as const, stiffness: 260, damping: 32 };

interface ThreadMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  date: string;
  bodyHtml: string;
  bodyText: string;
  unread: boolean;
  labelIds: string[];
  messageIdHeader?: string;
  attachments?: { attachmentId: string; filename: string; mimeType: string; size: number }[];
}

const AVATAR_COLORS = [
  "#6d86d3", "#7c3aed", "#059669", "#d97706",
  "#e11d48", "#0891b2", "#db2777", "#4f46e5",
  "#0d9488", "#ea580c",
];

function hashStr(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function parseSender(from: string): { name: string; email: string; initials: string } {
  const match = from.match(/^"?([^"<]+)"?\s*<([^>]+)>$/);
  const name = match ? match[1].trim() : from.split("@")[0];
  const email = match ? match[2] : from;
  const parts = name.split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  return { name, email, initials };
}

function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

interface ReplyModalProps {
  open: boolean;
  threadId: string;
  accountEmail?: string;
  onDismiss: () => void;
  onSent?: () => void;
}

export function ReplyModal({ open, threadId, accountEmail, onDismiss, onSent }: ReplyModalProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer
        open={open && !!threadId}
        onOpenChange={(o) => { if (!o) onDismiss(); }}
      >
        <Drawer.Content className="h-[95dvh]">
          {open && threadId && (
            <ReplyModalContent
              key={`reply-${threadId}`}
              threadId={threadId}
              accountEmail={accountEmail}
              onDismiss={onDismiss}
              onSent={onSent}
              isMobile
            />
          )}
        </Drawer.Content>
      </Drawer>
    );
  }

  return (
    <AnimatePresence>
      {open && threadId && (
        <ReplyModalInner
          key={`reply-${threadId}`}
          threadId={threadId}
          accountEmail={accountEmail}
          onDismiss={onDismiss}
          onSent={onSent}
        />
      )}
    </AnimatePresence>
  );
}

function ReplyModalInner(props: Omit<ReplyModalProps, "open">) {
  return <ReplyModalContent {...props} isMobile={false} />;
}

function ReplyModalContent({
  threadId,
  accountEmail,
  onDismiss,
  onSent,
  isMobile,
}: Omit<ReplyModalProps, "open"> & { isMobile: boolean }) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragControls = useDragControls();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const accountParam = accountEmail ? `?account=${encodeURIComponent(accountEmail)}` : "";
        const res = await fetch(`/api/threads/${threadId}${accountParam}`);
        if (!res.ok) {
          if (res.status === 401) {
            window.location.assign("/logout");
            return;
          }
          throw new Error(`Failed to load thread (${res.status})`);
        }
        const data = (await res.json()) as { id: string; messages: ThreadMessage[] };
        if (!cancelled) {
          const sorted = data.messages.sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
          );
          setMessages(sorted);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load thread");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [threadId, accountEmail]);

  useEffect(() => {
    if (!loading && messages.length > 0 && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [loading, messages.length]);

  const latestMessage = messages.length > 0 ? messages[0] : null;
  const replyTo = latestMessage ? extractEmail(latestMessage.from) : "";
  const subject = latestMessage
    ? latestMessage.subject.startsWith("Re:")
      ? latestMessage.subject
      : `Re: ${latestMessage.subject}`
    : "";

  const handleSend = useCallback(async () => {
    if (!replyBody.trim() || !latestMessage) return;

    setSending(true);
    setSendError(null);

    try {
      const accountParam = accountEmail ? `?account=${encodeURIComponent(accountEmail)}` : "";
      const res = await fetch(`/api/threads/${threadId}/reply${accountParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: replyBody,
          to: replyTo,
          subject,
          inReplyTo: latestMessage.messageIdHeader || latestMessage.id,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || `Failed to send (${res.status})`);
      }

      setSent(true);
      onSent?.();
      setTimeout(onDismiss, 1500);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }, [replyBody, latestMessage, threadId, accountEmail, replyTo, subject, onDismiss, onSent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const titleBar = (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-3 border-b border-border-100 px-5 py-3",
        !isMobile && "cursor-grab active:cursor-grabbing",
      )}
      style={isMobile ? undefined : { touchAction: "none" }}
      onPointerDown={isMobile ? undefined : (e) => dragControls.start(e)}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500">
            <polyline points="9 17 4 12 9 7" />
            <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-foreground-100">Reply</span>
      </div>
      {!isMobile && (
        <button type="button" onClick={onDismiss} aria-label="Close" className="rounded-full p-1.5 text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );

  const replyComposer = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border-100 px-4 py-3">
        {latestMessage && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-foreground-300">To:</span>
            <span className="truncate text-sm text-foreground-200">{parseSender(latestMessage.from).name}</span>
            <span className="truncate text-xs text-foreground-300">&lt;{replyTo}&gt;</span>
          </div>
        )}
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-foreground-300">Subject:</span>
          <span className="truncate text-sm text-foreground-200">{subject}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-4">
        <textarea
          ref={textareaRef}
          value={replyBody}
          onChange={(e) => setReplyBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write your reply..."
          disabled={sending || sent}
          className="h-full min-h-[200px] w-full resize-none rounded-xl border border-border-100 bg-background-200 p-4 text-sm text-foreground-100 outline-none transition-colors placeholder:text-foreground-300 focus:border-blue-300 focus:bg-background-100 lg:min-h-0 dark:focus:border-blue-700"
        />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-100 px-4 py-3">
        {sendError && <p className="truncate text-xs text-red-500">{sendError}</p>}
        {sent && (
          <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            Sent
          </div>
        )}
        {!sendError && !sent && <div />}
        <button type="button" onClick={handleSend} disabled={!replyBody.trim() || sending || sent} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
          {sending ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          )}
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
      <div className="shrink-0 px-4 pb-3">
        <p className="text-[11px] text-foreground-300">{navigator.platform?.includes("Mac") ? "⌘" : "Ctrl"}+Enter to send</p>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {titleBar}
        {replyComposer}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    );
  }

  return (
    <>
      <motion.div
        key="reply-modal-backdrop"
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        onClick={onDismiss}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <motion.div
          key="reply-modal-sheet"
          className="pointer-events-auto flex w-full max-w-[860px] flex-col overflow-hidden rounded-3xl border border-border-100/70 bg-background-100 shadow-2xl"
          style={{ height: "85dvh", transformOrigin: "top center" }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "110%" }}
          transition={openSpring}
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.04, bottom: 0.5 }}
          onDragEnd={(_e, info) => {
            if (info.offset.y > DISMISS_THRESHOLD || info.velocity.y > VELOCITY_THRESHOLD) {
              onDismiss();
            }
          }}
        >
          {titleBar}

          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div className="min-h-0 flex-1 overflow-y-auto border-b border-border-100 md:border-b-0 md:border-r">
              {loading && <SkeletonLoader />}
              {error && (
                <div className="flex items-center justify-center p-8"><p className="text-sm text-red-500">{error}</p></div>
              )}
              {!loading && !error && latestMessage && (
                <div className="px-5 py-4">
                  <h2 className="text-base font-semibold text-foreground-100">{latestMessage.subject || "(no subject)"}</h2>
                  <MessageCard message={latestMessage} />
                  {messages.length > 1 && <OlderMessages messages={messages.slice(1)} />}
                </div>
              )}
            </div>

            <div className="flex w-full flex-col md:w-[340px] lg:w-[380px]">
              {replyComposer}
            </div>
          </div>

          <div className="h-[env(safe-area-inset-bottom)]" />
        </motion.div>
      </div>
    </>
  );
}

function MessageCard({ message }: { message: ThreadMessage }) {
  const sender = parseSender(message.from);
  const avatarColor = AVATAR_COLORS[hashStr(message.from) % AVATAR_COLORS.length];

  return (
    <div className="mt-3">
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
          style={{ backgroundColor: avatarColor }}
        >
          {sender.initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-foreground-100">
              {sender.name}
            </span>
<span className="truncate text-xs text-foreground-300">
                      &lt;{sender.email}&gt;
                    </span>
          </div>
          <div className="text-xs text-foreground-300">
            {formatRelative(message.date)}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <EmailContentRenderer
          bodyHtml={message.bodyHtml}
          bodyText={message.bodyText}
          trimQuotes
          attachments={message.attachments}
          messageId={message.id}
          accountEmail={accountEmail}
        />
      </div>
    </div>
  );
}

function OlderMessages({ messages }: { messages: ThreadMessage[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-4 border-t border-border-100 pt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("transition-transform", expanded && "rotate-180")}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        {messages.length} earlier message{messages.length > 1 ? "s" : ""}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className="border-t border-border-100/40 py-3"
              >
                <MessageCard message={msg} />
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SkeletonLoader() {
  return (
    <div className="animate-pulse space-y-4 px-5 py-5">
      <div className="h-5 w-3/4 rounded bg-background-300" />
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-background-300" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 w-32 rounded bg-background-300" />
          <div className="h-3 w-48 rounded bg-background-200" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3.5 w-full rounded bg-background-200" />
        <div className="h-3.5 w-5/6 rounded bg-background-200" />
        <div className="h-3.5 w-4/6 rounded bg-background-200" />
      </div>
    </div>
  );
}
