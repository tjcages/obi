import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "../../lib";
import type { FeedItem, FeedItemFileRef, FeedItemLinkRef, CategoryColor } from "../../lib";
import { ImageLightbox, type EmailImage } from "../email/_image-gallery";
import { SmartText } from "../smart-input";
import { SwipeableEmailRow } from "../ui/_swipeable-email-row";
import { useListContext } from "../ui";

interface FeedItemRendererProps {
  item: FeedItem;
  onUpdate: (itemId: string, updates: { content?: string; linkRef?: FeedItemLinkRef; pinned?: boolean; highlighted?: boolean }) => Promise<void>;
  onDelete: (itemId: string) => Promise<void>;
  onEmailClick?: (threadId: string, accountEmail?: string) => void;
  clustered?: "first" | "middle" | "last" | "only";
  categoryColor?: CategoryColor;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function FeedItemRenderer({ item, onUpdate, onDelete, onEmailClick, clustered, categoryColor }: FeedItemRendererProps) {
  const [hovering, setHovering] = useState(false);
  const isNote = item.type === "note";
  const isImage = item.type === "image";
  const isPinned = !!item.pinned;
  const isHighlighted = !!item.highlighted;

  const borderRadius = (() => {
    if (isNote) return "";
    if (!clustered || clustered === "only") return "rounded-lg";
    if (clustered === "first") return "rounded-t-lg rounded-b-none";
    if (clustered === "middle") return "rounded-none";
    return "rounded-b-lg rounded-t-none";
  })();

  const borderTop = !isNote && !isImage && (clustered === "middle" || clustered === "last")
    ? "border-t-0"
    : "";

  const highlightStyle = isHighlighted && categoryColor
    ? { borderLeftColor: categoryColor.hex, backgroundColor: `${categoryColor.hex}08` }
    : undefined;

  const togglePin = () => void onUpdate(item.id, { pinned: !isPinned });
  const toggleHighlight = () => void onUpdate(item.id, { highlighted: !isHighlighted });

  return (
    <SwipeableEmailRow
      onArchive={() => void onDelete(item.id)}
      archiveLabel="Delete"
      compact
      className="bg-background-100"
      layoutAnimation={false}
    >
    <div
      className={cn(
        "group relative",
        isNote
          ? cn(
              "rounded-lg border border-transparent transition-[border-color,background-color,box-shadow] duration-150",
              isPinned
                ? "border-border-100/60 bg-background-100/80 hover:shadow-sm"
                : isHighlighted
                  ? "border-l-[3px] border-l-current rounded-l-sm hover:shadow-sm"
                  : "bg-transparent hover:border-border-100/80 hover:bg-background-100 hover:shadow-sm",
            )
          : isImage
            ? "overflow-hidden rounded-lg border border-border-100/50 bg-background-100 transition-shadow hover:shadow-sm"
            : cn(
                "border border-border-100/80 bg-background-100 transition-shadow hover:shadow-sm",
                borderRadius,
                borderTop,
              ),
      )}
      style={isNote ? highlightStyle : undefined}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Pinned indicator */}
      {isPinned && isNote && (
        <div className="flex items-center gap-1 px-4 pt-2 pb-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/40">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
          <span className="text-[10px] font-medium text-foreground-300/40">Pinned</span>
        </div>
      )}

      <div className={cn(isImage ? "" : "px-4 py-3", isPinned && isNote && "pt-1.5")}>
        {item.type === "note" && <NoteContent item={item} onUpdate={onUpdate} />}
        {item.type === "email" && <EmailContent item={item} onEmailClick={onEmailClick} />}
        {item.type === "image" && <ImageContent item={item} />}
        {item.type === "file" && <FileContent item={item} />}
        {item.type === "link" && <LinkContent item={item} />}
      </div>

      {isImage ? (
        <>
          {isPinned && !hovering && (
            <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 backdrop-blur-sm">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
              </svg>
              <span className="text-[10px] font-medium text-white/70">Pinned</span>
            </div>
          )}
          {hovering && (
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
              <button
                type="button"
                onClick={togglePin}
                className={cn(
                  "rounded-full bg-black/50 p-1 backdrop-blur-sm transition-colors hover:text-white",
                  isPinned ? "text-white" : "text-white/70",
                )}
                title={isPinned ? "Unpin" : "Pin to top"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth={isPinned ? "1" : "2"} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 17v5" />
                  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => void onDelete(item.id)}
                className="rounded-full bg-black/50 p-1 text-white/70 backdrop-blur-sm transition-colors hover:text-white"
                title="Remove"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
        </>
      ) : (
        <div className={cn(
          "flex items-center justify-between px-4 pb-2 pt-0",
          (!clustered || clustered === "last" || clustered === "only") ? "" : "pb-2",
        )}>
          <span className="text-[10px] text-foreground-300/50">{formatTime(item.createdAt)}</span>
          <div className={cn(
            "flex items-center gap-0.5 transition-opacity duration-150",
            hovering ? "opacity-100" : "pointer-events-none opacity-0",
          )}>
            <button
              type="button"
              onClick={toggleHighlight}
              className={cn(
                "rounded p-1 transition-colors",
                isHighlighted ? "text-foreground-200" : "text-foreground-300/30 hover:text-foreground-300/70",
              )}
              style={isHighlighted && categoryColor ? { color: categoryColor.hex } : undefined}
              title={isHighlighted ? "Remove highlight" : "Highlight"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill={isHighlighted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 11-6 6v3h9l3-3" />
                <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={togglePin}
              className={cn(
                "rounded p-1 transition-colors",
                isPinned ? "text-foreground-200" : "text-foreground-300/30 hover:text-foreground-300/70",
              )}
              title={isPinned ? "Unpin" : "Pin to top"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth={isPinned ? "1" : "2"} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => void onDelete(item.id)}
              className="rounded p-1 text-foreground-300/30 transition-colors hover:text-red-500"
              title="Remove"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
    </SwipeableEmailRow>
  );
}

function NoteContent({ item, onUpdate }: { item: FeedItem; onUpdate: FeedItemRendererProps["onUpdate"] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [editing]);

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== item.content) {
      void onUpdate(item.id, { content: trimmed });
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
          if (e.key === "Escape") { setDraft(item.content ?? ""); setEditing(false); }
        }}
        className="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground-100 outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(item.content ?? ""); setEditing(true); }}
      className="w-full whitespace-pre-wrap text-left text-sm leading-relaxed text-foreground-100"
    >
      <SmartText text={item.content ?? ""} />
    </button>
  );
}

function EmailContent({ item, onEmailClick }: { item: FeedItem; onEmailClick?: (threadId: string, accountEmail?: string) => void }) {
  const ref = item.emailRef;
  if (!ref) return null;

  return (
    <button
      type="button"
      onClick={() => onEmailClick?.(ref.threadId)}
      className="w-full text-left"
    >
      <div className="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/50">
          <rect width="20" height="16" x="2" y="4" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
        <span className="text-xs font-medium text-foreground-200">{ref.from}</span>
      </div>
      <div className="mt-1 text-sm font-medium text-foreground-100">{ref.subject}</div>
      {ref.snippet && (
        <div className="mt-0.5 line-clamp-2 text-xs text-foreground-300">{ref.snippet}</div>
      )}
    </button>
  );
}

function ImageContent({ item }: { item: FeedItem }) {
  const ref = item.fileRef;
  if (!ref) return null;
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const src = `/api/workspace/_/file/${encodeURIComponent(ref.key)}`;
  const images: EmailImage[] = [{ src, alt: ref.filename }];

  return (
    <>
      <button type="button" onClick={() => setLightboxOpen(true)} className="w-full cursor-zoom-in">
        <img
          src={src}
          alt={ref.filename}
          className="block w-full select-none"
          loading="lazy"
          draggable={false}
        />
      </button>
      {lightboxOpen && (
        <ImageLightbox
          images={images}
          index={0}
          onClose={() => setLightboxOpen(false)}
          onNavigate={() => {}}
        />
      )}
    </>
  );
}

function FileContent({ item }: { item: FeedItem }) {
  const ref = item.fileRef;
  if (!ref) return null;

  const href = `/api/workspace/_/file/${encodeURIComponent(ref.key)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-lg bg-foreground-100/5 px-3 py-2.5 transition-colors hover:bg-foreground-100/8"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/50">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground-200">{ref.filename}</div>
        <div className="text-[10px] text-foreground-300/50">{formatFileSize(ref.size)}</div>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/30">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}

function LinkContent({ item }: { item: FeedItem }) {
  const ref = item.linkRef;
  if (!ref) return null;

  return (
    <a
      href={ref.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group/link flex items-start gap-3"
    >
      <div className="mt-0.5 shrink-0 rounded-md bg-foreground-100/5 p-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/50">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground-100 group-hover/link:text-accent-100">
          {ref.title}
        </div>
        {ref.description && (
          <div className="mt-0.5 line-clamp-2 text-xs text-foreground-300">{ref.description}</div>
        )}
        <div className="mt-0.5 truncate text-[10px] text-foreground-300/50">{ref.url}</div>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-1 shrink-0 text-foreground-300/30">
        <line x1="7" y1="17" x2="17" y2="7" />
        <polyline points="7 7 17 7 17 17" />
      </svg>
    </a>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Posted Image Gallery ────────────────────────────────────
// Handles 1, 2, or 3+ images uploaded together as a batch.

export function PostedImageGallery({
  items,
  onDelete,
  onUpdate,
  onExtract,
}: {
  items: FeedItem[];
  onDelete: (id: string) => Promise<void>;
  onUpdate?: (itemId: string, updates: { pinned?: boolean; imageWidth?: number }) => Promise<void>;
  onExtract?: (imageId: string, allIds: string[], direction: "above" | "below") => void;
}) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [hovering, setHovering] = useState(false);
  const allPinned = items.length > 0 && items.every((item) => item.pinned);

  const listCtx = useListContext();
  const myKey = items.length > 0 ? `images-${items[0].id}` : "";
  const isOtherImageDragging = listCtx.reorderable && !!listCtx.draggedId &&
    listCtx.draggedId.startsWith("images-") && listCtx.draggedId !== myKey;

  const togglePinAll = () => {
    const newPinned = !allPinned;
    for (const item of items) {
      void onUpdate?.(item.id, { pinned: newPinned });
    }
  };

  if (items.length === 0) return null;

  const galleryImages: EmailImage[] = items
    .map((item) => item.fileRef ? { src: `/api/workspace/_/file/${encodeURIComponent(item.fileRef.key)}`, alt: item.fileRef.filename } : null)
    .filter((img): img is EmailImage => img !== null);

  const singleRef = items.length === 1 ? items[0].fileRef : null;

  const galleryContent = items.length === 1 && singleRef
    ? (
      <SingleImagePost
        item={items[0]}
        fileRef={singleRef}
        onDelete={() => void onDelete(items[0].id)}
        onImageClick={() => setLightboxIdx(0)}
        onUpdate={onUpdate}
      />
    )
    : <ImageRowPost items={items} onDelete={onDelete} onImageClick={setLightboxIdx} onExtract={onExtract} onUpdate={onUpdate} />;

  return (
    <>
      <div
        className={cn(
          "group/gallery relative rounded-lg transition-shadow duration-200",
          isOtherImageDragging && "ring-2 ring-blue-400/30",
        )}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {galleryContent}
        {allPinned && !hovering && (
          <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 backdrop-blur-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
            </svg>
            <span className="text-[10px] font-medium text-white/70">Pinned</span>
          </div>
        )}
        {onUpdate && hovering && (
          <button
            type="button"
            onClick={togglePinAll}
            className={cn(
              "absolute left-2 top-2 z-10 rounded-full bg-black/50 p-1 backdrop-blur-sm transition-colors hover:text-white",
              allPinned ? "text-white" : "text-white/70",
            )}
            title={allPinned ? "Unpin" : "Pin to top"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill={allPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth={allPinned ? "1" : "2"} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
            </svg>
          </button>
        )}
      </div>
      {lightboxIdx !== null && (
        <ImageLightbox images={galleryImages} index={lightboxIdx} onClose={() => setLightboxIdx(null)} onNavigate={setLightboxIdx} />
      )}
    </>
  );
}

function SingleImagePost({
  item,
  fileRef,
  onDelete,
  onImageClick,
  onUpdate,
}: {
  item: FeedItem;
  fileRef: FeedItemFileRef;
  onDelete: () => void;
  onImageClick: () => void;
  onUpdate?: (itemId: string, updates: { imageWidth?: number }) => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [widthPct, setWidthPct] = useState(item.imageWidth ?? 100);
  const [resizing, setResizing] = useState(false);

  const src = `/api/workspace/_/file/${encodeURIComponent(fileRef.key)}`;

  const handleResizeStart = useCallback(
    (side: "left" | "right") => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResizing(true);

      const parentEl = containerRef.current?.parentElement;
      if (!parentEl) return;
      const parentWidth = parentEl.offsetWidth;
      const startX = e.clientX;
      const startPct = widthPct;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const deltaPct = (dx / parentWidth) * 100;
        const raw = side === "right"
          ? startPct + deltaPct
          : startPct - deltaPct;
        setWidthPct(Math.max(20, Math.min(100, raw)));
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setResizing(false);
        setWidthPct((final) => {
          const rounded = Math.round(final);
          void onUpdate?.(item.id, { imageWidth: rounded });
          return rounded;
        });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [widthPct, item.id, onUpdate],
  );

  return (
    <div
      ref={containerRef}
      className="group/img relative mx-auto"
      style={{ width: `${widthPct}%` }}
    >
      <div className="overflow-hidden rounded-lg border border-border-100/50 bg-background-100">
        <button type="button" onClick={resizing ? undefined : onImageClick} className="w-full cursor-zoom-in">
          <img src={src} alt={fileRef.filename} className="block w-full select-none" loading="lazy" draggable={false} />
        </button>
      </div>
      <ImageDeleteButton onClick={onDelete} />
      {onUpdate && widthPct < 100 && (
        <ResizeEdge side="left" onPointerDown={handleResizeStart("left")} />
      )}
      {onUpdate && (
        <ResizeEdge side="right" onPointerDown={handleResizeStart("right")} />
      )}
    </div>
  );
}

function ResizeEdge({ side, onPointerDown }: { side: "left" | "right"; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      className={cn(
        "absolute top-0 bottom-0 z-10 flex w-4 cursor-col-resize items-center justify-center opacity-0 transition-opacity group-hover/img:opacity-100",
        side === "left" ? "-left-2" : "-right-2",
      )}
      onPointerDown={onPointerDown}
    >
      <div className="h-10 w-1 rounded-full bg-foreground-100/30 transition-colors hover:bg-accent-100/60" />
    </div>
  );
}

function ImageRowPost({
  items,
  onDelete,
  onImageClick,
  onExtract,
  onUpdate,
}: {
  items: FeedItem[];
  onDelete: (id: string) => Promise<void>;
  onImageClick: (idx: number) => void;
  onExtract?: (imageId: string, allIds: string[], direction: "above" | "below") => void;
  onUpdate?: (itemId: string, updates: { imageWidth?: number }) => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratios, setRatios] = useState<number[]>(() =>
    items.map((item) => item.imageWidth ?? 1),
  );
  const extractedRef = useRef(false);
  const [resizing, setResizing] = useState(false);

  const handleLoad = useCallback(
    (idx: number) => (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = e.currentTarget;
      if (naturalWidth > 0 && naturalHeight > 0) {
        setRatios((prev) => {
          const item = items[idx];
          if (item?.imageWidth) return prev;
          const r = naturalWidth / naturalHeight;
          if (prev[idx] === r) return prev;
          const next = [...prev];
          next[idx] = r;
          return next;
        });
      }
    },
    [items],
  );

  useEffect(() => {
    setRatios((prev) => {
      if (prev.length === items.length) return prev;
      return items.map((item, i) => item.imageWidth ?? prev[i] ?? 1);
    });
  }, [items]);

  const handlePointerDown = useCallback(
    (imageId: string) => (e: React.PointerEvent) => {
      if (!onExtract || items.length < 2 || resizing) return;
      e.stopPropagation();

      const startY = e.clientY;
      const allIds = items.map((i) => i.id);

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      const onMove = (ev: PointerEvent) => {
        const dy = ev.clientY - startY;
        if (Math.abs(dy) > 24) {
          cleanup();
          extractedRef.current = true;
          onExtract(imageId, allIds, dy < 0 ? "above" : "below");
          setTimeout(() => { extractedRef.current = false; }, 200);
        }
      };

      const onUp = () => cleanup();

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [onExtract, items, resizing],
  );

  const handleResizeStart = useCallback(
    (dividerIdx: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResizing(true);

      const containerEl = containerRef.current;
      if (!containerEl) return;

      const containerWidth = containerEl.offsetWidth;
      const totalFlex = ratios.reduce((a, b) => a + b, 0);
      const pxPerUnit = containerWidth / totalFlex;
      const startX = e.clientX;
      const startLeft = ratios[dividerIdx];
      const startRight = ratios[dividerIdx + 1];
      const pairTotal = startLeft + startRight;
      const minUnit = pairTotal * 0.15;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const delta = dx / pxPerUnit;
        let newLeft = startLeft + delta;
        let newRight = startRight - delta;
        if (newLeft < minUnit) { newLeft = minUnit; newRight = pairTotal - minUnit; }
        if (newRight < minUnit) { newRight = minUnit; newLeft = pairTotal - minUnit; }
        setRatios((prev) => {
          const next = [...prev];
          next[dividerIdx] = newLeft;
          next[dividerIdx + 1] = newRight;
          return next;
        });
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setResizing(false);
        setRatios((final) => {
          void onUpdate?.(items[dividerIdx].id, { imageWidth: final[dividerIdx] });
          void onUpdate?.(items[dividerIdx + 1].id, { imageWidth: final[dividerIdx + 1] });
          return final;
        });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [ratios, items, onUpdate],
  );

  return (
    <div
      ref={containerRef}
      className="flex max-h-[350px] overflow-hidden rounded-lg border border-border-100/50 bg-background-100"
    >
      {items.map((item, idx) => {
        const ref = item.fileRef;
        if (!ref) return null;
        const src = `/api/workspace/_/file/${encodeURIComponent(ref.key)}`;
        return (
          <div key={item.id} className="contents">
            <div
              className={cn(
                "group/img relative min-w-0 overflow-hidden",
                resizing ? "pointer-events-none" : "cursor-grab active:cursor-grabbing",
              )}
              style={{ flex: `${ratios[idx] ?? 1} 1 0%` }}
              onClick={() => { if (!extractedRef.current && !resizing) onImageClick(idx); }}
              onPointerDown={resizing ? undefined : handlePointerDown(item.id)}
            >
              <img
                src={src}
                alt={ref.filename}
                className="h-full w-full select-none object-cover"
                loading="lazy"
                draggable={false}
                onLoad={handleLoad(idx)}
              />
              <ImageDeleteButton onClick={() => void onDelete(item.id)} />
            </div>
            {idx < items.length - 1 && (
              <div
                className="group/divider relative w-0.5 shrink-0 cursor-col-resize select-none bg-background-100"
                onPointerDown={handleResizeStart(idx)}
              >
                <div className="absolute inset-y-0 -left-1.5 -right-1.5 z-10" />
                <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-transparent transition-colors duration-150 group-hover/divider:bg-accent-100/60" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ImageDeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="absolute right-1.5 top-1.5 rounded-full bg-black/50 p-1 text-white/70 opacity-0 backdrop-blur-sm transition-opacity group-hover/img:opacity-100 hover:text-white"
      title="Remove"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
