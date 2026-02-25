/**
 * Single Worker: routeAgentRequest for /agents/*, auth routes, then ASSETS.
 */
import { InboxDog } from "inbox.dog";
import { routeAgentRequest } from "agents";
import { InboxAgent, createGmailTools } from "./agent";
import { ScheduledSender } from "./scheduled-sender";
import { getSlackBot, setSlackContext, clearSlackContext } from "./services/_slack-bot";
import {
  getCookie,
  setCookie,
  clearCookie,
  DEFAULT_CONVERSATION_ID,
  normalizeConversationId,
  toConversationRoomName,
  pickDefaultColor,
  fetchGoogleProfile,
  type ConnectedAccount,
} from "./lib";

interface Env {
  INBOX_AGENT: DurableObjectNamespace;
  SCHEDULED_SENDER: DurableObjectNamespace;
  ASSETS: Fetcher;
  INBOX_DOG: Fetcher;
  LOADER: WorkerLoader;
  WORKSPACE_FILES: R2Bucket;
  INBOX_DOG_CLIENT_ID: string;
  INBOX_DOG_CLIENT_SECRET: string;
  /** Set in dev/.dev.vars for E2E; required for POST /api/test/inject-session */
  TEST_INJECT_SECRET?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_SIGNING_SECRET?: string;
}

interface GmailSession {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  email: string;
}

