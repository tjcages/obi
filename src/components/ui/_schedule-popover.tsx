import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib";

interface SchedulePopoverProps {
  open: boolean;
  onClose: () => void;
  onSchedule: (date: Date) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

function getNextWeekday(dayOfWeek: number, hour: number): Date {
  const now = new Date();
  const result = new Date(now);
  const currentDay = now.getDay();
  let daysUntil = dayOfWeek - currentDay;
  if (daysUntil <= 0) daysUntil += 7;
  result.setDate(now.getDate() + daysUntil);
  result.setHours(hour, 0, 0, 0);
  return result;
}

function getTomorrow(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function formatScheduleDate(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayName = days[d.getDay()];
  const month = months[d.getMonth()];
  const date = d.getDate();
  const hour = d.getHours();
  const minute = d.getMinutes();
  const amPm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  const min = minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`;
  return `${dayName}, ${month} ${date} at ${h12}${min} ${amPm}`;
}

const PRESETS = [
  {
    label: "Tomorrow morning",
    sublabel: () => formatScheduleDate(getTomorrow(8)),
    getDate: () => getTomorrow(8),
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    ),
  },
  {
    label: "Tomorrow afternoon",
    sublabel: () => formatScheduleDate(getTomorrow(13)),
    getDate: () => getTomorrow(13),
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 18a5 5 0 0 0-10 0" /><line x1="12" y1="9" x2="12" y2="2" /><line x1="4.22" y1="10.22" x2="5.64" y2="11.64" /><line x1="1" y1="18" x2="3" y2="18" /><line x1="21" y1="18" x2="23" y2="18" /><line x1="18.36" y1="11.64" x2="19.78" y2="10.22" />
      </svg>
    ),
  },
  {
    label: "Monday morning",
    sublabel: () => formatScheduleDate(getNextWeekday(1, 8)),
    getDate: () => getNextWeekday(1, 8),
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
];

export function SchedulePopover({ open, onClose, onSchedule, anchorRef }: SchedulePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("09:00");

  useEffect(() => {
    if (!open) {
      setShowCustom(false);
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose, anchorRef]);

  const handleCustomSubmit = useCallback(() => {
    if (!customDate || !customTime) return;
    const [year, month, day] = customDate.split("-").map(Number);
    const [hour, minute] = customTime.split(":").map(Number);
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (date <= new Date()) return;
    onSchedule(date);
  }, [customDate, customTime, onSchedule]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={popoverRef}
          initial={{ opacity: 0, y: 4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.97 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="absolute bottom-full right-0 z-50 mb-2 w-[280px] origin-bottom-right rounded-xl border border-border-100 bg-background-100 shadow-xl"
        >
          <div className="px-3 py-2.5">
            <p className="text-xs font-medium text-foreground-200">Schedule send</p>
          </div>

          <div className="border-t border-border-100">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => onSchedule(preset.getDate())}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-background-200"
              >
                <span className="text-foreground-300">{preset.icon}</span>
                <div className="min-w-0 flex-1">
                  <span className="block text-sm text-foreground-100">{preset.label}</span>
                  <span className="block text-xs text-foreground-300">{preset.sublabel()}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-border-100">
            {!showCustom ? (
              <button
                type="button"
                onClick={() => setShowCustom(true)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-background-200"
              >
                <span className="text-foreground-300">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                </span>
                <span className="text-sm text-foreground-100">Pick date & time</span>
              </button>
            ) : (
              <div className="space-y-2 px-3 py-3">
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    className="flex-1 rounded-lg border border-border-100 bg-background-200 px-2.5 py-1.5 text-sm text-foreground-100 outline-none focus:border-blue-400"
                  />
                  <input
                    type="time"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="w-[100px] rounded-lg border border-border-100 bg-background-200 px-2.5 py-1.5 text-sm text-foreground-100 outline-none focus:border-blue-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCustomSubmit}
                  disabled={!customDate || !customTime}
                  className={cn(
                    "w-full rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    customDate && customTime
                      ? "bg-blue-600 text-white hover:bg-blue-500"
                      : "bg-background-200 text-foreground-300 cursor-not-allowed",
                  )}
                >
                  Schedule
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
