// The blocks of the Stats page (12 §9, 10 §8): stat cells, the unconfirmed
// callout, the four charts (each with its data table), the breakdown table
// and the automation reliability card.

import type {
  AnalyticsBreakdownResponse,
  AnalyticsSummaryResponse,
  AnalyticsTimeseriesResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import type { AnalyticsBreakdown } from "@pilihpendidikan/jobs-contracts/enums";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Button } from "@rulisme/ui/ui/button";
import { Card, CardContent } from "@rulisme/ui/ui/card";
import { Field, FieldLabel } from "@rulisme/ui/ui/field";
import { NativeSelect, NativeSelectOption } from "@rulisme/ui/ui/native-select";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { CircleAlert, CircleHelp } from "lucide-react";
import { useId, useMemo } from "react";
import { AppLink } from "@/components/app-link";
import { useTranslation } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { breakdownLabel, metricLabel } from "@/lib/labels";
import {
  automationModel,
  breakdownTable,
  funnelRows,
  funnelSummary,
  funnelTable,
  rejectionRows,
  rejectionSummary,
  rejectionTable,
  seriesPoints,
  seriesSummary,
  seriesTable,
  statCells,
  timingChartData,
  timingRows,
  timingSummary,
  timingTable,
  UNCONFIRMED_BOARD_HREF,
} from "@/lib/stats-model";
import type { SeriesMetric } from "@/lib/stats-range";
import { BREAKDOWN_ORDER, SERIES_METRICS } from "@/lib/stats-range";
import { ChartFrame, DataTable, FrameHeader } from "./chart-frame";
import {
  FunnelChart,
  RejectionChart,
  SeriesChart,
  TimingChart,
} from "./stats-charts";

type Summary = AnalyticsSummaryResponse;

/** Inline failure of one block, with Retry (the page stays usable). */
export function BlockError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert role="alert" variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{t("stats.blockError")}</AlertTitle>
      <AlertAction>
        <Button onClick={onRetry} size="sm" variant="outline">
          {t("common.retry")}
        </Button>
      </AlertAction>
    </Alert>
  );
}

