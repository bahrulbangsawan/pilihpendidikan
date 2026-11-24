import {
  CalendarIcon,
  CalendarRangeIcon,
  ClockIcon,
  XIcon,
} from "lucide-react";
import type * as React from "react";
import { useId, useState } from "react";
import type { DateRange as DayPickerRange, Matcher } from "react-day-picker";
import { useIsMobile } from "../hooks/use-mobile";
import {
  addDaysIso,
  endOfMonthIso,
  formatIsoDate,
  isoToday,
  parseIsoDate,
  startOfMonthIso,
  toIsoDate,
} from "../lib/iso-date";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { FieldButton } from "./field-button";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

// Date pickers (reui's date selector in the Cursor style): the trigger is the
// cursor.com field (36px, 32px at `sm`, 8px corners, a 10% border that
// deepens on hover) led by a calendar icon, with a round clear button at the
// end once a value is set. The flyout holds an optional presets column
// (`row` buttons, the chosen one on `pane-2`) beside the Calendar; the range
// picker shows two months (one on phones).
//
// Values are local ISO strings, never `Date`s: `YYYY-MM-DD`, or
// `YYYY-MM-DDTHH:mm` when `withTime` is set. An empty string means no date.
// `min` / `max` are `YYYY-MM-DD` too. `lib/iso-date` converts both ways.

export interface DatePreset {
  label: string;
  /** `YYYY-MM-DD`. */
  value: string;
}

export interface DateRangeValue {
  /** `YYYY-MM-DD`. */
  from: string;
  /** `YYYY-MM-DD`, on or after `from`. */
  to: string;
}

export interface DateRangePreset {
  label: string;
  value: DateRangeValue;
}

/** Today, tomorrow and a week out, computed when called. Pass translated labels. */
export function defaultDatePresets(
  labels: { today: string; tomorrow: string; inAWeek: string } = {
    today: "Today",
    tomorrow: "Tomorrow",
    inAWeek: "In a week",
  }
): DatePreset[] {
  const today = isoToday();
  return [
    { label: labels.today, value: today },
    { label: labels.tomorrow, value: addDaysIso(today, 1) },
    { label: labels.inAWeek, value: addDaysIso(today, 7) },
  ];
}

/** The usual look-back ranges, ending today, computed when called. */
export function defaultDateRangePresets(
  labels: {
    last7Days: string;
    last30Days: string;
    thisMonth: string;
    lastMonth: string;
    thisYear: string;
  } = {
    last7Days: "Last 7 days",
    last30Days: "Last 30 days",
    thisMonth: "This month",
    lastMonth: "Last month",
    thisYear: "This year",
  }
): DateRangePreset[] {
  const today = isoToday();
  return [
    {
      label: labels.last7Days,
      value: { from: addDaysIso(today, -6), to: today },
    },
    {
      label: labels.last30Days,
      value: { from: addDaysIso(today, -29), to: today },
    },
    {
      label: labels.thisMonth,
      value: { from: startOfMonthIso(today), to: endOfMonthIso(today) },
    },
    {
      label: labels.lastMonth,
      value: { from: startOfMonthIso(today, -1), to: endOfMonthIso(today, -1) },
    },
    {
      label: labels.thisYear,
      value: {
        from: `${today.slice(0, 4)}-01-01`,
        to: `${today.slice(0, 4)}-12-31`,
      },
    },
  ];
}

interface PickerTriggerProps {
  /** Which edge of the trigger the flyout lines up with. Default "start". */
  align?: "start" | "center" | "end";
  id?: string;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
}

function boundsMatchers(min?: string, max?: string): Matcher[] {
  const matchers: Matcher[] = [];
  const minDate = parseIsoDate(min);
  const maxDate = parseIsoDate(max);
  if (minDate) {
    matchers.push({ before: minDate });
  }
  if (maxDate) {
    matchers.push({ after: maxDate });
  }
  return matchers;
}

function inBounds(iso: string, min?: string, max?: string): boolean {
  const day = iso.slice(0, 10);
  return !((min && day < min) || (max && day > max));
}

