export type ChatErrorView = {
  title: string;
  detail: string;
};

export function formatChatError(error: Error | undefined): ChatErrorView | null {
  if (!error) return null;
  const message = typeof error.message === "string" ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("credit balance is too low")
    || lower.includes("quota")
    || lower.includes("insufficient")
    || lower.includes("workers ai")
    || lower.includes("neurons")
  ) {
    return {
      title: "Cloudflare AI quota or billing issue",
      detail: `Chat failed because Workers AI rejected the request: ${message}`,
    };
  }

  return {
    title: "Chat request failed",
    detail: message,
  };
}
