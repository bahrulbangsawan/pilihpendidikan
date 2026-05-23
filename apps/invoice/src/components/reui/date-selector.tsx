"use client";

import { cn } from "@rulisme/ui/lib/utils";
import { Button } from "@rulisme/ui/ui/button";
import { Calendar, CalendarDayButton } from "@rulisme/ui/ui/calendar";
import { Input } from "@rulisme/ui/ui/input";
import { ScrollArea } from "@rulisme/ui/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@rulisme/ui/ui/tabs";
import {
  addMonths,
  format,
  isBefore,
  isSameMonth,
  parse,
  subMonths,
} from "date-fns";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CornerUpLeftIcon,
  CornerUpRightIcon,
  XIcon,
} from "lucide-react";
import type { ChangeEvent, ComponentProps } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { DateRange, DayButton } from "react-day-picker";
import { useIsMobile } from "@/hooks/use-mobile";

export interface DateSelectorI18nConfig {
  // Labels
  selectDate: string;
  apply: string;
  cancel: string;
  clear: string;
  today: string;
  // Filter types
  filterTypes: {
    is: string;
    before: string;
    after: string;
    between: string;
  };
  // Period types
  periodTypes: {
    day: string;
    month: string;
    quarter: string;
    halfYear: string;
    year: string;
  };
  // Months
  months: Array<string>;
  monthsShort: Array<string>;
  // Quarters
  quarters: Array<string>;
  // Half years
  halfYears: Array<string>;
  // Weekdays
  weekdays: Array<string>;
  weekdaysShort: Array<string>;
  // Placeholders
  placeholder: string;
  rangePlaceholder: string;
}

export const DEFAULT_DATE_SELECTOR_I18N: DateSelectorI18nConfig = {
  selectDate: "Select date",
  apply: "Apply",
  cancel: "Cancel",
  clear: "Clear",
  today: "Today",
  filterTypes: {
    is: "is",
    before: "before",
    after: "after",
    between: "between",
  },
  periodTypes: {
    day: "Day",
    month: "Month",
    quarter: "Quarter",
    halfYear: "Half-year",
    year: "Year",
  },
  months: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  monthsShort: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ],
  quarters: ["Q1", "Q2", "Q3", "Q4"],
  halfYears: ["H1", "H2"],
  weekdays: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],
  weekdaysShort: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  placeholder: "Select date...",
  rangePlaceholder: "Select date range...",
};

export type DateSelectorPeriodType =
  | "day"
  | "month"
  | "quarter"
  | "half-year"
  | "year";
export type DateSelectorFilterType = "is" | "before" | "after" | "between";

export interface DateSelectorValue {
  period: DateSelectorPeriodType;
  operator: DateSelectorFilterType;
  startDate?: Date;
  endDate?: Date;
  year?: number;
  month?: number;
  quarter?: number;
  halfYear?: number;
  rangeStart?: { year: number; value: number };
  rangeEnd?: { year: number; value: number };
}

export interface DateSelectorContextValue {
  i18n: DateSelectorI18nConfig;
  variant: "outline" | "default";
  size: "sm" | "default" | "lg";
}

const DateSelectorContext = createContext<DateSelectorContextValue>({
  i18n: DEFAULT_DATE_SELECTOR_I18N,
  variant: "outline",
  size: "default",
});

export const useDateSelectorContext = () => useContext(DateSelectorContext);

