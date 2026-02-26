import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { cn } from "../../lib";
import type { NavStackEntry, NavStackPushOpts, NavStackVariant, UseNavStackReturn } from "./_use-nav-stack";

// ── Context ──

interface NavStackContextValue {
  push: (id: string, opts?: NavStackPushOpts) => void;
  pop: () => void;
}

const NavStackContext = createContext<NavStackContextValue | null>(null);

export function useNavStackContext() {
  return useContext(NavStackContext);
}

// ── Compound component markers ──

interface NavStackRootProps {
  children: ReactNode;
  className?: string;
}

function NavStackRoot(_: NavStackRootProps) {
  void _;
  return null;
}

interface NavStackScreenProps {
  id: string;
  title?: string;
  backLabel?: string;
  children: ReactNode;
  className?: string;
  scrollable?: boolean;
  hideNavBar?: boolean;
  variant?: NavStackVariant;
}

function NavStackScreen(_: NavStackScreenProps) {
  void _;
  return null;
}

// ── Main component ──

interface NavStackProps {
  nav: UseNavStackReturn;
  children: ReactNode;
  renderPage?: (entry: NavStackEntry) => ReactNode;
  renderNavBar?: (
    entry: NavStackEntry,
    helpers: { pop: () => void; prevTitle?: string },
  ) => ReactNode;
  className?: string;
  edgeWidth?: number;
  swipeThreshold?: number;
  velocityThreshold?: number;
  parallaxOffset?: number;
  overlayMaxOpacity?: number;
}

