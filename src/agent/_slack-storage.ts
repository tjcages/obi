export interface SlackMessage {
  userId: string;
  userName: string;
  text: string;
  ts: string;
}

export interface SlackThread {
  channelId: string;
  threadTs: string;
  channelName?: string;
  triggerMessageTs: string;
  messages: SlackMessage[];
  receivedAt: string;
  processed: boolean;
}

export interface SlackConfig {
  enabled: boolean;
  botUserId?: string;
}

const STORAGE_KEY_THREADS = "slack:threads";
const STORAGE_KEY_CONFIG = "slack:config";

const MAX_STORED_THREADS = 200;
const MAX_MESSAGES_PER_THREAD = 50;

export async function loadSlackConfig(
  storage: DurableObjectStorage,
): Promise<SlackConfig> {
  return (await storage.get<SlackConfig>(STORAGE_KEY_CONFIG)) ?? { enabled: true };
}

export async function saveSlackConfig(
  storage: DurableObjectStorage,
  config: SlackConfig,
): Promise<void> {
  await storage.put(STORAGE_KEY_CONFIG, config);
}

async function loadThreads(
  storage: DurableObjectStorage,
): Promise<SlackThread[]> {
  return (await storage.get<SlackThread[]>(STORAGE_KEY_THREADS)) ?? [];
}

async function saveThreads(
  storage: DurableObjectStorage,
  threads: SlackThread[],
): Promise<void> {
  await storage.put(STORAGE_KEY_THREADS, threads.slice(-MAX_STORED_THREADS));
}

function threadKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

export async function storeSlackThread(
  storage: DurableObjectStorage,
  thread: Omit<SlackThread, "processed">,
): Promise<void> {
  const threads = await loadThreads(storage);
  const key = threadKey(thread.channelId, thread.threadTs);
  const idx = threads.findIndex(
    (t) => threadKey(t.channelId, t.threadTs) === key,
  );

  if (idx >= 0) {
    const existing = threads[idx];
    const seenTs = new Set(existing.messages.map((m) => m.ts));
    for (const msg of thread.messages) {
      if (!seenTs.has(msg.ts)) {
        existing.messages.push(msg);
        seenTs.add(msg.ts);
      }
    }
    existing.messages = existing.messages.slice(-MAX_MESSAGES_PER_THREAD);
    existing.processed = false;
  } else {
    threads.push({ ...thread, processed: false });
  }

  await saveThreads(storage, threads);
}

export async function appendSlackMessage(
  storage: DurableObjectStorage,
  channelId: string,
  threadTs: string,
  message: SlackMessage,
): Promise<void> {
  const threads = await loadThreads(storage);
  const key = threadKey(channelId, threadTs);
  const thread = threads.find(
    (t) => threadKey(t.channelId, t.threadTs) === key,
  );

  if (!thread) return;

  if (!thread.messages.some((m) => m.ts === message.ts)) {
    thread.messages.push(message);
    thread.messages = thread.messages.slice(-MAX_MESSAGES_PER_THREAD);
    thread.processed = false;
    await saveThreads(storage, threads);
  }
}

export async function loadUnprocessedThreads(
  storage: DurableObjectStorage,
): Promise<SlackThread[]> {
  const threads = await loadThreads(storage);
  return threads.filter((t) => !t.processed);
}

export async function markThreadsProcessed(
  storage: DurableObjectStorage,
  keys: Array<{ channelId: string; threadTs: string }>,
): Promise<void> {
  const threads = await loadThreads(storage);
  const keySet = new Set(keys.map((k) => threadKey(k.channelId, k.threadTs)));

  for (const thread of threads) {
    if (keySet.has(threadKey(thread.channelId, thread.threadTs))) {
      thread.processed = true;
    }
  }

  await saveThreads(storage, threads);
}

export async function loadAllSlackThreads(
  storage: DurableObjectStorage,
): Promise<SlackThread[]> {
  return loadThreads(storage);
}
