import type { Chat } from "chat";
import type { SlackMessage } from "../agent/_slack-storage";

interface SlackContext {
  storeThread: (data: {
    channelId: string;
    threadTs: string;
    channelName?: string;
    triggerMessageTs: string;
    messages: SlackMessage[];
  }) => Promise<void>;
  appendMessage: (
    channelId: string,
    threadTs: string,
    message: SlackMessage,
  ) => Promise<void>;
}

let _context: SlackContext | null = null;
let _botPromise: Promise<Chat> | null = null;
let _credentials: { botToken: string; signingSecret: string } | null = null;

export function setSlackContext(ctx: SlackContext): void {
  _context = ctx;
}

export function clearSlackContext(): void {
  _context = null;
}

function getContext(): SlackContext {
  if (!_context) throw new Error("Slack context not set — call setSlackContext() before handling webhooks");
  return _context;
}

/**
 * Thread IDs in Chat SDK follow the format "slack:CHANNEL_ID:THREAD_TS"
 */
function extractChannelId(threadId: string): string {
  const parts = threadId.split(":");
  return parts[1] ?? threadId;
}

function extractThreadTs(threadId: string): string | undefined {
  const parts = threadId.split(":");
  return parts[2];
}

/**
 * Lazily initialize the Chat SDK bot on first use. Uses dynamic imports
 * to avoid calling `createSlackAdapter()` / `createMemoryState()` at module
 * load time, which would fail during Vite's transform phase before the
 * Cloudflare Worker runtime (miniflare) is ready.
 */
export function getSlackBot(creds: { botToken: string; signingSecret: string }): Promise<Chat> {
  if (!_credentials || _credentials.botToken !== creds.botToken || _credentials.signingSecret !== creds.signingSecret) {
    _credentials = creds;
    _botPromise = null;
  }
  if (_botPromise) return _botPromise;

  _botPromise = initBot(creds);
  return _botPromise;
}

async function initBot(creds: { botToken: string; signingSecret: string }): Promise<Chat> {
  const [{ Chat: ChatClass, emoji }, { createSlackAdapter }, { createMemoryState }] = await Promise.all([
    import("chat"),
    import("@chat-adapter/slack"),
    import("@chat-adapter/state-memory"),
  ]);

  const bot = new ChatClass({
    userName: "obi",
    adapters: {
      slack: createSlackAdapter({
        botToken: creds.botToken,
        signingSecret: creds.signingSecret,
      }),
    },
    state: createMemoryState(),
  });

  bot.onNewMention(async (thread, message) => {
    if (message.author.isMe) return;
    const ctx = getContext();
    const adapter = bot.getAdapter("slack");

    try {
      await adapter.addReaction(thread.id, message.id, emoji.eyes);
    } catch {
      // Reaction may fail if bot lacks permissions — non-critical
    }

    const threadTs = extractThreadTs(thread.id) ?? message.id;

    try {
      await ctx.storeThread({
        channelId: extractChannelId(thread.id),
        threadTs,
        triggerMessageTs: message.id,
        messages: [
          {
            userId: message.author.userId,
            userName: message.author.userName || message.author.fullName || "Unknown",
            text: message.text ?? "",
            ts: message.id,
          },
        ],
      });

      await thread.subscribe();

      await adapter.addReaction(thread.id, message.id, emoji.check);
    } catch (e) {
      console.error("[slack-bot] Failed to store thread:", e);
      try {
        await adapter.addReaction(thread.id, message.id, "sos");
      } catch {
        // ignore
      }
    }
  });

  bot.onSubscribedMessage(async (thread, message) => {
    if (message.author.isMe) return;
    const ctx = getContext();

    const threadTs = extractThreadTs(thread.id) ?? message.id;

    try {
      await ctx.appendMessage(
        extractChannelId(thread.id),
        threadTs,
        {
          userId: message.author.userId,
          userName: message.author.userName || message.author.fullName || "Unknown",
          text: message.text ?? "",
          ts: message.id,
        },
      );
    } catch (e) {
      console.error("[slack-bot] Failed to append message:", e);
    }
  });

  return bot;
}
