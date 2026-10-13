// The adapter config form, generated from the manifest's JSON Schema
// (src/lib/json-schema-form.ts): text and URL inputs, enum selects, boolean
// switches, integer inputs, grouped nested fields and key / value rows.

import { Button } from "@rulisme/ui/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { Switch } from "@rulisme/ui/ui/switch";
import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import type {
  FieldError as FormFieldError,
  FieldValue,
  FormErrors,
  FormField,
  FormValues,
  MapRow,
} from "@/lib/json-schema-form";
import { groupsOf } from "@/lib/json-schema-form";
import { translateOr } from "@/lib/sources-model";

const NO_VALUE = "__none";

function keyPart(path: string): string {
  return path.replaceAll(".", "_");
}

export function fieldLabel(
  t: Translate,
  adapter: string,
  field: FormField
): string {
  return translateOr(
    t,
    `sources.fields.${adapter}.${keyPart(field.path)}`,
    field.title
  );
}

function fieldHint(t: Translate, adapter: string, field: FormField): string {
  return translateOr(t, `sources.hints.${adapter}.${keyPart(field.path)}`, "");
}

export function errorText(t: Translate, error: FormFieldError): string {
  switch (error.code) {
    case "tooLong":
      return t("sources.form.errors.tooLong", { max: error.max });
    case "tooShort":
      return t("sources.form.errors.tooShort", { min: error.min });
    case "min":
      return t("sources.form.errors.min", { min: error.min });
    case "max":
      return t("sources.form.errors.max", { max: error.max });
    default:
      return t(`sources.form.errors.${error.code}`);
  }
}

function MapRows({
  id,
  rows,
  onChange,
  label,
}: {
  id: string;
  label: string;
  onChange: (rows: MapRow[]) => void;
  rows: MapRow[];
}) {
  const { t } = useTranslation();
  const update = (index: number, change: Partial<MapRow>) =>
    onChange(
      rows.map((row, at) => (at === index ? { ...row, ...change } : row))
    );
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <div
          className="flex items-center gap-2"
          key={`${id}-${index.toString()}`}
        >
          <Input
            aria-label={t("sources.form.mapKey", {
              field: label,
              n: index + 1,
            })}
            className="field-touch w-32"
            onChange={(event) => update(index, { name: event.target.value })}
            placeholder={t("sources.form.mapKeyPlaceholder")}
            value={row.name}
          />
          <Input
            aria-label={t("sources.form.mapValue", {
              field: label,
              n: index + 1,
            })}
            className="field-touch min-w-0 flex-1"
            onChange={(event) => update(index, { value: event.target.value })}
            placeholder={t("sources.form.mapValuePlaceholder")}
            value={row.value}
          />
          <Button
            aria-label={t("sources.form.mapRemove", { n: index + 1 })}
            onClick={() => onChange(rows.filter((_row, at) => at !== index))}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        className="self-start"
        onClick={() => onChange([...rows, { name: "", value: "" }])}
        size="xs"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" data-icon="inline-start" />
        {t("sources.form.mapAdd")}
      </Button>
    </div>
  );
}

interface KindProps {
  field: FormField;
  /** `aria-describedby` target when there is a help line. */
  helpId: string | undefined;
  /** The error or hint line. */
  help: ReactNode;
  id: string;
  invalid: boolean;
  label: string;
  /** The label with "(optional)" for optional fields. */
  labelText: string;
  onChange: (value: FieldValue) => void;
  value: FieldValue | undefined;
}

function BooleanField({ id, label, help, helpId, value, onChange }: KindProps) {
  return (
    <Field orientation="horizontal">
      <Switch
        aria-describedby={helpId}
        checked={value === true}
        id={id}
        onCheckedChange={(checked) => onChange(checked)}
      />
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {help}
    </Field>
  );
}

function MapField({
  id,
  label,
  labelText,
  help,
  invalid,
  value,
  onChange,
}: KindProps) {
  return (
    <FieldSet data-invalid={invalid || undefined}>
      <FieldLegend variant="label">{labelText}</FieldLegend>
      <MapRows
        id={id}
        label={label}
        onChange={onChange}
        rows={Array.isArray(value) ? value : []}
      />
      {help}
    </FieldSet>
  );
}

