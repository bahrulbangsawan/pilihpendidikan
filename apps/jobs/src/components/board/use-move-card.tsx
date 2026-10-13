// Moving an application (06 §2) from the board (drop, `M`, `1`–`7`, `r`/`w`,
// bulk) or from the detail page's stage select: validate with the contracts'
// stage machine, ask the 06 §2.2 questions, send optimistically with one
// Idempotency-Key, and report the outcome — including the 12 §11 conflict
// toast with "Apply mine anyway" / "Keep theirs".

import type {
  SubmissionMethod,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import { SUBMISSION_METHODS } from "@pilihpendidikan/jobs-contracts/enums";
import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
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
import { Field, FieldLabel } from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCallback, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { commitApplicationToBoard, pendingMoves } from "@/hooks/use-board";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import type { MoveOutcome, MoveSubject } from "@/lib/board-move";
import { checkMove, runMove } from "@/lib/board-move";
import { formatClock, fromLocalInputValue, toDateValue } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import { changeSourceLabel, methodLabel, stageLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query";

export interface MoveRequest {
  afterId?: string | null;
  beforeId?: string | null;
  card: MoveSubject & { company: string; title: string };
  /** 1-based position and column size after the move, for announcements. */
  position?: { index: number; total: number };
  target: Stage;
}

type Confirmation =
  | { kind: "confirm_applied"; request: MoveRequest }
  | { kind: "confirm_cancel_task"; request: MoveRequest; taskId: string }
  | {
      kind: "confirm_discard_approval";
      request: MoveRequest;
      taskId: string | null;
    };

interface UseMoveCardOptions {
  /** Screen-reader announcement (aria-live, 12 §12). */
  announce: (message: string) => void;
  /** Open offers on other cards, for the Accepted note (06 §2.2). */
  otherOffers?: (cardId: string) => number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function isApplication(value: unknown): value is ApplicationRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "stage" in value &&
    "revision" in value
  );
}

export function useMoveCard({ announce, otherOffers }: UseMoveCardOptions) {
  const { locale, t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const requestRef = useRef<(request: MoveRequest) => void>(() => undefined);

  const label = useCallback(
    (card: MoveRequest["card"]) =>
      t("move.cardLabel", { company: card.company, title: card.title }),
    [t]
  );

  const commit = useCallback(
    (application: ApplicationRecord) => {
      commitApplicationToBoard(queryClient, application);
      queryClient.invalidateQueries({
        queryKey: queryKeys.application(application.id),
      });
    },
    [queryClient]
  );

  const reportMoved = useCallback(
    (request: MoveRequest) => {
      const { card, target } = request;
      const to = stageLabel(t, target);
      announce(
        request.position
          ? t("move.announceMovedAt", {
              card: label(card),
              stage: to,
              index: request.position.index,
              total: request.position.total,
            })
          : t("move.announceMoved", { card: label(card), stage: to })
      );
      const others = target === "accepted" ? (otherOffers?.(card.id) ?? 0) : 0;
      if (others > 0) {
        toast.info(t("move.otherOffers", { count: others }));
      }
    },
    [announce, label, otherOffers, t]
  );

  /** 12 §11: the card snaps back; the user may re-apply their move. */
  const reportConflict = useCallback(
    (request: MoveRequest, currentValue: unknown) => {
      const { card } = request;
      const current = isApplication(currentValue) ? currentValue : null;
      const message = current
        ? t("conflict.moveOverlap", {
            company: card.company,
            stage: stageLabel(t, current.stage),
            source: changeSourceLabel(t, current.last_change_source),
            time: formatClock(current.updated_at, locale),
            mine: stageLabel(t, request.target),
          })
        : t("conflict.moveChanged");
      announce(message);
      const reapply = current
        ? {
            label: t("conflict.applyMine"),
            onClick: () =>
              requestRef.current({
                ...request,
                card: {
                  ...card,
                  stage: current.stage,
                  revision: current.revision,
                },
              }),
          }
        : undefined;
      toast.warning(message, {
        duration: 15_000,
        action: reapply,
        cancel: { label: t("conflict.keepTheirs"), onClick: () => undefined },
      });
    },
    [announce, locale, t]
  );

  const report = useCallback(
    (request: MoveRequest, outcome: MoveOutcome) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.boardAll });
      if (outcome.kind === "moved") {
        reportMoved(request);
        return;
      }
      if (outcome.kind === "conflict") {
        reportConflict(request, outcome.current);
        return;
      }
      let message = t("move.failed");
      if (outcome.kind === "invalid") {
        message =
          outcome.reason === "submission_in_flight"
            ? t("move.submissionInFlight")
            : t("move.refused", { message: outcome.message });
      } else if (outcome.kind === "network_failed") {
        message = t("move.networkFailed");
      }
      announce(message);
      toast.error(message);
    },
    [announce, queryClient, reportConflict, reportMoved, t]
  );

  const send = useCallback(
    async (request: MoveRequest) => {
      const { card, target } = request;
      const beforeId = request.beforeId ?? null;
      const afterId = request.afterId ?? null;
      const outcome = await runMove({
        card,
        target,
        beforeId,
        afterId,
        idempotencyKey: newIdempotencyKey(),
        pending: pendingMoves,
        commit,
        sleep,
        send: async (idempotencyKey) =>
          (
            await api("POST /api/v1/applications/{app_id}/move", {
              params: { app_id: card.id },
              body: {
                base_revision: card.revision,
                stage: target,
                ...(beforeId ? { before_id: beforeId } : {}),
                ...(afterId ? { after_id: afterId } : {}),
              },
              idempotencyKey,
            })
          ).application,
      });
      report(request, outcome);
      return outcome;
    },
    [commit, report]
  );

  const cancelTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      try {
        await api("POST /api/v1/tasks/{tsk_id}/cancel", {
          params: { tsk_id: taskId },
          idempotencyKey: newIdempotencyKey(),
        });
        return true;
      } catch (error) {
        toast.error(
          isApiError(error) && error.code === "too_late"
            ? t("move.cancelTooLate")
            : t("move.cancelFailed")
        );
        return false;
      }
    },
    [t]
  );

  /** "Yes, I applied": the user's attestation (06 §2.2), then the position. */
  const markApplied = useCallback(
    async (
      request: MoveRequest,
      method: SubmissionMethod,
      appliedAt: number
    ) => {
      try {
        const { application } = await api(
          "POST /api/v1/applications/{app_id}/submission",
          {
            params: { app_id: request.card.id },
            body: {
              base_revision: request.card.revision,
              action: "mark_applied",
              method,
              applied_at: appliedAt,
            },
            idempotencyKey: newIdempotencyKey(),
          }
        );
        commit(application);
        if (request.beforeId || request.afterId) {
          await send({
            ...request,
            card: {
              ...request.card,
              stage: application.stage,
              revision: application.revision,
            },
          });
        } else {
          report(request, { kind: "moved", application, attempts: 1 });
        }
      } catch (error) {
        queryClient.invalidateQueries({ queryKey: queryKeys.boardAll });
        if (isApiError(error) && error.isRevisionConflict) {
          report(request, {
            kind: "conflict",
            current: error.current ?? null,
            attempts: 1,
          });
          return;
        }
        toast.error(t("move.failed"));
      }
    },
    [commit, queryClient, report, send, t]
  );

  const requestMove = useCallback(
    (request: MoveRequest) => {
      const check = checkMove(request.card, request.target);
      const from = stageLabel(t, request.card.stage);
      const to = stageLabel(t, request.target);
      switch (check.kind) {
        case "illegal": {
          const message = t("move.illegal", { from, to });
          announce(message);
          toast.error(message);
          return;
        }
        case "submission_in_flight": {
          const message = t("move.submissionInFlight");
          announce(message);
          toast.error(message);
          return;
        }
        case "confirm_applied":
          setConfirmation({ kind: "confirm_applied", request });
          return;
        case "confirm_cancel_task":
          setConfirmation({
            kind: "confirm_cancel_task",
            request,
            taskId: check.taskId,
          });
          return;
        case "confirm_discard_approval":
          setConfirmation({
            kind: "confirm_discard_approval",
            request,
            taskId: request.card.live_task?.id ?? null,
          });
          return;
        default:
          send(request);
      }
    },
    [announce, send, t]
  );
  requestRef.current = requestMove;

  const close = () => setConfirmation(null);

  const dialogs: ReactNode = (
    <>
      <ConfirmAppliedDialog
        onJustMove={() => {
          if (confirmation?.kind === "confirm_applied") {
            send(confirmation.request);
          }
          close();
        }}
        onMarkApplied={(method, appliedAt) => {
          if (confirmation?.kind === "confirm_applied") {
            markApplied(confirmation.request, method, appliedAt);
          }
          close();
        }}
        onOpenChange={(open) => !open && close()}
        open={confirmation?.kind === "confirm_applied"}
      />
      <AlertDialog
        onOpenChange={(open) => !open && close()}
        open={confirmation?.kind === "confirm_cancel_task"}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("move.cancelTaskTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("move.cancelTaskBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("move.keepRunning")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const pending = confirmation;
                close();
                if (
                  pending?.kind === "confirm_cancel_task" &&
                  (await cancelTask(pending.taskId))
                ) {
                  send(pending.request);
                }
              }}
              variant="destructive"
            >
              {t("move.cancelAndMove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={(open) => !open && close()}
        open={confirmation?.kind === "confirm_discard_approval"}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("move.discardTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("move.discardBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("move.keepApproval")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const pending = confirmation;
                close();
                if (pending?.kind !== "confirm_discard_approval") {
                  return;
                }
                if (pending.taskId && !(await cancelTask(pending.taskId))) {
                  return;
                }
                send(pending.request);
              }}
              variant="destructive"
            >
              {t("move.discardAndMove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return { requestMove, dialogs };
}

function ConfirmAppliedDialog({
  open,
  onOpenChange,
  onMarkApplied,
  onJustMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkApplied: (method: SubmissionMethod, appliedAt: number) => void;
  onJustMove: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [method, setMethod] = useState<SubmissionMethod>("manual");
  const [day, setDay] = useState(() => toDateValue(Date.now()));
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("move.appliedTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("move.appliedBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <Button onClick={onJustMove} variant="outline">
            {t("move.justMove")}
          </Button>
          <AlertDialogAction
            onClick={() =>
              onMarkApplied(
                method,
                Math.min(Date.now(), fromLocalInputValue(day) ?? Date.now())
              )
            }
          >
            {t("move.yesApplied")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
