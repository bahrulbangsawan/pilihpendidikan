// The application's full page (12 §5.1, reui's navbar + sheet header): the
// header (avatar, role, company, property chips with the stage select), a
// tab row (Overview, CV, Interviews, Offers, Timeline, Notes, Checklists)
// whose tab lives in the URL (`?tab=`), content in cards, and the side
// column with the Next step and the follow-up. Polls every 15 s. A
// not-owned or missing id renders the not-found screen (the API answers 404
// for both).

import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import type { ApplicationEventRecord } from "@pilihpendidikan/jobs-contracts/records";
import { cn } from "@rulisme/ui/lib/utils";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@rulisme/ui/ui/tabs";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMoveCard } from "@/components/board/use-move-card";
import type { FollowUpTarget } from "@/components/follow-up-dialog";
import { FollowUpDialog } from "@/components/follow-up-dialog";
import { NotFoundPage } from "@/components/not-found";
import { PAGE_GUTTER, PageGutter } from "@rulisme/ui/blocks/page";
import { useBreadcrumbs } from "@/components/shell/top-bar";
import { useAnnouncer } from "@/hooks/use-announcer";
import {
  isLiveDetail,
  useApplication,
  useApplicationEvents,
} from "@/hooks/use-application";
import { useApplicationPatch } from "@/hooks/use-conflict-write";
import { useTranslation } from "@/i18n";
import { isApiError } from "@/lib/api-client";
import { actorLabel } from "@/lib/labels";
import type { NextStep } from "@/lib/next-step";
import { ApplicationHeader } from "./application-header";
import { ChecklistsTab } from "./checklists-tab";
import { CvTab } from "./cv-tab";
import { InterviewsTab } from "./interviews-tab";
import { moveSubjectOf } from "./move-subject";
import type { DetailTab } from "./next-step-rail";
import { DETAIL_TABS, NextStepRail } from "./next-step-rail";
import { NotesTab, visibleNotes } from "./notes-tab";
import { OffersTab } from "./offers-tab";
import { OverviewTab } from "./overview-tab";
import { TimelineTab } from "./timeline-tab";

const MINUTE_MS = 60_000;

function DetailSkeleton() {
  return (
    <div
      aria-hidden="true"
      className={cn("flex flex-col gap-4 pt-6", PAGE_GUTTER)}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-6 w-80 max-w-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-7 w-96 max-w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/** A tab's body in the nested frame (the overview and notes bring their own
 * SectionCards): a 12px frame around an 8px panel one step darker. */
function TabCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-1">
      <div className="rounded-lg border border-border bg-background p-4 sm:p-5">
        {children}
      </div>
    </div>
  );
}

