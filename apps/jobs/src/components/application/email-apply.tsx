// Apply by email (09): the composer — recipient with validation hints (09 §1),
// the en / id template filled from the profile facts (09 §5.1), attachments
// (the approved CV by default, ≤ 5, 09 §5.3), the 20 KB body cap — saved as a
// `local_handoff` draft. The drafts below it go through approval, then the
// web-only hand-off: a BFF-built `.eml` or a `mailto:` fallback, and "I sent
// it" (EmailDrafts).

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import {
  EMAIL_LIMITS,
  renderEmailTemplate,
} from "@pilihpendidikan/jobs-contracts/email";
import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import { Alert, AlertDescription, AlertTitle } from "@rulisme/ui/ui/alert";
import { Button } from "@rulisme/ui/ui/button";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { Textarea } from "@rulisme/ui/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, FileText, TriangleAlert } from "lucide-react";
import type { FormEvent } from "react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { useFacts } from "@/hooks/use-profile";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import type { RecipientCheck } from "@/lib/email-recipient";
import {
  bodyBytes,
  checkRecipient,
  needsRecipientConfirmation,
  parseMailtoApply,
} from "@/lib/email-recipient";
import { formatNumber } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";
import { EmailDrafts } from "./email-drafts";

const KB = 1024;

function factMap(
  facts: readonly { key: string; value: unknown }[] | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const fact of facts ?? []) {
    out[fact.key] = fact.value;
  }
  return out;
}

function RecipientHint({ check }: { check: RecipientCheck }) {
  const { t } = useTranslation();
  if (check.kind === "employer") {
    return (
      <FieldDescription className="flex items-center gap-1">
        <CircleCheck aria-hidden="true" className="size-3.5 text-primary" />
        {t("email.recipient.employer", { domain: check.domain })}
      </FieldDescription>
    );
  }
  if (check.kind === "free_mail") {
    return (
      <FieldDescription className="flex items-start gap-1 text-destructive">
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0"
        />
        {t("email.recipient.freeMail", { domain: check.domain })}
      </FieldDescription>
    );
  }
  if (check.kind === "other_domain") {
    return (
      <FieldDescription className="flex items-start gap-1">
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0"
        />
        {t("email.recipient.otherDomain", { domain: check.domain })}
      </FieldDescription>
    );
  }
  if (check.kind === "invalid") {
    return <FieldError>{t("email.recipient.invalid")}</FieldError>;
  }
  return null;
}

