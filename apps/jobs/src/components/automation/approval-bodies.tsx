// What each approval kind shows before the user decides (12 §6.1, 03 §8):
// the filled form with every value's source, the email, the questions, the
// CV notes, the rule. Page text (labels, values, questions, URLs) is
// untrusted: it renders as plain text, links only through safeHref.

import type { Sensitivity } from "@pilihpendidikan/jobs-contracts/enums";
import { AUTO_USE, SENSITIVITIES } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApprovalPayload,
  ApprovalRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { Alert, AlertDescription, AlertTitle } from "@rulisme/ui/ui/alert";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@rulisme/ui/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { RadioGroup, RadioGroupItem } from "@rulisme/ui/ui/radio-group";
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
import {
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  Paperclip,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { useId, useMemo, useState } from "react";
import { AppLink } from "@/components/app-link";
import { PlainText } from "@/components/rich-text";
import { useTranslation } from "@/i18n";
import type { AnswerInput, SubmitField } from "@/lib/approval-view";
import {
  clampAutoUse,
  isMaskedByDefault,
  maskValue,
  maxAutoUse,
  valueSourceKey,
} from "@/lib/approval-view";
import { modeLabel } from "@/lib/labels";
import { criteriaSummary, limitsSummary } from "@/lib/rules-form";
import { displayUrl, safeHref } from "@/lib/safe-url";

type Payload<T extends ApprovalPayload["type"]> = Extract<
  ApprovalPayload,
  { type: T }
>;

const SHA_PREFIX = 8;
const THUMB_WIDTH = 240;
const THUMB_HEIGHT = 150;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="type-caption weight-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ExternalUrl({ url }: { url: string }) {
  const href = safeHref(url);
  if (!href) {
    return <span className="break-all">{url}</span>;
  }
  return (
    <a
      className="break-all text-primary underline-offset-4 hover:underline"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {displayUrl(href)}
    </a>
  );
}

