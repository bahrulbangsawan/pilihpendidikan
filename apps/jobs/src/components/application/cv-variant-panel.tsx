// One CV variant under review (08 §7): status, in-browser rendering of a
// `generating` variant (§6.2), notes_for_user as warnings, the PDF in a
// same-origin iframe of the BFF's content route, the side-by-side diff, and
// Approve `Y` / Reject / Regenerate / Download / Open in CV builder.

import type {
  ApplicationRecord,
  CvVariantRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
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
import { AspectRatio } from "@rulisme/ui/ui/aspect-ratio";
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
import { Field, FieldDescription, FieldLabel } from "@rulisme/ui/ui/field";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { Spinner } from "@rulisme/ui/ui/spinner";
import { Textarea } from "@rulisme/ui/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  Download,
  ExternalLink,
  FileText,
  RefreshCw,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { cvBuilderOrigin } from "@/hooks/use-cvs";
import {
  needsInBrowserRender,
  useCvVariantDetail,
  useInBrowserRender,
} from "@/hooks/use-cv-variant";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { buildDiffModel, parseDiff } from "@/lib/cv-diff";
import { formatDateTime } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";
import { CvDiffView } from "./cv-diff-view";

const REJECT_REASON_MAX = 500;

export function contentHref(fileId: string, inline: boolean): string {
  return `/download/files/${encodeURIComponent(fileId)}/content${inline ? "?inline=1" : ""}`;
}

function PdfPreview({ fileId, title }: { fileId: string; title: string }) {
  const { t } = useTranslation();
  return (
    <figure className="flex w-full max-w-xl flex-col gap-2">
      <AspectRatio
        className="border border-line bg-card"
        ratio={1 / Math.SQRT2}
      >
        {/*
          No `sandbox` attribute: Chromium refuses to show any PDF inside a
          sandboxed frame. The containment lives on the response instead
          (src/lib/download.ts + edge-policy.ts): only `application/pdf` is
          served inline, with `nosniff`, `default-src 'none'` (nothing can
          run) and `frame-ancestors 'self'` / `X-Frame-Options: SAMEORIGIN`.
        */}
        <iframe
          className="size-full"
          referrerPolicy="no-referrer"
          src={contentHref(fileId, true)}
          title={title}
        />
      </AspectRatio>
      <figcaption className="type-caption text-muted-foreground">
        {t("cv.previewCaption")}
      </figcaption>
    </figure>
  );
}

function RenderStatus({
  variant,
  applicationId,
}: {
  variant: CvVariantRecord;
  applicationId: string;
}) {
  const { t } = useTranslation();
  const render = useInBrowserRender(variant, applicationId);
  if (!needsInBrowserRender(variant)) {
    if (variant.status === "generating") {
      return (
        <p className="type-body flex items-center gap-2" role="status">
          <Spinner aria-hidden="true" className="size-4" />
          {t("cv.tailoring")}
        </p>
      );
    }
    return null;
  }
  if (render.state === "error") {
    return (
      <Alert role="alert" variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>{t("cv.renderFailedTitle")}</AlertTitle>
        <AlertDescription>{t(`render.errors.${render.code}`)}</AlertDescription>
        <AlertAction>
          <Button onClick={render.retry} size="sm" variant="outline">
            {t("common.retry")}
          </Button>
        </AlertAction>
      </Alert>
    );
  }
  return (
    <p className="type-body flex items-center gap-2" role="status">
      <Spinner aria-hidden="true" className="size-4" />
      {t("cv.rendering")}
    </p>
  );
}

export function CvVariantPanel({
  variant,
  application,
  company,
  onApprovableChange,
  onRegenerate,
}: {
  variant: CvVariantRecord;
  application: ApplicationRecord;
  /** The employer, named in the approval question. */
  company: string;
  /** The tab owns `Y` while a draft is on screen (the rail yields it). */
  onApprovableChange: (approvable: boolean) => void;
  onRegenerate: (variant: CvVariantRecord) => void;
}) {
  const { locale, t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const detail = useCvVariantDetail(
    variant.id,
    variant.status === "generating"
  );
  const current = detail.data?.cv_variant ?? variant;
  const model = useMemo(() => {
    const diff = parseDiff(current.diff);
    return diff ? buildDiffModel(diff, detail.data?.tailored_cv) : null;
  }, [current.diff, detail.data?.tailored_cv]);
  const [confirm, setConfirm] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const approvable = current.status === "draft" && current.file_id !== null;

  useEffect(() => {
    onApprovableChange(approvable);
    return () => onApprovableChange(false);
  }, [approvable, onApprovableChange]);

  useShortcut("y", () => setConfirm("approve"), approvable);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.application(application.id),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.cvVariant(current.id),
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.boardAll }),
    ]);
  }

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    try {
      if (action === "approve") {
        await api("POST /api/v1/cv-variants/{cvv_id}/approve", {
          params: { cvv_id: current.id },
          body: { base_revision: current.revision },
          idempotencyKey: newIdempotencyKey(),
        });
      } else {
        const text = reason.trim();
        await api("POST /api/v1/cv-variants/{cvv_id}/reject", {
          params: { cvv_id: current.id },
          body: {
            base_revision: current.revision,
            ...(text ? { reason: text.slice(0, REJECT_REASON_MAX) } : {}),
          },
          idempotencyKey: newIdempotencyKey(),
        });
      }
      toast.success(action === "approve" ? t("cv.approved") : t("cv.rejected"));
      setConfirm(null);
      setReason("");
      await refresh();
    } catch (error) {
      let message = t("cv.decideFailed");
      if (isApiError(error) && error.isRevisionConflict) {
        message = t("cv.changed");
        await refresh();
      } else if (isApiError(error) && error.status === 422) {
        message = t("cv.needsPdf");
      }
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  const attached = current.id === application.cv_variant_id;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-5 border-line border-t pt-5"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="type-subtitle weight-semibold" id={`${id}-title`}>
          {t("cv.variantTitle", {
            template: t(`cv.templates.${current.template}`),
          })}
        </h3>
        <Badge
          variant={current.status === "failed" ? "destructive" : "outline"}
        >
          {t(`cv.statuses.${current.status}`)}
        </Badge>
        {attached ? (
          <Badge variant="secondary">{t("cv.attached")}</Badge>
        ) : null}
        {detail.data?.edited_after_approval ? (
          <Badge variant="outline">{t("cv.editedAfterApproval")}</Badge>
        ) : null}
        <span className="type-caption text-muted-foreground">
          {formatDateTime(current.created_at, locale)}
          {current.model ? ` · ${current.model}` : ""}
        </span>
      </header>

      <RenderStatus applicationId={application.id} variant={current} />

      {current.status === "failed" ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("cv.failedTitle")}</AlertTitle>
          <AlertDescription>{t("cv.failedBody")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {approvable ? (
          <>
            <Button
              aria-keyshortcuts="Y"
              disabled={busy}
              onClick={() => setConfirm("approve")}
              variant="outline"
            >
              {t("cv.approve")}
              <Kbd aria-hidden="true">Y</Kbd>
            </Button>
            <Button
              disabled={busy}
              onClick={() => setConfirm("reject")}
              variant="ghost"
            >
              {t("cv.reject")}
            </Button>
          </>
        ) : null}
        {current.status !== "generating" ? (
          <Button
            disabled={busy}
            onClick={() => onRegenerate(current)}
            variant="ghost"
          >
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
            {t("cv.regenerate")}
          </Button>
        ) : null}
        {current.file_id ? (
          <Button asChild variant="ghost">
            <a download href={contentHref(current.file_id, false)}>
              <Download aria-hidden="true" data-icon="inline-start" />
              {t("cv.download")}
            </a>
          </Button>
        ) : null}
        {current.tailored_cv_id ? (
          <Button asChild variant="ghost">
            <a
              href={`${cvBuilderOrigin()}/?id=${encodeURIComponent(current.tailored_cv_id)}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              <ExternalLink aria-hidden="true" data-icon="inline-start" />
              {t("cv.openInBuilder")}
            </a>
          </Button>
        ) : null}
      </div>

      <div className="@container">
        <div className="grid @5xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] gap-6">
          <div className="min-w-0">
            {model ? <CvDiffView model={model} /> : null}
            {!model && detail.isPending ? (
              <div aria-hidden="true" className="flex flex-col gap-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : null}
            {!(model || detail.isPending) ? (
              <p className="type-body text-muted-foreground">
                {t("cv.noDiff")}
              </p>
            ) : null}
          </div>
          <div className="min-w-0">
            {current.file_id ? (
              <PdfPreview
                fileId={current.file_id}
                title={t("cv.previewTitle")}
              />
            ) : (
              <p className="type-caption flex items-center gap-2 text-muted-foreground">
                <FileText aria-hidden="true" className="size-4" />
                {t("cv.noPdf")}
              </p>
            )}
          </div>
        </div>
      </div>

      <AlertDialog
        onOpenChange={(open) => setConfirm(open ? "approve" : null)}
        open={confirm === "approve"}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cv.approveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cv.approveBody", { company })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                decide("approve");
              }}
            >
              {t("cv.approve")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        onOpenChange={(open) => setConfirm(open ? "reject" : null)}
        open={confirm === "reject"}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cv.rejectTitle")}</DialogTitle>
            <DialogDescription>{t("cv.rejectBody")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`${id}-reason`}>
              {t("cv.rejectReason")}
            </FieldLabel>
            <Textarea
              className="field-touch"
              id={`${id}-reason`}
              maxLength={REJECT_REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
            <FieldDescription>{t("cv.rejectReasonHelp")}</FieldDescription>
          </Field>
          <DialogFooter>
            <Button onClick={() => setConfirm(null)} variant="ghost">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => decide("reject")}
              variant="outline"
            >
              {t("cv.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
