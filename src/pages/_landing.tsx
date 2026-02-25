import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Envelope,
  ChatCircleDots,
  CheckSquare,
  UsersThree,
  Brain,
  MagnifyingGlass,
  Lightning,
  ArrowRight,
  PaperPlaneTilt,
  CalendarBlank,
} from "@phosphor-icons/react";
import { cn } from "../lib";

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={20} height={20} aria-hidden>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

/** Server config error we don't show to users — we show the login UI instead */
const CONFIG_ERROR_PATTERN = "INBOX_DOG_CLIENT_ID not set";

const ERROR_MAP: Record<string, string> = {
  "OAuthState not found": "Your sign-in link expired. Please try again.",
  "INVALID_CREDENTIALS": "Invalid credentials. Check your inbox.dog client ID and secret.",
  "missing credentials": "Server credentials not configured.",
  "exchange failed": "Sign-in failed. Please try again.",
};

function friendlyError(raw: string): string {
  const decoded = decodeURIComponent(raw);
  for (const [key, msg] of Object.entries(ERROR_MAP)) {
    if (decoded.includes(key)) return msg;
  }
  return decoded;
}

const GITHUB_URL = "https://github.com/acoyfellow/inbox.dog/tree/main/examples/gmail-chat";

const FEATURES = [
  {
    icon: ChatCircleDots,
    title: "Ask your inbox anything",
    desc: "Chat naturally to find emails, summarize threads, or draft replies. Obi understands context.",
    color: "bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400",
  },
  {
    icon: CheckSquare,
    title: "Todos from your email",
    desc: "AI scans your inbox and suggests action items. Organize them by category, date, and priority.",
    color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
  },
  {
    icon: UsersThree,
    title: "Multi-account support",
    desc: "Connect multiple Gmail accounts. Switch between them seamlessly with color-coded badges.",
    color: "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400",
  },
  {
    icon: Brain,
    title: "Memory that persists",
    desc: "Obi remembers names, preferences, and context across conversations. No repeating yourself.",
    color: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
  },
  {
    icon: PaperPlaneTilt,
    title: "Compose & reply",
    desc: "Draft, reply, and forward emails with a rich editor. Mention contacts with @people.",
    color: "bg-pink-100 text-pink-600 dark:bg-pink-900/40 dark:text-pink-400",
  },
  {
    icon: CalendarBlank,
    title: "Calendar & scheduling",
    desc: "Schedule todos with date pickers. See what's coming up in a compact weekly view.",
    color: "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400",
  },
];

const CONVERSATION = [
  { role: "user" as const, text: "What emails need my attention today?" },
  {
    role: "assistant" as const,
    text: "You have 3 emails that need action: a contract from Sarah needing your signature, a meeting invite from the design team for Thursday, and a follow-up from Alex about the Q1 report.",
  },
  { role: "user" as const, text: "Create a todo to review the Q1 report by Friday." },
  { role: "assistant" as const, text: "Done — added \"Review Q1 report\" to your todos, due Friday." },
];

const BUILT_WITH = [
  { label: "ai sdk", href: "https://sdk.vercel.ai" },
  { label: "agents", href: "https://developers.cloudflare.com/agents/" },
  { label: "inbox.dog", href: "https://inbox.dog" },
  { label: "worker loaders", href: "https://developers.cloudflare.com/workers/platform/worker-loaders/" },
];

