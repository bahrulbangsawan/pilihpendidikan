// A form generated from an adapter's `config_schema` (12 §8, 15 §14.1): the
// simple field mapping of the manifest's JSON Schema — string (pattern,
// length), URL (`^https?://` pattern), enum, boolean, integer (min/max), a
// nested object of strings (Lever filters) and a string map
// (`additionalProperties`, the career page's field selectors). The server
// validates the config again with Zod (`parseAdapterConfig`); this mirrors
// it so the user sees field errors before saving.

export type FieldKind = "text" | "enum" | "boolean" | "integer" | "map";

export interface FormField {
  /** Indexes into the form values (`filters.location`). */
  path: string;
  kind: FieldKind;
  /** Property name (`location`). */
  name: string;
  /** Parent group name for nested objects (`filters`), else null. */
  group: string | null;
  /** The schema's English title (the i18n label falls back to it). */
  title: string;
  required: boolean;
  /** Enum values. */
  options?: readonly string[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  /** A `^https?://` string. */
  url?: boolean;
  /** Map key / value length limits. */
  keyMaxLength?: number;
}

export interface MapRow {
  name: string;
  value: string;
}

export type FieldValue = string | boolean | MapRow[];
export type FormValues = Record<string, FieldValue>;

export type FieldError =
  | { code: "required" }
  | { code: "pattern" }
  | { code: "url" }
  | { code: "tooLong"; max: number }
  | { code: "tooShort"; min: number }
  | { code: "integer" }
  | { code: "min"; min: number }
  | { code: "max"; max: number }
  | { code: "enum" }
  | { code: "mapKey" };

export type FormErrors = Record<string, FieldError>;

type JsonSchema = Record<string, unknown>;

const URL_PATTERN_RE = /https\?:/;
const INTEGER_RE = /^-?\d+$/;

function isObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function scalarField(
  name: string,
  schema: JsonSchema,
  required: boolean,
  group: string | null
): FormField | null {
  const base = {
    name,
    group,
    path: group ? `${group}.${name}` : name,
    title: stringOf(schema.title) ?? name,
    required,
  };
  if (Array.isArray(schema.enum)) {
    return {
      ...base,
      kind: "enum",
      options: schema.enum.filter(
        (option): option is string => typeof option === "string"
      ),
    };
  }
  if (schema.type === "boolean") {
    return { ...base, kind: "boolean" };
  }
  if (schema.type === "integer" || schema.type === "number") {
    return {
      ...base,
      kind: "integer",
      minimum: numberOf(schema.minimum),
      maximum: numberOf(schema.maximum),
    };
  }
  if (schema.type === "string") {
    const pattern = stringOf(schema.pattern);
    return {
      ...base,
      kind: "text",
      pattern,
      minLength: numberOf(schema.minLength),
      maxLength: numberOf(schema.maxLength),
      url: pattern !== undefined && URL_PATTERN_RE.test(pattern),
    };
  }
  return null;
}

function requiredSet(schema: JsonSchema): Set<string> {
  return new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : []
  );
}

/** The fields of a nested object of scalars (Lever's `filters`). */
function nestedFields(
  name: string,
  child: JsonSchema,
  parentRequired: boolean
): FormField[] {
  const nestedRequired = requiredSet(child);
  const fields: FormField[] = [];
  for (const [nestedName, nested] of Object.entries(
    child.properties as JsonSchema
  )) {
    if (!isObject(nested)) {
      continue;
    }
    const field = scalarField(
      nestedName,
      nested,
      parentRequired && nestedRequired.has(nestedName),
      name
    );
    if (field) {
      fields.push(field);
    }
  }
  return fields;
}

/** A string map (`additionalProperties`, the career page's selectors). */
function mapField(
  name: string,
  child: JsonSchema,
  required: boolean
): FormField {
  const keys = isObject(child.propertyNames) ? child.propertyNames : {};
  const values = isObject(child.additionalProperties)
    ? child.additionalProperties
    : {};
  return {
    name,
    group: null,
    path: name,
    kind: "map",
    title: stringOf(child.title) ?? name,
    required,
    keyMaxLength: numberOf(keys.maxLength),
    maxLength: numberOf(values.maxLength),
  };
}

function propertyFields(
  name: string,
  child: JsonSchema,
  required: boolean
): FormField[] {
  if (child.type === "object" && isObject(child.properties)) {
    return nestedFields(name, child, required);
  }
  if (child.type === "object" && isObject(child.additionalProperties)) {
    return [mapField(name, child, required)];
  }
  const field = scalarField(name, child, required, null);
  return field ? [field] : [];
}

/**
 * The form fields of a config JSON Schema, in property order. `skip` names
 * server-managed properties (Workday's `disabled_reason`). Unsupported
 * shapes are left out rather than guessed.
 */
export function fieldsFromSchema(
  schema: unknown,
  options: { skip?: readonly string[] } = {}
): FormField[] {
  if (!(isObject(schema) && isObject(schema.properties))) {
    return [];
  }
  const skip = new Set(options.skip ?? []);
  const required = requiredSet(schema);
  return Object.entries(schema.properties).flatMap(([name, child]) =>
    skip.has(name) || !isObject(child)
      ? []
      : propertyFields(name, child, required.has(name))
  );
}

