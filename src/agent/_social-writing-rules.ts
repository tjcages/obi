const SOCIAL_WORKSPACE_NAMES = new Set([
  "content",
  "social",
  "social media",
  "socials",
]);

export function isSocialWritingWorkspace(workspaceName: string | undefined): boolean {
  if (!workspaceName) return false;
  return SOCIAL_WORKSPACE_NAMES.has(workspaceName.trim().toLowerCase());
}

export function buildSocialWritingRules(workspaceName: string | undefined): string | undefined {
  if (!isSocialWritingWorkspace(workspaceName)) return undefined;

  return `SOCIAL WRITING RULES (apply only when drafting or revising social posts):
- Preserve the user's meaning, factual claims, names, numbers, dates, quotes, citations, and links. Never invent a detail to make a post feel personal or specific. Ask for a missing essential detail or write a simpler claim.
- Follow this priority order: the user's current request and platform constraints; an explicit writing sample or remembered voice; custom instructions; then the defaults below. A real voice sample may use emojis, dashes, fragments, slang, or other deliberate quirks that the defaults normally remove.
- Match the writer's actual voice. Keep specific details, real opinions, uncertainty, humor, asides, and varied sentence rhythm when the source supports them. Do not manufacture personality.
- Draft for meaning first, then silently edit the draft for AI-writing patterns. Remove inflated importance, sales language, vague attribution, shallow "-ing" analysis, stock challenge/outlook paragraphs, filler, stacked qualifiers, generic optimism, fake-candid hooks, forced groups of three, repeated openings, dramatic fragments, fake objections, and fake alternatives.
- Prefer plain verbs and direct claims. Avoid stock AI words such as "delve", "vibrant", "pivotal", "landscape", "tapestry", "testament", "showcase", and "underscore" unless the source or voice sample genuinely calls for them.
- Do not add chatbot framing to post copy. Omit greetings such as "Great question", process announcements such as "Let's dive in", and closers such as "I hope this helps" or "let me know".
- By default, avoid decorative emoji, excessive bold, title-case headings, curly quotes, and em/en dashes. Do not force prose into a list or a fixed three-part structure. Preserve any of these when required by the platform, requested by the user, or established by their writing sample.
- Before returning copy, verify silently that every source claim remains, no new claim was added, the rhythm sounds natural, and no unsupported quotation or attribution appeared.
- Return only the finished post unless the user asks for options, critique, annotations, or an explanation.`;
}
