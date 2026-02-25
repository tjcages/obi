export interface FeedItemEmailRef {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
}

export interface FeedItemFileRef {
  key: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface FeedItemLinkRef {
  url: string;
  title: string;
  description?: string;
}

export interface FeedItem {
  id: string;
  type: "note" | "email" | "image" | "file" | "link";
  content?: string;
  emailRef?: FeedItemEmailRef;
  fileRef?: FeedItemFileRef;
  linkRef?: FeedItemLinkRef;
  pinned?: boolean;
  highlighted?: boolean;
  imageWidth?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface CategoryWorkspace {
  name: string;
  description?: string;
  feed: FeedItem[];
  timelineOrder?: string[];
  createdAt: string;
  updatedAt: string;
}

function storageKey(category: string): string {
  return `workspace:${category}`;
}

export async function loadWorkspace(
  storage: DurableObjectStorage,
  category: string,
): Promise<CategoryWorkspace | null> {
  return (await storage.get<CategoryWorkspace>(storageKey(category))) ?? null;
}

export async function saveWorkspace(
  storage: DurableObjectStorage,
  workspace: CategoryWorkspace,
): Promise<void> {
  await storage.put(storageKey(workspace.name), workspace);
}

export async function getOrCreateWorkspace(
  storage: DurableObjectStorage,
  category: string,
): Promise<CategoryWorkspace> {
  const existing = await loadWorkspace(storage, category);
  if (existing) return existing;
  const now = new Date().toISOString();
  const ws: CategoryWorkspace = {
    name: category,
    feed: [],
    createdAt: now,
    updatedAt: now,
  };
  await saveWorkspace(storage, ws);
  return ws;
}

export async function addFeedItem(
  storage: DurableObjectStorage,
  category: string,
  item: Omit<FeedItem, "id" | "createdAt">,
): Promise<FeedItem> {
  const ws = await getOrCreateWorkspace(storage, category);
  const now = new Date().toISOString();
  const feedItem: FeedItem = {
    ...item,
    id: crypto.randomUUID(),
    createdAt: now,
  };
  ws.feed.unshift(feedItem);
  ws.updatedAt = now;
  await saveWorkspace(storage, ws);
  return feedItem;
}

export async function updateFeedItem(
  storage: DurableObjectStorage,
  category: string,
  itemId: string,
  updates: Partial<Pick<FeedItem, "content" | "linkRef" | "pinned" | "highlighted" | "imageWidth">>,
): Promise<FeedItem | null> {
  const ws = await loadWorkspace(storage, category);
  if (!ws) return null;
  const idx = ws.feed.findIndex((f) => f.id === itemId);
  if (idx === -1) return null;
  const item = ws.feed[idx];
  if (updates.content !== undefined) item.content = updates.content;
  if (updates.linkRef !== undefined) item.linkRef = updates.linkRef;
  if (updates.pinned !== undefined) item.pinned = updates.pinned || undefined;
  if (updates.highlighted !== undefined) item.highlighted = updates.highlighted || undefined;
  if (updates.imageWidth !== undefined) item.imageWidth = updates.imageWidth || undefined;
  item.updatedAt = new Date().toISOString();
  ws.updatedAt = item.updatedAt;
  await saveWorkspace(storage, ws);
  return item;
}

export async function deleteFeedItem(
  storage: DurableObjectStorage,
  category: string,
  itemId: string,
): Promise<boolean> {
  const ws = await loadWorkspace(storage, category);
  if (!ws) return false;
  const idx = ws.feed.findIndex((f) => f.id === itemId);
  if (idx === -1) return false;
  ws.feed.splice(idx, 1);
  ws.updatedAt = new Date().toISOString();
  await saveWorkspace(storage, ws);
  return true;
}

export async function updateWorkspaceDescription(
  storage: DurableObjectStorage,
  category: string,
  description: string,
): Promise<CategoryWorkspace | null> {
  const ws = await loadWorkspace(storage, category);
  if (!ws) return null;
  ws.description = description;
  ws.updatedAt = new Date().toISOString();
  await saveWorkspace(storage, ws);
  return ws;
}

export async function reorderTimeline(
  storage: DurableObjectStorage,
  category: string,
  orderedIds: string[],
): Promise<void> {
  const ws = await getOrCreateWorkspace(storage, category);
  ws.timelineOrder = orderedIds;
  ws.updatedAt = new Date().toISOString();
  await saveWorkspace(storage, ws);
}

export function buildWorkspaceContext(workspace: CategoryWorkspace): string {
  const parts: string[] = [];
  parts.push(`ACTIVE WORKSPACE: "${workspace.name}"`);
  if (workspace.description) {
    parts.push(`Description: ${workspace.description}`);
  }

  const notes = workspace.feed.filter((f) => f.type === "note" && f.content);
  const emails = workspace.feed.filter((f) => f.type === "email" && f.emailRef);
  const links = workspace.feed.filter((f) => f.type === "link" && f.linkRef);

  if (notes.length > 0) {
    parts.push(`\nWorkspace notes (${notes.length}):`);
    for (const n of notes.slice(0, 20)) {
      parts.push(`- ${n.content!.slice(0, 200)}`);
    }
  }

  if (emails.length > 0) {
    parts.push(`\nPinned emails (${emails.length}):`);
    for (const e of emails.slice(0, 10)) {
      const r = e.emailRef!;
      parts.push(`- From: ${r.from} — ${r.subject}`);
    }
  }

  if (links.length > 0) {
    parts.push(`\nSaved links (${links.length}):`);
    for (const l of links.slice(0, 10)) {
      const r = l.linkRef!;
      parts.push(`- ${r.title}: ${r.url}`);
    }
  }

  parts.push(
    `\nThe user is currently viewing this workspace. Use the workspace context above when answering questions about "${workspace.name}". You can add notes to this workspace via the add_workspace_note tool.`,
  );

  return parts.join("\n");
}
