import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "../../lib";
import type { TodoItem } from "../../lib";
import { SmartText } from "../smart-input";
import { SwipeableEmailRow } from "../ui/_swipeable-email-row";

const SlackIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z" />
  </svg>
);

function parseSenderName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : from.split("@")[0];
}

function extractCompany(from: string): string | null {
  const emailMatch = from.match(/@([^>]+)/);
  if (!emailMatch) return null;
  const domain = emailMatch[1].toLowerCase();
  const free = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "protonmail.com", "mail.com", "me.com"]);
  if (free.has(domain)) return null;
  const name = domain.split(".")[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

interface TodoSuggestionCardProps {
  todo: TodoItem;
  onAccept: (id: string) => void;
  onAcceptAndComplete: (id: string) => void;
  onDecline: (id: string, reason?: string) => void;
  onUpdate: (id: string, updates: Partial<Pick<TodoItem, "title" | "description">>) => void;
  onEmailClick?: (threadId: string, accountEmail?: string) => void;
  onSlackClick?: (slackRef: TodoItem["sourceSlack"]) => void;
}

export function TodoSuggestionCard({
  todo,
  onAccept,
  onAcceptAndComplete,
  onDecline,
  onUpdate,
  onEmailClick,
  onSlackClick,
}: TodoSuggestionCardProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(todo.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(todo.description ?? "");
  const descInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (editingDesc && descInputRef.current) {
      descInputRef.current.focus();
      descInputRef.current.select();
    }
  }, [editingDesc]);

  const commitTitle = useCallback(() => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== todo.title) {
      onUpdate(todo.id, { title: trimmed });
    } else {
      setTitleDraft(todo.title);
    }
    setEditingTitle(false);
  }, [titleDraft, todo.id, todo.title, onUpdate]);

  const commitDesc = useCallback(() => {
    const trimmed = descDraft.trim();
    if (trimmed !== (todo.description ?? "")) {
      onUpdate(todo.id, { description: trimmed || undefined });
    } else {
      setDescDraft(todo.description ?? "");
    }
    setEditingDesc(false);
  }, [descDraft, todo.id, todo.description, onUpdate]);
  return (
      <SwipeableEmailRow
        onArchive={() => onDecline(todo.id)}
        onReply={() => onAccept(todo.id)}
        className="bg-background-100"
        containerClassName="rounded-xl border border-blue-200/60 dark:border-blue-800/40"
        compact
        archiveLabel="Dismiss"
        replyLabel="Accept"
      >
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          {/* Checkbox — accept AND mark complete */}
          <button
            type="button"
            onClick={() => onAcceptAndComplete(todo.id)}
            className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-foreground-300 transition-all hover:border-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
            title="Add & mark complete"
          />

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div
              className="cursor-text text-sm font-medium leading-snug text-foreground-100"
              onDoubleClick={() => { if (!editingTitle) { setTitleDraft(todo.title); setEditingTitle(true); } }}
            >
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitTitle(); }
                    if (e.key === "Escape") { setTitleDraft(todo.title); setEditingTitle(false); }
                  }}
                  className="input-reset"
                />
              ) : (
                <SmartText text={todo.title} categories={todo.categories} entities={todo.entities} />
              )}
            </div>
            {/* Context line: source badge + date badge + description */}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {todo.sourceEmails.length > 0 && (() => {
                const email = todo.sourceEmails[0];
                const sender = parseSenderName(email.from);
                const company = extractCompany(email.from);
                return (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEmailClick?.(email.threadId, email.accountEmail);
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-foreground-100/6 px-1.5 py-0.5 text-[11px] font-medium text-foreground-200 transition-colors hover:bg-foreground-100/10"
                  >
                    <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-foreground-100/10 text-[8px] font-bold text-foreground-200">
                      {sender.charAt(0).toUpperCase()}
                    </div>
                    {sender}
                    {company && (
                      <span className="text-foreground-300">
                        @ {company}
                      </span>
                    )}
                  </button>
                );
              })()}
              {todo.sourceSlack && todo.sourceSlack.length > 0 && (() => {
                const slack = todo.sourceSlack![0];
                const channel = slack.channelName ? `#${slack.channelName}` : "Slack";
                return (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSlackClick?.(todo.sourceSlack);
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-[#4A154B]/8 px-1.5 py-0.5 text-[11px] font-medium text-[#4A154B] transition-colors hover:bg-[#4A154B]/15 dark:bg-[#4A154B]/20 dark:text-[#E8B4E9] dark:hover:bg-[#4A154B]/30"
                  >
                    <SlackIcon className="h-3 w-3 shrink-0" />
                    {slack.from}
                    <span className="opacity-60">
                      in {channel}
                    </span>
                  </button>
                );
              })()}
              {todo.scheduledDate && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {new Date(todo.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
            {(editingDesc || todo.description) && (
              <p
                className="mt-0.5 cursor-text truncate text-[11px] text-foreground-300"
                onDoubleClick={() => { if (!editingDesc) { setDescDraft(todo.description ?? ""); setEditingDesc(true); } }}
              >
                {editingDesc ? (
                  <input
                    ref={descInputRef}
                    type="text"
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    onBlur={commitDesc}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitDesc(); }
                      if (e.key === "Escape") { setDescDraft(todo.description ?? ""); setEditingDesc(false); }
                    }}
                    className="input-reset"
                    placeholder="Add a description..."
                  />
                ) : (
                  todo.description
                )}
              </p>
            )}
          </div>

          {/* Accept — add to list as pending */}
          <button
            type="button"
            onClick={() => onAccept(todo.id)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white transition-colors hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500"
            title="Add to list"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>

          {/* Dismiss */}
          <button
            type="button"
            onClick={() => onDecline(todo.id)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-100 text-foreground-300 transition-colors hover:border-foreground-300 hover:text-foreground-200"
            title="Dismiss"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </SwipeableEmailRow>
  );
}

/** Inline version rendered inside chat messages */
export function InlineTodoSuggestions({
  suggestions,
  onAccept,
  onDecline,
}: {
  suggestions: Array<{
    title: string;
    description?: string;
    scheduledDate?: string;
    sourceEmail?: {
      messageId: string;
      threadId: string;
      subject: string;
      from: string;
      snippet: string;
      accountEmail?: string;
    };
    sourceSlack?: {
      channelId: string;
      threadTs: string;
      from: string;
      text: string;
      channelName?: string;
    };
  }>;
  onAccept: (index: number) => void;
  onDecline: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-blue-500 dark:text-blue-400">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z" />
        </svg>
        Suggested to-do items
      </div>
      {suggestions.map((s, i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 rounded-lg border border-blue-100/60 bg-blue-50/50 p-2.5 dark:border-blue-800/30 dark:bg-blue-950/15"
        >
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-foreground-100">{s.title}</div>
            {s.sourceEmail && (
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-foreground-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                <span className="truncate">{parseSenderName(s.sourceEmail.from)} — {s.sourceEmail.subject}</span>
              </div>
            )}
            {s.sourceSlack && (
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-foreground-300">
                <SlackIcon className="h-[9px] w-[9px] shrink-0" />
                <span className="truncate">{s.sourceSlack.from} in {s.sourceSlack.channelName ? `#${s.sourceSlack.channelName}` : "Slack"}</span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onAccept(i)}
              className="rounded-md bg-blue-500 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-600"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => onDecline(i)}
              className="rounded-md border border-border-100 bg-background-100 px-2.5 py-1 text-[11px] text-foreground-200 transition-colors hover:border-foreground-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
