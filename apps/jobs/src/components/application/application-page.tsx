// The application detail (12 §5.1): header band, tabs (Overview, CV, Apply,
// Timeline, Interviews, Offers, Checklists) and the Next-step rail. Polls
// every 15 s, every 2 s while a task for it is live (12 §10). A not-owned or
// missing id renders the not-found screen (the API answers 404 for both).

import type {
  ApplicationDetail,
  LiveTaskSummary,
} from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import type { ApplicationEventRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Button } from "@rulisme/ui/ui/button";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@rulisme/ui/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MoveRequest } from "@/components/board/use-move-card";
import { useMoveCard } from "@/components/board/use-move-card";
import type { FollowUpTarget } from "@/components/follow-up-dialog";
import { FollowUpDialog } from "@/components/follow-up-dialog";
import { NotFoundPage } from "@/components/not-found";
import { useAnnouncer } from "@/hooks/use-announcer";
import { commitApplicationToBoard } from "@/hooks/use-board";
import { useApplicationPatch } from "@/hooks/use-conflict-write";
import { useDevices } from "@/hooks/use-devices";
import {
  isLiveDetail,
  patchDetailApplication,
  useApplication,
  useApplicationEvents,
} from "@/hooks/use-application";
import { useTranslation } from "@/i18n";
import { isApiError } from "@/lib/api-client";
import { actorLabel } from "@/lib/labels";
import type { NextStep } from "@/lib/next-step";
import { ApplicationHeader } from "./application-header";
import { ApplyTab } from "./apply-tab";
import { ChecklistsTab } from "./checklists-tab";
import { CvTab } from "./cv-tab";
import { InterviewsTab } from "./interviews-tab";
import type { DetailTab } from "./next-step-rail";
import { NextStepRail } from "./next-step-rail";
import { OffersTab } from "./offers-tab";
import { OverviewTab } from "./overview-tab";
import { SubmissionDialog } from "./submission-dialog";
import { TimelineTab } from "./timeline-tab";

const TABS: readonly DetailTab[] = [
  "overview",
  "cv",
  "apply",
  "timeline",
  "interviews",
  "offers",
  "checklists",
];
const LIVE_STATES = new Set([
  "queued",
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
]);
const MINUTE_MS = 60_000;

/** The move subject of an application: its live task as a board summary. */
export function moveSubjectOf(detail: ApplicationDetail): MoveRequest["card"] {
  const task = detail.tasks.find((entry) => LIVE_STATES.has(entry.state));
  const live: LiveTaskSummary | null = task
    ? {
        id: task.id,
        kind: task.kind,
        state: task.state,
        device_id: task.lease_device_id ?? task.target_device_id,
        device_name: null,
        pause_reason: task.pause_reason,
        progress_stage: "stage" in task.progress ? task.progress.stage : null,
        submit_intent_at: task.submit_intent_at,
        updated_at: task.updated_at,
      }
    : null;
  return {
    id: detail.application.id,
    stage: detail.application.stage,
    revision: detail.application.revision,
    submission_status: detail.application.submission_status,
    live_task: live,
    company: detail.posting.company_name,
    title: detail.posting.title,
  };
}