export function EmailApply({ detail }: { detail: ApplicationDetail }) {
  const { locale: uiLocale, t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const facts = useFacts();
  const { posting, application } = detail;
  const fromLink = useMemo(
    () => parseMailtoApply(posting.apply_url),
    [posting.apply_url]
  );
  const [locale, setLocale] = useState<Locale>(uiLocale);
  const [to, setTo] = useState(fromLink?.to ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const approved = detail.cv_variants.filter(
    (variant) => variant.status === "approved" && variant.file_id
  );
  const [attachments, setAttachments] = useState<string[]>(() => {
    const attached = approved.find(
      (variant) => variant.id === application.cv_variant_id
    );
    return attached?.file_id ? [attached.file_id] : [];
  });

  const check = checkRecipient(to, {
    companyDomain: posting.company_domain,
    applyDomain: posting.apply_domain,
  });
  const needsTick = needsRecipientConfirmation(check);
  const size = bodyBytes(body);
  const tooLong = size > EMAIL_LIMITS.bodyBytes;
  const canSave =
    !busy &&
    (check.kind === "employer" || (needsTick && confirmed)) &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    !tooLong &&
    attachments.length <= EMAIL_LIMITS.attachments;

  function fillTemplate(next: Locale) {
    const rendered = renderEmailTemplate({
      locale: next,
      facts: factMap(facts.data?.facts),
      posting: {
        title: posting.title,
        company_name: posting.company_name,
        source_job_ref: posting.source_job_ref,
      },
    });
    setSubject(fromLink?.subject ?? rendered.subject);
    setBody(rendered.body_text);
  }

  function toggleAttachment(fileId: string, on: boolean) {
    setAttachments((current) =>
      on
        ? [...new Set([...current, fileId])].slice(0, EMAIL_LIMITS.attachments)
        : current.filter((value) => value !== fileId)
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) {
      return;
    }
    setBusy(true);
    try {
      await api("POST /api/v1/applications/{app_id}/emails", {
        params: { app_id: application.id },
        body: {
          to: to.trim(),
          subject: subject.trim(),
          body_text: body,
          attachment_file_ids: attachments,
          delivery: "local_handoff",
          locale,
          recipient_confirmed: check.kind === "employer" || confirmed,
        },
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(t("email.saved"));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.application(application.id),
      });
    } catch (error) {
      toast.error(
        isApiError(error) && error.status === 422
          ? t("email.refused", { message: error.message })
          : t("email.saveFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <EmailDrafts detail={detail} />
      <form
        aria-labelledby={`${id}-heading`}
        className="flex max-w-2xl flex-col gap-4"
        onSubmit={submit}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="type-subtitle weight-semibold" id={`${id}-heading`}>
            {t("email.composeHeading")}
          </h3>
          <div className="flex items-end gap-2">
            <Field className="w-36">
              <FieldLabel htmlFor={`${id}-locale`}>
                {t("email.language")}
              </FieldLabel>
              <Select
                onValueChange={(value) => setLocale(value as Locale)}
                value={locale}
              >
                <SelectTrigger className="w-full" id={`${id}-locale`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t("email.languages.en")}</SelectItem>
                  <SelectItem value="id">{t("email.languages.id")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button
              disabled={facts.isPending}
              onClick={() => fillTemplate(locale)}
              type="button"
              variant="outline"
            >
              {t("email.useTemplate")}
            </Button>
          </div>
        </div>
        <Field data-invalid={check.kind === "invalid" || undefined}>
          <FieldLabel htmlFor={`${id}-to`}>{t("email.to")}</FieldLabel>
          <Input
            aria-invalid={check.kind === "invalid" || undefined}
            autoComplete="off"
            className="field-touch"
            id={`${id}-to`}
            inputMode="email"
            maxLength={EMAIL_LIMITS.recipientLength}
            onChange={(event) => {
              setTo(event.target.value);
              setConfirmed(false);
            }}
            placeholder="careers@company.example"
            required
            type="email"
            value={to}
          />
          <RecipientHint check={check} />
        </Field>
        {needsTick ? (
          <Field orientation="horizontal">
            <Checkbox
              checked={confirmed}
              id={`${id}-confirm`}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            <FieldLabel htmlFor={`${id}-confirm`}>
              {t("email.confirmRecipient")}
            </FieldLabel>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor={`${id}-subject`}>
            {t("email.subject")}
          </FieldLabel>
          <Input
            className="field-touch"
            id={`${id}-subject`}
            maxLength={300}
            onChange={(event) => setSubject(event.target.value)}
            required
            value={subject}
          />
        </Field>
        <Field data-invalid={tooLong || undefined}>
          <FieldLabel htmlFor={`${id}-body`}>{t("email.body")}</FieldLabel>
          <Textarea
            aria-invalid={tooLong || undefined}
            className="field-touch min-h-56"
            id={`${id}-body`}
            onChange={(event) => setBody(event.target.value)}
            required
            value={body}
          />
          <FieldDescription className="tabular-nums">
            {t("email.size", {
              used: formatNumber(Math.ceil(size / KB), uiLocale),
              max: formatNumber(EMAIL_LIMITS.bodyBytes / KB, uiLocale),
            })}
          </FieldDescription>
          {tooLong ? <FieldError>{t("email.tooLong")}</FieldError> : null}
        </Field>
        <FieldSet>
          <FieldLegend variant="label">{t("email.attachments")}</FieldLegend>
          {approved.length === 0 ? (
            <FieldDescription>{t("email.noAttachment")}</FieldDescription>
          ) : (
            approved.map((variant) => {
              const fileId = variant.file_id ?? "";
              return (
                <Field key={variant.id} orientation="horizontal">
                  <Checkbox
                    checked={attachments.includes(fileId)}
                    id={`${id}-att-${variant.id}`}
                    onCheckedChange={(value) =>
                      toggleAttachment(fileId, value === true)
                    }
                  />
                  <FieldLabel htmlFor={`${id}-att-${variant.id}`}>
                    <FileText aria-hidden="true" className="size-3.5" />
                    {t("email.cvAttachment", {
                      template: t(`cv.templates.${variant.template}`),
                    })}
                  </FieldLabel>
                </Field>
              );
            })
          )}
        </FieldSet>
        {check.kind === "free_mail" ? (
          <Alert>
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>{t("email.scamTitle")}</AlertTitle>
            <AlertDescription>{t("email.scamBody")}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          className="self-start"
          disabled={!canSave}
          type="submit"
          variant="outline"
        >
          {t("email.saveDraft")}
        </Button>
        <p className="type-caption text-muted-foreground">
          {t("email.approvalNote")}
        </p>
      </form>
    </div>
  );
}
