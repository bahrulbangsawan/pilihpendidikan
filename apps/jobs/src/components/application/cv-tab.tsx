// CV tab (12 §5.1, 08 §7): pick the base CV and template, generate a tailored
// variant, choose a variant from the list and review it in the panel below
// (diff with sources, PDF preview, Approve `Y` / Reject / Regenerate /
// Download / Open in CV builder). A `generating` variant whose tailored
// document exists is rendered to PDF right here (08 §6.2).

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import type { CvTemplate } from "@pilihpendidikan/jobs-contracts/enums";
import { CV_TEMPLATES } from "@pilihpendidikan/jobs-contracts/enums";
import type { CvVariantRecord } from "@pilihpendidikan/jobs-contracts/records";
import { cn } from "@rulisme/ui/lib/utils";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Field, FieldDescription, FieldLabel } from "@rulisme/ui/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { cvBuilderOrigin, useBaseCvs } from "@/hooks/use-cvs";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";
import { CvVariantPanel } from "./cv-variant-panel";

const STATUS_VARIANT: Record<
  CvVariantRecord["status"],
  "secondary" | "outline" | "destructive"
> = {
  generating: "outline",
  draft: "outline",
  approved: "secondary",
  rejected: "outline",
  failed: "destructive",
};

/** The variant the panel opens on: the one asked for, a draft, the attached one, the newest. */
export function defaultVariantId(
  detail: ApplicationDetail,
  preferred: string | null
): string | null {
  const variants = detail.cv_variants;
  if (preferred && variants.some((variant) => variant.id === preferred)) {
    return preferred;
  }
  const newest = [...variants].sort((a, b) => b.created_at - a.created_at);
  return (
    newest.find((variant) => variant.status === "draft")?.id ??
    newest.find((variant) => variant.status === "generating")?.id ??
    detail.application.cv_variant_id ??
    newest[0]?.id ??
    null
  );
}

export function CvTab({
  detail,
  preferredVariantId = null,
  onApprovableChange,
}: {
  detail: ApplicationDetail;
  /** From the Next-step rail's "Review CV" (its cvVariantId). */
  preferredVariantId?: string | null;
  onApprovableChange: (approvable: boolean) => void;
}) {
  const { locale, t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const cvs = useBaseCvs();
  const { application } = detail;
  const [baseCv, setBaseCv] = useState<string>(application.base_cv_id ?? "");
  const [template, setTemplate] = useState<CvTemplate>("standard");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const bases = (cvs.data ?? []).filter((cv) => !cv.is_tailored);
  const variants = [...detail.cv_variants].sort(
    (a, b) => b.created_at - a.created_at
  );
  const selectedId = defaultVariantId(detail, picked ?? preferredVariantId);
  const selected = variants.find((variant) => variant.id === selectedId);

  async function generate(base: string, chosen: CvTemplate) {
    setBusy(true);
    try {
      const result = await api(
        "POST /api/v1/applications/{app_id}/cv-variants",
        {
          params: { app_id: application.id },
          body: { base_cv_id: base, template: chosen, tailor: true },
          idempotencyKey: newIdempotencyKey(),
        }
      );
      setPicked(result.cv_variant.id);
      toast.success(t("cv.generating"));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.application(application.id),
      });
    } catch (error) {
      toast.error(
        isApiError(error) && error.code === "ai_budget_exhausted"
          ? t("cv.budget")
          : t("cv.generateFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="cv-generate-heading"
        className="flex max-w-2xl flex-col gap-3"
      >
        <h2 className="type-subtitle weight-semibold" id="cv-generate-heading">
          {t("cv.generateHeading")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-base`}>{t("cv.baseCv")}</FieldLabel>
            <Select onValueChange={setBaseCv} value={baseCv}>
              <SelectTrigger className="w-full" id={`${id}-base`}>
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
            {cvs.isSuccess && bases.length === 0 ? (
              <FieldDescription>
                {t("cv.noBase")}{" "}
                <a
                  className="text-primary hover:underline"
                  href={cvBuilderOrigin()}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {t("cv.openBuilder")}
                </a>
              </FieldDescription>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-template`}>
              {t("cv.template")}
            </FieldLabel>
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
        </div>
        <Button
          className="self-start"
          disabled={!baseCv || busy}
          onClick={() => generate(baseCv, template)}
          variant="outline"
        >
          <Sparkles aria-hidden="true" data-icon="inline-start" />
          {t("cv.generate")}
        </Button>
      </section>
      <section
        aria-labelledby="cv-variants-heading"
        className="flex flex-col gap-3"
      >
        <h2 className="type-subtitle weight-semibold" id="cv-variants-heading">
          {t("cv.variants")}
        </h2>
        {variants.length === 0 ? (
          <p className="type-body text-muted-foreground">
            {t("cv.noVariants")}
          </p>
        ) : (
          <div className="overflow-x-auto border border-line">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("cv.template")}</TableHead>
                  <TableHead>{t("cv.status")}</TableHead>
                  <TableHead>{t("cv.created")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("common.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((variant) => {
                  const current = variant.id === selected?.id;
                  return (
                    <TableRow
                      aria-selected={current}
                      className={cn(current && "weight-semibold bg-pane-2")}
                      key={variant.id}
                    >
                      <TableCell className="type-body-compact text-foreground">
                        {t(`cv.templates.${variant.template}`)}
                        {variant.id === application.cv_variant_id ? (
                          <Badge className="ml-2" variant="secondary">
                            {t("cv.attached")}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[variant.status]}>
                          {t(`cv.statuses.${variant.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="type-body-compact tabular-nums">
                        {formatDateTime(variant.created_at, locale)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          aria-pressed={current}
                          onClick={() => setPicked(variant.id)}
                          size="xs"
                          variant={current ? "secondary" : "ghost"}
                        >
                          {current ? t("cv.reviewing") : t("cv.review")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      {selected ? (
        <CvVariantPanel
          application={application}
          company={detail.posting.company_name}
          key={selected.id}
          onApprovableChange={onApprovableChange}
          onRegenerate={(variant) =>
            generate(variant.base_cv_id, variant.template)
          }
          variant={selected}
        />
      ) : null}
    </div>
  );
}
