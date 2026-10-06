import type { ReactNode } from "react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { MonthPicker } from "./month-picker";

interface FormFieldProps {
  label: string;
  value: string;
  onChange?: (value: string) => void;
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
  numeric?: boolean;
}

// V2.2.3 / V2.3.7 boundary guard: strip anything that is not a digit so
// non-finite tokens (NaN, Infinity, -Infinity, exponential noise) cannot
// propagate upstream when the caller will pass the value to Number().
function sanitizeNumeric(raw: string): string {
  return raw.replace(/\D+/g, "");
}

function FormControl(props: FormFieldProps) {
  const {
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
    numeric,
  } = props;

  if (multiline) {
    return (
      <Textarea
        disabled={disabled}
        onBlur={onBlur}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        readOnly={!onChange}
        rows={rows}
        value={value}
      />
    );
  }

  if (type === "month") {
    return (
      <MonthPicker
        disabled={disabled || !onChange}
        onChange={(nextValue) => onChange?.(nextValue)}
        value={value}
      />
    );
  }

  return (
    <Input
      aria-invalid={!!error}
      disabled={disabled}
      inputMode={numeric ? "numeric" : undefined}
      max={max}
      min={min}
      onBlur={onBlur}
      onChange={(e) =>
        onChange?.(numeric ? sanitizeNumeric(e.target.value) : e.target.value)
      }
      pattern={numeric ? "[0-9]*" : undefined}
      placeholder={placeholder}
      readOnly={!onChange}
      step={step}
      type={type}
      value={value}
    />
  );
}

export function FormField(props: FormFieldProps) {
  const { label, error } = props;
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <FormControl {...props} />
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
