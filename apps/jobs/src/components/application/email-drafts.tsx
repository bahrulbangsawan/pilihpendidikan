// The application's email drafts (09 §6.1, §9) and what each status allows:
// a draft is approved with the exact content on screen (the approval's
// payload_hash binds it, 09 §4); an approved local hand-off can be downloaded
// as a `.eml` built by the BFF (attachments inside, `X-Unsent: 1`) or opened
// with `mailto:` (attachments must be added by hand), then the user says
// whether they sent it. Drafts and bodies are the user's text: plain text.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import type {
  ApprovalRecord,
  EmailApplicationRecord,
} from "@pilihpendidikan/jobs-contracts/records";
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
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import { Field, FieldLabel } from "@rulisme/ui/ui/field";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Mail, Paperclip } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { PlainText } from "@/components/rich-text";
import { commitApplicationToBoard } from "@/hooks/use-board";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { MAILTO_SAFE_LENGTH, mailtoHref } from "@/lib/eml";
import {
  checkRecipient,
  needsRecipientConfirmation,
} from "@/lib/email-recipient";
import { formatDateTime } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";

/** The pending `submit` approval bound to draft `emailId` (09 §4). */
export function emailApprovalOf(
  approvals: readonly ApprovalRecord[],
  emailId: string
): ApprovalRecord | null {
  return (
    approvals.find(
      (approval) =>
        approval.kind === "submit" &&
        approval.state === "pending" &&
        approval.payload.type === "email_submit" &&
        approval.payload.email_application_id === emailId
    ) ?? null
  );
}

export function emlHref(appId: string, emailId: string): string {
  return `/download/applications/${encodeURIComponent(appId)}/emails/${encodeURIComponent(emailId)}.eml`;
}

/** The mailto fallback, or null when the address is unusable. */
export function safeMailto(email: EmailApplicationRecord): string | null {
  try {
    return mailtoHref(email.to_address, email.subject, email.body_text);
  } catch {
    return null;
  }
}

/**
 * 09 §1: a non-employer or free-mail recipient needs the "belongs to the
 * employer" tick — given when the draft was saved, or here before approving.
 */
function useRecipientTick(
  email: EmailApplicationRecord,
  detail: ApplicationDetail,
  approval: ApprovalRecord | null
) {
  const [confirmed, setConfirmed] = useState(false);
  const needsTick = needsRecipientConfirmation(
    checkRecipient(email.to_address, {
      companyDomain: detail.posting.company_domain,
      applyDomain: detail.posting.apply_domain,
    })
  );
  const alreadyConfirmed =
    approval?.payload.type === "email_submit" &&
    approval.payload.recipient_confirmed;
  return {
    needsTick,
    alreadyConfirmed,
    confirmed,
    setConfirmed,
    recipientOk: !needsTick || alreadyConfirmed || confirmed,
  };
}

