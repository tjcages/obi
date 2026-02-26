import { useEffect, useRef, useState, forwardRef, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../../lib";
import type { ConnectedAccountPublic } from "../../lib";
import { useNavStackContext } from "../nav-stack";
import { AccountAvatar } from "./_account-avatar";

interface ProfileButtonProps {
  accounts: ConnectedAccountPublic[];
  activeEmails?: string[];
  size?: number;
  onSelectAccount?: (email: string) => void;
  onSelectAll?: () => void;
  onSetPrimary?: (email: string) => void;
  onAddAccount?: () => void;
  onRemoveAccount?: (email: string) => void;
  onUpdateLabel?: (email: string, label: string) => void;
}

export function ProfileButton({
  accounts,
  activeEmails = [],
  size = 42,
  onSelectAccount,
  onSelectAll,
  onSetPrimary,
  onAddAccount,
  onRemoveAccount,
  onUpdateLabel,
}: ProfileButtonProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const labelInputRef = useRef<HTMLInputElement>(null);

  const primaryAccount = accounts.find((a) => a.isPrimary) ?? accounts[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setEditingEmail(null);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (editingEmail) labelInputRef.current?.focus();
  }, [editingEmail]);

  const handleSelectAccount = useCallback((email: string) => {
    onSelectAccount?.(email);
    setOpen(false);
  }, [onSelectAccount]);

  const handleSelectAll = useCallback(() => {
    onSelectAll?.();
    setOpen(false);
  }, [onSelectAll]);

  const handleAddAccount = useCallback(() => {
    setOpen(false);
    onAddAccount?.();
  }, [onAddAccount]);

  const handleSaveLabel = useCallback((email: string) => {
    onUpdateLabel?.(email, editLabel.trim());
    setEditingEmail(null);
  }, [editLabel, onUpdateLabel]);

  return (
    <div className="relative">
      <motion.button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.85 }}
        whileHover={{ scale: 1.08 }}
        transition={{ type: "spring", stiffness: 500, damping: 15 }}
        className="overflow-hidden rounded-full select-none shadow-md shadow-black/10 ring-2 ring-foreground-100/5 transition-shadow hover:shadow-lg hover:ring-foreground-100/10 active:shadow-sm"
        title={primaryAccount?.email || "Profile"}
      >
        {primaryAccount ? (
          <AccountAvatar account={primaryAccount} size={size} />
        ) : (
          <div
            className="flex items-center justify-center rounded-full bg-foreground-300 font-semibold text-white"
            style={{ width: size, height: size, fontSize: size * 0.3 }}
          >
            ?
          </div>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <ProfileDropdown
            ref={dropdownRef}
            accounts={accounts}
            activeEmails={activeEmails}
            primaryAccount={primaryAccount}
            editingEmail={editingEmail}
            editLabel={editLabel}
            labelInputRef={labelInputRef}
            showAccountSwitching={!!onSelectAccount}
            showLabelEditing={!!onUpdateLabel}
            onSelectAccount={handleSelectAccount}
            onSelectAll={handleSelectAll}
            onSetPrimary={onSetPrimary}
            onAddAccount={handleAddAccount}
            onRemoveAccount={onRemoveAccount}
            onStartEditing={(email, label) => {
              setEditingEmail(email);
              setEditLabel(label);
            }}
            onSaveLabel={handleSaveLabel}
            onCancelEditing={() => setEditingEmail(null)}
            onEditLabelChange={setEditLabel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface ProfileDropdownProps {
  accounts: ConnectedAccountPublic[];
  activeEmails: string[];
  primaryAccount: ConnectedAccountPublic | undefined;
  editingEmail: string | null;
  editLabel: string;
  labelInputRef: React.RefObject<HTMLInputElement | null>;
  showAccountSwitching: boolean;
  showLabelEditing: boolean;
  onSelectAccount: (email: string) => void;
  onSelectAll: () => void;
  onSetPrimary?: (email: string) => void;
  onAddAccount: () => void;
  onRemoveAccount?: (email: string) => void;
  onStartEditing: (email: string, currentLabel: string) => void;
  onSaveLabel: (email: string) => void;
  onCancelEditing: () => void;
  onEditLabelChange: (value: string) => void;
}

const ProfileDropdown = forwardRef<HTMLDivElement, ProfileDropdownProps>(
  function ProfileDropdown(
    {
      accounts,
      activeEmails,
      primaryAccount,
      editingEmail,
      editLabel,
      labelInputRef,
      showAccountSwitching,
      showLabelEditing,
      onSelectAccount,
      onSelectAll,
      onSetPrimary,
      onAddAccount,
      onRemoveAccount,
      onStartEditing,
      onSaveLabel,
      onCancelEditing,
      onEditLabelChange,
    },
    ref,
  ) {
    const navCtx = useNavStackContext();

    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, scale: 0.95, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -4 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="absolute right-0 top-full z-50 mt-2 w-80 origin-top-right rounded-xl border border-border-100 bg-background-100 shadow-xl"
      >
        {/* Primary account header */}
        {primaryAccount && (
          <div className="flex items-center gap-3 border-b border-border-100 px-4 py-3">
            <AccountAvatar account={primaryAccount} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground-100">
                {primaryAccount.name || primaryAccount.label || primaryAccount.email.split("@")[0]}
              </div>
              <div className="truncate text-xs text-foreground-300">
                {primaryAccount.email}
              </div>
            </div>
          </div>
        )}

        {/* Account list */}
        {showAccountSwitching && (
          <div className="border-b border-border-100 px-2 py-2">
            {accounts.length > 1 && (
              <button
                type="button"
                onClick={onSelectAll}
                className={cn(
                  "mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-background-200",
                  activeEmails.length === accounts.length && "bg-background-200",
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background-300">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-200">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-foreground-100">All accounts</div>
                  <div className="text-xs text-foreground-300 lg:text-[11px]">View merged inbox</div>
                </div>
                {activeEmails.length === accounts.length && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-blue-500">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            )}

            {accounts.map((account) => {
              const isSelected = activeEmails.length === 1 && activeEmails[0] === account.email;
              const isPrimary = account.isPrimary || account === accounts[0];

              return (
                <div key={account.email} className="group relative">
                  {showLabelEditing && editingEmail === account.email ? (
                    <form
                      className="flex items-center gap-2 rounded-lg px-2.5 py-2"
                      onSubmit={(e) => { e.preventDefault(); onSaveLabel(account.email); }}
                    >
                      <AccountAvatar account={account} size={32} />
                      <input
                        ref={labelInputRef}
                        type="text"
                        value={editLabel}
                        onChange={(e) => onEditLabelChange(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") onCancelEditing(); }}
                        placeholder="Label (e.g. Work)"
                        className="flex-1 rounded border border-border-100 bg-background-200 px-2 py-1 text-xs outline-none focus:border-blue-400"
                      />
                      <button type="submit" className="text-[10px] font-medium text-blue-500 hover:underline">
                        Save
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectAccount(account.email)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-background-200",
                        isSelected && "bg-background-200",
                      )}
                    >
                      <AccountAvatar account={account} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm text-foreground-100">
                            {account.name || account.label || account.email.split("@")[0]}
                          </span>
                          {isPrimary && (
                            <span className="shrink-0 rounded bg-background-300 px-1.5 py-0.5 text-[11px] font-medium text-foreground-200 lg:px-1 lg:py-px lg:text-[9px]">
                              Default
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-foreground-300 lg:text-[11px]">
                          {account.email}
                        </div>
                      </div>
                      {isSelected && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-blue-500">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  )}

                  {/* Hover actions */}
                  {showLabelEditing && editingEmail !== account.email && (
                    <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onStartEditing(account.email, account.label || ""); }}
                        className="rounded p-1 text-foreground-300 hover:bg-background-300 hover:text-foreground-200"
                        title="Rename"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      {!isPrimary && accounts.length > 1 && onSetPrimary && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onSetPrimary(account.email); }}
                          className="rounded p-1 text-foreground-300 hover:bg-background-300 hover:text-foreground-200"
                          title="Set as default"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </button>
                      )}
                      {accounts.length > 1 && onRemoveAccount && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onRemoveAccount(account.email); }}
                          className="rounded p-1 text-foreground-300 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                          title="Disconnect"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Simple account list when no switching (just show others) */}
        {!showAccountSwitching && accounts.length > 1 && (
          <div className="border-b border-border-100 px-2 py-1.5">
            {accounts.filter((a) => a !== primaryAccount).map((account) => (
              <div
                key={account.email}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2"
              >
                <AccountAvatar account={account} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-foreground-200">
                    {account.name || account.email.split("@")[0]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add account + Settings + Log out */}
        <div className="px-2 py-2">
          {onAddAccount && (
            <button
              type="button"
              onClick={onAddAccount}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground-200 transition-colors hover:bg-background-200 hover:text-foreground-100"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-foreground-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </div>
              Add another account
            </button>
          )}
          {navCtx ? (
            <button
              type="button"
              onClick={() => navCtx.push("settings", { title: "Settings", variant: "cover" })}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground-200 transition-colors hover:bg-background-200 hover:text-foreground-100"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </div>
              Settings
            </button>
          ) : (
            <a
              href="/settings"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground-200 transition-colors hover:bg-background-200 hover:text-foreground-100"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </div>
              Settings
            </a>
          )}
          <a
            href="/logout"
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground-200 transition-colors hover:bg-background-200 hover:text-foreground-100"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </div>
            Log out
          </a>
        </div>
      </motion.div>
    );
  },
);
