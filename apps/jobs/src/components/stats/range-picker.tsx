// The Stats date range (12 §9 "A date range picker sits in the toolbar
// band"): presets in a native select, plus from / to days for a custom
// range. The range lives in the URL; invalid custom days never reach the
// api (resolveRange falls back to the default preset).

import { Field, FieldLabel } from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { NativeSelect, NativeSelectOption } from "@rulisme/ui/ui/native-select";
import { useId } from "react";
import { useTranslation } from "@/i18n";
import { formatDate } from "@/lib/format";
import type {
  RangePreset,
  ResolvedRange,
  StatsSearch,
} from "@/lib/stats-range";
import { dayStartMs, isDay, RANGE_PRESETS } from "@/lib/stats-range";

export function RangePicker({
  range,
  today,
  onChange,
}: {
  range: ResolvedRange;
  /** `YYYY-MM-DD` of today (the latest day a custom range may end). */
  today: string;
  onChange: (next: Pick<StatsSearch, "range" | "from" | "to">) => void;
}) {
  const { locale, t } = useTranslation();
  const id = useId();

  function choose(preset: RangePreset) {
    if (preset === "custom") {
      // Start the custom range where the preset was, so nothing jumps.
      onChange({ range: "custom", from: range.from, to: range.to });
      return;
    }
    onChange({ range: preset, from: undefined, to: undefined });
  }

  function setDay(edge: "from" | "to", value: string) {
    const next = { from: range.from, to: range.to, [edge]: value };
    if (isDay(next.from) && isDay(next.to) && next.from <= next.to) {
      onChange({ range: "custom", from: next.from, to: next.to });
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field className="w-auto">
        <FieldLabel htmlFor={`${id}-preset`}>
          {t("stats.range.label")}
        </FieldLabel>
        <NativeSelect
          id={`${id}-preset`}
          onChange={(event) => choose(event.target.value as RangePreset)}
          size="sm"
          value={range.preset}
        >
          {RANGE_PRESETS.map((preset) => (
            <NativeSelectOption key={preset} value={preset}>
              {t(`stats.range.presets.${preset}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {range.preset === "custom" ? (
        <>
          <Field className="w-auto">
            <FieldLabel htmlFor={`${id}-from`}>
              {t("stats.range.from")}
            </FieldLabel>
            <Input
              className="field-touch h-8 w-40"
              id={`${id}-from`}
              max={range.to}
              onChange={(event) => setDay("from", event.target.value)}
              type="date"
              value={range.from}
            />
          </Field>
          <Field className="w-auto">
            <FieldLabel htmlFor={`${id}-to`}>{t("stats.range.to")}</FieldLabel>
            <Input
              className="field-touch h-8 w-40"
              id={`${id}-to`}
              max={today}
              min={range.from}
              onChange={(event) => setDay("to", event.target.value)}
              type="date"
              value={range.to}
            />
          </Field>
        </>
      ) : (
        <p
          className="type-caption pb-1.5 text-muted-foreground"
          suppressHydrationWarning
        >
          {t("stats.range.span", {
            from: formatDate(dayStartMs(range.from), locale),
            to: formatDate(dayStartMs(range.to), locale),
          })}
        </p>
      )}
    </div>
  );
}
