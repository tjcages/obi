import { AIChatAgent } from "@cloudflare/ai-chat";
import { convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import type { StreamTextOnFinishCallback, ToolSet, UIMessage } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { InboxDog } from "inbox.dog";
import { createGmailTools } from "./_gmail-tools";
import { GMAIL_API_SURFACE } from "./_api-surface";
import {
  type ConnectedAccount,
  STORAGE_KEY_ACCOUNTS,
  STORAGE_KEY_ACTIVE_EMAILS,
  migrateFromSingleSession,
  pickDefaultColor,
  toPublicAccount,
} from "../lib";
import {
  loadMemory,
  compactMessages,
  saveCompaction,
  extractUserFacts,
  saveUserFacts,
  generateConversationSummary,
  saveConversationSummary,
  getSerializableMemory,
  getFullMemoryDebug,
  mergeMemoryFrom,
  hasSubstantiveContent,
  getMemoryEvents,
  replaceUserFacts,
  deleteUserFact,
  logMemoryEvent,
  type AgentMemory,
} from "./_memory";
import { z } from "zod";
import {
  loadTodos,
  loadArchivedTodos,
  loadPreferences,
  savePreferences,
  loadCategories,
  saveCategories,
  loadCategoryColors,
  saveCategoryColors,
  addTodo,
  updateTodo,
  deleteTodo,
  completeTodo,
  reorderTodos,
  acceptSuggestion,
  declineSuggestion,
  archiveCompletedTodos,
  addSuggestedTodos,
  clearSuggestions,
  buildTodoPreferenceContext,
  getNextMidnight,
  type TodoItem,
  type TodoPreferences,
} from "./_todos";
import {
  loadScanConfig,
  saveScanConfig,
  loadScanUsage,
  recordScanUsage,
  touchLastScanAt,
  canScan,
  getDefaultScanConfig,
  type ScanConfig,
} from "./_scan-quota";
import {
  type FeedItem,
  getOrCreateWorkspace,
  addFeedItem,
  updateFeedItem,
  deleteFeedItem,
  updateWorkspaceDescription,
  reorderTimeline,
  loadWorkspace,
  buildWorkspaceContext,
} from "./_workspace";
import { scanInboxForTodos, type ScanResult } from "./_inbox-scanner";
import { scanSlackForTodos, type SlackScanResult } from "./_slack-scanner";
import {
  storeSlackThread,
  appendSlackMessage,
  loadSlackConfig,
  saveSlackConfig,
  loadAllSlackThreads,
  loadUnprocessedThreads,
  type SlackConfig,
  type SlackMessage,
} from "./_slack-storage";

// https://github.com/cloudflare/agents/tree/main/examples/codemode
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const FALLBACK_MODEL = "@cf/meta/llama-3.1-8b-instruct";

/**
 * Global concurrency guard: only one codemode isolate across ALL InboxAgent
 * instances at a time. The DynamicWorkerExecutor creates a new Worker Loader
 * isolate for each execution, and running too many concurrently (or in rapid
 * succession) under `vite dev` can segfault the local workerd process.
 *
 * Uses a single global key so different DO instances sharing the same workerd
 * process don't run codemode concurrently. A small cooldown between executions
 * gives workerd time to reclaim isolate resources.
 */
const CODEMODE_COOLDOWN_MS = 1500;
let _codemodeChain: Promise<unknown> = Promise.resolve();

async function withCodemodeGate<T>(_agentId: string, fn: () => Promise<T>): Promise<T> {
  const prev = _codemodeChain;
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const result = new Promise<T>((res, rej) => { resolve = res; reject = rej; });

  _codemodeChain = prev.then(async () => {
    try {
      const value = await fn();
      resolve(value);
    } catch (e) {
      reject(e);
    }
    await new Promise((r) => setTimeout(r, CODEMODE_COOLDOWN_MS));
  }, async () => {
    try {
      const value = await fn();
      resolve(value);
    } catch (e) {
      reject(e);
    }
    await new Promise((r) => setTimeout(r, CODEMODE_COOLDOWN_MS));
  });

  return result;
}

/**
 * Second-pass safety net: truncate any remaining large strings after codemode
 * returns. Primary sanitization (base64 decode, header filtering, HTML stripping)
 * now happens inside gmail-tools.ts before data enters the executor.
 */
function sanitizePayload(obj: unknown): unknown {
  if (typeof obj === "string") {
    if (obj.length > 3000) {
      return obj.slice(0, 3000) + `\n... [TRUNCATED: ${obj.length} chars total]`;
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(sanitizePayload);
  if (obj !== null && typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec)) {
      out[key] = sanitizePayload(rec[key]);
    }
    return out;
  }
  return obj;
}

/** Strip trailing ); ) () and leading ( so executor's (CODE)() stays valid. */
function sanitizeCodemodeCode(code: string): string {
  let s = code.trim();
  s = s.replace(/\s*\);?\s*$/, "").trim();
  while (s.endsWith(")()")) s = s.slice(0, -3).trim();
  while (s.endsWith(")")) s = s.slice(0, -1).trim();
  if (s.startsWith("(") && s.endsWith(")")) {
    const inner = s.slice(1, -1).trim();
    if (inner.startsWith("async ") || inner.startsWith("function")) s = inner;
  }
  return s;
}

/** Detect likely truncated code (model output cut off) to avoid executor syntax errors. */
function looksTruncated(code: string): boolean {
  const s = code.trim();
  if (!s.length) return true;
  return !/[\s}]$/.test(s) || (s.includes("async") && !s.includes("}"));
}

/** Extract Gmail API paths from codemode source for logging. */
function extractApiPaths(code: string): string[] {
  const paths: string[] = [];
  const re = /gmail_(?:get|post)\(\s*\{[^}]*path:\s*["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

interface GmailSession {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  email: string;
}

interface AgentEnv {
  AI: Ai;
  INBOX_AGENT: DurableObjectNamespace;
  INBOX_DOG_CLIENT_ID: string;
  INBOX_DOG_CLIENT_SECRET: string;
  LOADER: WorkerLoader;
}

const STORAGE_KEY_PROMPT_CONFIG = "memory:prompt_config";
const STORAGE_KEY_MODEL_CONFIG = "settings:model_config";
const STORAGE_KEY_SEARCH_CONFIG = "settings:search_config";

const VALID_PROVIDERS = ["workers-ai", "openai", "anthropic", "google", "groq"] as const;
export type ModelProvider = (typeof VALID_PROVIDERS)[number];

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  apiKey?: string;
}

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: "workers-ai",
  modelId: MODEL,
};

function maskApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}

function loadModelConfig(raw: Partial<ModelConfig> | undefined): ModelConfig {
  if (!raw) return { ...DEFAULT_MODEL_CONFIG };
  const provider = raw.provider && (VALID_PROVIDERS as readonly string[]).includes(raw.provider)
    ? raw.provider
    : DEFAULT_MODEL_CONFIG.provider;
  return {
    provider,
    modelId: typeof raw.modelId === "string" && raw.modelId.trim() ? raw.modelId.trim() : DEFAULT_MODEL_CONFIG.modelId,
    apiKey: typeof raw.apiKey === "string" && raw.apiKey.trim() ? raw.apiKey : undefined,
  };
}

export interface SearchConfig {
  provider: "tavily";
  apiKey?: string;
}

const DEFAULT_SEARCH_CONFIG: SearchConfig = { provider: "tavily" };

function loadSearchConfig(raw: Partial<SearchConfig> | undefined): SearchConfig {
  if (!raw) return { ...DEFAULT_SEARCH_CONFIG };
  return {
    provider: "tavily",
    apiKey: typeof raw.apiKey === "string" && raw.apiKey.trim() ? raw.apiKey : undefined,
  };
}

export const ALL_AGENT_ACTIONS = ["read", "send", "reply", "forward", "archive", "trash", "label", "star"] as const;
export type AgentAction = (typeof ALL_AGENT_ACTIONS)[number];

export interface PromptConfig {
  persona: string;
  tone: "concise" | "balanced" | "detailed";
  customInstructions: string;
  confirmBeforeActions: boolean;
  allowedActions: AgentAction[];
  priorityContacts: string[];
  focusTopics: string[];
  responseFormat: "bullets" | "narrative" | "structured";
  language: string;
  defaultEmailCount: number;
}

const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  persona: "You are a personal productivity agent with access to the user's Gmail and their to-do list.",
  tone: "balanced",
  customInstructions: "",
  confirmBeforeActions: true,
  allowedActions: [...ALL_AGENT_ACTIONS],
  priorityContacts: [],
  focusTopics: [],
  responseFormat: "bullets",
  language: "English",
  defaultEmailCount: 10,
};

function loadPromptConfig(raw: Partial<PromptConfig> | undefined): PromptConfig {
  if (!raw) return { ...DEFAULT_PROMPT_CONFIG };
  return {
    persona: raw.persona ?? DEFAULT_PROMPT_CONFIG.persona,
    tone: raw.tone ?? DEFAULT_PROMPT_CONFIG.tone,
    customInstructions: raw.customInstructions ?? DEFAULT_PROMPT_CONFIG.customInstructions,
    confirmBeforeActions: raw.confirmBeforeActions ?? DEFAULT_PROMPT_CONFIG.confirmBeforeActions,
    allowedActions: Array.isArray(raw.allowedActions) ? raw.allowedActions : [...DEFAULT_PROMPT_CONFIG.allowedActions],
    priorityContacts: Array.isArray(raw.priorityContacts) ? raw.priorityContacts : [],
    focusTopics: Array.isArray(raw.focusTopics) ? raw.focusTopics : [],
    responseFormat: raw.responseFormat ?? DEFAULT_PROMPT_CONFIG.responseFormat,
    language: raw.language ?? DEFAULT_PROMPT_CONFIG.language,
    defaultEmailCount: typeof raw.defaultEmailCount === "number" ? raw.defaultEmailCount : DEFAULT_PROMPT_CONFIG.defaultEmailCount,
  };
}

const TONE_INSTRUCTIONS: Record<PromptConfig["tone"], string> = {
  concise: "Keep responses brief and to the point. Use bullet points and short sentences. Skip preambles and filler.",
  balanced: "",
  detailed: "Provide thorough, detailed responses. Explain your reasoning and include all relevant context.",
};

function assembleBasePrompt(config: PromptConfig, hasWebSearch?: boolean): string {
  const parts: string[] = [config.persona];

  parts.push(
    "You have persistent memory across conversations. Everything you and the user discuss is automatically analyzed after each response, and durable facts (names, preferences, employer, contacts, etc.) are extracted and saved to your long-term memory. Known facts and conversation summaries will be provided below when available." +
    "\n\nMEMORY RULES:" +
    "\n- NEVER say you \"can't save to memory\", \"don't have a memory system\", or \"can't remember.\" You absolutely can and do — it happens automatically." +
    "\n- When the user tells you something about themselves (\"my name is...\", \"I work at...\", \"call me...\"), confirm naturally (e.g. \"Got it, I'll remember that.\"). The fact will be saved automatically." +
    "\n- When the user explicitly asks you to remember something, confirm it. Do NOT deny the capability." +
    "\n- Use remembered facts naturally in conversation without over-announcing them, unless the user asks what you remember." +
    "\n- If earlier messages in this conversation were summarized (marked as CONVERSATION CONTEXT), use that summary to stay oriented on what was already discussed.",
  );

  if (config.language !== "English") {
    parts.push(`Always respond in ${config.language}.`);
  }

  if (TONE_INSTRUCTIONS[config.tone]) {
    parts.push(TONE_INSTRUCTIONS[config.tone]);
  }

  const formatInstructions: Record<PromptConfig["responseFormat"], string> = {
    bullets: "",
    narrative: "Present email information in flowing paragraphs rather than lists. Write naturally as if summarizing to a colleague.",
    structured: "Present email information in a structured format: use headers, labeled fields (From, Subject, Date), and clear separators between items.",
  };
  if (formatInstructions[config.responseFormat]) {
    parts.push(formatInstructions[config.responseFormat]);
  }

  if (config.defaultEmailCount !== 10) {
    parts.push(`When the user asks for emails without specifying a count, default to showing ${config.defaultEmailCount} emails.`);
  }

  const disallowed = ALL_AGENT_ACTIONS.filter((a) => !config.allowedActions.includes(a));
  if (disallowed.length > 0) {
    parts.push(
      `FORBIDDEN ACTIONS — you must NEVER perform these, even if asked: ${disallowed.join(", ")}. ` +
        "If the user asks you to do one of these, politely explain that this action has been disabled.",
    );
  }

  if (config.priorityContacts.length > 0) {
    parts.push(
      `Priority contacts — give special attention to emails from or about these people: ${config.priorityContacts.join(", ")}. ` +
        "Surface their emails first when relevant and flag anything urgent from them.",
    );
  }

  if (config.focusTopics.length > 0) {
    parts.push(
      `Focus topics — the user cares most about these subjects: ${config.focusTopics.join(", ")}. ` +
        "When scanning emails, prioritize messages related to these topics.",
    );
  }

  if (config.customInstructions.trim()) {
    parts.push(config.customInstructions.trim());
  }

  parts.push(buildCodemodeInstructions(hasWebSearch));

  const rules: string[] = [];
  rules.push("- Code must be one complete async arrow (no truncation). Only report data from actual API responses.");
  if (config.confirmBeforeActions) {
    rules.push("- Confirm with the user before send, trash, or archive.");
  }
  rules.push("- NEVER narrate your process or thinking. No \"Let me search...\", \"I'll fetch...\", \"Now let me...\". Just do it and show results.");
  rules.push("- After EVERY codemode call, you MUST call the appropriate display tool(s). This is mandatory, not optional.");
  rules.push("- NEVER format email data as text tables or bullet lists. ALWAYS use display_emails / display_email.");
  rules.push("- NEVER paste quoted text inline. ALWAYS use display_quote for any referenced passage.");
  rules.push("- When you spot action items, deadlines, or follow-ups in emails, ALWAYS call suggest_todos. Be proactive about this.");
  parts.push(`Rules:\n${rules.join("\n")}`);

  return parts.join("\n\n");
}

