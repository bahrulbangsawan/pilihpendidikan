import { cn } from "@rulisme/ui/lib/utils";
import { Button } from "@rulisme/ui/ui/button";
import { Calendar } from "@rulisme/ui/ui/calendar";
import { Label } from "@rulisme/ui/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rulisme/ui/ui/popover";
import { format, parse } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { useState } from "react";
import { formatInvoiceDate } from "@/components/invoice-form-utils";

const DATE_FORMATS = ["dd MMM yyyy", "yyyy-MM-dd", "dd-MM-yyyy", "MM/dd/yyyy"];

function parseDate(str: string): Date | undefined {
  if (!str) {
    return undefined;
  }
  for (const fmt of DATE_FORMATS) {
    try {
      const d = parse(str, fmt, new Date());
      if (!Number.isNaN(d.getTime())) {
        return d;
      }
    } catch {
      /* continue */
    }
  }
  return undefined;
}

interface DatePickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function DatePicker({
  label,
  value,
  onChange,
  disabled,
  placeholder = "Select date...",
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(() => parseDate(value));

  function handleOpenChange(isOpen: boolean) {
    if (isOpen) {
      setDate(parseDate(value));
    }
    setOpen(isOpen);
  }

  function handleSelect(selected: Date | undefined) {
    if (!selected) {
      return;
    }
    setDate(selected);
    // Persist canonical ISO (yyyy-MM-dd); the display below renders it friendly.
    // Keeps app-written dates compatible with the mcp isoDateField tools. [defect-1]
    onChange(format(selected, "yyyy-MM-dd"));
    setOpen(false);
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Popover onOpenChange={handleOpenChange} open={open}>
        <PopoverTrigger asChild>
          <Button
            className={cn(
              "w-full justify-start",
              !value && "text-muted-foreground"
            )}
            disabled={disabled}
            variant="outline"
          >
            <CalendarIcon
              aria-hidden="true"
              className="text-muted-foreground"
              data-icon="inline-start"
            />
            <span className="truncate">
              {value ? formatInvoiceDate(value) : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            defaultMonth={date}
            mode="single"
            onSelect={handleSelect}
            selected={date}
            showOutsideDays
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