export function formatDateValue(
  value: DateSelectorValue,
  i18n: DateSelectorI18nConfig = DEFAULT_DATE_SELECTOR_I18N,
  dayDateFormat = "MM/dd/yyyy"
): string {
  const {
    period,
    startDate,
    endDate,
    year,
    month,
    quarter,
    halfYear,
    rangeStart,
    rangeEnd,
  } = value;

  if (period === "day") {
    if (startDate && endDate) {
      return `${format(startDate, dayDateFormat)} - ${format(endDate, dayDateFormat)}`;
    }
    if (startDate) {
      return format(startDate, dayDateFormat);
    }
    return "";
  }

  if (period === "month") {
    if (rangeStart && rangeEnd) {
      return `${i18n.monthsShort[rangeStart.value]} ${rangeStart.year} - ${i18n.monthsShort[rangeEnd.value]} ${rangeEnd.year}`;
    }
    if (year !== undefined && month !== undefined) {
      return `${i18n.monthsShort[month]} ${year}`;
    }
    return "";
  }

  if (period === "quarter") {
    if (rangeStart && rangeEnd) {
      return `${i18n.quarters[rangeStart.value]} ${rangeStart.year} - ${i18n.quarters[rangeEnd.value]} ${rangeEnd.year}`;
    }
    if (year !== undefined && quarter !== undefined) {
      return `${i18n.quarters[quarter]} ${year}`;
    }
    return "";
  }

  if (period === "half-year") {
    if (rangeStart && rangeEnd) {
      return `${i18n.halfYears[rangeStart.value]} ${rangeStart.year} - ${i18n.halfYears[rangeEnd.value]} ${rangeEnd.year}`;
    }
    if (year !== undefined && halfYear !== undefined) {
      return `${i18n.halfYears[halfYear]} ${year}`;
    }
    return "";
  }

  if (period === "year") {
    if (rangeStart && rangeEnd) {
      return `${rangeStart.year} - ${rangeEnd.year}`;
    }
    if (year !== undefined) {
      return `${year}`;
    }
    return "";
  }

  return "";
}

interface UseDateSelectorOptions {
  value?: DateSelectorValue;
  onChange?: (value: DateSelectorValue) => void;
  defaultPeriodType?: DateSelectorPeriodType;
  defaultFilterType?: DateSelectorFilterType;
  presetMode?: DateSelectorFilterType;
  allowRange?: boolean;
  yearRange?: number;
  baseYear?: number;
  minYear?: number;
  maxYear?: number;
  periodTypes?: Array<DateSelectorPeriodType>;
}

