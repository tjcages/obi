import { DurableObject } from "cloudflare:workers";
import { InboxDog } from "inbox.dog";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface ScheduledEmail {
  id: string;
  userId: string;
  accountEmail: string;
  threadId: string;
  draftId: string;
  scheduledAt: number;
  subject: string;
  to: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  error?: string;
  createdAt: number;
  sentAt?: number;
  /** Stored encrypted-at-rest in DO storage — needed to send at alarm time */
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

interface ScheduledSenderEnv {
  INBOX_AGENT: DurableObjectNamespace;
}

export class ScheduledSender extends DurableObject<ScheduledSenderEnv> {
  private async getScheduledEmails(): Promise<ScheduledEmail[]> {
    return (await this.ctx.storage.get<ScheduledEmail[]>("emails")) ?? [];
  }

  private async saveScheduledEmails(emails: ScheduledEmail[]): Promise<void> {
    await this.ctx.storage.put("emails", emails);
  }

  private async setNextAlarm(emails: ScheduledEmail[]): Promise<void> {
    const pending = emails
      .filter((e) => e.status === "pending")
      .sort((a, b) => a.scheduledAt - b.scheduledAt);

    if (pending.length > 0) {
      await this.ctx.storage.setAlarm(pending[0].scheduledAt);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async schedule(email: Omit<ScheduledEmail, "status" | "createdAt">): Promise<ScheduledEmail> {
    const entry: ScheduledEmail = {
      ...email,
      status: "pending",
      createdAt: Date.now(),
    };

    const emails = await this.getScheduledEmails();
    emails.push(entry);
    await this.saveScheduledEmails(emails);
    await this.setNextAlarm(emails);

    return entry;
  }

  async cancel(emailId: string): Promise<boolean> {
    const emails = await this.getScheduledEmails();
    const idx = emails.findIndex((e) => e.id === emailId && e.status === "pending");
    if (idx === -1) return false;

    const email = emails[idx];

    try {
      const token = await this.getValidToken(email);
      await fetch(`${GMAIL_BASE}/drafts/${email.draftId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Best-effort draft cleanup — don't block cancellation
    }

    email.status = "cancelled";
    email.accessToken = "";
    email.refreshToken = "";
    email.clientId = "";
    email.clientSecret = "";

    await this.saveScheduledEmails(emails);
    await this.setNextAlarm(emails);
    return true;
  }

  async list(): Promise<ScheduledEmail[]> {
    const emails = await this.getScheduledEmails();
    return emails.map((e) => ({
      ...e,
      accessToken: "",
      refreshToken: "",
      clientId: "",
      clientSecret: "",
    }));
  }

  override async alarm(): Promise<void> {
    const emails = await this.getScheduledEmails();
    const now = Date.now();

    const due = emails.filter((e) => e.status === "pending" && e.scheduledAt <= now);

    for (const email of due) {
      try {
        const token = await this.getValidToken(email);
        await this.sendDraft(token, email.draftId);
        email.status = "sent";
        email.sentAt = Date.now();
        email.accessToken = "";
        email.refreshToken = "";
        email.clientId = "";
        email.clientSecret = "";
      } catch (e) {
        email.status = "failed";
        email.error = e instanceof Error ? e.message : "Unknown error";
      }
    }

    await this.saveScheduledEmails(emails);
    await this.setNextAlarm(emails);
  }

  private async getValidToken(email: ScheduledEmail): Promise<string> {
    let token = email.accessToken;

    const testRes = await fetch(`${GMAIL_BASE}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (testRes.status === 401 && email.refreshToken) {
      const dog = new InboxDog({ fetch: globalThis.fetch.bind(globalThis) });
      const refreshed = await dog.refreshToken(
        email.refreshToken,
        email.clientId,
        email.clientSecret,
      );
      token = refreshed.access_token;

      const emails = await this.getScheduledEmails();
      const entry = emails.find((e) => e.id === email.id);
      if (entry) {
        entry.accessToken = token;
        await this.saveScheduledEmails(emails);
      }
    } else if (!testRes.ok) {
      throw new Error(`Gmail API returned ${testRes.status}`);
    }

    return token;
  }

  private async sendDraft(token: string, draftId: string): Promise<void> {
    const res = await fetch(`${GMAIL_BASE}/drafts/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: draftId }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gmail send failed (${res.status}): ${text}`);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/schedule" && request.method === "POST") {
      const data = await request.json() as Omit<ScheduledEmail, "status" | "createdAt">;
      const result = await this.schedule(data);
      return Response.json({ success: true, scheduled: sanitize(result) });
    }

    if (path === "/cancel" && request.method === "POST") {
      const { id } = await request.json() as { id: string };
      const ok = await this.cancel(id);
      if (!ok) return Response.json({ error: "Not found or already processed" }, { status: 404 });
      return Response.json({ success: true });
    }

    if (path === "/list" && request.method === "GET") {
      const emails = await this.list();
      return Response.json({ scheduled: emails });
    }

    return new Response("Not found", { status: 404 });
  }
}

function sanitize(e: ScheduledEmail): Omit<ScheduledEmail, "accessToken" | "refreshToken" | "clientId" | "clientSecret"> & { accessToken: string; refreshToken: string; clientId: string; clientSecret: string } {
  return { ...e, accessToken: "", refreshToken: "", clientId: "", clientSecret: "" };
}
