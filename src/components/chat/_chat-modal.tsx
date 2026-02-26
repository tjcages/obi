import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  motion,
  AnimatePresence,
  useDragControls,
} from "motion/react";
import { isTextUIPart, type UIMessage } from "ai";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { ArrowUp, X, Sparkle } from "@phosphor-icons/react";
import { toConversationRoomName, cn, useIsMobile } from "../../lib";
import { formatChatError } from "./_chat-utils";
import { renderMarkdownText } from "./_gmail-chat";
import { GenerativeUIRenderer, isDisplayTool } from "./chat-ui";
import { Drawer } from "../ui/_drawer";

const DISMISS_THRESHOLD = 100;
const VELOCITY_THRESHOLD = 400;

const openSpring = { type: "spring" as const, stiffness: 260, damping: 32 };

const TEXTAREA_LINE_HEIGHT = 24;
const TEXTAREA_PADDING_Y = 24;
const TEXTAREA_MIN_HEIGHT = TEXTAREA_LINE_HEIGHT + TEXTAREA_PADDING_Y;
const TEXTAREA_MAX_HEIGHT = TEXTAREA_LINE_HEIGHT * 6 + TEXTAREA_PADDING_Y;

const MODEL_CONTEXT_WINDOW_TOKENS = 128_000;

function estimateContextPercent(messages: UIMessage[]): number {
  const chars = messages.reduce(
    (t, m) =>
      t +
      m.parts.reduce((pt, p) => {
        if (isTextUIPart(p)) return pt + p.text.length;
        try {
          return pt + JSON.stringify(p).length;
        } catch {
          return pt;
        }
      }, 0),
    0,
  );
  return Math.min(
    100,
    (Math.ceil(chars / 4) / MODEL_CONTEXT_WINDOW_TOKENS) * 100,
  );
}

function isDisplayToolPart(part: { type: string }): boolean {
  if (part.type !== "tool-invocation") return false;
  const toolName = (part as unknown as { toolName: string }).toolName;
  return typeof toolName === "string" && isDisplayTool(toolName);
}

function hasContent(msg: UIMessage): boolean {
  return msg.parts.some(
    (p) => (isTextUIPart(p) && p.text.length > 0) || isDisplayToolPart(p),
  );
}

function StreamingCursor() {
  return (
    <div className="inline-flex items-center py-1">
      <span className="inline-block h-4 w-0.5 animate-pulse rounded-full bg-accent-100/70" />
    </div>
  );
}

const RING_SIZE = 22;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ContextProgressRing({ percent }: { percent: number }) {
  const offset = RING_CIRCUMFERENCE - (percent / 100) * RING_CIRCUMFERENCE;
  const color =
    percent > 85
      ? "stroke-red-400"
      : percent > 60
        ? "stroke-amber-400"
        : "stroke-foreground-300/60";

  if (percent < 1) return null;

  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      className="shrink-0"
      aria-label={`Context window ${Math.round(percent)}% used`}
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={RING_STROKE}
        className="stroke-border-100"
      />
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={offset}
        className={cn("transition-all duration-300", color)}
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
}

interface ChatModalProps {
  open: boolean;
  userId: string;
  conversationId: string;
  conversationReady: boolean;
  title: string;
  autoSendPrompt?: string | null;
  onAutoSendComplete?: () => void;
  onUserMessage?: (text: string) => void;
  onDismiss: () => void;
}

export function ChatModal({
  open,
  userId,
  conversationId,
  conversationReady,
  title,
  autoSendPrompt,
  onAutoSendComplete,
  onUserMessage,
  onDismiss,
}: ChatModalProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer
        open={open && !!conversationId}
        onOpenChange={(o) => { if (!o) onDismiss(); }}
      >
        <Drawer.Content className="h-[95dvh]">
          {open && conversationId && (
            <ChatModalContent
              key={conversationId}
              userId={userId}
              conversationId={conversationId}
              conversationReady={conversationReady}
              title={title}
              autoSendPrompt={autoSendPrompt}
              onAutoSendComplete={onAutoSendComplete}
              onUserMessage={onUserMessage}
              onDismiss={onDismiss}
              isMobile
            />
          )}
        </Drawer.Content>
      </Drawer>
    );
  }

  return (
    <AnimatePresence>
      {open && conversationId && (
        <ChatModalInner
          key={conversationId}
          userId={userId}
          conversationId={conversationId}
          conversationReady={conversationReady}
          title={title}
          autoSendPrompt={autoSendPrompt}
          onAutoSendComplete={onAutoSendComplete}
          onUserMessage={onUserMessage}
          onDismiss={onDismiss}
        />
      )}
    </AnimatePresence>
  );
}

