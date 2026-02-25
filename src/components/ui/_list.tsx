import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { LayoutGroup, AnimatePresence, motion } from "motion/react";
import { cn } from "../../lib";

const EASE_CURVE: [number, number, number, number] = [0.25, 0.1, 0.25, 1];
const ANIM_DURATION = 0.2;

// ─── Context ──────────────────────────────────────────────

interface ListContextValue {
  reorderable: boolean;
  direction: "vertical" | "horizontal" | "grid";
  registerItem: (id: string, el: HTMLElement | null) => void;
  startDrag: (id: string, e: React.PointerEvent) => void;
  draggedId: string | null;
  dragPlaceholderWidth: number;
  dragPlaceholderHeight: number;
}

const ListContext = createContext<ListContextValue>({
  reorderable: false,
  direction: "vertical",
  registerItem: () => {},
  startDrag: () => {},
  draggedId: null,
  dragPlaceholderWidth: 0,
  dragPlaceholderHeight: 0,
});

export function useListContext() {
  return useContext(ListContext);
}

// ─── List ─────────────────────────────────────────────────

interface ListProps {
  children: ReactNode;
  className?: string;
  gap?: string;
  /** Layout direction. Defaults to "vertical". Use "grid" for 2D grid layouts. */
  direction?: "vertical" | "horizontal" | "grid";
  /** Enable drag-to-reorder. Requires each ListItem to have a unique `itemId`. */
  reorderable?: boolean;
  /** Called when the user finishes a drag-reorder with the new id order. */
  onReorder?: (orderedIds: string[]) => void;
  /** Render a drag overlay for the currently-dragged item. Receives the item id. */
  renderDragOverlay?: (id: string) => ReactNode;
  /** Skip the wrapper div so children participate in the parent's layout (e.g. CSS grid). */
  containerless?: boolean;
}