function buildCodemodeInstructions(hasWebSearch?: boolean): string {
  const toolList = [
    `1. **codemode** — fetch raw data from Gmail via JavaScript async arrow calling gmail_get / gmail_post.`,
    `2. **display_emails** — REQUIRED after fetching multiple emails. Renders rich visual email cards with avatars, timestamps, and unread indicators. The user sees a polished interactive list.`,
    `3. **display_email** — REQUIRED after fetching a single email. Renders an expandable email preview with sender avatar, subject, body, and optional highlight callout.`,
    `4. **display_quote** — Renders a styled blockquote with attribution. Use this whenever you reference, excerpt, or paraphrase a specific passage from an email. Even short phrases should use this tool.`,
    `5. **suggest_todos** — Renders interactive to-do suggestion cards the user can accept or dismiss with one tap. Use this PROACTIVELY whenever you spot action items, deadlines, follow-ups, commitments, or requests in the user's emails.`,
    `6. **complete_todo** — Mark a to-do as completed. Use when the user says they finished a task.`,
    `7. **update_todo** — Update a todo's title, description, or scheduled date.`,
    `8. **delete_todo** — Permanently remove a to-do item. Only when explicitly requested.`,
    `9. **add_todo** — Create a new to-do item directly (not as a suggestion from email).`,
  ];
  if (hasWebSearch) {
    toolList.push(`10. **web_search** — Search the web for current information, news, facts, people, companies, or anything beyond email/todos. Returns an AI-generated answer plus source results with titles, URLs, and snippets. Use this IMMEDIATELY for any question about current events, news, sports, people, companies, or topics you don't have direct knowledge of. NEVER say you can't look something up — use web_search instead.`);
  }

  const tableRows = [
    `| Listing multiple emails | display_emails |`,
    `| Showing one email's content | display_email |`,
    `| Referencing what someone wrote | display_quote |`,
    `| Highlighting a key sentence | display_quote |`,
    `| Answering "what did X say about..." | display_quote |`,
    `| Action items, deadlines, follow-ups | suggest_todos |`,
    `| "What needs attention" queries | display_emails + suggest_todos |`,
    `| Summarizing an email thread | display_email + display_quote |`,
    `| "What are my todos?" / "What's due?" | Answer from to-do context (no tool needed) |`,
    `| "I finished X" / "Mark X done" | complete_todo |`,
    `| "Reschedule X to Friday" | update_todo |`,
    `| "Remove that todo" | delete_todo |`,
    `| "Add a todo to..." | add_todo |`,
    `| "Create todos from my emails" | codemode → suggest_todos |`,
  ];
  if (hasWebSearch) {
    tableRows.push(
      `| Current events, news, sports scores, "what's happening with..." | web_search |`,
      `| "Who is X?" / "What is Y?" / research a topic | web_search |`,
      `| Looking up a company, product, or person | web_search |`,
      `| Any factual question beyond email/todos | web_search |`,
    );
  }

  return `You have these tools:

${toolList.join("\n")}

═══════════════════════════════════════════
GENERATIVE UI IS YOUR PRIMARY OUTPUT FORMAT
═══════════════════════════════════════════

Your display tools render beautiful, interactive UI components that are far superior to plain text. You must ALWAYS prefer display tools over writing information as text.

MANDATORY WORKFLOW for email queries:
Step 1: Call codemode to fetch data.
Step 2: Call the appropriate display tool(s) with the results. THIS IS NOT OPTIONAL.
Step 3: Write a brief 1-2 sentence contextual summary. Nothing more — the UI speaks for itself.

DISPLAY TOOL RULES:
- You MUST call display_emails after ANY codemode that returns a list of emails. NEVER skip this.
- You MUST call display_email after ANY codemode that returns a single email's content. NEVER skip this.
- You MUST call display_quote whenever you reference or excerpt a passage from an email, even a single sentence. NEVER paste quoted text into your response as plain text — always use display_quote so the user sees a properly attributed, styled blockquote.
- You MUST call suggest_todos whenever you identify action items, deadlines, follow-ups, or requests in emails. Be PROACTIVE — if the user asks "what needs my attention" or "summarize my inbox," identify actionable items and suggest todos for them without being asked.
- COMBINE multiple display tools in a single response. For example:
  • display_emails to show the list + display_quote to highlight a key passage
  • display_email for a single message + suggest_todos for any action items found in it
  • display_emails for search results + suggest_todos for follow-ups the user should take
- NEVER write email subjects, senders, dates, snippets, or quoted text as plain text, markdown tables, or bullet lists. ALWAYS use the corresponding display tool.
- After calling display tools, write ONLY a brief summary. Do NOT repeat any information the display tool already shows.

WHEN TO USE EACH TOOL:
| Scenario | Tool |
|---|---|
${tableRows.join("\n")}

FORBIDDEN PATTERNS (never do these):
✗ Writing email data as a markdown bullet list
✗ Pasting quoted text inline without display_quote
✗ Creating a text table of emails
✗ Listing action items as plain text instead of suggest_todos
✗ Narrating your process ("Let me search...", "I'll fetch...", "Now let me...")

CODEMODE RULES:
- Code must be a single JavaScript async arrow with API calls only. No TypeScript syntax.
- NEVER put summaries, conversational text, or answers inside the code's return value.
- NEVER hardcode data arrays into your code string.
- Batch related API calls into ONE codemode execution. Each execution is limited to 10 API calls. Use query parameters (maxResults, q=, format=metadata) to minimize calls.
- PERFORMANCE: When listing/searching emails, use format=metadata to avoid fetching huge bodies. Only fetch full message content (without format= param) when you need to read the email body for a SINGLE specific email. NEVER fetch 5+ full messages in one call — use format=metadata first, then fetch individual emails only if the user needs their content.
- EFFICIENCY: For "what needs attention" or inbox summary queries, use /messages?q=is:unread+in:inbox&maxResults=10&format=metadata in a SINGLE call. Do NOT loop over individual message IDs.

RESPONSE STYLE:
- The visual UI components ARE your response. Your text is secondary — it adds brief context or insight, not data.
- Keep text to 1-3 sentences after display tools. The UI already shows all the details.
- Use **bold** for emphasis in your brief text. Do NOT use headers or long paragraphs alongside display tools.
- When answering a question about email content, ALWAYS use display_quote for the relevant passages, then add your interpretation in 1-2 sentences.

API surface:
${GMAIL_API_SURFACE}`;
}

interface AccountInfo {
  email: string;
  label?: string;
}

