/**
 * Minimal Gmail surface for Code Mode: only gmail_get and gmail_post.
 * Supports multiple accounts -- the model specifies which account to use.
 */
import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

const MAX_API_CALLS_PER_EXECUTION = 10;
const MAX_BODY_CHARS = 3000;
const MAX_LIST_ITEMS = 100;
const KEEP_HEADERS = new Set(["subject", "from", "to", "cc", "bcc", "date", "message-id", "in-reply-to", "references"]);

export interface AccountToken {
  email: string;
  token: string;
  label?: string;
}

/**
 * Lightweight sanitization applied to every Gmail API response BEFORE it enters
 * the codemode executor. This prevents 50KB+ HTML bodies from accumulating
 * inside the Worker isolate and causing segfaults.
 */
function sanitizeGmailResponse(obj: unknown): unknown {
  if (typeof obj === "string") {
    if (obj.length > MAX_BODY_CHARS) {
      return obj.slice(0, MAX_BODY_CHARS) + `\n... [TRUNCATED: ${obj.length} chars total]`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    const capped = obj.length > MAX_LIST_ITEMS ? obj.slice(0, MAX_LIST_ITEMS) : obj;
    return capped.map(sanitizeGmailResponse);
  }
  if (obj !== null && typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec)) {
      if (key === "messages" && Array.isArray(rec[key]) && (rec[key] as unknown[]).length > MAX_LIST_ITEMS) {
        const arr = rec[key] as unknown[];
        out[key] = arr.slice(0, MAX_LIST_ITEMS).map(sanitizeGmailResponse);
        out._truncatedMessages = arr.length;
      } else if (key === "headers" && Array.isArray(rec[key])) {
        out[key] = (rec[key] as { name?: string }[])
          .filter((h) => h?.name && KEEP_HEADERS.has(h.name.toLowerCase()));
      } else if (key === "data" && typeof rec[key] === "string") {
        try {
          const b64 = (rec[key] as string).replace(/-/g, "+").replace(/_/g, "/");
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          let decoded = new TextDecoder().decode(bytes);
          // Strip HTML tags to extract readable text, drastically reducing size
          decoded = decoded.replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#\d+;/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
          if (decoded.length > MAX_BODY_CHARS) {
            decoded = decoded.slice(0, MAX_BODY_CHARS) + `\n... [TRUNCATED: ${decoded.length} chars total]`;
          }
          out[key] = decoded;
        } catch {
          out[key] = sanitizeGmailResponse(rec[key]);
        }
      } else {
        out[key] = sanitizeGmailResponse(rec[key]);
      }
    }
    return out;
  }
  return obj;
}

async function gmailApi(
  token: string,
  path: string,
  callCounter: { count: number },
  opts?: { method?: string; body?: unknown },
): Promise<unknown> {
  callCounter.count++;
  if (callCounter.count > MAX_API_CALLS_PER_EXECUTION) {
    throw new Error(
      `API call limit exceeded (max ${MAX_API_CALLS_PER_EXECUTION} per execution). ` +
      `Use batch endpoints or split into separate codemode calls.`,
    );
  }

  const clampedPath = path.replace(
    /maxResults=(\d+)/,
    (_m, n) => `maxResults=${Math.min(parseInt(n, 10), MAX_LIST_ITEMS)}`,
  );

  const res = await fetch(`${GMAIL_BASE}${clampedPath}`, {
    method: opts?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Gmail API ${res.status}: ${text}`);
    console.error("[gmail_api]", res.status, path, text.slice(0, 500));
    throw err;
  }
  const json = await res.json();
  return sanitizeGmailResponse(json);
}

function resolveToken(accounts: AccountToken[], account?: string): string {
  if (accounts.length === 1) return accounts[0].token;
  if (!account) {
    if (accounts.length === 0) throw new Error("No Gmail accounts available");
    return accounts[0].token;
  }
  const match = accounts.find(
    (a) => a.email === account || a.label === account,
  );
  if (!match) {
    throw new Error(
      `Account "${account}" not found. Available: ${accounts.map((a) => a.email).join(", ")}`,
    );
  }
  return match.token;
}

export function createGmailTools(accounts: AccountToken[]): { tools: ToolSet; resetCallCounter: () => void };
export function createGmailTools(accessToken: string): { tools: ToolSet; resetCallCounter: () => void };
export function createGmailTools(input: string | AccountToken[]): { tools: ToolSet; resetCallCounter: () => void } {
  const callCounter = { count: 0 };
  const accountsList: AccountToken[] = typeof input === "string"
    ? [{ email: "default", token: input }]
    : input;

  const multiAccount = accountsList.length > 1;

  const gmailGetSchema = multiAccount
    ? z.object({
        path: z.string().describe("Path relative to /gmail/v1/users/me"),
        account: z.string().optional().describe("Email address of the account to query. Required when multiple accounts are connected."),
      })
    : z.object({
        path: z.string().describe("Path relative to /gmail/v1/users/me (e.g. /profile, /messages?q=in:inbox&maxResults=10)"),
      });

  const gmailPostSchema = multiAccount
    ? z.object({
        path: z.string().describe("Path relative to /gmail/v1/users/me (e.g. /messages/send)"),
        body: z.record(z.string(), z.unknown()).describe("JSON body for the POST request"),
        account: z.string().optional().describe("Email address of the account to use. Required when multiple accounts are connected."),
      })
    : z.object({
        path: z.string().describe("Path relative to /gmail/v1/users/me (e.g. /messages/send)"),
        body: z.record(z.string(), z.unknown()).describe("JSON body for the POST request"),
      });

  return {
    tools: {
      gmail_get: tool({
        description: multiAccount
          ? "GET from Gmail REST API. Path is relative to /gmail/v1/users/me. Specify 'account' (email address) when multiple accounts are connected."
          : "GET from Gmail REST API. Path is relative to /gmail/v1/users/me.",
        inputSchema: gmailGetSchema,
        execute: async (input: { path: string; account?: string }) => {
          const token = resolveToken(accountsList, input.account);
          return gmailApi(token, input.path.startsWith("/") ? input.path : `/${input.path}`, callCounter);
        },
      }),
      gmail_post: tool({
        description: multiAccount
          ? "POST to Gmail REST API. Path is relative to /gmail/v1/users/me. Specify 'account' (email address) when multiple accounts are connected."
          : "POST to Gmail REST API. Path is relative to /gmail/v1/users/me.",
        inputSchema: gmailPostSchema,
        execute: async (input: { path: string; body: Record<string, unknown>; account?: string }) => {
          const token = resolveToken(accountsList, input.account);
          return gmailApi(token, input.path.startsWith("/") ? input.path : `/${input.path}`, callCounter, { method: "POST", body: input.body });
        },
      }),
    },
    resetCallCounter: () => { callCounter.count = 0; },
  };
}
