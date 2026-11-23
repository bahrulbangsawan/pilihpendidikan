// The full page's header (12 §5.1, reui's sheet / navbar header): company
// avatar, role and company, "Open the posting", the ⋯ menu (follow-up,
// priority, archive, delete for good with a typed confirmation, 06 §8), and
// the property chips with the stage select (`M`).

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  ArrowUp,
  CalendarClock,
  Ellipsis,
  ExternalLink,
  Minus,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useApplicationPatch } from "@/hooks/use-conflict-write";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";
import { safeHref } from "@/lib/safe-url";
import {
  ApplicationIdentity,
  ApplicationProperties,
} from "./application-summary";

export function ApplicationHeader({
  detail,
  onMove,
  onFollowUp,
}: {
  detail: ApplicationDetail;
  onMove: (target: Stage) => void;
  onFollowUp: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const patch = useApplicationPatch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const { application, posting } = detail;
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

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ApplicationIdentity
          detail={detail}
          title={
            <h1 className="type-title weight-semibold text-pretty text-foreground">
              {posting.title}
            </h1>
          }
        />
        <div className="flex items-center gap-2">
          {postingHref ? (
            <Button asChild size="sm" variant="outline">
              <a href={postingHref} rel="noopener noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" data-icon="inline-start" />
                {t("detail.openPosting")}
              </a>
            </Button>
          ) : null}
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
              <DropdownMenuItem onSelect={onFollowUp}>
                <CalendarClock aria-hidden="true" />
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
                {application.priority === 1 ? (
                  <Minus aria-hidden="true" />
                ) : (
                  <ArrowUp aria-hidden="true" />
                )}
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
                {application.archived ? (
                  <ArchiveRestore aria-hidden="true" />
                ) : (
                  <Archive aria-hidden="true" />
                )}
                {application.archived
                  ? t("card.actions.unarchive")
                  : t("card.actions.archive")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setPurgeOpen(true)}
                variant="destructive"
              >
                <Trash2 aria-hidden="true" />
                {t("detail.purge")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ApplicationProperties detail={detail} onMove={onMove} />
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
