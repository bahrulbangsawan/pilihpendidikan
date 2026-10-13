// Answers (12 §9, 03 §9): the answer bank as a table with an editor Sheet.
// The sensitivity defaults to `protected` for known protected questions and a
// protected answer can never be "Always" (the API refuses it too, 05 §10).

import type {
  AnswerKind,
  AutoUse,
  Sensitivity,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  ANSWER_KINDS,
  AUTO_USE,
  SENSITIVITIES,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { ScreeningAnswerRecord } from "@pilihpendidikan/jobs-contracts/records";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@rulisme/ui/ui/sheet";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { Textarea } from "@rulisme/ui/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type { FormEvent } from "react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BulkConfirmDialog,
  RowCheckbox,
  SelectAllCheckbox,
} from "@/components/bulk/bulk-toolbar";
import { useConflictWrite } from "@/hooks/use-conflict-write";
import { useAnswers } from "@/hooks/use-profile";
import { useSelection } from "@/hooks/use-selection";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { isProtectedQuestion } from "@/lib/facts-form";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";
import { AnswersBulkBar } from "./answers-bulk";

interface Draft {
  answer: string;
  answerKind: AnswerKind;
  autoUse: AutoUse;
  patterns: string;
  questionKey: string;
  sensitivity: Sensitivity;
}

const ANSWER_FIELDS = [
  "question_key",
  "match_patterns",
  "answer",
  "answer_kind",
  "sensitivity",
  "auto_use",
] as const;

function draftFrom(answer: ScreeningAnswerRecord | null): Draft {
  return {
    questionKey: answer?.question_key ?? "",
    patterns: answer?.match_patterns.join("\n") ?? "",
    answer: answer?.answer ?? "",
    answerKind: answer?.answer_kind ?? "text",
    sensitivity: answer?.sensitivity ?? "none",
    autoUse: answer?.auto_use ?? "approval",
  };
}

