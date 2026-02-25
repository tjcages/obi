import { useRef, useState, useCallback, useEffect, type ReactNode } from "react";
import { motion, useMotionValue, useTransform, animate } from "motion/react";
import { cn } from "../../lib";

const ACTION_REVEAL = 72;
const ACTION_TRIGGER = 150;
const SPRING_CONFIG = { stiffness: 400, damping: 35, mass: 0.8 };
const SNAP_SPRING = { stiffness: 500, damping: 40, mass: 0.6 };
const WHEEL_SETTLE_MS = 180;

// Shared across all instances so residual trackpad inertia from a
// just-triggered swipe action doesn't bleed into the next row.
let globalLastActionMs = 0;
const MOMENTUM_COOLDOWN_MS = 300;

function applyResistance(raw: number): number {
  const resistance = 0.55;
  const abs = Math.abs(raw);
  const sign = raw > 0 ? 1 : -1;

  if (abs > ACTION_TRIGGER) {
    const over = abs - ACTION_TRIGGER;
    return sign * (ACTION_TRIGGER + over * resistance * 0.4);
  }
  if (abs > ACTION_REVEAL) {
    const over = abs - ACTION_REVEAL;
    return sign * (ACTION_REVEAL + over * resistance);
  }
  return raw;
}

interface SwipeableEmailRowProps {
  children: ReactNode;
  onArchive: () => void;
  onReply?: () => void;
  disabled?: boolean;
  /** Classes for the sliding content foreground (background color) */
  className?: string;
  /** Classes for the outer container (border, rounding, margin) */
  containerClassName?: string;
  /** Show a compact text-only archive label instead of the icon + label */
  compact?: boolean;
  /** Override the left-swipe (archive) label text */
  archiveLabel?: string;
  /** Override the right-swipe (reply) label text */
  replyLabel?: string;
  /** Visual variant for the right-swipe action: "reply" (blue arrow) or "complete" (green check) */
  rightSwipeVariant?: "reply" | "complete";
  /** Called when vertical drag is detected (e.g. to start reorder) */
  onVerticalDragStart?: (e: React.PointerEvent) => void;
  /** Override the container's layout animation mode. Defaults to "position". Pass false to disable. */
  layoutAnimation?: "position" | false;
}

