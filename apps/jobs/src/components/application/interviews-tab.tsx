// Interviews (06 §6.1): a table plus add/edit in a Sheet. Creating the first
// interview of an applied application moves it to Interviewing (toggle,
// default on). A failed outcome never rejects by itself: the user is asked
// "Mark application rejected?" as a separate step. Each interview exports as
// .ics through /download/*.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import type {
  InterviewKind,
  InterviewOutcome,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  INTERVIEW_KINDS,
  INTERVIEW_OUTCOMES,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { InterviewRecord } from "@pilihpendidikan/jobs-contracts/records";
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
import { Switch } from "@rulisme/ui/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { Textarea } from "@rulisme/ui/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@rulisme/ui/ui/toggle-group";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Plus } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { commitApplicationToBoard } from "@/hooks/use-board";
import { useConflictWrite } from "@/hooks/use-conflict-write";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import {
  browserTimeZone,
  formatDateTime,
  fromLocalInputValue,
  toDateTimeLocalValue,
} from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import { interviewKindLabel, interviewOutcomeLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query";
import { displayUrl, safeHref } from "@/lib/safe-url";

interface Draft {
  duration: string;
  interviewers: string;
  kind: InterviewKind;
  location: string;
  moveApplication: boolean;
  notes: string;
  outcome: InterviewOutcome;
  round: string;
  scheduled: string;
  timezone: string;
}

const INTERVIEW_FIELDS = [
  "round",
  "kind",
  "scheduled_at",
  "duration_min",
  "timezone",
  "location",
  "interviewers",
  "outcome",
  "notes",
] as const;

function draftFrom(
  interview: InterviewRecord | null,
  nextRound: number
): Draft {
  return {
    round: String(interview?.round ?? nextRound),
    kind: interview?.kind ?? "phone_screen",
    scheduled: toDateTimeLocalValue(interview?.scheduled_at ?? null),
    duration: interview?.duration_min ? String(interview.duration_min) : "",
    timezone: interview?.timezone ?? browserTimeZone(),
    location: interview?.location ?? "",
    interviewers: interview?.interviewers.join(", ") ?? "",
    outcome: interview?.outcome ?? "pending",
    notes: interview?.notes ?? "",
    moveApplication: true,
  };
}

function fieldsFrom(draft: Draft) {
  const duration = Number.parseInt(draft.duration, 10);
  return {
    round: Math.max(1, Number.parseInt(draft.round, 10) || 1),
    kind: draft.kind,
    scheduled_at: fromLocalInputValue(draft.scheduled),
    duration_min:
      Number.isFinite(duration) && duration > 0
        ? Math.min(duration, 1440)
        : null,
    timezone: draft.timezone.trim() || null,
    location: draft.location.trim() || null,
    interviewers: draft.interviewers
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 20),
    outcome: draft.outcome,
    notes: draft.notes,
  };
}

