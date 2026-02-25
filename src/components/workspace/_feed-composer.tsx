import { useCallback, useEffect, useRef, useState } from "react";
import { cn, useSmartInput } from "../../lib";
import type { FeedItem, TodoEntity } from "../../lib";
import { SmartInput, type SmartEntity } from "../smart-input";

type ComposerMode = "todo" | "note" | "chat";

interface FeedComposerProps {
  category: string;
  allCategories?: string[];
  defaultMode?: ComposerMode;
  onAddNote: (content: string) => Promise<FeedItem | null>;
  onAddLink: (url: string) => Promise<FeedItem | null>;
  onUploadFile: (file: File) => Promise<FeedItem | null>;
  onCreateTodo?: (params: { title: string; categories?: string[]; entities?: TodoEntity[] }) => void;
  onStartChat?: (title: string, prompt: string) => void;
}

const URL_REGEX = /^https?:\/\/\S+$/i;

const MODE_CONFIG: Record<ComposerMode, { placeholder: string }> = {
  todo: { placeholder: "Add a to-do..." },
  note: { placeholder: "Write a note..." },
  chat: { placeholder: "Ask something..." },
};

export function FeedComposer({
  category,
  allCategories = [],
  defaultMode = "todo",
  onAddNote,
  onAddLink,
  onUploadFile,
  onCreateTodo,
  onStartChat,
}: FeedComposerProps) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<ComposerMode>(defaultMode);
  const [dragging, setDragging] = useState(false);
  const entitiesRef = useRef<SmartEntity[]>([]);

  useEffect(() => { setMode(defaultMode); }, [defaultMode]);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { contacts, searchContacts, searchEmails } = useSmartInput();

  const submit = useCallback(async () => {
    const text = value.trim();
    if (!text && stagedFiles.length === 0) return;
    if (submitting) return;

    setSubmitting(true);
    try {
      for (const file of stagedFiles) {
        await onUploadFile(file);
      }
      if (text) {
        if (URL_REGEX.test(text)) {
          await onAddLink(text);
        } else if (mode === "todo") {
          const todoEntities: TodoEntity[] = entitiesRef.current.map((e) => {
            if (e.type === "person") return { type: "person", name: e.name, email: e.email };
            if (e.type === "email") return { type: "email", id: e.id, threadId: e.threadId, subject: e.subject, from: e.from };
            if (e.type === "category") return { type: "category", name: e.name };
            return { type: "link", url: e.url };
          });
          onCreateTodo?.({ title: text, categories: [category], entities: todoEntities.length > 0 ? todoEntities : undefined });
        } else if (mode === "chat") {
          const title = text.length > 60 ? `${text.slice(0, 57)}...` : text;
          onStartChat?.(title, text);
        } else {
          await onAddNote(text);
        }
      }
      setValue("");
      setStagedFiles([]);
      entitiesRef.current = [];
    } finally {
      setSubmitting(false);
    }
  }, [value, stagedFiles, submitting, mode, category, onAddNote, onAddLink, onUploadFile, onCreateTodo, onStartChat]);

  const stageFiles = useCallback((files: FileList | File[]) => {
    setStagedFiles((prev) => [...prev, ...Array.from(files)]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      stageFiles(e.dataTransfer.files);
    }
  }, [stageFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      stageFiles(files);
    }
  }, [stageFiles]);

  const hasContent = value.trim().length > 0 || stagedFiles.length > 0;

  return (
    <div
      className={cn(
        "relative cursor-text rounded-xl -mx-4 transition-all",
        dragging
          ? "bg-accent-100/5 ring-2 ring-accent-100/30 ring-inset"
          : focused
            ? "bg-foreground-100/2"
            : "hover:bg-foreground-100/2",
      )}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      <div
        className="min-h-[20vh] cursor-text px-4 pb-3 pt-4 lg:min-h-[10vh]"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <SmartInput
          value={value}
          onChange={(text, ents) => { setValue(text); entitiesRef.current = ents; }}
          onSubmit={() => void submit()}
          multiline={mode === "note"}
          placeholder={MODE_CONFIG[mode].placeholder}
          categories={allCategories}
          contacts={contacts}
          onSearchContacts={searchContacts}
          onSearchEmails={searchEmails}
          className="h-full min-h-[16vh] w-full text-[15px] leading-relaxed text-foreground-100 lg:min-h-[8vh]"
        />
      </div>

      {/* Staged file previews */}
      {stagedFiles.length > 0 && (
        <StagedPreviews
          files={stagedFiles}
          onRemove={(idx) => setStagedFiles((prev) => prev.filter((_, i) => i !== idx))}
        />
      )}

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between px-3 pb-3">
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center rounded-lg border border-border-100/80 bg-background-100 p-0.5">
            <ModeButton active={mode === "todo"} onClick={() => setMode("todo")}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              To-do
            </ModeButton>
            <ModeButton active={mode === "note"} onClick={() => setMode("note")}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
              </svg>
              Note
            </ModeButton>
            <ModeButton active={mode === "chat"} onClick={() => setMode("chat")} accent>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z" />
              </svg>
              Chat
            </ModeButton>
          </div>

          {/* Attachment button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-border-100 px-2.5 py-1.5 text-xs text-foreground-300/70 transition-colors hover:border-foreground-300/30 hover:text-foreground-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            File
          </button>
        </div>

        {/* Send arrow (iMessage-style) */}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!hasContent || submitting}
          className={cn(
            "rounded-full p-2 transition-all",
            hasContent && !submitting
              ? mode === "chat"
                ? "bg-accent-100 text-white shadow-sm hover:bg-accent-100/90 active:scale-95"
                : "bg-foreground-100 text-background-100 shadow-sm hover:bg-foreground-100/90 active:scale-95"
              : "text-foreground-300/30",
          )}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) stageFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Drag overlay */}
      {dragging && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-accent-100/10 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-accent-100">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Drop files here
          </div>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-all",
        active
          ? accent
            ? "bg-accent-100/10 text-accent-100"
            : "bg-background-300 text-foreground-100 shadow-sm"
          : "text-foreground-300 hover:text-foreground-200",
      )}
    >
      {children}
    </button>
  );
}