export function List({
  children,
  className,
  gap = "gap-1.5",
  direction = "vertical",
  reorderable = false,
  onReorder,
  renderDragOverlay,
  containerless = false,
}: ListProps) {
  const itemElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const overlayRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const [dragInfo, setDragInfo] = useState<{
    id: string;
    width: number;
    height: number;
    initialLeft: number;
    initialTop: number;
  } | null>(null);

  const [displayOrder, setDisplayOrder] = useState<string[] | null>(null);
  const dragPointerType = useRef<string | null>(null);

  useEffect(() => () => { cleanupRef.current?.(); }, []);

  useEffect(() => {
    if (!dragInfo) return;
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    return () => {
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    };
  }, [dragInfo]);

  const registerItem = useCallback((id: string, el: HTMLElement | null) => {
    if (el) itemElsRef.current.set(id, el);
    else itemElsRef.current.delete(id);
  }, []);

  const startDrag = useCallback((itemId: string, e: React.PointerEvent) => {
    if (!reorderable || !onReorder) return;

    const el = itemElsRef.current.get(itemId);
    if (!el) return;

    dragPointerType.current = e.pointerType;
    const isHorizontal = direction === "horizontal" || direction === "grid";
    const isGrid = direction === "grid";
    const rect = el.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    const entries = Array.from(itemElsRef.current.entries())
      .sort(([, a], [, b]) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        if (isGrid) {
          const rowDiff = ar.top - br.top;
          if (Math.abs(rowDiff) < ar.height / 2) return ar.left - br.left;
          return rowDiff;
        }
        return isHorizontal ? ar.left - br.left : ar.top - br.top;
      });

    const allIds = entries.map(([id]) => id);

    if (isGrid) {
      const otherRects: { id: string; midX: number; top: number; bottom: number }[] = [];
      for (const [id, itemEl] of entries) {
        if (id === itemId) continue;
        const r = itemEl.getBoundingClientRect();
        otherRects.push({ id, midX: (r.left + r.right) / 2, top: r.top, bottom: r.bottom });
      }

      let currentDropIndex = allIds.indexOf(itemId);

      setDragInfo({ id: itemId, width: rect.width, height: rect.height, initialLeft: rect.left, initialTop: rect.top });
      setDisplayOrder(allIds);

      const handleMove = (ev: PointerEvent) => {
        if (overlayRef.current) {
          overlayRef.current.style.transform = `translate(${ev.clientX - offsetX}px, ${ev.clientY - offsetY}px)`;
        }

        let newIndex = 0;
        for (const item of otherRects) {
          const inRow = ev.clientY >= item.top && ev.clientY < item.bottom;
          if (inRow) {
            if (ev.clientX > item.midX) newIndex++;
          } else if (ev.clientY >= item.bottom) {
            newIndex++;
          }
        }

        if (newIndex !== currentDropIndex) {
          currentDropIndex = newIndex;
          const newOrder = otherRects.map((r) => r.id);
          newOrder.splice(newIndex, 0, itemId);
          setDisplayOrder(newOrder);
        }
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        cleanupRef.current = null;
        const finalOrder = otherRects.map((r) => r.id);
        finalOrder.splice(currentDropIndex, 0, itemId);
        onReorder(finalOrder);
        dragPointerType.current = null;
        setDragInfo(null);
        setDisplayOrder(null);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      cleanupRef.current = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
    } else {
      const otherMids: { id: string; mid: number }[] = [];
      for (const [id, itemEl] of entries) {
        if (id === itemId) continue;
        const r = itemEl.getBoundingClientRect();
        otherMids.push({ id, mid: isHorizontal ? (r.left + r.right) / 2 : (r.top + r.bottom) / 2 });
      }

      let currentDropIndex = allIds.indexOf(itemId);

      setDragInfo({ id: itemId, width: rect.width, height: rect.height, initialLeft: rect.left, initialTop: rect.top });
      setDisplayOrder(allIds);

      const handleMove = (ev: PointerEvent) => {
        if (overlayRef.current) {
          overlayRef.current.style.transform = `translate(${ev.clientX - offsetX}px, ${ev.clientY - offsetY}px)`;
        }

        const cursor = isHorizontal ? ev.clientX : ev.clientY;
        let newIndex = otherMids.length;
        for (let i = 0; i < otherMids.length; i++) {
          if (cursor < otherMids[i].mid) {
            newIndex = i;
            break;
          }
        }

        if (newIndex !== currentDropIndex) {
          currentDropIndex = newIndex;
          const newOrder = otherMids.map((r) => r.id);
          newOrder.splice(newIndex, 0, itemId);
          setDisplayOrder(newOrder);
        }
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        cleanupRef.current = null;
        const finalOrder = otherMids.map((r) => r.id);
        finalOrder.splice(currentDropIndex, 0, itemId);
        onReorder(finalOrder);
        dragPointerType.current = null;
        setDragInfo(null);
        setDisplayOrder(null);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      cleanupRef.current = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
    }
  }, [reorderable, onReorder, direction]);

  const contextValue = useMemo<ListContextValue>(() => ({
    reorderable,
    direction,
    registerItem,
    startDrag,
    draggedId: dragInfo?.id ?? null,
    dragPlaceholderWidth: dragInfo?.width ?? 0,
    dragPlaceholderHeight: dragInfo?.height ?? 0,
  }), [reorderable, direction, registerItem, startDrag, dragInfo?.id, dragInfo?.width, dragInfo?.height]);

  const orderedChildren = useMemo(() => {
    if (!displayOrder) return children;
    // Use forEach instead of toArray — toArray prefixes keys (e.g. "todo_abc" → ".$todo_abc")
    // which causes React to unmount/remount every child and replay enter animations.
    const byId = new Map<string, React.ReactElement>();
    React.Children.forEach(children, (child) => {
      if (React.isValidElement<{ itemId?: string }>(child) && child.props.itemId) {
        byId.set(child.props.itemId, child);
      }
    });
    return displayOrder.map((id) => byId.get(id)).filter(Boolean);
  }, [displayOrder, children]);

  const inner = containerless ? (
    <AnimatePresence initial={false}>
      {orderedChildren}
    </AnimatePresence>
  ) : (
    <div className={cn("flex", direction === "horizontal" || direction === "grid" ? "flex-row" : "flex-col", gap, className)}>
      <AnimatePresence initial={false}>
        {orderedChildren}
      </AnimatePresence>
    </div>
  );

  return (
    <ListContext.Provider value={contextValue}>
      {reorderable ? <LayoutGroup>{inner}</LayoutGroup> : inner}

      {dragInfo && renderDragOverlay && createPortal(
        <div
          ref={overlayRef}
          className="pointer-events-none fixed left-0 top-0 z-50"
          style={{
            width: dragInfo.width,
            transform: `translate(${dragInfo.initialLeft}px, ${dragInfo.initialTop}px)`,
          }}
        >
          <div className="overflow-hidden rounded-xl border border-border-100/80 bg-background-100 shadow-xl">
            {renderDragOverlay(dragInfo.id)}
          </div>
        </div>,
        document.body,
      )}
    </ListContext.Provider>
  );
}

// ─── ListItem ─────────────────────────────────────────────

interface ListItemProps {
  children: ReactNode;
  /** Unique id for this item — required for reorder and AnimatePresence keying. */
  itemId: string;
  className?: string;
  /** When true, item participates in ordering but cannot be dragged. Other items can be dragged around it. */
  static?: boolean;
  /** Swipe-left action (e.g. archive/delete). Enables swipe gesture on this item. */
  onSwipeLeft?: () => void;
  /** Label shown when swiping left. */
  swipeLeftLabel?: string;
  /** Swipe-right action (e.g. reply). Only works if onSwipeLeft is also set. */
  onSwipeRight?: () => void;
  /** Label shown when swiping right. */
  swipeRightLabel?: string;
  /** Use compact swipe indicators (small icons). */
  compactSwipe?: boolean;
  /** Foreground bg class for the swipeable row. */
  swipeBgClass?: string;
  /** Container classes for the swipeable row (border, rounding). */
  swipeContainerClass?: string;
  /** Visual variant for the right-swipe action: "reply" (blue arrow) or "complete" (green check). */
  rightSwipeVariant?: "reply" | "complete";
}

export function ListItem({
  children,
  itemId,
  className,
  static: isStatic = false,
  onSwipeLeft,
  onSwipeRight,
  swipeLeftLabel,
  swipeRightLabel,
  compactSwipe,
  swipeBgClass,
  swipeContainerClass,
  rightSwipeVariant,
}: ListItemProps) {
  const { reorderable, direction, registerItem, startDrag, draggedId, dragPlaceholderWidth, dragPlaceholderHeight } = useListContext();
  const isDragged = !isStatic && draggedId === itemId;
  const isHorizontal = direction === "horizontal";

  const content = onSwipeLeft && !isStatic ? (
    <SwipeableRow
      onArchive={onSwipeLeft}
      onReply={onSwipeRight}
      archiveLabel={swipeLeftLabel}
      replyLabel={swipeRightLabel}
      compact={compactSwipe}
      className={swipeBgClass}
      containerClassName={swipeContainerClass}
      rightSwipeVariant={rightSwipeVariant}
      onVerticalDragStart={reorderable ? (e) => startDrag(itemId, e) : undefined}
      disableLayout={reorderable}
    >
      {children}
    </SwipeableRow>
  ) : (
    children
  );

  // Fallback vertical-drag detection for items without SwipeableRow.
  // On touch devices, requires a 400ms long-press before drag activates
  // to avoid conflicts with scrolling.
  const handleFallbackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!reorderable || onSwipeLeft || isStatic) return;
      const origEvent = e;
      const sX = e.clientX;
      const sY = e.clientY;
      const isTouch = e.pointerType === "touch";
      let ready = !isTouch;
      let holdTimer: ReturnType<typeof setTimeout> | null = null;

      if (isTouch) {
        holdTimer = setTimeout(() => {
          ready = true;
          holdTimer = null;
        }, 400);
      }

      const cleanup = () => {
        if (holdTimer) clearTimeout(holdTimer);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - sX;
        const dy = ev.clientY - sY;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
          cleanup();
          if (ready && (isHorizontal ? Math.abs(dx) > Math.abs(dy) : Math.abs(dy) > Math.abs(dx))) {
            startDrag(itemId, origEvent);
          }
        }
      };

      const onUp = () => cleanup();

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [reorderable, onSwipeLeft, isStatic, isHorizontal, itemId, startDrag],
  );

  const animProps = isHorizontal
    ? { initial: { opacity: 0, width: 0 }, animate: { opacity: 1, width: "auto" }, exit: { opacity: 0, width: 0 } }
    : { initial: { opacity: 0, height: 0 }, animate: { opacity: 1, height: "auto" }, exit: { opacity: 0, height: 0 } };

  return (
    <motion.div
      key={itemId}
      layout={reorderable}
      {...animProps}
      transition={{ duration: ANIM_DURATION, ease: EASE_CURVE }}
      className={cn("overflow-hidden", className)}
    >
      {isDragged ? (
        <div
          className="rounded-xl bg-background-300 after:absolute after:inset-0 after:opacity-10 after:bg-[radial-gradient(circle,var(--color-foreground-300)_0.5px,transparent_0.5px)] after:bg-size-[8px_8px] relative"
          style={isHorizontal ? { width: dragPlaceholderWidth, height: dragPlaceholderHeight } : { height: dragPlaceholderHeight }}
        />
      ) : (
        <div
          ref={(el) => registerItem(itemId, el)}
          onPointerDown={reorderable && !onSwipeLeft && !isStatic ? handleFallbackPointerDown : undefined}
        >
          {content}
        </div>
      )}
    </motion.div>
  );
}

