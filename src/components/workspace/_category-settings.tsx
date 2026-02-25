import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HexColorPicker } from "react-colorful";
import { cn, CATEGORY_COLORS } from "../../lib";

type DefaultMode = "todo" | "note" | "chat";

interface CategorySettingsProps {
  open: boolean;
  category: string;
  allCategories: string[];
  description?: string;
  defaultMode: DefaultMode;
  customHex?: string;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onRename: (oldName: string, newName: string) => void;
  onChangeCustomColor: (category: string, hex: string | null) => void;
  onChangeDescription: (desc: string) => void;
  onChangeDefaultMode: (mode: DefaultMode) => void;
  onDelete: (category: string) => void;
}

export type { DefaultMode };

export function CategorySettings({
  open,
  category,
  allCategories,
  description = "",
  defaultMode,
  customHex,
  anchorRef,
  onClose,
  onRename,
  onChangeCustomColor,
  onChangeDescription,
  onChangeDefaultMode,
  onDelete,
}: CategorySettingsProps) {
  const [nameDraft, setNameDraft] = useState(category);
  const [descDraft, setDescDraft] = useState(description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    setNameDraft(category);
    setDescDraft(description);
    setConfirmDelete(false);
  }, [category, description, open]);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
    });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open, onClose, anchorRef]);

  const idx = allCategories.indexOf(category);
  const currentColorIndex = (idx >= 0 ? idx : 0) % CATEGORY_COLORS.length;
  const activeHex = customHex ?? CATEGORY_COLORS[currentColorIndex].hex;

  const commitName = useCallback(() => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== category) {
      onRename(category, trimmed);
    } else {
      setNameDraft(category);
    }
  }, [nameDraft, category, onRename]);

  const commitDesc = useCallback(() => {
    const trimmed = descDraft.trim();
    if (trimmed !== (description ?? "")) {
      onChangeDescription(trimmed);
    }
  }, [descDraft, description, onChangeDescription]);

  if (!open || !pos) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-99"
        onClick={onClose}
        aria-hidden
      />

      {/* Popover */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-label="Category settings"
        className="fixed z-100 w-[340px] rounded-xl border border-border-100/60 bg-background-100 shadow-xl shadow-black/10 animate-in fade-in zoom-in-95 origin-top-right duration-150"
        style={{ top: pos.top, right: pos.right }}
      >
        {/* Name */}
        <Row label="Name">
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setNameDraft(category);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-[160px] rounded-md border border-border-100/70 bg-background-200/60 px-3 py-[5px] text-[13px] text-foreground-100 focus:border-accent-100/50 focus:outline-none"
          />
        </Row>

        <Divider />

        {/* Color */}
        <Row label="Color" stacked>
          <ColorPicker
            category={category}
            activeHex={activeHex}
            customHex={customHex}
            onChangeCustomColor={onChangeCustomColor}
          />
        </Row>

        <Divider />

        {/* Description */}
        <Row label="Description" stacked>
          <input
            type="text"
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDesc}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitDesc();
            }}
            placeholder="What is this workspace for?"
            className="w-full rounded-md border border-border-100/70 bg-background-200/60 px-3 py-[5px] text-[13px] text-foreground-100 placeholder:text-foreground-300/40 focus:border-accent-100/50 focus:outline-none"
          />
        </Row>

        <Divider />

        {/* Default mode */}
        <Row label="Default mode">
          <div className="flex items-center rounded-lg border border-border-100/80 bg-background-200/60 p-0.5">
            {(["todo", "note", "chat"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChangeDefaultMode(m)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12px] font-medium transition-all capitalize",
                  m === defaultMode
                    ? m === "chat"
                      ? "bg-accent-100/10 text-accent-100"
                      : "bg-background-100 text-foreground-100 shadow-sm"
                    : "text-foreground-300 hover:text-foreground-200",
                )}
                aria-pressed={m === defaultMode}
              >
                {m === "todo" ? "To-do" : m === "note" ? "Note" : "Chat"}
              </button>
            ))}
          </div>
        </Row>

        <Divider />

        {/* Delete */}
        <div className="px-4 py-3">
          {confirmDelete ? (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-red-500">
                Delete &ldquo;{category}&rdquo;?
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md px-3 py-1.5 text-[12px] text-foreground-300 transition-colors hover:text-foreground-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(category)}
                  className="rounded-md bg-red-500 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-[13px] text-red-500/70 transition-colors hover:text-red-500"
            >
              Delete category...
            </button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

function Row({
  label,
  stacked,
  children,
}: {
  label: string;
  stacked?: boolean;
  children: React.ReactNode;
}) {
  if (stacked) {
    return (
      <div className="px-4 py-3">
        <div className="mb-1.5 text-[13px] font-medium text-foreground-200">{label}</div>
        {children}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-[13px] font-medium text-foreground-200">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="mx-4 border-t border-border-100/40" />;
}

// ─── Color Picker ────────────────────────────────────────────

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

function normalizeHex(v: string): string | null {
  const m = HEX_RE.exec(v.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

function ColorPicker({
  category,
  activeHex,
  customHex,
  onChangeCustomColor,
}: {
  category: string;
  activeHex: string;
  customHex?: string;
  onChangeCustomColor: (category: string, hex: string | null) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(activeHex);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setHexDraft(activeHex);
  }, [activeHex]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  const isPresetActive = (hex: string) =>
    activeHex.toLowerCase() === hex.toLowerCase();

  const commitHex = () => {
    const parsed = normalizeHex(hexDraft);
    if (parsed) onChangeCustomColor(category, parsed);
    else setHexDraft(activeHex);
  };

  return (
    <div className="space-y-2">
      {/* Preset swatches */}
      <div className="flex items-center gap-1.5">
        {CATEGORY_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            onClick={() => onChangeCustomColor(category, c.hex)}
            className={cn(
              "h-6 w-6 rounded-full transition-all",
              isPresetActive(c.hex)
                ? "ring-2 ring-foreground-100/30 ring-offset-2 ring-offset-background-100 scale-110"
                : "hover:scale-110",
            )}
            style={{ backgroundColor: c.hex }}
            aria-label={`Set color to ${c.hex}`}
            aria-pressed={isPresetActive(c.hex)}
          />
        ))}

        {/* Custom picker toggle */}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className={cn(
            "relative flex h-6 w-6 items-center justify-center rounded-full border-2 border-dashed transition-all",
            customHex && !CATEGORY_COLORS.some((c) => c.hex === customHex)
              ? "ring-2 ring-foreground-100/30 ring-offset-2 ring-offset-background-100 scale-110 border-transparent"
              : "border-foreground-300/30 hover:border-foreground-300/60 hover:scale-110",
          )}
          style={
            customHex && !CATEGORY_COLORS.some((c) => c.hex === customHex)
              ? { backgroundColor: customHex }
              : undefined
          }
          title="Pick a custom color"
        >
          {(!customHex || CATEGORY_COLORS.some((c) => c.hex === customHex)) && (
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300/50">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          )}
        </button>
      </div>

      {/* Expanded picker */}
      {pickerOpen && (
        <div
          ref={pickerRef}
          className="space-y-2 rounded-lg border border-border-100/60 bg-background-200/60 p-3 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <HexColorPicker
            color={activeHex}
            onChange={(hex) => {
              onChangeCustomColor(category, hex);
              setHexDraft(hex);
            }}
            style={{ width: "100%", height: 140 }}
          />
          <div className="flex items-center gap-2">
            <div
              className="h-7 w-7 shrink-0 rounded-md border border-border-100/60"
              style={{ backgroundColor: activeHex }}
            />
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 select-none text-[13px] text-foreground-300/50">
                #
              </span>
              <input
                type="text"
                value={hexDraft.replace(/^#/, "")}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                  setHexDraft(`#${raw}`);
                  const parsed = normalizeHex(raw);
                  if (parsed) onChangeCustomColor(category, parsed);
                }}
                onBlur={commitHex}
                onKeyDown={(e) => { if (e.key === "Enter") commitHex(); }}
                maxLength={6}
                className="w-full rounded-md border border-border-100/70 bg-background-100 py-1.5 pl-6 pr-2.5 font-mono text-[13px] text-foreground-100 uppercase focus:border-accent-100/50 focus:outline-none"
                spellCheck={false}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
