import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isTextUIPart, type UIMessage } from "ai";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { motion, AnimatePresence } from "motion/react";
import { Copy, Check, CaretRight, Sparkle, Lightning, ArrowUp, X, Globe } from "@phosphor-icons/react";
import { useAutoScroll, toConversationRoomName, cn } from "../../lib";
import { GenerativeUIRenderer, isDisplayTool } from "./chat-ui";

const ERROR_STORAGE_KEY_PREFIX = "gmail-chat:last-error:";

function getStoredError(roomName: string): ChatErrorView & { messageCount: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ERROR_STORAGE_KEY_PREFIX + roomName);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { title: string; detail: string; messageCount: number };
    return parsed.title && parsed.detail && typeof parsed.messageCount === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function setStoredError(roomName: string, view: ChatErrorView, messageCount: number): void {
  try {
    sessionStorage.setItem(ERROR_STORAGE_KEY_PREFIX + roomName, JSON.stringify({ ...view, messageCount }));
  } catch {
    // ignore
  }
}

function clearStoredError(roomName: string): void {
  try {
    sessionStorage.removeItem(ERROR_STORAGE_KEY_PREFIX + roomName);
  } catch {
    // ignore
  }
}

interface GmailChatProps {
  userId: string;
  conversationId: string;
  conversationReady: boolean;
  hasConversation: boolean;
  onUserMessage?: (text: string) => void;
  onCreateConversation?: () => void;
  autoSendPrompt?: string | null;
  onAutoSendComplete?: () => void;
}

type ChatErrorView = {
  title: string;
  detail: string;
};

const MODEL_CONTEXT_WINDOW_TOKENS = 128_000;

const GETTING_STARTED_PROMPTS = [
  "How many unread emails do I have?",
  "Summarize my last 5 emails",
  "What needs my attention?",
  "Find emails I haven't replied to",
  "Show my most recent inbox",
  "Do I have any starred emails?",
];

function estimateContextPercent(messages: UIMessage[]): number {
  const estimatedChars = messages.reduce((total, message) => {
    return total + message.parts.reduce((partTotal, part) => {
      if (isTextUIPart(part)) {
        return partTotal + part.text.length;
      }
      try {
        return partTotal + JSON.stringify(part).length;
      } catch {
        return partTotal;
      }
    }, 0);
  }, 0);

  const estimatedTokens = Math.ceil(estimatedChars / 4);
  return Math.min(100, (estimatedTokens / MODEL_CONTEXT_WINDOW_TOKENS) * 100);
}

export function formatChatError(error: Error | undefined): ChatErrorView | null {
  if (!error) return null;
  const message = typeof error.message === "string" ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("credit balance is too low")
    || lower.includes("quota")
    || lower.includes("insufficient")
    || lower.includes("workers ai")
    || lower.includes("neurons")
  ) {
    return {
      title: "Cloudflare AI quota or billing issue",
      detail: `Chat failed because Workers AI rejected the request: ${message}`,
    };
  }

  return {
    title: "Chat request failed",
    detail: message,
  };
}

function isDisplayToolPart(part: { type: string }): boolean {
  const p = part as unknown as { type: string; toolName?: string };
  const toolName = p.toolName ?? (p.type.startsWith("tool-") ? p.type.slice(5) : undefined);
  return typeof toolName === "string" && isDisplayTool(toolName);
}

function isWebSearchPart(part: { type: string }): boolean {
  const p = part as unknown as { type: string; toolName?: string };
  if (p.toolName === "web_search") return true;
  if (p.type === "tool-web_search") return true;
  return false;
}

function hasContent(msg: UIMessage): boolean {
  return msg.parts.some(
    (part) => (isTextUIPart(part) && part.text.length > 0) || isDisplayToolPart(part) || isWebSearchPart(part),
  );
}

// ── Lightweight Markdown renderer ──