export function InterviewsTab({
  detail,
  autoOpen,
  onAutoOpened,
  onMove,
}: {
  detail: ApplicationDetail;
  /** Open the add sheet (the "Add interview" next step). */
  autoOpen: boolean;
  onAutoOpened: () => void;
  onMove: (target: Stage) => void;
}) {
  const { locale, t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const write = useConflictWrite();
  const [editing, setEditing] = useState<InterviewRecord | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null, 1));
  const [askReject, setAskReject] = useState(false);
  const [busy, setBusy] = useState(false);
  const { application, interviews } = detail;
  const appId = application.id;
  const nextRound =
    interviews.reduce((max, entry) => Math.max(max, entry.round), 0) + 1;
  const sorted = [...interviews].sort(
    (a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0)
  );
  const canMove = application.stage === "applied" && interviews.length === 0;

  useEffect(() => {
    if (autoOpen) {
      setDraft(draftFrom(null, nextRound));
      setEditing("new");
      onAutoOpened();
    }
  }, [autoOpen, nextRound, onAutoOpened]);

  const set = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  function open(target: InterviewRecord | "new") {
    setDraft(draftFrom(target === "new" ? null : target, nextRound));
    setEditing(target);
  }

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.application(appId),
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.applicationEvents(appId),
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    setBusy(true);
    const fields = fieldsFrom(draft);
    const failed =
      fields.outcome === "failed" &&
      (editing === "new" || editing.outcome !== "failed");
    try {
      if (editing === "new") {
        const result = await api(
          "POST /api/v1/applications/{app_id}/interviews",
          {
            params: { app_id: appId },
            body: {
              ...fields,
              move_application: canMove && draft.moveApplication,
            },
            idempotencyKey: newIdempotencyKey(),
          }
        );
        if (result.application) {
          commitApplicationToBoard(queryClient, result.application);
        }
      } else {
        const outcome = await write<InterviewRecord>(
          {
            base: editing,
            changes: fields,
            fields: INTERVIEW_FIELDS,
            send: async (baseRevision, changes) =>
              (
                await api(
                  "PATCH /api/v1/applications/{app_id}/interviews/{ivw_id}",
                  {
                    params: { app_id: appId, ivw_id: editing.id },
                    body: { ...changes, base_revision: baseRevision },
                    idempotencyKey: newIdempotencyKey(),
                  }
                )
              ).interview,
          },
          { what: t("interviews.what") }
        );
        if (!outcome || outcome.kind === "overlap") {
          await refresh();
          setEditing(null);
          return;
        }
      }
      toast.success(t("interviews.saved"));
      setEditing(null);
      await refresh();
      if (failed && !["rejected", "withdrawn"].includes(application.stage)) {
        setAskReject(true);
      }
    } catch {
      toast.error(t("interviews.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(interview: InterviewRecord) {
    try {
      await api("DELETE /api/v1/applications/{app_id}/interviews/{ivw_id}", {
        params: { app_id: appId, ivw_id: interview.id },
        query: { base_revision: interview.revision },
        idempotencyKey: newIdempotencyKey(),
      });
      setEditing(null);
      await refresh();
    } catch {
      toast.error(t("interviews.deleteFailed"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-subtitle weight-semibold">
          {t("interviews.heading")}
        </h2>
        <Button onClick={() => open("new")} size="sm" variant="outline">
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t("interviews.add")}
        </Button>
      </div>
      {sorted.length === 0 ? (
        <p className="type-body text-muted-foreground">
          {t("interviews.empty")}
        </p>
      ) : (
        <div className="border border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("interviews.round")}</TableHead>
                <TableHead>{t("interviews.kind")}</TableHead>
                <TableHead>{t("interviews.when")}</TableHead>
                <TableHead>{t("interviews.location")}</TableHead>
                <TableHead>{t("interviews.outcome")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((interview) => {
                const href = safeHref(interview.location);
                return (
                  <TableRow key={interview.id}>
                    <TableCell className="tabular-nums">
                      {interview.round}
                    </TableCell>
                    <TableCell className="text-foreground">
                      {interviewKindLabel(t, interview.kind)}
                    </TableCell>
                    <TableCell>
                      {interview.scheduled_at
                        ? formatDateTime(
                            interview.scheduled_at,
                            locale,
                            interview.timezone
                          )
                        : "—"}
                    </TableCell>
                    <TableCell className="max-w-48 truncate">
                      {href ? (
                        <a
                          className="text-primary hover:underline"
                          href={href}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {displayUrl(href)}
                        </a>
                      ) : (
                        (interview.location ?? "—")
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          interview.outcome === "failed"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {interviewOutcomeLabel(t, interview.outcome)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {interview.scheduled_at ? (
                          <Button asChild size="icon-xs" variant="ghost">
                            <a
                              aria-label={t("interviews.ics")}
                              download
                              href={`/download/applications/${appId}/interviews/${interview.id}.ics`}
                            >
                              <CalendarPlus aria-hidden="true" />
                            </a>
                          </Button>
                        ) : null}
                        <Button
                          onClick={() => open(interview)}
                          size="xs"
                          variant="ghost"
                        >
                          {t("common.edit")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet
        onOpenChange={(value) => !value && setEditing(null)}
        open={editing !== null}
      >
        <SheetContent className="sm:max-w-md">
          <form className="flex h-full flex-col" onSubmit={save}>
            <SheetHeader>
              <SheetTitle>
                {editing === "new"
                  ? t("interviews.addTitle")
                  : t("interviews.editTitle")}
              </SheetTitle>
              <SheetDescription>{t("interviews.sheetHelp")}</SheetDescription>
            </SheetHeader>
            <FieldGroup className="flex-1 gap-4 overflow-y-auto px-4 pb-4">
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor={`${id}-round`}>
                    {t("interviews.round")}
                  </FieldLabel>
                  <Input
                    className="field-touch"
                    id={`${id}-round`}
                    min={1}
                    onChange={(event) => set({ round: event.target.value })}
                    type="number"
                    value={draft.round}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-kind`}>
                    {t("interviews.kind")}
                  </FieldLabel>
                  <Select
                    onValueChange={(value) =>
                      set({ kind: value as InterviewKind })
                    }
                    value={draft.kind}
                  >
                    <SelectTrigger className="w-full" id={`${id}-kind`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVIEW_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {interviewKindLabel(t, kind)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor={`${id}-when`}>
                  {t("interviews.when")}
                </FieldLabel>
                <Input
                  className="field-touch"
                  id={`${id}-when`}
                  onChange={(event) => set({ scheduled: event.target.value })}
                  type="datetime-local"
                  value={draft.scheduled}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor={`${id}-duration`}>
                    {t("interviews.duration")}
                  </FieldLabel>
                  <Input
                    className="field-touch"
                    id={`${id}-duration`}
                    min={1}
                    onChange={(event) => set({ duration: event.target.value })}
                    type="number"
                    value={draft.duration}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-tz`}>
                    {t("interviews.timezone")}
                  </FieldLabel>
                  <Input
                    className="field-touch"
                    id={`${id}-tz`}
                    onChange={(event) => set({ timezone: event.target.value })}
                    value={draft.timezone}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor={`${id}-location`}>
                  {t("interviews.location")}
                </FieldLabel>
                <Input
                  className="field-touch"
                  id={`${id}-location`}
                  onChange={(event) => set({ location: event.target.value })}
                  placeholder={t("interviews.locationPlaceholder")}
                  value={draft.location}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-people`}>
                  {t("interviews.interviewers")}
                </FieldLabel>
                <Input
                  className="field-touch"
                  id={`${id}-people`}
                  onChange={(event) =>
                    set({ interviewers: event.target.value })
                  }
                  value={draft.interviewers}
                />
                <FieldDescription>
                  {t("interviews.interviewersHelp")}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel id={`${id}-outcome-label`}>
                  {t("interviews.outcome")}
                </FieldLabel>
                <ToggleGroup
                  aria-labelledby={`${id}-outcome-label`}
                  className="flex-wrap"
                  onValueChange={(value) =>
                    value && set({ outcome: value as InterviewOutcome })
                  }
                  size="sm"
                  type="single"
                  value={draft.outcome}
                >
                  {INTERVIEW_OUTCOMES.map((outcome) => (
                    <ToggleGroupItem key={outcome} value={outcome}>
                      {interviewOutcomeLabel(t, outcome)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-notes`}>
                  {t("interviews.notes")}
                </FieldLabel>
                <Textarea
                  className="field-touch"
                  id={`${id}-notes`}
                  onChange={(event) => set({ notes: event.target.value })}
                  value={draft.notes}
                />
              </Field>
              {editing === "new" && canMove ? (
                <Field orientation="horizontal">
                  <Switch
                    checked={draft.moveApplication}
                    id={`${id}-move`}
                    onCheckedChange={(value) => set({ moveApplication: value })}
                  />
                  <FieldLabel htmlFor={`${id}-move`}>
                    {t("interviews.moveToInterviewing")}
                  </FieldLabel>
                </Field>
              ) : null}
            </FieldGroup>
            <SheetFooter className="flex-row justify-between border-line border-t">
              {editing && editing !== "new" ? (
                <Button
                  onClick={() => remove(editing)}
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

      <AlertDialog onOpenChange={setAskReject} open={askReject}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("interviews.rejectTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("interviews.rejectBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("interviews.keepStage")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onMove("rejected")}
              variant="destructive"
            >
              {t("interviews.markRejected")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
