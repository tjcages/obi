import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useDragControls } from "motion/react";
import { formatRelative, cn, useIsMobile } from "../../lib";
import { EmailContentRenderer } from "./_email-content-renderer";
import { RecipientInput, type Recipient } from "./_recipient-input";
import { SchedulePopover } from "../ui/_schedule-popover";
import { Drawer } from "../ui/_drawer";

const DISMISS_THRESHOLD = 100;
const VELOCITY_THRESHOLD = 400;
const openSpring = { type: "spring" as const, stiffness: 260, damping: 32 };

type ComposeMode = "reply-all" | "reply" | "forward";

interface ThreadMessageAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

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
  attachments?: ThreadMessageAttachment[];
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

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk",
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me", "fastmail.com",
  "mail.com", "zoho.com", "yandex.com",
]);

function parseCompany(email: string): { name: string; url: string } | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return null;
  const raw = domain.split(".")[0];
  if (!raw || raw.length < 2) return null;
  return {
    name: raw.charAt(0).toUpperCase() + raw.slice(1),
    url: `https://${domain}`,
  };
}

function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

function extractAllEmails(field: string): Recipient[] {
  if (!field?.trim()) return [];
  return field
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const parsed = parseSender(raw);
      return { email: parsed.email, name: parsed.name !== parsed.email ? parsed.name : undefined };
    });
}

function dedupeRecipients(list: Recipient[], exclude: string[]): Recipient[] {
  const seen = new Set(exclude.map((e) => e.toLowerCase()));
  const result: Recipient[] = [];
  for (const r of list) {
    const key = r.email.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(r);
    }
  }
  return result;
}

const MODE_ICONS: Record<ComposeMode, React.ReactNode> = {
  "reply-all": (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="7 17 2 12 7 7" /><polyline points="12 17 7 12 12 7" /><path d="M22 18v-2a4 4 0 0 0-4-4H7" />
    </svg>
  ),
  reply: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  ),
  forward: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 0 1 4-4h12" />
    </svg>
  ),
};

/* ─── Props ─── */

interface EmailModalProps {
  open: boolean;
  threadId: string;
  accountEmail?: string;
  pushed?: boolean;
  initialComposeMode?: ComposeMode;
  onDismiss: () => void;
  onArchive?: () => void;
  onChatAbout: (email: { from: string; subject: string; snippet: string }) => void;
  onPinToWorkspace?: (email: { messageId: string; threadId: string; from: string; subject: string; snippet: string; date: string }) => void;
  onSent?: () => void;
}

export function EmailModal({ open, threadId, ...rest }: EmailModalProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer
        open={open && !!threadId}
        onOpenChange={(o) => { if (!o) rest.onDismiss(); }}
      >
        <Drawer.Content className="h-[95dvh]">
          {open && threadId && (
            <EmailModalContent key={threadId} threadId={threadId} {...rest} isMobile />
          )}
        </Drawer.Content>
      </Drawer>
    );
  }

  return (
    <AnimatePresence>
      {open && threadId && (
        <EmailModalInner key={threadId} threadId={threadId} {...rest} />
      )}
    </AnimatePresence>
  );
}

/* ─── Desktop Shell ─── */

function EmailModalInner(props: Omit<EmailModalProps, "open">) {
  return <EmailModalContent {...props} isMobile={false} />;
}

/* ─── Content Component (shared by desktop + mobile) ─── */

