// Timeline (06 §4, 12 §5.1): `application_events` newest first on a vertical
// rail, a diamond node per event, the actor chip, relative time with the
// absolute one on hover, and a sentence. Events that were recorded but not
// applied (stale writes, conflicts) read in the destructive colour. Task and
// submission events expand to their details.

import type { ApplicationEventRecord } from "@pilihpendidikan/jobs-contracts/records";
import type {
  Stage,
  SubmissionStatus,
} from "@pilihpendidikan/jobs-contracts/enums";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rulisme/ui/ui/collapsible";
import { Label } from "@rulisme/ui/ui/label";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { Switch } from "@rulisme/ui/ui/switch";
import { cn } from "@rulisme/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { MarkdownLite } from "@/components/rich-text";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { formatDateTime, relativeTime } from "@/lib/format";
import { stageLabel, submissionLabel } from "@/lib/labels";
import { deletedNoteIds, NoteComposer, noteText } from "./notes";

type Payload = Record<string, unknown>;

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** One sentence for an event (12 §13: name the actor, never overstate). */
export function describeEvent(
  event: ApplicationEventRecord,
  t: Translate
): string {
  const payload = event.payload as Payload;
  switch (event.type) {
    case "created":
      return t("timeline.created", { origin: str(payload.origin) || "web" });
    case "stage_changed":
      return t("timeline.stageChanged", {
        from: stageLabel(
          t,
          (str(payload.from) || event.from_value || "saved") as Stage
        ),
        to: stageLabel(
          t,
          (str(payload.to) || event.to_value || "saved") as Stage
        ),
      });
    case "submission_status_changed":
      return t("timeline.submissionChanged", {
        to: submissionLabel(
          t,
          (str(payload.to) ||
            event.to_value ||
            "not_started") as SubmissionStatus
        ),
      });
    case "note_deleted":
      return t("timeline.noteDeleted");
    case "approval_decided":
      return t("timeline.approvalDecided", {
        decision: str(payload.decision) || "—",
      });
    case "interview_scheduled":
    case "interview_updated":
      return t(`timeline.${event.type}`, {
        kind: str(payload.kind) ? t(`interviewKinds.${str(payload.kind)}`) : "",
      });
    case "conflict_recorded":
      return t("timeline.conflict", { reason: str(payload.reason) });
    default:
      return t(`timeline.${event.type}`);
  }
}

function hasDetails(event: ApplicationEventRecord): boolean {
  return (
    event.type.startsWith("automation_task_") ||
    event.type === "submission_status_changed"
  );
}

function EventDetails({ event }: { event: ApplicationEventRecord }) {
  const { t } = useTranslation();
  const payload = event.payload as Payload;
  const rows: [string, string][] = [];
  const add = (key: string, value: unknown) => {
    if (typeof value === "string" || typeof value === "number") {
      rows.push([t(`timeline.details.${key}`), String(value)]);
    }
  };
  add("task", payload.task_id);
  add("attempt", payload.attempt_id ?? event.attempt_id);
  add("state", payload.state);
  add("step", payload.step);
  add(
    "stage",
    typeof payload.stage === "string"
      ? t(`progressStages.${payload.stage}`)
      : undefined
  );
  add("message", payload.message);
  add(
    "pause",
    typeof payload.pause_reason === "string"
      ? t(`pauseReasons.${payload.pause_reason}`)
      : undefined
  );
  add("error", payload.error_class);
  add(
    "from",
    typeof payload.from === "string" &&
      event.type === "submission_status_changed"
      ? submissionLabel(t, payload.from as SubmissionStatus)
      : undefined
  );
  add("evidence", payload.evidence_id);
  add("via", payload.via);
  return (
    <dl className="type-caption mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
      {rows.map(([label, value]) => (
        <div className="contents" key={label}>
          <dt>{label}</dt>
          <dd className="min-w-0 break-words text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EventRow({
  event,
  actor,
  nowMs,
  deleted,
}: {
  event: ApplicationEventRecord;
  actor: string;
  nowMs: number;
  deleted: boolean;
}) {
  const { locale, t } = useTranslation();
  const conflict =
    !event.applied_to_state || event.type === "conflict_recorded";
  const sentence = describeEvent(event, t);
  return (
    <li className="relative pb-5 pl-6 last:pb-0">
      <span aria-hidden="true" className="diamond top-1.5 left-[-4px]" />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="outline">{actor}</Badge>
        <time
          className="type-micro text-muted-foreground"
          dateTime={new Date(event.recorded_at).toISOString()}
          title={formatDateTime(event.recorded_at, locale)}
        >
          {relativeTime(event.recorded_at, nowMs, locale)}
        </time>
        {deleted ? (
          <Badge variant="ghost">{t("timeline.deletedNote")}</Badge>
        ) : null}
      </div>
      {event.type === "note_added" ? (
        <MarkdownLite
          className={cn(
            "type-body mt-1",
            deleted && "text-muted-foreground line-through"
          )}
          text={noteText(event)}
        />
      ) : (
        <p className={cn("type-body mt-1", conflict && "text-destructive")}>
          {sentence}
          {conflict && event.type !== "conflict_recorded" ? (
            <span className="block">
              {t("timeline.notApplied", {
                stage: event.to_value
                  ? stageLabel(t, event.to_value as Stage)
                  : "—",
              })}
            </span>
          ) : null}
        </p>
      )}
      {hasDetails(event) ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button className="mt-1 px-0" size="xs" variant="ghost">
              {t("timeline.details.toggle")}
              <ChevronDown aria-hidden="true" data-icon="inline-end" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <EventDetails event={event} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </li>
  );
}

export function TimelineTab({
  appId,
  events,
  actorName,
  nowMs,
  loading,
  hasMore,
  onLoadMore,
  loadingMore,
}: {
  appId: string;
  events: readonly ApplicationEventRecord[];
  actorName: (event: ApplicationEventRecord) => string;
  nowMs: number;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [showDeleted, setShowDeleted] = useState(false);
  const hidden = deletedNoteIds(events);
  const visible = events.filter(
    (event) =>
      showDeleted || !(hidden.has(event.id) || event.type === "note_deleted")
  );
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <NoteComposer appId={appId} />
      <div className="flex items-center gap-2">
        <Switch
          checked={showDeleted}
          id={`${id}-deleted`}
          onCheckedChange={setShowDeleted}
        />
        <Label className="type-body-compact" htmlFor={`${id}-deleted`}>
          {t("timeline.showDeleted")}
        </Label>
      </div>
      {loading ? (
        <div aria-hidden="true" className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <ol
          aria-label={t("timeline.label")}
          className="relative ml-1 border-line border-l"
        >
          {visible.map((event) => (
            <EventRow
              actor={actorName(event)}
              deleted={hidden.has(event.id)}
              event={event}
              key={event.id}
              nowMs={nowMs}
            />
          ))}
        </ol>
      )}
      {!loading && visible.length === 0 ? (
        <p className="type-body text-muted-foreground">{t("timeline.empty")}</p>
      ) : null}
      {hasMore ? (
        <Button
          className="self-start"
          disabled={loadingMore}
          onClick={onLoadMore}
          size="sm"
          variant="outline"
        >
          {t("timeline.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}