const SNAPSHOT_GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function fetchInboxSnapshot(
  tokens: { email: string; token: string; label?: string }[],
  maxPerAccount = 15,
): Promise<string> {
  if (tokens.length === 0) return "";

  const now = Date.now();

  const perAccount = await Promise.all(
    tokens.map(async ({ email, token, label }) => {
      try {
        const listRes = await fetch(
          `${SNAPSHOT_GMAIL_BASE}/messages?q=in:inbox&maxResults=${maxPerAccount}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!listRes.ok) return [];

        const listData = (await listRes.json()) as {
          messages?: { id: string; threadId: string }[];
        };
        if (!listData.messages?.length) return [];

        const metaHeaders = ["From", "Subject", "Date"].map((h) => `metadataHeaders=${h}`).join("&");

        const details = await Promise.all(
          listData.messages.map(async (msg) => {
            const res = await fetch(
              `${SNAPSHOT_GMAIL_BASE}/messages/${msg.id}?format=metadata&${metaHeaders}`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            if (!res.ok) return null;
            return res.json() as Promise<{
              id: string;
              threadId: string;
              labelIds: string[];
              snippet: string;
              internalDate: string;
              payload?: { headers?: { name: string; value: string }[] };
            }>;
          }),
        );

        return details
          .filter((d): d is NonNullable<typeof d> => d !== null)
          .map((d) => {
            const getHeader = (name: string) =>
              d.payload?.headers?.find((h) => h.name === name)?.value ?? "";
            const unread = d.labelIds?.includes("UNREAD");
            const ageMs = now - Number(d.internalDate);
            const age = formatAge(ageMs);
            const prefix = unread ? "[UNREAD] " : "";
            const acctTag = tokens.length > 1 ? ` (${label || email})` : "";
            return `${prefix}From: ${getHeader("From")} | "${getHeader("Subject")}" | ${age} | id:${d.id}${acctTag}`;
          });
      } catch (e) {
        console.error(`[inbox-snapshot] Failed for ${email}:`, e);
        return [];
      }
    }),
  );

  const lines = perAccount.flat();
  if (lines.length === 0) return "";

  return `Current inbox snapshot (${lines.length} most recent — what the user sees right now):\n${lines.map((l) => `• ${l}`).join("\n")}`;
}

function formatAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

const MAX_SYSTEM_PROMPT_CHARS = 24_000;

function buildSystemPrompt(
  config: PromptConfig,
  memory: AgentMemory,
  accounts?: AccountInfo[],
  todoContext?: string,
  inboxSnapshot?: string,
  workspaceContext?: string,
  hasWebSearch?: boolean,
): string {
  let system = assembleBasePrompt(config, hasWebSearch);

  const now = new Date();
  system += `\n\nCurrent date and time: ${now.toUTCString()} (UTC). Today is ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;

  if (accounts && accounts.length > 0) {
    if (accounts.length === 1) {
      const a = accounts[0];
      system += `\n\nConnected Gmail account: ${a.email}${a.label ? ` (${a.label})` : ""}`;
    } else {
      const list = accounts.map((a) => `  - ${a.email}${a.label ? ` (${a.label})` : ""}`).join("\n");
      system += `\n\nYou have access to ${accounts.length} Gmail accounts:\n${list}\n\nWhen the user asks about a specific account (e.g. "my work email", "my personal"), match their request to the account label. When calling gmail_get or gmail_post, you MUST pass the "account" parameter with the email address to specify which account to query. If the user doesn't specify which account, query all active accounts or ask them to clarify.`;
    }
  }

  if (memory.userFacts.length > 0) {
    system += `\n\nRemembered facts and preferences:\n${memory.userFacts.map((f) => `- ${f}`).join("\n")}`;
    system += `\nApply all of the above. If a fact defines your name, use it. If a preference sets your behavior, follow it.`;
  }
  if (memory.conversationSummaries.length > 0) {
    system += `\n\nRecent conversations:\n${memory.conversationSummaries.map((s) => `- ${s.date}: ${s.summary}`).join("\n")}`;
  }

  if (workspaceContext) {
    system += `\n\n${workspaceContext}`;
  }

  const todoCapabilities = `\n\nTO-DO CAPABILITIES:
You have full access to the user's to-do list. You can:
- **Answer questions** about their todos: what's due today, what's overdue, what's pending, how many items they have, etc. Use the to-do context above — you already have all the data, no need to fetch it.
- **Complete todos** via complete_todo when the user says they finished something.
- **Update todos** via update_todo to change titles, descriptions, or reschedule dates.
- **Delete todos** via delete_todo when explicitly asked to remove one.
- **Add todos** via add_todo when the user asks to create a new todo (not from email).
- **Suggest todos** via suggest_todos when you find action items in emails.
When referencing a todo, use its ID from the context above. When the user asks about their todos, answer directly from the context — do not say you can't access them.`;

  if (todoContext) {
    const todoSection = `\n\nTo-do context:\n${todoContext}${todoCapabilities}`;
    if (system.length + todoSection.length < MAX_SYSTEM_PROMPT_CHARS) {
      system += todoSection;
    } else {
      const budget = MAX_SYSTEM_PROMPT_CHARS - system.length - todoCapabilities.length - 20;
      if (budget > 200) {
        system += `\n\nTo-do context:\n${todoContext.slice(0, budget)}…${todoCapabilities}`;
      }
    }
  }

  if (inboxSnapshot) {
    const snapshotSection = `\n\n${inboxSnapshot}\n\nWhen the user refers to a visible email (by sender name, subject, or "that email"), match it against this snapshot. Use the message ID to fetch full content via GET /messages/{id} instead of searching. If the user asks a vague question like "what's new?" or "any important emails?", use this snapshot to answer directly.`;
    if (system.length + snapshotSection.length < MAX_SYSTEM_PROMPT_CHARS) {
      system += snapshotSection;
    } else {
      const budget = MAX_SYSTEM_PROMPT_CHARS - system.length - 200;
      if (budget > 200) {
        system += `\n\n${inboxSnapshot.slice(0, budget)}…\n\nUse this snapshot to match emails the user references.`;
      }
    }
  }

  if (system.length > MAX_SYSTEM_PROMPT_CHARS) {
    console.warn(`[chat] System prompt truncated from ${system.length} to ${MAX_SYSTEM_PROMPT_CHARS} chars`);
    system = system.slice(0, MAX_SYSTEM_PROMPT_CHARS);
  }

  return system;
}

async function loadAccounts(storage: DurableObjectStorage): Promise<ConnectedAccount[]> {
  const accounts = await storage.get<ConnectedAccount[]>(STORAGE_KEY_ACCOUNTS);
  if (accounts && accounts.length > 0) return accounts;

  const legacy = await storage.get<GmailSession>("gmail_session");
  if (legacy?.email) {
    const migrated = [migrateFromSingleSession(legacy)];
    await storage.put(STORAGE_KEY_ACCOUNTS, migrated);
    return migrated;
  }
  return [];
}

async function loadActiveEmails(storage: DurableObjectStorage): Promise<string[]> {
  const active = await storage.get<string[]>(STORAGE_KEY_ACTIVE_EMAILS);
  if (active && active.length > 0) return active;
  const accounts = await loadAccounts(storage);
  return accounts.map((a) => a.email);
}

export class InboxAgent extends AIChatAgent<AgentEnv> {
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // routeAgentRequest preserves the full URL path, so strip the
    // `/agents/inbox-agent/{roomId}` prefix to get the local route.
    const AGENT_PREFIX = "/agents/inbox-agent/";
    let path = url.pathname;
    if (path.startsWith(AGENT_PREFIX)) {
      const rest = path.slice(AGENT_PREFIX.length);
      const slash = rest.indexOf("/");
      path = slash === -1 ? "/" : rest.slice(slash);
    }

    // Legacy session endpoints (backward compat -- also writes to accounts)
    if (path === "/session" && request.method === "PUT") {
      const session = (await request.json()) as GmailSession;
      await this.ctx.storage.put("gmail_session", session);

      const accounts = await loadAccounts(this.ctx.storage);
      const idx = accounts.findIndex((a) => a.email === session.email);
      if (idx >= 0) {
        accounts[idx] = { ...accounts[idx], access_token: session.access_token, refresh_token: session.refresh_token || accounts[idx].refresh_token, client_id: session.client_id, client_secret: session.client_secret };
      } else {
        accounts.push({ email: session.email, access_token: session.access_token, refresh_token: session.refresh_token, client_id: session.client_id, client_secret: session.client_secret, color: pickDefaultColor(accounts.length), connectedAt: Date.now() });
      }
      await this.ctx.storage.put(STORAGE_KEY_ACCOUNTS, accounts);
      return new Response("ok");
    }
    if (path === "/session" && request.method === "GET") {
      const session =
        await this.ctx.storage.get<GmailSession>("gmail_session");
      if (!session) {
        return new Response("not found", { status: 404 });
      }
      return Response.json(session);
    }

    // ── Multi-account endpoints ──
    if (path === "/accounts" && request.method === "GET") {
      const accounts = await loadAccounts(this.ctx.storage);
      const activeEmails = await loadActiveEmails(this.ctx.storage);
      return Response.json({
        accounts: accounts.map(toPublicAccount),
        activeEmails,
      });
    }
    if (path === "/accounts" && request.method === "PUT") {
      const { account } = (await request.json()) as { account: ConnectedAccount };
      const accounts = await loadAccounts(this.ctx.storage);
      const idx = accounts.findIndex((a) => a.email === account.email);
      if (idx >= 0) {
        accounts[idx] = { ...accounts[idx], access_token: account.access_token, refresh_token: account.refresh_token || accounts[idx].refresh_token, client_id: account.client_id, client_secret: account.client_secret, photoUrl: account.photoUrl || accounts[idx].photoUrl, name: account.name || accounts[idx].name };
      } else {
        const isFirst = accounts.length === 0;
        accounts.push({ ...account, color: account.color || pickDefaultColor(accounts.length), isPrimary: isFirst ? true : undefined, connectedAt: account.connectedAt || Date.now() });
      }
      await this.ctx.storage.put(STORAGE_KEY_ACCOUNTS, accounts);

      if (accounts.length === 1) {
        await this.ctx.storage.put("gmail_session", { access_token: account.access_token, refresh_token: account.refresh_token, client_id: account.client_id, client_secret: account.client_secret, email: account.email } satisfies GmailSession);
      }
      return Response.json({ accounts: accounts.map(toPublicAccount) });
    }
    if (path === "/accounts" && request.method === "DELETE") {
      const { email } = (await request.json()) as { email: string };
      let accounts = await loadAccounts(this.ctx.storage);
      accounts = accounts.filter((a) => a.email !== email);
      await this.ctx.storage.put(STORAGE_KEY_ACCOUNTS, accounts);

      const active = await loadActiveEmails(this.ctx.storage);
      const updatedActive = active.filter((e) => e !== email);
      await this.ctx.storage.put(STORAGE_KEY_ACTIVE_EMAILS, updatedActive.length > 0 ? updatedActive : accounts.map((a) => a.email));

      if (accounts.length > 0) {
        const primary = accounts[0];
        await this.ctx.storage.put("gmail_session", { access_token: primary.access_token, refresh_token: primary.refresh_token, client_id: primary.client_id, client_secret: primary.client_secret, email: primary.email } satisfies GmailSession);
      }
      return Response.json({ accounts: accounts.map(toPublicAccount) });
    }
    if (path === "/accounts/active" && request.method === "GET") {
      const activeEmails = await loadActiveEmails(this.ctx.storage);
      return Response.json({ activeEmails });
    }
    if (path === "/accounts/active" && request.method === "PUT") {
      const { emails } = (await request.json()) as { emails: string[] };
      const accounts = await loadAccounts(this.ctx.storage);
      const valid = emails.filter((e) => accounts.some((a) => a.email === e));
      await this.ctx.storage.put(STORAGE_KEY_ACTIVE_EMAILS, valid.length > 0 ? valid : accounts.map((a) => a.email));
      return Response.json({ activeEmails: valid.length > 0 ? valid : accounts.map((a) => a.email) });
    }
    if (path.startsWith("/accounts/label") && request.method === "PUT") {
      const { email, label, color } = (await request.json()) as { email: string; label?: string; color?: string };
      const accounts = await loadAccounts(this.ctx.storage);
      const account = accounts.find((a) => a.email === email);
      if (!account) return Response.json({ error: "Account not found" }, { status: 404 });
      if (label !== undefined) account.label = label;
      if (color !== undefined) account.color = color;
      await this.ctx.storage.put(STORAGE_KEY_ACCOUNTS, accounts);
      return Response.json({ account: toPublicAccount(account) });
    }
    if (path === "/accounts/tokens" && request.method === "GET") {
      const accounts = await loadAccounts(this.ctx.storage);
      return Response.json({ accounts });
    }
    if (path === "/accounts/sync" && request.method === "PUT") {
      const { accounts } = (await request.json()) as { accounts: ConnectedAccount[] };
      await this.ctx.storage.put(STORAGE_KEY_ACCOUNTS, accounts);
      const activeEmails = await loadActiveEmails(this.ctx.storage);
      const valid = activeEmails.filter((e) => accounts.some((a) => a.email === e));
      if (valid.length === 0 || valid.length !== activeEmails.length) {
        await this.ctx.storage.put(STORAGE_KEY_ACTIVE_EMAILS, accounts.map((a) => a.email));
      }
      return Response.json({ ok: true });
    }
    if (path === "/accounts/profile" && request.method === "PUT") {
      const { email, photoUrl, name } = (await request.json()) as { email: string; photoUrl?: string; name?: string };
      const accounts = await loadAccounts(this.ctx.storage);
      const account = accounts.find((a) => a.email === email);
      if (!account) return Response.json({ error: "Account not found" }, { status: 404 });
      if (photoUrl !== undefined) account.photoUrl = photoUrl;
      if (name !== undefined) account.name = name;
      await this.ctx.storage.put(STORAGE_KEY_ACCOUNTS, accounts);
      return Response.json({ ok: true });
    }
    if (path === "/accounts/primary" && request.method === "PUT") {
      const { email } = (await request.json()) as { email: string };
      const accounts = await loadAccounts(this.ctx.storage);
      const target = accounts.find((a) => a.email === email);
      if (!target) return Response.json({ error: "Account not found" }, { status: 404 });
      for (const a of accounts) a.isPrimary = a.email === email;
      // Move primary to front of array
      const reordered = [target, ...accounts.filter((a) => a.email !== email)];
      await this.ctx.storage.put(STORAGE_KEY_ACCOUNTS, reordered);
      // Update legacy session to match new primary
      await this.ctx.storage.put("gmail_session", {
        access_token: target.access_token,
        refresh_token: target.refresh_token,
        client_id: target.client_id,
        client_secret: target.client_secret,
        email: target.email,
      } satisfies GmailSession);
      return Response.json({ accounts: reordered.map(toPublicAccount) });
    }
    if (path === "/contacts/cache" && request.method === "GET") {
      const cached = await this.ctx.storage.get<{
        contacts: { name: string; email: string }[];
        updatedAt: number;
      }>("contacts_cache");
      if (!cached) return Response.json({ contacts: [], updatedAt: 0 });
      return Response.json(cached);
    }
    if (path === "/contacts/cache" && request.method === "PUT") {
      const body = (await request.json()) as {
        contacts: { name: string; email: string }[];
      };
      await this.ctx.storage.put("contacts_cache", {
        contacts: body.contacts,
        updatedAt: Date.now(),
      });
      return Response.json({ ok: true });
    }
    if (path === "/memory" && request.method === "GET") {
      const mem = await getSerializableMemory(this.ctx.storage);
      return Response.json(mem);
    }
    if (path === "/memory/debug" && request.method === "GET") {
      const mem = await getFullMemoryDebug(this.ctx.storage);
      return Response.json(mem, {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path === "/memory" && request.method === "PUT") {
      const source = (await request.json()) as {
        userFacts: string[];
        conversationSummaries: { id: string; summary: string; date: string }[];
      };
      await mergeMemoryFrom(this.ctx.storage, source);
      return new Response("ok");
    }
    if (path === "/memory/events" && request.method === "GET") {
      const events = await getMemoryEvents(this.ctx.storage);
      return Response.json(events);
    }
    if (path === "/memory/facts" && request.method === "PUT") {
      const { facts } = (await request.json()) as { facts: string[] };
      await replaceUserFacts(this.ctx.storage, facts);
      return Response.json({ ok: true });
    }
    if (path.startsWith("/memory/facts/") && request.method === "DELETE") {
      const index = parseInt(path.split("/").pop() ?? "", 10);
      if (isNaN(index)) return Response.json({ error: "Invalid index" }, { status: 400 });
      const remaining = await deleteUserFact(this.ctx.storage, index);
      return Response.json({ facts: remaining });
    }
    if (path === "/memory/prompt-snapshot" && request.method === "GET") {
      const memory = await loadMemory(this.ctx.storage);
      const config = loadPromptConfig(await this.ctx.storage.get<Partial<PromptConfig>>(STORAGE_KEY_PROMPT_CONFIG));
      const prompt = buildSystemPrompt(config, memory);
      return Response.json({ prompt, memory, config, defaultConfig: DEFAULT_PROMPT_CONFIG });
    }
    if (path === "/memory/system-prompt" && request.method === "GET") {
      const config = loadPromptConfig(await this.ctx.storage.get<Partial<PromptConfig>>(STORAGE_KEY_PROMPT_CONFIG));
      return Response.json({ config, defaultConfig: DEFAULT_PROMPT_CONFIG });
    }
    if (path === "/memory/system-prompt" && request.method === "PUT") {
      const { config } = (await request.json()) as { config: PromptConfig };
      if (!config || typeof config.persona !== "string") {
        return Response.json({ error: "Invalid config" }, { status: 400 });
      }
      const validActions = Array.isArray(config.allowedActions)
        ? config.allowedActions.filter((a: string) => (ALL_AGENT_ACTIONS as readonly string[]).includes(a)) as AgentAction[]
        : [...ALL_AGENT_ACTIONS];
      const validated: PromptConfig = {
        persona: config.persona.trim() || DEFAULT_PROMPT_CONFIG.persona,
        tone: ["concise", "balanced", "detailed"].includes(config.tone) ? config.tone : "balanced",
        customInstructions: typeof config.customInstructions === "string" ? config.customInstructions : "",
        confirmBeforeActions: config.confirmBeforeActions !== false,
        allowedActions: validActions,
        priorityContacts: Array.isArray(config.priorityContacts)
          ? config.priorityContacts.filter((c: unknown) => typeof c === "string" && c.trim()).map((c: string) => c.trim())
          : [],
        focusTopics: Array.isArray(config.focusTopics)
          ? config.focusTopics.filter((t: unknown) => typeof t === "string" && t.trim()).map((t: string) => t.trim())
          : [],
        responseFormat: ["bullets", "narrative", "structured"].includes(config.responseFormat) ? config.responseFormat : "bullets",
        language: typeof config.language === "string" && config.language.trim() ? config.language.trim() : "English",
        defaultEmailCount: typeof config.defaultEmailCount === "number" && config.defaultEmailCount > 0 && config.defaultEmailCount <= 50
          ? config.defaultEmailCount
          : 10,
      };
      await this.ctx.storage.put(STORAGE_KEY_PROMPT_CONFIG, validated);
      return Response.json({ ok: true, config: validated });
    }
    if (path === "/memory/system-prompt" && request.method === "DELETE") {
      await this.ctx.storage.delete(STORAGE_KEY_PROMPT_CONFIG);
      return Response.json({ ok: true, config: DEFAULT_PROMPT_CONFIG });
    }
    // ── Model settings endpoints ──
    if (path === "/settings/model-raw" && request.method === "GET") {
      const cfg = loadModelConfig(await this.ctx.storage.get<Partial<ModelConfig>>(STORAGE_KEY_MODEL_CONFIG));
      return Response.json(cfg);
    }
    if (path === "/settings/model" && request.method === "GET") {
      const cfg = loadModelConfig(await this.ctx.storage.get<Partial<ModelConfig>>(STORAGE_KEY_MODEL_CONFIG));
      return Response.json({
        config: { provider: cfg.provider, modelId: cfg.modelId, apiKeyMasked: maskApiKey(cfg.apiKey), hasApiKey: !!cfg.apiKey },
        defaultConfig: { provider: DEFAULT_MODEL_CONFIG.provider, modelId: DEFAULT_MODEL_CONFIG.modelId },
      });
    }
    if (path === "/settings/model" && request.method === "PUT") {
      const body = (await request.json()) as Partial<ModelConfig>;
      const existing = loadModelConfig(await this.ctx.storage.get<Partial<ModelConfig>>(STORAGE_KEY_MODEL_CONFIG));
      const provider = body.provider && (VALID_PROVIDERS as readonly string[]).includes(body.provider) ? body.provider : existing.provider;
      const modelId = typeof body.modelId === "string" && body.modelId.trim() ? body.modelId.trim() : existing.modelId;
      // If apiKey is empty string, keep existing key (allows changing model without re-entering key)
      const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : existing.apiKey;
      const validated: ModelConfig = { provider, modelId, apiKey };
      await this.ctx.storage.put(STORAGE_KEY_MODEL_CONFIG, validated);
      return Response.json({
        ok: true,
        config: { provider: validated.provider, modelId: validated.modelId, apiKeyMasked: maskApiKey(validated.apiKey), hasApiKey: !!validated.apiKey },
      });
    }
    if (path === "/settings/model" && request.method === "DELETE") {
      await this.ctx.storage.delete(STORAGE_KEY_MODEL_CONFIG);
      return Response.json({ ok: true, config: { provider: DEFAULT_MODEL_CONFIG.provider, modelId: DEFAULT_MODEL_CONFIG.modelId, hasApiKey: false } });
    }
    // ── Search settings endpoints ──
    if (path === "/settings/search-raw" && request.method === "GET") {
      const cfg = loadSearchConfig(await this.ctx.storage.get<Partial<SearchConfig>>(STORAGE_KEY_SEARCH_CONFIG));
      return Response.json(cfg);
    }
    if (path === "/settings/search" && request.method === "GET") {
      const cfg = loadSearchConfig(await this.ctx.storage.get<Partial<SearchConfig>>(STORAGE_KEY_SEARCH_CONFIG));
      return Response.json({
        config: { provider: cfg.provider, apiKeyMasked: maskApiKey(cfg.apiKey), hasApiKey: !!cfg.apiKey },
      });
    }
    if (path === "/settings/search" && request.method === "PUT") {
      const body = (await request.json()) as Partial<SearchConfig>;
      const existing = loadSearchConfig(await this.ctx.storage.get<Partial<SearchConfig>>(STORAGE_KEY_SEARCH_CONFIG));
      const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : existing.apiKey;
      const validated: SearchConfig = { provider: "tavily", apiKey };
      await this.ctx.storage.put(STORAGE_KEY_SEARCH_CONFIG, validated);
      return Response.json({
        ok: true,
        config: { provider: validated.provider, apiKeyMasked: maskApiKey(validated.apiKey), hasApiKey: !!validated.apiKey },
      });
    }
    if (path === "/settings/search" && request.method === "DELETE") {
      await this.ctx.storage.delete(STORAGE_KEY_SEARCH_CONFIG);
      return Response.json({ ok: true, config: { provider: "tavily", hasApiKey: false } });
    }
    // ── Todo endpoints ──
    if (path === "/todos" && request.method === "GET") {
      const [todos, prefs, cats, catColors] = await Promise.all([
        loadTodos(this.ctx.storage),
        loadPreferences(this.ctx.storage),
        loadCategories(this.ctx.storage),
        loadCategoryColors(this.ctx.storage),
      ]);
      return Response.json({ todos, preferences: { ...prefs, todoCategories: cats, categoryColors: catColors } });
    }
    if (path === "/todos/categories" && request.method === "PUT") {
      const { categories } = (await request.json()) as { categories: string[] };
      if (!Array.isArray(categories)) return Response.json({ error: "categories must be an array" }, { status: 400 });
      await saveCategories(this.ctx.storage, categories);
      return Response.json({ ok: true, categories });
    }
    if (path === "/todos/category-colors" && request.method === "PUT") {
      const { colors } = (await request.json()) as { colors: Record<string, string> };
      if (!colors || typeof colors !== "object") return Response.json({ error: "colors must be an object" }, { status: 400 });
      await saveCategoryColors(this.ctx.storage, colors);
      return Response.json({ ok: true, colors });
    }
    if (path === "/todos" && request.method === "POST") {
      const body = (await request.json()) as {
        title: string; description?: string; scheduledDate?: string;
        categories?: string[];
        entities?: TodoItem["entities"];
        sourceEmails?: TodoItem["sourceEmails"];
      };
      if (!body.title?.trim()) return Response.json({ error: "Title required" }, { status: 400 });
      const prefs = await loadPreferences(this.ctx.storage);
      const todo = await addTodo(this.ctx.storage, {
        title: body.title.trim(),
        description: body.description,
        categories: body.categories?.length ? body.categories : undefined,
        entities: body.entities?.length ? body.entities : undefined,
        status: "pending",
        sourceEmails: body.sourceEmails ?? [],
        scheduledDate: body.scheduledDate ?? null,
        agentSuggested: false,
        userResponse: null,
      }, { addToTop: prefs.addToTop });
      await this.ensureTodoAlarm();
      return Response.json({ todo });
    }
    if (path === "/todos/suggest" && request.method === "POST") {
      const { suggestions } = (await request.json()) as {
        suggestions: Parameters<typeof addSuggestedTodos>[1];
      };
      const created = await addSuggestedTodos(this.ctx.storage, suggestions);
      await this.ensureTodoAlarm();
      return Response.json({ todos: created });
    }
    if (path === "/todos/suggestions/clear" && request.method === "POST") {
      const removed = await clearSuggestions(this.ctx.storage);
      return Response.json({ removed });
    }
    if (path.match(/^\/todos\/[^/]+$/) && request.method === "PUT") {
      const id = path.split("/").pop()!;
      const updates = (await request.json()) as Partial<Pick<TodoItem, "title" | "description" | "subtasks" | "categories" | "status" | "scheduledDate" | "sortOrder" | "completedAt" | "archivedAt">>;

      if (updates.title || updates.description !== undefined) {
        const todos = await loadTodos(this.ctx.storage);
        const existing = todos.find((t) => t.id === id);
        if (existing) {
          const aiTag = existing.agentSuggested ? " (AI-suggested)" : "";
          if (updates.title && existing.title !== updates.title) {
            void logMemoryEvent(this.ctx.storage, "fact_extraction", `User edited todo title: "${existing.title}" → "${updates.title}"${aiTag}`, {
              todoId: id,
              oldTitle: existing.title,
              newTitle: updates.title,
              agentSuggested: existing.agentSuggested,
            }).catch(() => {});
          }
          if (updates.description !== undefined && existing.description !== updates.description) {
            void logMemoryEvent(this.ctx.storage, "fact_extraction", `User edited todo description${aiTag}: "${updates.description || "(cleared)"}"`, {
              todoId: id,
              title: existing.title,
              oldDescription: existing.description ?? null,
              newDescription: updates.description ?? null,
              agentSuggested: existing.agentSuggested,
            }).catch(() => {});
          }
        }
      }

      const todo = await updateTodo(this.ctx.storage, id, updates);
      if (!todo) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ todo });
    }
    if (path.match(/^\/todos\/[^/]+$/) && request.method === "DELETE") {
      const id = path.split("/").pop()!;
      const ok = await deleteTodo(this.ctx.storage, id);
      if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ ok: true });
    }
    if (path.match(/^\/todos\/[^/]+\/complete$/) && request.method === "POST") {
      const id = path.split("/")[2];
      const todo = await completeTodo(this.ctx.storage, id);
      if (!todo) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ todo });
    }
    if (path === "/todos/reorder" && request.method === "PUT") {
      const { orderedIds } = (await request.json()) as { orderedIds: string[] };
      if (!Array.isArray(orderedIds)) return Response.json({ error: "orderedIds required" }, { status: 400 });
      const todos = await reorderTodos(this.ctx.storage, orderedIds);
      return Response.json({ todos });
    }
    if (path.match(/^\/todos\/[^/]+\/accept$/) && request.method === "POST") {
      const id = path.split("/")[2];
      const todo = await acceptSuggestion(this.ctx.storage, id);
      if (!todo) return Response.json({ error: "Not found" }, { status: 404 });
      void logMemoryEvent(this.ctx.storage, "fact_extraction", `User accepted AI todo suggestion: "${todo.title}"`, {
        todoId: id,
        title: todo.title,
        sourceEmails: todo.sourceEmails.map((e) => e.from).slice(0, 3),
      }).catch(() => {});
      return Response.json({ todo });
    }
    if (path.match(/^\/todos\/[^/]+\/decline$/) && request.method === "POST") {
      const id = path.split("/")[2];
      const { reason } = (await request.json().catch(() => ({}))) as { reason?: string };
      const todos = await loadTodos(this.ctx.storage);
      const before = todos.find((t) => t.id === id);
      const todo = await declineSuggestion(this.ctx.storage, id, reason);
      if (!todo) return Response.json({ error: "Not found" }, { status: 404 });
      void logMemoryEvent(this.ctx.storage, "fact_extraction", `User declined AI todo suggestion: "${before?.title ?? todo.title}"${reason ? ` (reason: ${reason})` : ""}`, {
        todoId: id,
        title: before?.title ?? todo.title,
        reason: reason ?? null,
        sourceEmails: (before ?? todo).sourceEmails.map((e) => e.from).slice(0, 3),
      }).catch(() => {});
      return Response.json({ todo });
    }
    if (path === "/todos/archived" && request.method === "GET") {
      const archived = await loadArchivedTodos(this.ctx.storage);
      return Response.json({ todos: archived });
    }
    if (path === "/todos/preferences" && request.method === "GET") {
      const prefs = await loadPreferences(this.ctx.storage);
      return Response.json(prefs);
    }
    if (path === "/todos/preferences" && request.method === "PUT") {
      const body = (await request.json()) as Partial<TodoPreferences>;
      const current = await loadPreferences(this.ctx.storage);
      const updated: TodoPreferences = {
        declinedPatterns: Array.isArray(body.declinedPatterns) ? body.declinedPatterns : current.declinedPatterns,
        acceptedPatterns: Array.isArray(body.acceptedPatterns) ? body.acceptedPatterns : current.acceptedPatterns,
        preferredScheduling: typeof body.preferredScheduling === "string" ? body.preferredScheduling : current.preferredScheduling,
        autoSuggest: typeof body.autoSuggest === "boolean" ? body.autoSuggest : current.autoSuggest,
        addToTop: typeof body.addToTop === "boolean" ? body.addToTop : current.addToTop,
      };
      await savePreferences(this.ctx.storage, updated);
      return Response.json(updated);
    }

    // ── Scan endpoints ──
    if (path === "/scan/config" && request.method === "GET") {
      const config = await loadScanConfig(this.ctx.storage);
      return Response.json({ config, defaultConfig: getDefaultScanConfig() });
    }
    if (path === "/scan/config" && request.method === "PUT") {
      const body = (await request.json()) as Partial<ScanConfig>;
      const current = await loadScanConfig(this.ctx.storage);
      const updated: ScanConfig = {
        enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
        maxScansPerDay: typeof body.maxScansPerDay === "number" && body.maxScansPerDay > 0 ? body.maxScansPerDay : current.maxScansPerDay,
        maxTokensPerDay: typeof body.maxTokensPerDay === "number" && body.maxTokensPerDay > 0 ? body.maxTokensPerDay : current.maxTokensPerDay,
        scanIntervalActiveMs: typeof body.scanIntervalActiveMs === "number" && body.scanIntervalActiveMs >= 60_000 ? body.scanIntervalActiveMs : current.scanIntervalActiveMs,
        scanIntervalInactiveMs: typeof body.scanIntervalInactiveMs === "number" && body.scanIntervalInactiveMs >= 60_000 ? body.scanIntervalInactiveMs : current.scanIntervalInactiveMs,
      };
      await saveScanConfig(this.ctx.storage, updated);
      await this.scheduleScanAlarm();
      return Response.json({ config: updated });
    }
    if (path === "/scan/status" && request.method === "GET") {
      const [config, usage] = await Promise.all([
        loadScanConfig(this.ctx.storage),
        loadScanUsage(this.ctx.storage),
      ]);
      const nextAlarm = await this.ctx.storage.getAlarm();
      return Response.json({ config, usage, nextAlarmAt: nextAlarm ? new Date(nextAlarm).toISOString() : null });
    }
    if (path === "/scan/trigger" && request.method === "POST") {
      console.log("[scan] /scan/trigger received");
      const t = Date.now();
      const result = await this.runBackgroundScan();
      console.log(`[scan] /scan/trigger responding (${Date.now() - t}ms)`);
      return Response.json(result);
    }

    // ── Slack scan endpoints ──
    if (path === "/scan/slack/trigger" && request.method === "POST") {
      console.log("[slack-scan] /scan/slack/trigger received");
      const t = Date.now();
      const result = await this.runSlackScan();
      console.log(`[slack-scan] /scan/slack/trigger responding (${Date.now() - t}ms)`);
      return Response.json(result);
    }
    if (path === "/scan/slack/status" && request.method === "GET") {
      const config = await loadSlackConfig(this.ctx.storage);
      const unprocessed = await loadUnprocessedThreads(this.ctx.storage);
      return Response.json({ config, unprocessedThreads: unprocessed.length });
    }
    if (path === "/scan/slack/config" && request.method === "GET") {
      const config = await loadSlackConfig(this.ctx.storage);
      return Response.json({ config });
    }
    if (path === "/scan/slack/config" && request.method === "PUT") {
      const body = (await request.json()) as Partial<SlackConfig>;
      const current = await loadSlackConfig(this.ctx.storage);
      const updated: SlackConfig = {
        enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
        botUserId: typeof body.botUserId === "string" ? body.botUserId : current.botUserId,
      };
      await saveSlackConfig(this.ctx.storage, updated);
      return Response.json({ config: updated });
    }
    if (path === "/slack/threads" && request.method === "GET") {
      const threads = await loadAllSlackThreads(this.ctx.storage);
      return Response.json({ threads });
    }

    // ── Slack thread storage (called by the bot webhook handler) ──
    if (path === "/slack/store-thread" && request.method === "POST") {
      const body = (await request.json()) as {
        channelId: string;
        threadTs: string;
        channelName?: string;
        triggerMessageTs: string;
        messages: SlackMessage[];
      };
      await storeSlackThread(this.ctx.storage, {
        channelId: body.channelId,
        threadTs: body.threadTs,
        channelName: body.channelName,
        triggerMessageTs: body.triggerMessageTs,
        messages: body.messages,
        receivedAt: new Date().toISOString(),
      });
      return Response.json({ ok: true });
    }
    if (path === "/slack/append-message" && request.method === "POST") {
      const body = (await request.json()) as {
        channelId: string;
        threadTs: string;
        message: SlackMessage;
      };
      await appendSlackMessage(this.ctx.storage, body.channelId, body.threadTs, body.message);
      return Response.json({ ok: true });
    }

    if (path === "/email-diagnostics" && request.method === "GET") {
      return this.handleEmailDiagnostics();
    }

    // ── Conversation category scope ──
    if (path === "/conversation/category" && request.method === "PUT") {
      const { category } = (await request.json()) as { category: string | null };
      if (category) {
        await this.ctx.storage.put("conversation:category", category);
      } else {
        await this.ctx.storage.delete("conversation:category");
      }
      return Response.json({ ok: true, category });
    }

    // ── Workspace endpoints ──
    if (path === "/workspace/active" && request.method === "PUT") {
      const { category } = (await request.json()) as { category: string | null };
      if (category) {
        await this.ctx.storage.put("workspace:active", category);
      } else {
        await this.ctx.storage.delete("workspace:active");
      }
      return Response.json({ ok: true, category });
    }

    const wsTimelineReorderMatch = path.match(/^\/workspace\/([^/]+)\/timeline\/reorder$/);
    if (wsTimelineReorderMatch && request.method === "PUT") {
      const category = decodeURIComponent(wsTimelineReorderMatch[1]);
      const { orderedIds } = (await request.json()) as { orderedIds: string[] };
      if (!Array.isArray(orderedIds)) return Response.json({ error: "orderedIds required" }, { status: 400 });
      await reorderTimeline(this.ctx.storage, category, orderedIds);
      return Response.json({ ok: true });
    }

    const wsMatch = path.match(/^\/workspace\/([^/]+)$/);
    const wsFeedMatch = path.match(/^\/workspace\/([^/]+)\/feed$/);
    const wsFeedItemMatch = path.match(/^\/workspace\/([^/]+)\/feed\/([^/]+)$/);

    if (wsMatch && request.method === "GET") {
      const category = decodeURIComponent(wsMatch[1]);
      const ws = await getOrCreateWorkspace(this.ctx.storage, category);
      return Response.json({ workspace: ws });
    }

    if (wsMatch && request.method === "PUT") {
      const category = decodeURIComponent(wsMatch[1]);
      const { description } = (await request.json()) as { description: string };
      const ws = await updateWorkspaceDescription(this.ctx.storage, category, description);
      if (!ws) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ workspace: ws });
    }

    if (wsFeedMatch && request.method === "POST") {
      const category = decodeURIComponent(wsFeedMatch[1]);
      const body = (await request.json()) as Omit<FeedItem, "id" | "createdAt">;
      const item = await addFeedItem(this.ctx.storage, category, body);
      return Response.json({ item });
    }

    if (wsFeedItemMatch && request.method === "PUT") {
      const category = decodeURIComponent(wsFeedItemMatch[1]);
      const itemId = wsFeedItemMatch[2];
      const updates = (await request.json()) as Partial<Pick<FeedItem, "content" | "linkRef" | "pinned" | "highlighted" | "imageWidth">>;
      const item = await updateFeedItem(this.ctx.storage, category, itemId, updates);
      if (!item) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ item });
    }

    if (wsFeedItemMatch && request.method === "DELETE") {
      const category = decodeURIComponent(wsFeedItemMatch[1]);
      const itemId = wsFeedItemMatch[2];
      const ok = await deleteFeedItem(this.ctx.storage, category, itemId);
      if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ ok: true });
    }

    return super.onRequest(request);
  }

  override async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal: AbortSignal | undefined },
  ): Promise<Response | undefined> {
    // Pipeline test: send "ping" to verify end-to-end works without model
    const lastMsg = this.messages.at(-1);
    if (lastMsg?.role === "user") {
      const text = lastMsg.parts?.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("").trim().toLowerCase();
      if (text === "ping") {
        console.log("[chat] Ping received — returning test response");
        return new Response("Pong! The chat pipeline is working correctly.", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    }

    const modelConfig = loadModelConfig(await this.ctx.storage.get<Partial<ModelConfig>>(STORAGE_KEY_MODEL_CONFIG));
    const tools: ToolSet = {};
    const promptConfig = loadPromptConfig(await this.ctx.storage.get<Partial<PromptConfig>>(STORAGE_KEY_PROMPT_CONFIG));
    let system = assembleBasePrompt(promptConfig);
    const baseDO = this.getBaseDOInfo();

    tools.display_emails = tool({
      description: "REQUIRED: Render a list of emails as interactive visual cards. You MUST call this after ANY codemode that returns multiple emails. Never skip this — the user cannot see raw data. Pass the fetched data directly.",
      inputSchema: z.object({
        title: z.string().optional().describe("Heading for the email list, e.g. 'Unread emails' or 'Search results'"),
        emails: z.array(z.object({
          id: z.string(),
          threadId: z.string(),
          from: z.string().describe("Sender name and email, e.g. 'John Doe <john@example.com>'"),
          subject: z.string(),
          snippet: z.string(),
          date: z.string().describe("ISO date string"),
          unread: z.boolean().optional(),
        })).describe("Array of email objects from codemode results"),
      }),
      execute: async () => ({ displayed: true }),
    });

    tools.display_email = tool({
      description: "REQUIRED: Render a single email as an expandable visual preview with sender, subject, body, and optional highlight. You MUST call this after ANY codemode that fetches a single email's content. Never write email content as plain text.",
      inputSchema: z.object({
        from: z.string().describe("Sender name and email"),
        to: z.string().optional().describe("Recipient(s)"),
        subject: z.string(),
        date: z.string().describe("ISO date string"),
        snippet: z.string(),
        bodyText: z.string().optional().describe("Plain text body of the email"),
        highlight: z.string().optional().describe("A specific passage to highlight within the email"),
      }),
      execute: async () => ({ displayed: true }),
    });

    tools.display_quote = tool({
      description: "Render a styled blockquote from an email with sender attribution. You MUST use this whenever referencing, excerpting, or paraphrasing what someone wrote. Never paste quoted text inline — always use this tool so the user sees a properly formatted quote.",
      inputSchema: z.object({
        text: z.string().describe("The quoted passage"),
        from: z.string().optional().describe("Who wrote this quote"),
        subject: z.string().optional().describe("Subject of the email this quote is from"),
        context: z.string().optional().describe("Brief context about why this quote matters"),
      }),
      execute: async () => ({ displayed: true }),
    });

    tools.suggest_todos = tool({
      description: "Render interactive to-do suggestion cards the user can accept or dismiss. You MUST call this PROACTIVELY whenever you spot action items, deadlines, follow-ups, commitments, or requests in emails. Don't wait to be asked — if an email contains something actionable, suggest a todo. Include the sourceEmail so the user can trace back to the original message. IMPORTANT: Before calling this, check the to-do context in your system prompt — do NOT suggest items that duplicate or closely match existing active or pending todos.",
      inputSchema: z.object({
        todos: z.array(z.object({
          title: z.string().describe("Short actionable title, e.g. 'Reply to Sarah about Q3 budget'"),
          description: z.string().optional().describe("Additional context about the task"),
          scheduledDate: z.string().optional().describe("Suggested date in YYYY-MM-DD format"),
          sourceEmail: z.object({
            messageId: z.string(),
            threadId: z.string(),
            subject: z.string(),
            from: z.string(),
            snippet: z.string(),
            accountEmail: z.string().optional(),
          }).optional().describe("The email this todo was extracted from"),
        })),
      }),
      execute: async ({ todos: suggestions }) => {
        if (baseDO) {
          const res = await baseDO.stub.fetch(new Request("http://localhost/todos/suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-partykit-room": baseDO.userId },
            body: JSON.stringify({ suggestions }),
          }));
          if (res.ok) {
            const data = await res.json() as { todos: TodoItem[] };
            return { suggested: data.todos.length, ids: data.todos.map((t: TodoItem) => t.id) };
          }
          return { suggested: 0, ids: [] };
        }
        const created = await addSuggestedTodos(this.ctx.storage, suggestions);
        await this.ensureTodoAlarm();
        return { suggested: created.length, ids: created.map((t) => t.id) };
      },
    });

    tools.complete_todo = tool({
      description: "Mark a to-do item as completed. Use the todo ID from the to-do context provided in the system prompt.",
      inputSchema: z.object({
        todoId: z.string().describe("The ID of the todo to complete"),
      }),
      execute: async ({ todoId }) => {
        if (baseDO) {
          const res = await baseDO.stub.fetch(new Request(`http://localhost/todos/${todoId}/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-partykit-room": baseDO.userId },
            body: "{}",
          }));
          if (res.ok) {
            const data = await res.json() as { todo: TodoItem };
            return { completed: true, title: data.todo.title };
          }
          return { error: "Todo not found" };
        }
        const todo = await completeTodo(this.ctx.storage, todoId);
        if (!todo) return { error: "Todo not found" };
        return { completed: true, title: todo.title };
      },
    });

    tools.update_todo = tool({
      description: "Update a to-do item's title, description, or scheduled date. Use the todo ID from the to-do context.",
      inputSchema: z.object({
        todoId: z.string().describe("The ID of the todo to update"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description"),
        scheduledDate: z.string().optional().describe("New scheduled date in YYYY-MM-DD format, or empty string to clear"),
      }),
      execute: async ({ todoId, title, description, scheduledDate }) => {
        const updates: Partial<Pick<TodoItem, "title" | "description" | "scheduledDate">> = {};
        if (title) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate || null;
        if (baseDO) {
          const res = await baseDO.stub.fetch(new Request(`http://localhost/todos/${todoId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", "x-partykit-room": baseDO.userId },
            body: JSON.stringify(updates),
          }));
          if (res.ok) {
            const data = await res.json() as { todo: TodoItem };
            return { updated: true, title: data.todo.title };
          }
          return { error: "Todo not found" };
        }
        const todo = await updateTodo(this.ctx.storage, todoId, updates);
        if (!todo) return { error: "Todo not found" };
        return { updated: true, title: todo.title };
      },
    });

    tools.delete_todo = tool({
      description: "Delete a to-do item permanently. Only use when the user explicitly asks to remove a todo.",
      inputSchema: z.object({
        todoId: z.string().describe("The ID of the todo to delete"),
      }),
      execute: async ({ todoId }) => {
        if (baseDO) {
          const res = await baseDO.stub.fetch(new Request(`http://localhost/todos/${todoId}`, {
            method: "DELETE",
            headers: { "x-partykit-room": baseDO.userId },
          }));
          if (res.ok) return { deleted: true };
          return { error: "Todo not found" };
        }
        const ok = await deleteTodo(this.ctx.storage, todoId);
        if (!ok) return { error: "Todo not found" };
        return { deleted: true };
      },
    });

    tools.add_todo = tool({
      description: "Create a new to-do item directly (not as a suggestion). Use when the user explicitly asks to add a todo that isn't from an email.",
      inputSchema: z.object({
        title: z.string().describe("The todo title"),
        description: z.string().optional().describe("Optional description"),
        scheduledDate: z.string().optional().describe("Optional date in YYYY-MM-DD format"),
      }),
      execute: async ({ title, description, scheduledDate }) => {
        if (baseDO) {
          const res = await baseDO.stub.fetch(new Request("http://localhost/todos", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-partykit-room": baseDO.userId },
            body: JSON.stringify({ title: title.trim(), description, scheduledDate: scheduledDate || null }),
          }));
          if (res.ok) {
            const data = await res.json() as { todo: TodoItem };
            return { created: true, id: data.todo.id, title: data.todo.title };
          }
          return { error: "Failed to create todo" };
        }
        const todoPrefs = await loadPreferences(this.ctx.storage);
        const todo = await addTodo(this.ctx.storage, {
          title: title.trim(),
          description,
          status: "pending",
          scheduledDate: scheduledDate || null,
          sourceEmails: [],
          agentSuggested: false,
          userResponse: null,
        }, { addToTop: todoPrefs.addToTop });
        await this.ensureTodoAlarm();
        return { created: true, id: todo.id, title: todo.title };
      },
    });

    tools.add_workspace_note = tool({
      description: "Add a note to the user's active workspace. Use this when the user is viewing a workspace and asks you to save, note, or add information to it.",
      inputSchema: z.object({
        content: z.string().describe("The note content to add"),
      }),
      execute: async ({ content }) => {
        const wsName = await this.ctx.storage.get<string>("workspace:active");
        if (!wsName) return { error: "No active workspace" };
        const item = await addFeedItem(this.ctx.storage, wsName, { type: "note", content });
        return { added: true, workspace: wsName, noteId: item.id };
      },
    });

    const searchConfig = loadSearchConfig(await this.ctx.storage.get<Partial<SearchConfig>>(STORAGE_KEY_SEARCH_CONFIG));
    if (searchConfig.apiKey) {
      tools.web_search = tool({
        description: "Search the web for current information. Use when the user asks about news, facts, people, companies, current events, or anything beyond their email and to-do list.",
        inputSchema: z.object({
          query: z.string().describe("The search query"),
          max_results: z.number().optional().describe("Number of results to return (default 5, max 10)"),
        }),
        execute: async ({ query, max_results }) => {
          const res = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: searchConfig.apiKey,
              query,
              max_results: Math.min(max_results ?? 5, 10),
              include_answer: true,
            }),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            throw new Error(`Web search failed (${res.status}): ${errText.slice(0, 200)}`);
          }
          const data = await res.json() as { answer?: string; results?: { title: string; url: string; content: string; score: number }[] };
          return {
            answer: data.answer,
            results: (data.results ?? []).map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.content?.slice(0, 500),
              score: r.score,
            })),
          };
        },
      });
    }

    const accounts = await loadAccounts(this.ctx.storage);
    const activeEmails = await loadActiveEmails(this.ctx.storage);
    const activeAccounts = accounts.filter((a) => activeEmails.includes(a.email));
    const accountInfoForPrompt: AccountInfo[] = [];
    const allValidatedTokens: import("./_gmail-tools").AccountToken[] = [];

    if (activeAccounts.length > 0) {
      const validatedTokens = allValidatedTokens;

      for (const account of activeAccounts) {
        try {
          let token = account.access_token;
          const testRes = await fetch(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (testRes.status === 401) {
            if (!account.refresh_token) {
              void logMemoryEvent(this.ctx.storage, "chat_error", `Token expired for ${account.email}, no refresh token`, { email: account.email }).catch(() => {});
              continue;
            }
            const dog = new InboxDog({ fetch: globalThis.fetch.bind(globalThis) });
            const refreshed = await dog.refreshToken(account.refresh_token, account.client_id, account.client_secret);
            token = refreshed.access_token;
            account.access_token = token;
            await this.ctx.storage.put(STORAGE_KEY_ACCOUNTS, accounts);
            void logMemoryEvent(this.ctx.storage, "token_refresh", `Token refreshed for ${account.email}`, { email: account.email }).catch(() => {});
          } else if (!testRes.ok) {
            void logMemoryEvent(this.ctx.storage, "chat_error", `Gmail API returned ${testRes.status} for ${account.email}`).catch(() => {});
            continue;
          }
          validatedTokens.push({ email: account.email, token, label: account.label });
          accountInfoForPrompt.push({ email: account.email, label: account.label });
        } catch (e) {
          console.error(`[chat] Failed to validate token for ${account.email}:`, e);
          continue;
        }
      }

      if (validatedTokens.length > 0) {
        const { tools: gmailTools, resetCallCounter } = createGmailTools(validatedTokens);
        const executor = new DynamicWorkerExecutor({ loader: this.env.LOADER });
        const codemodeInner = createCodeTool({ tools: gmailTools, executor });
        tools.codemode = tool({
          description: (codemodeInner as { description?: string }).description,
          inputSchema: z.object({ code: z.string().describe("The JavaScript async arrow function to execute") }),
          execute: async ({ code }: { code: string }) => {
            console.log("[codemode] Input code received from model:\n", code);
            const originalCode = code;
            code = sanitizeCodemodeCode(code);
            console.log("[codemode] Code after sanitize:\n", code);

            if (looksTruncated(code)) {
              console.error("[codemode] Code rejected as truncated.");
              void logMemoryEvent(this.ctx.storage, "codemode_error", "Code rejected as truncated", {
                codePreview: code.slice(0, 300),
              }).catch(() => {});
              throw new Error("Code appears truncated (incomplete). Please output the full async arrow with no cut-off.");
            }

            resetCallCounter();
            const agentId = this.name ?? "default";
            const startMs = Date.now();
            let safeRes: unknown;
            let error: string | undefined;
            try {
              const res = await withCodemodeGate(agentId, () =>
                (codemodeInner as unknown as { execute: (x: { code: string }) => Promise<unknown> }).execute({ code })
              );
              safeRes = sanitizePayload(res);
            } catch (e) {
              error = e instanceof Error ? e.message : String(e);
              void logMemoryEvent(this.ctx.storage, "codemode_error", `Execution failed: ${error.slice(0, 120)}`, {
                code: code.slice(0, 300),
                error,
              }).catch(() => {});
              throw e;
            } finally {
              const durationMs = Date.now() - startMs;
              const apiPaths = extractApiPaths(originalCode);
              const resultPreview = error
                ? `Error: ${error.slice(0, 150)}`
                : JSON.stringify(safeRes).slice(0, 200);
              void logMemoryEvent(this.ctx.storage, "codemode_execution", apiPaths.length > 0 ? apiPaths.join(", ") : "codemode call", {
                code: code.slice(0, 300),
                apiPaths,
                durationMs,
                error,
                resultPreview,
              }).catch(() => {});
            }
            console.log("[codemode] Execution result:\n", JSON.stringify(safeRes, null, 2));
            return safeRes;
          },
        });
      } else {
        system = "You are a helpful assistant. The user's Gmail accounts could not be validated. Ask them to reconnect. You can still have a general conversation.";
      }
    } else {
      const session = await this.ctx.storage.get<GmailSession>("gmail_session");
      if (session?.access_token) {
        let activeToken = session.access_token;
        const testRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${activeToken}` } });
        if (testRes.status === 401) {
          if (!session.refresh_token) {
            void logMemoryEvent(this.ctx.storage, "chat_error", "Gmail token expired, no refresh token available", { email: session.email }).catch(() => {});
            throw new Error("Gmail token expired and no refresh token available. Please reconnect.");
          }
          const dog = new InboxDog({ fetch: globalThis.fetch.bind(globalThis) });
          const refreshed = await dog.refreshToken(session.refresh_token, session.client_id, session.client_secret);
          activeToken = refreshed.access_token;
          await this.ctx.storage.put("gmail_session", { ...session, access_token: activeToken });
          void logMemoryEvent(this.ctx.storage, "token_refresh", "Gmail token refreshed successfully", { email: session.email }).catch(() => {});
        } else if (!testRes.ok) {
          void logMemoryEvent(this.ctx.storage, "chat_error", `Gmail API returned ${testRes.status} during token validation`).catch(() => {});
          throw new Error(`Gmail API returned ${testRes.status} during token validation`);
        }
        const { tools: gmailTools, resetCallCounter } = createGmailTools(activeToken);
        const executor = new DynamicWorkerExecutor({ loader: this.env.LOADER });
        const codemodeInner = createCodeTool({ tools: gmailTools, executor });
        tools.codemode = tool({
          description: (codemodeInner as { description?: string }).description,
          inputSchema: z.object({ code: z.string().describe("The JavaScript async arrow function to execute") }),
          execute: async ({ code }: { code: string }) => {
            console.log("[codemode] Input code received from model:\n", code);
            const originalCode = code;
            code = sanitizeCodemodeCode(code);
            console.log("[codemode] Code after sanitize:\n", code);
            if (looksTruncated(code)) {
              console.error("[codemode] Code rejected as truncated.");
              void logMemoryEvent(this.ctx.storage, "codemode_error", "Code rejected as truncated", { codePreview: code.slice(0, 300) }).catch(() => {});
              throw new Error("Code appears truncated (incomplete). Please output the full async arrow with no cut-off.");
            }
            resetCallCounter();
            const agentId = this.name ?? "default";
            const startMs = Date.now();
            let safeRes: unknown;
            let error: string | undefined;
            try {
              const res = await withCodemodeGate(agentId, () => (codemodeInner as unknown as { execute: (x: { code: string }) => Promise<unknown> }).execute({ code }));
              safeRes = sanitizePayload(res);
            } catch (e) {
              error = e instanceof Error ? e.message : String(e);
              void logMemoryEvent(this.ctx.storage, "codemode_error", `Execution failed: ${error.slice(0, 120)}`, { code: code.slice(0, 300), error }).catch(() => {});
              throw e;
            } finally {
              const durationMs = Date.now() - startMs;
              const apiPaths = extractApiPaths(originalCode);
              const resultPreview = error ? `Error: ${error.slice(0, 150)}` : JSON.stringify(safeRes).slice(0, 200);
              void logMemoryEvent(this.ctx.storage, "codemode_execution", apiPaths.length > 0 ? apiPaths.join(", ") : "codemode call", { code: code.slice(0, 300), apiPaths, durationMs, error, resultPreview }).catch(() => {});
            }
            console.log("[codemode] Execution result:\n", JSON.stringify(safeRes, null, 2));
            return safeRes;
          },
        });
        allValidatedTokens.push({ email: session.email, token: activeToken });
        accountInfoForPrompt.push({ email: session.email });
      } else {
        system = "You are a helpful assistant. The user has not connected their Gmail account yet. Politely tell them to log out and reconnect with Google to use Gmail features. You can still have a general conversation.";
      }
    }

    let model;
    try {
      model = (() => {
        switch (modelConfig.provider) {
          case "openai": {
            if (!modelConfig.apiKey) throw new Error("OpenAI API key not configured. Go to Settings to add one.");
            const openai = createOpenAI({ apiKey: modelConfig.apiKey });
            return openai(modelConfig.modelId);
          }
          case "anthropic": {
            if (!modelConfig.apiKey) throw new Error("Anthropic API key not configured. Go to Settings to add one.");
            const anthropic = createAnthropic({ apiKey: modelConfig.apiKey });
            return anthropic(modelConfig.modelId);
          }
          case "google": {
            if (!modelConfig.apiKey) throw new Error("Google AI API key not configured. Go to Settings to add one.");
            const google = createGoogleGenerativeAI({ apiKey: modelConfig.apiKey });
            return google(modelConfig.modelId);
          }
          case "groq": {
            if (!modelConfig.apiKey) throw new Error("Groq API key not configured. Go to Settings to add one.");
            const groq = createGroq({ apiKey: modelConfig.apiKey });
            return groq(modelConfig.modelId);
          }
          default: {
            const workersai = createWorkersAI({ binding: this.env.AI });
            return workersai(modelConfig.modelId as Parameters<typeof workersai>[0]);
          }
        }
      })();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[model] Failed to create model:", msg);
      void logMemoryEvent(this.ctx.storage, "chat_error", `Model creation failed: ${msg}`, { provider: modelConfig.provider, modelId: modelConfig.modelId }).catch(() => {});
      return this._errorResponse(`Configuration error: ${msg}`);
    }
    const memory = await loadMemory(this.ctx.storage);

    const lastUserMsg = this.messages.filter((m) => m.role === "user").pop();
    const userPreview = lastUserMsg?.parts
      ?.filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join(" ")
      .slice(0, 120) ?? "";

    void logMemoryEvent(this.ctx.storage, "chat_started", userPreview || "New message", {
      messageCount: this.messages.length,
      userFacts: memory.userFacts.length,
      hasCompaction: !!memory.compactionSummary,
      hasGmail: accountInfoForPrompt.length > 0,
      connectedAccounts: accountInfoForPrompt.map((a) => a.email),
    }).catch(() => {});

    console.log("[memory] Loaded —", {
      hasCompaction: !!memory.compactionSummary,
      userFacts: memory.userFacts.length,
      conversationSummaries: memory.conversationSummaries.length,
    });

    console.log("[chat] Model config:", { provider: modelConfig.provider, modelId: modelConfig.modelId, hasKey: !!modelConfig.apiKey });
    console.log("[chat] Messages to convert:", this.messages.length);

    let modelMessages = await convertToModelMessages(this.messages);
    console.log("[chat] Model messages ready:", modelMessages.length);

    const COMPACT_THRESHOLD = 16;
    const KEEP_RECENT = 10;

    if (modelMessages.length > COMPACT_THRESHOLD) {
      const oldMessages = modelMessages.slice(0, -KEEP_RECENT);
      const recentMessages = modelMessages.slice(-KEEP_RECENT);

      try {
        const newSummary = await compactMessages(oldMessages, memory.compactionSummary, model, this.ctx.storage);
        await saveCompaction(this.ctx.storage, newSummary);
        memory.compactionSummary = newSummary;
        console.log("[memory] Compacted", oldMessages.length, "old messages →", newSummary.slice(0, 100) + "...");
      } catch (e) {
        console.error("[memory] Compaction failed, falling back to hard truncation:", e);
        void logMemoryEvent(this.ctx.storage, "compaction_error", "Compaction failed, fell back to hard truncation", {
          error: e instanceof Error ? e.message : String(e),
          oldMessageCount: oldMessages.length,
        }).catch(() => {});
      }

      modelMessages = recentMessages;
      while (modelMessages.length > 0 && modelMessages[0].role === "tool") {
        modelMessages.shift();
      }
    }

    if (memory.compactionSummary) {
      modelMessages.unshift({
        role: "user" as const,
        content: `[CONVERSATION CONTEXT — earlier messages were summarized]\n${memory.compactionSummary}`,
      });
    }

    const fetchTodosAndPrefs = async (): Promise<[TodoItem[], TodoPreferences]> => {
      if (baseDO) {
        try {
          const res = await baseDO.stub.fetch(new Request("http://localhost/todos", {
            method: "GET",
            headers: { "x-partykit-room": baseDO.userId },
          }));
          if (res.ok) {
            const data = await res.json() as { todos: TodoItem[]; preferences: TodoPreferences };
            return [data.todos, data.preferences];
          }
        } catch (e) {
          console.error("[chat] Failed to load todos from base DO:", e);
        }
        return [[], await loadPreferences(this.ctx.storage)];
      }
      return Promise.all([loadTodos(this.ctx.storage), loadPreferences(this.ctx.storage)]);
    };

    const [todosResult, inboxSnapshot, activeWsName, conversationCategory] = await Promise.all([
      fetchTodosAndPrefs(),
      allValidatedTokens.length > 0
        ? fetchInboxSnapshot(allValidatedTokens).catch((e) => {
            console.error("[inbox-snapshot] Failed:", e);
            return "";
          })
        : Promise.resolve(""),
      this.ctx.storage.get<string>("workspace:active"),
      this.ctx.storage.get<string>("conversation:category"),
    ]);
    const [todoItems, todoPrefs] = todosResult;

    const categoryScope = conversationCategory ?? null;
    const scopedTodos = categoryScope
      ? todoItems.filter((t) => t.categories?.includes(categoryScope))
      : todoItems;

    console.log("[chat] Todos/prefs/snapshot loaded, todos:", scopedTodos.length, "snapshot length:", inboxSnapshot?.length ?? 0, "category:", categoryScope ?? "(none)");
    const todoContext = buildTodoPreferenceContext(todoPrefs, scopedTodos);

    const wsName = categoryScope ?? activeWsName;
    let workspaceContext: string | undefined;
    if (wsName) {
      const wsStorage = baseDO ? await this.fetchWorkspaceFromBase(baseDO, wsName) : await loadWorkspace(this.ctx.storage, wsName);
      if (wsStorage && wsStorage.feed.length > 0) {
        workspaceContext = buildWorkspaceContext(wsStorage);
      }
    }

    const effectiveInboxSnapshot = categoryScope ? undefined : (inboxSnapshot || undefined);

    const hasWebSearch = !!searchConfig.apiKey;
    system = buildSystemPrompt(promptConfig, memory, accountInfoForPrompt, todoContext || undefined, effectiveInboxSnapshot, workspaceContext, hasWebSearch);
    console.log("[chat] System prompt built, length:", system.length, "category-scoped:", !!categoryScope);

    const conversationId = this.name ?? "default";

    const wrappedOnFinish: StreamTextOnFinishCallback<ToolSet> = async (event) => {
      // Always call the original onFinish first so message persistence is never blocked
      await (onFinish as unknown as StreamTextOnFinishCallback<ToolSet>)(event);

      try {
        const allMessages = await convertToModelMessages(this.messages);
        const tail = allMessages.slice(-8);

        console.log("[memory] Message tail for extraction:", tail.length, "messages,",
          "roles:", tail.map((m) => m.role).join(","));

        if (!hasSubstantiveContent(tail)) {
          console.log("[memory] Skipping memory extraction — no substantive content in recent messages");
          void logMemoryEvent(this.ctx.storage, "memory_skip", "No substantive content in recent messages", {
            messageCount: tail.length,
            roles: tail.map((m) => m.role),
          }).catch(() => {});
          return;
        }

        console.log("[memory] Running fact extraction + summary generation...");

        const [updatedFacts, convSummary] = await Promise.all([
          extractUserFacts(tail, memory.userFacts, model, this.ctx.storage),
          generateConversationSummary(tail, model, this.ctx.storage),
        ]);

        await Promise.all([
          saveUserFacts(this.ctx.storage, updatedFacts),
          saveConversationSummary(this.ctx.storage, conversationId, convSummary),
        ]);

        const newFactCount = updatedFacts.length - memory.userFacts.length;
        console.log("[memory] Saved —", {
          totalFacts: updatedFacts.length,
          newFacts: newFactCount,
          newFactValues: updatedFacts.slice(memory.userFacts.length),
          summary: convSummary,
        });

        // Sync facts back to the base user DO so the memory inspector
        // (which reads from the base DO) stays up to date.
        const roomName = this.name ?? "";
        const sep = roomName.indexOf("__");
        if (sep > 0) {
          const baseUserId = roomName.slice(0, sep);
          try {
            const baseStub = this.env.INBOX_AGENT.get(
              this.env.INBOX_AGENT.idFromName(baseUserId),
            );
            await baseStub.fetch(
              new Request("http://localhost/memory", {
                method: "PUT",
                body: JSON.stringify({
                  userFacts: updatedFacts,
                  conversationSummaries: [{ id: conversationId, summary: convSummary, date: new Date().toISOString().slice(0, 10) }],
                }),
                headers: {
                  "Content-Type": "application/json",
                  "x-partykit-room": baseUserId,
                },
              }),
            );
            console.log("[memory] Synced facts back to base DO:", baseUserId);
          } catch (syncErr) {
            console.error("[memory] Failed to sync facts to base DO:", syncErr);
          }
        }
      } catch (e) {
        console.error("[memory] Failed to update memory:", e);
        void logMemoryEvent(this.ctx.storage, "memory_error", `Memory update failed: ${e instanceof Error ? e.message : String(e)}`, {
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack?.slice(0, 300) : undefined,
        }).catch(() => {});
      }
    };

    const persistError = async (e: unknown) => {
      const errorMessage = e instanceof Error ? e.message : String(e);
      await this.persistMessages([
        ...this.messages,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: "",
          parts: [{ type: "text", text: `[SYSTEM_ERROR] ${errorMessage}` }]
        } as UIMessage
      ]);
    };

    const doStream = (activeModel: Parameters<typeof streamText>[0]["model"]) => {
      const result = streamText({
        model: activeModel,
        system,
        messages: modelMessages,
        tools,
        stopWhen: stepCountIs(6),
        timeout: 120_000,
        onFinish: wrappedOnFinish,
        onError: async ({ error }) => {
          console.error("AI SDK streamText onError callback:", error);
          const msg = error instanceof Error ? error.message : String(error);
          void logMemoryEvent(this.ctx.storage, "chat_error", `Stream error: ${msg.slice(0, 120)}`, {
            error: msg,
          }).catch(() => {});
          await persistError(error);
        },
        onAbort: () => {
          console.error("[chat] streamText aborted (timeout or signal)");
        },
        abortSignal: options?.abortSignal,
      });

      const res = result.toUIMessageStreamResponse();
      if (!res.body) return res;

      const reader = res.body.getReader();
      let chunkCount = 0;
      const stream = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) {
            console.log("[chat] Stream done after", chunkCount, "chunks");
            controller.close();
          } else {
            chunkCount++;
            if (chunkCount <= 3) {
              const preview = new TextDecoder().decode(value).slice(0, 120);
              console.log(`[chat] Stream chunk #${chunkCount}:`, preview);
            }
            controller.enqueue(value);
          }
        },
        cancel() {
          console.log("[chat] Stream cancelled after", chunkCount, "chunks");
          return reader.cancel();
        },
      });
      return new Response(stream, { headers: res.headers, status: res.status });
    };

    try {
      console.log("[chat] Calling streamText with", modelMessages.length, "messages,", Object.keys(tools).length, "tools");
      return doStream(model);
    } catch (error) {
      // For Workers AI, retry with fallback model on infrastructure errors
      if (modelConfig.provider === "workers-ai" && modelConfig.modelId !== FALLBACK_MODEL) {
        console.warn("[chat] Primary model failed, retrying with fallback:", FALLBACK_MODEL, error);
        try {
          const workersai = createWorkersAI({ binding: this.env.AI });
          const fallback = workersai(FALLBACK_MODEL as Parameters<typeof workersai>[0]);
          return doStream(fallback);
        } catch (fallbackError) {
          console.error("[chat] Fallback model also failed:", fallbackError);
        }
      }
      console.error("AI SDK streamText synchronous error:", error);
      const msg = error instanceof Error ? (error as Error).message : String(error);
      void logMemoryEvent(this.ctx.storage, "chat_error", `Chat failed: ${msg.slice(0, 120)}`, {
        error: msg,
      }).catch(() => {});
      await persistError(error);
      return this._errorResponse(msg);
    }
  }

  private getBaseDOInfo(): { stub: DurableObjectStub; userId: string } | null {
    const roomName = this.name ?? "";
    const sep = roomName.indexOf("__");
    if (sep <= 0) return null;
    const userId = roomName.slice(0, sep);
    return {
      stub: this.env.INBOX_AGENT.get(this.env.INBOX_AGENT.idFromName(userId)),
      userId,
    };
  }

  private async fetchWorkspaceFromBase(
    base: { stub: DurableObjectStub; userId: string },
    category: string,
  ): Promise<import("./_workspace").CategoryWorkspace | null> {
    try {
      const res = await base.stub.fetch(
        new Request(`http://localhost/workspace/${encodeURIComponent(category)}`, {
          method: "GET",
          headers: { "x-partykit-room": base.userId },
        }),
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { workspace: import("./_workspace").CategoryWorkspace };
      return data.workspace ?? null;
    } catch (e) {
      console.error("[workspace-fetch] Failed to load workspace from base DO:", e);
      return null;
    }
  }

  private _errorResponse(message: string): Response {
    return new Response(`I encountered an error: ${message}`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  private async handleEmailDiagnostics(): Promise<Response> {
    const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
    const session = await this.ctx.storage.get<GmailSession>("gmail_session");
    if (!session?.access_token) {
      return Response.json({ error: "No Gmail session", connected: false }, { status: 200 });
    }

    let token = session.access_token;

    const profileRes = await fetch(`${GMAIL_BASE}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (profileRes.status === 401 && session.refresh_token) {
      try {
        const dog = new InboxDog({ fetch: globalThis.fetch.bind(globalThis) });
        const refreshed = await dog.refreshToken(session.refresh_token, session.client_id, session.client_secret);
        token = refreshed.access_token;
        await this.ctx.storage.put("gmail_session", { ...session, access_token: token });
      } catch {
        return Response.json({ error: "Token expired and refresh failed", connected: false });
      }
    } else if (!profileRes.ok && profileRes.status !== 401) {
      return Response.json({ error: `Gmail API returned ${profileRes.status}`, connected: false });
    }

    type GmailProfile = { emailAddress: string; messagesTotal: number; threadsTotal: number; historyId: string };
    type GmailLabel = { id: string; name: string; messagesTotal?: number; messagesUnread?: number; threadsTotal?: number; threadsUnread?: number; type?: string };

    const [profile, inboxLabel, labels] = await Promise.all([
      fetch(`${GMAIL_BASE}/profile`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() as Promise<GmailProfile> : null),
      fetch(`${GMAIL_BASE}/labels/INBOX`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() as Promise<GmailLabel> : null),
      fetch(`${GMAIL_BASE}/labels`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() as Promise<{ labels: GmailLabel[] }> : null),
    ]);

    const events = await getMemoryEvents(this.ctx.storage);
    const codemodeEvents = events
      .filter((e) => e.type === "codemode_execution")
      .slice(-20);

    return Response.json({
      connected: true,
      profile,
      inbox: inboxLabel ? {
        totalMessages: inboxLabel.messagesTotal,
        unreadMessages: inboxLabel.messagesUnread,
        totalThreads: inboxLabel.threadsTotal,
        unreadThreads: inboxLabel.threadsUnread,
      } : null,
      labelCount: labels?.labels?.length ?? 0,
      systemLabels: labels?.labels
        ?.filter((l) => l.type === "system" && l.messagesTotal !== undefined)
        .map((l) => ({ name: l.name, messages: l.messagesTotal, unread: l.messagesUnread })) ?? [],
      recentCodemodeCalls: codemodeEvents,
    });
  }

  private async ensureTodoAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.scheduleScanAlarm();
    }
  }

  private async scheduleScanAlarm(): Promise<void> {
    const config = await loadScanConfig(this.ctx.storage);
    const midnight = getNextMidnight();

    if (!config.enabled) {
      await this.ctx.storage.setAlarm(midnight);
      return;
    }

    const hasActiveConnections = [...this.getConnections()].length > 0;
    const interval = hasActiveConnections
      ? config.scanIntervalActiveMs
      : config.scanIntervalInactiveMs;

    const nextScan = Date.now() + interval;
    await this.ctx.storage.setAlarm(Math.min(midnight, nextScan));
  }

  private createModelFromConfig(modelConfig: ModelConfig) {
    switch (modelConfig.provider) {
      case "openai": {
        if (!modelConfig.apiKey) return null;
        const openai = createOpenAI({ apiKey: modelConfig.apiKey });
        return openai(modelConfig.modelId);
      }
      case "anthropic": {
        if (!modelConfig.apiKey) return null;
        const anthropic = createAnthropic({ apiKey: modelConfig.apiKey });
        return anthropic(modelConfig.modelId);
      }
      case "google": {
        if (!modelConfig.apiKey) return null;
        const google = createGoogleGenerativeAI({ apiKey: modelConfig.apiKey });
        return google(modelConfig.modelId);
      }
      case "groq": {
        if (!modelConfig.apiKey) return null;
        const groq = createGroq({ apiKey: modelConfig.apiKey });
        return groq(modelConfig.modelId);
      }
      default: {
        const workersai = createWorkersAI({ binding: this.env.AI });
        return workersai(modelConfig.modelId as Parameters<typeof workersai>[0]);
      }
    }
  }

  private async runBackgroundScan(): Promise<ScanResult & { skipped?: string }> {
    const t0 = Date.now();
    console.log("[scan] ── Starting background scan ──");

    const [scanConfig, scanUsage] = await Promise.all([
      loadScanConfig(this.ctx.storage),
      loadScanUsage(this.ctx.storage),
    ]);
    console.log(`[scan] Config loaded (${Date.now() - t0}ms) — enabled=${scanConfig.enabled}, scansToday=${scanUsage.scansToday}/${scanConfig.maxScansPerDay}, tokensToday=${scanUsage.tokensToday}/${scanConfig.maxTokensPerDay}`);

    const quotaCheck = canScan(scanConfig, scanUsage);
    if (!quotaCheck.allowed) {
      console.log(`[scan] Skipped: ${quotaCheck.reason} (${Date.now() - t0}ms)`);
      return { suggested: 0, tokensUsed: 0, emailsScanned: 0, skippedDuplicate: 0, skipped: quotaCheck.reason };
    }

    const accounts = await loadAccounts(this.ctx.storage);
    const activeEmails = await loadActiveEmails(this.ctx.storage);
    const activeAccounts = accounts.filter((a) => activeEmails.includes(a.email));
    console.log(`[scan] Accounts: ${accounts.length} total, ${activeEmails.length} active emails, ${activeAccounts.length} active accounts (${Date.now() - t0}ms)`);

    if (activeAccounts.length === 0) {
      console.log(`[scan] No active accounts, skipping (${Date.now() - t0}ms)`);
      return { suggested: 0, tokensUsed: 0, emailsScanned: 0, skippedDuplicate: 0, skipped: "no_accounts" };
    }

    const validatedTokens: { email: string; token: string }[] = [];
    for (const account of activeAccounts) {
      const tAcct = Date.now();
      try {
        let token = account.access_token;
        console.log(`[scan] Validating token for ${account.email}...`);
        const testRes = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          { headers: { Authorization: `Bearer ${token}` } },
        );
        console.log(`[scan] Token check for ${account.email}: ${testRes.status} (${Date.now() - tAcct}ms)`);
        if (testRes.status === 401 && account.refresh_token) {
          console.log(`[scan] Refreshing token for ${account.email}...`);
          const dog = new InboxDog({ fetch: globalThis.fetch.bind(globalThis) });
          const refreshed = await dog.refreshToken(account.refresh_token, account.client_id, account.client_secret);
          token = refreshed.access_token;
          account.access_token = token;
          await this.ctx.storage.put(STORAGE_KEY_ACCOUNTS, accounts);
          console.log(`[scan] Token refreshed for ${account.email} (${Date.now() - tAcct}ms)`);
        } else if (!testRes.ok) {
          console.log(`[scan] Token invalid for ${account.email} (status ${testRes.status}), skipping`);
          continue;
        }
        validatedTokens.push({ email: account.email, token });
      } catch (e) {
        console.error(`[scan] Token validation failed for ${account.email} (${Date.now() - tAcct}ms):`, e);
        continue;
      }
    }

    if (validatedTokens.length === 0) {
      console.log(`[scan] No valid tokens after validation (${Date.now() - t0}ms)`);
      return { suggested: 0, tokensUsed: 0, emailsScanned: 0, skippedDuplicate: 0, skipped: "no_valid_tokens" };
    }
    console.log(`[scan] ${validatedTokens.length} valid token(s) (${Date.now() - t0}ms)`);

    // For scanning we prefer a fast model. If the user configured an external
    // provider with an API key (OpenAI, Anthropic, etc.) use it — those respond
    // quickly. Otherwise fall back to a small Workers AI model that can handle
    // classification without timing out (the user's chat model may be a 72B+
    // param model that's too slow for structured extraction).
    const SCAN_MODEL = "@cf/meta/llama-3.1-8b-instruct" as Parameters<ReturnType<typeof createWorkersAI>>[0];
    const modelConfig = loadModelConfig(await this.ctx.storage.get<Partial<ModelConfig>>(STORAGE_KEY_MODEL_CONFIG));
    let model = modelConfig.provider !== "workers-ai" ? this.createModelFromConfig(modelConfig) : null;
    let modelSource: string;
    if (model) {
      modelSource = `${modelConfig.provider}/${modelConfig.modelId}`;
    } else {
      const workersai = createWorkersAI({ binding: this.env.AI });
      model = workersai(SCAN_MODEL);
      modelSource = `workers-ai/${SCAN_MODEL}`;
    }
    console.log(`[scan] Using model: ${modelSource} (${Date.now() - t0}ms)`);

    console.log(`[scan] Starting scanInboxForTodos... (${Date.now() - t0}ms)`);
    const result = await scanInboxForTodos(this.ctx.storage, model, validatedTokens);
    if (result.tokensUsed > 0) {
      await recordScanUsage(this.ctx.storage, result.tokensUsed);
    } else {
      await touchLastScanAt(this.ctx.storage);
    }

    console.log(`[scan] ── Complete (${Date.now() - t0}ms): ${result.suggested} suggested, ${result.tokensUsed} tokens, ${result.emailsScanned} scanned, ${result.skippedDuplicate} deduped ──`);

    return result;
  }

  private async runSlackScan(): Promise<SlackScanResult & { skipped?: string }> {
    const t0 = Date.now();
    console.log("[slack-scan] ── Starting Slack scan ──");

    const slackConfig = await loadSlackConfig(this.ctx.storage);
    if (!slackConfig.enabled) {
      console.log(`[slack-scan] Disabled, skipping (${Date.now() - t0}ms)`);
      return { suggested: 0, tokensUsed: 0, threadsScanned: 0, skippedDuplicate: 0, skipped: "disabled" };
    }

    const unprocessed = await loadUnprocessedThreads(this.ctx.storage);
    if (unprocessed.length === 0) {
      console.log(`[slack-scan] No unprocessed threads (${Date.now() - t0}ms)`);
      return { suggested: 0, tokensUsed: 0, threadsScanned: 0, skippedDuplicate: 0 };
    }

    const SCAN_MODEL = "@cf/meta/llama-3.1-8b-instruct" as Parameters<ReturnType<typeof createWorkersAI>>[0];
    const modelConfig = loadModelConfig(await this.ctx.storage.get<Partial<ModelConfig>>(STORAGE_KEY_MODEL_CONFIG));
    let model = modelConfig.provider !== "workers-ai" ? this.createModelFromConfig(modelConfig) : null;
    if (!model) {
      const workersai = createWorkersAI({ binding: this.env.AI });
      model = workersai(SCAN_MODEL);
    }

    const result = await scanSlackForTodos(this.ctx.storage, model);
    console.log(`[slack-scan] ── Complete (${Date.now() - t0}ms): ${result.suggested} suggested, ${result.tokensUsed} tokens, ${result.threadsScanned} scanned ──`);

    return result;
  }

  alarm = async (): Promise<void> => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isNearMidnight = now.getTime() - todayStart.getTime() < 60_000
      || (todayStart.getTime() + 86_400_000 - now.getTime()) < 60_000;

    // End-of-day archival (runs near midnight)
    if (isNearMidnight) {
      try {
        const count = await archiveCompletedTodos(this.ctx.storage);
        if (count > 0) {
          console.log(`[todos] Archived ${count} completed todo(s) at end of day`);
        }
      } catch (e) {
        console.error("[todos] End-of-day archive failed:", e);
      }
    }

    // Background inbox scan
    try {
      await this.runBackgroundScan();
    } catch (e) {
      console.error("[scan] Background scan failed:", e);
      void logMemoryEvent(this.ctx.storage, "codemode_error", `Background scan alarm failed: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
    }

    // Background Slack scan
    try {
      await this.runSlackScan();
    } catch (e) {
      console.error("[slack-scan] Background Slack scan failed:", e);
      void logMemoryEvent(this.ctx.storage, "codemode_error", `Slack scan alarm failed: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
    }

    // Schedule next alarm
    await this.scheduleScanAlarm();
  };
}