function renderInlineMarkdown(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  const combined = new RegExp(
    `(\\*\\*(.+?)\\*\\*)|(?<!\\*)\\*([^*]+?)\\*(?!\\*)|(\`([^\`]+?)\`)|(\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\))`,
    "g",
  );

  let match: RegExpExecArray | null;
  combined.lastIndex = 0;
  while ((match = combined.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      parts.push(<strong key={key++} className="font-semibold text-foreground-100">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={key++}>{match[3]}</em>);
    } else if (match[4]) {
      parts.push(
        <code key={key++} className="rounded-md bg-foreground-100/6 px-1.5 py-0.5 text-[13px] font-mono text-foreground-100">
          {match[5]}
        </code>,
      );
    } else if (match[6]) {
      parts.push(
        <a key={key++} href={match[8]} target="_blank" rel="noopener noreferrer" className="text-accent-100 underline decoration-accent-100/30 underline-offset-2 hover:decoration-accent-100/60">
          {match[7]}
        </a>,
      );
    }
    lastIndex = combined.lastIndex;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  if (parts.length === 0) return text;
  if (parts.length === 1 && typeof parts[0] === "string") return text;
  return <>{parts}</>;
}

function renderMarkdownText(text: string): ReactNode {
  const lines = text.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code blocks
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      elements.push(
        <div key={key++} className="group relative my-2 overflow-hidden rounded-lg border border-border-100/60 bg-foreground-100/3">
          {lang && (
            <div className="border-b border-border-100/40 px-3 py-1 text-[11px] font-medium text-foreground-300">
              {lang}
            </div>
          )}
          <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
            <code className="font-mono text-foreground-200">{codeLines.join("\n")}</code>
          </pre>
        </div>,
      );
      continue;
    }

    // Headers
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const className = level === 1
        ? "text-base font-semibold text-foreground-100 mt-4 mb-1.5"
        : level === 2
        ? "text-[15px] font-semibold text-foreground-100 mt-3 mb-1"
        : "text-sm font-semibold text-foreground-100 mt-2.5 mb-0.5";
      elements.push(<div key={key++} className={className}>{renderInlineMarkdown(headingMatch[2])}</div>);
      i++;
      continue;
    }

    // Unordered list items
    if (/^[\s]*[-*•]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[\s]*[-*•]\s+/.test(lines[i])) {
        items.push(<li key={key++}>{renderInlineMarkdown(lines[i].replace(/^[\s]*[-*•]\s+/, ""))}</li>);
        i++;
      }
      elements.push(
        <ul key={key++} className="my-1.5 space-y-1 pl-4 list-disc marker:text-foreground-300/40">
          {items}
        </ul>,
      );
      continue;
    }

    // Ordered list items
    if (/^[\s]*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[\s]*\d+[.)]\s+/.test(lines[i])) {
        items.push(<li key={key++}>{renderInlineMarkdown(lines[i].replace(/^[\s]*\d+[.)]\s+/, ""))}</li>);
        i++;
      }
      elements.push(
        <ol key={key++} className="my-1.5 space-y-1 pl-4 list-decimal marker:text-foreground-300/40">
          {items}
        </ol>,
      );
      continue;
    }

    // Blank line → add vertical space
    if (line.trim() === "") {
      elements.push(<div key={key++} className="h-2" />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <div key={key++}>{renderInlineMarkdown(line)}</div>,
    );
    i++;
  }

  return <>{elements}</>;
}

// ── Copy button ──

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-300 transition-colors hover:bg-foreground-100/8 hover:text-foreground-200"
      aria-label="Copy message"
    >
      {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
    </button>
  );
}

// ── Streaming cursor ──

function StreamingCursor() {
  return (
    <motion.div
      className="inline-flex items-center gap-1 py-1"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <span className="inline-block h-4 w-0.5 animate-pulse rounded-full bg-accent-100/70" />
    </motion.div>
  );
}

// ── Web search indicator ──

