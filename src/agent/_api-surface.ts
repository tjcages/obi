/**
 * Compact API surface for the agent. Not stuffed into context as prose—
 * this is the "door" the agent can open when it needs to use Gmail.
 * Keep it minimal: types/shape only, no instructions.
 */
export const GMAIL_API_SURFACE = `
Gmail API (base: /gmail/v1/users/me). In codemode you have:

  gmail_get({ path: string }): GET. path is relative, e.g. "/profile", "/messages?q=is:unread&maxResults=5"
  gmail_post({ path: string, body: object }): POST. e.g. path "/messages/send"

List: GET /messages?q=...&maxResults=N  →  { messages: [{ id, threadId }], resultSizeEstimate, nextPageToken }
  DEFAULT SEARCH SCOPE: Always use "in:inbox" in your q= parameter unless the user explicitly asks to search all mail, trash, spam, or a specific label. Users primarily care about their active inbox.
  IMPORTANT: resultSizeEstimate is UNRELIABLE — it is a rough estimate, often wildly inaccurate (e.g. returns 201 when there are thousands). NEVER report resultSizeEstimate to the user as a count.
  To count emails accurately: use GET /profile → messagesTotal (total in account) or paginate through all results using nextPageToken.
  To get more results: pass nextPageToken as pageToken in the next request. Each page returns up to maxResults (max 500).
One:  GET /messages/{id}               →  message with payload.headers, snippet, and payload.parts
  (Email body "data" fields are automatically decoded to plain text/HTML for you)
Meta: GET /profile                     →  { emailAddress, messagesTotal, threadsTotal, historyId }
  Use this for accurate total email/thread counts.
`;
