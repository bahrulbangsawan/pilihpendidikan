import type { ReactNode } from "react";
import { useId } from "react";
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

interface FormControlIds {
  controlId: string;
  labelId: string;
  errorId?: string;
}

const NON_DIGITS = /\D+/g;

// V2.2.3 / V2.3.7 boundary guard: strip anything that is not a digit so
// non-finite tokens (NaN, Infinity, -Infinity, exponential noise) cannot
// propagate upstream when the caller will pass the value to Number().
function sanitizeNumeric(raw: string): string {
  return raw.replace(NON_DIGITS, "");
}

function FormControl(props: FormFieldProps & FormControlIds) {
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
    controlId,
    labelId,
    errorId,
  } = props;

  if (multiline) {
    return (
      <Textarea
        aria-describedby={errorId}
        aria-invalid={!!error}
        disabled={disabled}
        id={controlId}
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
        aria-labelledby={labelId}
        disabled={disabled || !onChange}
        onChange={(nextValue) => onChange?.(nextValue)}
        value={value}
      />
    );
  }

  return (
    <Input
      aria-describedby={errorId}
      aria-invalid={!!error}
      className={numeric ? "tabular-nums" : undefined}
      disabled={disabled}
      id={controlId}
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

// The builders' composed field (Zedative): a body-role label, one control and
// a caption-role error in destructive, 6px apart. The label names the control
// (or, for a month, the month/year pair) and the error describes it.
export function FormField(props: FormFieldProps) {
  const { label, error, type, multiline } = props;
  const id = useId();
  const controlId = `${id}-control`;
  const labelId = `${id}-label`;
  const errorId = error ? `${id}-error` : undefined;
  const namesOneControl = multiline || type !== "month";

  return (
    <div
      className="flex flex-col gap-1.5"
      data-invalid={error ? true : undefined}
      data-slot="form-field"
    >
      <Label htmlFor={namesOneControl ? controlId : undefined} id={labelId}>
        {label}
      </Label>
      <FormControl
        {...props}
        controlId={controlId}
        errorId={errorId}
        labelId={labelId}
      />
      {error && (
        <p className="type-caption text-destructive" id={errorId}>
          {error}
        </p>
      )}
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
    <div
      className="flex flex-col gap-1.5"
      data-invalid={error ? true : undefined}
      data-slot="form-field"
    >
      <Label>{label}</Label>
      {children}
      {error && <p className="type-caption text-destructive">{error}</p>}
    </div>
  );
}