export function StatCells({ summary }: { summary: Summary }) {
  const { locale, t } = useTranslation();
  const cells = statCells(summary, t, locale);
  return (
    <dl
      aria-label={t("stats.cells.label")}
      className="grid grid-cols-2 sm:grid-cols-4"
    >
      {cells.map((cell) => (
        <div
          className="flex min-w-0 flex-col gap-1 border-line border-r border-b px-4 py-4 even:border-r-0 sm:border-b-0 sm:px-6 sm:even:border-r sm:last:border-r-0 [&:nth-child(n+3)]:border-b-0"
          data-stat={cell.key}
          key={cell.key}
        >
          <dt className="type-caption truncate text-muted-foreground">
            {cell.label}
          </dt>
          <dd className="type-title text-foreground tabular-nums">
            {cell.value}
          </dd>
          {cell.note ? (
            <dd className="type-caption text-muted-foreground">{cell.note}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

export function StatCellsSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 sm:grid-cols-4">
      {["a", "b", "c", "d"].map((key) => (
        <div className="flex flex-col gap-2 px-4 py-4 sm:px-6" key={key}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

/** "2 submissions are unconfirmed" → the board's needs-attention filter. */
export function UnconfirmedCallout({ count }: { count: number }) {
  const { locale, t } = useTranslation();
  if (count <= 0) {
    return null;
  }
  return (
    <Alert role="status">
      <CircleHelp aria-hidden="true" />
      <AlertTitle>
        {count === 1
          ? t("stats.unconfirmed.one")
          : t("stats.unconfirmed.many", {
              count: formatNumber(count, locale),
            })}
      </AlertTitle>
      <AlertDescription>{t("stats.unconfirmed.body")}</AlertDescription>
      <AlertAction>
        <Button asChild size="sm" variant="outline">
          <AppLink href={UNCONFIRMED_BOARD_HREF}>
            {t("stats.unconfirmed.action")}
          </AppLink>
        </Button>
      </AlertAction>
    </Alert>
  );
}

export function FunnelSection({ summary }: { summary: Summary }) {
  const { locale, t } = useTranslation();
  const rows = useMemo(() => funnelRows(summary, t), [summary, t]);
  return (
    <ChartFrame
      description={t("stats.funnel.description")}
      id="funnel"
      summary={funnelSummary(rows, t, locale)}
      table={funnelTable(rows, t, locale)}
      title={t("stats.funnel.title")}
    >
      <FunnelChart rows={rows} />
    </ChartFrame>
  );
}

export function RejectionSection({ summary }: { summary: Summary }) {
  const { locale, t } = useTranslation();
  const rows = useMemo(() => rejectionRows(summary, t), [summary, t]);
  return (
    <ChartFrame
      description={t("stats.rejection.description", {
        count: formatNumber(summary.funnel.rejected_total, locale),
      })}
      id="rejection"
      summary={rejectionSummary(rows, t, locale)}
      table={rejectionTable(rows, t, locale)}
      title={t("stats.rejection.title")}
    >
      <RejectionChart rows={rows} />
    </ChartFrame>
  );
}

export function TimingSection({ summary }: { summary: Summary }) {
  const { locale, t } = useTranslation();
  const rows = useMemo(() => timingRows(summary, t), [summary, t]);
  const points = timingChartData(rows);
  return (
    <ChartFrame
      description={t("stats.timing.description")}
      id="timing"
      summary={timingSummary(rows, t, locale)}
      table={timingTable(rows, t, locale)}
      title={t("stats.timing.title")}
    >
      {points.length === 0 ? (
        <p className="type-body py-8 text-center text-muted-foreground">
          {t("stats.timing.notEnoughYet")}
        </p>
      ) : (
        <TimingChart points={points} />
      )}
    </ChartFrame>
  );
}

function ChartSkeleton() {
  return <Skeleton aria-hidden="true" className="h-60 w-full" />;
}

export function SeriesSection({
  metric,
  onMetricChange,
  series,
  loading,
  failed,
  onRetry,
}: {
  metric: SeriesMetric;
  onMetricChange: (metric: SeriesMetric) => void;
  series: AnalyticsTimeseriesResponse | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const { locale, t } = useTranslation();
  const id = useId();
  const metricName = metricLabel(t, metric);
  const points = useMemo(
    () => (series ? seriesPoints(series, locale) : []),
    [series, locale]
  );
  const interval = series?.interval ?? "week";
  const switcher = (
    <Field className="w-auto" orientation="horizontal">
      <FieldLabel className="sr-only" htmlFor={`${id}-metric`}>
        {t("stats.series.metric")}
      </FieldLabel>
      <NativeSelect
        id={`${id}-metric`}
        onChange={(event) => onMetricChange(event.target.value as SeriesMetric)}
        size="sm"
        value={metric}
      >
        {SERIES_METRICS.map((value) => (
          <NativeSelectOption key={value} value={value}>
            {metricLabel(t, value)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
  let body = <SeriesChart metricName={metricName} points={points} />;
  if (failed) {
    body = <BlockError onRetry={onRetry} />;
  } else if (loading) {
    body = <ChartSkeleton />;
  }
  return (
    <ChartFrame
      controls={switcher}
      description={
        interval === "month"
          ? t("stats.series.descriptionMonthly")
          : t("stats.series.descriptionWeekly")
      }
      id="series"
      summary={
        loading || failed
          ? t("common.loading")
          : seriesSummary(points, metricName, t, locale)
      }
      table={seriesTable(points, metricName, interval, t, locale)}
      title={t("stats.series.title")}
    >
      {body}
    </ChartFrame>
  );
}

export function BreakdownSection({
  by,
  onByChange,
  breakdown,
  loading,
  failed,
  onRetry,
}: {
  by: AnalyticsBreakdown;
  onByChange: (by: AnalyticsBreakdown) => void;
  breakdown: AnalyticsBreakdownResponse | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const { locale, t } = useTranslation();
  const id = useId();
  const headingId = useId();
  const dimension = breakdownLabel(t, by);
  let body = <Skeleton aria-hidden="true" className="h-40 w-full" />;
  if (failed) {
    body = <BlockError onRetry={onRetry} />;
  } else if (!loading && breakdown) {
    body =
      breakdown.rows.length === 0 ? (
        <p className="type-body py-6 text-muted-foreground">
          {t("stats.breakdown.empty")}
        </p>
      ) : (
        <DataTable model={breakdownTable(breakdown, dimension, t, locale)} />
      );
  }
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <Card size="sm">
        <FrameHeader
          description={t("stats.breakdown.description")}
          headingId={headingId}
          title={t("stats.breakdown.title")}
        >
          <Field className="w-auto" orientation="horizontal">
            <FieldLabel htmlFor={`${id}-by`}>
              {t("stats.breakdown.by")}
            </FieldLabel>
            <NativeSelect
              id={`${id}-by`}
              onChange={(event) =>
                onByChange(event.target.value as AnalyticsBreakdown)
              }
              size="sm"
              value={by}
            >
              {BREAKDOWN_ORDER.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {breakdownLabel(t, value)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </FrameHeader>
        <CardContent aria-busy={loading} className="min-w-0">
          {body}
        </CardContent>
      </Card>
    </section>
  );
}

export function AutomationCard({ summary }: { summary: Summary }) {
  const { locale, t } = useTranslation();
  const headingId = useId();
  const model = automationModel(summary, t, locale);
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <Card size="sm">
        <FrameHeader
          description={
            model.total === 0
              ? t("stats.automation.none")
              : t("stats.automation.description", {
                  count: formatNumber(model.total, locale),
                })
          }
          headingId={headingId}
          title={t("stats.automation.title")}
        />
        {model.total === 0 ? null : (
          <CardContent className="flex flex-col gap-4">
            <dl
              aria-label={t("stats.automation.statesLabel")}
              className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5"
            >
              {model.states.map((entry) => (
                <div className="flex flex-col" key={entry.key}>
                  <dt className="type-caption text-muted-foreground">
                    {entry.label}
                  </dt>
                  <dd className="type-subtitle text-foreground tabular-nums">
                    {entry.value}
                  </dd>
                </div>
              ))}
            </dl>
            <dl
              aria-label={t("stats.automation.ratesLabel")}
              className="grid grid-cols-1 gap-x-6 gap-y-2 border-line border-t pt-3 sm:grid-cols-3"
            >
              {model.rates.map((entry) => (
                <div
                  className="flex items-baseline justify-between gap-3 sm:flex-col sm:justify-start sm:gap-0"
                  key={entry.key}
                >
                  <dt className="type-caption text-muted-foreground">
                    {entry.label}
                  </dt>
                  <dd className="type-body weight-semibold text-foreground tabular-nums">
                    {entry.value}
                  </dd>
                </div>
              ))}
            </dl>
            {model.failures.length > 0 ? (
              <div className="flex flex-col gap-1.5 border-line border-t pt-3">
                <h3 className="type-caption weight-semibold text-foreground">
                  {t("stats.automation.failures")}
                </h3>
                <ul className="flex flex-col">
                  {model.failures.map((entry) => (
                    <li
                      className="type-body-compact flex justify-between gap-3 border-line border-b py-1.5 last:border-b-0"
                      key={entry.key}
                    >
                      <span className="min-w-0 truncate">{entry.label}</span>
                      <span className="text-foreground tabular-nums">
                        {entry.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <AppLink
              className="type-body-compact self-start text-primary underline-offset-4 hover:underline"
              href="/automation/runs"
            >
              {t("stats.automation.seeRuns")}
            </AppLink>
          </CardContent>
        )}
      </Card>
    </section>
  );
}