export function AnswersTab() {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const write = useConflictWrite();
  const answers = useAnswers();
  const [editing, setEditing] = useState<ScreeningAnswerRecord | "new" | null>(
    null
  );
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ScreeningAnswerRecord | null>(null);
  const set = (patch: Partial<Draft>) =>
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (next.sensitivity === "protected" && next.autoUse === "always") {
        next.autoUse = "approval";
      }
      return next;
    });

  function open(target: ScreeningAnswerRecord | "new") {
    setDraft(draftFrom(target === "new" ? null : target));
    setEditing(target);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    const fields = {
      question_key: draft.questionKey.trim(),
      match_patterns: draft.patterns
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 50),
      answer: draft.answer,
      answer_kind: draft.answerKind,
      sensitivity: draft.sensitivity,
      auto_use:
        draft.sensitivity === "protected" && draft.autoUse === "always"
          ? "approval"
          : draft.autoUse,
    } as const;
    setBusy(true);
    try {
      if (editing === "new") {
        await api("POST /api/v1/profile/answers", {
          body: fields,
          idempotencyKey: newIdempotencyKey(),
        });
      } else {
        await write<ScreeningAnswerRecord>(
          {
            base: editing,
            changes: fields,
            fields: ANSWER_FIELDS,
            send: async (baseRevision, changes) =>
              (
                await api("PATCH /api/v1/profile/answers/{ans_id}", {
                  params: { ans_id: editing.id },
                  body: { ...changes, base_revision: baseRevision },
                  idempotencyKey: newIdempotencyKey(),
                })
              ).answer,
          },
          { what: t("answers.what") }
        );
      }
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.answers });
    } catch (error) {
      toast.error(
        isApiError(error) && error.code === "policy_violation"
          ? t("answers.protectedAlways")
          : t("answers.saveFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(answer: ScreeningAnswerRecord) {
    setBusy(true);
    try {
      await api("DELETE /api/v1/profile/answers/{ans_id}", {
        params: { ans_id: answer.id },
        query: { base_revision: answer.revision },
        idempotencyKey: newIdempotencyKey(),
      });
      setEditing(null);
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.answers });
    } catch {
      toast.error(t("answers.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  const rows = answers.data ?? [];
  const ids = useMemo(
    () => (answers.data ?? []).map((answer) => answer.id),
    [answers.data]
  );
  const selection = useSelection(ids);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="type-body max-w-2xl text-pretty">{t("answers.intro")}</p>
        <Button onClick={() => open("new")} size="sm" variant="outline">
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t("answers.add")}
        </Button>
      </div>
      {answers.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {answers.isSuccess && rows.length === 0 ? (
        <p className="type-body text-muted-foreground">{t("answers.empty")}</p>
      ) : null}
      {rows.length > 0 ? (
        <AnswersBulkBar answers={rows} selection={selection} />
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto border border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <SelectAllCheckbox selection={selection} />
                </TableHead>
                <TableHead>{t("answers.question")}</TableHead>
                <TableHead>{t("answers.answer")}</TableHead>
                <TableHead>{t("answers.sensitivity")}</TableHead>
                <TableHead>{t("answers.autoUse")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((answer) => (
                <TableRow
                  data-state={
                    selection.isSelected(answer.id) ? "selected" : undefined
                  }
                  key={answer.id}
                >
                  <TableCell>
                    <RowCheckbox
                      id={answer.id}
                      label={answer.question_key}
                      selection={selection}
                    />
                  </TableCell>
                  <TableCell className="text-foreground">
                    {answer.question_key}
                  </TableCell>
                  <TableCell className="max-w-64 truncate">
                    {answer.answer}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        answer.sensitivity === "protected"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {t(`answers.sensitivities.${answer.sensitivity}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {t(`answers.autoUses.${answer.auto_use}`)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      onClick={() => open(answer)}
                      size="xs"
                      variant="ghost"
                    >
                      {t("common.edit")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <Sheet
        onOpenChange={(value) => !value && setEditing(null)}
        open={editing !== null}
      >
        <SheetContent className="sm:max-w-md">
          <form className="flex h-full flex-col" onSubmit={save}>
            <SheetHeader>
              <SheetTitle>
                {editing === "new"
                  ? t("answers.addTitle")
                  : t("answers.editTitle")}
              </SheetTitle>
              <SheetDescription>{t("answers.sheetHelp")}</SheetDescription>
            </SheetHeader>
            <FieldGroup className="flex-1 gap-4 overflow-y-auto px-4 pb-4">
              <Field>
                <FieldLabel htmlFor={`${id}-key`}>
                  {t("answers.question")}
                </FieldLabel>
                <Input
                  className="field-touch"
                  id={`${id}-key`}
                  onChange={(event) => {
                    const questionKey = event.target.value;
                    set(
                      editing === "new" && isProtectedQuestion(questionKey)
                        ? { questionKey, sensitivity: "protected" }
                        : { questionKey }
                    );
                  }}
                  placeholder="requires_sponsorship"
                  required
                  value={draft.questionKey}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-patterns`}>
                  {t("answers.patterns")}
                </FieldLabel>
                <Textarea
                  className="field-touch"
                  id={`${id}-patterns`}
                  onChange={(event) => set({ patterns: event.target.value })}
                  value={draft.patterns}
                />
                <FieldDescription>{t("answers.patternsHelp")}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-answer`}>
                  {t("answers.answer")}
                </FieldLabel>
                <Textarea
                  className="field-touch"
                  id={`${id}-answer`}
                  maxLength={4000}
                  onChange={(event) => set({ answer: event.target.value })}
                  required
                  value={draft.answer}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-kind`}>
                  {t("answers.kind")}
                </FieldLabel>
                <Select
                  onValueChange={(value) =>
                    set({ answerKind: value as AnswerKind })
                  }
                  value={draft.answerKind}
                >
                  <SelectTrigger className="w-full" id={`${id}-kind`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANSWER_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(`answers.kinds.${kind}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-sensitivity`}>
                  {t("answers.sensitivity")}
                </FieldLabel>
                <Select
                  onValueChange={(value) =>
                    set({ sensitivity: value as Sensitivity })
                  }
                  value={draft.sensitivity}
                >
                  <SelectTrigger className="w-full" id={`${id}-sensitivity`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SENSITIVITIES.map((sensitivity) => (
                      <SelectItem key={sensitivity} value={sensitivity}>
                        {t(`answers.sensitivities.${sensitivity}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {t(`answers.sensitivityHelp.${draft.sensitivity}`)}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-auto`}>
                  {t("answers.autoUse")}
                </FieldLabel>
                <Select
                  onValueChange={(value) => set({ autoUse: value as AutoUse })}
                  value={draft.autoUse}
                >
                  <SelectTrigger className="w-full" id={`${id}-auto`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTO_USE.map((autoUse) => (
                      <SelectItem
                        disabled={
                          autoUse === "always" &&
                          draft.sensitivity === "protected"
                        }
                        key={autoUse}
                        value={autoUse}
                      >
                        {t(`answers.autoUses.${autoUse}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {draft.sensitivity === "protected" ? (
                  <FieldDescription>
                    {t("answers.protectedAlways")}
                  </FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>
            <SheetFooter className="flex-row justify-between border-line border-t">
              {editing && editing !== "new" ? (
                <Button
                  disabled={busy}
                  onClick={() => setDeleting(editing)}
                  type="button"
                  variant="destructive"
                >
                  {t("common.delete")}
                </Button>
              ) : (
                <span />
              )}
              <Button disabled={busy} type="submit">
                {t("common.save")}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
      <BulkConfirmDialog
        body={t("answers.bulk.deleteBody")}
        busy={busy}
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          if (deleting) {
            remove(deleting);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
          }
        }}
        open={deleting !== null}
        title={t("answers.deleteOneTitle")}
      />
    </div>
  );
}
