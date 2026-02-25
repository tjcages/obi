import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn, type TodoItem } from "../../lib";
import { CalendarModal } from "./_calendar-modal";

/** Number of day circles visible at once. */
const VISIBLE_DAYS = 7;

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface WeekStripProps {
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
  todos?: TodoItem[];
  className?: string;
}

const slideVariants = {
  enter: (dir: number) => ({
    x: dir >= 0 ? "70%" : "-70%",
    opacity: 0,
  }),
  center: {
    x: "0%",
    opacity: 1,
  },
  exit: (dir: number) => ({
    x: dir >= 0 ? "-70%" : "70%",
    opacity: 0,
  }),
};

export function WeekStrip({ selectedDate, onSelectDate, todos, className }: WeekStripProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [weekOffset, setWeekOffset] = useState(0);
  const [direction, setDirection] = useState(0);

  const datesWithTodos = useMemo(() => {
    const set = new Set<string>();
    if (todos) for (const t of todos) { if (t.scheduledDate) set.add(t.scheduledDate); }
    return set;
  }, [todos]);

  const startDate = addDays(today, weekOffset * 7);
  const days = Array.from({ length: VISIBLE_DAYS }, (_, i) => addDays(startDate, i));

  const firstMonth = days[0].getMonth();
  const lastMonth = days[VISIBLE_DAYS - 1].getMonth();
  const firstYear = days[0].getFullYear();
  const lastYear = days[VISIBLE_DAYS - 1].getFullYear();

  let monthLabel: string;
  if (firstMonth === lastMonth) {
    monthLabel = `${MONTH_NAMES[firstMonth]} ${firstYear}`;
  } else if (firstYear === lastYear) {
    monthLabel = `${MONTH_NAMES[firstMonth].slice(0, 3)} – ${MONTH_NAMES[lastMonth].slice(0, 3)} ${firstYear}`;
  } else {
    monthLabel = `${MONTH_NAMES[firstMonth].slice(0, 3)} '${String(firstYear).slice(2)} – ${MONTH_NAMES[lastMonth].slice(0, 3)} '${String(lastYear).slice(2)}`;
  }

  const containerRef = useRef<HTMLDivElement>(null);

  const navigateWeek = useCallback((dir: number) => {
    setDirection(dir);
    setWeekOffset((w) => w + dir);
  }, []);

  // Native wheel listener (non-passive) so we can preventDefault and
  // stopPropagation — React 18 synthetic onWheel is passive by default and
  // lets <main>'s overflow-y scroll consume the event.
  const wheelTimer = useRef(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      if (now - wheelTimer.current < 350) return;
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 8) return;
      e.preventDefault();
      e.stopPropagation();
      wheelTimer.current = now;
      navigateWeek(delta > 0 ? 1 : -1);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [navigateWeek]);

  // Native touch listeners for swipe-to-navigate.
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      touchRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        t: Date.now(),
      };
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!touchRef.current) return;
      const dx = e.changedTouches[0].clientX - touchRef.current.x;
      const dy = e.changedTouches[0].clientY - touchRef.current.y;
      const dt = Date.now() - touchRef.current.t;
      touchRef.current = null;
      if (Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dx) > 40 && dt < 600) {
        navigateWeek(dx > 0 ? -1 : 1);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [navigateWeek]);

  const todayISO = toISO(today);
  const isCurrentWeek = weekOffset === 0;

  const goToToday = useCallback(() => {
    onSelectDate?.(todayISO);
    if (weekOffset === 0) return;
    setDirection(weekOffset > 0 ? -1 : 1);
    setWeekOffset(0);
  }, [weekOffset, onSelectDate, todayISO]);

  const [calendarOpen, setCalendarOpen] = useState(false);

  const selectedAsDate = selectedDate
    ? (() => { const [y, m, d] = selectedDate.split("-").map(Number); return new Date(y, m - 1, d); })()
    : undefined;

  const handleCalendarSelect = useCallback(
    (date: Date) => {
      const iso = toISO(date);
      onSelectDate?.(iso);

      const diffMs = date.getTime() - today.getTime();
      const diffDays = Math.round(diffMs / 86400000);
      const newOffset = Math.round(diffDays / 7);

      setDirection(newOffset > weekOffset ? 1 : newOffset < weekOffset ? -1 : 0);
      setWeekOffset(newOffset);
      setCalendarOpen(false);
    },
    [today, weekOffset, onSelectDate],
  );

  return (
    <div
      ref={containerRef}
      className={cn("select-none", className)}
    >
      {/* Month caption row — fixed height to prevent layout shift */}
      <div className="flex h-5 items-center justify-end gap-2 px-1 pb-1.5">
        <AnimatePresence>
          {!isCurrentWeek && (
            <motion.button
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ opacity: { duration: 0.15 }, layout: { duration: 0.2, ease: "easeOut" } }}
              type="button"
              onClick={goToToday}
              className="rounded-full border border-border-100 bg-background-100 px-2 py-0.5 text-[10px] text-foreground-300/60 transition-colors hover:border-foreground-300 hover:text-foreground-100"
            >
              Today
            </motion.button>
          )}
        </AnimatePresence>
        <motion.span
          layout
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex items-center gap-1.5"
        >
          <span className="text-[10px] text-foreground-300/60">{monthLabel}</span>
          <button
            type="button"
            onClick={() => setCalendarOpen(true)}
            className="rounded-md p-0.5 text-foreground-300/50 transition-colors hover:text-foreground-200"
            aria-label="Open calendar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
        </motion.span>
      </div>

      {/* Day circles */}
      <div className="relative overflow-hidden">
        <AnimatePresence mode="popLayout" custom={direction} initial={false}>
          <motion.div
            key={weekOffset}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex justify-between"
          >
            {days.map((day) => {
              const iso = toISO(day);
              const dow = day.getDay();
              const isToday = iso === todayISO;
              const isSelected = selectedDate === iso;
              const isWeekend = dow === 0 || dow === 6;
              const hasOtherSelection = !!selectedDate && selectedDate !== todayISO;
              const todayDemoted = isToday && hasOtherSelection;
              const hasTodos = datesWithTodos.has(iso);

              return (
                <motion.button
                  key={iso}
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => onSelectDate?.(iso)}
                  className="flex flex-col items-center gap-1 py-1 outline-none"
                >
                  <span
                    className={cn(
                      "text-[10px] font-semibold uppercase tracking-wider",
                      isSelected && !isToday
                        ? "text-accent-100"
                        : isToday
                          ? "text-accent-100"
                          : isWeekend
                            ? "text-foreground-300/50"
                            : "text-foreground-300/80",
                    )}
                  >
                    {DAY_LABELS[dow]}
                  </span>
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-medium transition-colors",
                      isToday && !todayDemoted && "bg-accent-100 text-white shadow-[0_2px_8px_rgba(109,134,211,0.35)]",
                      todayDemoted && "bg-background-200 text-foreground-100",
                      isSelected && !isToday && "bg-accent-100/15 text-accent-100",
                      !isToday && !isSelected && isWeekend && "text-foreground-300/60",
                      !isToday && !isSelected && !isWeekend && "text-foreground-100",
                    )}
                  >
                    {day.getDate()}
                  </span>
                  <span
                    className={cn(
                      "h-[4px] w-[4px] rounded-full",
                      hasTodos ? "bg-accent-100/60" : "bg-transparent",
                    )}
                  />
                </motion.button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      <CalendarModal
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        selectedDate={selectedAsDate}
        today={today}
        todos={todos}
        onSelectDate={handleCalendarSelect}
      />
    </div>
  );
}
