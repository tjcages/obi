import { useRef, useEffect, useState, type RefObject } from "react";

export function useAutoScroll(ref: RefObject<HTMLElement | null>, deps: unknown[]): void {
  const isNearBottom = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => {
      isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    };
    el.addEventListener("scroll", handler);
    return () => el.removeEventListener("scroll", handler);
  }, [ref]);

  useEffect(() => {
    if (isNearBottom.current && ref.current) {
      ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
    }
  }, deps);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

const MOBILE_BREAKPOINT = "(max-width: 1023px)";

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_BREAKPOINT);
}