function EnumField({
  field,
  id,
  labelText,
  help,
  helpId,
  invalid,
  value,
  onChange,
}: KindProps) {
  const { t } = useTranslation();
  const current = typeof value === "string" && value !== "" ? value : NO_VALUE;
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{labelText}</FieldLabel>
      <Select
        onValueChange={(next) => onChange(next === NO_VALUE ? "" : next)}
        value={current}
      >
        <SelectTrigger
          aria-describedby={helpId}
          aria-invalid={invalid || undefined}
          className="w-full"
          id={id}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {field.required ? null : (
            <SelectItem value={NO_VALUE}>
              {t("sources.form.default")}
            </SelectItem>
          )}
          {(field.options ?? []).map((option) => (
            <SelectItem key={option} value={option}>
              {translateOr(t, `sources.options.${option}`, option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {help}
    </Field>
  );
}

function inputType(field: FormField): "number" | "url" | "text" {
  if (field.kind === "integer") {
    return "number";
  }
  return field.url ? "url" : "text";
}

function TextField({
  field,
  id,
  labelText,
  help,
  helpId,
  invalid,
  value,
  onChange,
}: KindProps) {
  const type = inputType(field);
  const modes = { number: "numeric", url: "url", text: undefined } as const;
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{labelText}</FieldLabel>
      <Input
        aria-describedby={helpId}
        aria-invalid={invalid || undefined}
        className="field-touch"
        id={id}
        inputMode={modes[type]}
        max={field.maximum}
        maxLength={field.maxLength}
        min={field.minimum}
        name={field.path}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        type={type}
        value={typeof value === "string" ? value : ""}
      />
      {help}
    </Field>
  );
}

const KIND_COMPONENTS = {
  boolean: BooleanField,
  map: MapField,
  enum: EnumField,
  integer: TextField,
  text: TextField,
} as const;

function ConfigField({
  adapter,
  field,
  value,
  error,
  onChange,
}: {
  adapter: string;
  error: FormFieldError | undefined;
  field: FormField;
  onChange: (value: FieldValue) => void;
  value: FieldValue | undefined;
}) {
  const { t } = useTranslation();
  const id = useId();
  const label = fieldLabel(t, adapter, field);
  const hint = fieldHint(t, adapter, field);
  const helpId = `${id}-help`;
  let help: ReactNode = null;
  if (error) {
    help = <FieldError id={helpId}>{errorText(t, error)}</FieldError>;
  } else if (hint) {
    help = <FieldDescription id={helpId}>{hint}</FieldDescription>;
  }
  const Kind = KIND_COMPONENTS[field.kind];
  return (
    <Kind
      field={field}
      help={help}
      helpId={help ? helpId : undefined}
      id={id}
      invalid={error !== undefined}
      label={label}
      labelText={field.required ? label : t("sources.form.optional", { label })}
      onChange={onChange}
      value={value}
    />
  );
}

export function ConfigForm({
  adapter,
  fields,
  values,
  errors,
  onChange,
}: {
  adapter: string;
  errors: FormErrors;
  fields: readonly FormField[];
  onChange: (path: string, value: FieldValue) => void;
  values: FormValues;
}) {
  const { t } = useTranslation();
  const top = fields.filter((field) => field.group === null);
  const groups = groupsOf(fields);
  const render = (field: FormField) => (
    <ConfigField
      adapter={adapter}
      error={errors[field.path]}
      field={field}
      key={field.path}
      onChange={(value) => onChange(field.path, value)}
      value={values[field.path]}
    />
  );
  return (
    <div className="flex flex-col gap-4">
      {top.map(render)}
      {groups.map((group) => (
        <FieldSet key={group}>
          <FieldLegend variant="label">
            {translateOr(t, `sources.fields.${adapter}.${group}`, group)}
          </FieldLegend>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.filter((field) => field.group === group).map(render)}
          </div>
        </FieldSet>
      ))}
    </div>
  );
}
