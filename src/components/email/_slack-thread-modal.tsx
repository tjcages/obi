import { useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn, formatRelative, cleanSlackText } from "../../lib";
import type { TodoSlackRef } from "../../lib";

interface SlackMessage {
  userId: string;
  userName: string;
  text: string;
  ts: string;
}

interface SlackThread {
  channelId: string;
  threadTs: string;
  channelName?: string;
  triggerMessageTs: string;
  messages: SlackMessage[];
  receivedAt: string;
  processed: boolean;
}

interface SlackThreadModalProps {
  open: boolean;
  thread?: SlackThread | null;
  slackRef?: TodoSlackRef | null;
  onDismiss: () => void;
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

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z" />
    </svg>
  );
}

function formatSlackTs(ts: string): string {
  const seconds = Number.parseFloat(ts);
  if (Number.isNaN(seconds)) return "";
  return new Date(seconds * 1000).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function SlackThreadModal({ open, thread, slackRef, onDismiss }: SlackThreadModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, thread]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  const channelName = thread?.channelName ?? slackRef?.channelName;
  const channelLabel = channelName ? `#${channelName}` : "Direct message";
  const messages = thread?.messages ?? (slackRef ? [{
    userId: "",
    userName: slackRef.from,
    text: slackRef.text,
    ts: slackRef.messageTs,
  }] : []);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={onDismiss}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border-100/40 bg-background-100 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-100/50 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#4A154B]/10 dark:bg-[#E8B4E9]/10">
                  <SlackIcon className="h-4 w-4 text-[#4A154B] dark:text-[#E8B4E9]" />
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-foreground-100">{channelLabel}</div>
                  {thread && (
                    <div className="text-[11px] text-foreground-300/60">
                      {[...new Set(messages.map(m => m.userName))].join(", ")} &middot; {formatRelative(thread.receivedAt)}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-300/50 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <SlackIcon className="mb-3 h-8 w-8 text-foreground-300/20" />
                  <p className="text-[14px] font-medium text-foreground-300/60">No messages</p>
                  <p className="mt-0.5 text-[12px] text-foreground-300/40">This thread is empty</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg) => {
                    const color = AVATAR_COLORS[hashStr(msg.userName) % AVATAR_COLORS.length];
                    return (
                      <div key={msg.ts} className="flex gap-3">
                        <div
                          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold text-white"
                          style={{ backgroundColor: color }}
                        >
                          {msg.userName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[14px] font-semibold text-foreground-100">
                              {msg.userName}
                            </span>
                            <span className="text-[11px] text-foreground-300/50">
                              {formatSlackTs(msg.ts)}
                            </span>
                          </div>
                          <p className="mt-0.5 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground-100/80 select-text">
                            {cleanSlackText(msg.text)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
