import { InlineEmailList } from "./_inline-email-list";
import { InlineEmailPreview } from "./_inline-email-preview";
import { InlineQuoteBlock } from "./_inline-quote-block";
import { InlineTodoSuggestions } from "../../todo/_todo-suggestion-card";
import type { InlineEmailCardProps } from "./_inline-email-card";

interface ToolInvocationPart {
  type: "tool-invocation";
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  state: string;
}

type DisplayEmailsArgs = {
  title?: string;
  emails: InlineEmailCardProps[];
};

type DisplayEmailArgs = {
  from: string;
  to?: string;
  subject: string;
  date: string;
  snippet: string;
  bodyText?: string;
  highlight?: string;
};

type DisplayQuoteArgs = {
  text: string;
  from?: string;
  subject?: string;
  context?: string;
};

type SuggestTodosArgs = {
  todos: Array<{
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
  }>;
};

export function isDisplayTool(toolName: string): boolean {
  return toolName === "display_emails"
    || toolName === "display_email"
    || toolName === "display_quote"
    || toolName === "suggest_todos";
}

export function GenerativeUIRenderer({ part }: { part: ToolInvocationPart }) {
  if (part.state === "partial-call") {
    return (
      <div className="animate-pulse rounded-xl border border-border-100/40 bg-background-200/50 px-4 py-3">
        <div className="h-3 w-32 rounded bg-background-300/60" />
        <div className="mt-2 h-3 w-48 rounded bg-background-300/40" />
      </div>
    );
  }

  const raw = part.args ?? (part as unknown as { input?: unknown }).input;
  if (!raw || typeof raw !== "object") return null;
  const args = raw as Record<string, unknown>;

  switch (part.toolName) {
    case "display_emails": {
      const { title, emails } = args as DisplayEmailsArgs;
      if (!Array.isArray(emails) || emails.length === 0) return null;
      return <InlineEmailList title={title} emails={emails} />;
    }

    case "display_email": {
      const { from, to, subject, date, snippet, bodyText, highlight } = args as DisplayEmailArgs;
      if (!from || !subject) return null;
      return (
        <InlineEmailPreview
          from={from}
          to={to}
          subject={subject}
          date={date}
          snippet={snippet}
          bodyText={bodyText}
          highlight={highlight}
        />
      );
    }

    case "display_quote": {
      const { text, from, subject, context } = args as DisplayQuoteArgs;
      if (!text) return null;
      return (
        <InlineQuoteBlock
          text={text}
          from={from}
          subject={subject}
          context={context}
        />
      );
    }

    case "suggest_todos": {
      const { todos } = args as SuggestTodosArgs;
      if (!Array.isArray(todos) || todos.length === 0) return null;
      return (
        <InlineTodoSuggestions
          suggestions={todos}
          onAccept={async (index) => {
            const result = part.result as { ids?: string[] } | undefined;
            const todoId = result?.ids?.[index];
            if (todoId) {
              try { await fetch(`/api/todos/${todoId}/accept`, { method: "POST" }); } catch { /* handled by panel */ }
            }
          }}
          onDecline={async (index) => {
            const result = part.result as { ids?: string[] } | undefined;
            const todoId = result?.ids?.[index];
            if (todoId) {
              try {
                await fetch(`/api/todos/${todoId}/decline`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({}),
                });
              } catch { /* handled by panel */ }
            }
          }}
        />
      );
    }

    default:
      return null;
  }
}
