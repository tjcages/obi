import { useEffect, useRef, useState, useSyncExternalStore, Fragment, type ReactNode } from "react";
import { cn } from "../../lib";
import { LinkPreview } from "../ui";
import { ImageGallery, extractImages, type EmailImage } from "./_image-gallery";

// ────────────────────────────────────────────────────────────
// Theme detection (syncs with ThemeToggle)
// ────────────────────────────────────────────────────────────

function subscribeTheme(cb: () => void) {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", cb);
  window.addEventListener("gmail-chat-theme-change", cb);
  return () => {
    mql.removeEventListener("change", cb);
    window.removeEventListener("gmail-chat-theme-change", cb);
  };
}

function getIsDark() {
  const t = document.documentElement.dataset.theme ?? document.documentElement.dataset.mode;
  return t === "dark";
}

function useIsDark(): boolean {
  return useSyncExternalStore(subscribeTheme, getIsDark, () => true);
}

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

type EmailBlock =
  | { type: "paragraph"; text: string }
  | { type: "section-header"; text: string }
  | { type: "quote"; blocks: EmailBlock[] }
  | { type: "quoted-message"; name: string; initials: string; blocks: EmailBlock[] }
  | { type: "quote-attribution"; text: string }
  | { type: "signature"; lines: string[] }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "divider" }
  | { type: "preformatted"; text: string };

// ────────────────────────────────────────────────────────────
// Avatar helpers
// ────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "#6d86d3", "#7c3aed", "#059669", "#d97706",
  "#e11d48", "#0891b2", "#db2777", "#4f46e5",
  "#0d9488", "#ea580c",
];

