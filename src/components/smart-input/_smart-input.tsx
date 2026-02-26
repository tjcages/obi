import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { cn } from "../../lib";
import { PersonMentionNode } from "./_mention-people";
import { EmailMentionNode } from "./_mention-email";
import {
  createCategoryHighlightExtension,
  createInlineSuggestionExtension,
  getInlineCategorySuggestion,
} from "./_category-mark";
import {
  AutocompletePopover,
  type AutocompletePopoverRef,
  type SuggestionGroup,
} from "./_autocomplete-popover";
import type {
  ContactSuggestion,
  EmailSuggestion,
  SmartEntity,
  SmartInputProps,
} from "./_entity-types";

/**
 * SmartInput: a rich text input powered by TipTap that supports
 * @mentions for people/emails, category detection, and URL auto-linking.
 */
export function SmartInput({
  value,
  onChange,
  onSubmit,
  placeholder = "",
  multiline = false,
  categories = [],
  contacts = [],
  onSearchContacts,
  onSearchEmails,
  onCategoriesDetected,
  onBlur,
  className,
  autoFocus = false,
  disabled = false,
}: SmartInputProps) {
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteGroups, setAutocompleteGroups] = useState<SuggestionGroup[]>([]);
  const [autocompletePos, setAutocompletePos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const popoverRef = useRef<AutocompletePopoverRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contactSearchDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const emailSearchDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  const initialValueSet = useRef(false);
  const autocompleteTrigger = useRef<{ type: "mention"; len: number }>({ type: "mention", len: 0 });

  const categoryExtension = useMemo(
    () =>
      createCategoryHighlightExtension(
        () => categoriesRef.current,
        onCategoriesDetected,
      ),
    [onCategoriesDetected],
  );

  const inlineSuggestionExtension = useMemo(
    () => createInlineSuggestionExtension(() => categoriesRef.current),
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
        hardBreak: multiline ? undefined : false,
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        autolink: true,
        openOnClick: false,
        HTMLAttributes: { class: "smart-link" },
      }),
      PersonMentionNode,
      EmailMentionNode,
      categoryExtension,
      inlineSuggestionExtension,
    ],
    editorProps: {
      attributes: {
        "class": cn(
          "smart-input-editor outline-none",
          !multiline && "smart-input-single-line",
        ),
        "enterkeyhint": multiline ? "enter" : "send",
        "inputmode": "text",
        "autocomplete": "off",
        "autocorrect": "on",
        "autocapitalize": "sentences",
      },
      handleKeyDown: (_view, event) => {
        if (showAutocomplete && popoverRef.current) {
          const handled = popoverRef.current.onKeyDown(event as unknown as React.KeyboardEvent);
          if (handled) {
            event.preventDefault();
            return true;
          }
        }

        if (event.key === "Tab" && !event.shiftKey) {
          const suggestion = getInlineCategorySuggestion(
            _view.state.doc,
            _view.state.selection,
            categoriesRef.current,
          );
          if (suggestion) {
            event.preventDefault();
            const { from } = _view.state.selection;
            _view.dispatch(
              _view.state.tr.insertText(
                suggestion.match + " ",
                from - suggestion.partialLen,
                from,
              ),
            );
            return true;
          }
        }

        if (event.key === "Escape") {
          onBlur?.();
          return true;
        }

        if (event.key === "Enter") {
          if (!multiline) {
            event.preventDefault();
            handleSubmit();
            return true;
          }
          if (event.shiftKey || event.metaKey) {
            event.preventDefault();
            handleSubmit();
            return true;
          }
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const text = ed.getText();
      const entities = extractEntities(ed, categoriesRef.current);
      onChange?.(text, entities);
      checkForMentionTrigger(ed);
    },
    onBlur: ({ event }) => {
      const related = (event as FocusEvent)?.relatedTarget as HTMLElement | null;
      if (related && containerRef.current?.contains(related)) return;
      onBlur?.();
    },
    editable: !disabled,
    immediatelyRender: false,
  });

  // Sync external value into editor (only on mount or when value changes externally)
  useEffect(() => {
    if (!editor) return;
    if (!initialValueSet.current && value !== undefined) {
      editor.commands.setContent(value ? `<p>${escapeHtml(value)}</p>` : "");
      initialValueSet.current = true;
    }
  }, [editor, value]);

  const handleSubmit = useCallback(() => {
    if (!editor) return;
    const text = editor.getText().trim();
    if (!text) return;
    const entities = extractEntities(editor, categoriesRef.current);
    onSubmit?.(text, entities);
    editor.commands.clearContent();
    initialValueSet.current = true;
  }, [editor, onSubmit]);

  const checkForMentionTrigger = useCallback(
    (ed: Editor) => {
      const { state } = ed;
      const { from } = state.selection;
      const textBefore = state.doc.textBetween(
        Math.max(0, from - 50),
        from,
        "\n",
      );

      const atMatch = textBefore.match(/@(\S*)$/);
      if (atMatch) {
        const query = atMatch[1].toLowerCase();
        autocompleteTrigger.current = { type: "mention", len: atMatch[0].length };
        setShowAutocomplete(true);
        updateAutocompletePosition(ed);
        filterSuggestions(query);
        return;
      }

      setShowAutocomplete(false);
    },
    [],
  );

  const filterSuggestions = useCallback(
    (query: string) => {
      const groups: SuggestionGroup[] = [];

      // Instant: filter cached contacts
      const matchingPeople = contacts
        .filter(
          (c) =>
            c.name?.toLowerCase().includes(query) ||
            c.email.toLowerCase().includes(query),
        )
        .slice(0, 5);
      if (matchingPeople.length > 0) {
        groups.push({ type: "people", items: matchingPeople });
      }

      setAutocompleteGroups(groups);

      // Live: search contacts via Gmail when local results are sparse
      if (onSearchContacts && query.length >= 2) {
        clearTimeout(contactSearchDebounce.current);
        contactSearchDebounce.current = setTimeout(async () => {
          try {
            const liveContacts = await onSearchContacts(query);
            if (liveContacts.length > 0) {
              setAutocompleteGroups((prev) => {
                const existing = prev.find((g) => g.type === "people");
                const cachedEmails = new Set(
                  (existing?.items as ContactSuggestion[] | undefined)?.map((c) => c.email) ?? [],
                );
                const newContacts = liveContacts.filter((c) => !cachedEmails.has(c.email));
                if (newContacts.length === 0) return prev;
                const merged = [
                  ...(existing?.items as ContactSuggestion[] ?? []),
                  ...newContacts,
                ].slice(0, 8);
                const withoutPeople = prev.filter((g) => g.type !== "people");
                return [{ type: "people" as const, items: merged }, ...withoutPeople];
              });
            }
          } catch {
            // live contact search failed, cached results remain
          }
        }, 250);
      }

      if (onSearchEmails && query.length >= 2) {
        clearTimeout(emailSearchDebounce.current);
        emailSearchDebounce.current = setTimeout(async () => {
          try {
            const emails = await onSearchEmails(query);
            setAutocompleteGroups((prev) => {
              const withoutEmails = prev.filter((g) => g.type !== "emails");
              if (emails.length > 0) {
                return [...withoutEmails, { type: "emails", items: emails.slice(0, 5) }];
              }
              return withoutEmails;
            });
          } catch {
            // email search failed
          }
        }, 300);
      }
    },
    [contacts, onSearchContacts, onSearchEmails],
  );

  const updateAutocompletePosition = useCallback(
    (ed: Editor) => {
      const { view } = ed;
      const coords = view.coordsAtPos(view.state.selection.from);
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (containerRect) {
        const mobile = window.matchMedia("(max-width: 767px)").matches;
        if (mobile) {
          setAutocompletePos({
            bottom: containerRect.height - (coords.top - containerRect.top) + 4,
            left: coords.left - containerRect.left,
          });
        } else {
          setAutocompletePos({
            top: coords.bottom - containerRect.top + 4,
            left: coords.left - containerRect.left,
          });
        }
      }
    },
    [],
  );

  const handleAutocompleteSelect = useCallback(
    (item: ContactSuggestion | EmailSuggestion | string) => {
      if (!editor) return;

      const { state } = editor;
      const { from } = state.selection;
      const triggerLen = autocompleteTrigger.current.len;
      const deleteFrom = from - triggerLen;

      if (typeof item === "string") {
        return;
      } else if ("email" in item && !("threadId" in item)) {
        // Person mention
        const contact = item as ContactSuggestion;
        editor
          .chain()
          .focus()
          .deleteRange({ from: deleteFrom, to: from })
          .insertContent({
            type: "personMention",
            attrs: { name: contact.name, email: contact.email },
          })
          .insertContent(" ")
          .run();
      } else {
        // Email mention
        const email = item as EmailSuggestion;
        editor
          .chain()
          .focus()
          .deleteRange({ from: deleteFrom, to: from })
          .insertContent({
            type: "emailMention",
            attrs: {
              id: email.id,
              threadId: email.threadId,
              subject: email.subject,
              from: email.from,
            },
          })
          .insertContent(" ")
          .run();
      }

      setShowAutocomplete(false);
    },
    [editor],
  );

  // Close autocomplete on blur
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowAutocomplete(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Focus editor when autoFocus is set
  useEffect(() => {
    if (autoFocus && editor) {
      setTimeout(() => editor.commands.focus(), 0);
    }
  }, [autoFocus, editor]);

  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget && editor) {
        editor.commands.focus("end");
      }
    },
    [editor],
  );

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      onClick={handleContainerClick}
    >
      <EditorContent editor={editor} />
      {showAutocomplete && autocompletePos && autocompleteGroups.length > 0 && (
        <div
          style={{
            position: "absolute",
            ...(autocompletePos.top !== undefined ? { top: autocompletePos.top } : {}),
            ...(autocompletePos.bottom !== undefined ? { bottom: autocompletePos.bottom } : {}),
            left: Math.max(0, autocompletePos.left),
          }}
        >
          <AutocompletePopover
            ref={popoverRef}
            groups={autocompleteGroups}
            onSelect={handleAutocompleteSelect}
            placement={autocompletePos.bottom !== undefined ? "above" : "below"}
          />
        </div>
      )}
    </div>
  );
}

function extractEntities(editor: Editor, categories: string[]): SmartEntity[] {
  const entities: SmartEntity[] = [];
  const { doc } = editor.state;

  doc.descendants((node) => {
    if (node.type.name === "personMention") {
      entities.push({
        type: "person",
        name: node.attrs.name,
        email: node.attrs.email,
      });
    } else if (node.type.name === "emailMention") {
      entities.push({
        type: "email",
        id: node.attrs.id,
        threadId: node.attrs.threadId,
        subject: node.attrs.subject,
        from: node.attrs.from,
      });
    }
  });

  // Extract links
  doc.descendants((node) => {
    if (!node.isText) return;
    node.marks.forEach((mark) => {
      if (mark.type.name === "link") {
        entities.push({ type: "link", url: mark.attrs.href });
      }
    });
  });

  // Extract categories by scanning text against the known list
  if (categories.length > 0) {
    const fullText = doc.textContent;
    const escaped = categories.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
    const found = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(fullText)) !== null) {
      const cat = categories.find((c) => c.toLowerCase() === match![1].toLowerCase());
      if (cat && !found.has(cat)) {
        found.add(cat);
        entities.push({ type: "category", name: cat });
      }
    }
  }

  return entities;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
