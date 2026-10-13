// Confirming an uncertain submission (03 §5.2, D-18): "Unconfirmed" and
// "Needs review" are settled only by the user — Submitted (confirm), Not
// submitted (deny) or Not sure (leave it).

import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
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
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";

export function SubmissionDialog({
  application,
  open,
  onOpenChange,
  onSaved,
}: {
  application: ApplicationRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (application: ApplicationRecord) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const unknown = application.submission_status === "outcome_unknown";

  async function decide(action: "confirm" | "deny") {
    setBusy(true);
    try {
      const result = await api(
        "POST /api/v1/applications/{app_id}/submission",
        {
          params: { app_id: application.id },
          body: { base_revision: application.revision, action },
          idempotencyKey: newIdempotencyKey(),
        }
      );
      onSaved(result.application);
      toast.success(
        action === "confirm"
          ? t("submission.confirmed")
          : t("submission.denied")
      );
      onOpenChange(false);
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

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {unknown
              ? t("submission.unknownTitle")
              : t("submission.confirmTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {unknown
              ? t("submission.unknownBody")
              : t("submission.confirmBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("submission.notSure")}</AlertDialogCancel>
          <Button
            disabled={busy}
            onClick={() => decide("deny")}
            variant="outline"
          >
            {t("submission.notSubmitted")}
          </Button>
          <Button disabled={busy} onClick={() => decide("confirm")}>
            {t("submission.submitted")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
