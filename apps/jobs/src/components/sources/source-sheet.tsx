// Add / edit a source (12 §8): the adapter picker from the registry
// (excluded platforms listed but disabled with the reason, D-17; Workday
// behind an explicit opt-in, C-11; beta adapters badged), the config form
// generated from the adapter's JSON Schema, the label, and "Test", which
// only shows the CLI dry-run command (nothing runs server-side, 11 T-08).

import type {
  AdapterManifest,
  ExcludedSource,
} from "@pilihpendidikan/jobs-contracts/adapters";
import type { JobSourceRecord } from "@pilihpendidikan/jobs-contracts/records";
import { Alert, AlertDescription, AlertTitle } from "@rulisme/ui/ui/alert";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { RadioGroup, RadioGroupItem } from "@rulisme/ui/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@rulisme/ui/ui/sheet";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { Switch } from "@rulisme/ui/ui/switch";
import { TriangleAlert } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useId, useMemo, useState } from "react";
import { CopyCommand } from "@/components/copy-command";
import { useTranslation } from "@/i18n";
import type {
  FieldValue,
  FormErrors,
  FormField,
  FormValues,
} from "@/lib/json-schema-form";
import {
  configFromValues,
  fieldsFromSchema,
  validateValues,
  valuesFromConfig,
} from "@/lib/json-schema-form";
import {
  defaultLabel,
  requiresOptIn,
  SERVER_MANAGED_KEYS,
  sameConfig,
  testCommand,
} from "@/lib/sources-model";
import { ConfigForm } from "./config-form";
import type { SourceChanges } from "./source-actions";
import { useSourceActions } from "./source-actions";

const LABEL_MAX = 200;

export type SheetTarget =
  | { mode: "create" }
  | { mode: "edit"; source: JobSourceRecord };

function serverManaged(
  config: Record<string, unknown>
): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
  for (const key of SERVER_MANAGED_KEYS) {
    if (config[key] !== undefined) {
      keep[key] = config[key];
    }
  }
  return keep;
}

function AdapterPicker({
  manifests,
  excluded,
  value,
  onChange,
}: {
  excluded: readonly ExcludedSource[];
  manifests: readonly AdapterManifest[];
  onChange: (id: string) => void;
  value: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <FieldSet>
      <FieldLegend variant="label">{t("sources.sheet.adapter")}</FieldLegend>
      <RadioGroup
        aria-label={t("sources.sheet.adapter")}
        className="gap-0 border border-line"
        onValueChange={onChange}
        value={value}
      >
        {manifests.map((manifest) => (
          <div
            className="flex items-start gap-3 border-line border-b px-3 py-2.5 last:border-b-0"
            data-adapter={manifest.id}
            key={manifest.id}
          >
            <RadioGroupItem
              className="mt-0.5"
              id={`${id}-${manifest.id}`}
              value={manifest.id}
            />
            <label
              className="flex min-w-0 flex-1 flex-col gap-0.5"
              htmlFor={`${id}-${manifest.id}`}
            >
              <span className="type-body flex flex-wrap items-center gap-1.5 text-foreground">
                {manifest.display_name}
                {manifest.status === "beta" ? (
                  <Badge variant="outline">{t("sources.status.beta")}</Badge>
                ) : null}
                {requiresOptIn(manifest) ? (
                  <Badge variant="outline">{t("sources.status.optIn")}</Badge>
                ) : null}
              </span>
              <span className="type-caption text-muted-foreground">
                {manifest.restrictions.tos_notes}
              </span>
            </label>
          </div>
        ))}
        {excluded.map((entry) => (
          <div
            aria-disabled="true"
            className="flex items-start gap-3 border-line border-b px-3 py-2.5 last:border-b-0"
            data-adapter={entry.id}
            key={entry.id}
          >
            <RadioGroupItem
              className="mt-0.5"
              disabled
              id={`${id}-${entry.id}`}
              value={entry.id}
            />
            <label
              className="flex min-w-0 flex-1 flex-col gap-0.5"
              htmlFor={`${id}-${entry.id}`}
            >
              <span className="type-body text-muted-foreground">
                {entry.display_name}
              </span>
              <span className="type-caption text-muted-foreground">
                {t("sources.excluded", { reason: entry.reason })}
              </span>
            </label>
          </div>
        ))}
      </RadioGroup>
    </FieldSet>
  );
}