export { InboxAgent, ScheduledSender };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle auth and API routes first so our code runs and we can log
    if (path === "/callback") {
      return handleCallback(request, env, url);
    }
    if (path === "/logout") {
      return handleLogout();
    }
    if (path === "/api/auth-url") {
      return handleAuthUrl(env, url);
    }
    if (path === "/api/me") {
      return handleMe(request);
    }

    if (path === "/api/webhooks/slack" && env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET) {
      return handleSlackWebhook(request, env, ctx);
    }
    
    // DEV BACKDOOR for testing endpoints directly against active session (guarded so prod without TEST_INJECT_SECRET has no access)
    if (path === "/api/dev/exec" && request.method === "POST" && env.TEST_INJECT_SECRET) {
      try {
        const body = await request.json() as { userId: string, code: string };
        const id = env.INBOX_AGENT.idFromName(body.userId);
        const stub = env.INBOX_AGENT.get(id);
        const sessionRes = await stub.fetch(
          new Request("http://localhost/session", {
            method: "GET",
            headers: { "x-partykit-room": body.userId },
          })
        );
        if (!sessionRes.ok) return new Response("No session", { status: 404 });
        const session = await sessionRes.json() as GmailSession;
        if (!session.access_token) return new Response("No token", { status: 401 });
        
        let token = session.access_token;
        const testRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${token}` } });
        if (testRes.status === 401 && session.refresh_token) {
          const dog = new InboxDog();
          const refreshed = await dog.refreshToken(session.refresh_token, session.client_id, session.client_secret);
          token = refreshed.access_token;
        }

        const { tools: gmailTools } = createGmailTools(token);
        const { DynamicWorkerExecutor } = await import("@cloudflare/codemode");
        const { createCodeTool } = await import("@cloudflare/codemode/ai");
        const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
        const codemodeInner = createCodeTool({ tools: gmailTools, executor }) as unknown as { execute: (x: { code: string }) => Promise<unknown> };
        const res = await codemodeInner.execute({ code: body.code });
        return Response.json({ success: true, result: res });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }
    if (path === "/api/inbox") {
      return handleInbox(request, env);
    }
    if (path.startsWith("/api/threads/") && path.endsWith("/archive") && request.method === "POST") {
      return handleArchiveThread(request, env, path);
    }
    if (path.startsWith("/api/threads/") && path.endsWith("/unarchive") && request.method === "POST") {
      return handleUnarchiveThread(request, env, path);
    }
    if (path.startsWith("/api/threads/") && path.endsWith("/reply") && request.method === "POST") {
      return handleReplyToThread(request, env, path);
    }
    if (path.startsWith("/api/threads/") && path.endsWith("/forward") && request.method === "POST") {
      return handleForwardThread(request, env, path);
    }
    if (path.startsWith("/api/threads/") && path.endsWith("/schedule") && request.method === "POST") {
      return handleScheduleSend(request, env, path);
    }
    if (path === "/api/scheduled" && request.method === "GET") {
      return handleListScheduled(request, env);
    }
    if (path === "/api/scheduled/cancel" && request.method === "POST") {
      return handleCancelScheduled(request, env);
    }
    if (path.startsWith("/api/threads/")) {
      return handleGetThread(request, env, path);
    }
    if (path.startsWith("/api/messages/")) {
      return handleGetMessage(request, env, path);
    }
    if (path === "/api/validate-tokens") {
      return handleValidateTokens(request, env);
    }
    if (path === "/api/chat/session" && request.method === "POST") {
      return handleEnsureConversationSession(request, env);
    }
    if (path === "/api/test/inject-session" && request.method === "POST" && env.TEST_INJECT_SECRET) {
      return handleTestInjectSession(request, env);
    }

    if (path === "/api/email-diagnostics") {
      return handleEmailDiagnosticsProxy(request, env);
    }

    if (path.startsWith("/api/workspace")) {
      return handleWorkspaceProxy(request, env, path);
    }

    if (path.startsWith("/api/todos")) {
      return handleTodosProxy(request, env, path);
    }

    if (path === "/api/contacts") {
      return handleContacts(request, env, ctx);
    }

    if (path === "/api/contacts/search") {
      return handleContactSearch(request, env);
    }

    if (path === "/api/emails/search") {
      return handleEmailSearch(request, env);
    }

    if (path.startsWith("/api/scan")) {
      return handleScanProxy(request, env, path);
    }

    if (path.startsWith("/api/memory") || path.startsWith("/api/settings")) {
      return handleMemoryProxy(request, env, path);
    }

    if (path.startsWith("/api/accounts")) {
      return handleAccountsProxy(request, env, path);
    }

    if (path.startsWith("/api/attachments/")) {
      return handleGetAttachment(request, env, path);
    }

    if (path === "/api/link-preview") {
      return handleLinkPreview(request);
    }

    const agentRes = await routeAgentRequest(request, env, { cors: true });
    if (agentRes) return agentRes;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handleCallback(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  const cid = env.INBOX_DOG_CLIENT_ID;
  const csec = env.INBOX_DOG_CLIENT_SECRET;

  if (err || !code) {
    return redirect(`/?error=${encodeURIComponent(err ?? "invalid")}`);
  }
  if (!cid || !csec) {
    return redirect(`/?error=${encodeURIComponent("missing credentials")}`);
  }

  const tokenRes = await fetch("https://inbox.dog/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      client_id: cid,
      client_secret: csec,
    }),
  });
  const rawBody = await tokenRes.text();
  if (!tokenRes.ok) {
    const errBody = rawBody ? (JSON.parse(rawBody) as { error?: { message?: string } }) : {};
    return redirect(`/?error=${encodeURIComponent(errBody.error?.message ?? `HTTP ${tokenRes.status}`)}`);
  }
  const t = JSON.parse(rawBody) as { access_token: string; refresh_token: string; email: string };

  const existingUserId = getCookie(request);
  const isAddAccount = !!existingUserId;
  const userId = isAddAccount ? existingUserId : t.email.replace(/[^a-zA-Z0-9._-]/g, "_");

  const id = env.INBOX_AGENT.idFromName(userId);
  const stub = env.INBOX_AGENT.get(id);

  if (isAddAccount) {
    // Adding a second (or nth) account to an existing user
    const existingTokensRes = await stub.fetch(
      new Request("http://localhost/accounts/tokens", {
        method: "GET",
        headers: { "x-partykit-room": userId },
      })
    );
    let existingRefresh: string | undefined;
    let existingCount = 0;
    if (existingTokensRes.ok) {
      const data = await existingTokensRes.json() as { accounts: ConnectedAccount[] };
      existingCount = data.accounts.length;
      const existing = data.accounts.find((a: ConnectedAccount) => a.email === t.email);
      if (existing) existingRefresh = existing.refresh_token;
    }

    const profile = await fetchGoogleProfile(t.access_token);

    const newAccount: ConnectedAccount = {
      email: t.email,
      access_token: t.access_token,
      refresh_token: t.refresh_token || existingRefresh || "",
      client_id: cid,
      client_secret: csec,
      color: pickDefaultColor(existingCount),
      photoUrl: profile.photoUrl,
      name: profile.name,
      connectedAt: Date.now(),
    };

    await stub.fetch(
      new Request("http://localhost/accounts", {
        method: "PUT",
        body: JSON.stringify({ account: newAccount }),
        headers: { "Content-Type": "application/json", "x-partykit-room": userId },
      })
    );

    return new Response(null, {
      status: 302,
      headers: { Location: "/" },
    });
  }

  // Fresh login flow
  let existingRefreshToken: string | undefined;
  try {
    const existingRes = await stub.fetch(
      new Request("http://localhost/session", {
        method: "GET",
        headers: { "x-partykit-room": userId },
      })
    );
    if (existingRes.ok) {
      const existingSession = await existingRes.json() as GmailSession;
      existingRefreshToken = existingSession.refresh_token;
    }
  } catch (e) {
    console.error("[auth] Failed to read existing session", e);
    throw e;
  }

  const profile = await fetchGoogleProfile(t.access_token);

  const session = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || existingRefreshToken,
    client_id: cid,
    client_secret: csec,
    email: t.email,
  };

  await stub.fetch(
    new Request("http://localhost/session", {
      method: "PUT",
      body: JSON.stringify(session),
      headers: {
        "Content-Type": "application/json",
        "x-partykit-room": userId,
      },
    })
  );

  // Store profile photo/name on the account record
  try {
    await stub.fetch(
      new Request("http://localhost/accounts/profile", {
        method: "PUT",
        body: JSON.stringify({ email: t.email, photoUrl: profile.photoUrl, name: profile.name }),
        headers: { "Content-Type": "application/json", "x-partykit-room": userId },
      }),
    );
  } catch {
    // non-critical
  }

  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": setCookie(userId) },
  });
}

async function handleLogout(): Promise<Response> {
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": clearCookie() },
  });
}

const E2E_TEST_USER_ID = "test-e2e";

async function handleTestInjectSession(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("x-test-secret") !== env.TEST_INJECT_SECRET) {
    return new Response(null, { status: 401 });
  }
  let session: GmailSession;
  try {
    session = (await request.json()) as GmailSession;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(E2E_TEST_USER_ID));
  const putRes = await stub.fetch(
    new Request("http://localhost/session", {
      method: "PUT",
      body: JSON.stringify(session),
      headers: {
        "Content-Type": "application/json",
        "x-partykit-room": E2E_TEST_USER_ID,
      },
    }),
  );
  if (!putRes.ok) {
    return Response.json({ error: "Failed to put session" }, { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": setCookie(E2E_TEST_USER_ID),
    },
  });
}

async function handleAuthUrl(env: Env, url: URL): Promise<Response> {
  try {
    const clientId = env.INBOX_DOG_CLIENT_ID;
    if (!clientId) {
      const msg = "INBOX_DOG_CLIENT_ID not set (add to .dev.vars or wrangler secret)";
      console.warn("[auth-url] 500:", msg);
      return Response.json(
        { error: msg },
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    const origin = url.origin;
    const authUrl = new InboxDog({ fetch: globalThis.fetch.bind(globalThis) }).getAuthUrl({
      clientId,
      redirectUri: `${origin}/callback`,
      scope: "email:full",
    });

    let finalAuthUrl = authUrl.includes("?")
      ? `${authUrl}&prompt=consent&access_type=offline`
      : `${authUrl}?prompt=consent&access_type=offline`;

    if (url.searchParams.get("addAccount") === "true") {
      finalAuthUrl += "&prompt=select_account+consent";
    }

    return Response.json({ authUrl: finalAuthUrl });
  } catch (e) {
    console.warn("[auth-url] 500:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to build auth URL" },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function handleEnsureConversationSession(
  request: Request,
  env: Env,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) {
    return new Response(null, { status: 401 });
  }

  let body: { conversationId?: unknown; category?: unknown };
  try {
    body = await request.json() as { conversationId?: unknown; category?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const conversationId = normalizeConversationId(body.conversationId);
  if (!conversationId) {
    return Response.json({ error: "Invalid conversationId" }, { status: 400 });
  }

  const category = typeof body.category === "string" ? body.category : null;

  const sourceRoom = toConversationRoomName(userId, DEFAULT_CONVERSATION_ID);
  const targetRoom = toConversationRoomName(userId, conversationId);

  if (sourceRoom === targetRoom) {
    return Response.json({ ok: true });
  }

  const targetStub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(targetRoom));
  const sourceStub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(sourceRoom));

  // Sync legacy session
  const sourceRes = await sourceStub.fetch(
    new Request("http://localhost/session", {
      method: "GET",
      headers: { "x-partykit-room": sourceRoom },
    }),
  );
  if (!sourceRes.ok) {
    return Response.json(
      { error: "Gmail session not found. Reconnect your account." },
      { status: 409 },
    );
  }

  const session = await sourceRes.json() as GmailSession;

  const putRes = await targetStub.fetch(
    new Request("http://localhost/session", {
      method: "PUT",
      body: JSON.stringify(session),
      headers: {
        "Content-Type": "application/json",
        "x-partykit-room": targetRoom,
      },
    }),
  );

  if (!putRes.ok) {
    return Response.json(
      { error: "Failed to initialize conversation session" },
      { status: 500 },
    );
  }

  // Sync all connected accounts to the conversation DO
  try {
    const accountsRes = await sourceStub.fetch(
      new Request("http://localhost/accounts/tokens", {
        method: "GET",
        headers: { "x-partykit-room": sourceRoom },
      }),
    );
    if (accountsRes.ok) {
      const { accounts } = await accountsRes.json() as { accounts: ConnectedAccount[] };
      if (accounts.length > 0) {
        await targetStub.fetch(
          new Request("http://localhost/accounts/sync", {
            method: "PUT",
            body: JSON.stringify({ accounts }),
            headers: { "Content-Type": "application/json", "x-partykit-room": targetRoom },
          }),
        );
      }
    }
  } catch (e) {
    console.error("[accounts-sync] Failed to sync accounts to new conversation:", e);
  }

  try {
    const memRes = await sourceStub.fetch(
      new Request("http://localhost/memory", {
        method: "GET",
        headers: { "x-partykit-room": sourceRoom },
      }),
    );
    if (memRes.ok) {
      const memData = await memRes.json();
      await targetStub.fetch(
        new Request("http://localhost/memory", {
          method: "PUT",
          body: JSON.stringify(memData),
          headers: {
            "Content-Type": "application/json",
            "x-partykit-room": targetRoom,
          },
        }),
      );
    }
  } catch (e) {
    console.error("[memory-sync] Failed to sync memory to new conversation:", e);
  }

  // Sync model config so new conversations use the user's selected model
  try {
    const modelRes = await sourceStub.fetch(
      new Request("http://localhost/settings/model-raw", {
        method: "GET",
        headers: { "x-partykit-room": sourceRoom },
      }),
    );
    if (modelRes.ok) {
      const config = await modelRes.json();
      await targetStub.fetch(
        new Request("http://localhost/settings/model", {
          method: "PUT",
          body: JSON.stringify(config),
          headers: { "Content-Type": "application/json", "x-partykit-room": targetRoom },
        }),
      );
    }
  } catch (e) {
    console.error("[model-sync] Failed to sync model config to new conversation:", e);
  }

  // Sync search config so new conversations inherit the user's search API key
  try {
    const searchRes = await sourceStub.fetch(
      new Request("http://localhost/settings/search-raw", {
        method: "GET",
        headers: { "x-partykit-room": sourceRoom },
      }),
    );
    if (searchRes.ok) {
      const config = await searchRes.json();
      await targetStub.fetch(
        new Request("http://localhost/settings/search", {
          method: "PUT",
          body: JSON.stringify(config),
          headers: { "Content-Type": "application/json", "x-partykit-room": targetRoom },
        }),
      );
    }
  } catch (e) {
    console.error("[search-sync] Failed to sync search config to new conversation:", e);
  }

  // Sync category scope so the conversation knows if it's workspace-specific
  if (category) {
    try {
      await targetStub.fetch(
        new Request("http://localhost/conversation/category", {
          method: "PUT",
          body: JSON.stringify({ category }),
          headers: { "Content-Type": "application/json", "x-partykit-room": targetRoom },
        }),
      );
    } catch (e) {
      console.error("[category-sync] Failed to set conversation category:", e);
    }
  }

  return Response.json({ ok: true });
}

async function handleValidateTokens(request: Request, env: Env): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) {
    return Response.json({ valid: false, error: "Not logged in" }, { status: 401 });
  }

  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));
  const accounts = await getAccountTokens(stub, userId);

  if (accounts.length > 0) {
    const results = await Promise.all(
      accounts.map(async (account) => {
        try {
          await getValidTokenForAccount(account, stub, userId);
          return { email: account.email, valid: true as const };
        } catch (e) {
          return { email: account.email, valid: false as const, error: e instanceof Error ? e.message : "Validation failed" };
        }
      }),
    );
    const allValid = results.every((r) => r.valid);
    return Response.json({
      valid: allValid,
      accounts: results,
      email: accounts[0].email,
    });
  }

  // Fallback to legacy single-session
  const sessionRes = await stub.fetch(
    new Request("http://localhost/session", {
      method: "GET",
      headers: { "x-partykit-room": userId },
    }),
  );

  if (!sessionRes.ok) {
    return Response.json({ valid: false, error: "No session found" });
  }

  const session = (await sessionRes.json()) as GmailSession;
  if (!session.access_token) {
    return Response.json({ valid: false, error: "No access token" });
  }

  try {
    let token = session.access_token;
    let gmailRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (gmailRes.status === 401 && session.refresh_token) {
      try {
        const dog = new InboxDog({ fetch: globalThis.fetch.bind(globalThis) });
        const refreshed = await dog.refreshToken(
          session.refresh_token,
          session.client_id,
          session.client_secret,
        );
        token = refreshed.access_token;
        await stub.fetch(
          new Request("http://localhost/session", {
            method: "PUT",
            body: JSON.stringify({ ...session, access_token: token }),
            headers: {
              "Content-Type": "application/json",
              "x-partykit-room": userId,
            },
          }),
        );
        gmailRes = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          { headers: { Authorization: `Bearer ${token}` } },
        );
      } catch {
        return Response.json({
          valid: false,
          error: "Token expired and refresh failed. Please reconnect.",
        });
      }
    }

    if (gmailRes.ok) {
      const profile = (await gmailRes.json()) as { emailAddress: string };
      return Response.json({ valid: true, email: profile.emailAddress });
    }
    return Response.json({
      valid: false,
      error: `Gmail API returned ${gmailRes.status}`,
      status: gmailRes.status,
    });
  } catch (e) {
    return Response.json({
      valid: false,
      error: e instanceof Error ? e.message : "Token validation failed",
    });
  }
}

function handleMe(request: Request): Response {
  const userId = getCookie(request);
  if (!userId) {
    return new Response(null, { status: 401 });
  }
  return Response.json({ userId: decodeURIComponent(userId) });
}

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function getValidToken(
  session: GmailSession,
  stub: DurableObjectStub,
  userId: string,
): Promise<string> {
  let token = session.access_token;
  const testRes = await fetch(`${GMAIL_BASE}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (testRes.status === 401 && session.refresh_token) {
    const dog = new InboxDog({ fetch: globalThis.fetch.bind(globalThis) });
    const refreshed = await dog.refreshToken(
      session.refresh_token,
      session.client_id,
      session.client_secret,
    );
    token = refreshed.access_token;
    await stub.fetch(
      new Request("http://localhost/session", {
        method: "PUT",
        body: JSON.stringify({ ...session, access_token: token }),
        headers: {
          "Content-Type": "application/json",
          "x-partykit-room": userId,
        },
      }),
    );
  } else if (!testRes.ok) {
    throw new Error(`Gmail API returned ${testRes.status}`);
  }
  return token;
}

function extractHeader(
  headers: { name: string; value: string }[] | undefined,
  name: string,
): string {
  if (!headers) return "";
  const h = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? "";
}

async function getAccountTokens(
  stub: DurableObjectStub,
  userId: string,
): Promise<ConnectedAccount[]> {
  const res = await stub.fetch(
    new Request("http://localhost/accounts/tokens", {
      method: "GET",
      headers: { "x-partykit-room": userId },
    }),
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { accounts: ConnectedAccount[] };
  return data.accounts;
}

async function getActiveEmails(
  stub: DurableObjectStub,
  userId: string,
): Promise<string[]> {
  const res = await stub.fetch(
    new Request("http://localhost/accounts/active", {
      method: "GET",
      headers: { "x-partykit-room": userId },
    }),
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { activeEmails: string[] };
  return data.activeEmails;
}

async function getValidTokenForAccount(
  account: ConnectedAccount,
  stub: DurableObjectStub,
  userId: string,
): Promise<string> {
  let token = account.access_token;
  const testRes = await fetch(`${GMAIL_BASE}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (testRes.status === 401 && account.refresh_token) {
    const dog = new InboxDog({ fetch: globalThis.fetch.bind(globalThis) });
    const refreshed = await dog.refreshToken(
      account.refresh_token,
      account.client_id,
      account.client_secret,
    );
    token = refreshed.access_token;
    // Persist updated token back to account
    await stub.fetch(
      new Request("http://localhost/accounts", {
        method: "PUT",
        body: JSON.stringify({
          account: { ...account, access_token: token },
        }),
        headers: { "Content-Type": "application/json", "x-partykit-room": userId },
      }),
    );
  } else if (!testRes.ok) {
    throw new Error(`Gmail API returned ${testRes.status} for ${account.email}`);
  }
  return token;
}

async function fetchInboxForAccount(
  token: string,
  accountEmail: string,
  maxResults: number,
): Promise<{ id: string; threadId: string; from: string; to: string; subject: string; snippet: string; date: string; labelIds: string[]; unread: boolean; accountEmail: string }[]> {
  const listRes = await fetch(
    `${GMAIL_BASE}/messages?q=in:inbox&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) return [];
  const listData = (await listRes.json()) as {
    messages?: { id: string; threadId: string }[];
  };
  if (!listData.messages?.length) return [];

  const metadataHeaders = ["From", "Subject", "Date", "To"]
    .map((h) => `metadataHeaders=${h}`)
    .join("&");

  const details = await Promise.all(
    listData.messages.map(async (msg) => {
      const res = await fetch(
        `${GMAIL_BASE}/messages/${msg.id}?format=metadata&${metadataHeaders}`,
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
    .map((d) => ({
      id: d.id,
      threadId: d.threadId,
      from: extractHeader(d.payload?.headers, "From"),
      to: extractHeader(d.payload?.headers, "To"),
      subject: extractHeader(d.payload?.headers, "Subject"),
      snippet: d.snippet,
      date: new Date(Number(d.internalDate)).toISOString(),
      labelIds: d.labelIds,
      unread: d.labelIds.includes("UNREAD"),
      accountEmail,
    }));
}

async function handleInbox(request: Request, env: Env): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));
  const url = new URL(request.url);
  const maxResults = Math.min(Number(url.searchParams.get("max") || "20"), 50);

  const allAccounts = await getAccountTokens(stub, userId);

  if (allAccounts.length === 0) {
    // Fallback to legacy single-session
    const sessionRes = await stub.fetch(
      new Request("http://localhost/session", {
        method: "GET",
        headers: { "x-partykit-room": userId },
      }),
    );
    if (!sessionRes.ok) return Response.json({ error: "No session" }, { status: 404 });
    const session = (await sessionRes.json()) as GmailSession;
    let token: string;
    try {
      token = await getValidToken(session, stub, userId);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "Token error" }, { status: 401 });
    }
    const emails = await fetchInboxForAccount(token, session.email, maxResults);
    return Response.json({ emails, total: emails.length });
  }

  const accountsParam = url.searchParams.get("accounts");
  let activeEmails: string[];
  if (accountsParam) {
    activeEmails = accountsParam.split(",").filter(Boolean);
  } else {
    activeEmails = await getActiveEmails(stub, userId);
  }

  const activeAccounts = allAccounts.filter((a) => activeEmails.includes(a.email));
  if (activeAccounts.length === 0) {
    return Response.json({ emails: [], total: 0 });
  }

  const perAccountMax = Math.min(maxResults, 50);
  const results = await Promise.all(
    activeAccounts.map(async (account) => {
      try {
        const token = await getValidTokenForAccount(account, stub, userId);
        return await fetchInboxForAccount(token, account.email, perAccountMax);
      } catch (e) {
        console.error(`[inbox] Failed to fetch for ${account.email}:`, e);
        return [];
      }
    }),
  );

  const allEmails = results
    .flat()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, maxResults);

  return Response.json({
    emails: allEmails,
    total: allEmails.length,
  });
}

interface GmailPayloadPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPayloadPart[];
  headers?: { name: string; value: string }[];
}

