// Apply tab (12 §5.1): choose how to apply and in which mode. Browser: pick
// the device (online devices that can `apply` and accept tasks, or "any of
// my devices") and start the run — a `POST /api/v1/tasks` — then follow it in
// the live monitor. Email: the 09 composer, approval and the web-only
// hand-off (email-apply.tsx). Manual: "I applied" records the user's
// attestation.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import type {
  ApplicationMode,
  SubmissionMethod,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  APPLICATION_MODES,
  SUBMISSION_METHODS,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
import { Button } from "@rulisme/ui/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { RadioGroup, RadioGroupItem } from "@rulisme/ui/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Play } from "lucide-react";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { AppLink } from "@/components/app-link";
import { commitApplicationToBoard } from "@/hooks/use-board";
import { useApplicationPatch } from "@/hooks/use-conflict-write";
import { useDevices } from "@/hooks/use-devices";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { fromLocalInputValue, toDateValue } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import { methodLabel, modeLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query";
import { EmailApply } from "./email-apply";

type Method = "browser" | "email" | "manual";
const ANY_DEVICE = "any";

/** Devices the Apply tab offers: online, able to apply, taking tasks. */
export function applyDevices<
  T extends { online: boolean; accepts_tasks: boolean; capabilities: string[] },
>(devices: readonly T[]): T[] {
  return devices.filter(
    (entry) =>
      entry.online &&
      entry.accepts_tasks &&
      entry.capabilities.includes("apply")
  );
}

function BrowserApply({ detail }: { detail: ApplicationDetail }) {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const { devices, isSuccess } = useDevices();
  const [device, setDevice] = useState(ANY_DEVICE);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<string | null>(null);
  const capable = applyDevices(devices);
  const anyApplyDevice = devices.some(
    (entry) => entry.capabilities.includes("apply") && entry.accepts_tasks
  );
  const { application } = detail;
  const manual = application.mode === "manual";
  const live = detail.tasks.find((task) =>
    ["queued", "claimed", "running", "paused", "awaiting_approval"].includes(
      task.state
    )
  );

  async function start() {
    setBusy(true);
    const key = newIdempotencyKey();
    try {
      const result = await api("POST /api/v1/tasks", {
        body: {
          kind: "apply",
          application_id: application.id,
          payload: { mode: application.mode },
          target_device_id: device === ANY_DEVICE ? null : device,
          idempotency_key: key,
          queue_without_device: !anyApplyDevice,
        },
        idempotencyKey: key,
      });
      setStarted(result.task.id);
      toast.success(t("apply.started"));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.application(application.id),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.boardAll });
    } catch (error) {
      let message = t("apply.startFailed");
      if (isApiError(error) && error.code === "duplicate") {
        message = t("apply.duplicate");
      } else if (isApiError(error) && error.status === 422) {
        message = t("apply.refused", { message: error.message });
      }
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="type-body">
        {t("apply.browserHelp", { mode: modeLabel(t, application.mode) })}
      </p>
      <Field>
        <FieldLabel htmlFor={`${id}-device`}>{t("apply.device")}</FieldLabel>
        <Select onValueChange={setDevice} value={device}>
          <SelectTrigger className="w-full sm:w-72" id={`${id}-device`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_DEVICE}>{t("apply.anyDevice")}</SelectItem>
            {capable.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.name} ·{" "}
                {entry.online ? t("apply.online") : t("apply.offline")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isSuccess && capable.length === 0 ? (
          <FieldDescription>
            {t("apply.noDevice")}{" "}
            <AppLink className="text-primary hover:underline" href="/cli">
              {t("apply.connectCli")}
            </AppLink>
          </FieldDescription>
        ) : null}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="self-start"
          disabled={busy || manual || live !== undefined}
          onClick={start}
          variant="outline"
        >
          <Play aria-hidden="true" data-icon="inline-start" />
          {t("apply.start")}
        </Button>
        {(started ?? live?.id) ? (
          <AppLink
            className="type-body inline-flex items-center gap-1 text-primary hover:underline"
            href={`/automation/runs/${started ?? live?.id ?? ""}`}
          >
            {t("apply.watchRun")}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </AppLink>
        ) : null}
      </div>
      {live && !started ? (
        <p className="type-caption text-muted-foreground">
          {t("apply.alreadyRunning")}
        </p>
      ) : null}
      {manual ? (
        <p className="type-caption text-muted-foreground">
          {t("apply.manualMode")}
        </p>
      ) : null}
    </div>
  );
}

