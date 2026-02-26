import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type KeyboardEvent,
} from "react";
import { cn, getCategoryColor } from "../../lib";
import type { ContactSuggestion, EmailSuggestion } from "./_entity-types";

export type SuggestionGroup =
  | { type: "people"; items: ContactSuggestion[] }
  | { type: "emails"; items: EmailSuggestion[] }
  | { type: "categories"; items: string[] };

export interface AutocompletePopoverProps {
  groups: SuggestionGroup[];
  onSelect: (item: ContactSuggestion | EmailSuggestion | string) => void;
  allCategories?: string[];
  placement?: "below" | "above";
  className?: string;
}

export interface AutocompletePopoverRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const AutocompletePopover = forwardRef<
  AutocompletePopoverRef,
  AutocompletePopoverProps
>(function AutocompletePopover({ groups, onSelect, allCategories = [], placement = "below", className }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const flatItems = groups.flatMap((g) =>
    g.items.map((item) => ({ groupType: g.type, item })),
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [flatItems.length]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (flatItems.length === 0) return false;

      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % flatItems.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i - 1 + flatItems.length) % flatItems.length);
        return true;
      }
      if (event.key === "Enter") {
        const selected = flatItems[selectedIndex];
        if (selected) onSelect(selected.item);
        return true;
      }
      return false;
    },
  }));

  if (flatItems.length === 0) return null;

  let runningIndex = 0;

  return (
    <div
      className={cn(
        "absolute left-0 z-50 max-h-64 w-72 overflow-y-auto rounded-lg border border-border-100 bg-background-100 shadow-lg",
        placement === "above" ? "bottom-0 mb-1" : "mt-1",
        className,
      )}
    >
      {groups.map((group) => {
        if (group.items.length === 0) return null;
        const startIndex = runningIndex;
        runningIndex += group.items.length;

        return (
          <div key={group.type}>
            <div className="sticky top-0 border-b border-border-100 bg-background-200/80 px-3 py-2 text-xs font-medium uppercase tracking-wider text-foreground-300 backdrop-blur-sm lg:py-1.5 lg:text-[10px]">
              {group.type === "people" && "People"}
              {group.type === "emails" && "Emails"}
              {group.type === "categories" && "Projects"}
            </div>
            {group.items.map((item, i) => {
              const globalIndex = startIndex + i;
              const isSelected = globalIndex === selectedIndex;

              if (group.type === "people") {
                const contact = item as ContactSuggestion;
                return (
                  <button
                    key={contact.email}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-3 text-left text-base transition-colors lg:gap-2 lg:py-2 lg:text-sm",
                      isSelected
                        ? "bg-accent-100/10 text-foreground-100"
                        : "text-foreground-200 hover:bg-background-200",
                    )}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSelect(contact)}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-100/15 text-xs font-medium text-accent-100 lg:h-6 lg:w-6 lg:text-[10px]">
                      {(contact.name?.[0] ?? contact.email[0]).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{contact.name || contact.email}</div>
                      {contact.name && (
                        <div className="truncate text-sm text-foreground-300 lg:text-xs">{contact.email}</div>
                      )}
                    </div>
                  </button>
                );
              }

              if (group.type === "emails") {
                const email = item as EmailSuggestion;
                return (
                  <button
                    key={email.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-3 text-left text-base transition-colors lg:gap-2 lg:py-2 lg:text-sm",
                      isSelected
                        ? "bg-accent-100/10 text-foreground-100"
                        : "text-foreground-200 hover:bg-background-200",
                    )}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSelect(email)}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-sm text-blue-500 lg:h-6 lg:w-6 lg:text-xs">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{email.subject || "(no subject)"}</div>
                      <div className="truncate text-sm text-foreground-300 lg:text-xs">{email.from}</div>
                    </div>
                  </button>
                );
              }

              if (group.type === "categories") {
                const cat = item as string;
                const color = getCategoryColor(cat, allCategories);
                return (
                  <button
                    key={cat}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-3 text-left text-base transition-colors lg:gap-2 lg:py-2 lg:text-sm",
                      isSelected
                        ? "bg-accent-100/10 text-foreground-100"
                        : "text-foreground-200 hover:bg-background-200",
                    )}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSelect(cat)}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm lg:h-6 lg:w-6 lg:text-xs",
                        color.style ? "" : `${color.bg} ${color.text}`,
                      )}
                      style={color.style ? { backgroundColor: `${color.hex}20`, color: color.hex } : undefined}
                    >
                      #
                    </span>
                    <span className="truncate font-medium">{cat}</span>
                  </button>
                );
              }

              return null;
            })}
          </div>
        );
      })}
    </div>
  );
});
