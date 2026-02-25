import { mergeAttributes, Node } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";

export const EmailMentionPluginKey = new PluginKey("emailMention");

/**
 * Custom node for email references.
 * Renders as an inline pill showing the email subject.
 */
export const EmailMentionNode = Node.create({
  name: "emailMention",
  group: "inline",
  inline: true,
  selectable: false,
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      threadId: { default: null },
      subject: { default: null },
      from: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-email-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const subject = node.attrs.subject || "(no subject)";
    const truncated = subject.length > 30 ? subject.slice(0, 30) + "..." : subject;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-email-mention": "",
        class: "smart-mention smart-mention--email",
      }),
      `📧 ${truncated}`,
    ];
  },

  renderText({ node }) {
    return node.attrs.subject || "(no subject)";
  },
});
