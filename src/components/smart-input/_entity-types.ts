export type PersonEntity = {
  type: "person";
  name: string;
  email: string;
};

export type EmailEntity = {
  type: "email";
  id: string;
  threadId: string;
  subject: string;
  from?: string;
};

export type CategoryEntity = {
  type: "category";
  name: string;
};

export type LinkEntity = {
  type: "link";
  url: string;
};

export type SmartEntity = PersonEntity | EmailEntity | CategoryEntity | LinkEntity;

export interface ContactSuggestion {
  name: string;
  email: string;
}

export interface EmailSuggestion {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
}

export interface SmartInputProps {
  value?: string;
  onChange?: (text: string, entities: SmartEntity[]) => void;
  onSubmit?: (text: string, entities: SmartEntity[]) => void;
  placeholder?: string;
  /** false = single line (Enter submits), true = multi-line (Shift+Enter submits) */
  multiline?: boolean;
  categories?: string[];
  contacts?: ContactSuggestion[];
  onSearchContacts?: (query: string) => Promise<ContactSuggestion[]>;
  onSearchEmails?: (query: string) => Promise<EmailSuggestion[]>;
  onCategoriesDetected?: (categories: string[]) => void;
  onBlur?: () => void;
  className?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}