function DraftCard({
  email,
  detail,
}: {
  email: EmailApplicationRecord;
  detail: ApplicationDetail;
}) {
  const { locale, t } = useTranslation();
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const approval = emailApprovalOf(detail.approvals, email.id);
  const mailto = safeMailto(email);
  const { needsTick, alreadyConfirmed, confirmed, setConfirmed, recipientOk } =
    useRecipientTick(email, detail, approval);

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.application(detail.application.id),
    });
  }

  async function approve() {
    if (!approval) {
      return;
    }
    setBusy(true);
    try {
      const result = await api("POST /api/v1/emails/{eml_id}/approve", {
        params: { eml_id: email.id },
        body: {
          payload_hash: approval.payload_hash,
          recipient_confirmed: recipientOk,
        },
        idempotencyKey: newIdempotencyKey(),
      });
      commitApplicationToBoard(queryClient, result.application);
      toast.success(t("email.approved"));
      setReviewing(false);
      await refresh();
    } catch (error) {
      toast.error(
        isApiError(error) && error.status === 409
          ? t("email.changed")
          : t("email.approveFailed")
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handedOff(sent: boolean) {
    setBusy(true);
    try {
      const result = await api("POST /api/v1/emails/{eml_id}/handed-off", {
        params: { eml_id: email.id },
        body: sent
          ? { sent_confirmed: true, sent_at: Date.now() }
          : { sent_confirmed: false },
        idempotencyKey: newIdempotencyKey(),
      });
      commitApplicationToBoard(queryClient, result.application);
      toast.success(sent ? t("email.markedSent") : t("email.markedNotSent"));
      await refresh();
    } catch {
      toast.error(t("email.handOffFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={email.status === "failed" ? "destructive" : "outline"}>
          {t(`email.statuses.${email.status}`)}
        </Badge>
        <span className="type-body-compact min-w-0 truncate text-foreground">
          {email.subject}
        </span>
      </div>
      <dl className="type-caption grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
        <dt>{t("email.to")}</dt>
        <dd className="min-w-0 break-all text-foreground">
          {email.to_address}
        </dd>
        <dt>{t("email.attachments")}</dt>
        <dd className="tabular-nums">{email.attachment_file_ids.length}</dd>
        <dt>{t("email.updated")}</dt>
        <dd>{formatDateTime(email.updated_at, locale)}</dd>
      </dl>
      {email.status === "draft" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy || !approval}
            onClick={() => setReviewing(true)}
            variant="outline"
          >
            {t("email.reviewApprove")}
          </Button>
          {approval ? null : (
            <p className="type-caption text-muted-foreground">
              {t("email.awaitingApprovalRequest")}
            </p>
          )}
        </div>
      ) : null}
      {email.status === "approved" && email.delivery === "local_handoff" ? (
        <div className="flex flex-col gap-3">
          <p className="type-body">{t("email.handOffHelp")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a download href={emlHref(detail.application.id, email.id)}>
                <Download aria-hidden="true" data-icon="inline-start" />
                {t("email.downloadEml")}
              </a>
            </Button>
            {mailto ? (
              <Button asChild variant="ghost">
                <a href={mailto}>
                  <Mail aria-hidden="true" data-icon="inline-start" />
                  {t("email.openMailApp")}
                </a>
              </Button>
            ) : null}
          </div>
          <p className="type-caption flex items-start gap-1 text-muted-foreground">
            <Paperclip
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
            {mailto && mailto.length > MAILTO_SAFE_LENGTH
              ? t("email.mailtoLong")
              : t("email.mailtoNoAttachments")}
          </p>
          <div className="flex flex-wrap items-center gap-2 border-line border-t pt-3">
            <span className="type-body">{t("email.didYouSend")}</span>
            <Button
              disabled={busy}
              onClick={() => handedOff(true)}
              size="sm"
              variant="outline"
            >
              {t("email.yesSent")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => handedOff(false)}
              size="sm"
              variant="ghost"
            >
              {t("email.notSent")}
            </Button>
          </div>
        </div>
      ) : null}
      {email.status === "handed_off" ? (
        <p className="type-body">
          {t("email.handedOffNote", {
            date: formatDateTime(email.sent_at ?? email.updated_at, locale),
          })}
        </p>
      ) : null}
      {email.status === "sent" ? (
        <p className="type-body">
          {t("email.sentNote", {
            date: formatDateTime(email.sent_at ?? email.updated_at, locale),
          })}
        </p>
      ) : null}
      {email.status === "failed" ? (
        <p className="type-body text-destructive">{t("email.failedNote")}</p>
      ) : null}

      <AlertDialog onOpenChange={setReviewing} open={reviewing}>
        <AlertDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("email.approveTitle", { to: email.to_address })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("email.approveBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 border border-line p-3">
            <p className="type-body-compact weight-semibold text-foreground">
              {email.subject}
            </p>
            <PlainText className="type-body-compact" text={email.body_text} />
            <p className="type-caption text-muted-foreground">
              {t("email.attachmentCount", {
                count: email.attachment_file_ids.length,
              })}
            </p>
          </div>
          {needsTick && !alreadyConfirmed ? (
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
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !recipientOk}
              onClick={(event) => {
                event.preventDefault();
                approve();
              }}
            >
              {t("email.approve")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

export function EmailDrafts({ detail }: { detail: ApplicationDetail }) {
  const { t } = useTranslation();
  const emails = [...detail.emails].sort((a, b) => b.created_at - a.created_at);
  if (emails.length === 0) {
    return null;
  }
  return (
    <section
      aria-labelledby="email-drafts-heading"
      className="flex flex-col gap-3"
    >
      <h3 className="type-subtitle weight-semibold" id="email-drafts-heading">
        {t("email.draftsHeading")}
      </h3>
      <ul className="flex flex-col gap-3">
        {emails.map((email) => (
          <DraftCard detail={detail} email={email} key={email.id} />
        ))}
      </ul>
    </section>
  );
}
