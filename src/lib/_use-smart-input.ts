import { useCallback, useEffect, useRef, useState } from "react";
import type { ContactSuggestion, EmailSuggestion } from "../components/smart-input";

interface UseSmartInputReturn {
  contacts: ContactSuggestion[];
  contactsLoading: boolean;
  searchContacts: (query: string) => Promise<ContactSuggestion[]>;
  searchEmails: (query: string) => Promise<EmailSuggestion[]>;
}

export function useSmartInput(): UseSmartInputReturn {
  const [contacts, setContacts] = useState<ContactSuggestion[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setContactsLoading(true);

    fetch("/api/contacts")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { contacts: ContactSuggestion[] };
        setContacts(data.contacts);
      })
      .catch(() => {})
      .finally(() => setContactsLoading(false));
  }, []);

  const searchContacts = useCallback(async (query: string): Promise<ContactSuggestion[]> => {
    if (query.length < 2) return [];
    try {
      const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return [];
      const data = (await res.json()) as { contacts: ContactSuggestion[] };
      return data.contacts;
    } catch {
      return [];
    }
  }, []);

  const searchEmails = useCallback(async (query: string): Promise<EmailSuggestion[]> => {
    try {
      const res = await fetch(`/api/emails/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return [];
      const data = (await res.json()) as { emails: EmailSuggestion[] };
      return data.emails;
    } catch {
      return [];
    }
  }, []);

  return { contacts, contactsLoading, searchContacts, searchEmails };
}