export function useDateSelector({
  value,
  onChange,
  defaultPeriodType = "day",
  defaultFilterType = "is",
  presetMode,
  allowRange = true,
  yearRange = 11,
  baseYear,
  minYear,
  maxYear,
  periodTypes,
}: UseDateSelectorOptions) {
  const currentYear = baseYear ?? new Date().getFullYear();

  const validDefaultPeriodType = useMemo(() => {
    if (!periodTypes || periodTypes.length === 0) {
      return defaultPeriodType;
    }
    if (periodTypes.includes(defaultPeriodType)) {
      return defaultPeriodType;
    }
    return periodTypes[0];
  }, [periodTypes, defaultPeriodType]);

  // Use presetMode if provided, otherwise use value or default
  const effectiveFilterType =
    presetMode ?? value?.operator ?? defaultFilterType;

  const [periodType, setPeriodType] = useState<DateSelectorPeriodType>(
    value?.period || validDefaultPeriodType
  );
  const [filterType, setFilterType] =
    useState<DateSelectorFilterType>(effectiveFilterType);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    value?.startDate
  );
  const [selectedEndDate, setSelectedEndDate] = useState<Date | undefined>(
    value?.endDate
  );
  const [calendarMonth, setCalendarMonth] = useState(
    value?.startDate || new Date()
  );
  const [selectedYear, setSelectedYear] = useState<number | undefined>(
    value?.year
  );
  const [selectedMonth, setSelectedMonth] = useState<number | undefined>(
    value?.month
  );
  const [selectedQuarter, setSelectedQuarter] = useState<number | undefined>(
    value?.quarter
  );
  const [selectedHalfYear, setSelectedHalfYear] = useState<number | undefined>(
    value?.halfYear
  );
  const [rangeStart, setRangeStart] = useState<
    { year: number; value: number } | undefined
  >(value?.rangeStart);
  const [rangeEnd, setRangeEnd] = useState<
    { year: number; value: number } | undefined
  >(value?.rangeEnd);
  const [hoverDate, setHoverDate] = useState<Date | undefined>();

  const years = useMemo(() => {
    if (minYear !== undefined && maxYear !== undefined) {
      return Array.from(
        { length: maxYear - minYear + 1 },
        (_, i) => minYear + i
      );
    }
    return Array.from(
      { length: yearRange },
      (_, i) => currentYear - Math.floor(yearRange / 2) + i
    );
  }, [currentYear, yearRange, minYear, maxYear]);

  const currentValue = useMemo<DateSelectorValue>(
    () => ({
      period: periodType,
      operator: presetMode ?? filterType,
      startDate: selectedDate,
      endDate: selectedEndDate,
      year: selectedYear,
      month: selectedMonth,
      quarter: selectedQuarter,
      halfYear: selectedHalfYear,
      rangeStart,
      rangeEnd,
    }),
    [
      periodType,
      presetMode,
      filterType,
      selectedDate,
      selectedEndDate,
      selectedYear,
      selectedMonth,
      selectedQuarter,
      selectedHalfYear,
      rangeStart,
      rangeEnd,
    ]
  );

  const clearSelection = useCallback(() => {
    setSelectedDate(undefined);
    setSelectedEndDate(undefined);
    setSelectedYear(undefined);
    setSelectedMonth(undefined);
    setSelectedQuarter(undefined);
    setSelectedHalfYear(undefined);
    setRangeStart(undefined);
    setRangeEnd(undefined);
  }, []);

  const handleDayClick = useCallback(
    (day: Date) => {
      if (filterType === "between" && allowRange) {
        if (!selectedDate || (selectedDate && selectedEndDate)) {
          setSelectedDate(day);
          setSelectedEndDate(undefined);
        } else if (isBefore(day, selectedDate)) {
          setSelectedEndDate(selectedDate);
          setSelectedDate(day);
        } else {
          setSelectedEndDate(day);
        }
      } else {
        setSelectedDate(day);
        setSelectedEndDate(undefined);
      }
    },
    [filterType, allowRange, selectedDate, selectedEndDate]
  );

  const handlePeriodSelect = useCallback(
    (year: number, value: number) => {
      if (filterType === "between" && allowRange) {
        if (!rangeStart || (rangeStart && rangeEnd)) {
          setRangeStart({ year, value });
          setRangeEnd(undefined);
          setSelectedYear(year);
          if (periodType === "month") {
            setSelectedMonth(value);
          }
          if (periodType === "quarter") {
            setSelectedQuarter(value);
          }
          if (periodType === "half-year") {
            setSelectedHalfYear(value);
          }
        } else {
          const startKey = rangeStart.year * 100 + rangeStart.value;
          const endKey = year * 100 + value;
          if (endKey < startKey) {
            setRangeEnd(rangeStart);
            setRangeStart({ year, value });
          } else {
            setRangeEnd({ year, value });
          }
        }
      } else {
        setSelectedYear(year);
        if (periodType === "month") {
          setSelectedMonth(value);
        }
        if (periodType === "quarter") {
          setSelectedQuarter(value);
        }
        if (periodType === "half-year") {
          setSelectedHalfYear(value);
        }
        setRangeStart(undefined);
        setRangeEnd(undefined);
      }
    },
    [filterType, allowRange, rangeStart, rangeEnd, periodType]
  );

  const handleYearSelect = useCallback(
    (year: number) => {
      if (filterType === "between" && allowRange) {
        if (!rangeStart || (rangeStart && rangeEnd)) {
          setRangeStart({ year, value: 0 });
          setRangeEnd(undefined);
          setSelectedYear(year);
        } else if (year < rangeStart.year) {
          setRangeEnd(rangeStart);
          setRangeStart({ year, value: 0 });
        } else {
          setRangeEnd({ year, value: 0 });
        }
      } else {
        setSelectedYear(year);
        setRangeStart(undefined);
        setRangeEnd(undefined);
      }
    },
    [filterType, allowRange, rangeStart, rangeEnd]
  );

  const handlePeriodTypeChange = useCallback(
    (type: DateSelectorPeriodType) => {
      setPeriodType(type);
      clearSelection();
    },
    [clearSelection]
  );

  const handleFilterTypeChange = useCallback(
    (type: DateSelectorFilterType) => {
      // Don't allow changes if presetMode is set
      if (presetMode !== undefined) {
        return;
      }
      setFilterType(type);
      clearSelection();
    },
    [clearSelection, presetMode]
  );

  const isInRange = useCallback(
    (year: number, value: number) => {
      if (!(rangeStart && rangeEnd)) {
        return false;
      }
      const key = year * 100 + value;
      const startKey = rangeStart.year * 100 + rangeStart.value;
      const endKey = rangeEnd.year * 100 + rangeEnd.value;
      return key >= startKey && key <= endKey;
    },
    [rangeStart, rangeEnd]
  );

  const isYearInRange = useCallback(
    (year: number) => {
      if (!(rangeStart && rangeEnd)) {
        return false;
      }
      return year >= rangeStart.year && year <= rangeEnd.year;
    },
    [rangeStart, rangeEnd]
  );

  useEffect(() => {
    if (value) {
      setPeriodType(value.period || validDefaultPeriodType);
      // Use presetMode if provided, otherwise use value's operator or default
      const newFilterType = presetMode ?? value.operator ?? defaultFilterType;
      setFilterType(newFilterType);
      setSelectedDate(value.startDate);
      setSelectedEndDate(value.endDate);
      setSelectedYear(value.year);
      setSelectedMonth(value.month);
      setSelectedQuarter(value.quarter);
      setSelectedHalfYear(value.halfYear);
      setRangeStart(value.rangeStart);
      setRangeEnd(value.rangeEnd);
    }
  }, [value, validDefaultPeriodType, defaultFilterType, presetMode]);

  // Sync filterType when presetMode changes
  useEffect(() => {
    if (presetMode !== undefined) {
      setFilterType(presetMode);
    }
  }, [presetMode]);

  useEffect(() => {
    onChange?.(currentValue);
  }, [currentValue, onChange]);

  return {
    // State
    periodType,
    filterType,
    selectedDate,
    selectedEndDate,
    calendarMonth,
    selectedYear,
    selectedMonth,
    selectedQuarter,
    selectedHalfYear,
    rangeStart,
    rangeEnd,
    hoverDate,
    years,
    currentValue,
    allowRange,

    // Setters
    setPeriodType: handlePeriodTypeChange,
    setFilterType: handleFilterTypeChange,
    setSelectedDate,
    setSelectedEndDate,
    setCalendarMonth,
    setHoverDate,

    // Actions
    clearSelection,
    handleDayClick,
    handlePeriodSelect,
    handleYearSelect,
    isInRange,
    isYearInRange,
  };
}

