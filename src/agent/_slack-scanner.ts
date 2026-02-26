import { generateText, type LanguageModel } from "ai";
import {
  loadTodos,
  loadArchivedTodos,
  loadPreferences,
  loadCategories,
  addSuggestedTodos,
  type TodoItem,
  type TodoSlackRef,
} from "./_todos";
import { logMemoryEvent, getMemoryEvents } from "./_memory";
import {
  loadUnprocessedThreads,
  markThreadsProcessed,
  type SlackThread,
} from "./_slack-storage";

export interface SlackScanResult {
  suggested: number;
  tokensUsed: number;
  threadsScanned: number;
  skippedDuplicate: number;
  skipped?: string;
}

function deduplicateThreads(
  threads: SlackThread[],
  activeTodos: TodoItem[],
  archivedTodos: TodoItem[],
): { untracked: SlackThread[]; skipped: number } {
  const trackedKeys = new Set<string>();

  for (const todo of [...activeTodos, ...archivedTodos]) {
    if (todo.sourceSlack) {
      for (const ref of todo.sourceSlack) {
        trackedKeys.add(`${ref.channelId}:${ref.threadTs}`);
      }
    }
  }

  const untracked = threads.filter(
    (t) => !trackedKeys.has(`${t.channelId}:${t.threadTs}`),
  );

  return { untracked, skipped: threads.length - untracked.length };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

function buildSlackClassificationPrompt(
  threads: SlackThread[],
  declinedPatterns: string[],
  acceptedPatterns: string[],
  existingCategories: string[],
  userFeedback?: string[],
): string {
  const threadList = threads
    .map((t, i) => {
      const channel = t.channelName ? `#${t.channelName}` : t.channelId;
      const participants = [...new Set(t.messages.map((m) => m.userName))].join(", ");
      const conversation = t.messages
        .map((m) => `  ${m.userName}: ${truncate(m.text, 150)}`)
        .join("\n");
      return `[${i}] ${channel} — participants: ${participants}\n${conversation}`;
    })
    .join("\n\n");

  let notes = "";
  if (declinedPatterns.length > 0)
    notes += `\nAlways skip these: ${declinedPatterns.join(", ")}`;
  if (acceptedPatterns.length > 0)
    notes += `\nPrioritize these: ${acceptedPatterns.join(", ")}`;
  if (userFeedback && userFeedback.length > 0)
    notes += `\n\nLearn from the user's past feedback on your suggestions:\n${userFeedback.join("\n")}`;

  const categoryNote = existingCategories.length > 0
    ? `\n\nThe user's existing categories: ${existingCategories.join(", ")}. Prefer assigning from these when relevant. You may suggest a new short category if none fit.`
    : `\n\nNo categories exist yet. You may suggest 1-2 short, lowercase category labels if appropriate (e.g. "work", "design", "eng").`;

  return `You are a strict Slack conversation triage filter. Only flag conversations that require a CONCRETE personal action from the user.

CREATE a todo ONLY when the conversation:
- Contains a direct request or question that needs a personal response
- Involves a task assignment, action item, or deliverable for the user
- Mentions a deadline, meeting, or scheduling need
- Requires a decision, review, or approval from the user

ALWAYS SKIP (return nothing for these):
- General channel chatter with no action needed
- Announcements or FYI messages
- Automated bot messages or notifications
- Conversations already resolved
- Social/casual chat
- Status updates that don't require action

When in doubt, SKIP IT. Only surface conversations the user would regret ignoring.${notes}${categoryNote}

Slack threads (the user's bot was @mentioned in each):
${threadList}

Return JSON array. Each object MUST have:
- "title": A descriptive action including WHO and WHAT, e.g. "Reply to Sarah's design review request in #product", "Follow up with Mike on deployment timeline"
- "sourceThreadIndex": N (the [N] index of the source thread)
- "description": 1 sentence with specific context (mention names, topics, or details from the conversation)
- "categories": array of 1-2 category labels (use existing categories when possible)
- "scheduledDate": "YYYY-MM-DD" if a deadline is mentioned, otherwise omit

BAD titles: "Check Slack", "Reply to thread", "Follow up"
GOOD titles: "Reply to Sarah in #product about API design review", "Schedule sync with Mike re: deployment blockers"

If none need action: []
JSON only:`;
}

function parseClassificationResponse(text: string): Array<{
  title: string;
  description?: string;
  scheduledDate?: string;
  categories?: string[];
  sourceThreadIndex: number;
}> {
  try {
    const cleaned = text.replace(/^[^[]*/, "").replace(/[^\]]*$/, "");
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is { title: string; description?: string; scheduledDate?: string; categories?: string[]; sourceThreadIndex: number } =>
        typeof item === "object" &&
        item !== null &&
        typeof item.title === "string" &&
        item.title.length > 0 &&
        typeof item.sourceThreadIndex === "number",
    );
  } catch {
    console.warn("[slack-scanner] Failed to parse LLM classification response:", text.slice(0, 300));
    return [];
  }
}

