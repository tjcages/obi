import { generateText } from "ai";
import type { LanguageModel, ModelMessage } from "ai";

export interface ConversationSummaryEntry {
  id: string;
  summary: string;
  date: string;
}

export interface AgentMemory {
  compactionSummary: string | null;
  userFacts: string[];
  conversationSummaries: ConversationSummaryEntry[];
}

export type MemoryEventType =
  | "compaction"
  | "compaction_error"
  | "fact_extraction"
  | "fact_parse_fallback"
  | "fact_parse_error"
  | "fact_consolidation"
  | "summary_generated"
  | "memory_sync"
  | "memory_skip"
  | "memory_error"
  | "codemode_execution"
  | "codemode_error"
  | "token_refresh"
  | "chat_started"
  | "chat_error";

export interface MemoryEvent {
  id: string;
  timestamp: string;
  type: MemoryEventType;
  detail: string;
  data?: Record<string, unknown>;
}

const STORAGE_KEY_COMPACTION = "memory:compaction";
const STORAGE_KEY_USER_FACTS = "memory:user_facts";
const STORAGE_KEY_CONV_SUMMARIES = "memory:conversation_summaries";
const STORAGE_KEY_EVENTS = "memory:events";

const MAX_CONVERSATION_SUMMARIES = 20;
const MAX_USER_FACTS = 50;
const MAX_EVENTS = 200;
const CONSOLIDATION_THRESHOLD = 30;

/**
 * Serialize model messages into a readable transcript for LLM summarization.
 * Strips tool call details to keep the representation compact.
 */
function serializeMessages(messages: ModelMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      continue;
    }
    if (msg.role === "user") {
      const text = typeof msg.content === "string"
        ? msg.content
        : msg.content
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join(" ");
      if (text) lines.push(`User: ${text}`);
    } else if (msg.role === "assistant") {
      const parts = Array.isArray(msg.content) ? msg.content : [];
      const textParts = parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ");
      const toolCalls = parts.filter((p) => p.type === "tool-call");
      if (textParts) lines.push(`Assistant: ${textParts}`);
      if (toolCalls.length > 0) lines.push(`Assistant: [made ${toolCalls.length} tool call(s)]`);
    } else if (msg.role === "tool") {
      const results = Array.isArray(msg.content) ? msg.content : [];
      for (const r of results) {
        if (r.type === "tool-result") {
          const preview = JSON.stringify(r.output).slice(0, 300);
          lines.push(`Tool result: ${preview}`);
        }
      }
    }
  }
  return lines.join("\n");
}

/**
 * Returns true if the messages contain enough substance to be worth
 * extracting memory from. Checks both user and assistant messages —
 * user messages are where personal facts typically appear (e.g. "my name is Tyler").
 */
export function hasSubstantiveContent(messages: ModelMessage[]): boolean {
  let hasUserText = false;
  let hasAssistantText = false;
  let hasToolCall = false;
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join(" ")
          : "";
      if (text.length > 2) hasUserText = true;
    }
    if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        if (msg.content.length > 0) hasAssistantText = true;
      } else if (Array.isArray(msg.content)) {
        for (const p of msg.content) {
          if (p.type === "text" && p.text.length > 0) hasAssistantText = true;
          if (p.type === "tool-call") hasToolCall = true;
        }
      }
    }
  }
  return (hasUserText && hasAssistantText) || hasToolCall;
}

export async function logMemoryEvent(
  storage: DurableObjectStorage,
  type: MemoryEvent["type"],
  detail: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const event: MemoryEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type,
    detail,
    data,
  };
  const existing = (await storage.get<MemoryEvent[]>(STORAGE_KEY_EVENTS)) ?? [];
  existing.push(event);
  await storage.put(STORAGE_KEY_EVENTS, existing.slice(-MAX_EVENTS));
}

export async function getMemoryEvents(
  storage: DurableObjectStorage,
): Promise<MemoryEvent[]> {
  return (await storage.get<MemoryEvent[]>(STORAGE_KEY_EVENTS)) ?? [];
}