function ChatModalInner(props: Omit<ChatModalProps, "open">) {
  return <ChatModalContent {...props} isMobile={false} />;
}

function ChatModalContent({
  userId,
  conversationId,
  conversationReady,
  title,
  autoSendPrompt,
  onAutoSendComplete,
  onUserMessage,
  onDismiss,
  isMobile,
}: Omit<ChatModalProps, "open"> & { isMobile: boolean }) {
  const host = typeof window !== "undefined" ? window.location.origin : "";
  const roomName = toConversationRoomName(userId, conversationId);
  const autoSendFired = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const dragControls = useDragControls();

  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => resizeTextarea(), [input, resizeTextarea]);

  const agent = useAgent({ agent: "inbox-agent", name: roomName, host });
  const { messages, sendMessage, stop, status, error, clearError } =
    useAgentChat({ agent });

  const isLoading = status === "submitted" || status === "streaming";
  const errorView = useMemo(() => formatChatError(error), [error]);
  const contextPercent = useMemo(
    () => estimateContextPercent(messages),
    [messages],
  );

  useEffect(() => {
    if (!error) return;
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("no refresh token available"))
      window.location.assign("/logout");
  }, [error]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!autoSendPrompt || !conversationReady || autoSendFired.current) return;
    autoSendFired.current = true;
    onUserMessage?.(autoSendPrompt);
    void sendMessage({ text: autoSendPrompt });
    onAutoSendComplete?.();
  }, [
    autoSendPrompt,
    conversationReady,
    sendMessage,
    onUserMessage,
    onAutoSendComplete,
  ]);

  const prevMsgLen = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length > prevMsgLen.current || isLoading) {
      requestAnimationFrame(() =>
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }),
      );
    }
    prevMsgLen.current = messages.length;
  }, [messages, isLoading]);

  const visibleMessages = messages.filter(
    (m) => m.role !== "assistant" || hasContent(m),
  );
  const lastRawMsg = messages[messages.length - 1];
  const lastRawPart = lastRawMsg?.parts[lastRawMsg.parts.length - 1];
  const isToolExecuting =
    isLoading &&
    (!lastRawMsg ||
      lastRawMsg.role === "user" ||
      (lastRawPart && !isTextUIPart(lastRawPart)));

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || isLoading || !conversationReady) return;
      if (error) clearError();
      onUserMessage?.(text);
      void sendMessage({ text });
      setInput("");
    },
    [input, isLoading, conversationReady, sendMessage, error, clearError, onUserMessage],
  );

  const inputDisabled = !conversationReady;
  const boundedPercent = Math.max(0, Math.min(100, contextPercent));
  const canSend = !inputDisabled && !isLoading && input.trim().length > 0;

  const titleBar = (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between border-b border-border-100/40 px-5 py-3",
        !isMobile && "cursor-grab active:cursor-grabbing",
      )}
      style={isMobile ? undefined : { touchAction: "none" }}
      onPointerDown={isMobile ? undefined : (e) => dragControls.start(e)}
    >
      <div className="flex min-w-0 items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/50">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
        <span className="truncate text-[14px] font-semibold text-foreground-100">
          {title}
        </span>
      </div>
      {!isMobile && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-300/50 transition-colors hover:bg-foreground-100/5 hover:text-foreground-200"
        >
          <X size={14} weight="bold" />
        </button>
      )}
    </div>
  );

  const messagesArea = (
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-1 px-5 py-6">
        {!conversationReady && (
          <div className="flex items-center gap-2 py-2">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-foreground-300/20 border-t-foreground-300/60" />
            <span className="text-[13px] text-foreground-300/60">Connecting...</span>
          </div>
        )}

        {visibleMessages.length === 0 &&
          conversationReady &&
          !isLoading && (
            <div className="flex flex-1 flex-col items-center justify-center py-12">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent-100/8">
                <Sparkle size={20} weight="fill" className="text-accent-100" />
              </div>
              <p className="text-[14px] font-medium text-foreground-300/60">
                Ask a question below
              </p>
              <p className="mt-0.5 text-[12px] text-foreground-300/40">
                Chat about this conversation
              </p>
            </div>
          )}

        {visibleMessages.map((msg, idx) => {
          const textPart = msg.parts.find(isTextUIPart);
          if (
            msg.role === "assistant" &&
            textPart &&
            textPart.text.startsWith("[SYSTEM_ERROR] ")
          ) {
            const errMsg = textPart.text.replace("[SYSTEM_ERROR] ", "");
            const ev = formatChatError(new Error(errMsg));
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: idx * 0.03 }}
                className="mt-2 rounded-xl border border-destructive-100/20 bg-destructive-100/6 px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-2 font-medium text-destructive-100">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive-100/15 text-[11px]">!</div>
                  {ev?.title ?? "Error"}
                </div>
                <div className="mt-1 text-foreground-200/80">{ev?.detail ?? errMsg}</div>
              </motion.div>
            );
          }

          if (msg.role === "user") {
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: idx * 0.03 }}
                className="mt-5 flex justify-end first:mt-0"
              >
                <div className="max-w-[80%] whitespace-pre-wrap wrap-break-word rounded-2xl bg-foreground-100/8 px-4 py-2.5 text-[15px] leading-relaxed text-foreground-100 select-text">
                  {msg.parts.map((part, i) =>
                    isTextUIPart(part) ? (
                      <span key={`${msg.id}-${i}`}>{part.text}</span>
                    ) : null,
                  )}
                </div>
              </motion.div>
            );
          }

          return (
            <Fragment key={msg.id}>
              {msg.parts.map((part, i) => {
                const partKey = `${msg.id}-${i}`;
                if (isDisplayToolPart(part)) {
                  return (
                    <motion.div
                      key={partKey}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: idx * 0.03 }}
                      className="w-full py-1"
                    >
                      <GenerativeUIRenderer part={part as unknown as { type: "tool-invocation"; toolCallId: string; toolName: string; args: unknown; result?: unknown; state: string }} />
                    </motion.div>
                  );
                }
                if (isTextUIPart(part)) {
                  return (
                    <motion.div
                      key={partKey}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: idx * 0.03 }}
                      className="mt-1 w-full min-w-0 whitespace-pre-wrap wrap-break-word text-[15px] leading-[1.7] text-foreground-200 select-text"
                    >
                      {renderMarkdownText(part.text)}
                    </motion.div>
                  );
                }
                return null;
              })}
            </Fragment>
          );
        })}

        {isToolExecuting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="py-2"
          >
            <StreamingCursor />
          </motion.div>
        )}

        {errorView && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 rounded-xl border border-destructive-100/20 bg-destructive-100/6 px-4 py-3 text-sm"
          >
            <div className="flex items-center gap-2 font-medium text-destructive-100">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive-100/15 text-[11px]">!</div>
              {errorView.title}
            </div>
            <div className="mt-1 text-foreground-200/80">{errorView.detail}</div>
          </motion.div>
        )}
      </div>
    </div>
  );

  const inputArea = (
    <div className="border-t border-border-100/40 px-4 py-3">
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2"
      >
        <div className="flex min-w-0 flex-1 items-end rounded-2xl border border-border-100/80 bg-background-200/80 transition-all focus-within:border-foreground-300/40 focus-within:bg-background-100 focus-within:shadow-lg">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask about your inbox..."
            ref={inputRef}
            disabled={inputDisabled}
            rows={1}
            className="flex-1 resize-none bg-transparent py-3 pl-4 pr-2 text-[15px] leading-[24px] text-foreground-100 outline-none placeholder:text-foreground-300/50 disabled:opacity-40"
            style={{ minHeight: TEXTAREA_MIN_HEIGHT, maxHeight: TEXTAREA_MAX_HEIGHT }}
          />
          <div className="flex shrink-0 items-center gap-1.5 pb-2 pr-2">
            <ContextProgressRing percent={boundedPercent} />
            {isLoading ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop generating"
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-foreground-100 text-background-100 transition-all hover:bg-foreground-100/90"
              >
                <div className="h-3 w-3 rounded-[2px] bg-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send"
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
                  canSend
                    ? "bg-foreground-100 text-background-100 hover:bg-foreground-100/90"
                    : "bg-foreground-100/8 text-foreground-300/50",
                )}
              >
                <ArrowUp size={16} weight="bold" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {titleBar}
        {messagesArea}
        {inputArea}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    );
  }

  return (
    <>
      <motion.div
        key="chat-modal-backdrop"
        className="fixed inset-0 z-60 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={onDismiss}
      />

      <div className="fixed inset-0 z-70 flex items-center justify-center pointer-events-none">
        <motion.div
          key="chat-modal-sheet"
          className="pointer-events-auto flex w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-border-100/40 bg-background-100 shadow-2xl"
          style={{ height: "78dvh" }}
          initial={{ y: "100%", opacity: 0.8 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "110%", opacity: 0 }}
          transition={openSpring}
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.04, bottom: 0.5 }}
          onDragEnd={(_e, info) => {
            if (
              info.offset.y > DISMISS_THRESHOLD ||
              info.velocity.y > VELOCITY_THRESHOLD
            ) {
              onDismiss();
            }
          }}
        >
          {titleBar}
          {messagesArea}
          {inputArea}
          <div className="h-[env(safe-area-inset-bottom)]" />
        </motion.div>
      </div>
    </>
  );
}
