// Bulk actions on the selected cards (06 §9): each card is its own request
// with its own base_revision and Idempotency-Key, four at a time; the summary
// lists per-card success, skips and conflicts.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type {
  ApplicationMode,
  CvTemplate,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  APPLICATION_MODES,
  CV_TEMPLATES,
  STAGES,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@rulisme/ui/ui/alert-dialog";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { commitApplicationToBoard } from "@/hooks/use-board";
import { useBaseCvs } from "@/hooks/use-cvs";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { canMoveTo, hasLiveTask } from "@/lib/board-move";
import type { BulkItemResult } from "@/lib/bulk";
import {
  autoModeAllowed,
  BULK_CV_LIMIT,
  BulkSkip,
  bulkArchiveTarget,
  bulkMoveSkip,
  bulkPurgeBlock,
  runBulk,
  summarizeBulk,
} from "@/lib/bulk";
import { FOLLOW_UP_PRESETS, presetFollowUpAt } from "@/lib/follow-up";
import { newIdempotencyKey } from "@/lib/idempotency";
import { modeLabel, stageLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query";

export interface BulkReport {
  action: string;
  cards: ReadonlyMap<string, BoardCard>;
  results: BulkItemResult[];
}

interface PatchBody {
  archived?: boolean;
  follow_up_at?: number | null;
  mode?: ApplicationMode;
  priority?: number;
}

export function BulkBar({
  selected,
  onClear,
  onReport,
}: {
  selected: readonly BoardCard[];
  onClear: () => void;
  onReport: (report: BulkReport) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [cvOpen, setCvOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);

  async function run(
    action: string,
    cards: readonly BoardCard[],
    worker: (card: BoardCard) => Promise<void>
  ) {
    setBusy(true);
    const byId = new Map(cards.map((card) => [card.id, card]));
    try {
      const results = await runBulk(
        cards.map((card) => card.id),
        (cardId) => worker(byId.get(cardId) as BoardCard)
      );
      const summary = summarizeBulk(results);
      const message = t("bulk.summary", {
        ok: summary.ok,
        skipped: summary.skipped,
        conflict: summary.conflict,
        failed: summary.failed,
      });
      const report: BulkReport = { action, cards: byId, results };
      (summary.failed + summary.conflict > 0 ? toast.warning : toast.success)(
        message,
        {
          description: action,
          action: { label: t("bulk.details"), onClick: () => onReport(report) },
        }
      );
      if (summary.ok > 0) {
        onClear();
      }
    } finally {
      setBusy(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.boardAll });
    }
  }

  function patchAll(action: string, body: PatchBody) {
    return run(action, selected, async (card) => {
      // A PATCH that changes nothing would still bump the revision and add a
      // timeline event: report it as already done instead.
      if (patchIsNoOp(card, body)) {
        throw new BulkSkip("unchanged", t("bulk.unchanged"));
      }
      const { application } = await api("PATCH /api/v1/applications/{app_id}", {
        params: { app_id: card.id },
        body: { ...body, base_revision: card.revision },
        idempotencyKey: newIdempotencyKey(),
      });
      commitApplicationToBoard(queryClient, application);
    });
  }

  /**
   * `auto` only where an enabled auto rule matched (06 §9): each card's
   * application is read first (the board card lacks the rule) and the PATCH
   * uses that fresh revision; the others are skipped with the reason.
   */
  function setAutoMode() {
    return run(t("bulk.mode"), selected, async (card) => {
      if (card.mode === "auto") {
        throw new BulkSkip("unchanged", t("bulk.unchanged"));
      }
      const detail = await api("GET /api/v1/applications/{app_id}", {
        params: { app_id: card.id },
      });
      if (!autoModeAllowed(detail.application)) {
        throw new BulkSkip("no_auto_rule", t("bulk.autoNeedsRule"));
      }
      const { application } = await api("PATCH /api/v1/applications/{app_id}", {
        params: { app_id: card.id },
        body: { mode: "auto", base_revision: detail.application.revision },
        idempotencyKey: newIdempotencyKey(),
      });
      commitApplicationToBoard(queryClient, application);
    });
  }

  function moveAll(target: Stage) {
    return run(
      t("bulk.moveTo", { stage: stageLabel(t, target) }),
      selected,
      async (card) => {
        const skip = bulkMoveSkip(card, target);
        if (skip) {
          throw skip;
        }
        if (
          (target === "rejected" || target === "withdrawn") &&
          hasLiveTask(card)
        ) {
          throw new BulkSkip("live_task", t("bulk.liveTask"));
        }
        const { application } = await api(
          "POST /api/v1/applications/{app_id}/move",
          {
            params: { app_id: card.id },
            body: { base_revision: card.revision, stage: target },
            idempotencyKey: newIdempotencyKey(),
          }
        );
        commitApplicationToBoard(queryClient, application);
      }
    );
  }

  async function requestScoring() {
    setBusy(true);
    try {
      const result = await api("POST /api/v1/scores:request", {
        body: { user_job_ids: selected.map((card) => card.user_job_id) },
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(
        t("bulk.scoring", {
          queued: result.queued.length,
          cached: result.cached.length,
        })
      );
      onClear();
    } catch {
      toast.error(t("bulk.scoringFailed"));
    } finally {
      setBusy(false);
    }
  }

  function queueApply() {
    return run(t("bulk.queueApply"), selected, async (card) => {
      if (card.mode === "manual") {
        throw new BulkSkip("manual_mode", t("bulk.manualMode"));
      }
      if (hasLiveTask(card)) {
        throw new BulkSkip("live_task", t("bulk.alreadyRunning"));
      }
      const key = newIdempotencyKey();
      await api("POST /api/v1/tasks", {
        body: {
          kind: "apply",
          application_id: card.id,
          payload: { mode: card.mode },
          idempotency_key: key,
        },
        idempotencyKey: key,
      });
    });
  }

  function generateCvs(baseCvId: string, template: CvTemplate) {
    setCvOpen(false);
    const cards = selected.slice(0, BULK_CV_LIMIT);
    if (selected.length > BULK_CV_LIMIT) {
      toast.info(t("bulk.cvCapped", { limit: BULK_CV_LIMIT }));
    }
    return run(t("bulk.generateCv"), cards, async (card) => {
      await api("POST /api/v1/applications/{app_id}/cv-variants", {
        params: { app_id: card.id },
        body: { base_cv_id: baseCvId, template, tailor: true },
        idempotencyKey: newIdempotencyKey(),
      });
    });
  }

  function purgeAll() {
    setPurgeOpen(false);
    return run(t("bulk.purge"), selected, async (card) => {
      const block = bulkPurgeBlock(card);
      if (block === "submission_in_flight") {
        throw new BulkSkip(block, t("bulk.purgeSubmission"));
      }
      if (block === "live_task") {
        throw new BulkSkip(block, t("bulk.purgeLiveTask"));
      }
      await api("DELETE /api/v1/applications/{app_id}", {
        params: { app_id: card.id },
        query: { purge: "1", base_revision: card.revision },
        idempotencyKey: newIdempotencyKey(),
      });
      queryClient.removeQueries({ queryKey: queryKeys.application(card.id) });
    });
  }

  if (selected.length === 0) {
    return null;
  }
  const archiveTarget = bulkArchiveTarget(selected);
  const archiveLabel = archiveTarget ? t("bulk.archive") : t("bulk.unarchive");
  const purgeBlocked = selected.filter(
    (card) => bulkPurgeBlock(card) !== null
  ).length;
  return (
    <div
      aria-label={t("bulk.toolbar")}
      className="band flex flex-wrap items-center gap-1.5 bg-pane px-4 py-2 sm:px-6"
      role="toolbar"
    >
      <span
        className="type-body-compact weight-semibold mr-2 tabular-nums"
        role="status"
      >
        {t("bulk.selected", { count: selected.length })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button disabled={busy} size="sm" variant="outline">
            {t("bulk.move")}
            <ChevronDown aria-hidden="true" data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {STAGES.map((stage) => {
            const movable = selected.filter(
              (card) => card.stage !== stage && canMoveTo(card.stage, stage)
            ).length;
            return (
              <DropdownMenuItem key={stage} onSelect={() => moveAll(stage)}>
                {stageLabel(t, stage)}
                <span className="type-micro ml-auto text-muted-foreground tabular-nums">
                  {movable}/{selected.length}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        disabled={busy}
        onClick={() => patchAll(archiveLabel, { archived: archiveTarget })}
        size="sm"
        variant="outline"
      >
        {archiveLabel}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button disabled={busy} size="sm" variant="outline">
            {t("bulk.more")}
            <ChevronDown aria-hidden="true" data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={() => patchAll(t("bulk.priority"), { priority: 1 })}
          >
            {t("card.actions.priorityHigh")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => patchAll(t("bulk.priority"), { priority: 0 })}
          >
            {t("card.actions.priorityNormal")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => patchAll(t("bulk.priority"), { priority: -1 })}
          >
            {t("card.actions.priorityLow")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {FOLLOW_UP_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.key}
              onSelect={() =>
                patchAll(t("bulk.followUp"), {
                  follow_up_at: presetFollowUpAt(Date.now(), preset.days),
                })
              }
            >
              {t("bulk.followUpIn", {
                when: t(`followUp.presets.${preset.key}`),
              })}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onSelect={() =>
              patchAll(t("bulk.followUp"), { follow_up_at: null })
            }
          >
            {t("bulk.followUpClear")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {APPLICATION_MODES.map((mode) => (
            <DropdownMenuItem
              key={mode}
              onSelect={() =>
                mode === "auto"
                  ? setAutoMode()
                  : patchAll(t("bulk.mode"), { mode })
              }
            >
              {mode === "auto"
                ? t("bulk.setModeAuto")
                : t("bulk.setMode", { mode: modeLabel(t, mode) })}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={requestScoring}>
            {t("bulk.requestScoring")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCvOpen(true)}>
            {t("bulk.generateCv")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={queueApply}>
            {t("bulk.queueApply")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setPurgeOpen(true)}
            variant="destructive"
          >
            {t("bulk.purgeMenu")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button className="ml-auto" onClick={onClear} size="sm" variant="ghost">
        <X aria-hidden="true" data-icon="inline-start" />
        {t("bulk.clear")}
      </Button>
      <GenerateCvDialog
        count={selected.length}
        onGenerate={generateCvs}
        onOpenChange={setCvOpen}
        open={cvOpen}
      />
      <PurgeDialog
        blocked={purgeBlocked}
        count={selected.length - purgeBlocked}
        onConfirm={purgeAll}
        onOpenChange={setPurgeOpen}
        open={purgeOpen}
      />
    </div>
  );
}

function patchIsNoOp(card: BoardCard, body: PatchBody): boolean {
  return Object.entries(body).every(
    ([key, value]) => card[key as keyof PatchBody] === value
  );
}

/**
 * Bulk permanent delete (06 §11): the same `DELETE …?purge=1` as the detail
 * page, behind the same typed confirmation word.
 */
function PurgeDialog({
  open,
  onOpenChange,
  onConfirm,
  count,
  blocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  count: number;
  blocked: number;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [confirmText, setConfirmText] = useState("");
  const confirmWord = t("detail.purgeWord");
  const confirmed =
    confirmText.trim().toLocaleLowerCase() === confirmWord.toLocaleLowerCase();
  return (
    <AlertDialog
      onOpenChange={(next) => {
        onOpenChange(next);
        setConfirmText("");
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("bulk.purgeTitle", { count })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("detail.purgeBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {blocked > 0 ? (
          <p className="type-caption text-muted-foreground">
            {t("bulk.purgeBlocked", { count: blocked })}
          </p>
        ) : null}
        <Field>
          <FieldLabel htmlFor={`${id}-confirm`}>
            {t("detail.purgeConfirm", { word: confirmWord })}
          </FieldLabel>
          <Input
            autoComplete="off"
            className="field-touch"
            id={`${id}-confirm`}
            onChange={(event) => setConfirmText(event.target.value)}
            value={confirmText}
          />
          <FieldDescription>{t("detail.purgeHelp")}</FieldDescription>
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <Button
            disabled={!confirmed || count === 0}
            onClick={() => {
              setConfirmText("");
              onConfirm();
            }}
            variant="destructive"
          >
            {t("bulk.purgeAction", { count })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function GenerateCvDialog({
  open,
  onOpenChange,
  onGenerate,
  count,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (baseCvId: string, template: CvTemplate) => void;
  count: number;
}) {
  const { t } = useTranslation();
  const id = useId();
  const cvs = useBaseCvs(open);
  const [cvId, setCvId] = useState("");
  const [template, setTemplate] = useState<CvTemplate>("standard");
  const bases = (cvs.data ?? []).filter((cv) => !cv.is_tailored);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("bulk.generateCvTitle")}</DialogTitle>
          <DialogDescription>
            {t("bulk.generateCvBody", {
              count: Math.min(count, BULK_CV_LIMIT),
            })}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={`${id}-cv`}>{t("cv.baseCv")}</FieldLabel>
          <Select onValueChange={setCvId} value={cvId}>
            <SelectTrigger className="w-full" id={`${id}-cv`}>
              <SelectValue
                placeholder={
                  cvs.isLoading ? t("common.loading") : t("cv.pickBase")
                }
              />
            </SelectTrigger>
            <SelectContent>
              {bases.map((cv) => (
                <SelectItem key={cv.id} value={cv.id}>
                  {cv.full_name || cv.id} · {cv.job_title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-template`}>{t("cv.template")}</FieldLabel>
          <Select
            onValueChange={(value) => setTemplate(value as CvTemplate)}
            value={template}
          >
            <SelectTrigger className="w-full" id={`${id}-template`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CV_TEMPLATES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`cv.templates.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {t("common.cancel")}
          </Button>
          <Button disabled={!cvId} onClick={() => onGenerate(cvId, template)}>
            {t("bulk.generateCv")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BulkResultsDialog({
  report,
  onClose,
}: {
  report: BulkReport | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const variants = {
    ok: "secondary",
    skipped: "outline",
    conflict: "outline",
    failed: "destructive",
  } as const;
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={report !== null}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("bulk.resultsTitle")}</DialogTitle>
          <DialogDescription>{report?.action}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-line border-line border-y">
          {report?.results.map((result) => {
            const card = report.cards.get(result.id);
            return (
              <li
                className="flex items-start justify-between gap-3 py-2"
                key={result.id}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="type-body-compact truncate text-foreground">
                    {card
                      ? `${card.posting.company_name} · ${card.posting.title}`
                      : result.id}
                  </span>
                  {result.message && result.status !== "ok" ? (
                    <span className="type-caption text-muted-foreground">
                      {result.reason === "invalid_transition" && card
                        ? t("bulk.illegalReason")
                        : result.message}
                    </span>
                  ) : null}
                </div>
                <Badge variant={variants[result.status]}>
                  {t(`bulk.status.${result.status}`)}
                </Badge>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