function EmailModalContent({
  threadId,
  accountEmail,
  pushed,
  initialComposeMode,
  onDismiss,
  onArchive,
  onChatAbout,
  onPinToWorkspace,
  onSent,
  isMobile,
}: Omit<EmailModalProps, "open"> & { isMobile: boolean }) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const dragControls = useDragControls();

  const [composeMode, setComposeMode] = useState<ComposeMode | null>(initialComposeMode ?? null);
  const [body, setBody] = useState("");
  const [toRecipients, setToRecipients] = useState<Recipient[]>([]);
  const [ccRecipients, setCcRecipients] = useState<Recipient[]>([]);
  const [bccRecipients, setBccRecipients] = useState<Recipient[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [scheduledInfo, setScheduledInfo] = useState<{ id: string; date: Date } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scheduleButtonRef = useRef<HTMLButtonElement>(null);

  const isComposing = composeMode !== null;
  const selfEmail = accountEmail?.toLowerCase() ?? "";

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
          if (sorted.length > 0) {
            setExpandedIds(new Set([sorted[0].id]));
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load thread");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [threadId, accountEmail]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const latestMessage = messages.length > 0 ? messages[0] : null;
  const emailSubject = latestMessage?.subject || "Loading...";
  const isThread = messages.length > 1;

  // Compute recipients when compose mode or messages change
  useEffect(() => {
    if (!composeMode || !latestMessage) return;

    const senderEmail = extractEmail(latestMessage.from);
    const senderRecipient: Recipient = {
      email: senderEmail,
      name: parseSender(latestMessage.from).name,
    };

    if (composeMode === "reply") {
      setToRecipients([senderRecipient]);
      setCcRecipients([]);
      setBccRecipients([]);
    } else if (composeMode === "reply-all") {
      const toList = extractAllEmails(latestMessage.to);
      const ccList = extractAllEmails(latestMessage.cc);
      const allTo = [senderRecipient, ...toList];
      const dedupedTo = dedupeRecipients(allTo, [selfEmail]);
      const dedupedCc = dedupeRecipients(ccList, [selfEmail, ...dedupedTo.map((r) => r.email)]);
      setToRecipients(dedupedTo);
      setCcRecipients(dedupedCc);
      setBccRecipients([]);
      if (dedupedCc.length > 0) setShowCcBcc(true);
    } else {
      setToRecipients([]);
      setCcRecipients([]);
      setBccRecipients([]);
    }

    const subjectBase = latestMessage.subject.replace(/^(Re:|Fwd?:)\s*/gi, "").trim();
    setSubject(composeMode === "forward" ? `Fwd: ${subjectBase}` : `Re: ${subjectBase}`);
  }, [composeMode, latestMessage, selfEmail]);

  useEffect(() => {
    if (isComposing && !loading && messages.length > 0) {
      setTimeout(() => textareaRef.current?.focus(), 300);
    }
  }, [isComposing, loading, messages.length]);

  const forwardQuote = useMemo(() => {
    if (composeMode !== "forward" || !latestMessage) return "";
    const sender = parseSender(latestMessage.from);
    const date = new Date(latestMessage.date).toLocaleString();
    const lines = [
      "",
      "---------- Forwarded message ----------",
      `From: ${sender.name} <${sender.email}>`,
      `Date: ${date}`,
      `Subject: ${latestMessage.subject}`,
      `To: ${latestMessage.to}`,
    ];
    if (latestMessage.cc) lines.push(`Cc: ${latestMessage.cc}`);
    lines.push("", latestMessage.bodyText || "(no content)");
    return lines.join("\n");
  }, [composeMode, latestMessage]);

  const closeCompose = useCallback(() => {
    setComposeMode(null);
    setBody("");
    setSendError(null);
    setSent(false);
    setScheduledInfo(null);
    setCancelling(false);
    setScheduleOpen(false);
  }, []);

  const openCompose = useCallback((mode: ComposeMode) => {
    setComposeMode(mode);
    setBody("");
    setSendError(null);
    setSent(false);
    setScheduledInfo(null);
    setCancelling(false);
  }, []);

  const handleSend = useCallback(async (scheduleDate?: Date) => {
    if (!body.trim() && composeMode !== "forward") return;
    if (toRecipients.length === 0) return;
    if (!latestMessage) return;

    setSending(true);
    setSendError(null);

    try {
      const accountParam = accountEmail ? `?account=${encodeURIComponent(accountEmail)}` : "";
      const isForward = composeMode === "forward";
      const fullBody = isForward ? body + forwardQuote : body;

      let endpoint: string;
      if (scheduleDate) {
        endpoint = "schedule";
      } else if (isForward) {
        endpoint = "forward";
      } else {
        endpoint = "reply";
      }

      const payload: Record<string, unknown> = {
        body: fullBody,
        to: toRecipients.map((r) => r.email).join(", "),
        subject,
        inReplyTo: isForward ? undefined : (latestMessage.messageIdHeader || latestMessage.id),
      };

      if (ccRecipients.length > 0) {
        payload.cc = ccRecipients.map((r) => r.email).join(", ");
      }
      if (bccRecipients.length > 0) {
        payload.bcc = bccRecipients.map((r) => r.email).join(", ");
      }
      if (scheduleDate) {
        payload.scheduledAt = scheduleDate.toISOString();
      }

      const res = await fetch(`/api/threads/${threadId}/${endpoint}${accountParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || `Failed to send (${res.status})`);
      }

      if (scheduleDate) {
        const data = (await res.json()) as { scheduled?: { id: string } };
        setScheduledInfo({ id: data.scheduled?.id ?? "", date: scheduleDate });
      } else {
        const sentMessage: ThreadMessage = {
          id: `sent_${Date.now()}`,
          threadId,
          from: accountEmail || selfEmail,
          to: toRecipients.map((r) => r.name ? `${r.name} <${r.email}>` : r.email).join(", "),
          cc: ccRecipients.map((r) => r.email).join(", "),
          subject,
          snippet: fullBody.slice(0, 120),
          date: new Date().toISOString(),
          bodyHtml: "",
          bodyText: fullBody,
          unread: false,
          labelIds: ["SENT"],
        };
        setMessages((prev) => [sentMessage, ...prev]);
        setExpandedIds((prev) => new Set([sentMessage.id, ...prev]));
        setSent(true);
        onSent?.();
        setTimeout(closeCompose, 1500);
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }, [body, toRecipients, ccRecipients, bccRecipients, latestMessage, threadId, accountEmail, composeMode, subject, forwardQuote, closeCompose, onSent]);

  const handleComposeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleSchedule = useCallback(
    (date: Date) => {
      setScheduleOpen(false);
      handleSend(date);
    },
    [handleSend],
  );

  const handleCancelScheduled = useCallback(async () => {
    if (!scheduledInfo) return;
    setCancelling(true);
    try {
      const res = await fetch("/api/scheduled/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: scheduledInfo.id }),
      });
      if (!res.ok) throw new Error("Failed to cancel");
      setScheduledInfo(null);
      setSendError(null);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  }, [scheduledInfo]);

  const canSend = (body.trim() || composeMode === "forward") && toRecipients.length > 0 && !sending && !sent && !scheduledInfo;

  /* ── Shared content blocks ── */

  const titleBar = (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-3 border-b border-border-100 px-5 py-3",
        !isMobile && "cursor-grab active:cursor-grabbing",
      )}
      style={isMobile ? undefined : { touchAction: "none" }}
      onPointerDown={isMobile ? undefined : (e) => dragControls.start(e)}
    >
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground-100">
          {emailSubject}
        </span>
        {isThread && !loading && (
          <span className="text-xs text-foreground-300">
            {messages.length} messages in this conversation
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {onArchive && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onArchive(); onDismiss(); }}
            aria-label="Archive"
            className="shrink-0 rounded-full p-2 text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="5" rx="1" />
              <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
              <path d="M10 13h4" />
            </svg>
          </button>
        )}
        {!isMobile && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );

  const emailPane = (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      {loading && <SkeletonDetail />}

      {error && (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      {!loading && !error && messages.length > 0 && (
        <div className="mx-auto max-w-3xl space-y-2">
          {messages.map((msg, idx) => {
            const isExpanded = expandedIds.has(msg.id);
            const isNewest = idx === 0;
            const isSentByMe = selfEmail && extractEmail(msg.from).toLowerCase() === selfEmail;
            return (
              <div key={msg.id}>
                {isSentByMe ? (
                  <SentMessageCard
                    message={msg}
                    expanded={isExpanded}
                    canCollapse={!isNewest || messages.length > 1}
                    onToggle={() => toggleExpand(msg.id)}
                    accountEmail={accountEmail}
                    isSingleMessage={messages.length === 1}
                  />
                ) : isExpanded ? (
                  <ExpandedMessage
                    message={msg}
                    canCollapse={!isNewest || messages.length > 1}
                    onCollapse={() => toggleExpand(msg.id)}
                    trimQuotes={isThread}
                    accountEmail={accountEmail}
                    isSingleMessage={messages.length === 1}
                  />
                ) : (
                  <CollapsedMessage
                    message={msg}
                    onClick={() => toggleExpand(msg.id)}
                    isSingleMessage={messages.length === 1}
                  />
                )}
              </div>
            );
          })}

          {isThread && (
            <div className="pb-2 pt-3 text-center">
              <span className="text-[11px] text-foreground-300">
                Beginning of conversation
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const composePane = (
    <div className={cn("flex flex-col", isMobile ? "min-h-0 flex-1" : "h-full w-[420px]")}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-100 px-4 py-2">
        <ComposeModeTabs mode={composeMode!} onChange={(m) => setComposeMode(m)} />
        <button
          type="button"
          onClick={closeCompose}
          aria-label="Discard reply"
          className="rounded-lg p-2 text-foreground-300 transition-colors hover:bg-background-200 hover:text-red-500"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>

      <div className="shrink-0 border-b border-border-100">
        <RecipientInput
          label="To"
          recipients={toRecipients}
          onChange={setToRecipients}
          placeholder={composeMode === "forward" ? "Add recipient..." : ""}
        />

        {(showCcBcc || ccRecipients.length > 0 || bccRecipients.length > 0) && (
          <>
            <div className="border-t border-border-100/50">
              <RecipientInput label="Cc" recipients={ccRecipients} onChange={setCcRecipients} />
            </div>
            <div className="border-t border-border-100/50">
              <RecipientInput label="Bcc" recipients={bccRecipients} onChange={setBccRecipients} />
            </div>
          </>
        )}

        {!showCcBcc && ccRecipients.length === 0 && bccRecipients.length === 0 && (
          <div className="border-t border-border-100/50 px-4 py-1.5">
            <button
              type="button"
              onClick={() => setShowCcBcc(true)}
              className="text-xs text-foreground-300 transition-colors hover:text-blue-500"
            >
              + Cc/Bcc
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-border-100/50 px-4 py-2">
          <span className="shrink-0 text-xs text-foreground-300">Subject:</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground-100 outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleComposeKeyDown}
          placeholder={
            composeMode === "forward"
              ? "Add a message (optional)..."
              : "Write your reply..."
          }
          disabled={sending || sent}
          className="h-full min-h-[200px] w-full resize-none rounded-xl border border-border-100 bg-background-200 p-4 text-sm text-foreground-100 outline-none transition-colors placeholder:text-foreground-300 focus:border-blue-300 focus:bg-background-100 lg:min-h-0 dark:focus:border-blue-700"
        />
      </div>

      {composeMode !== "forward" && latestMessage && (
        <QuotedPreview message={latestMessage} />
      )}

      <SendActions
        canSend={!!canSend}
        sending={sending}
        sent={sent}
        sendError={sendError}
        scheduledInfo={scheduledInfo}
        cancelling={cancelling}
        scheduleOpen={scheduleOpen}
        scheduleButtonRef={scheduleButtonRef}
        onSend={() => handleSend()}
        onScheduleToggle={() => setScheduleOpen(!scheduleOpen)}
        onSchedule={handleSchedule}
        onCancelScheduled={handleCancelScheduled}
        onCloseSchedule={() => setScheduleOpen(false)}
      />
    </div>
  );

  const actionBar = !isComposing && !loading && !error && latestMessage ? (
    <EmailActionBar
      onCompose={openCompose}
      onChatAbout={() => onChatAbout({
        from: latestMessage.from,
        subject: latestMessage.subject,
        snippet: latestMessage.snippet,
      })}
      onPinToWorkspace={onPinToWorkspace ? () => onPinToWorkspace({
        messageId: latestMessage.id,
        threadId,
        from: latestMessage.from,
        subject: latestMessage.subject,
        snippet: latestMessage.snippet,
        date: latestMessage.date,
      }) : undefined}
    />
  ) : null;

  /* ── Mobile layout (rendered inside vaul Drawer) ── */

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {titleBar}
        <div className="flex min-h-0 flex-1 flex-col">
          {isComposing ? (
            composePane
          ) : (
            emailPane
          )}
        </div>
        {actionBar}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    );
  }

  /* ── Desktop layout (motion.div modal) ── */

  return (
    <>
      <motion.div
        key="email-modal-backdrop"
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        onClick={onDismiss}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <motion.div
          key="email-modal-sheet"
          className={cn("pointer-events-auto flex max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-border-100/70 bg-background-100 shadow-2xl h-[calc(100dvh-4rem)] origin-[top_center]", isDragging && "select-none")} 
          initial={{ y: "100%", width: initialComposeMode ? 1160 : 740 }}
          animate={{
            y: pushed ? "-3%" : 0,
            scale: pushed ? 0.94 : 1,
            width: isComposing ? 1160 : 740,
          }}
          exit={{ y: "110%" }}
          transition={openSpring}
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.04, bottom: 0.5 }}
          onDragStart={() => setIsDragging(true)}
          onDragEnd={(_e, info) => {
            setIsDragging(false);
            if (
              info.offset.y > DISMISS_THRESHOLD ||
              info.velocity.y > VELOCITY_THRESHOLD
            ) {
              onDismiss();
            }
          }}
        >
          {titleBar}

          <div className={cn("flex min-h-0 flex-1", isDragging && "pointer-events-none")}>
            {emailPane}

            <AnimatePresence>
              {isComposing && (
                <motion.div
                  key="compose-pane"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 420, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={openSpring}
                  className="shrink-0 overflow-hidden border-l border-border-100"
                >
                  {composePane}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {actionBar}

          <div className="h-[env(safe-area-inset-bottom)]" />
        </motion.div>
      </div>
    </>
  );
}

/* ─── Send Actions Bar (extracted for reuse) ─── */

function SendActions({
  canSend,
  sending,
  sent,
  sendError,
  scheduledInfo,
  cancelling,
  scheduleOpen,
  scheduleButtonRef,
  onSend,
  onScheduleToggle,
  onSchedule,
  onCancelScheduled,
  onCloseSchedule,
}: {
  canSend: boolean;
  sending: boolean;
  sent: boolean;
  sendError: string | null;
  scheduledInfo: { id: string; date: Date } | null;
  cancelling: boolean;
  scheduleOpen: boolean;
  scheduleButtonRef: React.RefObject<HTMLButtonElement | null>;
  onSend: () => void;
  onScheduleToggle: () => void;
  onSchedule: (date: Date) => void;
  onCancelScheduled: () => void;
  onCloseSchedule: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-100 px-4 py-2.5">
      <div className="flex items-center gap-2">
        {sendError && (
          <p className="max-w-[180px] truncate text-xs text-red-500">{sendError}</p>
        )}
        {scheduledInfo && !sendError && (
          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              Scheduled {scheduledInfo.date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
            <button
              type="button"
              onClick={onCancelScheduled}
              disabled={cancelling}
              className="text-foreground-300 underline transition-colors hover:text-red-500"
            >
              {cancelling ? "Cancelling..." : "Undo"}
            </button>
          </div>
        )}
        {sent && !scheduledInfo && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Sent
          </div>
        )}
        {!sendError && !sent && !scheduledInfo && (
          <p className="text-[11px] text-foreground-300">
            {navigator.platform?.includes("Mac") ? "\u2318" : "Ctrl"}+Enter to send
          </p>
        )}
      </div>

      <div className="flex items-center gap-0">
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className="flex items-center gap-1.5 rounded-l-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? (
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
          {sending ? "Sending..." : "Send"}
        </button>

        <div className="relative">
          <button
            ref={scheduleButtonRef}
            type="button"
            onClick={onScheduleToggle}
            disabled={!canSend}
            className="flex items-center rounded-r-xl border-l border-blue-500/30 bg-blue-600 px-2.5 py-2 text-white transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Schedule send"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <SchedulePopover
            open={scheduleOpen}
            onClose={onCloseSchedule}
            onSchedule={onSchedule}
            anchorRef={scheduleButtonRef}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Clickable Sender Name ─── */

function ClickableSenderName({
  name,
  email,
  className,
}: {
  name: string;
  email: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    },
    [email],
  );

  return (
    <div className="group/sender relative">
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "cursor-pointer text-sm font-medium transition-colors hover:text-accent-100",
          className,
        )}
      >
        {name}
      </button>
      <div
        className={cn(
          "pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 rounded-md text-[11px] shadow-lg transition-opacity duration-150",
          copied ? "opacity-100" : "opacity-0 group-hover/sender:opacity-100",
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {copied ? (
            <motion.span
              key="copied"
              layout
              className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-700 px-2.5 py-1 text-white"
              initial={{ opacity: 0, scale: 0.5, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.5, filter: "blur(4px)" }}
              transition={{ duration: 0.15 }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied!
            </motion.span>
          ) : (
            <motion.span
              key="email"
              layout
              className="block whitespace-nowrap rounded-md bg-neutral-900 px-2.5 py-1 text-neutral-200 dark:bg-neutral-700"
              initial={{ opacity: 0, scale: 0.5, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.5, filter: "blur(4px)" }}
              transition={{ duration: 0.15 }}
            >
              {email}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─── Collapsed Message ─── */

function CollapsedMessage({
  message,
  onClick,
  isSingleMessage,
}: {
  message: ThreadMessage;
  onClick: () => void;
  isSingleMessage?: boolean;
}) {
  const sender = parseSender(message.from);
  const company = parseCompany(sender.email);
  const avatarColor = AVATAR_COLORS[hashStr(message.from) % AVATAR_COLORS.length];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 bg-transparent p-3 text-left transition-all",
        isSingleMessage
          ? "border-none"
          : "rounded-xl border border-transparent hover:border-border-100/70 hover:bg-background-200/60",
      )}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-white"
        style={{ backgroundColor: avatarColor }}
      >
        {sender.initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <ClickableSenderName name={sender.name} email={sender.email} className="text-foreground-200" />
          {company && (
            <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-px text-[10px] font-medium text-blue-500 dark:bg-blue-950/40 dark:text-blue-400">
              {company.name}
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs text-foreground-300">
            {formatRelative(message.date)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-foreground-300">
          {message.snippet}
        </p>
      </div>
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
        className="shrink-0 text-foreground-300/50 transition-transform group-hover:text-foreground-300"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

/* ─── Expanded Message ─── */

function ExpandedMessage({
  message,
  canCollapse,
  onCollapse,
  trimQuotes,
  accountEmail,
  isSingleMessage,
}: {
  message: ThreadMessage;
  canCollapse: boolean;
  onCollapse: () => void;
  trimQuotes?: boolean;
  accountEmail?: string;
  isSingleMessage?: boolean;
}) {
  const sender = parseSender(message.from);
  const company = parseCompany(sender.email);
  const avatarColor = AVATAR_COLORS[hashStr(message.from) % AVATAR_COLORS.length];
  const recipientName = parseSender(message.to.split(",")[0].trim()).name;
  const extraRecipients = message.to.includes(",") ? message.to.split(",").length - 1 : 0;

  return (
    <motion.div
      className={cn(
        "p-4",
        isSingleMessage
          ? "bg-transparent"
          : "rounded-xl border border-border-100/70 bg-background-200/60",
      )}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
          style={{ backgroundColor: avatarColor }}
        >
          {sender.initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ClickableSenderName name={sender.name} email={sender.email} className="text-foreground-100" />
            {company && (
              <a
                href={company.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex shrink-0 items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-500 no-underline transition-colors hover:bg-blue-100 hover:text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900/50 dark:hover:text-blue-300"
              >
                {company.name}
              </a>
            )}
            <span className="ml-auto shrink-0 text-xs text-foreground-300">
              {formatRelative(message.date)}
            </span>
          </div>
          <div className="text-xs text-foreground-300">
            to {recipientName}
            {extraRecipients > 0 ? ` +${extraRecipients}` : ""}
          </div>
        </div>
        {canCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="shrink-0 rounded-md p-1 text-foreground-300 transition-colors hover:bg-background-300/60 hover:text-foreground-200"
            aria-label="Collapse message"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        )}
      </div>

      <motion.div
        className="mt-3"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.25, ease: "easeOut" }}
      >
        <EmailContentRenderer
          bodyHtml={message.bodyHtml}
          bodyText={message.bodyText}
          trimQuotes={trimQuotes}
          attachments={message.attachments}
          messageId={message.id}
          accountEmail={accountEmail}
        />
      </motion.div>
    </motion.div>
  );
}

/* ─── Sent Message Card ─── */

function SentMessageCard({
  message,
  expanded,
  canCollapse,
  onToggle,
  accountEmail,
  isSingleMessage,
}: {
  message: ThreadMessage;
  expanded: boolean;
  canCollapse: boolean;
  onToggle: () => void;
  accountEmail?: string;
  isSingleMessage?: boolean;
}) {
  const recipientName = parseSender(message.to.split(",")[0].trim()).name;
  const extraRecipients = message.to.includes(",") ? message.to.split(",").length - 1 : 0;
  const isJustSent = message.id.startsWith("sent_");

  return (
    <motion.div
      className={cn(
        "p-4",
        isSingleMessage
          ? "bg-transparent"
          : "rounded-xl border border-blue-200/50 bg-blue-50/50 dark:border-blue-500/20 dark:bg-blue-950/20",
      )}
      initial={isJustSent ? { opacity: 0, y: -12, scale: 0.97 } : { opacity: 1 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={isJustSent ? { duration: 0.35, ease: "easeOut" } : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-medium text-white">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {accountEmail ? (
              <ClickableSenderName name="You" email={accountEmail} className="text-foreground-100" />
            ) : (
              <span className="text-sm font-medium text-foreground-100">You</span>
            )}
            {isJustSent && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Just sent
              </span>
            )}
            <span className="ml-auto shrink-0 text-xs text-foreground-300">
              {formatRelative(message.date)}
            </span>
          </div>
          <div className="text-xs text-foreground-300">
            to {recipientName}
            {extraRecipients > 0 ? ` +${extraRecipients}` : ""}
          </div>
        </div>
        {canCollapse && (
          <button
            type="button"
            onClick={onToggle}
            className="shrink-0 rounded-md p-1 text-foreground-300 transition-colors hover:bg-blue-100/60 hover:text-foreground-200 dark:hover:bg-blue-900/30"
            aria-label={expanded ? "Collapse message" : "Expand message"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={expanded ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
            </svg>
          </button>
        )}
      </div>

      {expanded && (
        <motion.div
          className="mt-3"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.25, ease: "easeOut" }}
        >
          {message.bodyHtml ? (
            <EmailContentRenderer
              bodyHtml={message.bodyHtml}
              bodyText={message.bodyText}
              trimQuotes
              attachments={message.attachments}
              messageId={message.id}
              accountEmail={accountEmail}
            />
          ) : (
            <div className="whitespace-pre-wrap text-sm text-foreground-100">
              {message.bodyText}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

/* ─── Compose Mode Tabs ─── */

function ComposeModeTabs({
  mode,
  onChange,
}: {
  mode: ComposeMode;
  onChange: (mode: ComposeMode) => void;
}) {
  const [replyMenuOpen, setReplyMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!replyMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setReplyMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [replyMenuOpen]);

  const isReplyMode = mode === "reply" || mode === "reply-all";
  const replyLabel = mode === "reply" ? "Reply" : "Reply All";
  const replyIcon = mode === "reply" ? MODE_ICONS.reply : MODE_ICONS["reply-all"];

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative" ref={menuRef}>
        <div className={cn(
          "flex items-center rounded-lg transition-colors",
          isReplyMode
            ? "bg-blue-600 text-white"
            : "border border-border-100 bg-background-100 text-foreground-200",
        )}>
          <button
            type="button"
            onClick={() => { if (!isReplyMode) onChange("reply-all"); }}
            className={cn(
              "flex items-center gap-1.5 rounded-l-lg px-3 py-1.5 text-xs font-medium transition-colors",
              isReplyMode ? "hover:bg-blue-500" : "hover:bg-background-200",
            )}
          >
            <span className={cn(isReplyMode ? "text-white/80" : "text-foreground-300")}>
              {replyIcon}
            </span>
            {replyLabel}
          </button>
          <button
            type="button"
            onClick={() => setReplyMenuOpen(!replyMenuOpen)}
            className={cn(
              "flex items-center rounded-r-lg px-1.5 py-1.5 transition-colors",
              isReplyMode
                ? "border-l border-blue-500/30 hover:bg-blue-500"
                : "border-l border-border-100 hover:bg-background-200",
            )}
            aria-label="Reply options"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>

        <AnimatePresence>
          {replyMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
              className="absolute left-0 top-full z-50 mt-1 w-[160px] origin-top-left rounded-lg border border-border-100 bg-background-100 py-1 shadow-xl"
            >
              <button
                type="button"
                onClick={() => { onChange("reply"); setReplyMenuOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-background-200",
                  mode === "reply" ? "text-blue-500 font-medium" : "text-foreground-200",
                )}
              >
                <span className="text-foreground-300">{MODE_ICONS.reply}</span>
                Reply
                {mode === "reply" && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ml-auto text-blue-500">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={() => { onChange("reply-all"); setReplyMenuOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-background-200",
                  mode === "reply-all" ? "text-blue-500 font-medium" : "text-foreground-200",
                )}
              >
                <span className="text-foreground-300">{MODE_ICONS["reply-all"]}</span>
                Reply All
                {mode === "reply-all" && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ml-auto text-blue-500">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <button
        type="button"
        onClick={() => onChange("forward")}
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
          mode === "forward"
            ? "bg-blue-600 text-white hover:bg-blue-500"
            : "border border-border-100 bg-background-100 text-foreground-200 hover:bg-background-200",
        )}
      >
        <span className={cn(mode === "forward" ? "text-white/80" : "text-foreground-300")}>
          {MODE_ICONS.forward}
        </span>
        Forward
      </button>
    </div>
  );
}

/* ─── Quoted Preview ─── */

function QuotedPreview({ message }: { message: ThreadMessage }) {
  const [expanded, setExpanded] = useState(false);
  const sender = parseSender(message.from);
  const dateStr = formatRelative(message.date);

  return (
    <div className="shrink-0 border-t border-border-100/50 px-4 py-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 text-left text-xs text-foreground-300 transition-colors hover:text-foreground-200"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
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
        <span className="truncate">
          On {dateStr}, {sender.name} wrote...
        </span>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="mt-2 max-h-[200px] overflow-y-auto rounded-lg border border-border-100/50 bg-background-200/40 p-3 text-xs text-foreground-200"
          >
            <EmailContentRenderer
              bodyHtml={message.bodyHtml}
              bodyText={message.bodyText}
              trimQuotes
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Email Action Bar (visible when not composing) ─── */

function EmailActionBar({
  onCompose,
  onChatAbout,
  onPinToWorkspace,
}: {
  onCompose: (mode: ComposeMode) => void;
  onChatAbout: () => void;
  onPinToWorkspace?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border-100 px-4 py-2.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChatAbout(); }}
          className="rounded-lg border border-border-100 bg-background-100 px-3 py-1.5 text-xs font-medium text-foreground-200 transition-colors hover:bg-background-200"
        >
          Chat about this
        </button>
        {onPinToWorkspace && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPinToWorkspace(); }}
            className="rounded-lg border border-border-100 bg-background-100 px-3 py-1.5 text-xs font-medium text-foreground-200 transition-colors hover:bg-background-200"
            title="Pin to workspace"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="17" x2="12" y2="22" />
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCompose("forward"); }}
          className="flex items-center gap-1.5 rounded-lg border border-border-100 bg-background-100 px-3.5 py-1.5 text-xs font-medium text-foreground-200 transition-colors hover:bg-background-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 0 1 4-4h12" />
          </svg>
          Forward
        </button>

        <div className="relative" ref={menuRef}>
          <div className="flex items-center rounded-lg bg-blue-600 text-white">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCompose("reply-all"); }}
              className="flex items-center gap-1.5 rounded-l-lg px-3.5 py-1.5 text-xs font-medium transition-colors hover:bg-blue-500"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="7 17 2 12 7 7" /><polyline points="12 17 7 12 12 7" /><path d="M22 18v-2a4 4 0 0 0-4-4H7" />
              </svg>
              Reply
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="flex items-center rounded-r-lg border-l border-blue-500/30 px-1.5 py-1.5 transition-colors hover:bg-blue-500"
              aria-label="Reply options"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={{ duration: 0.12, ease: "easeOut" }}
                className="absolute bottom-full right-0 z-50 mb-1 w-[160px] origin-bottom-right rounded-lg border border-border-100 bg-background-100 py-1 shadow-xl"
              >
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onCompose("reply"); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground-200 transition-colors hover:bg-background-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300">
                    <polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                  </svg>
                  Reply
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onCompose("reply-all"); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground-200 transition-colors hover:bg-background-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300">
                    <polyline points="7 17 2 12 7 7" /><polyline points="12 17 7 12 12 7" /><path d="M22 18v-2a4 4 0 0 0-4-4H7" />
                  </svg>
                  Reply All
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ─── Skeleton ─── */

function SkeletonDetail() {
  return (
    <div className="animate-pulse space-y-6 px-6 py-6">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-background-300" />
        <div className="flex-1 space-y-1.5">
          <div className="h-4 w-32 rounded bg-background-300" />
          <div className="h-3 w-48 rounded bg-background-200" />
        </div>
      </div>
      <div className="space-y-3">
        <div className="h-4 w-full rounded bg-background-200" />
        <div className="h-4 w-5/6 rounded bg-background-200" />
        <div className="h-4 w-4/6 rounded bg-background-200" />
        <div className="h-4 w-full rounded bg-background-200" />
        <div className="h-4 w-3/4 rounded bg-background-200" />
      </div>
    </div>
  );
}

export type { ComposeMode };
