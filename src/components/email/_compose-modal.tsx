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

const MODE_LABELS: Record<ComposeMode, string> = {
  "reply-all": "Reply All",
  reply: "Reply",
  forward: "Forward",
};

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

interface ComposeModalProps {
  open: boolean;
  threadId: string;
  accountEmail?: string;
  initialMode?: ComposeMode;
  onDismiss: () => void;
  onSent?: () => void;
}

export function ComposeModal({ open, threadId, accountEmail, initialMode = "reply-all", onDismiss, onSent }: ComposeModalProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer
        open={open && !!threadId}
        onOpenChange={(o) => { if (!o) onDismiss(); }}
      >
        <Drawer.Content className="h-[95dvh]">
          {open && threadId && (
            <ComposeModalContent
              key={`compose-${threadId}-${initialMode}`}
              threadId={threadId}
              accountEmail={accountEmail}
              initialMode={initialMode}
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
        <ComposeModalInner
          key={`compose-${threadId}-${initialMode}`}
          threadId={threadId}
          accountEmail={accountEmail}
          initialMode={initialMode}
          onDismiss={onDismiss}
          onSent={onSent}
        />
      )}
    </AnimatePresence>
  );
}

function ComposeModalInner(props: Omit<ComposeModalProps, "open">) {
  return <ComposeModalContent {...props} isMobile={false} />;
}

