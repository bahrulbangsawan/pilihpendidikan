// Operator controls of a cloud source (05 §15, 24 §5): switch, priority,
// interval, strategy + its config (JSON validated live against the strategy's
// contract schema), rate limits, AI fallback, browser rendering, a health
// override and the status / auth notes. Save is a PATCH with base_revision
// under the 12 §11 conflict rules. Run now, Retry (confirmed: it closes the
// breaker and clears the stop) and Re-probe queue runs.

import type { CloudSourceView } from "@pilihpendidikan/jobs-contracts/api";
import { CLOUD_STRATEGIES } from "@pilihpendidikan/jobs-contracts/enums";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@rulisme/ui/ui/alert-dialog";
import { Button } from "@rulisme/ui/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { NativeSelect, NativeSelectOption } from "@rulisme/ui/ui/native-select";
import { Switch } from "@rulisme/ui/ui/switch";
import { Textarea } from "@rulisme/ui/ui/textarea";
import { Play, RefreshCw, RotateCcw } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useId, useMemo, useState } from "react";
import { useCloudActions } from "@/hooks/use-cloud-sources";
import { useTranslation } from "@/i18n";
import type { EditorForm } from "@/lib/cloud-sources-model";
import {
  canRetry,
  checkStrategyConfig,
  editorChanges,
  editorFormOf,
  INTERVAL_OPTIONS,
  intervalLabelKey,
  strategyLabelKey,
} from "@/lib/cloud-sources-model";

const RATE_FIELDS = [
  ["minDelayMs", "1000", "60000"],
  ["maxPages", "1", "10"],
  ["maxItems", "1", "500"],
  ["maxDetails", "0", "50"],
] as const;

function SwitchRow({
  checked,
  description,
  label,
  name,
  onChange,
}: {
  checked: boolean;
  description?: string;
  label: string;
  name: string;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal">
      <Switch
        checked={checked}
        id={id}
        name={name}
        onCheckedChange={onChange}
      />
      <div className="flex flex-col gap-0.5">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? (
          <FieldDescription>{description}</FieldDescription>
        ) : null}
      </div>
    </Field>
  );
}

