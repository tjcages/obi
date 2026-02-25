import { useCallback, useEffect, useState } from "react";
import { ALL_AGENT_ACTIONS, cn, type AgentAction, type PromptConfig, type PromptSnapshot } from "../../lib";

interface SystemPromptViewerProps {
  snapshot: PromptSnapshot | null;
  onSave: (config: PromptConfig) => Promise<void>;
  onReset: () => Promise<void>;
}

const TONE_OPTIONS: { value: PromptConfig["tone"]; label: string; desc: string }[] = [
  { value: "concise", label: "Concise", desc: "Brief, bullet-point answers" },
  { value: "balanced", label: "Balanced", desc: "Clear with appropriate detail" },
  { value: "detailed", label: "Detailed", desc: "Thorough with full context" },
];

const FORMAT_OPTIONS: { value: PromptConfig["responseFormat"]; label: string; desc: string }[] = [
  { value: "bullets", label: "Bullet list", desc: "Quick-scan lists" },
  { value: "narrative", label: "Narrative", desc: "Flowing paragraphs" },
  { value: "structured", label: "Structured", desc: "Headers & labeled fields" },
];

const ACTION_META: Record<AgentAction, { label: string; icon: string }> = {
  read:    { label: "Read emails",   icon: "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6" },
  send:    { label: "Send new",      icon: "M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z" },
  reply:   { label: "Reply",         icon: "M9 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5 M15 18l5-5-5-5" },
  forward: { label: "Forward",       icon: "M13 9l3 3-3 3 M5 12h11" },
  archive: { label: "Archive",       icon: "M21 8v13H3V8 M1 3h22v5H1z M10 12h4" },
  trash:   { label: "Trash",         icon: "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" },
  label:   { label: "Label / move",  icon: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01" },
  star:    { label: "Star / unstar", icon: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" },
};

const COUNT_OPTIONS = [5, 10, 20, 50];

function configsEqual(a: PromptConfig, b: PromptConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function SystemPromptViewer({ snapshot, onSave, onReset }: SystemPromptViewerProps) {
  const [config, setConfig] = useState<PromptConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [tagDraft, setTagDraft] = useState<{ field: "priorityContacts" | "focusTopics"; value: string } | null>(null);

  useEffect(() => {
    if (snapshot?.config && !config) {
      setConfig({ ...snapshot.config });
    }
  }, [snapshot, config]);

  const handleSave = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    await onSave(config);
    setSaving(false);
  }, [config, onSave]);

  const handleReset = useCallback(async () => {
    if (!snapshot) return;
    setSaving(true);
    await onReset();
    setConfig({ ...snapshot.defaultConfig });
    setSaving(false);
  }, [snapshot, onReset]);

  const updateField = useCallback(<K extends keyof PromptConfig>(key: K, value: PromptConfig[K]) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  const toggleAction = useCallback((action: AgentAction) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const has = prev.allowedActions.includes(action);
      return {
        ...prev,
        allowedActions: has
          ? prev.allowedActions.filter((a) => a !== action)
          : [...prev.allowedActions, action],
      };
    });
  }, []);

  const addTag = useCallback((field: "priorityContacts" | "focusTopics", value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setConfig((prev) => {
      if (!prev) return prev;
      if (prev[field].includes(trimmed)) return prev;
      return { ...prev, [field]: [...prev[field], trimmed] };
    });
    setTagDraft(null);
  }, []);

  const removeTag = useCallback((field: "priorityContacts" | "focusTopics", index: number) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return { ...prev, [field]: prev[field].filter((_, i) => i !== index) };
    });
  }, []);

  if (!snapshot || !config) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground-300 border-t-accent-100" />
      </div>
    );
  }

  const modified = !configsEqual(config, snapshot.defaultConfig);
  const dirty = !configsEqual(config, snapshot.config);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-100 px-4 py-2">
        {modified && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            Customized
          </span>
        )}
        <span className="flex-1" />
        {modified && (
          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={saving}
            className="rounded px-2.5 py-1 text-xs text-foreground-300 transition-colors hover:bg-background-200 disabled:opacity-50"
          >
            Reset defaults
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="rounded bg-accent-100 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-100/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>

      {/* Form */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-4">

          {/* Persona */}
          <FieldGroup label="Agent Persona" hint="How the agent introduces itself">
            <textarea
              value={config.persona}
              onChange={(e) => updateField("persona", e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-border-100 bg-background-100 px-3 py-2 text-sm leading-relaxed text-foreground-200 outline-none transition-colors focus:border-accent-100 focus:ring-1 focus:ring-accent-100"
              placeholder="You are an email agent with access to the user's Gmail."
            />
          </FieldGroup>

          {/* Response Style + Format side by side */}
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Response Style" hint="Verbosity">
              <div className="flex flex-col gap-1.5">
                {TONE_OPTIONS.map((opt) => {
                  const active = config.tone === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateField("tone", opt.value)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all",
                        active
                          ? "border-accent-100 bg-accent-100/5 ring-1 ring-accent-100"
                          : "border-border-100 bg-background-100 hover:border-foreground-300/40"
                      )}
                    >
                      <div className={cn("h-2 w-2 shrink-0 rounded-full", active ? "bg-accent-100" : "bg-foreground-300/30")} />
                      <div>
                        <span className={cn("text-xs font-medium", active ? "text-accent-100" : "text-foreground-200")}>
                          {opt.label}
                        </span>
                        <span className="ml-1.5 text-[10px] text-foreground-300">{opt.desc}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </FieldGroup>

            <FieldGroup label="Format" hint="How data is presented">
              <div className="flex flex-col gap-1.5">
                {FORMAT_OPTIONS.map((opt) => {
                  const active = config.responseFormat === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateField("responseFormat", opt.value)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all",
                        active
                          ? "border-accent-100 bg-accent-100/5 ring-1 ring-accent-100"
                          : "border-border-100 bg-background-100 hover:border-foreground-300/40"
                      )}
                    >
                      <div className={cn("h-2 w-2 shrink-0 rounded-full", active ? "bg-accent-100" : "bg-foreground-300/30")} />
                      <div>
                        <span className={cn("text-xs font-medium", active ? "text-accent-100" : "text-foreground-200")}>
                          {opt.label}
                        </span>
                        <span className="ml-1.5 text-[10px] text-foreground-300">{opt.desc}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </FieldGroup>
          </div>

          {/* Allowed Actions */}
          <FieldGroup label="Allowed Actions" hint="What the agent can do">
            <div className="grid grid-cols-2 gap-1.5">
              {ALL_AGENT_ACTIONS.map((action) => {
                const meta = ACTION_META[action];
                const enabled = config.allowedActions.includes(action);
                return (
                  <label
                    key={action}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-all",
                      enabled
                        ? "border-border-100 bg-background-100"
                        : "border-border-100 bg-background-100 opacity-50"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggleAction(action)}
                      className="h-3.5 w-3.5 rounded border-border-100 accent-accent-100"
                    />
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0 text-foreground-300"
                    >
                      <path d={meta.icon} />
                    </svg>
                    <span className="text-xs text-foreground-200">{meta.label}</span>
                  </label>
                );
              })}
            </div>
          </FieldGroup>

          {/* Priority Contacts */}
          <FieldGroup label="Priority Contacts" hint="VIPs whose emails get surfaced first">
            <TagInput
              tags={config.priorityContacts}
              placeholder="Add email or name..."
              draftState={tagDraft?.field === "priorityContacts" ? tagDraft.value : null}
              onDraftChange={(v) => setTagDraft(v !== null ? { field: "priorityContacts", value: v } : null)}
              onAdd={(v) => addTag("priorityContacts", v)}
              onRemove={(i) => removeTag("priorityContacts", i)}
            />
          </FieldGroup>

          {/* Focus Topics */}
          <FieldGroup label="Focus Topics" hint="Subjects the agent prioritizes when scanning">
            <TagInput
              tags={config.focusTopics}
              placeholder="Add topic..."
              draftState={tagDraft?.field === "focusTopics" ? tagDraft.value : null}
              onDraftChange={(v) => setTagDraft(v !== null ? { field: "focusTopics", value: v } : null)}
              onAdd={(v) => addTag("focusTopics", v)}
              onRemove={(i) => removeTag("focusTopics", i)}
            />
          </FieldGroup>

          {/* Language + Default Count */}
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Language" hint="Response language">
              <input
                type="text"
                value={config.language}
                onChange={(e) => updateField("language", e.target.value)}
                className="w-full rounded-lg border border-border-100 bg-background-100 px-3 py-2 text-sm text-foreground-200 outline-none transition-colors focus:border-accent-100 focus:ring-1 focus:ring-accent-100"
                placeholder="English"
              />
            </FieldGroup>

            <FieldGroup label="Default Email Count" hint="Emails shown per query">
              <div className="flex gap-1.5">
                {COUNT_OPTIONS.map((n) => {
                  const active = config.defaultEmailCount === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => updateField("defaultEmailCount", n)}
                      className={cn(
                        "flex-1 rounded-lg border py-2 text-center text-xs font-medium transition-all",
                        active
                          ? "border-accent-100 bg-accent-100/5 text-accent-100 ring-1 ring-accent-100"
                          : "border-border-100 bg-background-100 text-foreground-300 hover:border-foreground-300/40"
                      )}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </FieldGroup>
          </div>

          {/* Safety */}
          <FieldGroup label="Safety" hint="Guardrails for destructive actions">
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border-100 bg-background-100 px-3 py-2.5">
              <input
                type="checkbox"
                checked={config.confirmBeforeActions}
                onChange={(e) => updateField("confirmBeforeActions", e.target.checked)}
                className="h-4 w-4 rounded border-border-100 accent-accent-100"
              />
              <div>
                <span className="block text-xs font-medium text-foreground-200">
                  Confirm before send, trash, or archive
                </span>
                <span className="block text-[10px] text-foreground-300">
                  Agent asks for approval before destructive actions
                </span>
              </div>
            </label>
          </FieldGroup>

          {/* Custom Instructions */}
          <FieldGroup label="Custom Instructions" hint="Free-form rules or context">
            <textarea
              value={config.customInstructions}
              onChange={(e) => updateField("customInstructions", e.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-border-100 bg-background-100 px-3 py-2 text-sm leading-relaxed text-foreground-200 outline-none transition-colors placeholder:text-foreground-300/50 focus:border-accent-100 focus:ring-1 focus:ring-accent-100"
              placeholder={"e.g. Summarize newsletters in 2-3 bullet points.\nAlways mention the sender's name."}
            />
          </FieldGroup>

          {/* Injected Memory */}
          {(snapshot.memory.userFacts.length > 0 || snapshot.memory.conversationSummaries.length > 0) && (
            <FieldGroup label="Injected Memory" hint="Auto-appended — edit in Memory Inspector">
              <div className="flex gap-2">
                {snapshot.memory.userFacts.length > 0 && (
                  <div className="rounded-lg border border-green-200 bg-green-50/50 px-3 py-1.5 dark:border-green-800/60 dark:bg-green-950/20">
                    <span className="text-[10px] font-medium text-green-700 dark:text-green-300">
                      {snapshot.memory.userFacts.length} fact{snapshot.memory.userFacts.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
                {snapshot.memory.conversationSummaries.length > 0 && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50/50 px-3 py-1.5 dark:border-rose-800/60 dark:bg-rose-950/20">
                    <span className="text-[10px] font-medium text-rose-700 dark:text-rose-300">
                      {snapshot.memory.conversationSummaries.length} summar{snapshot.memory.conversationSummaries.length !== 1 ? "ies" : "y"}
                    </span>
                  </div>
                )}
              </div>
            </FieldGroup>
          )}

          {/* Assembled Prompt Preview */}
          <div className="rounded-lg border border-border-100 bg-background-100">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className={cn("shrink-0 text-foreground-300 transition-transform", showPreview && "rotate-90")}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="text-xs font-medium text-foreground-300">
                Assembled prompt preview
              </span>
              <span className="ml-auto text-[10px] text-foreground-300">
                {snapshot.prompt.length.toLocaleString()} chars
              </span>
            </button>
            {showPreview && (
              <div className="border-t border-border-100 px-3 py-2">
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground-300">
                  {snapshot.prompt}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

function FieldGroup({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <span className="text-xs font-semibold text-foreground-200">{label}</span>
        <span className="ml-2 text-[10px] text-foreground-300">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function TagInput({
  tags,
  placeholder,
  draftState,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  tags: string[];
  placeholder: string;
  draftState: string | null;
  onDraftChange: (v: string | null) => void;
  onAdd: (v: string) => void;
  onRemove: (i: number) => void;
}) {
  const isEditing = draftState !== null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border-100 bg-background-100 px-2.5 py-2 transition-colors focus-within:border-accent-100 focus-within:ring-1 focus-within:ring-accent-100">
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="flex items-center gap-1 rounded-full bg-accent-100/10 px-2 py-0.5 text-xs text-accent-100"
        >
          {tag}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="ml-0.5 rounded-full p-0.5 text-accent-100/60 transition-colors hover:bg-accent-100/20 hover:text-accent-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}
      {isEditing ? (
        <input
          autoFocus
          type="text"
          value={draftState}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              onAdd(draftState);
            }
            if (e.key === "Escape") {
              onDraftChange(null);
            }
          }}
          onBlur={() => {
            if (draftState.trim()) onAdd(draftState);
            else onDraftChange(null);
          }}
          className="min-w-[100px] flex-1 bg-transparent text-xs text-foreground-200 outline-none placeholder:text-foreground-300/50"
          placeholder={placeholder}
        />
      ) : (
        <button
          type="button"
          onClick={() => onDraftChange("")}
          className="flex items-center gap-1 text-[10px] text-foreground-300 transition-colors hover:text-accent-100"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {tags.length === 0 ? placeholder : "Add more"}
        </button>
      )}
    </div>
  );
}
