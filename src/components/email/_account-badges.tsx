import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib";
import type { ConnectedAccountPublic } from "../../lib";

interface AccountBadgesProps {
  accounts: ConnectedAccountPublic[];
  activeEmails: string[];
  onToggle: (email: string) => void;
  onSelectAll: () => void;
  onAddAccount: () => void;
  onRemoveAccount: (email: string) => void;
  onUpdateLabel: (email: string, label: string, color?: string) => void;
}

const BADGE_COLORS = [
  "#6d86d3", "#7c3aed", "#059669", "#d97706",
  "#e11d48", "#0891b2", "#db2777", "#4f46e5",
];

function getDisplayName(account: ConnectedAccountPublic): string {
  if (account.label) return account.label;
  const email = account.email;
  const local = email.split("@")[0];
  return local.length > 16 ? local.slice(0, 14) + "…" : local;
}

export function AccountBadges({
  accounts,
  activeEmails,
  onToggle,
  onSelectAll,
  onAddAccount,
  onRemoveAccount,
  onUpdateLabel,
}: AccountBadgesProps) {
  const [contextMenu, setContextMenu] = useState<{ email: string; x: number; y: number } | null>(null);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [contextMenu]);

  useEffect(() => {
    if (editingEmail) editRef.current?.focus();
  }, [editingEmail]);

  const handleContextMenu = useCallback((e: React.MouseEvent, email: string) => {
    e.preventDefault();
    setContextMenu({ email, x: e.clientX, y: e.clientY });
  }, []);

  const startRename = useCallback((email: string) => {
    const account = accounts.find((a) => a.email === email);
    setEditingEmail(email);
    setEditLabel(account?.label || "");
    setContextMenu(null);
  }, [accounts]);

  const saveLabel = useCallback(() => {
    if (!editingEmail) return;
    onUpdateLabel(editingEmail, editLabel.trim());
    setEditingEmail(null);
    setEditLabel("");
  }, [editingEmail, editLabel, onUpdateLabel]);

  if (accounts.length <= 1 && !accounts.length) return null;

  const allActive = accounts.length > 0 && activeEmails.length === accounts.length;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {accounts.length > 1 && (
        <button
          type="button"
          onClick={() => {
            if (allActive) return;
            onSelectAll();
          }}
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all lg:px-3 lg:py-1 lg:text-xs",
            allActive
              ? "border-border-100 bg-background-200 text-foreground-100"
              : "border-border-100 text-foreground-300 hover:border-foreground-300 hover:text-foreground-200",
          )}
        >
          All
        </button>
      )}

      <AnimatePresence>
        {accounts.map((account) => {
          const isActive = activeEmails.includes(account.email);
          const color = account.color || BADGE_COLORS[0];
          const displayName = getDisplayName(account);

          if (editingEmail === account.email) {
            return (
              <motion.form
                key={account.email}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex shrink-0 items-center gap-1"
                onSubmit={(e) => { e.preventDefault(); saveLabel(); }}
              >
                <input
                  ref={editRef}
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") setEditingEmail(null); }}
                  placeholder="Label…"
                  className="w-28 rounded-full border border-border-100 bg-background-100 px-3 py-1.5 text-sm outline-none focus:border-accent-100 lg:w-24 lg:px-2.5 lg:py-1 lg:text-xs"
                />
                <button type="submit" className="text-sm text-accent-100 hover:underline lg:text-xs">Save</button>
              </motion.form>
            );
          }

          return (
            <motion.button
              key={account.email}
              type="button"
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              onClick={() => onToggle(account.email)}
              onContextMenu={(e) => handleContextMenu(e, account.email)}
              title={account.email}
              className={cn(
                "group flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all lg:px-3 lg:py-1 lg:text-xs",
                isActive
                  ? "border-transparent text-white shadow-sm"
                  : "border-border-100 bg-transparent text-foreground-300 hover:border-foreground-300 hover:text-foreground-200",
              )}
              style={isActive ? { backgroundColor: color } : undefined}
            >
              {account.photoUrl ? (
                <img
                  src={account.photoUrl}
                  alt=""
                  className="h-5 w-5 shrink-0 rounded-full object-cover lg:h-4 lg:w-4"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span
                  className={cn("h-2 w-2 shrink-0 rounded-full lg:h-1.5 lg:w-1.5", isActive && "bg-white/60")}
                  style={!isActive ? { backgroundColor: color } : undefined}
                />
              )}
              {displayName}
            </motion.button>
          );
        })}
      </AnimatePresence>

      <button
        type="button"
        onClick={onAddAccount}
        title="Connect another email"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border-100 text-foreground-300 transition-colors hover:border-foreground-300 hover:text-foreground-200 lg:h-7 lg:w-7"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lg:h-3.5 lg:w-3.5">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </button>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[140px] rounded-lg border border-border-100 bg-background-100 py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => startRename(contextMenu.email)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground-200 hover:bg-background-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              const account = accounts.find((a) => a.email === contextMenu.email);
              if (!account) return;
              const currentIdx = BADGE_COLORS.indexOf(account.color || BADGE_COLORS[0]);
              const nextColor = BADGE_COLORS[(currentIdx + 1) % BADGE_COLORS.length];
              onUpdateLabel(contextMenu.email, account.label || "", nextColor);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground-200 hover:bg-background-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
            </svg>
            Change color
          </button>
          {accounts.length > 1 && (
            <button
              type="button"
              onClick={() => {
                onRemoveAccount(contextMenu.email);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}
