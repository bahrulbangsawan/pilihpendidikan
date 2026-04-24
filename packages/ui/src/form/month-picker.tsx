import { cn } from "../lib/utils";

const MONTHS = [
  { value: "01", label: "Jan" },
  { value: "02", label: "Feb" },
  { value: "03", label: "Mar" },
  { value: "04", label: "Apr" },
  { value: "05", label: "May" },
  { value: "06", label: "Jun" },
  { value: "07", label: "Jul" },
  { value: "08", label: "Aug" },
  { value: "09", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 61 }, (_, i) => currentYear - 50 + i);

const selectStyles =
  "h-10 min-w-0 flex-1 appearance-none rounded-md border border-input bg-input/20 px-3 py-0.5 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:h-7 md:px-2 md:text-xs/relaxed dark:bg-input/30";

interface MonthPickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Maximum selectable month in YYYY-MM format (e.g. "2026-03"). Months/years beyond this are hidden. */
  max?: string;
  className?: string;
}

export function MonthPicker({
  value,
  onChange,
  disabled,
  max,
  className,
}: MonthPickerProps) {
  const [year, month] = value ? value.split("-") : ["", ""];
  const maxYear = max ? Number(max.split("-")[0]) : undefined;
  const maxMonth = max ? max.split("-")[1] : undefined;

  const filteredYears = maxYear ? YEARS.filter((y) => y <= maxYear) : YEARS;
  const filteredMonths =
    maxYear && maxMonth && year === String(maxYear)
      ? MONTHS.filter((m) => m.value <= maxMonth)
      : MONTHS;

  function handleChange(newMonth: string, newYear: string) {
    if (newMonth && newYear) {
      // Clamp month if switching to max year with a month that exceeds max
      const clampedMonth =
        maxYear &&
        maxMonth &&
        Number(newYear) === maxYear &&
        newMonth > maxMonth
          ? maxMonth
          : newMonth;
      onChange(`${newYear}-${clampedMonth}`);
    } else if (!(newMonth || newYear)) {
      onChange("");
    }
  }

  return (
    <div className={cn("flex gap-1.5", className)}>
      <select
        className={selectStyles}
        disabled={disabled}
        onChange={(e) =>
          handleChange(e.target.value, year || String(currentYear))
        }
        value={month}
      >
        <option value="">Month</option>
        {filteredMonths.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        className={selectStyles}
        disabled={disabled}
        onChange={(e) => handleChange(month || "01", e.target.value)}
        value={year}
      >
        <option value="">Year</option>
        {filteredYears.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
