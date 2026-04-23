import type { ReactNode } from "react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { MonthPicker } from "./month-picker";

interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  error?: string;
  onBlur?: () => void;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  step?: string | number;
  min?: string | number;
  max?: string | number;
}

export function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  error,
  onBlur,
  disabled,
  multiline,
  rows = 2,
  step,
  min,
  max,
}: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {multiline ? (
        <Textarea
          disabled={disabled}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          value={value}
        />
      ) : type === "month" ? (
        <MonthPicker disabled={disabled} onChange={onChange} value={value} />
      ) : (
        <Input
          aria-invalid={!!error}
          disabled={disabled}
          max={max}
          min={min}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          step={step}
          type={type}
          value={value}
        />
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

interface FormFieldCustomProps {
  label: string;
  error?: string;
  children: ReactNode;
}

export function FormFieldCustom({
  label,
  error,
  children,
}: FormFieldCustomProps) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
