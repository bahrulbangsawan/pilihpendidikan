import { addDaysIso, isoToday } from "@rulisme/ui/lib/iso-date";
import type { DatePreset } from "@rulisme/ui/ui/date-picker";
import { DatePicker as SharedDatePicker } from "@rulisme/ui/ui/date-picker";
import { Label } from "@rulisme/ui/ui/label";
import { format, parse } from "date-fns";
import { useId } from "react";
import { formatInvoiceDate } from "@/components/invoice-form-utils";
import { useTranslation } from "@/i18n";

// The invoice's date fields on the shared DatePicker (`@rulisme/ui`). Values
// are stored as ISO `yyyy-MM-dd`; older drafts may hold "dd MMM yyyy" and
// friends, so the value is normalised before it reaches the picker.

const DATE_FORMATS = ["yyyy-MM-dd", "dd MMM yyyy", "dd-MM-yyyy", "MM/dd/yyyy"];

function toIso(value: string): string {
  if (!value) {
    return "";
  }
  for (const fmt of DATE_FORMATS) {
    const parsed = parse(value, fmt, new Date());
    if (!Number.isNaN(parsed.getTime())) {
      return format(parsed, "yyyy-MM-dd");
    }
  }
  return "";
}

/** Which shortcuts the field offers: an issue date or a due date. */
export type DatePresetKind = "issue" | "due";

interface DatePickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  presetKind?: DatePresetKind;
}

export function DatePicker({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  presetKind = "issue",
}: DatePickerProps) {
  const { t } = useTranslation();
  const id = useId();
  const today = isoToday();
  const presets: DatePreset[] =
    presetKind === "due"
      ? [
          { label: t("form.datePresets.inAWeek"), value: addDaysIso(today, 7) },
          {
            label: t("form.datePresets.in14Days"),
            value: addDaysIso(today, 14),
          },
          {
            label: t("form.datePresets.in30Days"),
            value: addDaysIso(today, 30),
          },
        ]
      : [
          { label: t("form.datePresets.today"), value: today },
          {
            label: t("form.datePresets.tomorrow"),
            value: addDaysIso(today, 1),
          },
        ];

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <SharedDatePicker
        clearLabel={t("form.datePresets.clearDate")}
        disabled={disabled}
        formatValue={formatInvoiceDate}
        id={id}
        onValueChange={onChange}
        placeholder={placeholder ?? t("placeholders.selectDate")}
        presets={presets}
        presetsLabel={t("form.datePresets.label")}
        value={toIso(value)}
      />
    </div>
  );
}