// The field-shaped trigger plus the clear button that sits over its end.
function PickerField({
  icon,
  display,
  placeholder,
  empty,
  clearable,
  clearLabel,
  onClear,
  triggerProps,
}: {
  icon: React.ReactNode;
  display: string;
  placeholder: string;
  empty: boolean;
  clearable: boolean;
  clearLabel: string;
  onClear: () => void;
  triggerProps: PickerTriggerProps;
}) {
  const { className, size = "default", align: _align, ...rest } = triggerProps;
  const showClear = clearable && !empty && !rest.disabled;
  return (
    // With a mouse the clear × shows only while the field is hovered or holds
    // focus (it stays a tab stop, so the keyboard still reaches it); touch
    // screens always show it.
    <div
      className={cn("group/date-picker relative w-full", className)}
      data-slot="date-picker"
    >
      <PopoverTrigger asChild>
        <FieldButton
          className={cn(showClear && "pr-9")}
          data-slot="date-picker-trigger"
          empty={empty}
          size={size}
          {...rest}
        >
          {icon}
          {/* Dates format in the viewer's locale and zone, which the server
              cannot know: the text may differ between SSR and hydration. */}
          <span className="min-w-0 flex-1 truncate" suppressHydrationWarning>
            {empty ? placeholder : display}
          </span>
        </FieldButton>
      </PopoverTrigger>
      {showClear ? (
        <Button
          aria-label={clearLabel}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground pointer-fine:opacity-0 hover:text-foreground pointer-fine:group-focus-within/date-picker:opacity-100 pointer-fine:group-hover/date-picker:opacity-100"
          data-slot="date-picker-clear"
          onClick={onClear}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

function PresetColumn({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <fieldset
      aria-label={label}
      className="m-0 flex min-w-36 flex-col gap-0.5 border-border border-b p-1.5 sm:border-r sm:border-b-0"
      data-slot="date-picker-presets"
    >
      {children}
    </fieldset>
  );
}

type DatePickerProps = PickerTriggerProps & {
  /** `YYYY-MM-DD` (`YYYY-MM-DDTHH:mm` with `withTime`); "" or undefined = none. */
  value?: string;
  /** Called with the new ISO value, or "" when cleared. */
  onValueChange?: (value: string) => void;
  /** Adds a time field under the calendar; values become `YYYY-MM-DDTHH:mm`. */
  withTime?: boolean;
  /** Time used when a day is picked before any time is set. */
  defaultTime?: string;
  /** Earliest selectable day, `YYYY-MM-DD`. */
  min?: string;
  /** Latest selectable day, `YYYY-MM-DD`. */
  max?: string;
  /** Shortcuts shown beside the calendar (see `defaultDatePresets`). */
  presets?: DatePreset[];
  placeholder?: string;
  /** Shows the clear button once a value is set. Default true. */
  clearable?: boolean;
  clearLabel?: string;
  presetsLabel?: string;
  timeLabel?: string;
  /** BCP 47 locale for the trigger text (the calendar keeps its own). */
  locale?: string;
  /** Overrides the trigger text for a value. */
  formatValue?: (value: string) => string;
  /** Submits the ISO value with a form. */
  name?: string;
};

function DatePicker({
  value = "",
  onValueChange,
  withTime = false,
  defaultTime = "09:00",
  min,
  max,
  presets,
  placeholder = withTime ? "Pick a date and time" : "Pick a date",
  clearable = true,
  clearLabel = "Clear date",
  presetsLabel = "Presets",
  timeLabel = "Time",
  locale,
  formatValue,
  name,
  ...triggerProps
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const timeId = useId();
  const selected = parseIsoDate(value);
  const time =
    withTime && value.length >= 16 ? value.slice(11, 16) : defaultTime;
  const emit = (next: string) => onValueChange?.(next);

  function pickDay(day: Date | undefined) {
    if (!day) {
      return;
    }
    const iso = toIsoDate(day);
    emit(withTime ? `${iso}T${time}` : iso);
    if (!withTime) {
      setOpen(false);
    }
  }

  function pickPreset(iso: string) {
    emit(withTime ? `${iso}T${time}` : iso);
    if (!withTime) {
      setOpen(false);
    }
  }

  function changeTime(next: string) {
    if (!next) {
      return;
    }
    emit(`${value ? value.slice(0, 10) : isoToday()}T${next}`);
  }

  const display = value
    ? (formatValue?.(value) ?? formatIsoDate(value, locale, withTime))
    : "";
  const today = new Date();
  const fallbackMonth =
    max && toIsoDate(today) > max ? parseIsoDate(max) : today;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PickerField
        clearable={clearable}
        clearLabel={clearLabel}
        display={display}
        empty={!selected}
        icon={<CalendarIcon aria-hidden="true" />}
        onClear={() => emit("")}
        placeholder={placeholder}
        triggerProps={triggerProps}
      />
      {name ? <input name={name} type="hidden" value={value} /> : null}
      <PopoverContent
        align={triggerProps.align ?? "start"}
        className="w-auto gap-0 p-0"
        collisionPadding={16}
        data-slot="date-picker-content"
      >
        <div className="flex flex-col sm:flex-row">
          {presets?.length ? (
            <PresetColumn label={presetsLabel}>
              {presets.map((preset) => (
                <Button
                  aria-pressed={value.slice(0, 10) === preset.value}
                  disabled={!inBounds(preset.value, min, max)}
                  key={preset.label}
                  onClick={() => pickPreset(preset.value)}
                  size="sm"
                  variant="row"
                >
                  {preset.label}
                </Button>
              ))}
            </PresetColumn>
          ) : null}
          <div className="flex flex-col">
            <Calendar
              defaultMonth={selected ?? fallbackMonth}
              disabled={boundsMatchers(min, max)}
              mode="single"
              onSelect={pickDay}
              selected={selected}
            />
            {withTime ? (
              <div className="flex items-center gap-2 border-border border-t px-3 py-2.5">
                <ClockIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-ink-sec"
                />
                <label
                  className="type-caption text-muted-foreground"
                  htmlFor={timeId}
                >
                  {timeLabel}
                </label>
                <Input
                  className="ml-auto h-8 w-28"
                  data-slot="date-picker-time"
                  id={timeId}
                  onChange={(event) => changeTime(event.target.value)}
                  type="time"
                  value={time}
                />
              </div>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type DateRangePickerProps = PickerTriggerProps & {
  /** `{ from, to }` as `YYYY-MM-DD`; undefined = no range. */
  value?: Partial<DateRangeValue>;
  /** Called with a complete range (`from` ≤ `to`), or undefined when cleared. */
  onValueChange?: (value: DateRangeValue | undefined) => void;
  min?: string;
  max?: string;
  /** Shortcuts shown beside the calendar (see `defaultDateRangePresets`). */
  presets?: DateRangePreset[];
  /** Months shown side by side on wider screens. Default 2 (1 on phones). */
  numberOfMonths?: number;
  placeholder?: string;
  clearable?: boolean;
  clearLabel?: string;
  presetsLabel?: string;
  locale?: string;
  /** Overrides the trigger text for a range. */
  formatValue?: (value: DateRangeValue) => string;
};

function toDayPickerRange(
  value: Partial<DateRangeValue> | undefined
): DayPickerRange | undefined {
  const from = parseIsoDate(value?.from);
  if (!from) {
    return;
  }
  return { from, to: parseIsoDate(value?.to) ?? from };
}

function DateRangePicker({
  value,
  onValueChange,
  min,
  max,
  presets,
  numberOfMonths = 2,
  placeholder = "Pick a date range",
  clearable = true,
  clearLabel = "Clear dates",
  presetsLabel = "Presets",
  locale,
  formatValue,
  ...triggerProps
}: DateRangePickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DayPickerRange | undefined>(() =>
    toDayPickerRange(value)
  );

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft(toDayPickerRange(value));
    }
    setOpen(next);
  }

  function handleSelect(range: DayPickerRange | undefined) {
    setDraft(range);
    if (range?.from && range.to) {
      const a = toIsoDate(range.from);
      const b = toIsoDate(range.to);
      onValueChange?.(a <= b ? { from: a, to: b } : { from: b, to: a });
    }
  }

  function pickPreset(preset: DateRangeValue) {
    onValueChange?.(preset);
    setOpen(false);
  }

  const complete =
    value?.from && value.to ? { from: value.from, to: value.to } : undefined;
  let display = "";
  if (complete) {
    display =
      formatValue?.(complete) ??
      (complete.from === complete.to
        ? formatIsoDate(complete.from, locale)
        : `${formatIsoDate(complete.from, locale)} – ${formatIsoDate(complete.to, locale)}`);
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PickerField
        clearable={clearable}
        clearLabel={clearLabel}
        display={display}
        empty={!complete}
        icon={<CalendarRangeIcon aria-hidden="true" />}
        onClear={() => onValueChange?.(undefined)}
        placeholder={placeholder}
        triggerProps={triggerProps}
      />
      <PopoverContent
        align={triggerProps.align ?? "start"}
        className="w-auto gap-0 p-0"
        collisionPadding={16}
        data-slot="date-range-picker-content"
      >
        <div className="flex flex-col sm:flex-row">
          {presets?.length ? (
            <PresetColumn label={presetsLabel}>
              {presets.map((preset) => (
                <Button
                  aria-pressed={
                    complete?.from === preset.value.from &&
                    complete?.to === preset.value.to
                  }
                  disabled={
                    !(
                      inBounds(preset.value.from, min, max) &&
                      inBounds(preset.value.to, min, max)
                    )
                  }
                  key={preset.label}
                  onClick={() => pickPreset(preset.value)}
                  size="sm"
                  variant="row"
                >
                  {preset.label}
                </Button>
              ))}
            </PresetColumn>
          ) : null}
          <Calendar
            defaultMonth={draft?.from}
            disabled={boundsMatchers(min, max)}
            mode="range"
            numberOfMonths={isMobile ? 1 : numberOfMonths}
            onSelect={handleSelect}
            selected={draft}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker, DateRangePicker };
export type { DatePickerProps, DateRangePickerProps };
