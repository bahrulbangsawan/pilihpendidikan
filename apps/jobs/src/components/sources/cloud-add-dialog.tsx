// Operator: register a remote-job board by URL (05 §15). The URL is checked
// here (http(s), no credentials, a public host name) and again by the api,
// which also resolves DNS and deduplicates by canonical domain. The answer
// carries a probe run that classifies the site; the dialog shows its status.

import type {
  CloudRunView,
  CreateCloudSourceRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import {
  CLOUD_SOURCE_CATEGORIES,
  CLOUD_STRATEGIES,
} from "@pilihpendidikan/jobs-contracts/enums";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rulisme/ui/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { NativeSelect, NativeSelectOption } from "@rulisme/ui/ui/native-select";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { useCloudActions } from "@/hooks/use-cloud-sources";
import { useTranslation } from "@/i18n";
import type { BoardUrlProblem } from "@/lib/cloud-sources-model";
import {
  boardUrlProblem,
  categoryLabelKey,
  runStatusLabelKey,
  strategyLabelKey,
} from "@/lib/cloud-sources-model";

export interface AddForm {
  category: string;
  listingUrl: string;
  name: string;
  strategy: string;
  url: string;
}

const EMPTY: AddForm = {
  name: "",
  url: "",
  listingUrl: "",
  category: "",
  strategy: "",
};

interface AddProblems {
  listing: BoardUrlProblem | null;
  name: boolean;
  url: BoardUrlProblem | null;
}

export function addProblems(form: AddForm): AddProblems {
  return {
    name: form.name.trim() === "",
    url: boardUrlProblem(form.url),
    listing:
      form.listingUrl.trim() === "" ? null : boardUrlProblem(form.listingUrl),
  };
}

/** The create body; unset optional choices are left out (the probe decides). */
export function addRequestBody(form: AddForm): CreateCloudSourceRequest {
  const body: CreateCloudSourceRequest = {
    name: form.name.trim(),
    url: form.url.trim(),
  };
  if (form.listingUrl.trim()) {
    body.listing_url = form.listingUrl.trim();
  }
  if (form.category) {
    body.category = form.category as CreateCloudSourceRequest["category"];
  }
  if (form.strategy) {
    body.strategy = form.strategy as CreateCloudSourceRequest["strategy"];
  }
  return body;
}

function TextField({
  help,
  id,
  label,
  name,
  onChange,
  problem,
  type,
  value,
}: {
  help?: string;
  id: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  problem: string | null;
  type: "text" | "url";
  value: string;
}) {
  return (
    <Field data-invalid={problem ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        aria-invalid={problem ? true : undefined}
        className="field-touch"
        id={id}
        inputMode={type === "url" ? "url" : undefined}
        maxLength={type === "url" ? 2048 : 200}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        placeholder={type === "url" ? "https://" : undefined}
        type={type}
        value={value}
      />
      {problem ? <FieldError>{problem}</FieldError> : null}
      {!problem && help ? <FieldDescription>{help}</FieldDescription> : null}
    </Field>
  );
}

function ChoiceField({
  id,
  label,
  name,
  onChange,
  options,
  value,
}: {
  id: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
  value: string;
}) {
  const { t } = useTranslation();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        className="w-full"
        id={id}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <NativeSelectOption value="">
          {t("cloudSources.add.detect")}
        </NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

function ProbeResult({
  run,
  onClose,
}: {
  onClose: () => void;
  run: CloudRunView;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3" role="status">
      <p className="type-body flex flex-wrap items-center gap-2">
        {t("cloudSources.add.probeStatus")}
        <Badge variant="outline">{t(runStatusLabelKey(run.status))}</Badge>
      </p>
      <p className="type-caption text-muted-foreground">
        {t("cloudSources.add.probeHelp")}
      </p>
      <DialogFooter>
        <Button onClick={onClose} type="button" variant="outline">
          {t("common.close")}
        </Button>
      </DialogFooter>
    </div>
  );
}

function AddFormBody({
  onCancel,
  onAdded,
}: {
  onAdded: (run: CloudRunView) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { create } = useCloudActions();
  const id = useId();
  const [form, setForm] = useState<AddForm>(EMPTY);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const problems = addProblems(form);
  const shown = showErrors
    ? problems
    : { name: false, url: null, listing: null };
  const patch = (changes: Partial<AddForm>) =>
    setForm((current) => ({ ...current, ...changes }));
  const urlText = (problem: BoardUrlProblem | null) =>
    problem ? t(`cloudSources.add.urlProblems.${problem}`) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    if (problems.name || problems.url || problems.listing) {
      return;
    }
    setBusy(true);
    const answer = await create(addRequestBody(form));
    setBusy(false);
    if (answer) {
      onAdded(answer.run);
    }
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
      <TextField
        id={`${id}-name`}
        label={t("cloudSources.add.name")}
        name="name"
        onChange={(name) => patch({ name })}
        problem={shown.name ? t("cloudSources.add.nameRequired") : null}
        type="text"
        value={form.name}
      />
      <TextField
        help={t("cloudSources.add.urlHelp")}
        id={`${id}-url`}
        label={t("cloudSources.add.url")}
        name="url"
        onChange={(url) => patch({ url })}
        problem={urlText(shown.url)}
        type="url"
        value={form.url}
      />
      <TextField
        id={`${id}-listing`}
        label={t("cloudSources.add.listingUrl")}
        name="listing_url"
        onChange={(listingUrl) => patch({ listingUrl })}
        problem={urlText(shown.listing)}
        type="url"
        value={form.listingUrl}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceField
          id={`${id}-category`}
          label={t("cloudSources.add.category")}
          name="category"
          onChange={(category) => patch({ category })}
          options={CLOUD_SOURCE_CATEGORIES.map((category) => ({
            value: category,
            label: t(categoryLabelKey(category)),
          }))}
          value={form.category}
        />
        <ChoiceField
          id={`${id}-strategy`}
          label={t("cloudSources.add.strategy")}
          name="strategy"
          onChange={(strategy) => patch({ strategy })}
          options={CLOUD_STRATEGIES.map((strategy) => ({
            value: strategy,
            label: t(strategyLabelKey(strategy)),
          }))}
          value={form.strategy}
        />
      </div>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="outline">
          {t("common.cancel")}
        </Button>
        <Button disabled={busy} type="submit" variant="outline">
          {t("cloudSources.add.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CloudAddDialog({
  open,
  onClose,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  const [probe, setProbe] = useState<CloudRunView | null>(null);
  const close = () => {
    setProbe(null);
    onClose();
  };
  return (
    <Dialog
      onOpenChange={(value) => {
        if (!value) {
          close();
        }
      }}
      open={open}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("cloudSources.add.title")}</DialogTitle>
          <DialogDescription>
            {t("cloudSources.add.description")}
          </DialogDescription>
        </DialogHeader>
        {probe ? (
          <ProbeResult onClose={close} run={probe} />
        ) : (
          <AddFormBody onAdded={setProbe} onCancel={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