export function ApplicationPage({
  appId,
  tab,
  onTabChange,
}: {
  appId: string;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}) {
  const { t } = useTranslation();
  const query = useApplication(appId);
  const detail = query.data;
  const events = useApplicationEvents(appId, isLiveDetail(detail));
  const { message, announce } = useAnnouncer();
  const { requestMove, dialogs } = useMoveCard({ announce });
  const patch = useApplicationPatch();
  const [openInterview, setOpenInterview] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpTarget | null>(null);
  const [reviewVariant, setReviewVariant] = useState<string | null>(null);
  const [cvApprovable, setCvApprovable] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(timer);
  }, []);

  const crumbs = useMemo(
    () =>
      detail
        ? [
            { label: t("nav.board"), href: "/board" },
            {
              label: `${detail.posting.company_name} — ${detail.posting.title}`,
            },
          ]
        : null,
    [detail, t]
  );
  useBreadcrumbs(crumbs);

  const actorName = useCallback(
    (event: ApplicationEventRecord) => actorLabel(t, event.actor_kind),
    [t]
  );

  const onMove = useCallback(
    (target: Stage) => {
      if (detail) {
        requestMove({ card: moveSubjectOf(detail), target });
      }
    },
    [detail, requestMove]
  );

  const runStep = useCallback(
    (step: NextStep) => {
      switch (step.kind) {
        case "add_interview":
          onTabChange("interviews");
          setOpenInterview(true);
          return;
        case "review_cv":
          setReviewVariant(step.cvVariantId ?? null);
          onTabChange("cv");
          return;
        default:
          onMove("applied");
      }
    },
    [onMove, onTabChange]
  );

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

  if (query.isError && isApiError(query.error) && query.error.status === 404) {
    return <NotFoundPage />;
  }
  if (!detail) {
    if (query.isPending) {
      return <DetailSkeleton />;
    }
    return (
      <div className={cn("py-6", PAGE_GUTTER)}>
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

  const counts: Partial<Record<DetailTab, number>> = {
    cv: detail.cv_variants.length,
    interviews: detail.interviews.length,
    offers: detail.offers.length,
    notes: visibleNotes(events.events).length,
  };
  const labels: Record<DetailTab, string> = {
    overview: t("detail.tabs.overview"),
    cv: t("detail.tabs.cv"),
    interviews: t("detail.tabs.interviews"),
    offers: t("detail.tabs.offers"),
    timeline: t("detail.tabs.timeline"),
    notes: t("application.tabs.notes"),
    checklists: t("detail.tabs.checklists"),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageGutter className="pt-6" wide>
        <ApplicationHeader
          detail={detail}
          onFollowUp={openFollowUp}
          onMove={onMove}
        />
        {query.stale ? (
          <p className="type-caption pt-2 text-muted-foreground" role="status">
            {t("detail.stale")}
          </p>
        ) : null}
      </PageGutter>
      <Tabs
        className="gap-0"
        onValueChange={(value) => onTabChange(value as DetailTab)}
        value={tab}
      >
        <div className={cn("mt-5 border-border border-b", PAGE_GUTTER)}>
          <div className="no-scrollbar -mb-px overflow-x-auto">
            <TabsList
              aria-label={t("detail.tabsLabel")}
              className="border-b-0"
              variant="line"
            >
              {DETAIL_TABS.map((value) => (
                <TabsTrigger className="px-2.5" key={value} value={value}>
                  {labels[value]}
                  {counts[value] ? (
                    <Badge className="tabular-nums" variant="secondary">
                      {counts[value]}
                    </Badge>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
        <div
          className={cn(
            "grid items-start gap-4 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]",
            PAGE_GUTTER
          )}
        >
          <div className="min-w-0">
            <TabsContent value="overview">
              <OverviewTab detail={detail} />
            </TabsContent>
            <TabsContent value="cv">
              <TabCard>
                <CvTab
                  detail={detail}
                  onApprovableChange={setCvApprovable}
                  preferredVariantId={reviewVariant}
                />
              </TabCard>
            </TabsContent>
            <TabsContent value="interviews">
              <TabCard>
                <InterviewsTab
                  autoOpen={openInterview}
                  detail={detail}
                  onAutoOpened={onAutoOpened}
                  onMove={onMove}
                />
              </TabCard>
            </TabsContent>
            <TabsContent value="offers">
              <TabCard>
                <OffersTab detail={detail} onMove={onMove} />
              </TabCard>
            </TabsContent>
            <TabsContent value="timeline">
              <TabCard>
                <TimelineTab
                  actorName={actorName}
                  events={events.events}
                  hasMore={Boolean(events.hasNextPage)}
                  loading={events.isPending}
                  loadingMore={events.isFetchingNextPage}
                  nowMs={now}
                  onLoadMore={() => events.fetchNextPage()}
                />
              </TabCard>
            </TabsContent>
            <TabsContent value="notes">
              <NotesTab
                actorName={actorName}
                appId={appId}
                events={events.events}
                nowMs={now}
              />
            </TabsContent>
            <TabsContent value="checklists">
              <TabCard>
                <ChecklistsTab application={detail.application} />
              </TabCard>
            </TabsContent>
          </div>
          <div className="order-first lg:order-none">
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
        </div>
      </Tabs>
      <FollowUpDialog onClose={() => setFollowUp(null)} target={followUp} />
      <div aria-atomic="true" aria-live="assertive" className="sr-only">
        {message}
      </div>
      {dialogs}
    </div>
  );
}