interface EmailAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

function extractAttachments(payload: GmailPayloadPart): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];

  function walk(part: GmailPayloadPart) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType || "application/octet-stream",
        size: part.body.size || 0,
      });
    }
    if (part.parts) {
      for (const child of part.parts) walk(child);
    }
  }

  walk(payload);
  return attachments;
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function extractBody(
  payload: GmailPayloadPart,
): { html: string; text: string } {
  let html = "";
  let text = "";

  function walk(part: GmailPayloadPart) {
    if (part.mimeType === "text/html" && part.body?.data) {
      html = decodeBase64Url(part.body.data);
    } else if (part.mimeType === "text/plain" && part.body?.data) {
      text = decodeBase64Url(part.body.data);
    }
    if (part.parts) {
      for (const child of part.parts) walk(child);
    }
  }

  walk(payload);

  if (!html && !text && payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/html") html = decoded;
    else text = decoded;
  }

  return { html, text };
}

async function resolveTokenForRequest(
  request: Request,
  env: Env,
  userId: string,
): Promise<{ token: string; accountEmail: string } | Response> {
  const url = new URL(request.url);
  const accountParam = url.searchParams.get("account");
  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));

  if (accountParam) {
    const accounts = await getAccountTokens(stub, userId);
    const account = accounts.find((a) => a.email === accountParam);
    if (!account) {
      return Response.json({ error: "Account not found" }, { status: 404 });
    }
    try {
      const token = await getValidTokenForAccount(account, stub, userId);
      return { token, accountEmail: account.email };
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "Token error" }, { status: 401 });
    }
  }

  // Fallback: use legacy session
  const sessionRes = await stub.fetch(
    new Request("http://localhost/session", {
      method: "GET",
      headers: { "x-partykit-room": userId },
    }),
  );
  if (!sessionRes.ok) {
    return Response.json({ error: "No session" }, { status: 404 });
  }
  const session = (await sessionRes.json()) as GmailSession;
  try {
    const token = await getValidToken(session, stub, userId);
    return { token, accountEmail: session.email };
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Token error" }, { status: 401 });
  }
}

