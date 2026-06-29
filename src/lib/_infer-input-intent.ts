export type InputIntent = "chat" | "todo" | "note" | "link";

const URL_REGEX = /^https?:\/\/\S+$/i;

const CHAT_STARTERS =
  /^(how|what|why|when|where|who|can you|could you|would you|please|tell me|show me|find|search|summarize|summary|draft|write|reply|respond|explain|list|count|check|look up|help me)/i;

interface InferInputIntentOptions {
  hasEmailEntities?: boolean;
  hasActiveProject?: boolean;
  multiline?: boolean;
}

export function inferInputIntent(
  text: string,
  options: InferInputIntentOptions = {},
): InputIntent {
  const trimmed = text.trim();
  if (!trimmed) return "todo";

  if (URL_REGEX.test(trimmed)) return "link";

  if (options.hasEmailEntities || trimmed.endsWith("?") || CHAT_STARTERS.test(trimmed)) {
    return "chat";
  }

  if (
    options.hasActiveProject
    && (options.multiline || trimmed.includes("\n") || trimmed.length > 100)
  ) {
    return "note";
  }

  return "todo";
}

export function intentLabel(intent: InputIntent): string {
  switch (intent) {
    case "chat":
      return "Chat";
    case "todo":
      return "To-do";
    case "note":
      return "Note";
    case "link":
      return "Link";
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

export function cycleIntent(
  current: InputIntent,
  hasActiveProject: boolean,
): InputIntent {
  const order: InputIntent[] = hasActiveProject
    ? ["todo", "chat", "note", "link"]
    : ["todo", "chat", "link"];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length] ?? "todo";
}
