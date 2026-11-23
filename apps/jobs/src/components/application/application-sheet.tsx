// The details sheet (reui's sheet): opened from a board card, list row or
// table row and kept in the URL (`/board?app=<id>`) so it can be linked. A
// header (company avatar, role, company), the property chips with the stage
// select, then Next step, Notes, Interviews and Follow-up in cards; the
// footer holds "Open full page" and the next step's primary action (`Y`).

import { SectionCard } from "@rulisme/ui/blocks/settings";
import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import type { ApplicationEventRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Button } from "@rulisme/ui/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@rulisme/ui/ui/sheet";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { Link } from "@tanstack/react-router";
import { CalendarClock, CircleAlert, Maximize2 } from "lucide-react";
import { useCallback } from "react";
import { useApplication, useApplicationEvents } from "@/hooks/use-application";
import type { ApplicationPatch } from "@/hooks/use-conflict-write";
import { useTranslation } from "@/i18n";
import { isApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { actorLabel, interviewKindLabel } from "@/lib/labels";
import type { NextStep } from "@/lib/next-step";
import { computeNextStep } from "@/lib/next-step";
import {
  ApplicationIdentity,
  ApplicationProperties,
} from "./application-summary";
import type { DetailTab } from "./next-step-rail";
import {
  FollowUpSection,
  NextStepButton,
  NextStepCard,
} from "./next-step-rail";
import { NotesList } from "./notes-tab";

const SHEET_NOTES = 3;

function InterviewsSummary({
  detail,
  appId,
}: {
  detail: ApplicationDetail;
  appId: string;
}) {
  const { locale, t } = useTranslation();
  const interviews = [...detail.interviews].sort(
    (a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0)
  );
  return (
    <SectionCard
      action={
        <Button asChild size="xs" variant="ghost">
          <Link
            params={{ appId }}
            search={{ tab: "interviews" }}
            to="/applications/$appId"
          >
            {t("application.sheet.manage")}
          </Link>
        </Button>
      }
      id="sheet-interviews-heading"
      title={t("detail.tabs.interviews")}
    >
      {interviews.length === 0 ? (
        <p className="type-caption text-muted-foreground">
          {t("application.sheet.noInterviews")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {interviews.map((interview) => (
            <li
              className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
              key={interview.id}
            >
              <CalendarClock
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="flex min-w-0 flex-col">
                <span className="type-body text-foreground">
                  {t("application.sheet.round", {
                    round: interview.round,
                    kind: interviewKindLabel(t, interview.kind),
                  })}
                </span>
                <span className="type-caption text-muted-foreground">
                  {interview.scheduled_at === null
                    ? t("application.sheet.unscheduled")
                    : formatDateTime(
                        interview.scheduled_at,
                        locale,
                        interview.timezone
                      )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function SheetBody({
  appId,
  onMove,
  onFollowUp,
  onAcceptFollowUp,
  onRunStep,
  nowMs,
}: {
  appId: string;
  onMove: (detail: ApplicationDetail, target: Stage) => void;
  onFollowUp: (detail: ApplicationDetail) => void;
  onAcceptFollowUp: (
    detail: ApplicationDetail,
    changes: ApplicationPatch
  ) => Promise<unknown>;
  onRunStep: (detail: ApplicationDetail, step: NextStep) => void;
  nowMs: number;
}) {
  const { t } = useTranslation();
  const query = useApplication(appId);
  const detail = query.data;
  const events = useApplicationEvents(appId, false);
  const actorName = useCallback(
    (event: ApplicationEventRecord) => actorLabel(t, event.actor_kind),
    [t]
  );

  if (!detail) {
    const missing =
      query.isError && isApiError(query.error) && query.error.status === 404;
    return (
      <>
        <SheetHeader className="p-5">
          <SheetTitle>
            {missing ? t("application.sheet.missing") : t("detail.pageTitle")}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("application.sheet.description")}
          </SheetDescription>
        </SheetHeader>
        {query.isPending ? (
          <div aria-hidden="true" className="flex flex-col gap-3 px-5">
            <Skeleton className="h-7 w-72" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="px-5">
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>
                {missing
                  ? t("application.sheet.missing")
                  : t("detail.errorTitle")}
              </AlertTitle>
              <AlertDescription>
                {missing
                  ? t("application.sheet.missingBody")
                  : t("detail.error")}
              </AlertDescription>
              {missing ? null : (
                <AlertAction>
                  <Button
                    onClick={() => query.refetch()}
                    size="sm"
                    variant="outline"
                  >
                    {t("common.retry")}
                  </Button>
                </AlertAction>
              )}
            </Alert>
          </div>
        )}
      </>
    );
  }

  const step = computeNextStep(detail);
  return (
    <>
      <SheetHeader className="gap-4 border-border border-b p-5 pr-12">
        <ApplicationIdentity
          detail={detail}
          title={
            <SheetTitle className="type-subtitle text-pretty">
              {detail.posting.title}
            </SheetTitle>
          }
        />
        <SheetDescription className="sr-only">
          {t("application.sheet.description")}
        </SheetDescription>
        <ApplicationProperties
          detail={detail}
          onMove={(target) => onMove(detail, target)}
        />
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
        <NextStepCard
          detail={detail}
          onRun={(next) => onRunStep(detail, next)}
          shortcutEnabled={false}
          withButton={false}
        />
        <SectionCard id="sheet-notes-heading" title={t("notes.heading")}>
          <NotesList
            actorName={actorName}
            appId={appId}
            events={events.events}
            limit={SHEET_NOTES}
            nowMs={nowMs}
          />
        </SectionCard>
        <InterviewsSummary appId={appId} detail={detail} />
        <FollowUpSection
          detail={detail}
          nowMs={nowMs}
          onAccept={(changes) => onAcceptFollowUp(detail, changes)}
          onEdit={() => onFollowUp(detail)}
        />
      </div>
      <SheetFooter className="flex-row items-center justify-between gap-2 border-border border-t p-4">
        <Button asChild variant="outline">
          <Link params={{ appId }} to="/applications/$appId">
            <Maximize2 aria-hidden="true" data-icon="inline-start" />
            {t("board.openFullPage")}
          </Link>
        </Button>
        {step ? (
          <NextStepButton
            onRun={(next) => onRunStep(detail, next)}
            step={step}
          />
        ) : null}
      </SheetFooter>
    </>
  );
}

/** Where a next step from the sheet goes: the full page's matching tab. */
export function sheetStepTab(
  step: NextStep
): Exclude<DetailTab, "overview"> | null {
  if (step.kind === "review_cv") {
    return "cv";
  }
  if (step.kind === "add_interview") {
    return "interviews";
  }
  return null;
}

export function ApplicationSheet({
  appId,
  onClose,
  ...body
}: {
  appId: string | null;
  onClose: () => void;
  onMove: (detail: ApplicationDetail, target: Stage) => void;
  onFollowUp: (detail: ApplicationDetail) => void;
  onAcceptFollowUp: (
    detail: ApplicationDetail,
    changes: ApplicationPatch
  ) => Promise<unknown>;
  onRunStep: (detail: ApplicationDetail, step: NextStep) => void;
  nowMs: number;
}) {
  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open={appId !== null}>
      <SheetContent
        className="gap-0 overflow-hidden p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        side="right"
      >
        {appId ? <SheetBody appId={appId} key={appId} {...body} /> : null}
      </SheetContent>
    </Sheet>
  );
}
