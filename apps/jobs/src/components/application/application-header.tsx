// The detail header band (12 §5.1): company · title, the Stage and Mode
// selects, the ⋯ menu (archive, follow-up, priority, open posting, delete
// for good with a typed confirmation, 06 §8), and the meta line.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import type {
  ApplicationMode,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  APPLICATION_MODES,
  STAGES,
} from "@pilihpendidikan/jobs-contracts/enums";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
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
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd } from "@rulisme/ui/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Ellipsis } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useApplicationPatch } from "@/hooks/use-conflict-write";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { canMoveTo } from "@/lib/board-move";
import { relativeTime } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import { modeLabel, sourceLabel, stageLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query";
import { safeHref } from "@/lib/safe-url";

export function ApplicationHeader({
  detail,
  nowMs,
  onMove,
  onFollowUp,
}: {
  detail: ApplicationDetail;
  nowMs: number;
  onMove: (target: Stage) => void;
  onFollowUp: () => void;
}) {
  const { locale, t } = useTranslation();
  const id = useId();
  const patch = useApplicationPatch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const stageTrigger = useRef<HTMLButtonElement>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const { application, posting, score } = detail;

  useShortcut("m", () => stageTrigger.current?.click());

  const autoAllowed =
    application.automation_rule_id !== null || application.mode === "auto";
  const postingHref = safeHref(posting.apply_url ?? posting.canonical_url);
  const confirmWord = t("detail.purgeWord");

  async function purge() {
    try {
      await api("DELETE /api/v1/applications/{app_id}", {
        params: { app_id: application.id },
        query: { purge: "1", base_revision: application.revision },
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(t("detail.purged"));
      queryClient.removeQueries({
        queryKey: queryKeys.application(application.id),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.boardAll });
      await navigate({ to: "/board" });
    } catch {
      toast.error(t("detail.purgeFailed"));
    }
  }

  const meta = [
    posting.locations[0]?.raw,
    sourceLabel(t, posting.source_kind),
    posting.posted_at
      ? t("detail.posted", {
          when: relativeTime(posting.posted_at, nowMs, locale),
        })
      : null,
    score && score.status === "ready"
      ? t("detail.score", { score: score.score })
      : null,
    posting.status === "closed"
      ? t("detail.postingClosed")
      : t("detail.postingOpen"),
  ].filter(Boolean);

  return (
    <header className="band flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="type-caption text-muted-foreground">
            {posting.company_name}
          </span>
          <h1 className="type-title text-pretty">{posting.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <label
              className="type-caption text-muted-foreground"
              htmlFor={`${id}-stage`}
            >
              {t("detail.stage")}
            </label>
            <Select
              onValueChange={(value) => onMove(value as Stage)}
              value={application.stage}
            >
              <SelectTrigger
                aria-keyshortcuts="M"
                className="h-8 w-40"
                id={`${id}-stage`}
                ref={stageTrigger}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((stage) => (
                  <SelectItem
                    disabled={!canMoveTo(application.stage, stage)}
                    key={stage}
                    value={stage}
                  >
                    {stageLabel(t, stage)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Kbd aria-hidden="true">M</Kbd>
          </div>
          <div className="flex items-center gap-1.5">
            <label
              className="type-caption text-muted-foreground"
              htmlFor={`${id}-mode`}
            >
              {t("detail.mode")}
            </label>
            <Select
              onValueChange={(value) =>
                patch(
                  application,
                  { mode: value as ApplicationMode },
                  t("detail.modeWhat")
                )
              }
              value={application.mode}
            >
              <SelectTrigger className="h-8 w-36" id={`${id}-mode`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPLICATION_MODES.map((mode) => (
                  <SelectItem
                    disabled={mode === "auto" && !autoAllowed}
                    key={mode}
                    value={mode}
                  >
                    {mode === "auto" && !autoAllowed
                      ? t("detail.autoNeedsRule")
                      : modeLabel(t, mode)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("detail.more")}
                size="icon-sm"
                variant="outline"
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {postingHref ? (
                <DropdownMenuItem asChild>
                  <a
                    href={postingHref}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {t("detail.openPosting")}
                  </a>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={onFollowUp}>
                {t("card.actions.followUp")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  patch(
                    application,
                    { priority: application.priority === 1 ? 0 : 1 },
                    t("card.what")
                  )
                }
              >
                {application.priority === 1
                  ? t("card.actions.priorityNormal")
                  : t("card.actions.priorityHigh")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  patch(
                    application,
                    { archived: !application.archived },
                    t("card.what")
                  )
                }
              >
                {application.archived
                  ? t("card.actions.unarchive")
                  : t("card.actions.archive")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setPurgeOpen(true)}
                variant="destructive"
              >
                {t("detail.purge")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <p className="type-caption flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        {meta.map((part, index) => (
          <span className="inline-flex items-center gap-2" key={String(part)}>
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            {part}
          </span>
        ))}
        {application.archived ? (
          <Badge variant="ghost">{t("card.archived")}</Badge>
        ) : null}
      </p>
      <AlertDialog
        onOpenChange={(open) => {
          setPurgeOpen(open);
          setConfirmText("");
        }}
        open={purgeOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.purgeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("detail.purgeBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
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
            <AlertDialogAction
              disabled={
                confirmText.trim().toLocaleLowerCase() !==
                confirmWord.toLocaleLowerCase()
              }
              onClick={purge}
              variant="destructive"
            >
              {t("detail.purgeAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
