import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConnectedAccountPublic } from "./_accounts";
import type { AccountColorMap } from "../components/email/_email-row";

export interface UseAccountsReturn {
  accounts: ConnectedAccountPublic[];
  activeEmails: string[];
  accountColors: AccountColorMap;
  toggleAccount: (email: string) => Promise<void>;
  selectAccount: (email: string) => Promise<void>;
  selectAllAccounts: () => Promise<void>;
  addAccount: () => Promise<void>;
  removeAccount: (email: string) => Promise<void>;
  updateLabel: (email: string, label: string, color?: string) => Promise<void>;
  setPrimary: (email: string) => Promise<void>;
}

export function useAccounts(): UseAccountsReturn {
  const [accounts, setAccounts] = useState<ConnectedAccountPublic[]>([]);
  const [activeEmails, setActiveEmails] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/accounts", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as {
          accounts: ConnectedAccountPublic[];
          activeEmails: string[];
        };
        setAccounts(data.accounts);
        setActiveEmails(data.activeEmails);
      } catch {
        // ignore
      }
    })();
    return () => controller.abort();
  }, []);

  const accountColors = useMemo<AccountColorMap>(() => {
    const map: AccountColorMap = {};
    for (const a of accounts) {
      if (a.color) map[a.email] = a.color;
    }
    return map;
  }, [accounts]);

  const toggleAccount = useCallback(
    async (email: string) => {
      const isActive = activeEmails.includes(email);
      let newActive: string[];
      if (isActive && activeEmails.length > 1) {
        newActive = activeEmails.filter((e) => e !== email);
      } else if (!isActive) {
        newActive = [...activeEmails, email];
      } else {
        return;
      }
      setActiveEmails(newActive);
      try {
        await fetch("/api/accounts/active", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: newActive }),
        });
      } catch {
        setActiveEmails(activeEmails);
      }
    },
    [activeEmails],
  );

  const selectAccount = useCallback(async (email: string) => {
    const newActive = [email];
    setActiveEmails(newActive);
    try {
      await fetch("/api/accounts/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: newActive }),
      });
    } catch {
      // ignore
    }
  }, []);

  const selectAllAccounts = useCallback(async () => {
    const allEmails = accounts.map((a) => a.email);
    setActiveEmails(allEmails);
    try {
      await fetch("/api/accounts/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: allEmails }),
      });
    } catch {
      // ignore
    }
  }, [accounts]);

  const addAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/auth-url?addAccount=true");
      if (!res.ok) return;
      const data = (await res.json()) as { authUrl: string };
      window.location.assign(data.authUrl);
    } catch {
      // ignore
    }
  }, []);

  const removeAccount = useCallback(
    async (email: string) => {
      try {
        await fetch("/api/accounts", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        setAccounts((prev) => prev.filter((a) => a.email !== email));
        setActiveEmails((prev) => {
          const next = prev.filter((e) => e !== email);
          return next.length > 0
            ? next
            : accounts.filter((a) => a.email !== email).map((a) => a.email);
        });
      } catch {
        // ignore
      }
    },
    [accounts],
  );

  const updateLabel = useCallback(
    async (email: string, label: string, color?: string) => {
      try {
        await fetch("/api/accounts/label", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, label: label || undefined, color }),
        });
        setAccounts((prev) =>
          prev.map((a) =>
            a.email === email
              ? { ...a, label: label || undefined, color: color ?? a.color }
              : a,
          ),
        );
      } catch {
        // ignore
      }
    },
    [],
  );

  const setPrimary = useCallback(async (email: string) => {
    try {
      const res = await fetch("/api/accounts/primary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { accounts: ConnectedAccountPublic[] };
      setAccounts(data.accounts);
    } catch {
      // ignore
    }
  }, []);

  return {
    accounts,
    activeEmails,
    accountColors,
    toggleAccount,
    selectAccount,
    selectAllAccounts,
    addAccount,
    removeAccount,
    updateLabel,
    setPrimary,
  };
}