function hashStr(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// ────────────────────────────────────────────────────────────
// Inline rendering — URLs, emails
// ────────────────────────────────────────────────────────────

const INLINE_RE =
  /(https?:\/\/[^\s<>"{}|\\^`\[\]]+(?:\([^\s)]*\))*[^\s<>"{}|\\^`\[\].,;:!?'")\]]*)|(\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b)/g;

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      let url = match[1];
      const trailing = url.match(/[.,;:!?)]+$/);
      let suffix = "";
      if (trailing) {
        url = url.slice(0, -trailing[0].length);
        suffix = trailing[0];
      }

      let label = url;
      try {
        const u = new URL(url);
        label = u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "");
        if (u.search) label += u.search;
        if (label.length > 55) label = label.slice(0, 52) + "…";
      } catch {
        /* keep raw */
      }

      parts.push(
        <LinkPreview key={key++} href={url}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline decoration-blue-300/40 underline-offset-2 transition-colors hover:text-blue-700 hover:decoration-blue-500 dark:text-blue-400 dark:decoration-blue-500/30 dark:hover:text-blue-300"
          >
            {label}
          </a>
        </LinkPreview>,
      );
      if (suffix) parts.push(suffix);
    } else if (match[2]) {
      parts.push(
        <a
          key={key++}
          href={`mailto:${match[2]}`}
          className="text-blue-600 underline decoration-blue-300/40 underline-offset-2 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {match[2]}
        </a>,
      );
    }

    lastIndex = INLINE_RE.lastIndex;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  if (parts.length === 0) return text;
  if (parts.length === 1 && typeof parts[0] === "string") return parts[0];
  return <>{parts}</>;
}

// ────────────────────────────────────────────────────────────
// Text analysis helpers
// ────────────────────────────────────────────────────────────

const SIG_DELIM_RE = /^--\s*$/;
const MOBILE_SIG_RE =
  /^(Sent from my .+|Get Outlook for .+|Sent from .+ Mail|Sent via .+|Envoyé de mon .+|Enviado desde mi .+)$/i;
const QUOTE_RE = /^>/;
const QUOTE_ATTR_RE = /^On .+wrote:\s*$/;
const FORWARDED_RE = /^-{3,}\s*Forwarded message\s*-{3,}$/i;
const DIVIDER_RE = /^[-=_*]{3,}\s*$/;
const UL_RE = /^\s*[-*•]\s+/;
const OL_RE = /^\s*\d+[.)]\s+/;

const DATE_TOKENS = new Set([
  "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  "January", "February", "March", "April", "June", "July", "August",
  "September", "October", "November", "December",
  "AM", "PM", "am", "pm", "at", "On",
]);

function stripQuotePrefix(line: string): string {
  return line.replace(/^>\s?/, "");
}

function stripListPrefix(line: string): string {
  return line.replace(/^\s*[-*•]\s+/, "").replace(/^\s*\d+[.)]\s+/, "");
}

function reflowLines(lines: string[]): string {
  if (lines.length < 2) return lines.join("\n");

  let wrappedCount = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const len = lines[i].length;
    if (len >= 65 && len <= 82) wrappedCount++;
  }

  const isHardWrapped = wrappedCount / (lines.length - 1) > 0.6;
  if (!isHardWrapped) return lines.join("\n");

  const result: string[] = [];
  let current = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    current = current ? current + " " + line : line;

    const nextLine = lines[i + 1];
    const looksWrapped =
      line.length >= 65 &&
      line.length <= 82 &&
      nextLine !== undefined &&
      nextLine.length > 0 &&
      !/[.!?:;]$/.test(line.trimEnd());

    if (!looksWrapped) {
      result.push(current);
      current = "";
    }
  }
  if (current) result.push(current);
  return result.join("\n");
}

/**
 * Extracts sender name from a quote attribution like
 * "On Tue, Feb 17, 2026 at 11:37 AM Niko Cunningham <niko@rumilabs.io> wrote:"
 */
function parseAttribution(text: string): { name: string; initials: string } | null {
  const emailAngle = text.match(/<([^>]+)>\s*wrote:?\s*$/);
  if (!emailAngle) return null;

  const beforeEmail = text.slice(0, text.indexOf("<" + emailAngle[1] + ">")).trim();
  const words = beforeEmail.split(/\s+/);

  // Walk backwards from the end skipping date/time tokens to find the name
  let nameStart = words.length;
  for (let i = words.length - 1; i >= 0; i--) {
    const clean = words[i].replace(/[,.:]/g, "");
    if (!clean) break;
    if (/^\d+$/.test(clean)) break;
    if (/^\d{1,2}:\d{2}/.test(clean)) break;
    if (DATE_TOKENS.has(clean)) break;
    nameStart = i;
  }

  const nameWords = words.slice(nameStart);
  if (nameWords.length === 0) {
    const fallback = emailAngle[1].split("@")[0].replace(/[._-]/g, " ");
    const parts = fallback.split(/\s+/);
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : fallback.slice(0, 2).toUpperCase();
    return { name: fallback, initials };
  }

  const name = nameWords.join(" ");
  const parts = name.split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
  return { name, initials };
}

/**
 * Detects short lines ending with ":" that look like section headers.
 */
function isSectionHeader(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.endsWith(":")) return false;
  if (trimmed.length > 80) return false;
  if (trimmed.includes("\n")) return false;
  // Don't trigger on "On ... wrote:" attributions
  if (QUOTE_ATTR_RE.test(trimmed)) return false;
  // Must have at least 2 characters before the colon
  if (trimmed.length < 3) return false;
  return true;
}

/**
 * Extracts a plain-text preview from a set of blocks (first meaningful paragraph).
 */
function getPreviewText(blocks: EmailBlock[]): string {
  for (const block of blocks) {
    if (block.type === "paragraph" && block.text.trim()) {
      return block.text.slice(0, 120);
    }
  }
  return "";
}

// ────────────────────────────────────────────────────────────
// Text parser — converts raw email text into EmailBlock[]
// ────────────────────────────────────────────────────────────

function parseEmailText(raw: string): EmailBlock[] {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const blocks: EmailBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Signature delimiter ──
    if (SIG_DELIM_RE.test(line) || MOBILE_SIG_RE.test(line.trim())) {
      const startIdx = SIG_DELIM_RE.test(line) ? i + 1 : i;
      const sigLines: string[] = [];
      for (let j = startIdx; j < lines.length; j++) {
        sigLines.push(lines[j]);
      }
      while (sigLines.length > 0 && sigLines[sigLines.length - 1].trim() === "") {
        sigLines.pop();
      }
      if (sigLines.length > 0) {
        blocks.push({ type: "signature", lines: sigLines });
      }
      break;
    }

    // ── Forwarded message header ──
    if (FORWARDED_RE.test(line.trim())) {
      blocks.push({ type: "divider" });
      i++;
      const headerLines: string[] = [];
      while (i < lines.length && /^(From|To|Cc|Date|Subject|Sent):\s/i.test(lines[i])) {
        headerLines.push(lines[i]);
        i++;
      }
      if (headerLines.length > 0) {
        blocks.push({ type: "preformatted", text: headerLines.join("\n") });
      }
      continue;
    }

    // ── Divider ──
    if (DIVIDER_RE.test(line)) {
      blocks.push({ type: "divider" });
      i++;
      continue;
    }

    // ── Quote attribution ("On ... wrote:") ──
    if (QUOTE_ATTR_RE.test(line.trim())) {
      let attribution = line;
      while (!attribution.trimEnd().endsWith("wrote:") && i + 1 < lines.length) {
        i++;
        attribution += " " + lines[i].trim();
      }
      blocks.push({ type: "quote-attribution", text: attribution.trim() });
      i++;
      continue;
    }

    // ── Quoted text (lines starting with >) ──
    if (QUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        if (QUOTE_RE.test(lines[i])) {
          quoteLines.push(lines[i]);
          i++;
        } else if (lines[i].trim() === "") {
          if (i + 1 < lines.length && QUOTE_RE.test(lines[i + 1])) {
            quoteLines.push("");
            i++;
          } else {
            break;
          }
        } else {
          break;
        }
      }

      const stripped = quoteLines.map((l) =>
        l.trim() === "" ? "" : stripQuotePrefix(l),
      );
      const innerBlocks = parseEmailText(stripped.join("\n"));
      blocks.push({ type: "quote", blocks: innerBlocks });
      continue;
    }

    // ── Unordered list ──
    if (UL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL_RE.test(lines[i])) {
        let item = stripListPrefix(lines[i]);
        i++;
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          !UL_RE.test(lines[i]) &&
          !OL_RE.test(lines[i]) &&
          /^\s{2,}/.test(lines[i])
        ) {
          item += " " + lines[i].trim();
          i++;
        }
        items.push(item);
      }
      blocks.push({ type: "unordered-list", items });
      continue;
    }

    // ── Ordered list ──
    if (OL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL_RE.test(lines[i])) {
        let item = stripListPrefix(lines[i]);
        i++;
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          !OL_RE.test(lines[i]) &&
          !UL_RE.test(lines[i]) &&
          /^\s{2,}/.test(lines[i])
        ) {
          item += " " + lines[i].trim();
          i++;
        }
        items.push(item);
      }
      blocks.push({ type: "ordered-list", items });
      continue;
    }

    // ── Preformatted / code-like ──
    if (/^\s{4,}\S/.test(line) && !UL_RE.test(line)) {
      const codeLines: string[] = [];
      while (
        i < lines.length &&
        (/^\s{4,}/.test(lines[i]) || lines[i].trim() === "")
      ) {
        codeLines.push(lines[i]);
        i++;
      }
      while (codeLines.length > 0 && codeLines[codeLines.length - 1].trim() === "") {
        codeLines.pop();
      }
      if (codeLines.length > 0) {
        blocks.push({ type: "preformatted", text: codeLines.join("\n") });
      }
      continue;
    }

    // ── Regular paragraph ──
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !QUOTE_RE.test(lines[i]) &&
      !SIG_DELIM_RE.test(lines[i]) &&
      !MOBILE_SIG_RE.test(lines[i].trim()) &&
      !DIVIDER_RE.test(lines[i]) &&
      !FORWARDED_RE.test(lines[i].trim()) &&
      !QUOTE_ATTR_RE.test(lines[i].trim()) &&
      !(UL_RE.test(lines[i]) && paraLines.length > 0) &&
      !(OL_RE.test(lines[i]) && paraLines.length > 0)
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      const text = reflowLines(paraLines);
      if (isSectionHeader(text)) {
        blocks.push({ type: "section-header", text: text.replace(/:$/, "") });
      } else {
        blocks.push({ type: "paragraph", text });
      }
    }
  }

  return mergeAttributionsWithQuotes(blocks);
}

/**
 * Post-processing: merges adjacent quote-attribution + quote blocks
 * into a single `quoted-message` block for conversational rendering.
 */
function mergeAttributionsWithQuotes(blocks: EmailBlock[]): EmailBlock[] {
  const result: EmailBlock[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.type === "quote-attribution" && i + 1 < blocks.length && blocks[i + 1].type === "quote") {
      const parsed = parseAttribution(block.text);
      const quoteBlock = blocks[i + 1] as Extract<EmailBlock, { type: "quote" }>;

      if (parsed) {
        result.push({
          type: "quoted-message",
          name: parsed.name,
          initials: parsed.initials,
          blocks: quoteBlock.blocks,
        });
      } else {
        result.push(block);
        result.push(blocks[i + 1]);
      }
      i++;
    } else {
      result.push(block);
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// Block renderers
// ────────────────────────────────────────────────────────────

function ParagraphBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <p className="my-[0.6em] text-[15px] leading-[1.75] text-foreground-100 first:mt-0 last:mb-0">
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {renderInline(line)}
        </Fragment>
      ))}
    </p>
  );
}

function SectionHeaderBlock({ text }: { text: string }) {
  return (
    <p className="mb-1 mt-5 text-[13px] font-semibold uppercase tracking-wide text-foreground-300 first:mt-0">
      {text}
    </p>
  );
}

function QuoteAttributionBlock({ text }: { text: string }) {
  const parsed = parseAttribution(text);
  if (parsed) {
    const color = AVATAR_COLORS[hashStr(parsed.name) % AVATAR_COLORS.length];
    return (
      <div className="mb-1 mt-4 flex items-center gap-2 first:mt-0">
        <div
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          {parsed.initials}
        </div>
        <span className="text-[13px] font-medium text-foreground-300">
          {parsed.name}
        </span>
      </div>
    );
  }
  return (
    <p className="my-[0.6em] text-[13px] leading-relaxed text-foreground-300 first:mt-0">
      {text}
    </p>
  );
}

function QuotedMessageBlock({
  name,
  initials,
  blocks,
}: {
  name: string;
  initials: string;
  blocks: EmailBlock[];
}) {
  const [expanded, setExpanded] = useState(false);
  const color = AVATAR_COLORS[hashStr(name) % AVATAR_COLORS.length];
  const preview = getPreviewText(blocks);

  return (
    <div className="mt-4 first:mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-background-200"
      >
        <div
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          {initials}
        </div>
        <span className="text-[13px] font-medium text-foreground-200">
          {name}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("shrink-0 text-foreground-300/50 transition-transform", expanded && "rotate-180")}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {!expanded && preview && (
        <p className="mt-0.5 truncate pl-7 text-[13px] text-foreground-300">
          {preview}
        </p>
      )}

      {expanded && (
        <div className="mt-1.5 rounded-xl border border-border-100 bg-background-200/60 px-4 py-3">
          {blocks.map((block, i) => (
            <BlockRenderer key={i} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}

function QuoteBlock({ blocks }: { blocks: EmailBlock[] }) {
  const [collapsed, setCollapsed] = useState(blocks.length > 3);
  const previewCount = 2;

  if (collapsed) {
    return (
      <div className="my-2 border-l-2 border-border-100 pl-4">
        {blocks.slice(0, previewCount).map((block, i) => (
          <BlockRenderer key={i} block={block} />
        ))}
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
          </svg>
          {blocks.length - previewCount} more
        </button>
      </div>
    );
  }

  return (
    <div className="my-2 border-l-2 border-border-100 pl-4">
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} />
      ))}
    </div>
  );
}

function ListBlock({ items, ordered }: { items: string[]; ordered: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={cn("my-[0.6em] space-y-0.5 pl-6 text-[15px] leading-[1.75] text-foreground-100", ordered ? "list-decimal marker:text-foreground-300" : "list-disc marker:text-foreground-300/50")}
    >
      {items.map((item, i) => (
        <li key={i}>{renderInline(item)}</li>
      ))}
    </Tag>
  );
}

function SignatureBlock({ lines }: { lines: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = lines.length > 4;
  const visibleLines = isLong && !expanded ? lines.slice(0, 2) : lines;

  return (
    <div className="mt-5 border-t border-border-100 pt-3">
      <div className="space-y-0.5">
        {visibleLines.map((line, i) => (
          <p key={i} className="text-[13px] leading-relaxed text-foreground-300">
            {line.trim() || "\u00A0"}
          </p>
        ))}
      </div>
      {isLong && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-[12px] text-foreground-300 transition-colors hover:text-foreground-200"
        >
          Show full signature
        </button>
      )}
    </div>
  );
}

function DividerBlock() {
  return <hr className="my-4 border-t border-border-100" />;
}

function PreformattedBlock({ text }: { text: string }) {
  return (
    <pre className="my-[0.6em] overflow-x-auto rounded-lg bg-background-200 px-4 py-3 text-[13px] leading-relaxed text-foreground-200">
      {text}
    </pre>
  );
}

function BlockRenderer({ block }: { block: EmailBlock }) {
  switch (block.type) {
    case "paragraph":
      return <ParagraphBlock text={block.text} />;
    case "section-header":
      return <SectionHeaderBlock text={block.text} />;
    case "quote":
      return <QuoteBlock blocks={block.blocks} />;
    case "quoted-message":
      return <QuotedMessageBlock name={block.name} initials={block.initials} blocks={block.blocks} />;
    case "quote-attribution":
      return <QuoteAttributionBlock text={block.text} />;
    case "unordered-list":
      return <ListBlock items={block.items} ordered={false} />;
    case "ordered-list":
      return <ListBlock items={block.items} ordered={true} />;
    case "signature":
      return <SignatureBlock lines={block.lines} />;
    case "divider":
      return <DividerBlock />;
    case "preformatted":
      return <PreformattedBlock text={block.text} />;
    default:
      return null;
  }
}

// ────────────────────────────────────────────────────────────
// Rich text renderer (for plain-text emails)
// ────────────────────────────────────────────────────────────

function RichTextRenderer({ text, trimQuotes }: { text: string; trimQuotes?: boolean }) {
  let blocks = parseEmailText(text);

  if (trimQuotes) {
    const TRIM_TYPES = new Set<EmailBlock["type"]>([
      "quote", "quoted-message", "quote-attribution", "signature", "divider",
    ]);

    let cutIdx = blocks.length;

    // Forward scan: find the first quote-attribution or quoted-message
    // and cut everything from there onward. This handles replies where
    // the quoted text doesn't have > prefixes (common in Gmail).
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].type === "quote-attribution" || blocks[i].type === "quoted-message") {
        cutIdx = i;
        break;
      }
    }

    // Backward scan fallback: if no attribution was found, walk backwards
    // and remove trailing quote/signature/divider blocks.
    if (cutIdx === blocks.length) {
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (TRIM_TYPES.has(b.type)) {
          cutIdx = i;
        } else if (b.type === "paragraph" && !b.text.trim()) {
          cutIdx = i;
        } else {
          break;
        }
      }
    }

    blocks = blocks.slice(0, cutIdx);

    // Clean up trailing empty paragraphs, signatures, and dividers
    while (blocks.length > 0) {
      const last = blocks[blocks.length - 1];
      if (
        (last.type === "paragraph" && !last.text.trim()) ||
        last.type === "signature" ||
        last.type === "divider"
      ) {
        blocks.pop();
      } else {
        break;
      }
    }
  }

  return (
    <div className="email-rich-text">
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} />
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// HTML iframe renderer (for designed / rich-HTML emails)
// ────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailSupportsDarkMode(html: string): boolean {
  return /prefers-color-scheme\s*:\s*dark/i.test(html);
}

function HtmlFrame({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDark();
  const supportsDark = emailSupportsDarkMode(html);
  const needsLightCard = isDark && !supportsDark;

  useEffect(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    const scheme = isDark && supportsDark ? "dark" : "light";
    const bg = needsLightCard ? "#ffffff" : "transparent";
    const textColor = needsLightCard ? "#404040" : isDark ? "#d4d4d8" : "#404040";

    doc.open();
    doc.write(`<!DOCTYPE html>
<html style="color-scheme:${scheme}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank" rel="noopener noreferrer">
<meta name="color-scheme" content="${scheme} light">
<meta name="supported-color-schemes" content="${scheme} light">
<style>
  :root{color-scheme:${scheme}}
  *{box-sizing:border-box}
  html,body{margin:0;padding:${needsLightCard ? "16px" : "0"};overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:14px;line-height:1.65;word-break:break-word;overflow-wrap:break-word;color:${textColor};background:${bg}}
  a{color:#4f7be8;text-decoration:underline;text-decoration-color:rgba(79,123,232,0.3);text-underline-offset:2px}
  a:hover{text-decoration-color:rgba(79,123,232,0.7)}
  img{max-width:100%;height:auto;border-radius:4px}
  blockquote{margin:0.75em 0;padding-left:1em;border-left:2px solid #e0e0e0;color:#9ca3af}
  pre{white-space:pre-wrap;overflow-x:auto;background:${needsLightCard ? "#f9fafb" : isDark ? "#18181b" : "#f9fafb"};border-radius:6px;padding:12px;font-size:13px}
  code{background:${needsLightCard ? "#f3f4f6" : isDark ? "#18181b" : "#f3f4f6"};border-radius:3px;padding:1px 4px;font-size:0.9em}
  table{border-collapse:collapse;max-width:100%}
  hr{border:none;border-top:1px solid ${needsLightCard ? "#e5e7eb" : isDark ? "#27272a" : "#e5e7eb"};margin:1em 0}
  h1,h2,h3,h4,h5,h6{color:${needsLightCard ? "#1a1a1a" : isDark ? "#e4e4e7" : "#1a1a1a"};line-height:1.35;margin:0.8em 0 0.4em}
  p{margin:0.5em 0}
</style></head>
<body>${html}</body></html>`);
    doc.close();

    let rafId = 0;
    const fitAndResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const iframe = iframeRef.current;
        const wrapper = wrapperRef.current;
        if (!iframe || !doc.documentElement || !wrapper) return;

        iframe.style.transform = "";
        iframe.style.width = "100%";
        iframe.style.height = "auto";

        const containerWidth = wrapper.clientWidth;
        const contentWidth = doc.documentElement.scrollWidth;

        if (contentWidth > containerWidth + 2) {
          const scale = containerWidth / contentWidth;
          iframe.style.width = `${contentWidth}px`;
          iframe.style.height = "auto";
          const fullHeight = doc.documentElement.scrollHeight;
          iframe.style.height = `${fullHeight}px`;
          iframe.style.transform = `scale(${scale})`;
          iframe.style.transformOrigin = "top left";
          wrapper.style.height = `${fullHeight * scale}px`;
        } else {
          const fullHeight = doc.documentElement.scrollHeight;
          wrapper.style.height = "";
          iframe.style.height = `${fullHeight}px`;
        }
      });
    };

    fitAndResize();

    const resizeObs = new ResizeObserver(fitAndResize);
    resizeObs.observe(doc.body);
    if (doc.documentElement !== doc.body) resizeObs.observe(doc.documentElement);

    const mutObs = new MutationObserver(fitAndResize);
    mutObs.observe(doc.body, { childList: true, subtree: true, attributes: true });

    const imgs = doc.querySelectorAll("img");
    imgs.forEach((img) => img.addEventListener("load", fitAndResize));

    const delays = [100, 300, 800, 1500];
    const timers = delays.map((ms) => setTimeout(fitAndResize, ms));

    return () => {
      cancelAnimationFrame(rafId);
      resizeObs.disconnect();
      mutObs.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [html, isDark, supportsDark, needsLightCard]);

  return (
    <div
      ref={wrapperRef}
      className={cn("overflow-hidden", needsLightCard && "rounded-lg border border-border-100")}
    >
      <iframe
        ref={iframeRef}
        title="Email content"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        scrolling="no"
        className="w-full border-0"
        style={{ minHeight: "60px", overflow: "hidden" }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Detection — decide whether to use rich renderer or iframe
// ────────────────────────────────────────────────────────────

function isDesignedHtml(html: string): boolean {
  const tableCount = (html.match(/<table\b/gi) || []).length;
  if (tableCount >= 2) return true;
  if (/<table\b[^>]*(?:width|bgcolor|cellpadding|cellspacing|align)\s*=/i.test(html))
    return true;

  if (/<center\b/i.test(html)) return true;
  if (/<img\b[^>]+(?:width|height)\s*=\s*["']?\d{3,}/i.test(html)) return true;
  if (/<font\b[^>]*color/i.test(html)) return true;
  if (/style\s*=\s*["'][^"']*background(?:-color|-image)\s*:/i.test(html))
    return true;

  return false;
}

function shouldUseRichRenderer(bodyHtml: string, bodyText: string): boolean {
  if (!bodyHtml && bodyText) return true;
  if (!bodyHtml && !bodyText) return false;

  if (bodyHtml && isDesignedHtml(bodyHtml)) return false;

  if (bodyText && bodyText.trim().length > 20) return true;

  if (!bodyHtml) return false;

  const stripped = bodyHtml.replace(/<[^>]*>/g, "").trim();
  return stripped.length > 0;
}

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const text = inner.replace(/<[^>]*>/g, "").trim();
      if (!text || text === href || text === href.replace(/^https?:\/\//, "")) return href;
      return `${text} ( ${href} )`;
    })
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&hellip;/g, "\u2026")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ────────────────────────────────────────────────────────────
// HTML quote stripping — removes quoted content from HTML
// before rendering or text extraction so thread messages
// only show their own new content.
// ────────────────────────────────────────────────────────────

function removeNodeAndFollowingSiblings(node: Element): void {
  const parent = node.parentNode;
  if (!parent) return;
  let current: ChildNode | null = node;
  while (current) {
    const next: ChildNode | null = current.nextSibling;
    parent.removeChild(current);
    current = next;
  }
}

function stripHtmlQuotes(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Gmail: <div class="gmail_quote"> wraps attribution + quoted content
  doc.querySelectorAll("div.gmail_quote").forEach((el) => el.remove());
  doc.querySelectorAll("div.gmail_attr").forEach((el) => el.remove());
  doc.querySelectorAll("blockquote.gmail_quote").forEach((el) => el.remove());

  // Apple Mail: <blockquote type="cite">
  doc.querySelectorAll('blockquote[type="cite"]').forEach((el) => {
    const prev = el.previousElementSibling;
    if (prev && /wrote:\s*$/i.test(prev.textContent || "")) {
      prev.remove();
    }
    el.remove();
  });

  // Outlook: #appendonsend marker and everything after
  const appendOnSend = doc.getElementById("appendonsend");
  if (appendOnSend) removeNodeAndFollowingSiblings(appendOnSend);

  // Outlook: #divRplyFwdMsg
  const rplyFwdMsg = doc.getElementById("divRplyFwdMsg");
  if (rplyFwdMsg) {
    const prev = rplyFwdMsg.previousElementSibling;
    if (prev && prev.tagName === "HR") prev.remove();
    removeNodeAndFollowingSiblings(rplyFwdMsg);
  }

  // Yahoo / ProtonMail
  doc.querySelectorAll(".yahoo_quoted, .protonmail_quote").forEach((el) => el.remove());

  let result = doc.body.innerHTML;
  result = result.replace(/(<br\s*\/?>[\s\n]*)*$/i, "").trim();
  return result;
}

// ────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────

export interface AttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface EmailContentRendererProps {
  bodyHtml: string;
  bodyText: string;
  trimQuotes?: boolean;
  attachments?: AttachmentMeta[];
  messageId?: string;
  accountEmail?: string;
}

function attachmentUrl(messageId: string, att: AttachmentMeta, accountEmail?: string): string {
  const params = new URLSearchParams({ type: att.mimeType, name: att.filename });
  if (accountEmail) params.set("account", accountEmail);
  return `/api/attachments/${messageId}/${att.attachmentId}?${params}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(mime: string): boolean {
  return /^image\/(jpeg|jpg|png|gif|webp|bmp|svg|tiff)$/i.test(mime);
}

export function EmailContentRenderer({
  bodyHtml,
  bodyText,
  trimQuotes,
  attachments,
  messageId,
  accountEmail,
}: EmailContentRendererProps) {
  let effectiveHtml = bodyHtml;
  let effectiveText = bodyText;

  if (trimQuotes && effectiveHtml) {
    effectiveHtml = stripHtmlQuotes(effectiveHtml);
    const cleanedText = extractTextFromHtml(effectiveHtml);
    if (cleanedText.trim()) {
      effectiveText = cleanedText;
    }
  }

  const imageAttachments: EmailImage[] = [];
  const fileAttachments: (AttachmentMeta & { url: string })[] = [];

  if (attachments && messageId) {
    for (const att of attachments) {
      const url = attachmentUrl(messageId, att, accountEmail);
      if (isImageMime(att.mimeType)) {
        imageAttachments.push({ src: url, alt: att.filename });
      } else {
        fileAttachments.push({ ...att, url });
      }
    }
  }

  const hasAttachmentImages = imageAttachments.length > 0;
  const hasFileAttachments = fileAttachments.length > 0;

  if (shouldUseRichRenderer(effectiveHtml, effectiveText)) {
    const text = effectiveText || extractTextFromHtml(effectiveHtml);
    const inlineImages = extractImages(effectiveHtml);
    const allImages = [...inlineImages, ...imageAttachments];

    if (!text.trim() && allImages.length === 0 && !hasFileAttachments) {
      return (
        <p className="text-sm italic text-foreground-300">
          No content
        </p>
      );
    }
    return (
      <>
        {text.trim() && <RichTextRenderer text={text} trimQuotes={trimQuotes} />}
        {allImages.length > 0 && <ImageGallery images={allImages} />}
        {hasFileAttachments && <FileAttachmentList files={fileAttachments} />}
      </>
    );
  }

  if (effectiveHtml) {
    return (
      <>
        <HtmlFrame html={effectiveHtml} />
        {hasAttachmentImages && <ImageGallery images={imageAttachments} />}
        {hasFileAttachments && <FileAttachmentList files={fileAttachments} />}
      </>
    );
  }

  if (effectiveText) {
    return (
      <>
        <RichTextRenderer text={effectiveText} trimQuotes={trimQuotes} />
        {hasAttachmentImages && <ImageGallery images={imageAttachments} />}
        {hasFileAttachments && <FileAttachmentList files={fileAttachments} />}
      </>
    );
  }

  if (hasAttachmentImages || hasFileAttachments) {
    return (
      <>
        {hasAttachmentImages && <ImageGallery images={imageAttachments} />}
        {hasFileAttachments && <FileAttachmentList files={fileAttachments} />}
      </>
    );
  }

  return (
    <p className="text-sm italic text-foreground-300">
      No content
    </p>
  );
}

// ────────────────────────────────────────────────────────────
// File attachment list (non-image files)
// ────────────────────────────────────────────────────────────

const FILE_ICONS: Record<string, string> = {
  pdf: "📄",
  doc: "📝", docx: "📝",
  xls: "📊", xlsx: "📊", csv: "📊",
  ppt: "📎", pptx: "📎",
  zip: "📦", rar: "📦", "7z": "📦",
  mp4: "🎬", mov: "🎬", avi: "🎬",
  mp3: "🎵", wav: "🎵",
  eps: "🎨", ai: "🎨", psd: "🎨", svg: "🎨",
};

function getFileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return FILE_ICONS[ext] || "📎";
}

function FileAttachmentList({ files }: { files: (AttachmentMeta & { url: string })[] }) {
  if (files.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      {files.map((file) => (
        <a
          key={file.attachmentId}
          href={file.url}
          target="_blank"
          rel="noopener noreferrer"
          download={file.filename}
          className={cn(
            "flex items-center gap-3 rounded-lg border border-border-100 px-3 py-2.5",
            "bg-background-200/50 transition-colors hover:bg-background-200",
            "dark:border-white/5 dark:bg-white/3 dark:hover:bg-white/6",
          )}
        >
          <span className="text-base leading-none">{getFileIcon(file.filename)}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground-100 dark:text-white/85">
              {file.filename}
            </p>
            <p className="text-[11px] text-foreground-300 dark:text-white/40">
              {formatFileSize(file.size)}
            </p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/50">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </a>
      ))}
    </div>
  );
}

export { escapeHtml };
