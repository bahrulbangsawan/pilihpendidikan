import { cn } from "../lib/utils";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";

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

interface MonthPickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Maximum selectable month in YYYY-MM format (e.g. "2026-03"). Months/years beyond this are hidden. */
  max?: string;
  className?: string;
  /** The id of the element that names the pair (a field label). */
  "aria-labelledby"?: string;
}

// Zedative month picker: two native selects (month, year) side by side, each
// the field shell with a muted chevron, sharing the row 6px apart.
export function MonthPicker({
  value,
  onChange,
  disabled,
  max,
  className,
  "aria-labelledby": ariaLabelledBy,
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
    <fieldset
      aria-labelledby={ariaLabelledBy}
      className={cn("flex min-w-0 gap-1.5", className)}
      data-slot="month-picker"
    >
      <NativeSelect
        aria-label="Month"
        className="min-w-0 flex-1"
        disabled={disabled}
        onChange={(e) =>
          handleChange(e.target.value, year || String(currentYear))
        }
        value={month}
      >
        <NativeSelectOption value="">Month</NativeSelectOption>
        {filteredMonths.map((m) => (
          <NativeSelectOption key={m.value} value={m.value}>
            {m.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label="Year"
        className="min-w-0 flex-1"
        disabled={disabled}
        onChange={(e) => handleChange(month || "01", e.target.value)}
        value={year}
      >
        <NativeSelectOption value="">Year</NativeSelectOption>
        {filteredYears.map((y) => (
          <NativeSelectOption key={y} value={String(y)}>
            {y}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </fieldset>
  );
}