function StagedPreviews({ files, onRemove }: { files: File[]; onRemove: (idx: number) => void }) {
  const indexed = files.map((f, i) => ({ file: f, idx: i }));
  const images = indexed.filter(({ file }) => file.type.startsWith("image/"));
  const others = indexed.filter(({ file }) => !file.type.startsWith("image/"));

  const scrollRef = useRef<HTMLDivElement>(null);
  const [fades, setFades] = useState({ left: false, right: false });

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFades({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(checkScroll);
    observer.observe(el);
    return () => observer.disconnect();
  }, [images.length, checkScroll]);

  const maskImage = fades.left && fades.right
    ? "linear-gradient(to right, transparent, black 32px, black calc(100% - 32px), transparent)"
    : fades.right
      ? "linear-gradient(to right, black calc(100% - 32px), transparent)"
      : fades.left
        ? "linear-gradient(to right, transparent, black 32px)"
        : undefined;

  return (
    <div className="space-y-2 px-4 pb-3">
      {images.length > 0 && (
        <div
          ref={scrollRef}
          className="flex gap-2 overflow-x-auto"
          style={{ scrollbarWidth: "none", maskImage, WebkitMaskImage: maskImage }}
          onScroll={checkScroll}
        >
          {images.map(({ file, idx }) => (
            <StagedImagePreview
              key={`img-${idx}`}
              file={file}
              onRemove={() => onRemove(idx)}
            />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="space-y-1">
          {others.map(({ file, idx }) => (
            <StagedFilePreview
              key={`file-${idx}`}
              file={file}
              onRemove={() => onRemove(idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StagedImagePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!url) return null;

  return (
    <div className="group/preview relative shrink-0">
      <img
        src={url}
        alt={file.name}
        className="h-20 min-w-[80px] rounded-lg object-cover"
      />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground-100 text-background-100 opacity-0 shadow-sm transition-opacity group-hover/preview:opacity-100"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

function StagedFilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  return (
    <div className="group/preview relative flex items-center gap-2 rounded-lg bg-foreground-100/5 py-1.5 pl-2.5 pr-7">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/50">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      </svg>
      <div className="min-w-0">
        <div className="max-w-[140px] truncate text-xs text-foreground-200">{file.name}</div>
        <div className="text-[10px] text-foreground-300/50">{formatFileSize(file.size)}</div>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-foreground-300/40 opacity-0 transition-opacity group-hover/preview:opacity-100 hover:text-foreground-100"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