async function handleGetMessage(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const messageId = path.split("?")[0].replace("/api/messages/", "");
  if (!messageId) {
    return Response.json({ error: "Missing message ID" }, { status: 400 });
  }

  const resolved = await resolveTokenForRequest(request, env, userId);
  if (resolved instanceof Response) return resolved;
  const { token, accountEmail } = resolved;

  const msgRes = await fetch(`${GMAIL_BASE}/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!msgRes.ok) {
    return Response.json(
      { error: `Gmail API returned ${msgRes.status}` },
      { status: msgRes.status },
    );
  }

  const raw = (await msgRes.json()) as {
    id: string;
    threadId: string;
    labelIds: string[];
    snippet: string;
    internalDate: string;
    payload?: GmailPayloadPart;
  };

  const headers = raw.payload?.headers;
  const { html, text } = raw.payload ? extractBody(raw.payload) : { html: "", text: "" };
  const attachments = raw.payload ? extractAttachments(raw.payload) : [];

  return Response.json({
    id: raw.id,
    threadId: raw.threadId,
    labelIds: raw.labelIds,
    snippet: raw.snippet,
    date: new Date(Number(raw.internalDate)).toISOString(),
    from: extractHeader(headers, "From"),
    to: extractHeader(headers, "To"),
    cc: extractHeader(headers, "Cc"),
    subject: extractHeader(headers, "Subject"),
    bodyHtml: html,
    bodyText: text,
    unread: raw.labelIds.includes("UNREAD"),
    attachments,
    accountEmail,
  });
}

async function handleGetThread(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const threadId = path.split("?")[0].replace("/api/threads/", "");
  if (!threadId) {
    return Response.json({ error: "Missing thread ID" }, { status: 400 });
  }

  const resolved = await resolveTokenForRequest(request, env, userId);
  if (resolved instanceof Response) return resolved;
  const { token, accountEmail } = resolved;

  const threadRes = await fetch(
    `${GMAIL_BASE}/threads/${threadId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!threadRes.ok) {
    return Response.json(
      { error: `Gmail API returned ${threadRes.status}` },
      { status: threadRes.status },
    );
  }

  const threadData = (await threadRes.json()) as {
    id: string;
    messages?: Array<{
      id: string;
      threadId: string;
      labelIds: string[];
      snippet: string;
      internalDate: string;
      payload?: GmailPayloadPart;
    }>;
  };

  const messages = (threadData.messages ?? []).map((msg) => {
    const headers = msg.payload?.headers;
    const { html, text } = msg.payload
      ? extractBody(msg.payload)
      : { html: "", text: "" };
    const attachments = msg.payload ? extractAttachments(msg.payload) : [];
    return {
      id: msg.id,
      threadId: msg.threadId,
      labelIds: msg.labelIds,
      snippet: msg.snippet,
      date: new Date(Number(msg.internalDate)).toISOString(),
      from: extractHeader(headers, "From"),
      to: extractHeader(headers, "To"),
      cc: extractHeader(headers, "Cc"),
      subject: extractHeader(headers, "Subject"),
      bodyHtml: html,
      bodyText: text,
      unread: msg.labelIds.includes("UNREAD"),
      attachments,
    };
  });

  return Response.json({ id: threadData.id, messages, accountEmail });
}

async function handleGetAttachment(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const segments = path.replace("/api/attachments/", "").split("/");
  if (segments.length < 2) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }
  const messageId = segments[0];
  const attachmentId = segments.slice(1).join("/");

  const resolved = await resolveTokenForRequest(request, env, userId);
  if (resolved instanceof Response) return resolved;
  const { token } = resolved;

  const res = await fetch(
    `${GMAIL_BASE}/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    return new Response(null, { status: res.status });
  }

  const payload = (await res.json()) as { data: string; size: number };

  const base64 = payload.data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const url = new URL(request.url);
  const contentType = url.searchParams.get("type") || "application/octet-stream";

  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${url.searchParams.get("name") || "attachment"}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

function encodeBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function handleArchiveThread(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const threadId = path.replace("/api/threads/", "").replace("/archive", "");
  if (!threadId) {
    return Response.json({ error: "Missing thread ID" }, { status: 400 });
  }

  const resolved = await resolveTokenForRequest(request, env, userId);
  if (resolved instanceof Response) return resolved;
  const { token } = resolved;

  const res = await fetch(`${GMAIL_BASE}/threads/${threadId}/modify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
  });

  if (!res.ok) {
    const text = await res.text();
    return Response.json(
      { error: `Gmail API returned ${res.status}: ${text}` },
      { status: res.status },
    );
  }

  return Response.json({ success: true });
}

