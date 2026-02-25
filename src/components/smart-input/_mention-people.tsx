import { mergeAttributes, Node } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";

export const PersonMentionPluginKey = new PluginKey("personMention");

function firstName(full: string): string {
  return full.split(/\s+/)[0] || full;
}

function displayName(node: { attrs: Record<string, string> }): string {
  if (node.attrs.name) return firstName(node.attrs.name);
  const email = node.attrs.email || "";
  return email.split("@")[0] || email;
}

/**
 * Custom node for person mentions.
 * Renders as an inline pill showing the person's first name.
 * leafText ensures getText() includes the name in extracted plain text.
 */
export const PersonMentionNode = Node.create({
  name: "personMention",
  group: "inline",
  inline: true,
  selectable: false,
  atom: true,

  addAttributes() {
    return {
      name: { default: null },
      email: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-person-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-person-mention": "",
        class: "smart-mention smart-mention--person",
        title: node.attrs.email,
      }),
      displayName(node),
    ];
  },

  renderText({ node }) {
    return displayName(node);
  },
});