export async function compactMessages(
  oldMessages: ModelMessage[],
  existingSummary: string | null,
  model: LanguageModel,
  storage?: DurableObjectStorage,
): Promise<string> {
  const transcript = serializeMessages(oldMessages);
  if (!transcript.trim()) {
    return existingSummary ?? "";
  }

  const prior = existingSummary
    ? `Previous context summary:\n${existingSummary}\n\nNew messages to incorporate:\n`
    : "";

  const { text } = await generateText({
    model,
    system:
      "You are a conversation summarizer for an email management agent. " +
      "Produce a concise summary (max 250 words) of the conversation so far. " +
      "Focus on:\n" +
      "- What the user asked or wanted to accomplish\n" +
      "- What emails were found (subjects, senders, dates, key details)\n" +
      "- What actions were taken (searches, reads, archives, sends)\n" +
      "- Any outstanding questions or next steps\n" +
      "Preserve specific names, email addresses, amounts, dates, and Gmail " +
      "message/thread IDs — do not generalize them away. " +
      "If the previous context summary is provided, merge it with the new messages " +
      "into one unified summary (do not just append).",
    prompt: `${prior}${transcript}`,
  });

  const summary = text.trim();
  if (storage) {
    await logMemoryEvent(storage, "compaction", `Compacted ${oldMessages.length} messages`, {
      messageCount: oldMessages.length,
      summaryLength: summary.length,
      summaryPreview: summary.slice(0, 150),
    });
  }
  return summary;
}

export async function extractUserFacts(
  recentMessages: ModelMessage[],
  existingFacts: string[],
  model: LanguageModel,
  storage?: DurableObjectStorage,
): Promise<string[]> {
  const transcript = serializeMessages(recentMessages);
  if (!transcript.trim()) {
    return existingFacts;
  }

  const known = existingFacts.length > 0
    ? `Already known facts:\n${existingFacts.map((f) => `- ${f}`).join("\n")}\n\n`
    : "";

  const { text } = await generateText({
    model,
    system:
      "You extract durable facts from a conversation. " +
      "Pay close attention to what the USER says — both about themselves AND about how they want the assistant to behave. " +
      "Return ONLY a JSON array of short strings. Each string is one fact.\n" +
      'Example input: "User: my name is Tyler"\n' +
      'Example output: ["User\'s name is Tyler"]\n' +
      'Example input: "User: I work at Acme Corp and my email is ty@acme.com"\n' +
      'Example output: ["User works at Acme Corp", "User\'s email is ty@acme.com"]\n' +
      'Example input: "User: Your name is Obi"\n' +
      'Example output: ["User wants the assistant to be called Obi"]\n' +
      'Example input: "User: Always reply in bullet points"\n' +
      'Example output: ["User prefers responses in bullet points"]\n' +
      "Rules:\n" +
      "- Extract facts the user states about themselves: name, email, employer, " +
      "bank/financial accounts, frequent contacts, preferences, tools they use.\n" +
      "- Extract preferences or instructions about the assistant: name, personality, " +
      "response style, things to always/never do.\n" +
      "- Do NOT repeat facts already known (listed below).\n" +
      "- Do NOT include transient information (specific search queries, one-time requests).\n" +
      "- If there are no new facts, return an empty array: []\n" +
      "- Return ONLY the JSON array, no other text. No explanation, no markdown.",
    prompt: `${known}Conversation:\n${transcript}`,
  });

  let newFacts: string[] = [];
  try {
    const cleaned = text.replace(/^[^[]*/, "").replace(/[^\]]*$/, "");
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      newFacts = parsed.filter((f): f is string => typeof f === "string" && f.length > 0);
    }
  } catch {
    const lines = text
      .split("\n")
      .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter((l) => l.length > 3 && l.length < 200 && !l.startsWith("{") && !l.startsWith("["));
    if (lines.length > 0 && lines.length <= 10) {
      newFacts = lines;
      console.warn("[memory] Recovered", lines.length, "fact(s) from non-JSON LLM output");
      if (storage) {
        void logMemoryEvent(storage, "fact_parse_fallback", `JSON parse failed, recovered ${lines.length} fact(s) from plain text`, {
          rawOutput: text.slice(0, 300),
          recoveredFacts: lines,
        }).catch(() => {});
      }
    } else {
      console.warn("[memory] Failed to parse user facts from LLM output:", text.slice(0, 300));
      if (storage) {
        void logMemoryEvent(storage, "fact_parse_error", "Failed to extract facts from model output", {
          rawOutput: text.slice(0, 300),
          transcript: transcript.slice(0, 200),
        }).catch(() => {});
      }
    }
  }

  const merged = [...existingFacts, ...newFacts].slice(0, MAX_USER_FACTS);

  if (storage && newFacts.length > 0) {
    await logMemoryEvent(storage, "fact_extraction", `Extracted ${newFacts.length} new fact(s)`, {
      newFacts,
      totalFacts: merged.length,
    });
  }

  if (merged.length >= CONSOLIDATION_THRESHOLD) {
    return consolidateFacts(merged, model, storage);
  }

  return merged;
}