async function handleUnarchiveThread(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const threadId = path.replace("/api/threads/", "").replace("/unarchive", "");
  if (!threadId) {
    return Response.json({ error: "Missing thread ID" }, { status: 400 });
  }

  const resolved = await resolveTokenForRequest(request, env, userId);
  if (resolved instanceof Response) return resolved;
  const { token } = resolved;

  const res = await fetch(`${GMAIL_BASE}/threads/${threadId}/modify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ addLabelIds: ["INBOX"] }),
  });

  if (!res.ok) {
    const text = await res.text();
    return Response.json(
      { error: `Gmail API returned ${res.status}: ${text}` },
      { status: res.status },
    );
  }

  return Response.json({ success: true });
}

async function handleReplyToThread(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const threadId = path.replace("/api/threads/", "").replace("/reply", "");
  if (!threadId) {
    return Response.json({ error: "Missing thread ID" }, { status: 400 });
  }

  const body = (await request.json()) as {
    body: string;
    to: string;
    subject: string;
    cc?: string;
    bcc?: string;
    messageId?: string;
    references?: string;
    inReplyTo?: string;
  };
  if (!body.body || !body.to || !body.subject) {
    return Response.json({ error: "Missing required fields: body, to, subject" }, { status: 400 });
  }

  const resolved = await resolveTokenForRequest(request, env, userId);
  if (resolved instanceof Response) return resolved;
  const { token, accountEmail } = resolved;

  const headers = [
    `From: ${accountEmail}`,
    `To: ${body.to}`,
    `Subject: ${body.subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ];
  if (body.cc) headers.push(`Cc: ${body.cc}`);
  if (body.bcc) headers.push(`Bcc: ${body.bcc}`);
  if (body.inReplyTo) headers.push(`In-Reply-To: ${body.inReplyTo}`);
  if (body.references) headers.push(`References: ${body.references}`);

  const rawEmail = headers.join("\r\n") + "\r\n\r\n" + body.body;
  const encoded = encodeBase64Url(rawEmail);

  const res = await fetch(`${GMAIL_BASE}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded, threadId }),
  });

  if (!res.ok) {
    const text = await res.text();
    return Response.json(
      { error: `Gmail API returned ${res.status}: ${text}` },
      { status: res.status },
    );
  }

  const result = await res.json();
  return Response.json({ success: true, message: result });
}

async function handleForwardThread(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const threadId = path.replace("/api/threads/", "").replace("/forward", "");
  if (!threadId) {
    return Response.json({ error: "Missing thread ID" }, { status: 400 });
  }

  const body = (await request.json()) as {
    body: string;
    to: string;
    subject: string;
    cc?: string;
    bcc?: string;
  };
  if (!body.to || !body.subject) {
    return Response.json({ error: "Missing required fields: to, subject" }, { status: 400 });
  }

  const resolved = await resolveTokenForRequest(request, env, userId);
  if (resolved instanceof Response) return resolved;
  const { token, accountEmail } = resolved;

  const headers = [
    `From: ${accountEmail}`,
    `To: ${body.to}`,
    `Subject: ${body.subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ];
  if (body.cc) headers.push(`Cc: ${body.cc}`);
  if (body.bcc) headers.push(`Bcc: ${body.bcc}`);

  const rawEmail = headers.join("\r\n") + "\r\n\r\n" + (body.body || "");
  const encoded = encodeBase64Url(rawEmail);

  const res = await fetch(`${GMAIL_BASE}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!res.ok) {
    const text = await res.text();
    return Response.json(
      { error: `Gmail API returned ${res.status}: ${text}` },
      { status: res.status },
    );
  }

  const result = await res.json();
  return Response.json({ success: true, message: result });
}

async function resolveAccountCredentials(
  request: Request,
  env: Env,
  userId: string,
): Promise<{ token: string; accountEmail: string; refreshToken: string; clientId: string; clientSecret: string } | Response> {
  const url = new URL(request.url);
  const accountParam = url.searchParams.get("account");
  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));

  if (accountParam) {
    const accounts = await getAccountTokens(stub, userId);
    const account = accounts.find((a) => a.email === accountParam);
    if (!account) {
      return Response.json({ error: "Account not found" }, { status: 404 });
    }
    try {
      const token = await getValidTokenForAccount(account, stub, userId);
      return {
        token,
        accountEmail: account.email,
        refreshToken: account.refresh_token,
        clientId: account.client_id,
        clientSecret: account.client_secret,
      };
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "Token error" }, { status: 401 });
    }
  }

  const sessionRes = await stub.fetch(
    new Request("http://localhost/session", {
      method: "GET",
      headers: { "x-partykit-room": userId },
    }),
  );
  if (!sessionRes.ok) {
    return Response.json({ error: "No session" }, { status: 404 });
  }
  const session = (await sessionRes.json()) as GmailSession;
  try {
    const token = await getValidToken(session, stub, userId);
    return {
      token,
      accountEmail: session.email,
      refreshToken: session.refresh_token,
      clientId: session.client_id,
      clientSecret: session.client_secret,
    };
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Token error" }, { status: 401 });
  }
}

async function handleScheduleSend(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const threadId = path.replace("/api/threads/", "").replace("/schedule", "");
  if (!threadId) {
    return Response.json({ error: "Missing thread ID" }, { status: 400 });
  }

  const body = (await request.json()) as {
    body: string;
    to: string;
    subject: string;
    cc?: string;
    bcc?: string;
    scheduledAt: string;
    inReplyTo?: string;
    references?: string;
  };
  if (!body.to || !body.subject || !body.scheduledAt) {
    return Response.json({ error: "Missing required fields: to, subject, scheduledAt" }, { status: 400 });
  }

  const scheduledAt = new Date(body.scheduledAt).getTime();
  if (Number.isNaN(scheduledAt) || scheduledAt <= Date.now()) {
    return Response.json({ error: "scheduledAt must be a future date" }, { status: 400 });
  }

  const resolved = await resolveAccountCredentials(request, env, userId);
  if (resolved instanceof Response) return resolved;
  const { token, accountEmail, refreshToken, clientId, clientSecret } = resolved;

  const emailHeaders = [
    `From: ${accountEmail}`,
    `To: ${body.to}`,
    `Subject: ${body.subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ];
  if (body.cc) emailHeaders.push(`Cc: ${body.cc}`);
  if (body.bcc) emailHeaders.push(`Bcc: ${body.bcc}`);
  if (body.inReplyTo) emailHeaders.push(`In-Reply-To: ${body.inReplyTo}`);
  if (body.references) emailHeaders.push(`References: ${body.references}`);

  const rawEmail = emailHeaders.join("\r\n") + "\r\n\r\n" + body.body;
  const encoded = encodeBase64Url(rawEmail);

  const draftRes = await fetch(`${GMAIL_BASE}/drafts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: { raw: encoded, threadId },
    }),
  });

  if (!draftRes.ok) {
    const text = await draftRes.text();
    return Response.json(
      { error: `Failed to create draft: ${draftRes.status}: ${text}` },
      { status: draftRes.status },
    );
  }

  const draft = (await draftRes.json()) as { id: string };

  const scheduledId = `sched_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const doId = env.SCHEDULED_SENDER.idFromName(userId);
  const stub = env.SCHEDULED_SENDER.get(doId);

  const scheduleRes = await stub.fetch(
    new Request("http://localhost/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: scheduledId,
        userId,
        accountEmail,
        threadId,
        draftId: draft.id,
        scheduledAt,
        subject: body.subject,
        to: body.to,
        accessToken: token,
        refreshToken,
        clientId,
        clientSecret,
      }),
    }),
  );

  if (!scheduleRes.ok) {
    const text = await scheduleRes.text();
    return Response.json({ error: `Failed to schedule: ${text}` }, { status: 500 });
  }

  const result = await scheduleRes.json();
  return Response.json(result);
}

async function handleListScheduled(
  request: Request,
  env: Env,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const doId = env.SCHEDULED_SENDER.idFromName(userId);
  const stub = env.SCHEDULED_SENDER.get(doId);
  const res = await stub.fetch(new Request("http://localhost/list", { method: "GET" }));
  return new Response(res.body, { status: res.status, headers: res.headers });
}

async function handleCancelScheduled(
  request: Request,
  env: Env,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const { id } = (await request.json()) as { id: string };
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  const doId = env.SCHEDULED_SENDER.idFromName(userId);
  const stub = env.SCHEDULED_SENDER.get(doId);
  const res = await stub.fetch(
    new Request("http://localhost/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }),
  );

  if (!res.ok) {
    return Response.json({ error: "Scheduled email not found or already processed" }, { status: 404 });
  }

  return Response.json({ success: true });
}

async function handleEmailDiagnosticsProxy(
  request: Request,
  env: Env,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));
  const doRes = await stub.fetch(
    new Request("http://localhost/email-diagnostics", {
      method: "GET",
      headers: { "x-partykit-room": userId },
    }),
  );
  return new Response(doRes.body, {
    status: doRes.status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleMemoryProxy(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));

  const routeMap: Record<string, { doPath: string; methods: string[] }> = {
    "/api/memory": { doPath: "/memory/debug", methods: ["GET"] },
    "/api/memory/events": { doPath: "/memory/events", methods: ["GET"] },
    "/api/memory/facts": { doPath: "/memory/facts", methods: ["PUT"] },
    "/api/memory/prompt-snapshot": { doPath: "/memory/prompt-snapshot", methods: ["GET"] },
    "/api/memory/system-prompt": { doPath: "/memory/system-prompt", methods: ["GET", "PUT", "DELETE"] },
    "/api/settings/model": { doPath: "/settings/model", methods: ["GET", "PUT", "DELETE"] },
    "/api/settings/search": { doPath: "/settings/search", methods: ["GET", "PUT", "DELETE"] },
  };

  // Handle DELETE /api/memory/facts/:index
  const factsDeleteMatch = path.match(/^\/api\/memory\/facts\/(\d+)$/);
  if (factsDeleteMatch && request.method === "DELETE") {
    const doPath = `/memory/facts/${factsDeleteMatch[1]}`;
    const doRes = await stub.fetch(
      new Request(`http://localhost${doPath}`, {
        method: "DELETE",
        headers: { "x-partykit-room": userId },
      }),
    );
    return new Response(doRes.body, {
      status: doRes.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const route = routeMap[path];
  if (!route || !route.methods.includes(request.method)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const doRes = await stub.fetch(
    new Request(`http://localhost${route.doPath}`, {
      method: request.method,
      body: request.method !== "GET" ? request.body : undefined,
      headers: {
        "Content-Type": "application/json",
        "x-partykit-room": userId,
      },
    }),
  );

  return new Response(doRes.body, {
    status: doRes.status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleAccountsProxy(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));

  const routeMap: Record<string, { doPath: string; methods: string[] }> = {
    "/api/accounts": { doPath: "/accounts", methods: ["GET", "PUT", "DELETE"] },
    "/api/accounts/active": { doPath: "/accounts/active", methods: ["GET", "PUT"] },
    "/api/accounts/label": { doPath: "/accounts/label", methods: ["PUT"] },
    "/api/accounts/primary": { doPath: "/accounts/primary", methods: ["PUT"] },
  };

  const route = routeMap[path];
  if (!route || !route.methods.includes(request.method)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const doRes = await stub.fetch(
    new Request(`http://localhost${route.doPath}`, {
      method: request.method,
      body: request.method !== "GET" ? request.body : undefined,
      headers: {
        "Content-Type": "application/json",
        "x-partykit-room": userId,
      },
    }),
  );

  return new Response(doRes.body, {
    status: doRes.status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleWorkspaceProxy(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  // File upload: POST /api/workspace/:category/upload
  const uploadMatch = path.match(/^\/api\/workspace\/([^/]+)\/upload$/);
  if (uploadMatch && request.method === "POST") {
    const category = decodeURIComponent(uploadMatch[1]);
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return Response.json({ error: "No file provided" }, { status: 400 });

    const itemId = crypto.randomUUID();
    const r2Key = `${userId}/${category}/${itemId}/${file.name}`;
    await env.WORKSPACE_FILES.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type },
      customMetadata: { originalName: file.name },
    });

    const isImage = file.type.startsWith("image/");
    const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));
    const doRes = await stub.fetch(
      new Request(`http://localhost/workspace/${encodeURIComponent(category)}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-partykit-room": userId },
        body: JSON.stringify({
          type: isImage ? "image" : "file",
          content: file.name,
          fileRef: {
            key: r2Key,
            filename: file.name,
            contentType: file.type,
            size: file.size,
          },
        }),
      }),
    );
    return new Response(doRes.body, {
      status: doRes.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // File serve: GET /api/workspace/:category/file/*
  const fileMatch = path.match(/^\/api\/workspace\/([^/]+)\/file\/(.+)$/);
  if (fileMatch && request.method === "GET") {
    const r2Key = decodeURIComponent(fileMatch[2]);
    const obj = await env.WORKSPACE_FILES.get(r2Key);
    if (!obj) return new Response("Not found", { status: 404 });

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(obj.body, { headers });
  }

  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));

  // All other workspace routes go to DO
  const doPath = path.replace(/^\/api/, "");
  const doRes = await stub.fetch(
    new Request(`http://localhost${doPath}`, {
      method: request.method,
      body: request.method !== "GET" ? request.body : undefined,
      headers: { "Content-Type": "application/json", "x-partykit-room": userId },
    }),
  );
  return new Response(doRes.body, {
    status: doRes.status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleTodosProxy(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));

  // Direct route mappings
  const routeMap: Record<string, { doPath: string; methods: string[] }> = {
    "/api/todos": { doPath: "/todos", methods: ["GET", "POST"] },
    "/api/todos/reorder": { doPath: "/todos/reorder", methods: ["PUT"] },
    "/api/todos/archived": { doPath: "/todos/archived", methods: ["GET"] },
    "/api/todos/preferences": { doPath: "/todos/preferences", methods: ["GET", "PUT"] },
    "/api/todos/categories": { doPath: "/todos/categories", methods: ["PUT"] },
    "/api/todos/category-colors": { doPath: "/todos/category-colors", methods: ["PUT"] },
    "/api/todos/suggestions/clear": { doPath: "/todos/suggestions/clear", methods: ["POST"] },
  };

  const route = routeMap[path];
  if (route && route.methods.includes(request.method)) {
    const doRes = await stub.fetch(
      new Request(`http://localhost${route.doPath}`, {
        method: request.method,
        body: request.method !== "GET" ? request.body : undefined,
        headers: { "Content-Type": "application/json", "x-partykit-room": userId },
      }),
    );
    return new Response(doRes.body, {
      status: doRes.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Dynamic routes: /api/todos/:id, /api/todos/:id/accept, /api/todos/:id/decline, /api/todos/:id/complete
  const actionMatch = path.match(/^\/api\/todos\/([^/]+)\/(accept|decline|complete)$/);
  if (actionMatch && request.method === "POST") {
    const [, id, action] = actionMatch;
    const doRes = await stub.fetch(
      new Request(`http://localhost/todos/${id}/${action}`, {
        method: "POST",
        body: request.body,
        headers: { "Content-Type": "application/json", "x-partykit-room": userId },
      }),
    );
    return new Response(doRes.body, {
      status: doRes.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const itemMatch = path.match(/^\/api\/todos\/([^/]+)$/);
  if (itemMatch && (request.method === "PUT" || request.method === "DELETE")) {
    const id = itemMatch[1];
    if (id === "reorder" || id === "archived" || id === "preferences" || id === "categories" || id === "category-colors") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const doRes = await stub.fetch(
      new Request(`http://localhost/todos/${id}`, {
        method: request.method,
        body: request.method === "PUT" ? request.body : undefined,
        headers: { "Content-Type": "application/json", "x-partykit-room": userId },
      }),
    );
    return new Response(doRes.body, {
      status: doRes.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

async function handleScanProxy(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));

  const routeMap: Record<string, { doPath: string; methods: string[] }> = {
    "/api/scan/config": { doPath: "/scan/config", methods: ["GET", "PUT"] },
    "/api/scan/status": { doPath: "/scan/status", methods: ["GET"] },
    "/api/scan/trigger": { doPath: "/scan/trigger", methods: ["POST"] },
    "/api/scan/slack/trigger": { doPath: "/scan/slack/trigger", methods: ["POST"] },
    "/api/scan/slack/status": { doPath: "/scan/slack/status", methods: ["GET"] },
    "/api/scan/slack/config": { doPath: "/scan/slack/config", methods: ["GET", "PUT"] },
  };

  const route = routeMap[path];
  if (!route || !route.methods.includes(request.method)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const doRes = await stub.fetch(
    new Request(`http://localhost${route.doPath}`, {
      method: request.method,
      body: request.method !== "GET" ? request.body : undefined,
      headers: {
        "Content-Type": "application/json",
        "x-partykit-room": userId,
      },
    }),
  );

  return new Response(doRes.body, {
    status: doRes.status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleSlackWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await request.text();

  // Handle Slack URL verification challenge before anything else.
  // This avoids initializing the full Chat SDK just for the handshake.
  try {
    const payload = JSON.parse(body);
    if (payload.type === "url_verification" && payload.challenge) {
      return Response.json({ challenge: payload.challenge });
    }
  } catch {
    // Not JSON or malformed — fall through to adapter
  }

  // Clone the request with the already-consumed body so the adapter can read it
  const clonedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  });

  const userId = getCookie(request) ?? "slack-bot";
  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));

  setSlackContext({
    storeThread: async (data) => {
      await stub.fetch(
        new Request("http://localhost/slack/store-thread", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-partykit-room": userId },
          body: JSON.stringify(data),
        }),
      );
    },
    appendMessage: async (channelId, threadTs, message) => {
      await stub.fetch(
        new Request("http://localhost/slack/append-message", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-partykit-room": userId },
          body: JSON.stringify({ channelId, threadTs, message }),
        }),
      );
    },
  });

  try {
    const bot = await getSlackBot({
      botToken: env.SLACK_BOT_TOKEN,
      signingSecret: env.SLACK_SIGNING_SECRET,
    });
    return await bot.webhooks.slack(clonedRequest, { waitUntil: ctx.waitUntil.bind(ctx) });
  } finally {
    clearSlackContext();
  }
}

function parseSender(from: string): { name: string; email: string } {
  const angleMatch = from.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].trim(),
      email: angleMatch[2].trim().toLowerCase(),
    };
  }
  const emailOnly = from.trim().toLowerCase();
  return { name: "", email: emailOnly };
}

const CONTACTS_CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

async function handleContacts(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));

  // Try cache first
  const cacheRes = await stub.fetch(
    new Request("http://localhost/contacts/cache", {
      method: "GET",
      headers: { "x-partykit-room": userId },
    }),
  );
  if (cacheRes.ok) {
    const cached = (await cacheRes.json()) as {
      contacts: { name: string; email: string }[];
      updatedAt: number;
    };
    const age = Date.now() - cached.updatedAt;
    if (cached.contacts.length > 0 && age < CONTACTS_CACHE_MAX_AGE_MS) {
      return Response.json({ contacts: cached.contacts });
    }
    if (cached.contacts.length > 0) {
      ctx.waitUntil(refreshContactsCache(stub, userId, env));
      return Response.json({ contacts: cached.contacts });
    }
  }

  // No cache -- build synchronously, then cache
  const contacts = await buildContactsList(stub, userId, env);
  ctx.waitUntil(
    stub.fetch(
      new Request("http://localhost/contacts/cache", {
        method: "PUT",
        headers: { "x-partykit-room": userId, "Content-Type": "application/json" },
        body: JSON.stringify({ contacts }),
      }),
    ),
  );

  return Response.json({ contacts });
}

async function refreshContactsCache(
  stub: DurableObjectStub,
  userId: string,
  env: Env,
) {
  try {
    const contacts = await buildContactsList(stub, userId, env);
    await stub.fetch(
      new Request("http://localhost/contacts/cache", {
        method: "PUT",
        headers: { "x-partykit-room": userId, "Content-Type": "application/json" },
        body: JSON.stringify({ contacts }),
      }),
    );
  } catch {
    // background refresh failed silently
  }
}

async function buildContactsList(
  stub: DurableObjectStub,
  userId: string,
  env: Env,
): Promise<{ name: string; email: string }[]> {
  const allAccounts = await getAccountTokens(stub, userId);
  const seen = new Map<string, { name: string; email: string; count: number }>();

  const extractContactsFromHeaders = (
    headers: { name: string; value: string }[],
  ) => {
    for (const header of headers) {
      if (!["from", "to", "cc"].includes(header.name.toLowerCase())) continue;
      const addresses = header.value.split(",");
      for (const addr of addresses) {
        const parsed = parseSender(addr.trim());
        if (parsed.email && parsed.email.includes("@")) {
          const existing = seen.get(parsed.email);
          if (existing) {
            existing.count++;
            if (!existing.name && parsed.name) existing.name = parsed.name;
          } else {
            seen.set(parsed.email, { ...parsed, count: 1 });
          }
        }
      }
    }
  };

  const fetchContactsForToken = async (token: string) => {
    const queries = ["in:inbox", "in:sent"];
    const allMessageIds: string[] = [];

    await Promise.all(
      queries.map(async (q) => {
        const listRes = await fetch(
          `${GMAIL_BASE}/messages?q=${encodeURIComponent(q)}&maxResults=100`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!listRes.ok) return;
        const listData = (await listRes.json()) as {
          messages?: { id: string }[];
        };
        if (listData.messages) {
          for (const m of listData.messages) allMessageIds.push(m.id);
        }
      }),
    );

    const uniqueIds = [...new Set(allMessageIds)];
    if (uniqueIds.length === 0) return;

    const metadataHeaders = ["From", "To", "Cc"]
      .map((h) => `metadataHeaders=${h}`)
      .join("&");

    const batchSize = 20;
    for (let i = 0; i < uniqueIds.length; i += batchSize) {
      const batch = uniqueIds.slice(i, i + batchSize);
      const details = await Promise.all(
        batch.map(async (id) => {
          const res = await fetch(
            `${GMAIL_BASE}/messages/${id}?format=metadata&${metadataHeaders}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!res.ok) return null;
          return res.json() as Promise<{
            payload?: { headers?: { name: string; value: string }[] };
          }>;
        }),
      );

      for (const detail of details) {
        if (!detail?.payload?.headers) continue;
        extractContactsFromHeaders(detail.payload.headers);
      }
    }
  };

  if (allAccounts.length > 0) {
    await Promise.all(
      allAccounts.map(async (account) => {
        try {
          const token = await getValidTokenForAccount(account, stub, userId);
          await fetchContactsForToken(token);
        } catch {
          // skip failed account
        }
      }),
    );
  } else {
    const sessionRes = await stub.fetch(
      new Request("http://localhost/session", {
        method: "GET",
        headers: { "x-partykit-room": userId },
      }),
    );
    if (sessionRes.ok) {
      const session = (await sessionRes.json()) as GmailSession;
      try {
        const token = await getValidToken(session, stub, userId);
        await fetchContactsForToken(token);
      } catch {
        // skip
      }
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.count - a.count || (a.name || a.email).localeCompare(b.name || b.email))
    .map(({ name, email }) => ({ name, email }));
}

async function handleContactSearch(
  request: Request,
  env: Env,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  if (!query) return Response.json({ contacts: [] });

  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));
  const allAccounts = await getAccountTokens(stub, userId);

  const seen = new Map<string, { name: string; email: string }>();

  const searchToken = async (token: string) => {
    const gmailQuery = `from:${query} OR to:${query}`;
    const listRes = await fetch(
      `${GMAIL_BASE}/messages?q=${encodeURIComponent(gmailQuery)}&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!listRes.ok) return;
    const listData = (await listRes.json()) as {
      messages?: { id: string }[];
    };
    if (!listData.messages?.length) return;

    const metadataHeaders = ["From", "To", "Cc"]
      .map((h) => `metadataHeaders=${h}`)
      .join("&");

    const details = await Promise.all(
      listData.messages.slice(0, 10).map(async (msg) => {
        const res = await fetch(
          `${GMAIL_BASE}/messages/${msg.id}?format=metadata&${metadataHeaders}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return null;
        return res.json() as Promise<{
          payload?: { headers?: { name: string; value: string }[] };
        }>;
      }),
    );

    for (const detail of details) {
      if (!detail?.payload?.headers) continue;
      for (const header of detail.payload.headers) {
        if (!["from", "to", "cc"].includes(header.name.toLowerCase())) continue;
        const addresses = header.value.split(",");
        for (const addr of addresses) {
          const parsed = parseSender(addr.trim());
          if (
            parsed.email &&
            parsed.email.includes("@") &&
            !seen.has(parsed.email) &&
            (parsed.name?.toLowerCase().includes(query.toLowerCase()) ||
              parsed.email.toLowerCase().includes(query.toLowerCase()))
          ) {
            seen.set(parsed.email, parsed);
          }
        }
      }
    }
  };

  if (allAccounts.length > 0) {
    await Promise.all(
      allAccounts.map(async (account) => {
        try {
          const token = await getValidTokenForAccount(account, stub, userId);
          await searchToken(token);
        } catch {
          // skip
        }
      }),
    );
  } else {
    const sessionRes = await stub.fetch(
      new Request("http://localhost/session", {
        method: "GET",
        headers: { "x-partykit-room": userId },
      }),
    );
    if (sessionRes.ok) {
      const session = (await sessionRes.json()) as GmailSession;
      try {
        const token = await getValidToken(session, stub, userId);
        await searchToken(token);
      } catch {
        // skip
      }
    }
  }

  const contacts = Array.from(seen.values())
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
    .slice(0, 10);

  return Response.json({ contacts });
}

async function handleEmailSearch(
  request: Request,
  env: Env,
): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  if (!query) return Response.json({ emails: [] });

  const stub = env.INBOX_AGENT.get(env.INBOX_AGENT.idFromName(userId));
  const allAccounts = await getAccountTokens(stub, userId);

  const searchWithToken = async (token: string, accountEmail: string) => {
    const listRes = await fetch(
      `${GMAIL_BASE}/messages?q=${encodeURIComponent(query)}&maxResults=8`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!listRes.ok) return [];
    const listData = (await listRes.json()) as {
      messages?: { id: string; threadId: string }[];
    };
    if (!listData.messages?.length) return [];

    const metadataHeaders = ["From", "Subject", "Date"]
      .map((h) => `metadataHeaders=${h}`)
      .join("&");

    const details = await Promise.all(
      listData.messages.map(async (msg) => {
        const res = await fetch(
          `${GMAIL_BASE}/messages/${msg.id}?format=metadata&${metadataHeaders}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return null;
        return res.json() as Promise<{
          id: string;
          threadId: string;
          snippet: string;
          internalDate: string;
          payload?: { headers?: { name: string; value: string }[] };
        }>;
      }),
    );

    return details
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map((d) => ({
        id: d.id,
        threadId: d.threadId,
        subject: extractHeader(d.payload?.headers, "Subject"),
        from: extractHeader(d.payload?.headers, "From"),
        snippet: d.snippet,
        date: new Date(Number(d.internalDate)).toISOString(),
        accountEmail,
      }));
  };

  let emails: Array<{
    id: string;
    threadId: string;
    subject: string;
    from: string;
    snippet: string;
    date: string;
    accountEmail: string;
  }> = [];

  if (allAccounts.length > 0) {
    const results = await Promise.all(
      allAccounts.map(async (account) => {
        try {
          const token = await getValidTokenForAccount(account, stub, userId);
          return await searchWithToken(token, account.email);
        } catch {
          return [];
        }
      }),
    );
    emails = results.flat();
  } else {
    const sessionRes = await stub.fetch(
      new Request("http://localhost/session", {
        method: "GET",
        headers: { "x-partykit-room": userId },
      }),
    );
    if (sessionRes.ok) {
      const session = (await sessionRes.json()) as GmailSession;
      try {
        const token = await getValidToken(session, stub, userId);
        emails = await searchWithToken(token, session.email);
      } catch {
        // skip
      }
    }
  }

  emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return Response.json({ emails: emails.slice(0, 10) });
}

async function handleLinkPreview(request: Request): Promise<Response> {
  const userId = getCookie(request);
  if (!userId) return new Response(null, { status: 401 });

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) return Response.json({ error: "Missing url" }, { status: 400 });

  try {
    new URL(targetUrl);
  } catch {
    return Response.json({ error: "Invalid url" }, { status: 400 });
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkPreview/1.0)",
        Accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) {
      return Response.json(
        { title: null, description: null, image: null, favicon: null },
        { headers: { "Cache-Control": "public, max-age=3600" } },
      );
    }

    const meta: Record<string, string> = {};
    let pageTitle = "";

    const rewriter = new HTMLRewriter()
      .on("meta[property]", {
        element(el) {
          const prop = el.getAttribute("property");
          const content = el.getAttribute("content");
          if (prop && content) meta[prop] = content;
        },
      })
      .on("meta[name]", {
        element(el) {
          const name = el.getAttribute("name");
          const content = el.getAttribute("content");
          if (name && content) meta[name] = content;
        },
      })
      .on("title", {
        text(chunk) {
          pageTitle += chunk.text;
        },
      })
      .on("link[rel]", {
        element(el) {
          const rel = el.getAttribute("rel") || "";
          const href = el.getAttribute("href");
          if (href && /icon/i.test(rel) && !meta._favicon) {
            meta._favicon = href;
          }
        },
      });

    await rewriter.transform(res).text();

    const origin = new URL(targetUrl);
    const resolve = (u: string) => {
      if (!u) return "";
      if (u.startsWith("http")) return u;
      if (u.startsWith("//")) return origin.protocol + u;
      if (u.startsWith("/")) return origin.origin + u;
      return origin.origin + "/" + u;
    };

    return Response.json(
      {
        title: meta["og:title"] || pageTitle.trim() || null,
        description: meta["og:description"] || meta.description || null,
        image: resolve(meta["og:image"] || "") || null,
        favicon: resolve(meta._favicon || "") || null,
        siteName: meta["og:site_name"] || null,
      },
      { headers: { "Cache-Control": "public, max-age=86400" } },
    );
  } catch {
    return Response.json({ error: "Failed to fetch" }, { status: 502 });
  }
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}
