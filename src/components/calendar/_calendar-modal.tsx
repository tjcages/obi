import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { cn, useIsMobile, type TodoItem } from "../../lib";
import { Drawer } from "../ui/_drawer";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const MAX_VISIBLE_TODOS = 3;
const MONTHS_BEFORE = 12;
const MONTHS_AFTER = 12;
const CELL_HEIGHT = 100;

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMonthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);

  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + w * 7 + d);
      week.push(date);
    }
    // Stop once an entire week belongs to the next month
    if (week[0].getMonth() !== month && w > 0) break;
    weeks.push(week);
  }
  return weeks;
}

interface CalendarModalProps {
  open: boolean;
  onClose: () => void;
  selectedDate?: Date;
  today: Date;
  todos?: TodoItem[];
  onSelectDate: (date: Date) => void;
}

export function CalendarModal({
  open,
  onClose,
  selectedDate,
  today,
  todos = [],
  onSelectDate,
}: CalendarModalProps) {
  const isMobile = useIsMobile();
  const anchor = selectedDate ?? today;
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [visibleMonth, setVisibleMonth] = useState({ year: anchor.getFullYear(), month: anchor.getMonth() });
  const monthRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const todayISO = toISO(today);
  const selectedISO = selectedDate ? toISO(selectedDate) : null;
  const hasOtherSelection = !!selectedISO && selectedISO !== todayISO;

  const months = useMemo(() =>
    Array.from({ length: MONTHS_BEFORE + MONTHS_AFTER + 1 }, (_, i) =>
      new Date(anchor.getFullYear(), anchor.getMonth() + i - MONTHS_BEFORE, 1),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anchor.getFullYear(), anchor.getMonth()],
  );

  const todosByDate = useMemo(() => {
    const map = new Map<string, TodoItem[]>();
    for (const todo of todos) {
      if (!todo.scheduledDate) continue;
      const existing = map.get(todo.scheduledDate);
      if (existing) existing.push(todo);
      else map.set(todo.scheduledDate, [todo]);
    }
    return map;
  }, [todos]);

  // Scroll to anchor month on open
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        anchorRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      });
    }
  }, [open]);

  // Track which month is visible via IntersectionObserver
  useEffect(() => {
    if (!open || !scrollRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
            const key = (entry.target as HTMLElement).dataset.month;
            if (key) {
              const [y, m] = key.split("-").map(Number);
              setVisibleMonth({ year: y, month: m });
            }
          }
        }
      },
      { root: scrollRef.current, threshold: 0.3 },
    );
    for (const el of monthRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [open, months]);

  const scrollToToday = useCallback(() => {
    const key = `${today.getFullYear()}-${today.getMonth()}`;
    const el = monthRefs.current.get(key);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [today]);

  const isViewingCurrentMonth =
    visibleMonth.year === today.getFullYear() && visibleMonth.month === today.getMonth();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const setMonthRef = useCallback((key: string) => (el: HTMLDivElement | null) => {
    if (el) monthRefs.current.set(key, el);
    else monthRefs.current.delete(key);
  }, []);

  if (!open) return null;

  const MOBILE_CELL_HEIGHT = 56;

  const calendarHeader = (
    <div className="flex shrink-0 items-center justify-between border-b border-border-100/40 px-5 py-3">
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground-100">Calendar</h2>
      <div className="flex items-center gap-2">
        {!isViewingCurrentMonth && (
          <button type="button" onClick={scrollToToday} className="rounded-full border border-border-100 px-2.5 py-1 text-[11px] font-medium text-foreground-200 transition-colors hover:border-foreground-300 hover:text-foreground-100">
            Today
          </button>
        )}
        {!isMobile && (
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-foreground-300 transition-colors hover:bg-foreground-100/5 hover:text-foreground-100" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );

  const weekdayHeader = (
    <div className="grid shrink-0 grid-cols-7 border-b border-border-100/30 px-1">
      {WEEKDAYS.map((d) => (
        <span key={d} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-foreground-300/50">{d}</span>
      ))}
    </div>
  );

  const renderMonths = (cellHeight: number, showTodoPreviews: boolean) => (
    <div ref={scrollRef} className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto overscroll-contain">
      {months.map((monthDate) => {
        const year = monthDate.getFullYear();
        const month = monthDate.getMonth();
        const key = `${year}-${month}`;
        const isAnchor = year === anchor.getFullYear() && month === anchor.getMonth();
        const grid = getMonthGrid(year, month);

        return (
          <div
            key={key}
            ref={(el) => {
              setMonthRef(key)(el);
              if (isAnchor && el) (anchorRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }}
            data-month={key}
            className="snap-start px-1"
          >
            <div className="sticky top-0 z-10 bg-background-100/90 px-3 py-3 backdrop-blur-sm">
              <h3 className={cn("font-bold tracking-tight text-foreground-100", isMobile ? "text-lg" : "text-2xl")}>
                {MONTH_NAMES[month]} <span className="text-foreground-300/50">{year}</span>
              </h3>
            </div>

            <div className="grid grid-cols-7">
              {grid.flat().map((day) => {
                const iso = toISO(day);
                const isCurrentMonth = day.getMonth() === month;
                const isToday = iso === todayISO;
                const isSelected = iso === selectedISO;
                const dow = day.getDay();
                const isWeekend = dow === 0 || dow === 6;
                const dayTodos = isCurrentMonth ? (todosByDate.get(iso) ?? []) : [];
                const pendingTodos = dayTodos.filter((t) => t.status === "pending");
                const completedTodos = dayTodos.filter((t) => t.status === "completed");
                const allTodos = [...pendingTodos, ...completedTodos];
                const visibleTodos = showTodoPreviews ? allTodos.slice(0, MAX_VISIBLE_TODOS) : [];
                const overflowCount = allTodos.length - MAX_VISIBLE_TODOS;

                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => onSelectDate(day)}
                    style={{ height: cellHeight }}
                    className={cn(
                      "group flex flex-col overflow-hidden border-b border-r border-border-100/20 p-1 text-left outline-none transition-colors nth-[7n]:border-r-0",
                      isCurrentMonth ? "hover:bg-background-300" : "opacity-30",
                      isCurrentMonth && isWeekend && "bg-background-200",
                      isToday && "bg-accent-100/10 ring-1 ring-inset ring-accent-100/30",
                      isSelected && !isToday && "bg-accent-100/6",
                    )}
                  >
                    <div className="mb-0.5 flex shrink-0 items-center gap-1">
                      <span
                        className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-medium",
                          isToday && !hasOtherSelection && "bg-accent-100 font-semibold text-white",
                          isToday && hasOtherSelection && "font-semibold text-accent-100",
                          isSelected && !isToday && "font-semibold text-accent-100",
                          !isToday && !isSelected && isWeekend && "text-foreground-300/50",
                          !isToday && !isSelected && !isWeekend && "text-foreground-100",
                        )}
                      >
                        {day.getDate()}
                      </span>
                      {isCurrentMonth && allTodos.length > 0 && (
                        <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-accent-100/60" />
                      )}
                    </div>

                    {showTodoPreviews && isCurrentMonth && visibleTodos.length > 0 && (
                      <div className="flex min-h-0 flex-col gap-px overflow-hidden">
                        {visibleTodos.map((todo) => (
                          <span key={todo.id} className={cn("truncate rounded px-1 py-px text-[10px] leading-tight", todo.status === "completed" ? "text-foreground-300/40 line-through" : "text-foreground-200")}>
                            {todo.title}
                          </span>
                        ))}
                        {overflowCount > 0 && (
                          <span className="px-1 text-[10px] leading-tight text-foreground-300/40">+{overflowCount} more</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <Drawer.Content className="h-[90dvh]">
          {calendarHeader}
          {weekdayHeader}
          {renderMonths(MOBILE_CELL_HEIGHT, false)}
          <div className="h-[env(safe-area-inset-bottom)]" />
        </Drawer.Content>
      </Drawer>
    );
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="cal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
          className="flex max-h-[88vh] w-[95vw] max-w-[900px] flex-col overflow-hidden rounded-2xl border border-border-100/60 bg-background-100 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {calendarHeader}
          {weekdayHeader}
          {renderMonths(CELL_HEIGHT, true)}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
