/// <reference types="vite/client" />

interface Env {
  INBOX_AGENT: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** Re-enable in wrangler.json: "worker_loaders": [{ "binding": "LOADER" }] */
  LOADER?: WorkerLoader;
  AI: Ai;
  INBOX_DOG_CLIENT_ID: string;
  INBOX_DOG_CLIENT_SECRET: string;
}