function ComposeModalContent({
  threadId,
  accountEmail,
  initialMode,
  onDismiss,
  onSent,
  isMobile,
}: Omit<ComposeModalProps, "open"> & { isMobile: boolean }) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ComposeMode>(initialMode ?? "reply-all");
  const [body, setBody] = useState("");
  const [toRecipients, setToRecipients] = useState<Recipient[]>([]);
  const [ccRecipients, setCcRecipients] = useState<Recipient[]>([]);
  const [bccRecipients, setBccRecipients] = useState<Recipient[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scheduleButtonRef = useRef<HTMLButtonElement>(null);
  const dragControls = useDragControls();

  // Fetch thread
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

  const latestMessage = messages.length > 0 ? messages[0] : null;
  const selfEmail = accountEmail?.toLowerCase() ?? "";

  // Compute recipients based on mode
  useEffect(() => {
    if (!latestMessage) return;

    const senderEmail = extractEmail(latestMessage.from);
    const senderRecipient: Recipient = {
      email: senderEmail,
      name: parseSender(latestMessage.from).name,
    };

    if (mode === "reply") {
      setToRecipients([senderRecipient]);
      setCcRecipients([]);
      setBccRecipients([]);
    } else if (mode === "reply-all") {
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
    if (mode === "forward") {
      setSubject(`Fwd: ${subjectBase}`);
    } else {
      setSubject(`Re: ${subjectBase}`);
    }
  }, [latestMessage, mode, selfEmail]);

  // Auto-focus textarea after load
  useEffect(() => {
    if (!loading && messages.length > 0 && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [loading, messages.length]);

  // Build quoted text for forward
  const forwardQuote = useMemo(() => {
    if (mode !== "forward" || !latestMessage) return "";
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
  }, [mode, latestMessage]);

  const handleSend = useCallback(async (scheduleDate?: Date) => {
    if (!body.trim() && mode !== "forward") return;
    if (toRecipients.length === 0) return;
    if (!latestMessage) return;

    setSending(true);
    setSendError(null);

    try {
      const accountParam = accountEmail ? `?account=${encodeURIComponent(accountEmail)}` : "";
      const isForward = mode === "forward";
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

      setSent(true);
      onSent?.();
      setTimeout(onDismiss, 1200);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }, [body, toRecipients, ccRecipients, bccRecipients, latestMessage, threadId, accountEmail, mode, subject, forwardQuote, onDismiss, onSent]);

  const handleKeyDown = useCallback(
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

  const isDraftEmpty = !body.trim();

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDraftEmpty && !sent && !sending) {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [isDraftEmpty, sent, sending, onDismiss]);

  const canSend = (body.trim() || mode === "forward") && toRecipients.length > 0 && !sending && !sent;

  const titleBar = (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-3 border-b border-border-100 px-5 py-3",
        !isMobile && "cursor-grab active:cursor-grabbing",
      )}
      style={isMobile ? undefined : { touchAction: "none" }}
      onPointerDown={isMobile ? undefined : (e) => dragControls.start(e)}
    >
      <div className="flex items-center gap-1">
        <ModeSelector mode={mode} onChange={setMode} />
      </div>
      {!isMobile && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close"
          className="rounded-full p-1.5 text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );

  const composePaneContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border-100">
        <RecipientInput
          label="To"
          recipients={toRecipients}
          onChange={setToRecipients}
          placeholder={mode === "forward" ? "Add recipient..." : ""}
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
            <button type="button" onClick={() => setShowCcBcc(true)} className="text-xs text-foreground-300 transition-colors hover:text-blue-500">
              + Cc/Bcc
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-border-100/50 px-4 py-2">
          <span className="shrink-0 text-xs text-foreground-300">Subject:</span>
          <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-foreground-100 outline-none" />
        </div>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={mode === "forward" ? "Add a message (optional)..." : "Write your reply..."}
          disabled={sending || sent}
          className="h-full min-h-[200px] w-full resize-none rounded-xl border border-border-100 bg-background-200 p-4 text-sm text-foreground-100 outline-none transition-colors placeholder:text-foreground-300 focus:border-blue-300 focus:bg-background-100 lg:min-h-0 dark:focus:border-blue-700"
        />
      </div>

      {mode !== "forward" && latestMessage && <QuotedPreview message={latestMessage} />}

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-100 px-4 py-3">
        <div className="flex items-center gap-2">
          {sendError && <p className="max-w-[180px] truncate text-xs text-red-500">{sendError}</p>}
          {sent && (
            <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Sent
            </div>
          )}
          {!sendError && !sent && (
            <button type="button" onClick={onDismiss} className="rounded-lg p-2 text-foreground-300 transition-colors hover:bg-background-200 hover:text-red-500" aria-label="Discard">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-0">
          <button type="button" onClick={() => handleSend()} disabled={!canSend} className="flex items-center gap-2 rounded-l-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
            {sending ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            )}
            {sending ? "Sending..." : "Send"}
          </button>
          <div className="relative">
            <button ref={scheduleButtonRef} type="button" onClick={() => setScheduleOpen(!scheduleOpen)} disabled={!canSend} className="flex items-center rounded-r-xl border-l border-blue-500/30 bg-blue-600 px-2 py-2 text-white transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Schedule send">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <SchedulePopover open={scheduleOpen} onClose={() => setScheduleOpen(false)} onSchedule={handleSchedule} anchorRef={scheduleButtonRef} />
          </div>
        </div>
      </div>

      <div className="shrink-0 px-4 pb-3">
        <p className="text-[11px] text-foreground-300">{navigator.platform?.includes("Mac") ? "\u2318" : "Ctrl"}+Enter to send</p>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {titleBar}
        {composePaneContent}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    );
  }

  return (
    <>
      <motion.div
        key="compose-modal-backdrop"
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        onClick={onDismiss}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <motion.div
          key="compose-modal-sheet"
          className="pointer-events-auto flex w-full max-w-[920px] flex-col overflow-hidden rounded-3xl border border-border-100/70 bg-background-100 shadow-2xl"
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
                <div className="flex items-center justify-center p-8">
                  <p className="text-sm text-red-500">{error}</p>
                </div>
              )}
              {!loading && !error && latestMessage && (
                <div className="px-5 py-4">
                  <h2 className="text-base font-semibold text-foreground-100">{latestMessage.subject || "(no subject)"}</h2>
                  <MessageCard message={latestMessage} />
                  {messages.length > 1 && <OlderMessages messages={messages.slice(1)} />}
                </div>
              )}
            </div>

            <div className="flex w-full flex-col md:w-[380px] lg:w-[420px]">
              {composePaneContent}
            </div>
          </div>

          <div className="h-[env(safe-area-inset-bottom)]" />
        </motion.div>
      </div>
    </>
  );
}

/* ─── Mode Selector ─── */

function ModeSelector({
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
      {/* Compound Reply button */}
      <div className="relative" ref={menuRef}>
        <div className={cn(
          "flex items-center rounded-lg transition-colors",
          isReplyMode
            ? "bg-blue-600 text-white"
            : "border border-border-100 bg-background-100 text-foreground-200",
        )}>
          <button
            type="button"
            onClick={() => {
              if (!isReplyMode) onChange("reply-all");
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-l-lg px-3 py-1.5 text-xs font-medium transition-colors",
              isReplyMode
                ? "hover:bg-blue-500"
                : "hover:bg-background-200",
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

      {/* Forward button */}
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

/* ─── Message Card ─── */

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
        />
      </div>
    </div>
  );
}

/* ─── Older Messages ─── */

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

/* ─── Skeleton ─── */

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

export type { ComposeMode };
