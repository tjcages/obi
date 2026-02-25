import { useCallback, useEffect, useState } from "react";

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
  favicon?: string;
  image?: string;
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

export interface UseWorkspaceReturn {
  workspace: CategoryWorkspace | null;
  loading: boolean;
  addNote: (content: string) => Promise<FeedItem | null>;
  addLink: (url: string, meta?: { title?: string; description?: string; favicon?: string; image?: string }) => Promise<FeedItem | null>;
  pinEmail: (ref: FeedItemEmailRef) => Promise<FeedItem | null>;
  uploadFile: (file: File) => Promise<FeedItem | null>;
  updateItem: (itemId: string, updates: { content?: string; linkRef?: FeedItemLinkRef; pinned?: boolean; highlighted?: boolean; imageWidth?: number }) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  updateDescription: (description: string) => Promise<void>;
  reorderTimeline: (orderedIds: string[]) => Promise<void>;
  refresh: () => Promise<void>;
}

function apiBase(category: string) {
  return `/api/workspace/${encodeURIComponent(category)}`;
}

export function useWorkspace(category: string | null): UseWorkspaceReturn {
  const [workspace, setWorkspace] = useState<CategoryWorkspace | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!category) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase(category)}`);
      if (res.ok) {
        const data = await res.json() as { workspace: CategoryWorkspace };
        setWorkspace(data.workspace);
      }
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    if (category) {
      void refresh();
    } else {
      setWorkspace(null);
    }
  }, [category, refresh]);

  const addNote = useCallback(async (content: string): Promise<FeedItem | null> => {
    if (!category) return null;

    const MERGE_WINDOW_MS = 5 * 60 * 1000;
    const latest = workspace?.feed[0];
    if (latest?.type === "note" && latest.content) {
      const elapsed = Date.now() - new Date(latest.updatedAt ?? latest.createdAt).getTime();
      if (elapsed < MERGE_WINDOW_MS) {
        const merged = `${content}\n\n${latest.content}`;
        const res = await fetch(`${apiBase(category)}/feed/${latest.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: merged }),
        });
        if (res.ok) {
          const { item } = await res.json() as { item: FeedItem };
          setWorkspace((prev) => prev ? { ...prev, feed: prev.feed.map((f) => f.id === item.id ? item : f) } : prev);
          return item;
        }
      }
    }

    const res = await fetch(`${apiBase(category)}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "note", content }),
    });
    if (!res.ok) return null;
    const { item } = await res.json() as { item: FeedItem };
    setWorkspace((prev) => prev ? { ...prev, feed: [item, ...prev.feed], updatedAt: item.createdAt } : prev);
    return item;
  }, [category, workspace?.feed]);

  const addLink = useCallback(async (url: string, meta?: { title?: string; description?: string; favicon?: string; image?: string }): Promise<FeedItem | null> => {
    if (!category) return null;

    let linkRef: FeedItemLinkRef = {
      url,
      title: meta?.title || url,
      description: meta?.description,
      favicon: meta?.favicon,
      image: meta?.image,
    };

    if (!meta?.title) {
      try {
        const preview = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
        if (preview.ok) {
          const data = await preview.json() as Record<string, string | null>;
          linkRef.title = data.title || linkRef.title;
          linkRef.description = data.description || linkRef.description;
          linkRef.image = data.image || undefined;
          linkRef.favicon = data.favicon || undefined;
        }
      } catch { /* proceed with basic metadata */ }
    }

    if (!linkRef.title || linkRef.title === url) {
      try { linkRef.title = new URL(url).hostname; } catch { /* keep url */ }
    }

    if (!linkRef.favicon) {
      try { linkRef.favicon = `https://icons.duckduckgo.com/ip3/${new URL(url).hostname}.ico`; } catch { /* skip */ }
    }

    const res = await fetch(`${apiBase(category)}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "link", linkRef }),
    });
    if (!res.ok) return null;
    const { item } = await res.json() as { item: FeedItem };
    setWorkspace((prev) => prev ? { ...prev, feed: [item, ...prev.feed], updatedAt: item.createdAt } : prev);
    return item;
  }, [category]);

  const pinEmail = useCallback(async (ref: FeedItemEmailRef): Promise<FeedItem | null> => {
    if (!category) return null;
    const res = await fetch(`${apiBase(category)}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "email", emailRef: ref }),
    });
    if (!res.ok) return null;
    const { item } = await res.json() as { item: FeedItem };
    setWorkspace((prev) => prev ? { ...prev, feed: [item, ...prev.feed], updatedAt: item.createdAt } : prev);
    return item;
  }, [category]);

  const uploadFile = useCallback(async (file: File): Promise<FeedItem | null> => {
    if (!category) return null;
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${apiBase(category)}/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) return null;
    const { item } = await res.json() as { item: FeedItem };
    setWorkspace((prev) => prev ? { ...prev, feed: [item, ...prev.feed], updatedAt: item.createdAt } : prev);
    return item;
  }, [category]);

  const updateItem = useCallback(async (itemId: string, updates: { content?: string; linkRef?: FeedItemLinkRef; pinned?: boolean; highlighted?: boolean; imageWidth?: number }) => {
    if (!category) return;
    const res = await fetch(`${apiBase(category)}/feed/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const { item } = await res.json() as { item: FeedItem };
      setWorkspace((prev) => {
        if (!prev) return prev;
        return { ...prev, feed: prev.feed.map((f) => f.id === itemId ? item : f) };
      });
    }
  }, [category]);

  const deleteItem = useCallback(async (itemId: string) => {
    if (!category) return;
    const res = await fetch(`${apiBase(category)}/feed/${itemId}`, { method: "DELETE" });
    if (res.ok) {
      setWorkspace((prev) => {
        if (!prev) return prev;
        return { ...prev, feed: prev.feed.filter((f) => f.id !== itemId) };
      });
    }
  }, [category]);

  const updateDescription = useCallback(async (description: string) => {
    if (!category) return;
    await fetch(`${apiBase(category)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    setWorkspace((prev) => prev ? { ...prev, description } : prev);
  }, [category]);

  const reorderTimeline = useCallback(async (orderedIds: string[]) => {
    if (!category) return;
    setWorkspace((prev) => prev ? { ...prev, timelineOrder: orderedIds } : prev);
    await fetch(`${apiBase(category)}/timeline/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
  }, [category]);

  return { workspace, loading, addNote, addLink, pinEmail, uploadFile, updateItem, deleteItem, updateDescription, reorderTimeline, refresh };
}