/** The group names of `fields`, in order (for fieldsets). */
export function groupsOf(fields: readonly FormField[]): string[] {
  return [
    ...new Set(
      fields
        .map((field) => field.group)
        .filter((group): group is string => group !== null)
    ),
  ];
}

function emptyValue(field: FormField): FieldValue {
  if (field.kind === "boolean") {
    return false;
  }
  if (field.kind === "map") {
    return [];
  }
  return "";
}

function readPath(config: Record<string, unknown>, field: FormField): unknown {
  if (field.group === null) {
    return config[field.name];
  }
  const group = config[field.group];
  return isObject(group) ? group[field.name] : undefined;
}

/** Form values for `config` (an existing source being edited). */
export function valuesFromConfig(
  fields: readonly FormField[],
  config: Record<string, unknown> = {}
): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    const raw = readPath(config, field);
    if (field.kind === "boolean") {
      values[field.path] = raw === true;
    } else if (field.kind === "map") {
      values[field.path] = isObject(raw)
        ? Object.entries(raw).map(([name, value]) => ({
            name,
            value: typeof value === "string" ? value : "",
          }))
        : [];
    } else if (typeof raw === "string" || typeof raw === "number") {
      values[field.path] = String(raw);
    } else {
      values[field.path] = emptyValue(field);
    }
  }
  return values;
}

function textError(field: FormField, text: string): FieldError | null {
  if (field.minLength !== undefined && text.length < field.minLength) {
    return { code: "tooShort", min: field.minLength };
  }
  if (field.maxLength !== undefined && text.length > field.maxLength) {
    return { code: "tooLong", max: field.maxLength };
  }
  if (field.url) {
    try {
      const url = new URL(text);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return { code: "url" };
      }
    } catch {
      return { code: "url" };
    }
  }
  if (field.pattern !== undefined) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(field.pattern, "u");
    } catch {
      return null;
    }
    if (!pattern.test(text)) {
      return field.url ? { code: "url" } : { code: "pattern" };
    }
  }
  return null;
}

function integerError(field: FormField, text: string): FieldError | null {
  if (!INTEGER_RE.test(text)) {
    return { code: "integer" };
  }
  const value = Number(text);
  if (field.minimum !== undefined && value < field.minimum) {
    return { code: "min", min: field.minimum };
  }
  if (field.maximum !== undefined && value > field.maximum) {
    return { code: "max", max: field.maximum };
  }
  return null;
}

function mapError(
  field: FormField,
  rows: readonly MapRow[]
): FieldError | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim();
    if (name === "" && row.value.trim() === "") {
      continue;
    }
    if (
      name === "" ||
      seen.has(name) ||
      (field.keyMaxLength !== undefined && name.length > field.keyMaxLength)
    ) {
      return { code: "mapKey" };
    }
    if (field.maxLength !== undefined && row.value.length > field.maxLength) {
      return { code: "tooLong", max: field.maxLength };
    }
    seen.add(name);
  }
  return null;
}

function fieldError(
  field: FormField,
  value: FieldValue | undefined
): FieldError | null {
  if (field.kind === "boolean") {
    return null;
  }
  if (field.kind === "map") {
    return mapError(field, Array.isArray(value) ? value : []);
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") {
    return field.required ? { code: "required" } : null;
  }
  if (field.kind === "enum") {
    return field.options?.includes(text) ? null : { code: "enum" };
  }
  if (field.kind === "integer") {
    return integerError(field, text);
  }
  return textError(field, text);
}

/** Field errors by path; empty when the values are valid. */
export function validateValues(
  fields: readonly FormField[],
  values: FormValues
): FormErrors {
  const errors: FormErrors = {};
  for (const field of fields) {
    const error = fieldError(field, values[field.path]);
    if (error) {
      errors[field.path] = error;
    }
  }
  return errors;
}

function configValue(field: FormField, value: FieldValue | undefined): unknown {
  if (field.kind === "boolean") {
    return value === true ? true : undefined;
  }
  if (field.kind === "map") {
    const rows = Array.isArray(value) ? value : [];
    const entries = rows
      .map((row) => [row.name.trim(), row.value.trim()] as const)
      .filter(([name, text]) => name !== "" && text !== "");
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") {
    return undefined;
  }
  return field.kind === "integer" ? Number(text) : text;
}

/**
 * The `job_sources.config` object for valid values: empty optional fields
 * and empty groups are left out; `keep` carries server-managed keys of an
 * edited source (e.g. Workday's `disabled_reason`) through unchanged.
 */
export function configFromValues(
  fields: readonly FormField[],
  values: FormValues,
  keep: Record<string, unknown> = {}
): Record<string, unknown> {
  const config: Record<string, unknown> = { ...keep };
  for (const field of fields) {
    const value = configValue(field, values[field.path]);
    if (value === undefined) {
      continue;
    }
    if (field.group === null) {
      config[field.name] = value;
      continue;
    }
    const group = isObject(config[field.group])
      ? (config[field.group] as Record<string, unknown>)
      : {};
    group[field.name] = value;
    config[field.group] = group;
  }
  return config;
}