export function Attachments({
  attachments,
}: {
  attachments: readonly { file_id: string; sha256: string; name: string }[];
}) {
  const { t } = useTranslation();
  if (attachments.length === 0) {
    return (
      <p className="type-caption text-muted-foreground">
        {t("approvals.noAttachments")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {attachments.map((file) => (
        <li
          className="type-body-compact flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
          key={file.file_id}
        >
          <Paperclip
            aria-hidden="true"
            className="size-3.5 text-muted-foreground"
          />
          <span className="min-w-0 truncate text-foreground">{file.name}</span>
          <span className="type-micro inline-flex items-center gap-1 text-muted-foreground tabular-nums">
            <CircleCheck aria-hidden="true" className="size-3" />
            {t("approvals.sha", { sha: file.sha256.slice(0, SHA_PREFIX) })}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Screenshot({ fileId }: { fileId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const src = `/download/files/${encodeURIComponent(fileId)}/content?inline=1`;
  return (
    <>
      <button
        aria-label={t("approvals.zoomScreenshot")}
        className="w-fit border border-line bg-card outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        onClick={() => setOpen(true)}
        type="button"
      >
        <img
          alt={t("approvals.screenshotAlt")}
          className="block object-cover object-top"
          height={THUMB_HEIGHT}
          src={src}
          width={THUMB_WIDTH}
        />
      </button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("approvals.screenshot")}</DialogTitle>
            <DialogDescription>
              {t("approvals.screenshotHelp")}
            </DialogDescription>
          </DialogHeader>
          <img
            alt={t("approvals.screenshotAlt")}
            className="h-auto max-h-[70vh] w-full object-contain"
            height={900}
            src={src}
            width={1440}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function FieldValue({
  field,
  revealed,
}: {
  field: SubmitField;
  revealed: boolean;
}) {
  const { t } = useTranslation();
  if (isMaskedByDefault(field) && !revealed) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">{maskValue(field.value_display)}</span>
        <span className="sr-only">{t("approvals.masked")}</span>
      </span>
    );
  }
  return (
    <span className="whitespace-pre-line break-words text-foreground">
      {field.value_display}
    </span>
  );
}

export function SubmitBody({
  payload,
}: {
  payload: Payload<"browser_submit">;
}) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const maskable = payload.fields.some(isMaskedByDefault);
  // The payload is immutable (bound by its hash), so positions are stable.
  const rows = useMemo(
    () =>
      payload.fields.map((field, position) => ({
        field,
        key: `${position}:${field.label}`,
      })),
    [payload.fields]
  );
  return (
    <div className="flex flex-col gap-5">
      {payload.injection_suspected ? (
        <Alert role="alert" variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>{t("approvals.injectionTitle")}</AlertTitle>
          <AlertDescription>{t("approvals.injectionBody")}</AlertDescription>
        </Alert>
      ) : null}
      <Section title={t("approvals.filledFields")}>
        {maskable ? (
          <Button
            aria-pressed={revealed}
            className="self-start"
            onClick={() => setRevealed((value) => !value)}
            size="xs"
            variant="ghost"
          >
            {revealed ? (
              <EyeOff aria-hidden="true" data-icon="inline-start" />
            ) : (
              <Eye aria-hidden="true" data-icon="inline-start" />
            )}
            {revealed ? t("approvals.hideValues") : t("approvals.showValues")}
          </Button>
        ) : null}
        <div className="border border-line">
          <Table className="type-body-compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("approvals.fieldLabel")}</TableHead>
                <TableHead>{t("approvals.fieldValue")}</TableHead>
                <TableHead>{t("approvals.fieldSource")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ field, key }) => (
                <TableRow key={key}>
                  <TableCell className="max-w-48 whitespace-normal align-top text-foreground">
                    {field.label}
                  </TableCell>
                  <TableCell className="max-w-80 whitespace-normal align-top">
                    <FieldValue field={field} revealed={revealed} />
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline">
                        {t(valueSourceKey(field.value_source))}
                      </Badge>
                      {field.ai_written ? (
                        <Badge variant="outline">
                          <Sparkles aria-hidden="true" />
                          {t("approvals.aiWritten")}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
      <Section title={t("approvals.attachments")}>
        <Attachments attachments={payload.attachments} />
      </Section>
      {payload.screenshot_file_id ? (
        <Section title={t("approvals.screenshot")}>
          <Screenshot fileId={payload.screenshot_file_id} />
        </Section>
      ) : null}
      <Section title={t("approvals.finalUrl")}>
        <p className="type-body-compact">
          <ExternalUrl url={payload.url} />
        </p>
      </Section>
    </div>
  );
}

export function EmailBody({ payload }: { payload: Payload<"email_submit"> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-5">
      <dl className="type-body-compact grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t("approvals.emailTo")}</dt>
        <dd className="break-all text-foreground">{payload.to}</dd>
        {payload.cc.length > 0 ? (
          <>
            <dt className="text-muted-foreground">{t("approvals.emailCc")}</dt>
            <dd className="break-all text-foreground">
              {payload.cc.join(", ")}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{t("approvals.emailSubject")}</dt>
        <dd className="text-foreground">{payload.subject}</dd>
      </dl>
      <div className="flex flex-wrap gap-1">
        <Badge variant={payload.recipient_confirmed ? "secondary" : "outline"}>
          {payload.recipient_confirmed ? (
            <CircleCheck aria-hidden="true" />
          ) : (
            <CircleAlert aria-hidden="true" />
          )}
          {payload.recipient_confirmed
            ? t("approvals.recipientConfirmed")
            : t("approvals.recipientUnconfirmed")}
        </Badge>
        {payload.ai_drafted ? (
          <Badge variant="outline">
            <Sparkles aria-hidden="true" />
            {t("approvals.aiDrafted")}
          </Badge>
        ) : null}
      </div>
      <Section title={t("approvals.emailBody")}>
        <PlainText
          className="type-body max-w-[72ch] border border-line bg-card p-3"
          text={payload.body_text}
        />
      </Section>
      <Section title={t("approvals.attachments")}>
        <Attachments attachments={payload.attachments} />
      </Section>
    </div>
  );
}

function SensitivitySelect({
  id,
  value,
  locked,
  onChange,
}: {
  id: string;
  value: Sensitivity;
  locked: boolean;
  onChange: (value: Sensitivity) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      disabled={locked}
      onValueChange={(next) => onChange(next as Sensitivity)}
      value={value}
    >
      <SelectTrigger className="w-full" id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SENSITIVITIES.map((option) => (
          <SelectItem key={option} value={option}>
            {t(`answers.sensitivities.${option}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AnswerQuestionField({
  question,
  input,
  disabled,
  onChange,
}: {
  question: Payload<"answer">["questions"][number];
  input: AnswerInput;
  disabled: boolean;
  onChange: (input: AnswerInput) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const protectedQuestion = question.sensitivity === "protected";
  const sensitivity = protectedQuestion ? "protected" : input.sensitivity;
  const max = maxAutoUse(sensitivity);
  const set = (patch: Partial<AnswerInput>) => {
    const next = { ...input, ...patch };
    onChange({
      ...next,
      autoUse: clampAutoUse(
        next.autoUse,
        protectedQuestion ? "protected" : next.sensitivity
      ),
    });
  };
  return (
    <FieldSet className="gap-3 border border-line bg-card p-3">
      <FieldLegend className="type-body weight-semibold text-foreground">
        <span className="sr-only">{t("approvals.questionFromPage")} </span>
        <q>{question.question}</q>
        {question.required ? (
          <span className="type-caption ml-2 text-muted-foreground">
            {t("approvals.required")}
          </span>
        ) : null}
      </FieldLegend>
      {question.suggestion ? (
        <p className="type-caption text-muted-foreground">
          {t("approvals.suggested", { value: question.suggestion.value })}{" "}
          <Badge variant="outline">
            {t(valueSourceKey(question.suggestion.value_source))}
            {question.suggestion.fact_key
              ? ` · ${question.suggestion.fact_key}`
              : ""}
          </Badge>
        </p>
      ) : null}
      {question.options.length > 0 ? (
        <RadioGroup
          aria-label={t("approvals.yourAnswer")}
          className="flex flex-col gap-2"
          disabled={disabled}
          onValueChange={(value) => set({ value })}
          value={input.value}
        >
          {question.options.map((option) => (
            <div className="flex items-center gap-2" key={option.value}>
              <RadioGroupItem
                id={`${id}-${option.value}`}
                value={option.value}
              />
              <label
                className="type-body text-foreground"
                htmlFor={`${id}-${option.value}`}
              >
                {option.label}
              </label>
            </div>
          ))}
        </RadioGroup>
      ) : (
        <Field>
          <FieldLabel htmlFor={`${id}-value`}>
            {t("approvals.yourAnswer")}
          </FieldLabel>
          <Input
            className="field-touch"
            disabled={disabled}
            id={`${id}-value`}
            maxLength={4000}
            onChange={(event) => set({ value: event.target.value })}
            value={input.value}
          />
        </Field>
      )}
      <Field orientation="horizontal">
        <Checkbox
          checked={input.saveToBank}
          disabled={disabled}
          id={`${id}-save`}
          onCheckedChange={(value) => set({ saveToBank: value === true })}
        />
        <FieldLabel htmlFor={`${id}-save`}>
          {t("approvals.saveToBank")}
        </FieldLabel>
      </Field>
      {input.saveToBank ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-sensitivity`}>
              {t("answers.sensitivity")}
            </FieldLabel>
            <SensitivitySelect
              id={`${id}-sensitivity`}
              locked={protectedQuestion || disabled}
              onChange={(value) => set({ sensitivity: value })}
              value={sensitivity}
            />
            {protectedQuestion ? (
              <FieldDescription>
                {t("approvals.protectedLocked")}
              </FieldDescription>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-auto`}>
              {t("answers.autoUse")}
            </FieldLabel>
            <Select
              disabled={disabled}
              onValueChange={(value) =>
                set({ autoUse: value as AnswerInput["autoUse"] })
              }
              value={input.autoUse}
            >
              <SelectTrigger className="w-full" id={`${id}-auto`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTO_USE.map((option) => (
                  <SelectItem
                    disabled={option === "always" && max !== "always"}
                    key={option}
                    value={option}
                  >
                    {t(`answers.autoUses.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : null}
    </FieldSet>
  );
}

export function AnswerBody({
  payload,
  inputs,
  disabled,
  onChange,
}: {
  payload: Payload<"answer">;
  inputs: Readonly<Record<string, AnswerInput>>;
  disabled: boolean;
  onChange: (ref: string, input: AnswerInput) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <p className="type-caption text-muted-foreground">
        {t("approvals.answerHelp")}
      </p>
      {payload.questions.map((question) => {
        const input = inputs[question.ref];
        if (!input) {
          return null;
        }
        return (
          <AnswerQuestionField
            disabled={disabled}
            input={input}
            key={question.ref}
            onChange={(next) => onChange(question.ref, next)}
            question={question}
          />
        );
      })}
    </div>
  );
}

export function CvBody({
  payload,
  applicationHref,
}: {
  payload: Payload<"cv_variant">;
  applicationHref: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <dl className="type-body-compact grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t("cv.template")}</dt>
        <dd className="text-foreground">
          {t(`cv.templates.${payload.template}`)}
        </dd>
        <dt className="text-muted-foreground">{t("approvals.rephrased")}</dt>
        <dd className="text-foreground tabular-nums">
          {payload.rephrased_bullets}
        </dd>
      </dl>
      {payload.notes_for_user.length > 0 ? (
        <Alert>
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("approvals.cvNotes")}</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {payload.notes_for_user.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <Attachments
        attachments={[
          {
            file_id: payload.file_id,
            sha256: payload.sha256,
            name: t("approvals.cvPdf"),
          },
        ]}
      />
      {applicationHref ? (
        <AppLink
          className="type-body-compact w-fit text-primary underline-offset-4 hover:underline"
          href={applicationHref}
        >
          {t("approvals.reviewCv")}
        </AppLink>
      ) : null}
    </div>
  );
}

export function RuleBody({
  payload,
  sourceLabel,
}: {
  payload: Payload<"rule_activation">;
  sourceLabel: (id: string) => string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <p className="type-body max-w-[72ch] text-foreground">
        {payload.summary}
      </p>
      <dl className="type-body-compact grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t("rules.mode")}</dt>
        <dd className="text-foreground">{modeLabel(t, payload.mode)}</dd>
        <dt className="text-muted-foreground">{t("rules.criteria")}</dt>
        <dd className="text-foreground">
          {criteriaSummary(t, payload.criteria, sourceLabel)}
        </dd>
        <dt className="text-muted-foreground">{t("rules.limits")}</dt>
        <dd className="text-foreground">{limitsSummary(t, payload.limits)}</dd>
        <dt className="text-muted-foreground">{t("rules.allowedDomains")}</dt>
        <dd className="flex flex-wrap gap-1">
          {payload.allowed_domains.map((domain) => (
            <Badge key={domain} variant="outline">
              {domain}
            </Badge>
          ))}
        </dd>
      </dl>
    </div>
  );
}

/** The approval's payload as its kind's view. */
export function ApprovalBody({
  approval,
  answerInputs,
  disabled,
  onAnswerChange,
  applicationHref,
  sourceLabel,
}: {
  approval: ApprovalRecord;
  answerInputs: Readonly<Record<string, AnswerInput>>;
  disabled: boolean;
  onAnswerChange: (ref: string, input: AnswerInput) => void;
  applicationHref: string | null;
  sourceLabel: (id: string) => string;
}) {
  const { payload } = approval;
  switch (payload.type) {
    case "browser_submit":
      return <SubmitBody payload={payload} />;
    case "email_submit":
      return <EmailBody payload={payload} />;
    case "answer":
      return (
        <AnswerBody
          disabled={disabled}
          inputs={answerInputs}
          onChange={onAnswerChange}
          payload={payload}
        />
      );
    case "cv_variant":
      return <CvBody applicationHref={applicationHref} payload={payload} />;
    default:
      return <RuleBody payload={payload} sourceLabel={sourceLabel} />;
  }
}
