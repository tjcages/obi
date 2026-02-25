# Adding a redirect URI to inbox.dog

The inbox.dog OAuth service validates `redirect_uri` against an allowlist per API key. To add `https://obi.r.workers.dev/callback`, you need the PATCH endpoint deployed.

## Option 1: Run the script (after PATCH is deployed)

```bash
# Load credentials from .env or .dev.vars
bun run add-redirect-uri
# Or with a custom URI:
bun run add-redirect-uri https://your-domain.com/callback
```

## Option 2: Add PATCH endpoint to inbox.dog

The inbox.dog API doesn't yet support updating redirect URIs for existing keys. A patch is in `inbox-dog-patch-add-redirect-uri.patch`.

To add the PATCH endpoint:

1. Clone inbox.dog: `git clone https://github.com/acoyfellow/inbox.dog`
2. Apply the patch: `cd inbox.dog && git apply /path/to/obi/scripts/inbox-dog-patch-add-redirect-uri.patch`
3. Open a PR to acoyfellow/inbox.dog, or deploy your fork if you self-host

The patch adds `PATCH /api/keys/:clientId` which accepts `{ "redirect_uris": ["https://..."] }` and merges them into the existing allowlist.
