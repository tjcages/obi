import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib";

interface LinkPreviewData {
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
  siteName: string | null;
}

const previewCache = new Map<string, LinkPreviewData>();
const failedUrls = new Set<string>();

function googleFavicon(hostname: string) {
  return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
}

function getHostname(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

// ────────────────────────────────────────────────────────────
// Popover card rendered via portal with fixed positioning
// ────────────────────────────────────────────────────────────

function PreviewPopover({
  data,
  loading,
  hostname,
  faviconUrl,
  href,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}: {
  data: LinkPreviewData | null;
  loading: boolean;
  hostname: string;
  faviconUrl: string;
  href: string;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    above: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const popoverWidth = 304;
    const gap = 8;
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const above = spaceBelow < 220;

    let left = anchorRect.left;
    left = Math.max(12, Math.min(left, window.innerWidth - popoverWidth - 12));

    const top = above ? anchorRect.top - gap : anchorRect.bottom + gap;

    setPos({ top, left, above });
  }, [anchorRect]);

  if (!pos) return null;

  const hasImage = data?.image;
  const showSkeleton = loading && !data;

  return createPortal(
    <motion.div
      ref={popoverRef}
      initial={{ opacity: 0, y: pos.above ? 6 : -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: pos.above ? 6 : -6, scale: 0.97 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="fixed z-9999"
      style={{
        top: pos.top,
        left: pos.left,
        transform: pos.above ? "translateY(-100%)" : undefined,
        width: 304,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "block cursor-pointer overflow-hidden rounded-xl border border-border-100 no-underline",
          "bg-background-100/95 shadow-xl shadow-black/10 backdrop-blur-xl",
          "transition-colors hover:border-accent-100/30",
          "dark:border-white/10 dark:bg-[#1a1a1a]/95 dark:shadow-black/30 dark:hover:border-accent-100/30",
        )}
      >
        {hasImage && (
          <div className="h-[140px] w-full overflow-hidden bg-background-200 dark:bg-white/5">
            <img
              src={data.image!}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        )}

        <div className="p-3">
          {/* Favicon + hostname */}
          <div className="flex items-center gap-2">
            <img
              src={data?.favicon || faviconUrl}
              alt=""
              className="h-4 w-4 shrink-0 rounded-sm"
              onError={(e) => {
                const img = e.currentTarget;
                if (img.src !== faviconUrl) img.src = faviconUrl;
              }}
            />
            <span className="truncate text-xs text-foreground-300 dark:text-white/40">
              {data?.siteName || hostname}
            </span>
          </div>

          {/* Loading skeleton */}
          {showSkeleton && (
            <div className="mt-2.5 space-y-2">
              <div className="h-4 w-4/5 animate-pulse rounded bg-foreground-100/5 dark:bg-white/5" />
              <div className="h-3 w-full animate-pulse rounded bg-foreground-100/5 dark:bg-white/5" />
              <div className="h-3 w-3/5 animate-pulse rounded bg-foreground-100/5 dark:bg-white/5" />
            </div>
          )}

          {/* Title */}
          {data?.title && (
            <div className="mt-2 text-[13px] font-medium leading-snug text-foreground-100 line-clamp-2 dark:text-white/90">
              {data.title}
            </div>
          )}

          {/* Description */}
          {data?.description && (
            <p className="mt-1 text-xs leading-relaxed text-foreground-300 line-clamp-2 dark:text-white/50">
              {data.description}
            </p>
          )}

          {/* Error / no data fallback — just show hostname */}
          {!loading && !data && (
            <div className="mt-1.5 text-[13px] text-foreground-200 dark:text-white/70">
              {hostname}
            </div>
          )}
        </div>
      </a>
    </motion.div>,
    document.body,
  );
}

// ────────────────────────────────────────────────────────────
// LinkPreview wrapper — wraps an <a> element to add hover preview
// ────────────────────────────────────────────────────────────

export function LinkPreview({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const [show, setShow] = useState(false);
  const [data, setData] = useState<LinkPreviewData | null>(
    previewCache.get(href) ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const hoverRef = useRef(false);
  const enterTimerRef = useRef<number>(0);
  const leaveTimerRef = useRef<number>(0);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const hostname = getHostname(href);
  const faviconUrl = googleFavicon(hostname);

  const fetchPreview = useCallback(() => {
    if (previewCache.has(href)) {
      setData(previewCache.get(href)!);
      return;
    }
    if (failedUrls.has(href) || loading) return;

    setLoading(true);
    fetch(`/api/link-preview?url=${encodeURIComponent(href)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: LinkPreviewData) => {
        previewCache.set(href, d);
        setData(d);
      })
      .catch(() => {
        failedUrls.add(href);
      })
      .finally(() => setLoading(false));
  }, [href, loading]);

  const enter = useCallback(() => {
    hoverRef.current = true;
    clearTimeout(leaveTimerRef.current);
    enterTimerRef.current = window.setTimeout(() => {
      if (!hoverRef.current) return;
      if (wrapperRef.current) {
        setAnchorRect(wrapperRef.current.getBoundingClientRect());
      }
      setShow(true);
      fetchPreview();
    }, 400);
  }, [fetchPreview]);

  const leave = useCallback(() => {
    hoverRef.current = false;
    clearTimeout(enterTimerRef.current);
    leaveTimerRef.current = window.setTimeout(() => {
      if (!hoverRef.current) setShow(false);
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(enterTimerRef.current);
      clearTimeout(leaveTimerRef.current);
    };
  }, []);

  return (
    <span
      ref={wrapperRef}
      className="inline"
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      {children}
      <AnimatePresence>
        {show && anchorRect && (
          <PreviewPopover
            key="preview"
            data={data}
            loading={loading}
            hostname={hostname}
            faviconUrl={faviconUrl}
            href={href}
            anchorRect={anchorRect}
            onMouseEnter={enter}
            onMouseLeave={leave}
          />
        )}
      </AnimatePresence>
    </span>
  );
}
