import { generateText, type LanguageModel } from "ai";
import {
  loadTodos,
  loadArchivedTodos,
  loadPreferences,
  addSuggestedTodos,
  type TodoItem,
} from "./_todos";
import { logMemoryEvent, getMemoryEvents } from "./_memory";

export interface InboxEmail {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  accountEmail: string;
  isMailingList: boolean;
}

export interface ScanResult {
  suggested: number;
  tokensUsed: number;
  emailsScanned: number;
  skippedDuplicate: number;
}

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Fetch structured inbox emails for scanning (metadata only, no bodies).
 */
export async function fetchInboxEmails(
  tokens: { email: string; token: string }[],
  maxPerAccount = 8,
): Promise<InboxEmail[]> {
  if (tokens.length === 0) return [];

  const metaHeaders = ["From", "Subject", "Date", "List-Unsubscribe", "List-Id"]
    .map((h) => `metadataHeaders=${h}`)
    .join("&");

  const perAccount = await Promise.all(
    tokens.map(async ({ email, token }) => {
      const t0 = Date.now();
      try {
        console.log(`[inbox-scanner] Listing inbox for ${email}...`);
        const listRes = await fetch(
          `${GMAIL_BASE}/messages?q=in:inbox&maxResults=${maxPerAccount}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!listRes.ok) {
          console.log(`[inbox-scanner] List failed for ${email}: ${listRes.status} (${Date.now() - t0}ms)`);
          return [];
        }

        const listData = (await listRes.json()) as {
          messages?: { id: string; threadId: string }[];
        };
        if (!listData.messages?.length) {
          console.log(`[inbox-scanner] Empty inbox for ${email} (${Date.now() - t0}ms)`);
          return [];
        }
        console.log(`[inbox-scanner] ${listData.messages.length} message(s) for ${email} (${Date.now() - t0}ms), fetching metadata...`);

        const details = await Promise.all(
          listData.messages.map(async (msg) => {
            const res = await fetch(
              `${GMAIL_BASE}/messages/${msg.id}?format=metadata&${metaHeaders}`,
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
        console.log(`[inbox-scanner] Metadata fetched for ${email}: ${details.filter(Boolean).length}/${listData.messages.length} ok (${Date.now() - t0}ms)`);

        return details
          .filter((d): d is NonNullable<typeof d> => d !== null)
          .map((d): InboxEmail => {
            const getHeader = (name: string) =>
              d.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
            const hasListHeader = !!(getHeader("List-Unsubscribe") || getHeader("List-Id"));
            return {
              id: d.id,
              threadId: d.threadId,
              from: getHeader("From"),
              subject: getHeader("Subject"),
              snippet: d.snippet,
              date: new Date(Number(d.internalDate)).toISOString(),
              unread: d.labelIds?.includes("UNREAD") ?? false,
              accountEmail: email,
              isMailingList: hasListHeader,
            };
          });
      } catch (e) {
        console.error(`[inbox-scanner] Failed to fetch for ${email} (${Date.now() - t0}ms):`, e);
        return [];
      }
    }),
  );

  return perAccount.flat();
}

/**
 * Filter out emails that are already tracked by an active (pending/suggested)
 * or explicitly declined todo. Completed todos do NOT block re-suggestion —
 * the user may need a new action on the same email thread.
 */
function deduplicateEmails(
  emails: InboxEmail[],
  activeTodos: TodoItem[],
  archivedTodos: TodoItem[],
): { untracked: InboxEmail[]; skipped: number } {
  const trackedIds = new Set<string>();

  for (const todo of activeTodos) {
    if (todo.status === "completed") continue;
    for (const ref of todo.sourceEmails) {
      trackedIds.add(ref.messageId);
      trackedIds.add(ref.threadId);
    }
  }

  for (const todo of archivedTodos) {
    if (todo.userResponse !== "declined") continue;
    for (const ref of todo.sourceEmails) {
      trackedIds.add(ref.messageId);
      trackedIds.add(ref.threadId);
    }
  }

  const untracked = emails.filter(
    (e) => !trackedIds.has(e.id) && !trackedIds.has(e.threadId),
  );

  return { untracked, skipped: emails.length - untracked.length };
}

interface LLMSuggestion {
  title: string;
  description?: string;
  scheduledDate?: string;
  sourceEmailIndex: number;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

function extractName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : from.split("@")[0];
}

function extractDomain(from: string): string {
  const emailMatch = from.match(/@([^>]+)/);
  if (!emailMatch) return "";
  const domain = emailMatch[1].toLowerCase();
  const freeProviders = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "protonmail.com", "mail.com", "me.com"]);
  if (freeProviders.has(domain)) return "";
  return domain.split(".")[0];
}

function buildClassificationPrompt(
  emails: InboxEmail[],
  declinedPatterns: string[],
  acceptedPatterns: string[],
  userFeedback?: string[],
  existingTodoTitles?: string[],
): string {
  const emailList = emails
    .map((e, i) => {
      const name = extractName(e.from);
      const company = extractDomain(e.from);
      const tag = company ? `${name} (${company})` : name;
      return `[${i}] ${tag}${e.unread ? "*" : ""}: "${truncate(e.subject, 80)}" — ${truncate(e.snippet, 120)}`;
    })
    .join("\n");

  let notes = "";
  if (declinedPatterns.length > 0)
    notes += `\nAlways skip these: ${declinedPatterns.join(", ")}`;
  if (acceptedPatterns.length > 0)
    notes += `\nPrioritize these: ${acceptedPatterns.join(", ")}`;
  if (userFeedback && userFeedback.length > 0)
    notes += `\n\nLearn from the user's past feedback on your suggestions:\n${userFeedback.join("\n")}`;

  return `You are a strict email triage filter. Only flag emails that require a CONCRETE personal action.

CREATE a todo ONLY when the email:
- Comes from a real person or company contacting the user directly
- Requires a specific action: reply, approve, pay, sign, schedule, review, submit, RSVP, follow up
- Has a clear deliverable or deadline

ALWAYS SKIP (return nothing for these):
- Newsletters, digests, news roundups, article recommendations
- Marketing, promotions, sales, product announcements
- Automated notifications (GitHub, Slack, social media, shipping, login alerts)
- Receipts, order confirmations, subscription renewals (unless payment is failing)
- Mass emails, community updates, mailing list posts
- FYI/informational emails with no action needed
- Transactional emails (password resets, verification codes, welcome emails)
- Account provisioning, credits, welcome/onboarding emails
- Program enrollment confirmations

When in doubt, SKIP IT. Only surface emails the user would regret ignoring.${notes}${
    existingTodoTitles && existingTodoTitles.length > 0
      ? `\n\nThe user already has these todos — do NOT create duplicates or near-duplicates:\n${existingTodoTitles.map((t) => `- "${t}"`).join("\n")}`
      : ""
  }

Emails (* = unread):
${emailList}

CRITICAL: Every title you generate MUST reference ONLY names, companies, topics, and actions that actually appear in the corresponding email above. NEVER invent names, companies, or topics. If email [N] is from "Dad" about selling a car, the title must mention "Dad" and "car" — not unrelated people or topics.

Return JSON array. Each object MUST have:
- "title": The title IS the task. It should be self-contained and specific enough that the user knows exactly what to do without needing extra context. Use ONLY real names and topics from the source email.
- "sourceEmailIndex": N (the [N] index of the source email — double-check this matches)
- "description": ONLY include if there is essential context the title cannot convey (e.g. a specific dollar amount, a phone number, a deadline date). OMIT the description entirely for most items — the title should do all the work.
- "scheduledDate": "YYYY-MM-DD" if a deadline is mentioned, otherwise omit

BAD titles: "RSVP", "Reply to email", "Follow up", "Review document", "Check email from John"
GOOD titles: "Pay $109.26 Cursor invoice", "Reply to Dad re: selling 4Runner to Toyota dealer", "RSVP to Lisa's Q1 budget meeting (Friday)"

If none need action: []
JSON only:`;
}

/**
 * Check that a suggestion's title/description references content actually present
 * in the source email. Catches hallucinated names, companies, and topics.
 */
function validateSuggestionMatchesEmail(suggestion: LLMSuggestion, email: InboxEmail): boolean {
  const emailText = `${email.from} ${email.subject} ${email.snippet}`.toLowerCase();
  const emailWords = new Set(
    emailText
      .replace(/[^a-z0-9\s@.]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

  const titleWords = suggestion.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const stopWords = new Set([
    "the", "and", "for", "from", "about", "with", "that", "this", "has", "have",
    "will", "can", "into", "your", "their", "them", "they", "are", "was", "were",
    "been", "being", "not", "but", "all", "any", "its", "you", "our", "his", "her",
    "reply", "respond", "follow", "review", "check", "send", "rsvp", "approve",
    "sign", "pay", "submit", "schedule", "call", "email", "contact", "reach",
  ]);

  const meaningfulTitleWords = titleWords.filter((w) => !stopWords.has(w));
  if (meaningfulTitleWords.length === 0) return true;

  const matched = meaningfulTitleWords.filter((w) =>
    emailWords.has(w) || [...emailWords].some((ew) => ew.includes(w) || w.includes(ew)),
  );

  const ratio = matched.length / meaningfulTitleWords.length;

  if (ratio < 0.3) return false;

  return true;
}

function parseClassificationResponse(text: string): LLMSuggestion[] {
  try {
    const cleaned = text.replace(/^[^[]*/, "").replace(/[^\]]*$/, "");
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LLMSuggestion =>
        typeof item === "object" &&
        item !== null &&
        typeof item.title === "string" &&
        item.title.length > 0 &&
        typeof item.sourceEmailIndex === "number",
    );
  } catch {
    console.warn("[inbox-scanner] Failed to parse LLM classification response:", text.slice(0, 300));
    return [];
  }
}

/**
 * Main scanning entry point. Fetches inbox, deduplicates, classifies with LLM,
 * and writes suggested todos to storage.
 */
export async function scanInboxForTodos(
  storage: DurableObjectStorage,
  model: LanguageModel,
  tokens: { email: string; token: string }[],
  fallbackModel?: LanguageModel,
): Promise<ScanResult> {
  const t0 = Date.now();
  console.log(`[inbox-scanner] Fetching inbox emails for ${tokens.length} account(s)...`);

  const emails = await fetchInboxEmails(tokens);
  console.log(`[inbox-scanner] Fetched ${emails.length} email(s) (${Date.now() - t0}ms)`);

  if (emails.length === 0) {
    console.log(`[inbox-scanner] No emails in inbox, done (${Date.now() - t0}ms)`);
    return { suggested: 0, tokensUsed: 0, emailsScanned: 0, skippedDuplicate: 0 };
  }

  const [activeTodos, archivedTodos, prefs, memoryEvents] = await Promise.all([
    loadTodos(storage),
    loadArchivedTodos(storage),
    loadPreferences(storage),
    getMemoryEvents(storage).catch(() => [] as Array<{ type: string; detail: string }>),
  ]);
  console.log(`[inbox-scanner] Loaded ${activeTodos.length} active + ${archivedTodos.length} archived todos (${Date.now() - t0}ms)`);

  const todoFeedback = memoryEvents
    .filter((e) => e.type === "fact_extraction" && /User (edited todo title|accepted AI|declined AI)/.test(e.detail))
    .slice(-20)
    .map((e) => `- ${e.detail}`);

  const { untracked, skipped } = deduplicateEmails(emails, activeTodos, archivedTodos);
  console.log(`[inbox-scanner] Dedup: ${untracked.length} untracked, ${skipped} already tracked (${Date.now() - t0}ms)`);

  const NOREPLY_PATTERNS = /\b(noreply|no-reply|no_reply|donotreply|mailer-daemon|notifications?@|updates?@|news@|digest@|newsletter@|marketing@|promo@|announce@|info@)\b/i;
  const actionable = untracked.filter((e) => {
    if (e.isMailingList) return false;
    if (NOREPLY_PATTERNS.test(e.from)) return false;
    return true;
  });
  const filteredOut = untracked.length - actionable.length;
  if (filteredOut > 0)
    console.log(`[inbox-scanner] Pre-filtered ${filteredOut} mailing-list / noreply emails (${Date.now() - t0}ms)`);

  if (actionable.length === 0) {
    console.log(`[inbox-scanner] All remaining emails are mailing lists or already tracked, done (${Date.now() - t0}ms)`);
    return { suggested: 0, tokensUsed: 0, emailsScanned: emails.length, skippedDuplicate: skipped };
  }

  const BATCH_SIZE = 10;
  const batches: InboxEmail[][] = [];
  for (let i = 0; i < actionable.length; i += BATCH_SIZE) {
    batches.push(actionable.slice(i, i + BATCH_SIZE));
  }
  console.log(`[inbox-scanner] Processing ${actionable.length} email(s) in ${batches.length} batch(es) (${Date.now() - t0}ms)`);

  const existingTodoTitles = activeTodos
    .filter((t) => t.status !== "archived")
    .map((t) => t.title);

  let totalTokens = 0;
  const allSuggestions: { suggestion: LLMSuggestion; batchEmails: InboxEmail[] }[] = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const prompt = buildClassificationPrompt(batch, prefs.declinedPatterns, prefs.acceptedPatterns, todoFeedback, existingTodoTitles);
    console.log(`[inbox-scanner] Batch ${b + 1}/${batches.length}: ${batch.length} emails, ${prompt.length} chars, calling LLM... (${Date.now() - t0}ms)`);

    const modelsToTry = fallbackModel ? [model, fallbackModel] : [model];

    for (let m = 0; m < modelsToTry.length; m++) {
      const currentModel = modelsToTry[m];
      try {
        const result = await generateText({
          model: currentModel,
          system: "You are an email triage assistant. Return only valid JSON.",
          prompt,
          abortSignal: AbortSignal.timeout(25_000),
        });

        const batchTokens = result.usage?.totalTokens ?? 0;
        totalTokens += batchTokens;
        const parsed = parseClassificationResponse(result.text);
        console.log(`[inbox-scanner] Batch ${b + 1} done${m > 0 ? " (fallback model)" : ""} (${Date.now() - t0}ms): ${parsed.length} suggestion(s), ${batchTokens} tokens`);

        for (const s of parsed) {
          if (s.sourceEmailIndex >= 0 && s.sourceEmailIndex < batch.length) {
            allSuggestions.push({ suggestion: s, batchEmails: batch });
          }
        }
        break;
      } catch (e) {
        const isTimeout = e instanceof DOMException && e.name === "TimeoutError";
        const isLastModel = m === modelsToTry.length - 1;
        if (!isLastModel) {
          console.warn(`[inbox-scanner] Batch ${b + 1} primary model failed (${Date.now() - t0}ms), retrying with fallback...`);
          continue;
        }
        console.error(`[inbox-scanner] Batch ${b + 1} ${isTimeout ? "timed out (25s)" : "failed"} (${Date.now() - t0}ms):`, isTimeout ? "" : e);
        void logMemoryEvent(storage, "codemode_error", `Scan batch ${b + 1} failed: ${e instanceof Error ? e.message : String(e)}`, {
          batchSize: batch.length,
          error: e instanceof Error ? e.message : String(e),
        }).catch(() => {});
      }
    }
  }

  if (allSuggestions.length === 0) {
    console.log(`[inbox-scanner] No actionable items found across all batches, done (${Date.now() - t0}ms)`);
    return { suggested: 0, tokensUsed: totalTokens, emailsScanned: emails.length, skippedDuplicate: skipped };
  }

  const validated = allSuggestions.filter(({ suggestion: s, batchEmails }) => {
    const email = batchEmails[s.sourceEmailIndex];
    if (!validateSuggestionMatchesEmail(s, email)) {
      console.warn(`[inbox-scanner] Discarding hallucinated suggestion: "${s.title}" (source email from ${extractName(email.from)}: "${truncate(email.subject, 60)}")`);
      return false;
    }
    return true;
  });

  if (validated.length < allSuggestions.length) {
    console.log(`[inbox-scanner] Validation filtered ${allSuggestions.length - validated.length}/${allSuggestions.length} suggestions (${Date.now() - t0}ms)`);
  }

  if (validated.length === 0) {
    console.log(`[inbox-scanner] All suggestions failed validation, done (${Date.now() - t0}ms)`);
    return { suggested: 0, tokensUsed: totalTokens, emailsScanned: emails.length, skippedDuplicate: skipped };
  }

  const todoSuggestions = validated.map(({ suggestion: s, batchEmails }) => {
    const email = batchEmails[s.sourceEmailIndex];
    return {
      title: s.title,
      description: s.description,
      scheduledDate: s.scheduledDate,
      sourceEmail: {
        messageId: email.id,
        threadId: email.threadId,
        subject: email.subject,
        from: email.from,
        snippet: email.snippet,
        accountEmail: email.accountEmail,
      },
    };
  });

  console.log(`[inbox-scanner] Writing ${todoSuggestions.length} suggestion(s) to storage... (${Date.now() - t0}ms)`);
  const created = await addSuggestedTodos(storage, todoSuggestions);

  void logMemoryEvent(storage, "fact_extraction", `Background scan: ${created.length} todo(s) suggested from ${actionable.length} emails (${filteredOut} auto-filtered)`, {
    suggested: created.length,
    tokensUsed: totalTokens,
    emailsScanned: emails.length,
    skippedDuplicate: skipped,
  }).catch(() => {});

  console.log(`[inbox-scanner] Done (${Date.now() - t0}ms): ${created.length} created`);

  return {
    suggested: created.length,
    tokensUsed: totalTokens,
    emailsScanned: emails.length,
    skippedDuplicate: skipped,
  };
}