function ManualApply({
  application,
  onSaved,
}: {
  application: ApplicationRecord;
  onSaved: (record: ApplicationRecord) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [day, setDay] = useState(() => toDateValue(Date.now()));
  const [method, setMethod] = useState<SubmissionMethod>("manual");
  const [busy, setBusy] = useState(false);
  const done = application.submission_status === "submitted_verified";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api(
        "POST /api/v1/applications/{app_id}/submission",
        {
          params: { app_id: application.id },
          body: {
            base_revision: application.revision,
            action: "mark_applied",
            method,
            applied_at: Math.min(
              Date.now(),
              fromLocalInputValue(day) ?? Date.now()
            ),
          },
          idempotencyKey: newIdempotencyKey(),
        }
      );
      onSaved(result.application);
      toast.success(t("apply.markedApplied"));
    } catch (error) {
      toast.error(
        isApiError(error) && error.isRevisionConflict
          ? t("submission.changed")
          : t("submission.failedToSave")
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p className="type-body">{t("apply.alreadyApplied")}</p>;
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <p className="type-body">{t("apply.manualHelp")}</p>
      <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${id}-date`}>
            {t("move.appliedDate")}
          </FieldLabel>
          <Input
            className="field-touch"
            id={`${id}-date`}
            max={toDateValue(Date.now())}
            onChange={(event) => setDay(event.target.value)}
            type="date"
            value={day}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-method`}>
            {t("move.appliedMethod")}
          </FieldLabel>
          <Select
            onValueChange={(value) => setMethod(value as SubmissionMethod)}
            value={method}
          >
            <SelectTrigger className="w-full" id={`${id}-method`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUBMISSION_METHODS.map((value) => (
                <SelectItem key={value} value={value}>
                  {methodLabel(t, value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Button
        className="self-start"
        disabled={busy}
        type="submit"
        variant="outline"
      >
        {t("move.yesApplied")}
      </Button>
    </form>
  );
}

function ModeField({ detail }: { detail: ApplicationDetail }) {
  const { t } = useTranslation();
  const id = useId();
  const patch = useApplicationPatch();
  const { application } = detail;
  return (
    <Field className="max-w-xs">
      <FieldLabel htmlFor={`${id}-mode`}>{t("apply.mode")}</FieldLabel>
      <Select
        onValueChange={(value) =>
          patch(
            application,
            { mode: value as ApplicationMode },
            t("apply.mode")
          )
        }
        value={application.mode}
      >
        <SelectTrigger className="w-full" id={`${id}-mode`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {APPLICATION_MODES.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {modeLabel(t, mode)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {t(`apply.modeHelp.${application.mode}`)}
      </FieldDescription>
    </Field>
  );
}

function defaultMethod(detail: ApplicationDetail): Method {
  if (detail.application.mode === "manual") {
    return "manual";
  }
  const emailFirst =
    detail.posting.application_support === "email" ||
    detail.posting.apply_url?.toLowerCase().startsWith("mailto:") === true ||
    detail.emails.length > 0;
  return emailFirst ? "email" : "browser";
}

export function ApplyTab({ detail }: { detail: ApplicationDetail }) {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<Method>(() => defaultMethod(detail));
  return (
    <div className="flex flex-col gap-6">
      <ModeField detail={detail} />
      <FieldSet>
        <FieldLegend>{t("apply.method")}</FieldLegend>
        <RadioGroup
          className="flex flex-wrap gap-4"
          onValueChange={(value) => setMethod(value as Method)}
          value={method}
        >
          {(["browser", "email", "manual"] as const).map((value) => (
            <div className="flex items-center gap-2" key={value}>
              <RadioGroupItem id={`${id}-${value}`} value={value} />
              <label
                className="type-body text-foreground"
                htmlFor={`${id}-${value}`}
              >
                {t(`apply.methods.${value}`)}
              </label>
            </div>
          ))}
        </RadioGroup>
      </FieldSet>
      {method === "browser" ? <BrowserApply detail={detail} /> : null}
      {method === "email" ? <EmailApply detail={detail} /> : null}
      {method === "manual" ? (
        <ManualApply
          application={detail.application}
          onSaved={(record) => {
            commitApplicationToBoard(queryClient, record);
            queryClient.invalidateQueries({
              queryKey: queryKeys.application(record.id),
            });
          }}
        />
      ) : null}
    </div>
  );
}
