// The run controls of 12 §6.3 / 21 §8, shared by the Runs tab and the live
// monitor: retry a failed run, settle an `outcome_unknown` one ("Did this
// application go through? Check your email first." — Submitted / Not
// submitted / Not sure; never a blind retry, D-19), and cancel a live one.

import type { AutomationTaskRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@rulisme/ui/ui/alert-dialog";
import { Button } from "@rulisme/ui/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { commitApplicationToBoard } from "@/hooks/use-board";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";

export type RunDialogKind = "retry" | "settle" | "cancel";

function useRefreshRuns() {
  const queryClient = useQueryClient();
  return async (task: Pick<AutomationTaskRecord, "id" | "application_id">) => {
    const work = [
      queryClient.invalidateQueries({ queryKey: queryKeys.tasksAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.task(task.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.boardAll }),
    ];
    if (task.application_id) {
      work.push(
        queryClient.invalidateQueries({
          queryKey: queryKeys.application(task.application_id),
        })
      );
    }
    await Promise.all(work);
  };
}

/** Retry (failed) or "Not submitted" (outcome_unknown): a new task. */
async function retryTask(
  task: AutomationTaskRecord,
  confirmNotSubmitted: boolean
): Promise<AutomationTaskRecord> {
  const key = newIdempotencyKey();
  const result = await api("POST /api/v1/tasks/{tsk_id}/retry", {
    params: { tsk_id: task.id },
    body: {
      idempotency_key: key,
      ...(confirmNotSubmitted ? { confirm_not_submitted: true } : {}),
    },
    idempotencyKey: key,
  });
  return result.task;
}

export function RunDialog({
  kind,
  task,
  onClose,
  onRetried,
}: {
  kind: RunDialogKind;
  task: AutomationTaskRecord;
  onClose: () => void;
  /** The new task a retry created (the monitor follows it). */
  onRetried?: (task: AutomationTaskRecord) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const refresh = useRefreshRuns();
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
      await refresh(task);
      onClose();
    } catch (error) {
      toast.error(
        isApiError(error) && error.status === 422
          ? t("runs.refused", { message: error.message })
          : t("runs.actionFailed")
      );
      await refresh(task);
    } finally {
      setBusy(false);
    }
  }

  const retry = (confirmNotSubmitted: boolean) =>
    run(async () => {
      const next = await retryTask(task, confirmNotSubmitted);
      toast.success(t("runs.retried"));
      onRetried?.(next);
    });

  const confirmSubmitted = () =>
    run(async () => {
      if (!task.application_id) {
        return;
      }
      const detail = await api("GET /api/v1/applications/{app_id}", {
        params: { app_id: task.application_id },
      });
      const result = await api(
        "POST /api/v1/applications/{app_id}/submission",
        {
          params: { app_id: task.application_id },
          body: {
            base_revision: detail.application.revision,
            action: "confirm",
          },
          idempotencyKey: newIdempotencyKey(),
        }
      );
      commitApplicationToBoard(queryClient, result.application);
      toast.success(t("submission.confirmed"));
    });

  const cancel = () =>
    run(async () => {
      await api("POST /api/v1/tasks/{tsk_id}/cancel", {
        params: { tsk_id: task.id },
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(t("runs.cancelRequested"));
    });

  let title: string;
  let body: string;
  if (kind === "settle") {
    title = t("runs.settleTitle");
    body = t("runs.settleBody");
  } else if (kind === "retry") {
    title = t("runs.retryTitle");
    body = t("runs.retryBody");
  } else {
    title = t("runs.cancelTitle");
    body =
      task.submit_intent_at === null
        ? t("runs.cancelBody")
        : t("runs.cancelBodySubmitting");
  }

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!(open || busy)) {
          onClose();
        }
      }}
      open
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {kind === "settle" ? (
            <>
              <AlertDialogCancel disabled={busy}>
                {t("submission.notSure")}
              </AlertDialogCancel>
              <Button
                disabled={busy}
                onClick={() => retry(true)}
                variant="outline"
              >
                {t("runs.notSubmittedRetry")}
              </Button>
              <Button
                disabled={busy || task.application_id === null}
                onClick={confirmSubmitted}
              >
                {t("submission.submitted")}
              </Button>
            </>
          ) : null}
          {kind === "retry" ? (
            <>
              <AlertDialogCancel disabled={busy}>
                {t("common.cancel")}
              </AlertDialogCancel>
              <Button disabled={busy} onClick={() => retry(false)}>
                {t("runs.retry")}
              </Button>
            </>
          ) : null}
          {kind === "cancel" ? (
            <>
              <AlertDialogCancel disabled={busy}>
                {t("runs.keepRunning")}
              </AlertDialogCancel>
              <Button disabled={busy} onClick={cancel} variant="destructive">
                {t("runs.cancelRun")}
              </Button>
            </>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