export default function Landing({
  authUrl,
  authUrlError,
  error,
}: {
  authUrl: string | null;
  authUrlError: string | null;
  error: string | null;
}) {
  const rawError = error ?? authUrlError;
  const isConfigError = rawError?.includes(CONFIG_ERROR_PATTERN) ?? false;
  const displayError = rawError && !isConfigError ? friendlyError(rawError) : null;
  const [mounted, setMounted] = useState(false);

  async function handleConnectClick() {
    if (authUrl) {
      window.location.href = authUrl;
      return;
    }
    try {
      const res = await fetch("/api/auth-url");
      const data = (await res.json()) as { authUrl?: string; error?: string };
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        toast.error(data.error ?? "Sign-in is not configured for this deployment.");
      }
    } catch {
      toast.error("Failed to load sign-in. Please try again.");
    }
  }

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  return (
    <div className="relative h-full w-full overflow-y-auto overflow-x-hidden bg-background-100 text-foreground-100">
      {/* Ambient glow */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: `
            radial-gradient(ellipse at 30% 20%, rgba(var(--glow-r), var(--glow-g), var(--glow-b), var(--glow-opacity)) 0%, transparent 50%),
            radial-gradient(ellipse at 70% 60%, rgba(var(--glow-r), var(--glow-g), var(--glow-b), calc(var(--glow-opacity) * 0.5)) 0%, transparent 50%)
          `,
        }}
      />

      {/* Top bar */}
      <header className="fixed top-0 right-0 left-0 z-20 flex items-center justify-between px-6 py-4">
        <a href="https://inbox.dog" className="opacity-70 transition-opacity hover:opacity-100" aria-label="inbox.dog">
          <img
            src="https://inbox.dog/logo.svg"
            alt=""
            className="h-6 w-auto dark:invert"
          />
        </a>
        <div className="flex items-center gap-1">
          <a
            href={GITHUB_URL}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
            aria-label="View on GitHub"
          >
            <GitHubIcon />
          </a>
        </div>
      </header>

      {/* Content */}
      <main className="relative z-10 mx-auto max-w-3xl px-6 pt-28 pb-24">

        {/* Hero */}
        <section
          className={cn(
            "text-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
            mounted ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
          )}
        >
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border-100 bg-background-200 px-4 py-1.5 font-mono text-xs text-foreground-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
            </span>
            open source
          </div>

          <h1 className="font-heading text-5xl leading-[1.08] font-semibold tracking-tight sm:text-6xl">
            <span className="text-foreground-300">Your inbox,</span>
            <br />
            <span
              className="bg-linear-to-r from-(--gradient-from) to-(--gradient-to) bg-clip-text text-transparent"
            >
              reimagined.
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-lg text-lg leading-relaxed font-light text-foreground-300">
            Obi is an AI assistant for Gmail that reads, writes, and organizes
            your email — so you can focus on what matters.
          </p>

          {/* CTA */}
          <div
            className={cn(
              "mt-8 transition-all delay-100 duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
              mounted ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
            )}
          >
            {displayError && (
              <div className="mx-auto mb-4 max-w-sm rounded-lg border border-destructive-100/20 bg-destructive-100/5 px-4 py-3 text-sm text-destructive-100" role="alert">
                {displayError}
                {displayError.includes("credentials") && (
                  <p className="mt-1 text-xs opacity-70">
                    Set INBOX_DOG_CLIENT_ID and INBOX_DOG_CLIENT_SECRET in your Worker env.
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              className="inline-flex items-center gap-2.5 rounded-full bg-accent-100 px-7 py-3.5 text-[15px] font-medium text-white transition-all hover:-translate-y-0.5 hover:bg-accent-100/90 hover:shadow-lg hover:shadow-accent-100/20 active:translate-y-0"
              onClick={handleConnectClick}
            >
              <GoogleIcon />
              Connect with Google
            </button>
          </div>
        </section>

        {/* Conversation demo */}
        <section
          className={cn(
            "mt-20 transition-all delay-200 duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
            mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
          )}
        >
          <div className="mb-6 flex items-center justify-center gap-2 text-xs font-medium tracking-wider text-foreground-300 uppercase">
            <ChatCircleDots weight="duotone" className="h-4 w-4" />
            How it works
          </div>

          <div className="rounded-xl border border-border-100 bg-background-200/50 p-5 sm:p-6">
            <div className="space-y-4">
              {CONVERSATION.map((msg, i) => (
                <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed",
                      msg.role === "user"
                        ? "bg-accent-100/10 text-foreground-200 border border-accent-100/20"
                        : "bg-background-100 border border-border-100 text-foreground-200",
                    )}
                  >
                    {msg.role === "assistant" && (
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-accent-100">
                        <Lightning weight="fill" className="h-3 w-3" />
                        Obi
                      </div>
                    )}
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section
          className={cn(
            "mt-20 transition-all delay-300 duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
            mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
          )}
        >
          <div className="mb-8 text-center">
            <div className="mb-3 flex items-center justify-center gap-2 text-xs font-medium tracking-wider text-foreground-300 uppercase">
              <Lightning weight="duotone" className="h-4 w-4" />
              Features
            </div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              Everything you need,{" "}
              <span className="text-foreground-300">nothing you don't.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-xl border border-border-100 bg-background-100 p-5 transition-colors hover:border-foreground-300/20"
              >
                <div className={cn("mb-3 inline-flex rounded-lg p-2.5", f.color)}>
                  <f.icon weight="duotone" className="h-5 w-5" />
                </div>
                <h3 className="mb-1.5 text-sm font-semibold">{f.title}</h3>
                <p className="text-sm leading-relaxed text-foreground-300">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works steps */}
        <section
          className={cn(
            "mt-20 transition-all delay-400 duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
            mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
          )}
        >
          <div className="mb-8 text-center">
            <div className="mb-3 flex items-center justify-center gap-2 text-xs font-medium tracking-wider text-foreground-300 uppercase">
              <ArrowRight weight="bold" className="h-4 w-4" />
              Get started
            </div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              Up and running{" "}
              <span className="text-foreground-300">in seconds.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              {
                step: "01",
                icon: Envelope,
                title: "Connect Gmail",
                desc: "Sign in with Google OAuth. Your data stays on Cloudflare's edge — nothing is stored on third-party servers.",
              },
              {
                step: "02",
                icon: MagnifyingGlass,
                title: "Ask anything",
                desc: "Search, summarize, compose, or organize. Just describe what you need in natural language.",
              },
              {
                step: "03",
                icon: CheckSquare,
                title: "Stay organized",
                desc: "Obi surfaces action items, creates todos, and keeps your inbox under control automatically.",
              },
            ].map((s) => (
              <div key={s.step} className="text-center">
                <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full border border-border-100 bg-background-200">
                  <s.icon weight="duotone" className="h-5 w-5 text-accent-100" />
                </div>
                <div className="mb-2 font-mono text-xs text-foreground-300">{s.step}</div>
                <h3 className="mb-1 text-sm font-semibold">{s.title}</h3>
                <p className="text-sm leading-relaxed text-foreground-300">{s.desc}</p>
              </div>
            ))}
          </div>

          {/* Secondary CTA */}
          <div className="mt-10 text-center">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-border-100 bg-background-200 px-6 py-3 text-sm font-medium text-foreground-200 transition-all hover:-translate-y-0.5 hover:border-accent-100/40 hover:text-foreground-100"
              onClick={handleConnectClick}
            >
              <GoogleIcon />
              Get started — it's free
              <ArrowRight weight="bold" className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>

        {/* Built with */}
        <footer
          className={cn(
            "mt-20 border-t border-border-100 pt-8 text-center transition-all delay-500 duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
            mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
          )}
        >
          <p className="mb-4 text-xs font-medium tracking-wider text-foreground-300 uppercase">
            Built with
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {BUILT_WITH.map((s) => (
              <a
                key={s.label}
                href={s.href}
                className="rounded-md border border-border-100 bg-background-200 px-3 py-1.5 font-mono text-xs text-foreground-300 transition-colors hover:border-accent-100/40 hover:text-foreground-200"
              >
                {s.label}
              </a>
            ))}
          </div>
        </footer>
      </main>
    </div>
  );
}
