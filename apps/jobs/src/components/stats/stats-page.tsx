// Stats (12 §9, 10 §8): the toolbar band with the date range, four stat
// cells, the unconfirmed-submissions callout, the funnel, the weekly series,
// rejections by stage, time to response (median with P75), the breakdown
// table and the automation reliability card. Every chart has a data-table
// toggle (T10-10). Numbers come from /api/v1/analytics/* for the range in
// the browser's time zone; rates stay hidden for cohorts under 5 (10 §2.2).

import type { AnalyticsBreakdown } from "@pilihpendidikan/jobs-contracts/enums";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Button } from "@rulisme/ui/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@rulisme/ui/ui/empty";
import { Band, Rail } from "@rulisme/ui/ui/rails";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { BarChart3, CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { AppLink } from "@/components/app-link";
import {
  useAnalyticsBreakdown,
  useAnalyticsSummary,
  useAnalyticsTimeseries,
} from "@/hooks/use-analytics";
import { useTranslation } from "@/i18n";
import { isoDay } from "@/lib/board-model";
import { browserTimeZone } from "@/lib/format";
import { isEmptySummary } from "@/lib/stats-model";
import type { SeriesMetric, StatsSearch } from "@/lib/stats-range";
import { intervalFor, resolveRange } from "@/lib/stats-range";
import { RangePicker } from "./range-picker";
import {
  AutomationCard,
  BreakdownSection,
  FunnelSection,
  RejectionSection,
  SeriesSection,
  StatCells,
  StatCellsSkeleton,
  TimingSection,
  UnconfirmedCallout,
} from "./stats-sections";

const DEFAULT_METRIC: SeriesMetric = "applied";
const DEFAULT_BREAKDOWN: AnalyticsBreakdown = "source";

function SectionsSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-6 lg:grid-cols-2">
      {["funnel", "series", "rejection", "timing"].map((key) => (
        <Skeleton className="h-80 w-full" key={key} />
      ))}
    </div>
  );
}

function EmptyStats({
  allTime,
  onShowAll,
}: {
  allTime: boolean;
  onShowAll: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BarChart3 aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t("stats.empty.title")}</EmptyTitle>
        <EmptyDescription>
          {allTime ? t("stats.empty.bodyAllTime") : t("stats.empty.body")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center">
        <Button asChild size="sm" variant="outline">
          <AppLink href="/board">{t("stats.empty.board")}</AppLink>
        </Button>
        <Button asChild size="sm" variant="outline">
          <AppLink href="/inbox">{t("stats.empty.inbox")}</AppLink>
        </Button>
        {allTime ? null : (
          <Button onClick={onShowAll} size="sm" variant="ghost">
            {t("stats.empty.allTime")}
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}

export function StatsPage({
  search,
  onSearchChange,
}: {
  search: StatsSearch;
  onSearchChange: (next: StatsSearch) => void;
}) {
  const { t } = useTranslation();
  // One clock for the visit: query keys stay stable while the page is open.
  const [nowMs] = useState(() => Date.now());
  const [tz] = useState(browserTimeZone);
  const range = useMemo(() => resolveRange(search, nowMs), [search, nowMs]);
  const today = isoDay(new Date(nowMs));
  const query = { from: range.from, to: range.to, tz };
  const metric = search.metric ?? DEFAULT_METRIC;
  const by = search.by ?? DEFAULT_BREAKDOWN;

  const summary = useAnalyticsSummary(query);
  const series = useAnalyticsTimeseries(metric, intervalFor(range), query);
  const breakdown = useAnalyticsBreakdown(by, query);

  const update = (next: Partial<StatsSearch>) =>
    onSearchChange({ ...search, ...next });

  let content = (
    <>
      <SectionsSkeleton />
      <Skeleton aria-hidden="true" className="h-48 w-full" />
    </>
  );
  if (summary.isError) {
    content = (
      <Alert role="alert" variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>{t("stats.error.title")}</AlertTitle>
        <AlertDescription>{t("stats.error.body")}</AlertDescription>
        <AlertAction>
          <Button onClick={() => summary.refetch()} size="sm" variant="outline">
            {t("common.retry")}
          </Button>
        </AlertAction>
      </Alert>
    );
  } else if (summary.data && isEmptySummary(summary.data)) {
    content = (
      <EmptyStats
        allTime={range.preset === "all"}
        onShowAll={() =>
          update({ range: "all", from: undefined, to: undefined })
        }
      />
    );
  } else if (summary.data) {
    const data = summary.data;
    content = (
      <>
        <UnconfirmedCallout count={data.unconfirmed_count} />
        <div className="grid gap-6 lg:grid-cols-2">
          <FunnelSection summary={data} />
          <SeriesSection
            failed={series.isError}
            loading={series.isPending}
            metric={metric}
            onMetricChange={(next) => update({ metric: next })}
            onRetry={() => series.refetch()}
            series={series.data}
          />
          <RejectionSection summary={data} />
          <TimingSection summary={data} />
        </div>
        <BreakdownSection
          breakdown={breakdown.data}
          by={by}
          failed={breakdown.isError}
          loading={breakdown.isPending}
          onByChange={(next) => update({ by: next })}
          onRetry={() => breakdown.refetch()}
        />
        <AutomationCard summary={data} />
      </>
    );
  }

  return (
    <div className="flex flex-col">
      <Band>
        <Rail
          className="flex flex-col gap-4 px-4 py-6 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:px-8"
          nodes={false}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="type-title">{t("pages.stats")}</h1>
            <p className="type-caption max-w-xl text-muted-foreground">
              {t("stats.intro")}
            </p>
          </div>
          <RangePicker
            onChange={(next) => update(next)}
            range={range}
            today={today}
          />
        </Rail>
      </Band>
      {summary.data && !isEmptySummary(summary.data) ? (
        <Band>
          <Rail nodes={false}>
            <StatCells summary={summary.data} />
          </Rail>
        </Band>
      ) : null}
      {summary.isPending ? (
        <Band>
          <Rail nodes={false}>
            <StatCellsSkeleton />
          </Rail>
        </Band>
      ) : null}
      <Rail
        aria-busy={summary.isPending}
        className="flex min-w-0 flex-col gap-6 px-4 py-6 sm:px-8"
        nodes={false}
      >
        {content}
      </Rail>
    </div>
  );
}