interface DateSelectorFilterToggleProps {
  value: DateSelectorFilterType;
  onChange: (value: DateSelectorFilterType) => void;
  showBetween?: boolean;
  showIs?: boolean;
  presetMode?: DateSelectorFilterType;
  className?: string;
}

function DateSelectorFilterToggle({
  value,
  onChange,
  showBetween = true,
  showIs = true,
  presetMode,
  className,
}: DateSelectorFilterToggleProps) {
  const { i18n } = useDateSelectorContext();
  const isDisabled = presetMode !== undefined;

  return (
    <Tabs
      className={className}
      onValueChange={(newValue) => {
        if (!isDisabled && newValue) {
          onChange(newValue as DateSelectorFilterType);
        }
      }}
      value={value}
    >
      <TabsList
        className={cn(
          "bg-muted/80",
          isDisabled && "pointer-events-none opacity-50",
          className
        )}
      >
        {showIs && (
          <TabsTrigger
            aria-label={i18n.filterTypes.is}
            className="py-1 font-normal"
            value="is"
          >
            {i18n.filterTypes.is}
          </TabsTrigger>
        )}
        <TabsTrigger
          aria-label={i18n.filterTypes.before}
          className="py-1 font-normal"
          value="before"
        >
          {i18n.filterTypes.before}
        </TabsTrigger>
        <TabsTrigger
          aria-label={i18n.filterTypes.after}
          className="py-1 font-normal"
          value="after"
        >
          {i18n.filterTypes.after}
        </TabsTrigger>
        {showBetween && (
          <TabsTrigger
            aria-label={i18n.filterTypes.between}
            className="py-1 font-normal"
            value="between"
          >
            {i18n.filterTypes.between}
          </TabsTrigger>
        )}
      </TabsList>
    </Tabs>
  );
}

interface DateSelectorDateSelectorPeriodTabsProps {
  value: DateSelectorPeriodType;
  onChange: (value: DateSelectorPeriodType) => void;
  periodTypes?: Array<DateSelectorPeriodType>;
  className?: string;
  calendarMonth?: Date;
  onMonthChange?: (date: Date) => void;
  showNavigationButtons?: boolean;
}

