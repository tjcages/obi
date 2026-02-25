#!/usr/bin/env bun
/**
 * Add a redirect URI to your inbox.dog API key.
 * Usage: bun scripts/add-redirect-uri.ts [redirect_uri]
 *
 * Requires INBOX_DOG_CLIENT_ID and INBOX_DOG_CLIENT_SECRET in env or .env.
 * Default redirect_uri: https://obi.r.workers.dev/callback
 *
 * Note: inbox.dog must support PATCH /api/keys/:clientId. If you get 404,
 * the endpoint may need to be deployed (see inbox.dog repo).
 */

const redirectUri =
  process.argv[2] || "https://obi.r.workers.dev/callback";
const clientId = process.env.INBOX_DOG_CLIENT_ID;
const clientSecret = process.env.INBOX_DOG_CLIENT_SECRET;
const base = process.env.INBOX_DOG_URL || "https://inbox.dog";

if (!clientId || !clientSecret) {
  console.error("Missing INBOX_DOG_CLIENT_ID or INBOX_DOG_CLIENT_SECRET");
  console.error("Set them in .env or .dev.vars");
  process.exit(1);
}

const res = await fetch(`${base}/api/keys/${clientId}`, {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    "X-Client-Secret": clientSecret,
  },
  body: JSON.stringify({ redirect_uris: [redirectUri] }),
});

const data = (await res.json()) as {
  redirect_uris?: string[];
  error?: { message?: string };
};

if (!res.ok) {
  console.error("Error:", data);
  process.exit(1);
}

console.log("Added redirect URI. Updated allowlist:", data.redirect_uris);