/**
 * Ask the LLM to deduplicate and merge semantically similar facts.
 * Runs when the fact list exceeds CONSOLIDATION_THRESHOLD.
 */
async function consolidateFacts(
  facts: string[],
  model: LanguageModel,
  storage?: DurableObjectStorage,
): Promise<string[]> {
  try {
    const { text } = await generateText({
      model,
      system:
        "You are given a list of facts about a user. Some may be duplicates or " +
        "rephrasings of the same information. Merge and deduplicate them into a " +
        "clean, non-redundant list. Keep the most specific/complete version of " +
        "each fact. Return ONLY a JSON array of strings, no other text.",
      prompt: `Facts to consolidate:\n${facts.map((f) => `- ${f}`).join("\n")}`,
    });

    const cleaned = text.replace(/^[^[]*/, "").replace(/[^\]]*$/, "");
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      const consolidated = parsed.filter(
        (f): f is string => typeof f === "string" && f.length > 0,
      );
      if (consolidated.length > 0) {
        console.log(
          "[memory] Consolidated",
          facts.length,
          "facts down to",
          consolidated.length,
        );
        if (storage) {
          await logMemoryEvent(storage, "fact_consolidation", `Consolidated ${facts.length} facts → ${consolidated.length}`, {
            before: facts.length,
            after: consolidated.length,
          });
        }
        return consolidated.slice(0, MAX_USER_FACTS);
      }
    }
  } catch (e) {
    console.warn("[memory] Fact consolidation failed, keeping originals:", e);
    if (storage) {
      void logMemoryEvent(storage, "memory_error", "Fact consolidation failed, kept originals", {
        error: e instanceof Error ? e.message : String(e),
        factCount: facts.length,
      }).catch(() => {});
    }
  }
  return facts;
}

export async function generateConversationSummary(
  recentMessages: ModelMessage[],
  model: LanguageModel,
  storage?: DurableObjectStorage,
): Promise<string> {
  const transcript = serializeMessages(recentMessages);
  if (!transcript.trim()) {
    return "Empty conversation";
  }

  const { text } = await generateText({
    model,
    system:
      "Summarize this email agent conversation in one sentence, max 15 words. " +
      "Focus on the main topic or action. Return ONLY the summary sentence, nothing else.",
    prompt: transcript,
  });

  const summary = text.trim().slice(0, 120) || "Conversation";
  if (storage) {
    await logMemoryEvent(storage, "summary_generated", summary);
  }
  return summary;
}

export async function loadMemory(
  storage: DurableObjectStorage,
): Promise<AgentMemory> {
  const [compactionSummary, userFacts, conversationSummaries] = await Promise.all([
    storage.get<string>(STORAGE_KEY_COMPACTION),
    storage.get<string[]>(STORAGE_KEY_USER_FACTS),
    storage.get<ConversationSummaryEntry[]>(STORAGE_KEY_CONV_SUMMARIES),
  ]);

  return {
    compactionSummary: compactionSummary ?? null,
    userFacts: userFacts ?? [],
    conversationSummaries: conversationSummaries ?? [],
  };
}