// ─── DragHandle ───────────────────────────────────────────
// For items that can't use SwipeableRow (e.g. image clusters
// with horizontal scroll), this grip handle initiates drag.

export function DragHandle({ itemId, className }: { itemId: string; className?: string }) {
  const { startDrag, reorderable } = useListContext();
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!reorderable) return null;

  return (
    <button
      type="button"
      className={cn(
        "cursor-grab touch-none active:cursor-grabbing rounded p-1 transition-colors hover:bg-foreground-100/10",
        className,
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        if (e.pointerType === "touch") {
          const origEvent = e;
          if (holdTimer.current) clearTimeout(holdTimer.current);
          holdTimer.current = setTimeout(() => {
            holdTimer.current = null;
            startDrag(itemId, origEvent);
          }, 400);
        } else {
          startDrag(itemId, e);
        }
      }}
      onPointerUp={() => {
        if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
      }}
      onPointerCancel={() => {
        if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
      }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="9" cy="5" r="1.5" />
        <circle cx="15" cy="5" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="19" r="1.5" />
        <circle cx="15" cy="19" r="1.5" />
      </svg>
    </button>
  );
}

// ─── SwipeableRow (internal) ──────────────────────────────
// Thin re-export wrapper so ListItem doesn't directly depend
// on the full SwipeableEmailRow module at the type level.
// We import it lazily to keep this file focused.

import { SwipeableEmailRow } from "./_swipeable-email-row";

function SwipeableRow({
  children,
  onArchive,
  onReply,
  archiveLabel,
  replyLabel,
  compact,
  className,
  containerClassName,
  rightSwipeVariant,
  onVerticalDragStart,
  disableLayout,
}: {
  children: ReactNode;
  onArchive: () => void;
  onReply?: () => void;
  archiveLabel?: string;
  replyLabel?: string;
  compact?: boolean;
  className?: string;
  containerClassName?: string;
  rightSwipeVariant?: "reply" | "complete";
  onVerticalDragStart?: (e: React.PointerEvent) => void;
  disableLayout?: boolean;
}) {
  return (
    <SwipeableEmailRow
      onArchive={onArchive}
      onReply={onReply}
      archiveLabel={archiveLabel}
      replyLabel={replyLabel}
      compact={compact}
      className={className}
      containerClassName={containerClassName}
      rightSwipeVariant={rightSwipeVariant}
      onVerticalDragStart={onVerticalDragStart}
      layoutAnimation={disableLayout ? false : "position"}
    >
      {children}
    </SwipeableEmailRow>
  );
}
