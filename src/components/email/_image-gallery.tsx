import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface EmailImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

// ────────────────────────────────────────────────────────────
// Image extraction from HTML — filters tracking pixels & CIDs
// ────────────────────────────────────────────────────────────

const TRACKING_RE = [
  /\/track(ing)?\//i,
  /\/open\b/i,
  /\/pixel/i,
  /\/beacon/i,
  /\/wf\/open/i,
  /[?&]utm_/i,
  /\.gif\?.*=[a-f0-9]{16,}/i,
];

export function extractImages(html: string): EmailImage[] {
  if (!html) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const imgs = doc.querySelectorAll("img");
  const result: EmailImage[] = [];
  const seen = new Set<string>();

  for (const img of imgs) {
    const src = img.getAttribute("src") || "";
    if (!src || src.startsWith("cid:") || src.startsWith("data:")) continue;

    const w = parseInt(img.getAttribute("width") || "0", 10);
    const h = parseInt(img.getAttribute("height") || "0", 10);
    if ((w > 0 && w < 5) || (h > 0 && h < 5)) continue;

    const style = img.getAttribute("style") || "";
    if (/display\s*:\s*none/i.test(style)) continue;

    if (TRACKING_RE.some((re) => re.test(src))) continue;

    if (seen.has(src)) continue;
    seen.add(src);

    result.push({
      src,
      alt: img.getAttribute("alt") || "",
      width: w || undefined,
      height: h || undefined,
    });
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// Lightbox — full-screen image viewer with keyboard navigation
// ────────────────────────────────────────────────────────────

export function ImageLightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: EmailImage[];
  index: number;
  onClose: () => void;
  onNavigate: (idx: number) => void;
}) {
  const multi = images.length > 1;
  const img = images[index];

  const prev = useCallback(() => {
    if (index > 0) onNavigate(index - 1);
  }, [index, onNavigate]);

  const next = useCallback(() => {
    if (index < images.length - 1) onNavigate(index + 1);
  }, [index, images.length, onNavigate]);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, prev, next]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="lightbox-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-9999 flex items-center justify-center bg-black/85 backdrop-blur-sm"
        onClick={onClose}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Prev arrow */}
        {multi && index > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute left-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}

        {/* Image */}
        <motion.img
          key={img.src}
          src={img.src}
          alt={img.alt}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />

        {/* Next arrow */}
        {multi && index < images.length - 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}

        {/* Counter */}
        {multi && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white/70 backdrop-blur-sm">
            {index + 1} of {images.length}
          </div>
        )}
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

// ────────────────────────────────────────────────────────────
// Gallery grid — adaptive layout based on image count
// ────────────────────────────────────────────────────────────

const MAX_VISIBLE = 4;

function GalleryImage({
  image,
  onClick,
  className,
  maxHeight = 280,
  overlay,
}: {
  image: EmailImage;
  onClick: () => void;
  className?: string;
  maxHeight?: number;
  overlay?: ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex items-center justify-center overflow-hidden rounded-lg bg-background-200 dark:bg-white/5",
        "cursor-zoom-in transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-100/50",
        className,
      )}
    >
      <img
        src={image.src}
        alt={image.alt}
        style={{ maxHeight }}
        className={cn(
          "w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]",
          !loaded && "opacity-0",
        )}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
      {!loaded && !error && (
        <div className="absolute inset-0 animate-pulse bg-foreground-100/5 dark:bg-white/5" />
      )}
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/10" />
      <div className="pointer-events-none absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white/80 opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </div>
      {overlay}
    </button>
  );
}

export function ImageGallery({ images }: { images: EmailImage[] }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  if (images.length === 0) return null;

  const visibleCount = Math.min(images.length, MAX_VISIBLE);
  const overflowCount = images.length - MAX_VISIBLE;

  return (
    <>
      <div
        className={cn(
          "my-3 gap-1.5",
          images.length === 1 && "flex",
          images.length >= 2 && "grid grid-cols-2",
        )}
      >
        {images.length === 1 && (
          <GalleryImage
            image={images[0]}
            onClick={() => setLightboxIdx(0)}
            maxHeight={500}
          />
        )}

        {images.length === 2 && (
          <>
            <GalleryImage
              image={images[0]}
              onClick={() => setLightboxIdx(0)}
            />
            <GalleryImage
              image={images[1]}
              onClick={() => setLightboxIdx(1)}
            />
          </>
        )}

        {images.length === 3 && (
          <>
            <GalleryImage
              image={images[0]}
              onClick={() => setLightboxIdx(0)}
              className="col-span-2"
              maxHeight={320}
            />
            <GalleryImage
              image={images[1]}
              onClick={() => setLightboxIdx(1)}
            />
            <GalleryImage
              image={images[2]}
              onClick={() => setLightboxIdx(2)}
            />
          </>
        )}

        {images.length >= 4 && (
          <>
            {images.slice(0, visibleCount).map((img, i) => (
              <GalleryImage
                key={img.src}
                image={img}
                onClick={() => setLightboxIdx(i)}
                overlay={
                  i === visibleCount - 1 && overflowCount > 0 ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50">
                      <span className="text-xl font-semibold text-white">
                        +{overflowCount}
                      </span>
                    </div>
                  ) : undefined
                }
              />
            ))}
          </>
        )}
      </div>

      {lightboxIdx !== null && (
        <ImageLightbox
          images={images}
          index={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onNavigate={setLightboxIdx}
        />
      )}
    </>
  );
}
