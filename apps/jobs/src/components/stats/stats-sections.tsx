// The blocks of the Stats page (12 §9, 10 §8): stat cards, the unconfirmed
// callout, the four charts (each with its data table) and the breakdown
// table.

import { StatCard, StatGrid } from "@rulisme/ui/ui/stat-card";
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
import { SectionCard } from "@rulisme/ui/blocks/settings";
import { Field, FieldLabel } from "@rulisme/ui/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import type { LucideIcon } from "lucide-react";
import {
  Award,
  Building2,
  CalendarClock,
  CircleAlert,
  CircleHelp,
  CircleX,
  Copy,
  FileText,
  Gauge,
  Globe,
  LayoutGrid,
  MapPin,
  MoreHorizontal,
  Send,
} from "lucide-react";
import { useId, useMemo } from "react";
import { AppLink, useAppNavigate } from "@/components/app-link";
import { useTranslation } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { breakdownLabel, metricLabel } from "@/lib/labels";
import {
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
  statDeltas,
  timingChartData,
  timingRows,
  timingSummary,
  timingTable,
  UNCONFIRMED_BOARD_HREF,
} from "@/lib/stats-model";
import type { SeriesMetric } from "@/lib/stats-range";
import { BREAKDOWN_ORDER, SERIES_METRICS } from "@/lib/stats-range";
import { ChartFrame, DataTable } from "./chart-frame";
import {
  FunnelChart,
  RejectionChart,
  SeriesChart,
  TimingChart,
} from "./stats-charts";

type Summary = AnalyticsSummaryResponse;

const METRIC_ICONS: Record<SeriesMetric, LucideIcon> = {
  applied: FileText,
  interviews: CalendarClock,
  offers: Award,
  rejected: CircleX,
};

const BREAKDOWN_ICONS: Record<(typeof BREAKDOWN_ORDER)[number], LucideIcon> = {
  source: Globe,
  cv_variant: FileText,
  score_band: Gauge,
  company: Building2,
  method: Send,
  workplace_type: MapPin,
};

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

/** The four stat cards (reui stats): label, value + delta chip, then the
 * previous period's value or the cell's note under a rule. */
/** A stat card's `…` menu: open the board, or copy the figure. */
function StatCellMenu({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const navigate = useAppNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("stats.cells.menu", { label })}
          className="text-foreground"
          size="icon-xs"
          variant="ghost"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => navigate("/board")}>
          <LayoutGrid aria-hidden="true" />
          {t("stats.cells.openBoard")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            navigator.clipboard
              ?.writeText(`${label}: ${value}`)
              .catch(() => undefined);
          }}
        >
          <Copy aria-hidden="true" />
          {t("stats.cells.copy")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StatCells({
  summary,
  previous,
}: {
  summary: Summary;
  /** The period of the same length before, for the delta chips. */
  previous?: Summary;
}) {
  const { locale, t } = useTranslation();
  const cells = statCells(summary, t, locale);
  const deltas = previous ? statDeltas(summary, previous, t, locale) : {};
  return (
    <StatGrid aria-label={t("stats.cells.label")}>
      {cells.map((cell) => {
        const delta = deltas[cell.key];
        return (
          <StatCard
            action={<StatCellMenu label={cell.label} value={cell.value} />}
            data-stat={cell.key}
            delta={
              delta
                ? { direction: delta.direction, label: delta.label }
                : undefined
            }
            footer={
              delta ? (
                <>
                  {t("stats.cells.vsPrevious")}{" "}
                  <span className="text-foreground tabular-nums">
                    {delta.previous}
                  </span>
                  {cell.note ? (
                    <span className="sr-only">. {cell.note}</span>
                  ) : null}
                </>
              ) : (
                (cell.note ?? t("stats.cells.noPrevious"))
              )
            }
            key={cell.key}
            label={cell.label}
            value={cell.value}
          />
        );
      })}
    </StatGrid>
  );
}

export function StatCellsSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
    >
      {["a", "b", "c", "d"].map((key) => (
        <div
          className="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-4"
          key={key}
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-32" />
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
    <Alert className="max-sm:pr-4" role="status">
      <CircleHelp aria-hidden="true" />
      <AlertTitle>
        {count === 1
          ? t("stats.unconfirmed.one")
          : t("stats.unconfirmed.many", {
              count: formatNumber(count, locale),
            })}
      </AlertTitle>
      <AlertDescription>{t("stats.unconfirmed.body")}</AlertDescription>
      <AlertAction className="max-sm:static max-sm:col-start-2 max-sm:mt-2">
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
      <Select
        onValueChange={(value) => onMetricChange(value as SeriesMetric)}
        value={metric}
      >
        <SelectTrigger id={`${id}-metric`} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {SERIES_METRICS.map((value) => {
            const Icon = METRIC_ICONS[value];
            return (
              <SelectItem key={value} value={value}>
                <Icon aria-hidden="true" />
                {metricLabel(t, value)}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
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
    <div className="min-w-0">
      <SectionCard
        action={
          <Field className="w-auto" orientation="horizontal">
            <FieldLabel htmlFor={`${id}-by`}>
              {t("stats.breakdown.by")}
            </FieldLabel>
            <Select
              onValueChange={(value) => onByChange(value as AnalyticsBreakdown)}
              value={by}
            >
              <SelectTrigger id={`${id}-by`} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {BREAKDOWN_ORDER.map((value) => {
                  const Icon = BREAKDOWN_ICONS[value];
                  return (
                    <SelectItem key={value} value={value}>
                      <Icon aria-hidden="true" />
                      {breakdownLabel(t, value)}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Field>
        }
        description={t("stats.breakdown.description")}
        id={headingId}
        title={t("stats.breakdown.title")}
      >
        <div aria-busy={loading} className="min-w-0">
          {body}
        </div>
      </SectionCard>
    </div>
  );
}
