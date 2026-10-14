// The cloud catalog list (24 §5): board name and domain, category and
// strategy, where it came from (default list, directory, added by an
// operator), status with its reason, last and next run, jobs found, how
// reliable it is, and the follow switch. Stacked rows on phones. The name
// opens the detail sheet.

import type { CloudSourceView } from "@pilihpendidikan/jobs-contracts/api";
import { Badge } from "@rulisme/ui/ui/badge";
import { Spinner } from "@rulisme/ui/ui/spinner";
import { Switch } from "@rulisme/ui/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@rulisme/ui/ui/tooltip";
import { useState } from "react";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { useTranslation } from "@/i18n";
import {
  categoryLabelKey,
  nextRunOf,
  originLabelKey,
  runStatusLabelKey,
  statusBadgeVariant,
  statusLabelKey,
  strategyLabelKey,
} from "@/lib/cloud-sources-model";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  relativeTime,
} from "@/lib/format";
import { displayUrl, safeHref } from "@/lib/safe-url";

export function StatusBadge({ source }: { source: CloudSourceView }) {
  const { t } = useTranslation();
  const badge = (
    <Badge
      data-status={source.status}
      variant={statusBadgeVariant(source.status)}
    >
      {source.status === "SCRAPING" ? (
        <Spinner data-icon="inline-start" />
      ) : null}
      {t(statusLabelKey(source.status))}
    </Badge>
  );
  if (!source.status_reason) {
    return badge;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={t("cloudSources.statusWithReason", {
            status: t(statusLabelKey(source.status)),
            reason: source.status_reason,
          })}
          className="inline-flex rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2"
          type="button"
        >
          {badge}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        {source.status_reason}
      </TooltipContent>
    </Tooltip>
  );
}

export function NextRunText({
  source,
  nowMs,
  pipelineEnabled,
}: {
  nowMs: number;
  pipelineEnabled: boolean;
  source: CloudSourceView;
}) {
  const { t, locale } = useTranslation();
  const next = nextRunOf(source, nowMs, pipelineEnabled);
  switch (next.kind) {
    case "scraping":
      return <span>{t("cloudSources.next.scraping")}</span>;
    case "due":
      return <span>{t("cloudSources.next.due")}</span>;
    case "at":
      return (
        <time
          dateTime={new Date(next.at).toISOString()}
          title={formatDateTime(next.at, locale)}
        >
          {relativeTime(next.at, nowMs, locale)}
        </time>
      );
    default:
      return (
        <span className="text-muted-foreground">
          {next.reason === "breaker" && next.until
            ? t("cloudSources.next.breaker", {
                time: relativeTime(next.until, nowMs, locale),
              })
            : t(`cloudSources.next.paused.${next.reason}`)}
        </span>
      );
  }
}

function LastSuccess({
  source,
  nowMs,
}: {
  nowMs: number;
  source: CloudSourceView;
}) {
  const { t, locale } = useTranslation();
  if (source.last_success_at === null) {
    return (
      <span className="text-muted-foreground">{t("cloudSources.never")}</span>
    );
  }
  return (
    <time
      dateTime={new Date(source.last_success_at).toISOString()}
      title={formatDateTime(source.last_success_at, locale)}
    >
      {relativeTime(source.last_success_at, nowMs, locale)}
    </time>
  );
}

function LastRunCaption({ source }: { source: CloudSourceView }) {
  const { t } = useTranslation();
  if (!source.last_run_status) {
    return null;
  }
  return (
    <span className="type-caption text-muted-foreground">
      {t("cloudSources.lastRunWas", {
        status: t(runStatusLabelKey(source.last_run_status)),
      })}
    </span>
  );
}

/** Last success, and under it when the next check happens. */
function ChecksCell({
  source,
  nowMs,
  pipelineEnabled,
}: {
  nowMs: number;
  pipelineEnabled: boolean;
  source: CloudSourceView;
}) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-col">
      <LastSuccess nowMs={nowMs} source={source} />
      <span className="type-caption text-muted-foreground">
        {t("cloudSources.nextPrefix")}{" "}
        <NextRunText
          nowMs={nowMs}
          pipelineEnabled={pipelineEnabled}
          source={source}
        />
      </span>
    </span>
  );
}

function JobsCell({ source }: { source: CloudSourceView }) {
  const { t, locale } = useTranslation();
  const added = source.stats.jobs_new_last_run;
  return (
    <span className="flex flex-col tabular-nums">
      <span>{formatNumber(source.jobs_total, locale)}</span>
      {added === undefined ? null : (
        <span className="type-caption text-muted-foreground">
          {t("cloudSources.newLastRun", { count: formatNumber(added, locale) })}
        </span>
      )}
    </span>
  );
}

function ReliabilityCell({ source }: { source: CloudSourceView }) {
  const { locale } = useTranslation();
  if (source.success_rate === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="flex flex-col tabular-nums">
      <span>{formatPercent(source.success_rate, locale)}</span>
      {source.avg_duration_ms === null ? null : (
        <span className="type-caption text-muted-foreground">
          {formatDuration(source.avg_duration_ms, locale)}
        </span>
      )}
    </span>
  );
}

function TypeChips({ source }: { source: CloudSourceView }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant="outline">{t(categoryLabelKey(source.category))}</Badge>
      <Badge variant="outline">{t(strategyLabelKey(source.strategy))}</Badge>
    </span>
  );
}