export async function saveCompaction(
  storage: DurableObjectStorage,
  summary: string,
): Promise<void> {
  await storage.put(STORAGE_KEY_COMPACTION, summary);
}

export async function saveUserFacts(
  storage: DurableObjectStorage,
  facts: string[],
): Promise<void> {
  await storage.put(STORAGE_KEY_USER_FACTS, facts);
}

export async function saveConversationSummary(
  storage: DurableObjectStorage,
  conversationId: string,
  summary: string,
): Promise<void> {
  const existing =
    (await storage.get<ConversationSummaryEntry[]>(STORAGE_KEY_CONV_SUMMARIES)) ?? [];

  const filtered = existing.filter((e) => e.id !== conversationId);
  filtered.push({
    id: conversationId,
    summary,
    date: new Date().toISOString().slice(0, 10),
  });

  const capped = filtered.slice(-MAX_CONVERSATION_SUMMARIES);
  await storage.put(STORAGE_KEY_CONV_SUMMARIES, capped);
}

export async function getSerializableMemory(
  storage: DurableObjectStorage,
): Promise<{ userFacts: string[]; conversationSummaries: ConversationSummaryEntry[] }> {
  const [userFacts, conversationSummaries] = await Promise.all([
    storage.get<string[]>(STORAGE_KEY_USER_FACTS),
    storage.get<ConversationSummaryEntry[]>(STORAGE_KEY_CONV_SUMMARIES),
  ]);
  return {
    userFacts: userFacts ?? [],
    conversationSummaries: conversationSummaries ?? [],
  };
}

export async function getFullMemoryDebug(
  storage: DurableObjectStorage,
): Promise<AgentMemory & { events: MemoryEvent[]; _storageKeys: string[] }> {
  const [memory, events] = await Promise.all([
    loadMemory(storage),
    getMemoryEvents(storage),
  ]);
  return {
    ...memory,
    events,
    _storageKeys: [STORAGE_KEY_COMPACTION, STORAGE_KEY_USER_FACTS, STORAGE_KEY_CONV_SUMMARIES, STORAGE_KEY_EVENTS],
  };
}

export async function mergeMemoryFrom(
  storage: DurableObjectStorage,
  source: { userFacts: string[]; conversationSummaries: ConversationSummaryEntry[] },
): Promise<void> {
  const local = await getSerializableMemory(storage);

  const mergedFacts = [...new Set([...source.userFacts, ...local.userFacts])].slice(
    0,
    MAX_USER_FACTS,
  );

  const summaryMap = new Map<string, ConversationSummaryEntry>();
  for (const s of source.conversationSummaries) summaryMap.set(s.id, s);
  for (const s of local.conversationSummaries) summaryMap.set(s.id, s);
  const mergedSummaries = [...summaryMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_CONVERSATION_SUMMARIES);

  await Promise.all([
    storage.put(STORAGE_KEY_USER_FACTS, mergedFacts),
    storage.put(STORAGE_KEY_CONV_SUMMARIES, mergedSummaries),
  ]);

  await logMemoryEvent(storage, "memory_sync", `Synced ${mergedFacts.length} facts, ${mergedSummaries.length} summaries from source`, {
    sourceFacts: source.userFacts.length,
    localFacts: local.userFacts.length,
    mergedFacts: mergedFacts.length,
    mergedSummaries: mergedSummaries.length,
  });
}

export async function replaceUserFacts(
  storage: DurableObjectStorage,
  facts: string[],
): Promise<void> {
  const capped = facts.slice(0, MAX_USER_FACTS);
  await storage.put(STORAGE_KEY_USER_FACTS, capped);
}

export async function deleteUserFact(
  storage: DurableObjectStorage,
  index: number,
): Promise<string[]> {
  const facts = (await storage.get<string[]>(STORAGE_KEY_USER_FACTS)) ?? [];
  if (index >= 0 && index < facts.length) {
    facts.splice(index, 1);
    await storage.put(STORAGE_KEY_USER_FACTS, facts);
  }
  return facts;
}