/** The fields an edit changes (label, config, enabled); empty for a no-op. */
export function editChanges(
  source: JobSourceRecord,
  next: { label: string; config: Record<string, unknown>; enabled: boolean }
): SourceChanges {
  const changes: SourceChanges = {};
  if (next.label !== source.label) {
    changes.label = next.label;
  }
  if (!sameConfig(next.config, source.config)) {
    changes.config = next.config as JobSourceRecord["config"];
  }
  if (next.enabled !== source.enabled) {
    changes.enabled = next.enabled;
  }
  return changes;
}

function TestSection({ source }: { source: JobSourceRecord | null }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-test`}
      className="flex flex-col gap-1.5 border-line border-t pt-4"
    >
      <h3
        className="type-body weight-semibold text-foreground"
        id={`${id}-test`}
      >
        {t("sources.test.title")}
      </h3>
      {source ? (
        <>
          <p className="type-caption text-muted-foreground">
            {t("sources.test.explain")}
          </p>
          <CopyCommand
            className="self-start"
            command={testCommand(source.id)}
          />
        </>
      ) : (
        <p className="type-caption text-muted-foreground">
          {t("sources.test.saveFirst")}
        </p>
      )}
    </section>
  );
}

function OptInField({
  checked,
  onChange,
  showError,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  showError: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field data-invalid={showError || undefined} orientation="horizontal">
      <Checkbox
        aria-describedby={showError ? `${id}-help` : undefined}
        checked={checked}
        id={`${id}-optin`}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <FieldLabel htmlFor={`${id}-optin`}>
        {t("sources.optIn.confirm")}
      </FieldLabel>
      {showError ? (
        <FieldError id={`${id}-help`}>{t("sources.optIn.required")}</FieldError>
      ) : null}
    </Field>
  );
}

interface SheetState {
  adapter: string;
  enabled: boolean;
  label: string;
  optIn: boolean;
  showErrors: boolean;
  values: FormValues;
}

function initialState(target: SheetTarget | null): SheetState {
  const source = target?.mode === "edit" ? target.source : null;
  return {
    adapter: source?.adapter ?? "",
    label: source?.label ?? "",
    enabled: source?.enabled ?? true,
    // An existing opt-in source was opted into when it was added.
    optIn: source !== null,
    showErrors: false,
    values: {},
  };
}

/** The config fields of an adapter, keyed by its schema text. */
function useSchemaFields(manifest: AdapterManifest | null) {
  // A background refetch of the registry (a new object with the same
  // schema) must never reset what the user typed.
  const schemaText = manifest ? JSON.stringify(manifest.config_schema) : "";
  return useMemo(
    () =>
      schemaText
        ? fieldsFromSchema(JSON.parse(schemaText), {
            skip: SERVER_MANAGED_KEYS,
          })
        : [],
    [schemaText]
  );
}

function ManifestSection({
  manifest,
  editing,
  state,
  patch,
  fields,
  errors,
  onChange,
  placeholder,
  labelTooLong,
  needsOptIn,
}: {
  editing: JobSourceRecord | null;
  errors: FormErrors;
  fields: readonly FormField[];
  labelTooLong: boolean;
  manifest: AdapterManifest;
  needsOptIn: boolean;
  onChange: (path: string, value: FieldValue) => void;
  patch: (next: Partial<SheetState>) => void;
  placeholder: string;
  state: SheetState;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <>
      <Field data-invalid={(state.showErrors && labelTooLong) || undefined}>
        <FieldLabel htmlFor={`${id}-label`}>
          {t("sources.sheet.label")}
        </FieldLabel>
        <Input
          aria-describedby={`${id}-label-help`}
          className="field-touch"
          id={`${id}-label`}
          maxLength={LABEL_MAX}
          onChange={(event) => patch({ label: event.target.value })}
          placeholder={placeholder}
          value={state.label}
        />
        <FieldDescription id={`${id}-label-help`}>
          {t("sources.sheet.labelHelp")}
        </FieldDescription>
      </Field>
      <ConfigForm
        adapter={manifest.id}
        errors={state.showErrors ? errors : {}}
        fields={fields}
        onChange={onChange}
        values={state.values}
      />
      <Field orientation="horizontal">
        <Switch
          checked={state.enabled}
          id={`${id}-enabled`}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
        <FieldLabel htmlFor={`${id}-enabled`}>
          {t("sources.sheet.enabled")}
        </FieldLabel>
      </Field>
      {needsOptIn ? (
        <OptInField
          checked={state.optIn}
          onChange={(optIn) => patch({ optIn })}
          showError={state.showErrors && !state.optIn}
        />
      ) : null}
      <TestSection source={editing} />
    </>
  );
}

export interface SourceSheetProps {
  excluded: readonly ExcludedSource[];
  loading: boolean;
  manifests: readonly AdapterManifest[];
  onClose: () => void;
  target: SheetTarget | null;
}

export function SourceSheet({
  target,
  manifests,
  excluded,
  loading,
  onClose,
}: SourceSheetProps) {
  const { t } = useTranslation();
  const actions = useSourceActions();
  const editing = target?.mode === "edit" ? target.source : null;
  const [state, setState] = useState<SheetState>(() => initialState(target));
  const [busy, setBusy] = useState(false);
  const patch = (next: Partial<SheetState>) =>
    setState((current) => ({ ...current, ...next }));

  const manifest =
    manifests.find((entry) => entry.id === state.adapter) ?? null;
  const fields = useSchemaFields(manifest);

  // Reset whenever the sheet opens for another target.
  useEffect(() => {
    if (target) {
      setState(initialState(target));
      setBusy(false);
    }
  }, [target]);

  // Fresh values for the chosen adapter (or the edited source's config).
  useEffect(() => {
    setState((current) => ({
      ...current,
      values: valuesFromConfig(fields, editing?.config ?? {}),
    }));
  }, [fields, editing]);

  const errors = validateValues(fields, state.values);
  const needsOptIn = manifest !== null && requiresOptIn(manifest) && !editing;
  const config = configFromValues(
    fields,
    state.values,
    editing ? serverManaged(editing.config) : {}
  );
  const placeholder = manifest ? defaultLabel(manifest, config) : "";
  const labelTooLong = state.label.trim().length > LABEL_MAX;
  const blocked =
    Object.keys(errors).length > 0 ||
    labelTooLong ||
    (needsOptIn && !state.optIn);

  function change(path: string, value: FieldValue) {
    setState((current) => ({
      ...current,
      values: { ...current.values, [path]: value },
    }));
  }

  async function save(chosen: AdapterManifest) {
    const label = state.label.trim() || placeholder;
    if (editing) {
      const changes = editChanges(editing, {
        label,
        config,
        enabled: state.enabled,
      });
      if (Object.keys(changes).length > 0) {
        await actions.update(editing, changes);
      }
      return true;
    }
    const created = await actions.create({
      adapter: chosen.id,
      label,
      config: config as JobSourceRecord["config"],
      enabled: state.enabled,
    });
    return created !== null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    patch({ showErrors: true });
    if (!manifest || blocked) {
      return;
    }
    setBusy(true);
    const done = await save(manifest);
    setBusy(false);
    if (done) {
      onClose();
    }
  }

  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={target !== null}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" side="right">
        <form className="flex min-h-full flex-col" noValidate onSubmit={submit}>
          <SheetHeader>
            <SheetTitle>
              {editing
                ? t("sources.sheet.editTitle", { label: editing.label })
                : t("sources.sheet.addTitle")}
            </SheetTitle>
            <SheetDescription>
              {t("sources.sheet.description")}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-5 px-4 pb-4">
            {loading ? (
              <div aria-hidden="true" className="flex flex-col gap-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : null}
            {loading || editing ? null : (
              <AdapterPicker
                excluded={excluded}
                manifests={manifests}
                onChange={(adapter) => patch({ adapter, showErrors: false })}
                value={state.adapter}
              />
            )}
            {editing && manifest ? (
              <p className="type-caption text-muted-foreground">
                {t("sources.sheet.adapterFixed", {
                  adapter: manifest.display_name,
                })}
              </p>
            ) : null}
            {manifest && requiresOptIn(manifest) ? (
              <Alert>
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>{t("sources.optIn.title")}</AlertTitle>
                <AlertDescription>
                  {manifest.restrictions.tos_notes}
                </AlertDescription>
              </Alert>
            ) : null}
            {manifest ? (
              <ManifestSection
                editing={editing}
                errors={errors}
                fields={fields}
                labelTooLong={labelTooLong}
                manifest={manifest}
                needsOptIn={needsOptIn}
                onChange={change}
                patch={patch}
                placeholder={placeholder}
                state={state}
              />
            ) : null}
          </div>
          <SheetFooter className="flex-row justify-end border-line border-t">
            <Button onClick={onClose} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
            <Button
              aria-keyshortcuts="Enter"
              disabled={busy || !manifest}
              type="submit"
            >
              {editing ? t("common.save") : t("sources.sheet.add")}
              <Kbd aria-hidden="true">↵</Kbd>
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