function NameCell({
  source,
  onOpen,
}: {
  onOpen: () => void;
  source: CloudSourceView;
}) {
  const { t } = useTranslation();
  const href = safeHref(source.homepage_url);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <button
        aria-label={t("cloudSources.openDetails", { name: source.name })}
        className="type-body weight-semibold self-start rounded-sm text-left text-foreground underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2"
        onClick={onOpen}
        type="button"
      >
        {source.name}
      </button>
      <span className="type-caption flex flex-col text-muted-foreground">
        {href ? (
          <a
            className="break-words underline-offset-4 hover:text-foreground hover:underline"
            href={href}
            rel="noopener noreferrer"
            target="_blank"
          >
            {displayUrl(href)}
          </a>
        ) : (
          <span className="break-words">{source.canonical_domain}</span>
        )}
        <span>{t(originLabelKey(source.origin))}</span>
      </span>
    </div>
  );
}

function FollowSwitch({
  source,
  onFollow,
}: {
  onFollow: (source: CloudSourceView, follow: boolean) => Promise<unknown>;
  source: CloudSourceView;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Switch
      aria-label={t("cloudSources.follow.switchFor", { name: source.name })}
      checked={source.following}
      data-follow={source.id}
      disabled={busy}
      onCheckedChange={async (value) => {
        setBusy(true);
        await onFollow(source, value);
        setBusy(false);
      }}
    />
  );
}

export interface CloudSourcesTableProps {
  nowMs: number;
  onFollow: (source: CloudSourceView, follow: boolean) => Promise<unknown>;
  onOpen: (source: CloudSourceView) => void;
  pipelineEnabled: boolean;
  sources: readonly CloudSourceView[];
}

export function CloudSourcesTable({
  sources,
  nowMs,
  pipelineEnabled,
  onOpen,
  onFollow,
}: CloudSourcesTableProps) {
  const { t } = useTranslation();
  const phone = useMediaQuery(PHONE_QUERY);

  if (phone) {
    return (
      <ul
        aria-label={t("cloudSources.listLabel")}
        className="flex flex-col border border-line"
      >
        {sources.map((source) => (
          <li
            className="flex flex-col gap-2 border-line border-b p-3 last:border-b-0"
            data-cloud-source={source.id}
            key={source.id}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <NameCell onOpen={() => onOpen(source)} source={source} />
              </div>
              <StatusBadge source={source} />
            </div>
            <TypeChips source={source} />
            <dl className="type-caption grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">
                {t("cloudSources.columns.lastSuccess")}
              </dt>
              <dd className="flex flex-col">
                <LastSuccess nowMs={nowMs} source={source} />
                <LastRunCaption source={source} />
              </dd>
              <dt className="text-muted-foreground">
                {t("cloudSources.columns.nextRun")}
              </dt>
              <dd>
                <NextRunText
                  nowMs={nowMs}
                  pipelineEnabled={pipelineEnabled}
                  source={source}
                />
              </dd>
              <dt className="text-muted-foreground">
                {t("cloudSources.columns.jobs")}
              </dt>
              <dd>
                <JobsCell source={source} />
              </dd>
              <dt className="text-muted-foreground">
                {t("cloudSources.columns.successRate")}
              </dt>
              <dd>
                <ReliabilityCell source={source} />
              </dd>
            </dl>
            <div className="flex items-center gap-3">
              <FollowSwitch onFollow={onFollow} source={source} />
              <span className="type-body-compact">
                {t("cloudSources.columns.follow")}
              </span>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="border border-line">
      <Table
        aria-label={t("cloudSources.listLabel")}
        className="type-body-compact"
      >
        <TableHeader>
          <TableRow>
            <TableHead>{t("cloudSources.columns.board")}</TableHead>
            <TableHead>{t("cloudSources.columns.type")}</TableHead>
            <TableHead>{t("cloudSources.columns.status")}</TableHead>
            <TableHead>{t("cloudSources.columns.checks")}</TableHead>
            <TableHead className="text-right">
              {t("cloudSources.columns.jobs")}
            </TableHead>
            <TableHead className="text-right">
              {t("cloudSources.columns.successRate")}
            </TableHead>
            <TableHead>{t("cloudSources.columns.follow")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((source) => (
            <TableRow data-cloud-source={source.id} key={source.id}>
              <TableCell className="min-w-56 whitespace-normal">
                <NameCell onOpen={() => onOpen(source)} source={source} />
              </TableCell>
              <TableCell className="whitespace-normal">
                <TypeChips source={source} />
              </TableCell>
              <TableCell>
                <span className="flex flex-col items-start gap-1">
                  <StatusBadge source={source} />
                  <LastRunCaption source={source} />
                </span>
              </TableCell>
              <TableCell className="whitespace-normal">
                <ChecksCell
                  nowMs={nowMs}
                  pipelineEnabled={pipelineEnabled}
                  source={source}
                />
              </TableCell>
              <TableCell className="text-right">
                <JobsCell source={source} />
              </TableCell>
              <TableCell className="text-right">
                <ReliabilityCell source={source} />
              </TableCell>
              <TableCell>
                <FollowSwitch onFollow={onFollow} source={source} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
