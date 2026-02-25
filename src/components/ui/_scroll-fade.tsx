import { cn } from "../../lib";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface ScrollFadeProps {
  children: ReactNode;
  className?: string;
  fadeSize?: number;
  /** Called when the scroll-end state changes. `true` = scrolled to the right edge (or content fits). */
  onAtEnd?: (atEnd: boolean) => void;
}

export function ScrollFade({ children, className, fadeSize = 24, onAtEnd }: ScrollFadeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const atEndRef = useRef(true);

  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const threshold = 2;
    setCanScrollLeft(el.scrollLeft > threshold);
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - threshold;
    setCanScrollRight(right);
    const nowAtEnd = !right;
    if (nowAtEnd !== atEndRef.current) {
      atEndRef.current = nowAtEnd;
      onAtEnd?.(nowAtEnd);
    }
  }, [onAtEnd]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [check]);

  const maskLeft = `linear-gradient(to right, transparent, black ${fadeSize}px)`;
  const maskRight = `linear-gradient(to left, transparent, black ${fadeSize}px)`;
  const maskBoth = `linear-gradient(to right, transparent, black ${fadeSize}px, black calc(100% - ${fadeSize}px), transparent)`;

  const maskImage = canScrollLeft && canScrollRight
    ? maskBoth
    : canScrollLeft
      ? maskLeft
      : canScrollRight
        ? maskRight
        : undefined;

  return (
    <div
      ref={ref}
      className={cn("overflow-x-auto scrollbar-hide", className)}
      style={maskImage ? { WebkitMaskImage: maskImage, maskImage } : undefined}
    >
      {children}
    </div>
  );
}
