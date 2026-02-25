import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { getCategoryColor } from "../../lib";

export const CategoryHighlightPluginKey = new PluginKey("categoryHighlight");

/**
 * TipTap extension that automatically highlights category names in the
 * editor text using per-category colors. No trigger character needed --
 * categories are detected as the user types.
 *
 * Each matched category gets inline CSS variables (--cat-r/g/b) derived
 * from its actual color (including custom user-set colors).
 */
export function createCategoryHighlightExtension(
  getCategories: () => string[],
  onDetected?: (detected: string[]) => void,
) {
  return Extension.create({
    name: "categoryHighlight",

    addProseMirrorPlugins() {
      let lastDetectedKey = "";

      return [
        new Plugin({
          key: CategoryHighlightPluginKey,
          state: {
            init(_, state) {
              return buildDecorations(state.doc, getCategories());
            },
            apply(tr, oldDecorations) {
              if (!tr.docChanged) return oldDecorations;
              const categories = getCategories();
              const decorations = buildDecorations(tr.doc, categories);

              const found = findAllCategories(tr.doc, categories);
              const key = found.join(",");
              if (key !== lastDetectedKey) {
                lastDetectedKey = key;
                onDetected?.(found);
              }

              return decorations;
            },
          },
          props: {
            decorations(state) {
              return this.getState(state);
            },
          },
        }),
      ];
    },
  });
}

function hexToChannels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function buildDecorations(doc: ReturnType<typeof Object>, categories: string[]) {
  const decorations: Decoration[] = [];
  if (categories.length === 0) return DecorationSet.empty;

  const escaped = categories.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");

  doc.descendants((node: { isText: boolean; text?: string }, pos: number) => {
    if (!node.isText || !node.text) return;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(node.text)) !== null) {
      const matchedName = match[1];
      const cat = categories.find(
        (c) => c.toLowerCase() === matchedName.toLowerCase(),
      );
      const color = getCategoryColor(cat ?? matchedName, categories);
      const [r, g, b] = hexToChannels(color.hex);
      const from = pos + match.index;
      const to = from + match[0].length;
      decorations.push(
        Decoration.inline(from, to, {
          class: "smart-category-highlight",
          style: `--cat-r:${r};--cat-g:${g};--cat-b:${b}`,
        }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

// ── Inline suggestion (ghost-text completion) ──

interface SuggestionDoc {
  textBetween(from: number, to: number, separator: string): string;
}

export function getInlineCategorySuggestion(
  doc: SuggestionDoc,
  selection: { from: number; to: number },
  categories: string[],
): { match: string; remainder: string; partialLen: number } | null {
  if (categories.length === 0 || selection.from !== selection.to) return null;
  const { from } = selection;
  const textBefore = doc.textBetween(Math.max(0, from - 50), from, "\n");
  const wordMatch = textBefore.match(/(\S+)$/);
  if (!wordMatch || wordMatch[1].length < 2) return null;

  const partial = wordMatch[1].toLowerCase();
  const match = categories.find(
    (c) => c.toLowerCase().startsWith(partial) && c.toLowerCase() !== partial,
  );
  if (!match) return null;

  return { match, remainder: match.slice(wordMatch[1].length), partialLen: wordMatch[1].length };
}

export function createInlineSuggestionExtension(
  getCategories: () => string[],
) {
  return Extension.create({
    name: "inlineSuggestion",

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("inlineSuggestion"),
          state: {
            init(_, state) {
              return buildSuggestionDecorations(state, getCategories());
            },
            apply(tr, old, _oldState, newState) {
              if (!tr.docChanged && !tr.selectionSet) return old;
              return buildSuggestionDecorations(newState, getCategories());
            },
          },
          props: {
            decorations(state) {
              return this.getState(state);
            },
          },
        }),
      ];
    },
  });
}

function buildSuggestionDecorations(
  state: { doc: SuggestionDoc & { content: { size: number } }; selection: { from: number; to: number } },
  categories: string[],
) {
  const suggestion = getInlineCategorySuggestion(state.doc, state.selection, categories);
  if (!suggestion) return DecorationSet.empty;

  const color = getCategoryColor(suggestion.match, categories);
  const [r, g, b] = hexToChannels(color.hex);

  const widget = Decoration.widget(
    state.selection.from,
    () => {
      const span = document.createElement("span");
      span.textContent = suggestion.remainder;
      span.className = "smart-inline-suggestion";
      span.style.setProperty("--cat-r", String(r));
      span.style.setProperty("--cat-g", String(g));
      span.style.setProperty("--cat-b", String(b));
      return span;
    },
    { side: 1 },
  );

  return DecorationSet.create(
    state.doc as Parameters<typeof DecorationSet.create>[0],
    [widget],
  );
}

function findAllCategories(doc: ReturnType<typeof Object>, categories: string[]): string[] {
  if (categories.length === 0) return [];

  const escaped = categories.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");

  const found = new Set<string>();
  doc.descendants((node: { isText: boolean; text?: string }) => {
    if (!node.isText || !node.text) return;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(node.text)) !== null) {
      const matchedCat = categories.find(
        (c) => c.toLowerCase() === match![1].toLowerCase(),
      );
      if (matchedCat) found.add(matchedCat);
    }
  });
  return Array.from(found);
}