function NavStackComponent({
  nav,
  children,
  renderPage,
  renderNavBar,
  className,
  edgeWidth = 35,
  swipeThreshold = 0.35,
  velocityThreshold = 600,
  parallaxOffset = 80,
  overlayMaxOpacity = 0.15,
}: NavStackProps) {
  // Parse compound children
  let rootContent: ReactNode = null;
  const screens = new Map<string, NavStackScreenProps>();

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === NavStackRoot) {
      rootContent = (child.props as NavStackRootProps).children;
    } else if (child.type === NavStackScreen) {
      const props = child.props as NavStackScreenProps;
      screens.set(props.id, props);
    }
  });

  if (rootContent === null) {
    const nonScreenChildren: ReactNode[] = [];
    Children.forEach(children, (child) => {
      if (isValidElement(child) && (child.type === NavStackRoot || child.type === NavStackScreen)) return;
      nonScreenChildren.push(child);
    });
    rootContent = nonScreenChildren.length > 0 ? nonScreenChildren : null;
  }

  // Track exiting overlay for exit animation
  const [exitingEntry, setExitingEntry] = useState<NavStackEntry | null>(null);
  const topEntry = nav.stack.length > 0 ? nav.stack[nav.stack.length - 1] : null;
  const visibleEntry = exitingEntry ?? topEntry;
  const isOverlayVisible = visibleEntry !== null;

  // ── Resolvers ──

  const resolveVariant = useCallback((entry: NavStackEntry): NavStackVariant => {
    return entry.variant ?? screens.get(entry.id)?.variant ?? "slide";
  }, [screens]);

  const resolveContent = (entry: NavStackEntry): ReactNode => {
    const screen = screens.get(entry.id);
    if (screen) return screen.children;
    if (renderPage) return renderPage(entry);
    return null;
  };

  const resolveTitle = (entry: NavStackEntry): string => {
    const screen = screens.get(entry.id);
    return entry.title ?? screen?.title ?? entry.id;
  };

  const resolveBackLabel = (entry: NavStackEntry): string => {
    const screen = screens.get(entry.id);
    const stackIdx = nav.stack.findIndex((e) => e.id === entry.id);
    if (stackIdx > 0) {
      const prev = nav.stack[stackIdx - 1];
      return resolveTitle(prev);
    }
    return entry.backLabel ?? screen?.backLabel ?? "Back";
  };

  const resolveScreenClassName = (entry: NavStackEntry): string | undefined => {
    return screens.get(entry.id)?.className;
  };

  const resolveScrollable = (entry: NavStackEntry): boolean => {
    return screens.get(entry.id)?.scrollable !== false;
  };

  const resolveHideNavBar = (entry: NavStackEntry): boolean => {
    const variant = resolveVariant(entry);
    if (variant === "cover") return true;
    return entry.hideNavBar === true || screens.get(entry.id)?.hideNavBar === true;
  };

  // ── Slide animation values ──

  const contentX = useMotionValue(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const navTranslateX = useTransform(contentX, (v) => {
    const sw = typeof window !== "undefined" ? window.innerWidth : 400;
    return -parallaxOffset * Math.max(0, Math.min(1, 1 - v / sw));
  });

  const slideOverlayOpacity = useTransform(contentX, (v) => {
    const sw = typeof window !== "undefined" ? window.innerWidth : 400;
    return overlayMaxOpacity * Math.max(0, Math.min(1, 1 - v / sw));
  });

  // ── Cover animation values ──

  const contentY = useMotionValue(0);

  const rootScale = useTransform(contentY, (v) => {
    const sh = typeof window !== "undefined" ? window.innerHeight : 800;
    const progress = Math.max(0, Math.min(1, 1 - v / sh));
    return 1 - 0.06 * progress;
  });

  const rootBorderRadius = useTransform(contentY, (v) => {
    const sh = typeof window !== "undefined" ? window.innerHeight : 800;
    const progress = Math.max(0, Math.min(1, 1 - v / sh));
    return progress * 12;
  });

  const coverOverlayOpacity = useTransform(contentY, (v) => {
    const sh = typeof window !== "undefined" ? window.innerHeight : 800;
    return 0.35 * Math.max(0, Math.min(1, 1 - v / sh));
  });

  // Current variant
  const currentVariant = visibleEntry ? resolveVariant(visibleEntry) : "slide";

  // ── Push animation ──

  const prevStackLenRef = useRef(nav.stack.length);
  useEffect(() => {
    const prev = prevStackLenRef.current;
    const next = nav.stack.length;
    prevStackLenRef.current = next;

    if (next > prev && next > 0) {
      const entry = nav.stack[next - 1];
      const variant = resolveVariant(entry);

      if (variant === "cover") {
        contentY.set(window.innerHeight);
        requestAnimationFrame(() => {
          animate(contentY, 0, { type: "spring", stiffness: 300, damping: 34 });
        });
      } else {
        contentX.set(window.innerWidth);
        requestAnimationFrame(() => {
          animate(contentX, 0, { type: "spring", stiffness: 400, damping: 40 });
        });
      }
    }
  }, [nav.stack.length, contentX, contentY, resolveVariant]);

  // ── Animated pop ──

  const animatedPop = useCallback(() => {
    if (nav.stack.length === 0) return;
    const entry = nav.stack[nav.stack.length - 1];
    const variant = resolveVariant(entry);
    setExitingEntry(entry);

    if (variant === "cover") {
      animate(contentY, window.innerHeight, {
        type: "spring",
        stiffness: 300,
        damping: 34,
      }).then(() => {
        setExitingEntry(null);
        nav.pop();
        contentY.set(0);
      });
    } else {
      animate(contentX, window.innerWidth, {
        type: "spring",
        stiffness: 400,
        damping: 40,
      }).then(() => {
        setExitingEntry(null);
        nav.pop();
      });
    }
  }, [nav, contentX, contentY, resolveVariant]);

  // ── Slide: swipe-back from left edge ──

  useEffect(() => {
    if (!isOverlayVisible || currentVariant !== "slide") return;
    const el = contentRef.current;
    if (!el) return;

    let isEdge = false;
    let startX = 0;
    let startY = 0;
    let decided = false;
    let lastDx = 0;
    let lastTime = 0;
    let vx = 0;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch.clientX < edgeWidth) {
        e.preventDefault();
        isEdge = true;
        startX = touch.clientX;
        startY = touch.clientY;
        decided = false;
        lastDx = 0;
        lastTime = Date.now();
        vx = 0;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isEdge) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!decided) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          decided = true;
          if (Math.abs(dy) > Math.abs(dx)) {
            isEdge = false;
            return;
          }
        } else {
          return;
        }
      }

      e.preventDefault();
      const now = Date.now();
      const dt = now - lastTime;
      if (dt > 0) vx = ((dx - lastDx) / dt) * 1000;
      lastDx = dx;
      lastTime = now;
      contentX.set(Math.max(0, dx));
    };

    const onTouchEnd = () => {
      if (!isEdge || !decided) {
        isEdge = false;
        return;
      }
      const current = contentX.get();
      const sw = window.innerWidth;
      if (current > sw * swipeThreshold || vx > velocityThreshold) {
        const entry = nav.stack[nav.stack.length - 1];
        if (entry) setExitingEntry(entry);
        animate(contentX, sw, {
          type: "spring",
          stiffness: 300,
          damping: 35,
        }).then(() => {
          setExitingEntry(null);
          nav.pop();
        });
      } else {
        animate(contentX, 0, { type: "spring", stiffness: 500, damping: 50 });
      }
      isEdge = false;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [isOverlayVisible, currentVariant, contentX, edgeWidth, swipeThreshold, velocityThreshold, nav]);

  // ── Cover: swipe-down to dismiss ──

  useEffect(() => {
    if (!isOverlayVisible || currentVariant !== "cover") return;
    const el = contentRef.current;
    if (!el) return;

    let active = false;
    let startY = 0;
    let startX = 0;
    let decided = false;
    let lastDy = 0;
    let lastTime = 0;
    let vy = 0;

    const onTouchStart = (e: TouchEvent) => {
      const scrollEl = el.querySelector("[data-cover-scroll]") as HTMLElement | null;
      const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
      if (scrollTop > 0) return;

      const touch = e.touches[0];
      startY = touch.clientY;
      startX = touch.clientX;
      active = true;
      decided = false;
      lastDy = 0;
      lastTime = Date.now();
      vy = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active) return;
      const touch = e.touches[0];
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;

      if (!decided) {
        if (Math.abs(dy) > 10 || Math.abs(dx) > 10) {
          decided = true;
          if (Math.abs(dx) > Math.abs(dy) || dy < 0) {
            active = false;
            return;
          }
        } else {
          return;
        }
      }

      e.preventDefault();
      const now = Date.now();
      const dt = now - lastTime;
      if (dt > 0) vy = ((dy - lastDy) / dt) * 1000;
      lastDy = dy;
      lastTime = now;
      contentY.set(Math.max(0, dy));
    };

    const onTouchEnd = () => {
      if (!active || !decided) {
        active = false;
        return;
      }
      const current = contentY.get();
      const sh = window.innerHeight;
      if (current > sh * 0.2 || vy > 500) {
        const entry = nav.stack[nav.stack.length - 1];
        if (entry) setExitingEntry(entry);
        animate(contentY, sh, {
          type: "spring",
          stiffness: 300,
          damping: 35,
        }).then(() => {
          setExitingEntry(null);
          nav.pop();
          contentY.set(0);
        });
      } else {
        animate(contentY, 0, { type: "spring", stiffness: 500, damping: 50 });
      }
      active = false;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [isOverlayVisible, currentVariant, contentY, nav]);

  // ── Default nav bar (slide only) ──

  const renderDefaultNavBar = (
    entry: NavStackEntry,
    { pop: popFn, prevTitle }: { pop: () => void; prevTitle?: string },
  ) => (
    <div className="relative z-10 flex h-11 shrink-0 items-center border-b border-border-100/40 bg-background-100/80 px-1 backdrop-blur-xl">
      <button
        type="button"
        onClick={popFn}
        className="relative z-10 flex shrink-0 items-center gap-0 pr-3 text-[17px] text-accent-100 transition-opacity active:opacity-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {prevTitle}
      </button>
      <span className="pointer-events-none absolute inset-x-24 truncate text-center text-[17px] font-semibold text-foreground-100">
        {resolveTitle(entry)}
      </span>
    </div>
  );

  // ── Render ──

  return (
    <NavStackContext.Provider value={{ push: nav.push, pop: animatedPop }}>
      <div className={cn("relative overflow-hidden", className)}>
        {/* Root layer */}
        <motion.div
          className={cn("h-full overflow-y-auto", currentVariant === "cover" && isOverlayVisible && "pointer-events-none")}
          style={{
            x: currentVariant === "slide" && isOverlayVisible ? navTranslateX : undefined,
            scale: currentVariant === "cover" && isOverlayVisible ? rootScale : undefined,
            borderRadius: currentVariant === "cover" && isOverlayVisible ? rootBorderRadius : undefined,
            transformOrigin: "top center",
          }}
        >
          {rootContent}
        </motion.div>

        {/* Dimming overlay */}
        {isOverlayVisible && (
          <motion.div
            className="pointer-events-none absolute inset-0 bg-black"
            style={{
              opacity: currentVariant === "cover" ? coverOverlayOpacity : slideOverlayOpacity,
            }}
          />
        )}

        {/* Content panel */}
        {isOverlayVisible && visibleEntry && (
          <motion.div
            ref={contentRef}
            className={cn(
              "absolute inset-0 flex flex-col overflow-hidden bg-background-100",
              currentVariant === "slide" && "border-l border-border-100/30",
              currentVariant === "cover" && "rounded-t-[12px]",
            )}
            style={{
              x: currentVariant === "slide" ? contentX : undefined,
              y: currentVariant === "cover" ? contentY : undefined,
              boxShadow: currentVariant === "slide"
                ? "-6px 0 28px rgba(0,0,0,0.12), -1px 0 6px rgba(0,0,0,0.06)"
                : "0 -4px 32px rgba(0,0,0,0.15)",
            }}
          >
            {/* Slide: nav bar */}
            {!resolveHideNavBar(visibleEntry) && (renderNavBar
              ? renderNavBar(visibleEntry, {
                  pop: animatedPop,
                  prevTitle: resolveBackLabel(visibleEntry),
                })
              : renderDefaultNavBar(visibleEntry, {
                  pop: animatedPop,
                  prevTitle: resolveBackLabel(visibleEntry),
                }))}

            {/* Cover: grabber handle */}
            {currentVariant === "cover" && (
              <div className="flex shrink-0 justify-center py-2">
                <div className="h-[5px] w-9 rounded-full bg-foreground-100/15" />
              </div>
            )}

            {/* Content */}
            <div
              className={cn(
                "flex-1",
                resolveScrollable(visibleEntry) ? "overflow-y-auto" : "overflow-hidden",
                resolveScreenClassName(visibleEntry),
              )}
              data-cover-scroll={currentVariant === "cover" ? "" : undefined}
            >
              {resolveContent(visibleEntry)}
            </div>
          </motion.div>
        )}
      </div>
    </NavStackContext.Provider>
  );
}

export const NavStack = Object.assign(NavStackComponent, {
  Root: NavStackRoot,
  Screen: NavStackScreen,
});