function WebSearchIndicator({ query, state, results }: {
  query?: string;
  state: string;
  results?: { title: string; url: string; snippet?: string; content?: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const isSearching = state === "input-streaming" || state === "input-available" || state === "partial-call" || state === "call";
  const isDone = state === "output-available" || state === "result";
  const hasResults = isDone && results && results.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="my-2 w-full"
    >
      <button
        type="button"
        onClick={() => hasResults && setExpanded((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
          isSearching
            ? "bg-accent-100/10"
            : "hover:bg-accent-100/5",
        )}
      >
        {isSearching ? (
          <div className="relative flex h-5 w-5 items-center justify-center">
            <Globe size={16} weight="bold" className="text-accent-100" />
            <span className="absolute inset-0 -m-0.5 animate-ping rounded-full bg-accent-100/20" />
          </div>
        ) : (
          <Globe size={16} weight="bold" className="text-accent-100" />
        )}

        <span className="text-[13.5px] font-medium text-accent-100">
          {isSearching ? "Searching the web" : "Searched the web"}
        </span>

        {isSearching ? (
          <div className="ml-auto flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="inline-block h-1 w-1 rounded-full bg-accent-100"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </div>
        ) : hasResults ? (
          <CaretRight
            size={14}
            weight="bold"
            className={cn(
              "ml-auto shrink-0 text-accent-100/60 transition-transform duration-200",
              expanded && "rotate-90",
            )}
          />
        ) : null}
      </button>

      <AnimatePresence>
        {expanded && hasResults && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="ml-7 space-y-1 border-l-2 border-accent-100/15 py-1 pl-3">
              {query && (
                <div className="px-2 py-1 text-[12px] text-foreground-300">
                  Query: &ldquo;{query}&rdquo;
                </div>
              )}
              {results.map((r, i) => {
                let hostname = "";
                try { hostname = new URL(r.url).hostname.replace(/^www\./, ""); } catch { hostname = r.url; }
                return (
                  <a
                    key={i}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent-100/5"
                  >
                    <Globe size={13} className="mt-0.5 shrink-0 text-accent-100/50 group-hover:text-accent-100" />
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-medium text-foreground-200 group-hover:text-accent-100">
                        {r.title || hostname}
                      </div>
                      <div className="truncate text-[11px] text-foreground-300/70">
                        {hostname}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Memory saved indicator ──

interface MemoryNotification {
  id: string;
  facts: string[];
  afterMessageId: string;
}

function MemorySavedIndicator({ facts }: { facts: string[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="my-2 w-full"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent-100/5"
      >
        <Sparkle size={16} weight="fill" className="text-accent-100" />
        <span className="text-[13.5px] font-medium text-accent-100">Saved to memory</span>
        <CaretRight
          size={14}
          weight="bold"
          className={cn(
            "ml-auto shrink-0 text-accent-100/60 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="ml-7 space-y-1 border-l-2 border-accent-100/15 py-1 pl-3">
              {facts.map((fact, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md px-2 py-1.5">
                  <span className="mt-0.5 shrink-0 text-[10px] text-accent-100/40">●</span>
                  <span className="text-[12.5px] leading-relaxed text-foreground-200">{fact}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Thinking / reasoning collapse ──

function extractTexts(msg: UIMessage): string[] {
  return msg.parts
    .filter((p) => isTextUIPart(p) && p.text.trim())
    .map((p) => (p as unknown as { text: string }).text);
}

interface ThinkingAnalysis {
  hiddenMsgIds: Set<string>;
  thinkingTexts: Map<string, string[]>;
  skipParts: Map<string, Set<number>>;
}

function analyzeThinking(msgs: UIMessage[]): ThinkingAnalysis {
  const hiddenMsgIds = new Set<string>();
  const thinkingTexts = new Map<string, string[]>();
  const skipParts = new Map<string, Set<number>>();
  let buffer: string[] = [];

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];

    if (msg.role !== "assistant") {
      buffer = [];
      continue;
    }

    const hasDisplay = msg.parts.some(isDisplayToolPart);
    const nextIsAssistant = msgs[i + 1]?.role === "assistant";

    const parts = msg.parts as Array<{ type: string; [k: string]: unknown }>;
    const withinThinking: { text: string; partIndex: number }[] = [];
    for (let pi = 0; pi < parts.length; pi++) {
      if (parts[pi].type !== "text") continue;
      const txt = (parts[pi] as unknown as { text: string }).text;
      if (!txt.trim()) continue;
      const hasToolAfter = parts.slice(pi + 1).some((p) => p.type === "tool-invocation");
      if (hasToolAfter) {
        withinThinking.push({ text: txt, partIndex: pi });
      }
    }

    if (nextIsAssistant && !hasDisplay) {
      hiddenMsgIds.add(msg.id);
      buffer.push(...withinThinking.map((t) => t.text));
      for (let pi = 0; pi < parts.length; pi++) {
        if (parts[pi].type !== "text") continue;
        const txt = (parts[pi] as unknown as { text: string }).text;
        if (!txt.trim()) continue;
        if (!withinThinking.some((wt) => wt.partIndex === pi)) {
          buffer.push(txt);
        }
      }
    } else {
      const allThinking = [...buffer, ...withinThinking.map((t) => t.text)];
      if (allThinking.length > 0) {
        thinkingTexts.set(msg.id, allThinking);
      }
      if (withinThinking.length > 0) {
        skipParts.set(msg.id, new Set(withinThinking.map((t) => t.partIndex)));
      }
      buffer = [];
    }
  }

  return { hiddenMsgIds, thinkingTexts, skipParts };
}

function deriveThinkingLabel(thinkingTexts: string[]): string {
  const joined = thinkingTexts.join(" ").toLowerCase();
  if (joined.includes("search") || joined.includes("find") || joined.includes("looking") || joined.includes("fetch")) {
    return "Searched your emails";
  }
  if (joined.includes("unread")) return "Checked unread emails";
  if (joined.includes("inbox")) return "Looked through inbox";
  if (joined.includes("reply") || joined.includes("respond")) return "Preparing reply";
  if (joined.includes("draft")) return "Drafting response";
  const first = thinkingTexts[0].trim();
  if (first.length <= 50) return first.replace(/\.\.\.$/, "").replace(/\.$/, "");
  return first.slice(0, 47).replace(/\s+\S*$/, "") + "...";
}

function ThinkingSection({ texts, isActive }: { texts: string[]; isActive?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const label = deriveThinkingLabel(texts);
  const stepCount = texts.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="my-2 w-full"
    >
      <button
        type="button"
        onClick={() => !isActive && setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
          isActive ? "bg-accent-100/10" : "hover:bg-accent-100/5",
        )}
      >
        {isActive ? (
          <div className="relative flex h-5 w-5 items-center justify-center">
            <Lightning size={16} weight="fill" className="text-accent-100" />
            <span className="absolute inset-0 -m-0.5 animate-ping rounded-full bg-accent-100/20" />
          </div>
        ) : (
          <Lightning size={16} weight="fill" className="text-accent-100" />
        )}

        <span className="text-[13.5px] font-medium text-accent-100">
          {isActive ? "Thinking" : label}
        </span>

        {isActive ? (
          <div className="ml-auto flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="inline-block h-1 w-1 rounded-full bg-accent-100"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </div>
        ) : (
          <>
            {stepCount > 1 && (
              <span className="text-[12px] text-accent-100/50">· {stepCount} steps</span>
            )}
            <CaretRight
              size={14}
              weight="bold"
              className={cn(
                "ml-auto shrink-0 text-accent-100/60 transition-transform duration-200",
                expanded && "rotate-90",
              )}
            />
          </>
        )}
      </button>
      <AnimatePresence>
        {expanded && !isActive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="ml-7 space-y-1 border-l-2 border-accent-100/15 py-1 pl-3">
              {texts.map((text, i) => (
                <div key={i} className="rounded-md px-2 py-1.5 text-[12.5px] leading-relaxed text-foreground-300/60">
                  {text}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Message list ──

function MessageList({
  messages,
  isLoading,
  errorView,
  memoryNotifs,
}: {
  messages: UIMessage[];
  isLoading: boolean;
  errorView: ChatErrorView | null;
  memoryNotifs: MemoryNotification[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScroll(scrollRef, [messages, isLoading, errorView?.detail, memoryNotifs.length]);

  const visibleMessages = messages.filter((msg) => msg.role !== "assistant" || hasContent(msg));

  const analysis = useMemo(
    () => analyzeThinking(visibleMessages),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages],
  );

  const notifsMap = useMemo(() => {
    const map = new Map<string, MemoryNotification[]>();
    for (const n of memoryNotifs) {
      const existing = map.get(n.afterMessageId) ?? [];
      existing.push(n);
      map.set(n.afterMessageId, existing);
    }
    return map;
  }, [memoryNotifs]);

  const lastRawMsg = messages[messages.length - 1];
  const lastRawPart = lastRawMsg?.parts[lastRawMsg.parts.length - 1];
  const lastPartIsDisplayTool = lastRawPart && isDisplayToolPart(lastRawPart);
  const isToolExecuting = isLoading && !lastPartIsDisplayTool && (!lastRawMsg || lastRawMsg.role === "user" || (lastRawPart && !isTextUIPart(lastRawPart)));

  const lastVisible = visibleMessages[visibleMessages.length - 1];
  const isActivelyThinking = (() => {
    if (!isLoading || !lastVisible || lastVisible.role !== "assistant") return false;
    if (analysis.hiddenMsgIds.has(lastVisible.id)) return true;
    const skips = analysis.skipParts.get(lastVisible.id);
    if (!skips || skips.size === 0) return false;
    const textPartIndices = lastVisible.parts
      .map((p, i) => (isTextUIPart(p) && p.text.trim() ? i : -1))
      .filter((i) => i !== -1);
    return textPartIndices.length > 0 && textPartIndices.every((i) => skips.has(i));
  })();

  const lastVisibleIsError = visibleMessages.length > 0 && visibleMessages[visibleMessages.length - 1].parts.some(p => isTextUIPart(p) && p.text.startsWith("[SYSTEM_ERROR] "));

  // Collect all text from an assistant message for the copy button
  const getAssistantText = useCallback((msg: UIMessage): string => {
    return msg.parts
      .filter(isTextUIPart)
      .map((p) => (p as { text: string }).text)
      .join("\n");
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto" ref={scrollRef}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-1 px-5 py-8">
        {visibleMessages.map((msg, msgIdx) => {
          const textPart = msg.parts.find(isTextUIPart);
          const notifs = notifsMap.get(msg.id);

          if (msg.role === "assistant" && textPart && textPart.text.startsWith("[SYSTEM_ERROR] ")) {
            const errorMsg = textPart.text.replace("[SYSTEM_ERROR] ", "");
            const fakeErrorView = formatChatError(new Error(errorMsg));
            return (
              <Fragment key={msg.id}>
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: 0.05 }}
                  className="mt-2 rounded-xl border border-destructive-100/20 bg-destructive-100/6 px-4 py-3 text-sm"
                >
                  <div className="flex items-center gap-2 font-medium text-destructive-100">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive-100/15 text-[11px]">!</div>
                    {fakeErrorView?.title || "Chat request failed"}
                  </div>
                  <div className="mt-1.5 text-foreground-200/80">{fakeErrorView?.detail || errorMsg}</div>
                </motion.div>
                {notifs?.map((n) => <MemorySavedIndicator key={`mem-${n.id}`} facts={n.facts} />)}
              </Fragment>
            );
          }

          // ── User message ──
          if (msg.role === "user") {
            return (
              <Fragment key={msg.id}>
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: 0.03 }}
                  className="group mt-5 flex justify-end first:mt-0"
                >
                  <div className="min-w-0 max-w-[80%] shrink-0 overflow-hidden whitespace-pre-wrap wrap-break-word rounded-2xl bg-foreground-100/6 px-4 py-2.5 text-[15px] leading-relaxed text-foreground-100 select-text">
                    {msg.parts.map((part, index) => {
                      if (isTextUIPart(part)) {
                        return <div key={`${msg.id}-part-${index}`} className="overflow-hidden wrap-break-word">{part.text}</div>;
                      }
                      return null;
                    })}
                  </div>
                </motion.div>
                {notifs?.map((n) => <MemorySavedIndicator key={`mem-${n.id}`} facts={n.facts} />)}
              </Fragment>
            );
          }

          // Skip hidden thinking messages
          if (analysis.hiddenMsgIds.has(msg.id)) return null;

          // ── Assistant message ──
          const thinking = analysis.thinkingTexts.get(msg.id);
          const partsToSkip = analysis.skipParts.get(msg.id);
          const fullText = getAssistantText(msg);

          return (
            <Fragment key={msg.id}>
              {thinking && thinking.length > 0 && (
                <ThinkingSection texts={thinking} />
              )}
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.05 }}
                className="group mt-1 first:mt-0"
              >
                {msg.parts.map((part, index) => {
                  if (partsToSkip?.has(index)) return null;

                  const key = `${msg.id}-part-${index}`;
                  if (isDisplayToolPart(part)) {
                    return (
                      <div key={key} className="w-full py-1" data-message-part="display-tool">
                        <GenerativeUIRenderer part={part as unknown as { type: "tool-invocation"; toolCallId: string; toolName: string; args: unknown; result?: unknown; state: string }} />
                      </div>
                    );
                  }
                  if (isWebSearchPart(part)) {
                    const p = part as unknown as { state: string; input?: { query?: string }; args?: { query?: string }; output?: { results?: { title: string; url: string; snippet?: string; content?: string }[] }; result?: { results?: { title: string; url: string; snippet?: string; content?: string }[] } };
                    const query = p.input?.query ?? p.args?.query;
                    const results = p.output?.results ?? p.result?.results;
                    return (
                      <WebSearchIndicator
                        key={key}
                        query={query}
                        state={p.state}
                        results={results}
                      />
                    );
                  }
                  if (isTextUIPart(part)) {
                    return (
                      <div
                        key={key}
                        className="w-full min-w-0 whitespace-pre-wrap wrap-break-word text-[15px] leading-[1.7] text-foreground-200 select-text"
                        data-message-part="text"
                      >
                        {renderMarkdownText(part.text)}
                      </div>
                    );
                  }
                  return null;
                })}
                {/* Hover action bar */}
                {fullText && (
                  <div className="mt-1 flex h-0 items-center gap-1 overflow-hidden opacity-0 transition-all duration-150 group-hover:h-7 group-hover:opacity-100">
                    <CopyButton text={fullText} />
                  </div>
                )}
              </motion.div>
              {notifs?.map((n) => <MemorySavedIndicator key={`mem-${n.id}`} facts={n.facts} />)}
            </Fragment>
          );
        })}

        {isActivelyThinking && (
          <ThinkingSection
            texts={extractTexts(lastVisible)}
            isActive
          />
        )}

        {isToolExecuting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="py-2"
          >
            <StreamingCursor />
          </motion.div>
        )}

        {errorView && !lastVisibleIsError && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-2 rounded-xl border border-destructive-100/20 bg-destructive-100/6 px-4 py-3 text-sm"
          >
            <div className="flex items-center gap-2 font-medium text-destructive-100">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive-100/15 text-[11px]">!</div>
              {errorView.title}
            </div>
            <div className="mt-1.5 text-foreground-200/80">{errorView.detail}</div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ── Getting started ──

function GettingStartedView({ onPromptClick }: { onPromptClick: (text: string) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center px-5 py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="flex flex-col items-center gap-6"
        >
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100/10">
              <Sparkle size={20} weight="fill" className="text-accent-100" />
            </div>
            <p className="text-sm text-foreground-300">
              Ask about your inbox
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {GETTING_STARTED_PROMPTS.map((prompt, i) => (
              <motion.button
                key={prompt}
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: i * 0.04 }}
                onClick={() => onPromptClick(prompt)}
                className="rounded-full border border-border-100 bg-background-100 px-3.5 py-1.5 text-[13px] text-foreground-200 transition-colors hover:border-foreground-300/40 hover:text-foreground-100"
              >
                {prompt}
              </motion.button>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ── Chat input ──

const MAX_ROWS = 6;
const LINE_HEIGHT = 24;
const PADDING_Y = 24;
const MIN_HEIGHT = LINE_HEIGHT + PADDING_Y;
const MAX_HEIGHT = LINE_HEIGHT * MAX_ROWS + PADDING_Y;

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

function QueuedMessageCard({
  message,
  onEdit,
  onDelete,
  onSendNow,
  onUnqueue,
}: {
  message: string;
  onEdit: (text: string) => void;
  onDelete: () => void;
  onSendNow: () => void;
  onUnqueue: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setEditText(message); }, [message]);
  useEffect(() => { if (editing) editRef.current?.focus(); }, [editing]);

  const commitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== message) onEdit(trimmed);
    else setEditText(message);
    setEditing(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="mb-2 rounded-xl border border-border-100 bg-background-200/80 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          <span className="text-[11px] font-medium text-foreground-300">Queued</span>
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                if (e.key === "Escape") { setEditText(message); setEditing(false); }
              }}
              className="w-full resize-none rounded-md border border-border-100 bg-background-100 px-2 py-1 text-[13px] leading-relaxed text-foreground-100 outline-none focus:border-accent-100"
              rows={1}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              onDoubleClick={(e) => { e.preventDefault(); onUnqueue(); }}
              className="w-full cursor-text truncate text-left text-[13px] leading-relaxed text-foreground-200 hover:text-foreground-100"
              title="Click to edit · Double-click to move back to input"
            >
              {message}
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onSendNow}
            aria-label="Send now"
            className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-300 transition-colors hover:bg-foreground-100/8 hover:text-foreground-100"
            title="Send now"
          >
            <ArrowUp size={13} weight="bold" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete queued message"
            className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-300 transition-colors hover:bg-destructive-100/10 hover:text-destructive-100"
            title="Delete"
          >
            <X size={13} weight="bold" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function ChatInputBar({
  input,
  onChange,
  onSubmit,
  disabled,
  contextPercent = 0,
  isLoading,
  onStop,
  queuedMessage,
  onEditQueued,
  onDeleteQueued,
  onSendNowQueued,
}: {
  input: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  disabled?: boolean;
  contextPercent?: number;
  isLoading?: boolean;
  onStop?: () => void;
  queuedMessage?: string | null;
  onEditQueued?: (text: string) => void;
  onDeleteQueued?: () => void;
  onSendNowQueued?: () => void;
  onUnqueueQueued?: () => void;
}) {
  const boundedPercent = Math.max(0, Math.min(100, contextPercent));
  const canSend = !disabled && input.trim().length > 0;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0";
    const scrollH = el.scrollHeight;
    el.style.height = `${Math.min(Math.max(scrollH, MIN_HEIGHT), MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => resize(), [input, resize]);

  useEffect(() => {
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    if (!isDesktop) return;
    const t = setTimeout(() => textareaRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        const form = e.currentTarget.form;
        if (form) form.requestSubmit();
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-5 pt-2">
      <AnimatePresence>
        {queuedMessage && onEditQueued && onDeleteQueued && onSendNowQueued && onUnqueueQueued && (
          <QueuedMessageCard
            message={queuedMessage}
            onEdit={onEditQueued}
            onDelete={onDeleteQueued}
            onSendNow={onSendNowQueued}
            onUnqueue={onUnqueueQueued}
          />
        )}
      </AnimatePresence>
      <form
        className="flex items-end gap-2"
        onSubmit={onSubmit}
      >
        <div className="flex min-w-0 flex-1 items-end rounded-2xl border border-border-100 bg-background-200 transition-all focus-within:border-foreground-300/50 focus-within:bg-background-100 focus-within:shadow-lg">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your inbox..."
            disabled={disabled}
            rows={1}
            aria-label="Chat message"
            className="flex-1 resize-none bg-transparent py-3 pl-4 pr-2 text-[15px] leading-[24px] text-foreground-100 outline-none placeholder:text-foreground-300 disabled:opacity-40"
            style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
          />
          <div className="flex shrink-0 items-center gap-1.5 pb-2 pr-2">
            <ContextProgressRing percent={boundedPercent} />
            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
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
}

// ── Main component ──

export function GmailChat({
  userId,
  conversationId,
  conversationReady,
  hasConversation,
  onUserMessage,
  onCreateConversation,
  autoSendPrompt,
  onAutoSendComplete,
}: GmailChatProps) {
  const host = typeof window !== "undefined" ? window.location.origin : "";
  const roomName = toConversationRoomName(userId, conversationId);
  const [hasAttemptedSend, setHasAttemptedSend] = useState(false);

  const agent = useAgent({
    agent: "inbox-agent",
    name: roomName,
    host,
  });

  const { messages, sendMessage, stop, status, error, clearError } = useAgentChat({
    agent,
  });
  const [input, setInput] = useState("");
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [memoryNotifs, setMemoryNotifs] = useState<MemoryNotification[]>([]);
  const lastEventIdRef = useRef<string | null>(null);
  const prevStatusRef = useRef(status);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    setMemoryNotifs([]);
    lastEventIdRef.current = null;
    void (async () => {
      try {
        const res = await fetch(`/agents/inbox-agent/${encodeURIComponent(roomName)}/memory/events`);
        if (!res.ok) return;
        const events: Array<{ id: string }> = await res.json();
        if (events.length > 0) {
          lastEventIdRef.current = events[events.length - 1].id;
        }
      } catch { /* non-critical */ }
    })();
  }, [roomName]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if ((prev === "streaming" || prev === "submitted") && status === "ready" && messagesRef.current.length > 0) {
      const timer = setTimeout(() => void fetchNewMemoryEvents(), 3000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const fetchNewMemoryEvents = useCallback(async () => {
    try {
      const res = await fetch(`/agents/inbox-agent/${encodeURIComponent(roomName)}/memory/events`);
      if (!res.ok) return;
      const events: Array<{ id: string; type: string; data?: Record<string, unknown> }> = await res.json();

      const cutoff = lastEventIdRef.current;
      let pastCutoff = !cutoff;
      const newFactEvents: typeof events = [];
      for (const e of events) {
        if (e.id === cutoff) { pastCutoff = true; continue; }
        if (pastCutoff && e.type === "fact_extraction") newFactEvents.push(e);
      }
      if (events.length > 0) lastEventIdRef.current = events[events.length - 1].id;

      if (newFactEvents.length > 0) {
        const msgs = messagesRef.current;
        const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
        if (lastAssistant) {
          const facts = newFactEvents.flatMap((e) =>
            Array.isArray(e.data?.newFacts) ? (e.data!.newFacts as string[]) : [],
          );
          if (facts.length > 0) {
            setMemoryNotifs((prev) => {
              const existing = new Set(prev.map((n) => n.id));
              if (existing.has(newFactEvents[0].id)) return prev;
              return [...prev, { id: newFactEvents[0].id, facts, afterMessageId: lastAssistant.id }];
            });
          }
        }
      }
    } catch { /* non-critical */ }
  }, [roomName]);

  useEffect(() => {
    if (!error) return;
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("no refresh token available")) {
      window.location.assign("/logout");
    }
  }, [error]);
  const autoSendFired = useRef(false);
  useEffect(() => {
    if (!autoSendPrompt || !conversationReady || autoSendFired.current) return;
    autoSendFired.current = true;
    onUserMessage?.(autoSendPrompt);
    void sendMessage({ text: autoSendPrompt });
    setHasAttemptedSend(true);
    onAutoSendComplete?.();
  }, [autoSendPrompt, conversationReady, sendMessage, onUserMessage, onAutoSendComplete]);

  const [persistedErrorView, setPersistedErrorView] = useState<ChatErrorView | null>(null);
  const isLoading = status === "submitted" || status === "streaming";
  const liveErrorView = useMemo(
    () => (hasAttemptedSend ? formatChatError(error) : null),
    [hasAttemptedSend, error]
  );

  useEffect(() => {
    if (liveErrorView && messages.length > 0) {
      setStoredError(roomName, liveErrorView, messages.length);
      setPersistedErrorView(liveErrorView);
    }
  }, [liveErrorView, messages.length, roomName]);

  useEffect(() => {
    if (!conversationReady || messages.length === 0) return;
    const lastIsUser = messages[messages.length - 1]?.role === "user";
    if (lastIsUser) {
      const stored = getStoredError(roomName);
      if (stored && stored.messageCount === messages.length)
        setPersistedErrorView({ title: stored.title, detail: stored.detail });
    } else {
      clearStoredError(roomName);
      setPersistedErrorView(null);
    }
  }, [conversationReady, roomName, messages.length, messages[messages.length - 1]?.role]);

  const errorView = liveErrorView ?? (messages.length > 0 && messages[messages.length - 1]?.role === "user" ? persistedErrorView : null);
  const contextPercent = useMemo(() => estimateContextPercent(messages), [messages]);
  const inputDisabled = !conversationReady;

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = input.trim();
      if (!text || !conversationReady) return;

      if (isLoading) {
        setQueuedMessage(text);
        setInput("");
        return;
      }

      setHasAttemptedSend(true);
      if (error) clearError();
      clearStoredError(roomName);
      setPersistedErrorView(null);
      onUserMessage?.(text);
      void sendMessage({ text });
      setInput("");
    },
    [input, conversationReady, isLoading, sendMessage, error, clearError, onUserMessage, roomName]
  );

  useEffect(() => {
    if (status === "ready" && queuedMessage) {
      const text = queuedMessage;
      setQueuedMessage(null);
      setHasAttemptedSend(true);
      onUserMessage?.(text);
      void sendMessage({ text });
    }
  }, [status, queuedMessage, sendMessage, onUserMessage]);

  const handleEditQueued = useCallback((text: string) => {
    setQueuedMessage(text);
  }, []);

  const handleDeleteQueued = useCallback(() => {
    setQueuedMessage(null);
  }, []);

  const handleUnqueueQueued = useCallback(() => {
    if (!queuedMessage) return;
    setInput(queuedMessage);
    setQueuedMessage(null);
  }, [queuedMessage]);

  const handleSendNowQueued = useCallback(() => {
    if (!queuedMessage) return;
    const text = queuedMessage;
    setQueuedMessage(null);
    setHasAttemptedSend(true);
    if (error) clearError();
    clearStoredError(roomName);
    setPersistedErrorView(null);
    onUserMessage?.(text);
    void sendMessage({ text });
  }, [queuedMessage, sendMessage, error, clearError, onUserMessage, roomName]);

  const handlePromptClick = useCallback(
    (text: string) => {
      if (inputDisabled) return;
      setHasAttemptedSend(true);
      if (error) clearError();
      clearStoredError(roomName);
      setPersistedErrorView(null);
      onUserMessage?.(text);
      void sendMessage({ text });
    },
    [inputDisabled, sendMessage, error, clearError, onUserMessage, roomName]
  );

  if (!hasConversation || !roomName) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-5 py-8 text-center">
        <p className="mb-4 text-sm text-foreground-300">
          No conversation selected
        </p>
        <button
          type="button"
          onClick={onCreateConversation}
          className="rounded-xl bg-foreground-100 px-4 py-2.5 text-sm font-medium text-background-100 transition-colors hover:bg-foreground-100/90"
        >
          Start new conversation
        </button>
      </div>
    );
  }

  const showGettingStarted = messages.length === 0 && conversationReady && !isLoading;

  return (
    <div className="flex h-full min-w-0 flex-col">
      {!conversationReady && (
        <div className="border-b border-border-100/50 bg-background-200/50 px-5 py-2 text-[13px] text-foreground-300">
          Preparing this conversation...
        </div>
      )}
      {showGettingStarted ? (
        <GettingStartedView onPromptClick={handlePromptClick} />
      ) : (
        <MessageList messages={messages} isLoading={isLoading} errorView={errorView} memoryNotifs={memoryNotifs} />
      )}
      <ChatInputBar
        input={input}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
        onSubmit={handleSubmit}
        disabled={inputDisabled}
        contextPercent={contextPercent}
        isLoading={isLoading}
        onStop={stop}
        queuedMessage={queuedMessage}
        onEditQueued={handleEditQueued}
        onDeleteQueued={handleDeleteQueued}
        onSendNowQueued={handleSendNowQueued}
        onUnqueueQueued={handleUnqueueQueued}
      />
    </div>
  );
}

export default GmailChat;
