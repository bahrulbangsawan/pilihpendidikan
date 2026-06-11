import { cn } from "@rulisme/ui/lib/utils"
import { Button } from "@rulisme/ui/ui/button"
import { Calendar } from "@rulisme/ui/ui/calendar"
import { Label } from "@rulisme/ui/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@rulisme/ui/ui/popover"
import { format, isBefore, parse } from "date-fns"
import { CalendarRange } from "lucide-react"
import { useState } from "react"
import type { DateRange } from "react-day-picker"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTranslation } from "@/i18n"

const DATE_FORMATS = [
  "dd MMM yyyy",
  "dd-MM-yyyy",
  "MMM d, yyyy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
]

function tryParseDate(str: string): Date | undefined {
  for (const fmt of DATE_FORMATS) {
    try {
      const d = parse(str, fmt, new Date())
      if (!isNaN(d.getTime())) {
        return d
      }
    } catch {
      /* continue */
    }
  }
  return undefined
}

function parsePeriodString(period: string): DateRange | undefined {
  if (!period) {
    return undefined
  }
  // Try as range first
  const separators = [" – ", "–", " - "]
  for (const sep of separators) {
    const idx = period.indexOf(sep)
    if (idx === -1) {
      continue
    }
    const from = tryParseDate(period.slice(0, idx).trim())
    const to = tryParseDate(period.slice(idx + sep.length).trim())
    if (from && to) {
      return { from, to }
    }
  }
  // Try as single date
  const single = tryParseDate(period.trim())
  if (single) {
    return { from: single, to: single }
  }
  return undefined
}

function formatRange(range: DateRange): string {
  if (!range.from) {
    return ""
  }
  if (!range.to || range.from.getTime() === range.to.getTime()) {
    return format(range.from, "dd MMM yyyy")
  }
  return `${format(range.from, "dd MMM yyyy")}–${format(range.to, "dd MMM yyyy")}`
}

interface PeriodRangePickerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

export function PeriodRangePicker({
  value,
  onChange,
  disabled,
  className,
}: PeriodRangePickerProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<DateRange | undefined>(() =>
    parsePeriodString(value)
  )

  function handleOpenChange(isOpen: boolean) {
    if (isOpen) {
      setRange(parsePeriodString(value))
    } else if (range?.from) {
      // Commit single date or range when closing
      onChange(formatRange(range))
    }
    setOpen(isOpen)
  }

  function handleSelect(selected: DateRange | undefined) {
    if (!selected) {
      return
    }
    setRange(selected)
    if (selected.from && selected.to) {
      const [from, to] = isBefore(selected.from, selected.to)
        ? [selected.from, selected.to]
        : [selected.to, selected.from]
      onChange(formatRange({ from, to }))
    }
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{t("form.period")}</Label>
      <Popover onOpenChange={handleOpenChange} open={open}>
        <PopoverTrigger asChild>
          <Button
            className={cn(
              "h-8 w-full justify-start border-input bg-input/20 px-2.5 text-left text-xs font-normal dark:bg-input/30",
              !value && "text-muted-foreground"
            )}
            disabled={disabled}
            variant="outline"
          >
            <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {value || t("placeholders.selectPeriod")}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            defaultMonth={range?.from}
            mode="range"
            numberOfMonths={isMobile ? 1 : 2}
            onSelect={handleSelect}
            selected={range}
            showOutsideDays
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
