import { useCallback, useEffect, useRef, useState } from "react";
import { cn, type MemoryState } from "../../lib";

type Tab = "facts" | "summaries" | "raw";

interface MemoryInspectorProps {
  memory: MemoryState | null;
  onUpdateFacts: (facts: string[]) => Promise<void>;
  onDeleteFact: (index: number) => Promise<void>;
}

export function MemoryInspector({ memory, onUpdateFacts, onDeleteFact }: MemoryInspectorProps) {
  const [activeTab, setActiveTab] = useState<Tab>("facts");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingIndex !== null) editRef.current?.focus();
  }, [editingIndex]);

  const saveEdit = useCallback(async () => {
    if (editingIndex === null || !memory) return;
    const trimmed = editValue.trim();
    if (!trimmed) {
      await onDeleteFact(editingIndex);
    } else {
      const updated = [...memory.userFacts];
      updated[editingIndex] = trimmed;
      await onUpdateFacts(updated);
    }
    setEditingIndex(null);
    setEditValue("");
  }, [editingIndex, editValue, memory, onUpdateFacts, onDeleteFact]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "facts", label: `Facts${memory ? ` (${memory.userFacts.length})` : ""}` },
    { id: "summaries", label: `Summaries${memory ? ` (${memory.conversationSummaries.length})` : ""}` },
    { id: "raw", label: "Raw" },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-border-100">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2.5 text-xs font-medium uppercase tracking-wide transition-colors",
              activeTab === tab.id
                ? "border-b-2 border-accent-100 text-foreground-100"
                : "text-foreground-300 hover:text-foreground-200"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!memory ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground-300 border-t-accent-100" />
          </div>
        ) : activeTab === "facts" ? (
          <FactsList
            facts={memory.userFacts}
            editingIndex={editingIndex}
            editValue={editValue}
            editRef={editRef}
            onStartEdit={(i, val) => { setEditingIndex(i); setEditValue(val); }}
            onEditChange={setEditValue}
            onSaveEdit={saveEdit}
            onCancelEdit={() => setEditingIndex(null)}
            onDelete={onDeleteFact}
          />
        ) : activeTab === "summaries" ? (
          <SummariesList summaries={memory.conversationSummaries} />
        ) : (
          <RawView memory={memory} />
        )}
      </div>
    </div>
  );
}

function FactsList({
  facts,
  editingIndex,
  editValue,
  editRef,
  onStartEdit,
  onEditChange,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: {
  facts: string[];
  editingIndex: number | null;
  editValue: string;
  editRef: React.RefObject<HTMLInputElement | null>;
  onStartEdit: (i: number, val: string) => void;
  onEditChange: (val: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (i: number) => Promise<void>;
}) {
  if (facts.length === 0) {
    return <p className="py-4 text-center text-sm text-foreground-300">No facts stored.</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {facts.map((fact, i) => (
        <li
          key={`${i}-${fact.slice(0, 20)}`}
          className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-background-200"
        >
          <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-xs text-foreground-300">{i}</span>
          {editingIndex === i ? (
            <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); onSaveEdit(); }}>
              <input
                ref={editRef}
                type="text"
                value={editValue}
                onChange={(e) => onEditChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") onCancelEdit(); }}
                className="flex-1 rounded border border-border-100 bg-background-200 px-2 py-1 text-sm text-foreground-100 outline-none focus:border-accent-100"
              />
              <button type="submit" className="text-xs text-accent-100 hover:underline">Save</button>
              <button type="button" onClick={onCancelEdit} className="text-xs text-foreground-300 hover:underline">Cancel</button>
            </form>
          ) : (
            <>
              <span className="flex-1 text-sm text-foreground-200">{fact}</span>
              <button
                type="button"
                onClick={() => onStartEdit(i, fact)}
                className="hidden shrink-0 rounded p-1 text-foreground-300 transition-colors hover:bg-background-300 hover:text-foreground-200 group-hover:block"
                aria-label="Edit"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => void onDelete(i)}
                className="hidden shrink-0 rounded p-1 text-foreground-300 transition-colors hover:bg-destructive-100/10 hover:text-destructive-100 group-hover:block"
                aria-label="Delete"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function SummariesList({ summaries }: { summaries: { id: string; summary: string; date: string }[] }) {
  if (summaries.length === 0) {
    return <p className="py-4 text-center text-sm text-foreground-300">No conversation summaries.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {[...summaries].reverse().map((s) => (
        <li key={s.id} className="rounded-lg bg-background-200 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground-300">{s.date}</span>
            <span className="font-mono text-xs text-foreground-300">{s.id.slice(0, 12)}</span>
          </div>
          <p className="mt-1 text-sm text-foreground-200">{s.summary}</p>
        </li>
      ))}
    </ul>
  );
}

function RawView({ memory }: { memory: MemoryState }) {
  return (
    <pre className="overflow-auto rounded-lg bg-background-200 p-4 font-mono text-xs text-foreground-200">
      {JSON.stringify(memory, null, 2)}
    </pre>
  );
}
