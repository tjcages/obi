import { cn, getCategoryColor } from "../../lib";
import type { TodoEntity } from "../../lib";

interface SmartTextProps {
  text: string;
  categories?: string[];
  allCategories?: string[];
  entities?: TodoEntity[];
  className?: string;
}

const URL_RE = /https?:\/\/[^\s<]+/g;

function personDisplayName(name: string, email: string): string {
  if (name) {
    const first = name.split(/\s+/)[0];
    if (first) return first;
  }
  return email.split("@")[0];
}

/**
 * Renders plain text with smart formatting:
 * - Person mentions styled as accent-colored text
 * - Category names highlighted with their per-category colors
 * - URLs rendered as clickable links
 */
export function SmartText({
  text,
  categories = [],
  allCategories = [],
  entities = [],
  className,
}: SmartTextProps) {
  if (!text) return null;

  const catsToHighlight = categories.length > 0 ? categories : allCategories;
  const personNames = entities
    .filter((e): e is TodoEntity & { type: "person" } => e.type === "person")
    .map((e) => personDisplayName(e.name, e.email))
    .filter((n) => n.length > 0);
  const segments = tokenize(text, catsToHighlight, personNames);

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === "person") {
          return (
            <span
              key={i}
              className="font-medium text-accent-100"
            >
              {seg.value}
            </span>
          );
        }
        if (seg.type === "category") {
          const color = getCategoryColor(seg.value, allCategories);
          return (
            <span
              key={i}
              className={cn("font-medium", color.text)}
              style={color.style ? { color: color.hex } : undefined}
            >
              {seg.value}
            </span>
          );
        }
        if (seg.type === "url") {
          return (
            <a
              key={i}
              href={seg.value}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-100 underline decoration-accent-100/40 underline-offset-2 hover:decoration-accent-100"
              onClick={(e) => e.stopPropagation()}
            >
              {seg.value.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          );
        }
        return <span key={i}>{seg.value}</span>;
      })}
    </span>
  );
}

type SegmentType = "text" | "category" | "url" | "person";
type Segment = { type: SegmentType; value: string };

function tokenize(text: string, categories: string[], personNames: string[]): Segment[] {
  const hasCategories = categories.length > 0;
  const hasPersons = personNames.length > 0;
  const hasUrls = URL_RE.test(text);
  URL_RE.lastIndex = 0;

  if (!hasCategories && !hasPersons && !hasUrls) {
    return [{ type: "text", value: text }];
  }

  const matches: { start: number; end: number; type: SegmentType; value: string }[] = [];

  if (hasPersons) {
    const escaped = personNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, type: "person", value: m[0] });
    }
  }

  if (hasCategories) {
    const escaped = categories.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const catPattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = catPattern.exec(text)) !== null) {
      const matched = categories.find((c) => c.toLowerCase() === m![1].toLowerCase());
      if (!matches.some((e) => e.start < m!.index + m![0].length && e.end > m!.index)) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          type: "category",
          value: matched || m[0],
        });
      }
    }
  }

  URL_RE.lastIndex = 0;
  let um: RegExpExecArray | null;
  while ((um = URL_RE.exec(text)) !== null) {
    const urlStart = um.index;
    const urlEnd = urlStart + um[0].length;
    if (!matches.some((m) => m.start < urlEnd && m.end > urlStart)) {
      matches.push({ start: urlStart, end: urlEnd, type: "url", value: um[0] });
    }
  }

  matches.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, match.start) });
    }
    segments.push({ type: match.type, value: match.value });
    cursor = match.end;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments;
}