function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 p-5">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-7 w-96 max-w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export function ApplicationPage({ appId }: { appId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useApplication(appId);
  const detail = query.data;
  const events = useApplicationEvents(appId, isLiveDetail(detail));
  const { byId } = useDevices();
  const { message, announce } = useAnnouncer();
  const { requestMove, dialogs } = useMoveCard({ announce });
  const patch = useApplicationPatch();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [openInterview, setOpenInterview] = useState(false);
  const [submissionOpen, setSubmissionOpen] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpTarget | null>(null);
  const [reviewVariant, setReviewVariant] = useState<string | null>(null);
  const [cvApprovable, setCvApprovable] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(timer);
  }, []);

  const actorName = useCallback(
    (event: ApplicationEventRecord) => {
      const device = event.actor_device_id
        ? byId.get(event.actor_device_id)
        : undefined;
      if (
        device &&
        (event.actor_kind === "automation" || event.actor_kind === "user")
      ) {
        return t("actors.device", { device: device.name });
      }
      return actorLabel(t, event.actor_kind);
    },
    [byId, t]
  );

  const onMove = useCallback(
    (target: Stage) => {
      if (detail) {
        requestMove({ card: moveSubjectOf(detail), target });
      }
    },
    [detail, requestMove]
  );

  const runStep = useCallback((step: NextStep) => {
    switch (step.kind) {
      case "review_outcome":
      case "confirm_submission":
        setSubmissionOpen(true);
        return;
      case "add_interview":
        setTab("interviews");
        setOpenInterview(true);
        return;
      case "start_apply":
        setTab("apply");
        return;
      case "review_cv":
        setReviewVariant(step.cvVariantId ?? null);
        setTab("cv");
        return;
      default:
        setTab("cv");
    }
  }, []);

  const openFollowUp = useCallback(() => {
    if (detail) {
      setFollowUp({
        company: detail.posting.company_name,
        title: detail.posting.title,
        record: detail.application,
      });
    }
  }, [detail]);

  const onAutoOpened = useCallback(() => setOpenInterview(false), []);
  const tabs = useMemo(
    () => TABS.map((value) => ({ value, label: t(`detail.tabs.${value}`) })),
    [t]
  );

  if (query.isError && isApiError(query.error) && query.error.status === 404) {
    return <NotFoundPage />;
  }
  if (!detail) {
    if (query.isPending) {
      return <DetailSkeleton />;
    }
    return (
      <div className="p-4 sm:p-5">
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("detail.errorTitle")}</AlertTitle>
          <AlertDescription>{t("detail.error")}</AlertDescription>
          <AlertAction>
            <Button onClick={() => query.refetch()} size="sm" variant="outline">
              {t("common.retry")}
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ApplicationHeader
        detail={detail}
        nowMs={now}
        onFollowUp={openFollowUp}
        onMove={onMove}
      />
      {query.stale ? (
        <p
          className="type-caption band px-4 py-1.5 text-muted-foreground sm:px-6"
          role="status"
        >
          {t("detail.stale")}
        </p>
      ) : null}
      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Tabs
          className="min-w-0 gap-0"
          onValueChange={(value) => setTab(value as DetailTab)}
          value={tab}
        >
          <div className="band no-scrollbar overflow-x-auto px-4 sm:px-6">
            <TabsList
              aria-label={t("detail.tabsLabel")}
              className="border-b-0"
              variant="line"
            >
              {tabs.map((entry) => (
                <TabsTrigger
                  className="px-2.5"
                  key={entry.value}
                  value={entry.value}
                >
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="px-4 py-5 sm:px-6">
            <TabsContent value="overview">
              <OverviewTab
                actorName={actorName}
                detail={detail}
                events={events.events}
                nowMs={now}
              />
            </TabsContent>
            <TabsContent value="cv">
              <CvTab
                detail={detail}
                onApprovableChange={setCvApprovable}
                preferredVariantId={reviewVariant}
              />
            </TabsContent>
            <TabsContent value="apply">
              <ApplyTab detail={detail} />
            </TabsContent>
            <TabsContent value="timeline">
              <TimelineTab
                actorName={actorName}
                appId={appId}
                events={events.events}
                hasMore={Boolean(events.hasNextPage)}
                loading={events.isPending}
                loadingMore={events.isFetchingNextPage}
                nowMs={now}
                onLoadMore={() => events.fetchNextPage()}
              />
            </TabsContent>
            <TabsContent value="interviews">
              <InterviewsTab
                autoOpen={openInterview}
                detail={detail}
                onAutoOpened={onAutoOpened}
                onMove={onMove}
              />
            </TabsContent>
            <TabsContent value="offers">
              <OffersTab detail={detail} onMove={onMove} />
            </TabsContent>
            <TabsContent value="checklists">
              <ChecklistsTab application={detail.application} />
            </TabsContent>
          </div>
        </Tabs>
        <NextStepRail
          detail={detail}
          nowMs={now}
          onAcceptFollowUp={(changes) =>
            patch(detail.application, changes, t("followUp.what"))
          }
          onEditFollowUp={openFollowUp}
          onRun={runStep}
          shortcutEnabled={!(tab === "cv" && cvApprovable)}
        />
      </div>
      <SubmissionDialog
        application={detail.application}
        onOpenChange={setSubmissionOpen}
        onSaved={(application) => {
          patchDetailApplication(queryClient, application);
          commitApplicationToBoard(queryClient, application);
        }}
        open={submissionOpen}
      />
      <FollowUpDialog onClose={() => setFollowUp(null)} target={followUp} />
      <div aria-atomic="true" aria-live="assertive" className="sr-only">
        {message}
      </div>
      {dialogs}
    </div>
  );
}
