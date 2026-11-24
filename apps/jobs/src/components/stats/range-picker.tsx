// The Stats date range (12 §9 "A date range picker sits in the toolbar
// band"): the shared DateRangePicker with the presets (last 30 / 90 days,
// this year, all time) beside a calendar for a custom range. The range lives
// in the URL as a preset or custom from / to days; a picked range that equals
// a preset is stored as that preset.

import { DateRangePicker } from "@rulisme/ui/ui/date-picker";
import { Field, FieldLabel } from "@rulisme/ui/ui/field";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { formatDate } from "@/lib/format";
import type {
  RangePreset,
  ResolvedRange,
  StatsSearch,
} from "@/lib/stats-range";
import {
  ALL_TIME_FROM,
  dayStartMs,
  RANGE_PRESETS,
  resolveRange,
} from "@/lib/stats-range";

const NOON_MS = 12 * 60 * 60 * 1000;

type FixedPreset = Exclude<RangePreset, "custom">;

const FIXED_PRESETS = RANGE_PRESETS.filter(
  (preset): preset is FixedPreset => preset !== "custom"
);

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
  // Dates format in the browser's locale and time zone, which the server
  // cannot know: the first render shows only the preset name so SSR and
  // hydration agree, then the days appear.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const presets = useMemo(() => {
    const nowMs = dayStartMs(today) + NOON_MS;
    return FIXED_PRESETS.map((preset) => {
      const resolved = resolveRange({ range: preset }, nowMs);
      return {
        preset,
        label: t(`stats.range.presets.${preset}`),
        value: { from: resolved.from, to: resolved.to },
      };
    });
  }, [today, t]);

  function choose(value: { from: string; to: string } | undefined) {
    if (!value) {
      onChange({ range: undefined, from: undefined, to: undefined });
      return;
    }
    const match = presets.find(
      (entry) => entry.value.from === value.from && entry.value.to === value.to
    );
    if (match) {
      onChange({ range: match.preset, from: undefined, to: undefined });
      return;
    }
    onChange({ range: "custom", from: value.from, to: value.to });
  }

  function label(value: { from: string; to: string }): string {
    const preset =
      range.preset === "custom"
        ? undefined
        : presets.find((entry) => entry.preset === range.preset);
    if (!mounted) {
      return preset?.label ?? t("stats.range.presets.custom");
    }
    const span = t("stats.range.span", {
      from: formatDate(dayStartMs(value.from), locale),
      to: formatDate(dayStartMs(value.to), locale),
    });
    return preset ? `${preset.label} · ${span}` : span;
  }

  return (
    <Field className="w-auto">
      <FieldLabel htmlFor={`${id}-range`}>{t("stats.range.label")}</FieldLabel>
      <DateRangePicker
        className="w-auto min-w-72"
        clearable={false}
        formatValue={label}
        id={`${id}-range`}
        max={today}
        min={ALL_TIME_FROM}
        onValueChange={choose}
        presets={presets.map(({ label: text, value }) => ({
          label: text,
          value,
        }))}
        presetsLabel={t("stats.range.presetsLabel")}
        size="sm"
        value={{ from: range.from, to: range.to }}
      />
    </Field>
  );
}
