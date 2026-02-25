import { useMemo } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

interface TodoCalendarProps {
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  /** Dates that have todos scheduled, for dot indicators */
  todoDates?: string[];
}

function toLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function TodoCalendar({ selectedDate, onSelectDate, todoDates = [] }: TodoCalendarProps) {
  const selected = selectedDate ? toLocalDate(selectedDate) : undefined;

  const todoDatesAsDate = useMemo(
    () => todoDates.map(toLocalDate),
    [todoDates],
  );

  const defaultMonth = selected ?? new Date();

  return (
    <div className="rdp-theme">
      <DayPicker
        mode="single"
        selected={selected}
        onSelect={(date) => onSelect(date ? toISODate(date) : null)}
        defaultMonth={defaultMonth}
        modifiers={{ hasTodo: todoDatesAsDate }}
        modifiersClassNames={{ hasTodo: "rdp-has-todo" }}
        showOutsideDays
        fixedWeeks
      />
    </div>
  );

  function onSelect(date: string | null) {
    if (date === selectedDate) {
      onSelectDate(null);
    } else {
      onSelectDate(date);
    }
  }
}