export async function scanSlackForTodos(
  storage: DurableObjectStorage,
  model: LanguageModel,
  fallbackModel?: LanguageModel,
): Promise<SlackScanResult> {
  const t0 = Date.now();
  console.log("[slack-scanner] Starting Slack thread scan...");

  const threads = await loadUnprocessedThreads(storage);
  console.log(`[slack-scanner] Found ${threads.length} unprocessed thread(s) (${Date.now() - t0}ms)`);

  if (threads.length === 0) {
    return { suggested: 0, tokensUsed: 0, threadsScanned: 0, skippedDuplicate: 0 };
  }

  const [activeTodos, archivedTodos, prefs, existingCategories, memoryEvents] = await Promise.all([
    loadTodos(storage),
    loadArchivedTodos(storage),
    loadPreferences(storage),
    loadCategories(storage),
    getMemoryEvents(storage).catch(() => [] as Array<{ type: string; detail: string }>),
  ]);

  const todoFeedback = memoryEvents
    .filter((e) => e.type === "fact_extraction" && /User (edited todo title|accepted AI|declined AI)/.test(e.detail))
    .slice(-20)
    .map((e) => `- ${e.detail}`);

  const { untracked, skipped } = deduplicateThreads(threads, activeTodos, archivedTodos);
  console.log(`[slack-scanner] Dedup: ${untracked.length} untracked, ${skipped} already tracked (${Date.now() - t0}ms)`);

  if (untracked.length === 0) {
    await markThreadsProcessed(
      storage,
      threads.map((t) => ({ channelId: t.channelId, threadTs: t.threadTs })),
    );
    return { suggested: 0, tokensUsed: 0, threadsScanned: threads.length, skippedDuplicate: skipped };
  }

  const BATCH_SIZE = 10;
  const batches: SlackThread[][] = [];
  for (let i = 0; i < untracked.length; i += BATCH_SIZE) {
    batches.push(untracked.slice(i, i + BATCH_SIZE));
  }

  let totalTokens = 0;
  const allSuggestions: Array<{
    title: string;
    description?: string;
    scheduledDate?: string;
    categories?: string[];
    thread: SlackThread;
  }> = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const prompt = buildSlackClassificationPrompt(
      batch,
      prefs.declinedPatterns,
      prefs.acceptedPatterns,
      existingCategories,
      todoFeedback,
    );
    console.log(`[slack-scanner] Batch ${b + 1}/${batches.length}: ${batch.length} threads, calling LLM... (${Date.now() - t0}ms)`);

    const modelsToTry = fallbackModel ? [model, fallbackModel] : [model];

    for (let m = 0; m < modelsToTry.length; m++) {
      const currentModel = modelsToTry[m];
      try {
        const result = await generateText({
          model: currentModel,
          system: "You are a Slack conversation triage assistant. Return only valid JSON.",
          prompt,
          abortSignal: AbortSignal.timeout(25_000),
        });

        const batchTokens = result.usage?.totalTokens ?? 0;
        totalTokens += batchTokens;
        const parsed = parseClassificationResponse(result.text);
        console.log(`[slack-scanner] Batch ${b + 1} done${m > 0 ? " (fallback model)" : ""} (${Date.now() - t0}ms): ${parsed.length} suggestion(s), ${batchTokens} tokens`);

        for (const s of parsed) {
          if (s.sourceThreadIndex >= 0 && s.sourceThreadIndex < batch.length) {
            allSuggestions.push({
              title: s.title,
              description: s.description,
              scheduledDate: s.scheduledDate,
              categories: s.categories,
              thread: batch[s.sourceThreadIndex],
            });
          }
        }
        break;
      } catch (e) {
        const isTimeout = e instanceof DOMException && e.name === "TimeoutError";
        const isLastModel = m === modelsToTry.length - 1;
        if (!isLastModel) {
          console.warn(`[slack-scanner] Batch ${b + 1} primary model failed (${Date.now() - t0}ms), retrying with fallback...`);
          continue;
        }
        console.error(`[slack-scanner] Batch ${b + 1} ${isTimeout ? "timed out (25s)" : "failed"} (${Date.now() - t0}ms):`, isTimeout ? "" : e);
        void logMemoryEvent(storage, "codemode_error", `Slack scan batch ${b + 1} failed: ${e instanceof Error ? e.message : String(e)}`, {
          batchSize: batch.length,
          error: e instanceof Error ? e.message : String(e),
        }).catch(() => {});
      }
    }
  }

  // Mark all threads as processed regardless of whether they generated suggestions
  await markThreadsProcessed(
    storage,
    threads.map((t) => ({ channelId: t.channelId, threadTs: t.threadTs })),
  );

  if (allSuggestions.length === 0) {
    console.log(`[slack-scanner] No actionable items found, done (${Date.now() - t0}ms)`);
    return { suggested: 0, tokensUsed: totalTokens, threadsScanned: threads.length, skippedDuplicate: skipped };
  }

  const todoSuggestions = allSuggestions.map(({ title, description, scheduledDate, categories, thread }) => {
    const triggerMsg = thread.messages.find((m) => m.ts === thread.triggerMessageTs) ?? thread.messages[0];
    const sourceSlack: TodoSlackRef = {
      channelId: thread.channelId,
      threadTs: thread.threadTs,
      messageTs: thread.triggerMessageTs,
      from: triggerMsg?.userName ?? "Unknown",
      text: truncate(triggerMsg?.text ?? "", 200),
      channelName: thread.channelName,
    };
    return { title, description, scheduledDate, categories, sourceSlack };
  });

  console.log(`[slack-scanner] Writing ${todoSuggestions.length} suggestion(s) to storage... (${Date.now() - t0}ms)`);
  const created = await addSuggestedTodos(storage, todoSuggestions);

  void logMemoryEvent(
    storage,
    "fact_extraction",
    `Slack scan: ${created.length} todo(s) suggested from ${untracked.length} threads`,
    { suggested: created.length, tokensUsed: totalTokens, threadsScanned: threads.length, skippedDuplicate: skipped },
  ).catch(() => {});

  console.log(`[slack-scanner] Done (${Date.now() - t0}ms): ${created.length} created`);

  return {
    suggested: created.length,
    tokensUsed: totalTokens,
    threadsScanned: threads.length,
    skippedDuplicate: skipped,
  };
}
