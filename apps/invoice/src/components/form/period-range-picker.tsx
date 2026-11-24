import { cn } from "@rulisme/ui/lib/utils";
import type { DateRangeValue } from "@rulisme/ui/ui/date-picker";
import {
  DateRangePicker,
  defaultDateRangePresets,
} from "@rulisme/ui/ui/date-picker";
import { Label } from "@rulisme/ui/ui/label";
import { format, parse } from "date-fns";
import { useId } from "react";
import { useTranslation } from "@/i18n";

// A line item's service period on the shared DateRangePicker
// (`@rulisme/ui`). The invoice stores the period as display text
// ("01 Nov 2026–30 Nov 2026", or one date), which the preview and the PDF
// print as is, so this adapter converts it to and from the picker's ISO range.

const DATE_FORMATS = [
  "dd MMM yyyy",
  "dd-MM-yyyy",
  "MMM d, yyyy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
];
const SEPARATORS = [" – ", "–", " - "];
const DISPLAY_FORMAT = "dd MMM yyyy";

function toIso(text: string): string | undefined {
  for (const fmt of DATE_FORMATS) {
    const parsed = parse(text.trim(), fmt, new Date());
    if (!Number.isNaN(parsed.getTime())) {
      return format(parsed, "yyyy-MM-dd");
    }
  }
  return;
}

function parsePeriod(period: string): DateRangeValue | undefined {
  if (!period) {
    return;
  }
  for (const sep of SEPARATORS) {
    const idx = period.indexOf(sep);
    if (idx === -1) {
      continue;
    }
    const from = toIso(period.slice(0, idx));
    const to = toIso(period.slice(idx + sep.length));
    if (from && to) {
      return { from, to };
    }
  }
  const single = toIso(period);
  return single ? { from: single, to: single } : undefined;
}

function displayDate(iso: string): string {
  return format(parse(iso, "yyyy-MM-dd", new Date()), DISPLAY_FORMAT);
}

function formatPeriod(range: DateRangeValue): string {
  return range.from === range.to
    ? displayDate(range.from)
    : `${displayDate(range.from)}–${displayDate(range.to)}`;
}

interface PeriodRangePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function PeriodRangePicker({
  value,
  onChange,
  disabled,
  className,
}: PeriodRangePickerProps) {
  const { t } = useTranslation();
  const id = useId();
  const presets = defaultDateRangePresets({
    last7Days: t("form.datePresets.last7Days"),
    last30Days: t("form.datePresets.last30Days"),
    thisMonth: t("form.datePresets.thisMonth"),
    lastMonth: t("form.datePresets.lastMonth"),
    thisYear: t("form.datePresets.thisYear"),
  });

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{t("form.period")}</Label>
      <DateRangePicker
        clearLabel={t("form.datePresets.clearPeriod")}
        disabled={disabled}
        formatValue={formatPeriod}
        id={id}
        onValueChange={(range) => onChange(range ? formatPeriod(range) : "")}
        placeholder={t("placeholders.selectPeriod")}
        presets={presets}
        presetsLabel={t("form.datePresets.label")}
        value={parsePeriod(value)}
      />
    </div>
  );
}
