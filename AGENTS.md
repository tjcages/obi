# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Gmail Chat ("obi") is a Cloudflare Workers app that lets users chat with their Gmail inbox via AI. Single worker serves React frontend + Durable Object backend. See `README.md` for architecture details.

### Key commands

| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Dev server (with HMR) | `bun run dev` (requires Cloudflare auth, see below) |
| Dev server (local-only) | `bun run build && npx wrangler dev --local` |
| Lint | `bun run lint` |
| Type check | `bun run typecheck` |
| Unit tests | `bun run test` |
| E2E tests | `bun run test:e2e:codemode` |
| Build | `bun run build` |

### Running the dev server

**`bun run dev` (Vite + Cloudflare plugin):** Requires Cloudflare authentication because the `@cloudflare/vite-plugin` defaults `remoteBindings: true`, which proxies the AI binding through Cloudflare's infrastructure. Without a `CLOUDFLARE_API_TOKEN` env var or `wrangler login`, this will fail with "Failed to start the remote proxy session."

**`wrangler dev --local` (local-only fallback):** Run `bun run build` first, then `npx wrangler dev --local`. This starts the worker locally on port 8787 with simulated bindings. The AI binding shows as "not supported" and the service binding to `inbox-dog-oauth-production` shows as "not connected", but the frontend loads and the OAuth flow works (redirects to Google sign-in via inbox.dog).

### Environment files

- `.env` — inbox.dog OAuth credentials (`INBOX_DOG_CLIENT_ID`, `INBOX_DOG_CLIENT_SECRET`). Copy from `.env.example`.
- `.dev.vars` — Wrangler-specific dev vars. Should also contain the inbox.dog credentials plus `TEST_INJECT_SECRET=dev-secret` for E2E tests. Copy from `.dev.vars.example`.
- Secrets `INBOX_DOG_CLIENT_ID` and `INBOX_DOG_CLIENT_SECRET` are injected as environment variables and should be written to both `.env` and `.dev.vars`.

### Pre-existing test failures

Unit tests (`bun run test`) have 6 pre-existing failures in `ToolInvocation.test.ts` (missing `document` — needs jsdom environment) and `GmailBridge.test.ts` (mock constructor issue). 12 of 18 tests pass.

### Bun

The project uses Bun as its package manager (lockfile: `bun.lock`). Bun is not pre-installed in the VM and must be installed via `curl -fsSL https://bun.sh/install | bash`. After install, add `~/.bun/bin` to `PATH`.