function DateSelectorPeriodTabs({
  value,
  onChange,
  periodTypes,
  className,
  calendarMonth,
  onMonthChange,
  showNavigationButtons = false,
}: DateSelectorDateSelectorPeriodTabsProps) {
  const { i18n } = useDateSelectorContext();

  const tabs: Array<{ value: DateSelectorPeriodType; label: string }> = [
    { value: "day", label: i18n.periodTypes.day },
    { value: "month", label: i18n.periodTypes.month },
    { value: "quarter", label: i18n.periodTypes.quarter },
    { value: "half-year", label: i18n.periodTypes.halfYear },
    { value: "year", label: i18n.periodTypes.year },
  ];

  const filteredTabs = periodTypes
    ? tabs.filter((tab) => periodTypes.includes(tab.value))
    : tabs;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className
      )}
    >
      <Tabs
        onValueChange={(newValue) => {
          if (newValue) {
            onChange(newValue as DateSelectorPeriodType);
          }
        }}
        value={value}
      >
        <TabsList>
          {filteredTabs.map((tab) => (
            <TabsTrigger
              aria-label={tab.label}
              className="px-1 py-1 font-normal sm:px-2.5"
              key={tab.value}
              value={tab.value}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {showNavigationButtons &&
        value === "day" &&
        calendarMonth &&
        onMonthChange && (
          <div className="flex items-center">
            {(() => {
              const today = new Date();
              const isCurrentMonth = isSameMonth(calendarMonth, today);

              // Only show today button if not on current month
              if (isCurrentMonth) {
                return null;
              }

              // Determine direction based on whether calendarMonth is in future or past
              const isFuture = calendarMonth > today;

              return (
                <Button
                  className="size-8.5"
                  onClick={() => onMonthChange(new Date())}
                  title={i18n.today}
                  variant="ghost"
                >
                  {isFuture ? <CornerUpLeftIcon /> : <CornerUpRightIcon />}
                </Button>
              );
            })()}
            <Button
              className="size-8.5"
              onClick={() => onMonthChange(subMonths(calendarMonth, 1))}
              variant="ghost"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              className="size-8.5"
              onClick={() => onMonthChange(addMonths(calendarMonth, 1))}
              variant="ghost"
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        )}
    </div>
  );
}

interface DateSelectorDayPickerProps {
  currentMonth: Date;
  selectedDate?: Date;
  selectedEndDate?: Date;
  onDayClick: (day: Date) => void;
  isRange: boolean;
  onDayHover?: (day: Date | undefined) => void;
  hoverDate?: Date;
  showTwoMonths?: boolean;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
}

function DateSelectorDayPicker({
  currentMonth,
  selectedDate,
  selectedEndDate,
  onDayClick,
  isRange,
  onDayHover,
  hoverDate,
  showTwoMonths = true,
  weekStartsOn,
  className,
}: DateSelectorDayPickerProps) {
  const { i18n } = useDateSelectorContext();
  const isMobile = useIsMobile();

  // Convert to react-day-picker format
  const selected: Date | DateRange | undefined = isRange
    ? selectedDate && selectedEndDate
      ? { from: selectedDate, to: selectedEndDate }
      : selectedDate
        ? { from: selectedDate, to: hoverDate || selectedDate }
        : undefined
    : selectedDate;

  const handleSelect = (date: Date | DateRange | undefined) => {
    if (!date) {
      return;
    }

    if (isRange && "from" in date) {
      // For range mode
      if (date.from && !date.to) {
        // First click - set start date
        onDayClick(date.from);
      } else if (date.from && date.to) {
        // Range selected - set end date
        onDayClick(date.to);
      }
    } else if (!isRange && date instanceof Date) {
      onDayClick(date);
    }
  };

  // Create custom DayButton component with hover support
  const CustomDayButton = useCallback(
    (props: ComponentProps<typeof DayButton>) => {
      return (
        <CalendarDayButton
          {...props}
          onMouseEnter={() => {
            if (isRange && onDayHover && props.day) {
              onDayHover(props.day.date);
            }
          }}
          onMouseLeave={() => {
            if (isRange && onDayHover) {
              onDayHover(undefined);
            }
          }}
        />
      );
    },
    [isRange, onDayHover]
  );

  // Create custom formatters for i18n
  const formatters = {
    formatWeekdayName: (date: Date) => {
      const dayIndex = date.getDay();
      return i18n.weekdaysShort[dayIndex] || i18n.weekdays[dayIndex];
    },
    formatMonthCaption: (date: Date) => {
      const monthIndex = date.getMonth();
      const year = date.getFullYear();
      return `${i18n.months[monthIndex]} ${year}`;
    },
  };

  return (
    <div className={cn("flex w-full items-center justify-between", className)}>
      {isRange ? (
        <Calendar
          className="w-full shrink-0 p-0"
          classNames={{
            months: "flex flex-wrap items-start justify-between gap-5 w-full",
            month: "flex flex-col items-center min-w-0 flex-1",
            nav: "hidden",
          }}
          components={{
            DayButton: CustomDayButton,
          }}
          formatters={formatters}
          mode="range"
          month={currentMonth}
          numberOfMonths={isMobile ? 1 : showTwoMonths ? 2 : 1}
          onSelect={handleSelect}
          selected={selected as DateRange | undefined}
          showOutsideDays={true}
          weekStartsOn={weekStartsOn}
        />
      ) : (
        <Calendar
          className="w-full shrink-0 p-0"
          classNames={{
            months: "flex flex-wrap items-start justify-between gap-5 w-full",
            month: "flex flex-col items-center min-w-0 flex-1",
            nav: "hidden",
          }}
          components={{
            DayButton: CustomDayButton,
          }}
          formatters={formatters}
          mode="single"
          month={currentMonth}
          numberOfMonths={isMobile ? 1 : showTwoMonths ? 2 : 1}
          onSelect={handleSelect}
          selected={selected as Date | undefined}
          showOutsideDays={true}
          weekStartsOn={weekStartsOn}
        />
      )}
    </div>
  );
}

interface DateSelectorDateSelectorPeriodGridProps {
  years: Array<number>;
  items: Array<string>;
  selectedYear?: number;
  selectedValue?: number;
  rangeStart?: { year: number; value: number };
  rangeEnd?: { year: number; value: number };
  isInRange: (year: number, value: number) => boolean;
  onSelect: (year: number, value: number) => void;
  columns: number;
  className?: string;
}

function DateSelectorPeriodGrid({
  years,
  items,
  selectedYear,
  selectedValue,
  rangeStart,
  rangeEnd,
  isInRange,
  onSelect,
  columns,
  className,
}: DateSelectorDateSelectorPeriodGridProps) {
  return (
    <div className={cn("w-full space-y-6", className)}>
      {years.map((year) => (
        <div key={year}>
          <div className="mb-3 font-medium text-muted-foreground text-sm">
            {year}
          </div>
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {items.map((item, index) => {
              const isSelected =
                selectedYear === year && selectedValue === index;
              const isRangeStart =
                rangeStart?.year === year && rangeStart?.value === index;
              const isRangeEnd =
                rangeEnd?.year === year && rangeEnd?.value === index;
              const inRange = isInRange(year, index);

              return (
                <Button
                  className={cn(
                    inRange &&
                      !isSelected &&
                      !isRangeStart &&
                      !isRangeEnd &&
                      "bg-accent dark:bg-accent/60"
                  )}
                  key={item}
                  onClick={() => onSelect(year, index)}
                  size="sm"
                  variant={
                    isSelected || isRangeStart || isRangeEnd
                      ? "default"
                      : "outline"
                  }
                >
                  {item}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

interface DateSelectorYearListProps {
  years: Array<number>;
  selectedYear?: number;
  rangeStart?: { year: number; value: number };
  rangeEnd?: { year: number; value: number };
  isYearInRange: (year: number) => boolean;
  onSelect: (year: number) => void;
  className?: string;
}

function DateSelectorYearList({
  years,
  selectedYear,
  rangeStart,
  rangeEnd,
  isYearInRange,
  onSelect,
  className,
}: DateSelectorYearListProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-2", className)}>
      {years.map((year) => {
        const isSelected = selectedYear === year && !rangeStart && !rangeEnd;
        const isRangeStart = rangeStart?.year === year;
        const isRangeEnd = rangeEnd?.year === year;
        const inRange = isYearInRange(year);

        return (
          <Button
            className={cn(
              inRange &&
                !isSelected &&
                !isRangeStart &&
                !isRangeEnd &&
                "bg-accent dark:bg-accent/60"
            )}
            key={year}
            onClick={() => onSelect(year)}
            size="sm"
            variant={
              isSelected || isRangeStart || isRangeEnd ? "default" : "outline"
            }
          >
            {year}
          </Button>
        );
      })}
    </div>
  );
}

export interface DateSelectorProps {
  value?: DateSelectorValue;
  onChange?: (value: DateSelectorValue) => void;
  allowRange?: boolean;
  periodTypes?: Array<DateSelectorPeriodType>;
  defaultPeriodType?: DateSelectorPeriodType;
  defaultFilterType?: DateSelectorFilterType;
  presetMode?: DateSelectorFilterType;
  showInput?: boolean;
  showTwoMonths?: boolean;
  label?: string;
  className?: string;
  yearRange?: number;
  baseYear?: number;
  minYear?: number;
  maxYear?: number;
  i18n?: Partial<DateSelectorI18nConfig>;
  inputHint?: string;
  dayDateFormat?: string;
  dayDateFormats?: Array<string>;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function DateSelector({
  value,
  onChange,
  allowRange = true,
  periodTypes,
  defaultPeriodType = "day",
  defaultFilterType = "is",
  presetMode,
  showInput = true,
  showTwoMonths = true,
  label,
  className,
  yearRange = 10,
  baseYear,
  minYear = 2015,
  maxYear = 2026,
  i18n: i18nOverride,
  inputHint,
  dayDateFormat = "MM/dd/yyyy",
  dayDateFormats,
  weekStartsOn,
}: DateSelectorProps) {
  const mergedI18n = useMemo(
    () => ({ ...DEFAULT_DATE_SELECTOR_I18N, ...i18nOverride }),
    [i18nOverride]
  );

  const selector = useDateSelector({
    value,
    onChange,
    defaultPeriodType,
    defaultFilterType,
    presetMode,
    allowRange,
    yearRange,
    baseYear,
    minYear,
    maxYear,
    periodTypes,
  });

  const {
    periodType,
    filterType,
    selectedDate,
    selectedEndDate,
    calendarMonth,
    selectedYear,
    selectedMonth,
    selectedQuarter,
    selectedHalfYear,
    rangeStart,
    rangeEnd,
    hoverDate,
    years,
    currentValue,
    setPeriodType,
    setFilterType,
    setCalendarMonth,
    setHoverDate,
    clearSelection,
    handleDayClick,
    handlePeriodSelect,
    handleYearSelect,
    isInRange,
    isYearInRange,
  } = selector;

  const displayValue = formatDateValue(currentValue, mergedI18n, dayDateFormat);
  const [inputValue, setInputValue] = useState(displayValue);
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Sync input value when displayValue changes (but not when user is typing)
  useEffect(() => {
    if (!isInputFocused) {
      setInputValue(displayValue);
    }
  }, [displayValue, isInputFocused]);

  // Compute date formats for parsing
  const dateFormats = useMemo(() => {
    if (dayDateFormats && dayDateFormats.length > 0) {
      // Use provided formats, with dayDateFormat first if not already included
      const formats = [...dayDateFormats];
      if (!formats.includes(dayDateFormat)) {
        formats.unshift(dayDateFormat);
      }
      return formats;
    }
    // Default formats: use dayDateFormat first, then common alternatives
    const defaultFormats = [
      dayDateFormat,
      "dd/MM/yyyy",
      "yyyy-MM-dd",
      "MM-dd-yyyy",
      "dd-MM-yyyy",
    ];
    // Remove duplicates while preserving order
    return Array.from(new Set(defaultFormats));
  }, [dayDateFormat, dayDateFormats]);

  // Parse input text to DateSelectorValue
  const parseInputValue = useCallback(
    (text: string): DateSelectorValue | null => {
      if (!text.trim()) {
        return null;
      }

      const trimmed = text.trim();

      // Try parsing as year (e.g., "2025")
      const yearMatch = trimmed.match(/^\d{4}$/);
      if (yearMatch) {
        const year = Number.parseInt(yearMatch[0]);
        if (year >= 1900 && year <= 2100) {
          return {
            period: "year",
            operator: presetMode ?? filterType,
            year,
          };
        }
      }

      // Try parsing as quarter (e.g., "Q4", "Q1 2025")
      const quarterMatch = trimmed.match(/^Q([1-4])(?:\s+(\d{4}))?$/i);
      if (quarterMatch) {
        const quarter = Number.parseInt(quarterMatch[1]) - 1;
        const year = quarterMatch[2]
          ? Number.parseInt(quarterMatch[2])
          : new Date().getFullYear();
        if (year >= 1900 && year <= 2100) {
          return {
            period: "quarter",
            operator: presetMode ?? filterType,
            year,
            quarter,
          };
        }
      }

      // Try parsing as date using computed formats
      for (const dateFormat of dateFormats) {
        try {
          const parsed = parse(trimmed, dateFormat, new Date());
          if (!isNaN(parsed.getTime())) {
            return {
              period: "day",
              operator: presetMode ?? filterType,
              startDate: parsed,
            };
          }
        } catch {
          // Continue to next format
        }
      }

      return null;
    },
    [filterType, presetMode, dateFormats]
  );

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setInputValue(newValue);

      // Try to parse the input
      const parsed = parseInputValue(newValue);
      if (parsed) {
        onChange?.(parsed);
      }
    },
    [onChange, parseInputValue]
  );

  const handleInputBlur = useCallback(() => {
    setIsInputFocused(false);
    // Reset to display value if parsing failed
    if (!parseInputValue(inputValue)) {
      setInputValue(displayValue);
    }
  }, [inputValue, displayValue, parseInputValue]);

  return (
    <DateSelectorContext.Provider
      value={{ i18n: mergedI18n, variant: "outline", size: "default" }}
    >
      <div className={cn("w-full space-y-4 sm:w-[29.375rem]", className)}>
        <div className="flex flex-wrap items-center gap-3">
          {label && (
            <h3 className="font-medium text-sm" data-slot="data-selector-label">
              {label}
            </h3>
          )}
          <DateSelectorFilterToggle
            onChange={setFilterType}
            presetMode={presetMode}
            showBetween={allowRange}
            value={filterType}
          />
        </div>
        {showInput && (
          <div className="relative">
            <Input
              onBlur={handleInputBlur}
              onChange={handleInputChange}
              onFocus={() => setIsInputFocused(true)}
              placeholder={
                isInputFocused && inputHint ? inputHint : mergedI18n.placeholder
              }
              readOnly={!inputHint}
              type="text"
              value={inputHint ? inputValue : displayValue}
            />
            {(inputHint ? inputValue : displayValue) && (
              <button
                className={cn(
                  // Base Styles
                  "absolute end-2.5 top-1/2 size-4 -translate-y-1/2 cursor-pointer rounded-xs",
                  // Visual States
                  "opacity-70 transition-opacity hover:opacity-100",
                  // Focus States
                  "ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                )}
                onClick={clearSelection}
                type="button"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>
        )}
        <DateSelectorPeriodTabs
          calendarMonth={calendarMonth}
          onChange={setPeriodType}
          onMonthChange={setCalendarMonth}
          periodTypes={periodTypes}
          showNavigationButtons={periodType === "day"}
          value={periodType}
        />

        {periodType === "day" ? (
          <div className="w-full pb-1">
            <DateSelectorDayPicker
              currentMonth={calendarMonth}
              hoverDate={hoverDate}
              isRange={filterType === "between" && allowRange}
              onDayClick={handleDayClick}
              onDayHover={setHoverDate}
              selectedDate={selectedDate}
              selectedEndDate={selectedEndDate}
              showTwoMonths={showTwoMonths}
              weekStartsOn={weekStartsOn}
            />
          </div>
        ) : (
          <div className="-mr-3 w-full">
            <ScrollArea className="h-[12.5rem] w-full pe-3" key={periodType}>
              {periodType === "month" && (
                <DateSelectorPeriodGrid
                  columns={3}
                  isInRange={isInRange}
                  items={mergedI18n.monthsShort}
                  onSelect={handlePeriodSelect}
                  rangeEnd={rangeEnd}
                  rangeStart={rangeStart}
                  selectedValue={selectedMonth}
                  selectedYear={selectedYear}
                  years={years}
                />
              )}

              {periodType === "quarter" && (
                <DateSelectorPeriodGrid
                  columns={4}
                  isInRange={isInRange}
                  items={mergedI18n.quarters}
                  onSelect={handlePeriodSelect}
                  rangeEnd={rangeEnd}
                  rangeStart={rangeStart}
                  selectedValue={selectedQuarter}
                  selectedYear={selectedYear}
                  years={years}
                />
              )}

              {periodType === "half-year" && (
                <DateSelectorPeriodGrid
                  columns={2}
                  isInRange={isInRange}
                  items={mergedI18n.halfYears}
                  onSelect={handlePeriodSelect}
                  rangeEnd={rangeEnd}
                  rangeStart={rangeStart}
                  selectedValue={selectedHalfYear}
                  selectedYear={selectedYear}
                  years={years}
                />
              )}

              {periodType === "year" && (
                <DateSelectorYearList
                  isYearInRange={isYearInRange}
                  onSelect={handleYearSelect}
                  rangeEnd={rangeEnd}
                  rangeStart={rangeStart}
                  selectedYear={selectedYear}
                  years={years}
                />
              )}
            </ScrollArea>
          </div>
        )}
      </div>
    </DateSelectorContext.Provider>
  );
}