export function SwipeableEmailRow({
  children,
  onArchive,
  onReply,
  disabled,
  className,
  containerClassName,
  compact,
  archiveLabel = "Archive",
  replyLabel = "Reply",
  rightSwipeVariant = "reply",
  onVerticalDragStart,
  layoutAnimation = "position",
}: SwipeableEmailRowProps) {
  const x = useMotionValue(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Stable refs for callbacks so effects/handlers don't re-run on every render.
  const onArchiveRef = useRef(onArchive);
  onArchiveRef.current = onArchive;
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const onVerticalDragStartRef = useRef(onVerticalDragStart);
  onVerticalDragStartRef.current = onVerticalDragStart;
  const hasReply = !!onReply;

  // --- shared state ---
  const triggered = useRef(false);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | null>(null);
  const [pastThreshold, setPastThreshold] = useState(false);

  // --- pointer-drag state ---
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const directionLocked = useRef<"x" | "y" | null>(null);
  const didSwipe = useRef(false);

  // --- wheel/trackpad state ---
  const wheelAccum = useRef(0);
  const wheelActive = useRef(false);
  const wheelSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelDirectionLocked = useRef<"x" | "y" | null>(null);
  const wheelDyAccum = useRef(0);

  // --- derived motion values ---
  const archiveOpacity = useTransform(x, [-ACTION_REVEAL, -20, 0], [1, 0.3, 0]);
  const archiveScale = useTransform(
    x,
    [-ACTION_TRIGGER, -ACTION_REVEAL, -20, 0],
    [1.2, 1, 0.6, 0.4],
  );
  const archiveBg = useTransform(
    x,
    [-ACTION_TRIGGER, -ACTION_REVEAL, 0],
    compact
      ? [
          "rgba(115, 115, 130, 0.18)",
          "rgba(115, 115, 130, 0.10)",
          "rgba(115, 115, 130, 0)",
        ]
      : [
          "rgba(115, 115, 130, 0.95)",
          "rgba(115, 115, 130, 0.7)",
          "rgba(115, 115, 130, 0)",
        ],
  );

  const replyOpacity = useTransform(x, [20, ACTION_REVEAL], [0.3, 1]);
  const replyScale = useTransform(
    x,
    [0, 20, ACTION_REVEAL, ACTION_TRIGGER],
    [0.4, 0.6, 1, 1.2],
  );
  const replyBg = useTransform(
    x,
    [0, ACTION_REVEAL, ACTION_TRIGGER],
    rightSwipeVariant === "complete"
      ? [
          "rgba(34, 197, 94, 0)",
          "rgba(34, 197, 94, 0.85)",
          "rgba(34, 197, 94, 1)",
        ]
      : [
          "rgba(59, 130, 246, 0)",
          "rgba(59, 130, 246, 0.85)",
          "rgba(59, 130, 246, 1)",
        ],
  );

  // --- shared helpers ---

  const updateVisualState = useCallback((dampened: number) => {
    setSwipeDirection(dampened < -10 ? "left" : dampened > 10 ? "right" : null);
    setPastThreshold(Math.abs(dampened) >= ACTION_TRIGGER);
  }, []);

  const commitAction = useCallback(
    (currentX: number) => {
      if (Math.abs(currentX) >= ACTION_TRIGGER && !triggered.current) {
        triggered.current = true;
        globalLastActionMs = Date.now();
        const direction = currentX < 0 ? "left" : "right";

        if (direction === "left") {
          animate(x, -400, {
            ...SPRING_CONFIG,
            stiffness: 300,
            onComplete: () => onArchiveRef.current(),
          });
        } else if (onReplyRef.current) {
          const reply = onReplyRef.current;
          animate(x, 0, SNAP_SPRING);
          setSwipeDirection(null);
          setPastThreshold(false);
          requestAnimationFrame(() => reply());
        } else {
          return false;
        }
        return true;
      }
      return false;
    },
    [x],
  );

  const resetSwipe = useCallback(() => {
    animate(x, 0, SNAP_SPRING);
    setSwipeDirection(null);
    setPastThreshold(false);
  }, [x]);

  const resetWheelState = useCallback(() => {
    wheelAccum.current = 0;
    wheelDyAccum.current = 0;
    wheelActive.current = false;
    wheelDirectionLocked.current = null;
    if (wheelSettleTimer.current) {
      clearTimeout(wheelSettleTimer.current);
      wheelSettleTimer.current = null;
    }
  }, []);

  const handlePointerEnter = useCallback(() => {
    resetWheelState();
  }, [resetWheelState]);

  // ────────────────────────────────────────
  // Pointer (click-drag) handlers
  // ────────────────────────────────────────

  const longPressReady = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || wheelActive.current) return;
      isDragging.current = true;
      directionLocked.current = null;
      triggered.current = false;
      didSwipe.current = false;
      startX.current = e.clientX;
      startY.current = e.clientY;
      longPressReady.current = e.pointerType !== "touch";
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (e.pointerType === "touch" && onVerticalDragStartRef.current) {
        longPressTimer.current = setTimeout(() => {
          longPressReady.current = true;
          longPressTimer.current = null;
        }, 400);
      }
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [disabled],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;

      const dx = e.clientX - startX.current;
      const dy = e.clientY - startY.current;

      if (!directionLocked.current) {
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
          directionLocked.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
          if (directionLocked.current === "x") didSwipe.current = true;
          if (directionLocked.current === "y") {
            if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
            isDragging.current = false;
            try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
            if (longPressReady.current) onVerticalDragStartRef.current?.(e);
            return;
          }
        } else {
          return;
        }
      }

      if (directionLocked.current !== "x") return;
      e.preventDefault();

      const clamped = !onReplyRef.current && dx > 0 ? 0 : dx;
      const dampened = applyResistance(clamped);
      x.set(dampened);
      updateVisualState(dampened);
    },
    [x, updateVisualState],
  );

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    longPressReady.current = false;
    if (!isDragging.current) return;
    isDragging.current = false;

    if (!commitAction(x.get())) {
      resetSwipe();
    }
  }, [x, commitAction, resetSwipe]);

  // ────────────────────────────────────────
  // Wheel / trackpad handler
  // ────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    const settle = () => {
      wheelActive.current = false;
      wheelDirectionLocked.current = null;
      wheelDyAccum.current = 0;
      if (!commitAction(x.get())) {
        resetSwipe();
      }
      wheelAccum.current = 0;
    };

    const onWheel = (e: WheelEvent) => {
      if (isDragging.current || triggered.current) return;

      if (Date.now() - globalLastActionMs < MOMENTUM_COOLDOWN_MS) return;

      const dx = e.deltaX;
      const dy = e.deltaY;

      // Direction lock: decide on first meaningful movement
      if (!wheelActive.current) {
        wheelAccum.current = 0;
        wheelDyAccum.current = 0;
        wheelDirectionLocked.current = null;
        triggered.current = false;
      }

      if (!wheelDirectionLocked.current) {
        wheelAccum.current += dx;
        wheelDyAccum.current += dy;

        const totalX = Math.abs(wheelAccum.current);
        const totalY = Math.abs(wheelDyAccum.current);

        if (totalX < 4 && totalY < 4) return;

        if (totalY > totalX) {
          wheelDirectionLocked.current = "y";
          wheelAccum.current = 0;
          wheelDyAccum.current = 0;
          return;
        }
        wheelDirectionLocked.current = "x";
        wheelActive.current = true;
      }

      if (wheelDirectionLocked.current !== "x") return;

      e.preventDefault();
      e.stopPropagation();

      wheelAccum.current += dx;
      const raw = -wheelAccum.current;
      const clamped = !hasReply && raw > 0 ? 0 : raw;
      const dampened = applyResistance(clamped);
      x.set(dampened);
      updateVisualState(dampened);

      // Fire immediately once past threshold
      if (Math.abs(dampened) >= ACTION_TRIGGER) {
        if (wheelSettleTimer.current) clearTimeout(wheelSettleTimer.current);
        wheelSettleTimer.current = null;
        settle();
        return;
      }

      // Otherwise wait for momentum to stop, then snap back
      if (wheelSettleTimer.current) clearTimeout(wheelSettleTimer.current);
      wheelSettleTimer.current = setTimeout(settle, WHEEL_SETTLE_MS);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelSettleTimer.current) clearTimeout(wheelSettleTimer.current);
      wheelActive.current = false;
      wheelDirectionLocked.current = null;
      wheelAccum.current = 0;
      wheelDyAccum.current = 0;
    };
  }, [disabled, x, hasReply, commitAction, resetSwipe, updateVisualState]);

  // Prevent native touch scroll when pointer-swiping
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const preventTouch = (e: TouchEvent) => {
      if (directionLocked.current === "x") e.preventDefault();
    };

    el.addEventListener("touchmove", preventTouch, { passive: false });
    return () => el.removeEventListener("touchmove", preventTouch);
  }, []);

  return (
    <motion.div
      ref={containerRef}
      layout={layoutAnimation}
      initial={{ opacity: 1, height: "auto" }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{
        opacity: { duration: 0.2, ease: "easeOut" },
        height: { type: "spring", stiffness: 500, damping: 40, mass: 0.8 },
        layout: { type: "spring", stiffness: 500, damping: 40, mass: 0.8 },
      }}
      className={cn("relative overflow-hidden", containerClassName)}
      style={{ touchAction: "pan-y" }}
      onPointerEnter={handlePointerEnter}
    >
      {/* Archive action (left swipe reveals right side) */}
      <motion.div
        className="absolute inset-y-0 right-0 flex items-center justify-end"
        style={{
          backgroundColor: archiveBg,
          width: "100%",
          pointerEvents: "none",
        }}
      >
        <motion.div
          className={compact ? "pr-4" : "flex flex-col items-center gap-1 pr-6"}
          style={{ opacity: archiveOpacity, scale: archiveScale }}
        >
          {compact ? (
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150",
                pastThreshold && swipeDirection === "left"
                  ? "bg-foreground-100/20"
                  : "bg-foreground-100/10",
              )}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300">
                <path d="M21 8V21H3V8" />
                <path d="M1 3h22v5H1z" />
                <path d="M10 12h4" />
              </svg>
            </div>
          ) : (
            <>
              <div
                className={cn("flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-150", pastThreshold && swipeDirection === "left" ? "bg-white/30" : "bg-white/15")}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 8V21H3V8" />
                  <path d="M1 3h22v5H1z" />
                  <path d="M10 12h4" />
                </svg>
              </div>
              <span className="text-[10px] font-semibold text-white/90">
                {archiveLabel}
              </span>
            </>
          )}
        </motion.div>
      </motion.div>

      {/* Reply action (right swipe reveals left side) */}
      {onReply && (
        <motion.div
          className="absolute inset-y-0 left-0 flex items-center justify-start"
          style={{
            backgroundColor: replyBg,
            width: "100%",
            pointerEvents: "none",
          }}
        >
          <motion.div
            className={compact ? "pl-4" : "flex flex-col items-center gap-1 pl-6"}
            style={{ opacity: replyOpacity, scale: replyScale }}
          >
            {compact ? (
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150",
                  pastThreshold && swipeDirection === "right"
                    ? rightSwipeVariant === "complete" ? "bg-green-500/25" : "bg-blue-500/25"
                    : rightSwipeVariant === "complete" ? "bg-green-500/15" : "bg-blue-500/15",
                )}
              >
                {rightSwipeVariant === "complete" ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-500">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500">
                    <polyline points="9 17 4 12 9 7" />
                    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                  </svg>
                )}
              </div>
            ) : (
              <>
                <div
                  className={cn("flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-150", pastThreshold && swipeDirection === "right" ? "bg-white/30" : "bg-white/15")}
                >
                  {rightSwipeVariant === "complete" ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 17 4 12 9 7" />
                      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                    </svg>
                  )}
                </div>
                <span className="text-[10px] font-semibold text-white/90">
                  {replyLabel}
                </span>
              </>
            )}
          </motion.div>
        </motion.div>
      )}

      {/* Sliding content */}
      <motion.div
        style={{ x }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={(e) => {
          if (didSwipe.current) {
            e.stopPropagation();
            e.preventDefault();
            didSwipe.current = false;
          }
        }}
        className={cn("relative z-10 cursor-default", className ?? "bg-background-100")}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