function RetryDialog({
  open,
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  open: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog
      onOpenChange={(value) => {
        if (!value) {
          onCancel();
        }
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("cloudSources.retry.title", { name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("cloudSources.retry.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={async (event) => {
              event.preventDefault();
              setBusy(true);
              await onConfirm();
              setBusy(false);
            }}
          >
            {t("cloudSources.retry.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function CloudSourceEditor({ source }: { source: CloudSourceView }) {
  const { t } = useTranslation();
  const actions = useCloudActions();
  const id = useId();
  const [form, setForm] = useState<EditorForm>(() => editorFormOf(source));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "run" | "probe">(null);
  const [retrying, setRetrying] = useState(false);

  // A newer revision from the server (poll, save) resets the form.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the revision only, so typing is never overwritten by a same-revision refetch.
  useEffect(() => {
    setForm(editorFormOf(source));
    setShowErrors(false);
  }, [source.id, source.revision]);

  const check = useMemo(
    () => checkStrategyConfig(form.strategy, form.configText),
    [form.strategy, form.configText]
  );
  const result = editorChanges(source, form);
  const errors = result.ok ? {} : result.errors;
  const dirty = result.ok && Object.keys(result.changes).length > 0;
  const patch = (changes: Partial<EditorForm>) =>
    setForm((current) => ({ ...current, ...changes }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    if (!(result.ok && dirty)) {
      return;
    }
    setBusy("save");
    await actions.update(source, result.changes);
    setBusy(null);
  }

  return (
    <form
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 border-line border-t pt-4"
      noValidate
      onSubmit={save}
    >
      <div className="flex flex-col gap-0.5">
        <h3
          className="type-body weight-semibold text-foreground"
          id={`${id}-title`}
        >
          {t("cloudSources.editor.title")}
        </h3>
        <p className="type-caption text-muted-foreground">
          {t("cloudSources.editor.intro")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy !== null || !source.enabled}
          onClick={async () => {
            setBusy("run");
            await actions.startRun(source);
            setBusy(null);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <Play aria-hidden="true" data-icon="inline-start" />
          {t("cloudSources.run.now")}
        </Button>
        {canRetry(source.status) ? (
          <Button
            disabled={busy !== null}
            onClick={() => setRetrying(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            {t("cloudSources.run.retry")}
          </Button>
        ) : null}
        <Button
          disabled={busy !== null}
          onClick={async () => {
            setBusy("probe");
            await actions.startRun(source, { probe: true });
            setBusy(null);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw aria-hidden="true" data-icon="inline-start" />
          {t("cloudSources.run.probe")}
        </Button>
      </div>

      <SwitchRow
        checked={form.enabled}
        description={t("cloudSources.editor.enabledHelp")}
        label={t("cloudSources.editor.enabled")}
        name="enabled"
        onChange={(enabled) => patch({ enabled })}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field data-invalid={showErrors && errors.priority ? true : undefined}>
          <FieldLabel htmlFor={`${id}-priority`}>
            {t("cloudSources.editor.priority")}
          </FieldLabel>
          <Input
            aria-invalid={showErrors && errors.priority ? true : undefined}
            className="field-touch tabular-nums"
            id={`${id}-priority`}
            inputMode="numeric"
            max={100}
            min={0}
            name="priority"
            onChange={(event) => patch({ priority: event.target.value })}
            type="number"
            value={form.priority}
          />
          {showErrors && errors.priority ? (
            <FieldError>{t("cloudSources.editor.priorityError")}</FieldError>
          ) : (
            <FieldDescription>
              {t("cloudSources.editor.priorityHelp")}
            </FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-interval`}>
            {t("cloudSources.editor.interval")}
          </FieldLabel>
          <NativeSelect
            className="w-full"
            id={`${id}-interval`}
            name="interval_minutes"
            onChange={(event) =>
              patch({ intervalMinutes: Number(event.target.value) })
            }
            value={String(form.intervalMinutes)}
          >
            {(INTERVAL_OPTIONS as readonly number[]).includes(
              form.intervalMinutes
            ) ? null : (
              <NativeSelectOption value={String(form.intervalMinutes)}>
                {t("cloudSources.intervals.custom", {
                  minutes: form.intervalMinutes,
                })}
              </NativeSelectOption>
            )}
            {INTERVAL_OPTIONS.map((minutes) => (
              <NativeSelectOption key={minutes} value={String(minutes)}>
                {t(intervalLabelKey(minutes))}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor={`${id}-strategy`}>
          {t("cloudSources.editor.strategy")}
        </FieldLabel>
        <NativeSelect
          className="w-full"
          id={`${id}-strategy`}
          name="strategy"
          onChange={(event) =>
            patch({ strategy: event.target.value as EditorForm["strategy"] })
          }
          value={form.strategy}
        >
          {CLOUD_STRATEGIES.map((strategy) => (
            <NativeSelectOption key={strategy} value={strategy}>
              {t(strategyLabelKey(strategy))}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>
          {t(`cloudSources.strategyHelp.${form.strategy}`)}
        </FieldDescription>
      </Field>

      <Field data-invalid={check.issues.length > 0 ? true : undefined}>
        <FieldLabel htmlFor={`${id}-config`}>
          {t("cloudSources.editor.config")}
        </FieldLabel>
        <Textarea
          aria-describedby={`${id}-config-state`}
          aria-invalid={check.issues.length > 0 ? true : undefined}
          className="type-caption min-h-40"
          id={`${id}-config`}
          name="strategy_config"
          onChange={(event) => patch({ configText: event.target.value })}
          spellCheck={false}
          value={form.configText}
        />
        {check.issues.length > 0 ? (
          <FieldError id={`${id}-config-state`}>
            <p>
              {check.syntax
                ? t("cloudSources.editor.configSyntax")
                : t("cloudSources.editor.configInvalid")}
            </p>
            <ul className="ml-4 flex list-disc flex-col gap-0.5">
              {check.issues.map((issue) => (
                <li className="break-words" key={issue}>
                  {issue}
                </li>
              ))}
            </ul>
          </FieldError>
        ) : (
          <FieldDescription id={`${id}-config-state`}>
            {t("cloudSources.editor.configValid")}
          </FieldDescription>
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="type-body weight-semibold mb-1 text-foreground">
          {t("cloudSources.editor.rateTitle")}
        </legend>
        <div className="grid grid-cols-2 items-end gap-3">
          {RATE_FIELDS.map(([field, min, max]) => {
            const invalid = showErrors && errors.rate?.includes(field);
            return (
              <Field data-invalid={invalid ? true : undefined} key={field}>
                <FieldLabel htmlFor={`${id}-${field}`}>
                  {t(`cloudSources.editor.rate.${field}`)}
                </FieldLabel>
                <Input
                  aria-invalid={invalid ? true : undefined}
                  className="field-touch tabular-nums"
                  id={`${id}-${field}`}
                  inputMode="numeric"
                  max={max}
                  min={min}
                  name={field}
                  onChange={(event) => patch({ [field]: event.target.value })}
                  placeholder={t("cloudSources.editor.rateDefault")}
                  type="number"
                  value={form[field]}
                />
                {invalid ? (
                  <FieldError>
                    {t("cloudSources.editor.rangeError", { min, max })}
                  </FieldError>
                ) : null}
              </Field>
            );
          })}
        </div>
      </fieldset>

      <SwitchRow
        checked={form.aiEnabled}
        description={t("cloudSources.editor.aiHelp")}
        label={t("cloudSources.editor.ai")}
        name="ai_enabled"
        onChange={(aiEnabled) => patch({ aiEnabled })}
      />
      <SwitchRow
        checked={form.allowBrowser}
        description={t("cloudSources.editor.browserHelp")}
        label={t("cloudSources.editor.browser")}
        name="allow_browser"
        onChange={(allowBrowser) => patch({ allowBrowser })}
      />

      <Field>
        <FieldLabel htmlFor={`${id}-health`}>
          {t("cloudSources.editor.health")}
        </FieldLabel>
        <NativeSelect
          className="w-full"
          id={`${id}-health`}
          name="health"
          onChange={(event) =>
            patch({ health: event.target.value as EditorForm["health"] })
          }
          value={form.health}
        >
          <NativeSelectOption value="">
            {t("cloudSources.editor.healthKeep")}
          </NativeSelectOption>
          <NativeSelectOption value="ACTIVE">
            {t("cloudSources.editor.healthActive")}
          </NativeSelectOption>
          <NativeSelectOption value="UNSUPPORTED">
            {t("cloudSources.editor.healthUnsupported")}
          </NativeSelectOption>
        </NativeSelect>
      </Field>
      <SwitchRow
        checked={form.authRequired}
        label={t("cloudSources.editor.authRequired")}
        name="auth_required"
        onChange={(authRequired) => patch({ authRequired })}
      />
      <Field>
        <FieldLabel htmlFor={`${id}-reason`}>
          {t("cloudSources.editor.statusReason")}
        </FieldLabel>
        <Textarea
          className="min-h-16"
          id={`${id}-reason`}
          maxLength={1000}
          name="status_reason"
          onChange={(event) => patch({ statusReason: event.target.value })}
          value={form.statusReason}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-auth`}>
          {t("cloudSources.editor.authNote")}
        </FieldLabel>
        <Textarea
          className="min-h-16"
          id={`${id}-auth`}
          maxLength={1000}
          name="auth_note"
          onChange={(event) => patch({ authNote: event.target.value })}
          value={form.authNote}
        />
      </Field>

      <div className="flex justify-end gap-2">
        <Button
          disabled={!dirty || busy !== null}
          onClick={() => {
            setForm(editorFormOf(source));
            setShowErrors(false);
          }}
          type="button"
          variant="outline"
        >
          {t("cloudSources.editor.reset")}
        </Button>
        <Button
          aria-keyshortcuts="Enter"
          disabled={busy !== null || !result.ok || !dirty}
          type="submit"
        >
          {t("common.save")}
          <Kbd aria-hidden="true">↵</Kbd>
        </Button>
      </div>

      <RetryDialog
        name={source.name}
        onCancel={() => setRetrying(false)}
        onConfirm={async () => {
          await actions.startRun(source, { retry: true });
          setRetrying(false);
        }}
        open={retrying}
      />
    </form>
  );
}
