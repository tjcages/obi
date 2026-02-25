import { useCallback, useEffect, useRef, useState } from "react";
import { useMemory, cn, useIsMobile } from "../../lib";
import type { ConnectedAccountPublic } from "../../lib";
import { Drawer } from "../ui/_drawer";

interface MemoryPanelProps {
  open: boolean;
  onClose: () => void;
  accounts?: ConnectedAccountPublic[];
  onAddAccount?: () => void;
  onRemoveAccount?: (email: string) => void;
  onUpdateLabel?: (email: string, label: string, color?: string) => void;
}

const BADGE_COLORS = [
  "#6d86d3", "#7c3aed", "#059669", "#d97706",
  "#e11d48", "#0891b2", "#db2777", "#4f46e5",
];

export function MemoryPanel({ open, onClose, accounts, onAddAccount, onRemoveAccount, onUpdateLabel }: MemoryPanelProps) {
  const isMobile = useIsMobile();
  const { memory, loading, error, updateFacts, deleteFact, refresh } = useMemory();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [compactionOpen, setCompactionOpen] = useState(false);
  const [editingAccountEmail, setEditingAccountEmail] = useState<string | null>(null);
  const [accountLabelValue, setAccountLabelValue] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const accountEditRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (editingAccountEmail) accountEditRef.current?.focus();
  }, [editingAccountEmail]);

  useEffect(() => {
    if (editingIndex !== null) editRef.current?.focus();
  }, [editingIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const startEditing = useCallback((index: number, value: string) => {
    setEditingIndex(index);
    setEditValue(value);
  }, []);

  const saveEdit = useCallback(async () => {
    if (editingIndex === null || !memory) return;
    const updated = [...memory.userFacts];
    const trimmed = editValue.trim();
    if (!trimmed) {
      await deleteFact(editingIndex);
    } else {
      updated[editingIndex] = trimmed;
      await updateFacts(updated);
    }
    setEditingIndex(null);
    setEditValue("");
  }, [editingIndex, editValue, memory, updateFacts, deleteFact]);

  const handleDelete = useCallback(async (index: number) => {
    await deleteFact(index);
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditValue("");
    }
  }, [deleteFact, editingIndex]);

  const panelHeader = (
    <div className="flex shrink-0 items-center justify-between border-b border-border-100 px-5 py-4">
      <h2 className="text-base font-semibold text-foreground-100">Memory</h2>
      {!isMobile && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );

  const panelContent = (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && !memory && (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground-300 border-t-accent-100" />
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg bg-destructive-100/10 px-3 py-2 text-sm text-destructive-100">
              {error}
            </div>
          )}

          {/* Connected Accounts */}
          {accounts && accounts.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-widest text-foreground-300">
                Connected Accounts ({accounts.length})
              </h3>
              <ul className="flex flex-col gap-1.5">
                {accounts.map((account) => (
                  <li
                    key={account.email}
                    className="group flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-background-200"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: account.color || BADGE_COLORS[0] }}
                    />
                    <div className="min-w-0 flex-1">
                      {editingAccountEmail === account.email ? (
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            onUpdateLabel?.(account.email, accountLabelValue.trim());
                            setEditingAccountEmail(null);
                          }}
                        >
                          <input
                            ref={accountEditRef}
                            type="text"
                            value={accountLabelValue}
                            onChange={(e) => setAccountLabelValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Escape") setEditingAccountEmail(null); }}
                            placeholder="Label (e.g. Work)"
                            className="flex-1 rounded border border-border-100 bg-background-200 px-2 py-0.5 text-sm text-foreground-100 outline-none focus:border-accent-100"
                          />
                          <button type="submit" className="text-xs text-accent-100 hover:underline">Save</button>
                        </form>
                      ) : (
                        <>
                          <div className="text-sm font-medium text-foreground-200">
                            {account.label || account.email.split("@")[0]}
                          </div>
                          <div className="text-xs text-foreground-300">{account.email}</div>
                        </>
                      )}
                    </div>
                    {editingAccountEmail !== account.email && (
                      <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAccountEmail(account.email);
                            setAccountLabelValue(account.label || "");
                          }}
                          className="rounded p-1 text-foreground-300 transition-colors hover:bg-background-300 hover:text-foreground-200"
                          aria-label="Rename account"
                          title="Rename"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const currentIdx = BADGE_COLORS.indexOf(account.color || BADGE_COLORS[0]);
                            const nextColor = BADGE_COLORS[(currentIdx + 1) % BADGE_COLORS.length];
                            onUpdateLabel?.(account.email, account.label || "", nextColor);
                          }}
                          className="rounded p-1 text-foreground-300 transition-colors hover:bg-background-300 hover:text-foreground-200"
                          aria-label="Change color"
                          title="Change color"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                          </svg>
                        </button>
                        {accounts.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onRemoveAccount?.(account.email)}
                            className="rounded p-1 text-foreground-300 transition-colors hover:bg-destructive-100/10 hover:text-destructive-100"
                            aria-label="Disconnect account"
                            title="Disconnect"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {onAddAccount && (
                <button
                  type="button"
                  onClick={onAddAccount}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-100 px-3 py-2 text-xs text-foreground-300 transition-colors hover:border-foreground-300 hover:text-foreground-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                  Connect another account
                </button>
              )}
            </section>
          )}

          {memory && (
            <>
              {/* User Facts */}
              <section className="mb-6">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-widest text-foreground-300">
                  User Facts ({memory.userFacts.length})
                </h3>
                {memory.userFacts.length === 0 ? (
                  <p className="text-sm text-foreground-300">No facts stored yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {memory.userFacts.map((fact, i) => (
                      <li
                        key={`${i}-${fact.slice(0, 20)}`}
                        className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-background-200"
                      >
                        {editingIndex === i ? (
                          <form
                            className="flex flex-1 gap-2"
                            onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}
                          >
                            <input
                              ref={editRef}
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Escape") setEditingIndex(null); }}
                              className="flex-1 rounded border border-border-100 bg-background-200 px-2 py-1 text-sm text-foreground-100 outline-none focus:border-accent-100"
                            />
                            <button type="submit" className="text-xs text-accent-100 hover:underline">Save</button>
                            <button type="button" onClick={() => setEditingIndex(null)} className="text-xs text-foreground-300 hover:underline">Cancel</button>
                          </form>
                        ) : (
                          <>
                            <span className="flex-1 text-sm text-foreground-200">{fact}</span>
                            <button
                              type="button"
                              onClick={() => startEditing(i, fact)}
                              className="hidden shrink-0 rounded p-1 text-foreground-300 transition-colors hover:bg-background-300 hover:text-foreground-200 group-hover:block"
                              aria-label="Edit fact"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(i)}
                              className="hidden shrink-0 rounded p-1 text-foreground-300 transition-colors hover:bg-destructive-100/10 hover:text-destructive-100 group-hover:block"
                              aria-label="Delete fact"
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
                )}
              </section>

              {/* Conversation Summaries */}
              <section className="mb-6">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-widest text-foreground-300">
                  Conversation Summaries ({memory.conversationSummaries.length})
                </h3>
                {memory.conversationSummaries.length === 0 ? (
                  <p className="text-sm text-foreground-300">No summaries yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {[...memory.conversationSummaries].reverse().map((s) => (
                      <li key={s.id} className="rounded-lg bg-background-200 px-3 py-2">
                        <span className="text-xs text-foreground-300">{s.date}</span>
                        <p className="text-sm text-foreground-200">{s.summary}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Compaction Summary */}
              {memory.compactionSummary && (
                <section>
                  <button
                    type="button"
                    onClick={() => setCompactionOpen(!compactionOpen)}
                    className="mb-2 flex w-full items-center gap-2 text-xs font-medium uppercase tracking-widest text-foreground-300"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={cn("transition-transform", compactionOpen && "rotate-90")}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    Compaction Summary
                  </button>
                  {compactionOpen && (
                    <div className="rounded-lg bg-background-200 px-3 py-2">
                      <p className="whitespace-pre-wrap font-mono text-xs text-foreground-200">
                        {memory.compactionSummary}
                      </p>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
  );

  if (!open) return null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <Drawer.Content className="h-[85dvh]">
          {panelHeader}
          {panelContent}
          <div className="h-[env(safe-area-inset-bottom)]" />
        </Drawer.Content>
      </Drawer>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close memory panel"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
      />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-border-100 bg-background-100 shadow-2xl">
        {panelHeader}
        {panelContent}
      </div>
    </div>
  );
}

export function MemoryToggleButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open memory panel"
      title="Memory"
      className="rounded-lg p-1.5 text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    </button>
  );
}
