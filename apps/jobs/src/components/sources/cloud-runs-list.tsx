// A cloud source's runs (24 §6.6): status, trigger, start, duration and
// counts per run, with the structured log and data-quality warnings behind a
// toggle. Log text comes from scraped sites, so every line renders as plain
// text (PlainText; links only through safeHref).

import type { CloudRunView } from "@pilihpendidikan/jobs-contracts/api";
import type { CloudLogEntry } from "@pilihpendidikan/jobs-contracts/cloud-config";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { cn } from "@rulisme/ui/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { PlainText } from "@/components/rich-text";
import { useTranslation } from "@/i18n";
import {
  errorClassLabelKey,
  runStatusLabelKey,
} from "@/lib/cloud-sources-model";
import {
  formatClock,
  formatDateTime,
  formatDuration,
  formatNumber,
  relativeTime,
} from "@/lib/format";

const FAILED_RUN = new Set([
  "failed",
  "blocked",
  "auth_required",
  "unsupported",
]);

function runVariant(status: CloudRunView["status"]) {
  if (FAILED_RUN.has(status)) {
    return "destructive" as const;
  }
  return status === "succeeded" ? ("secondary" as const) : ("outline" as const);
}

const LEVEL_CLASS: Readonly<Record<CloudLogEntry["level"], string>> = {
  info: "text-muted-foreground",
  warn: "text-foreground",
  error: "text-destructive",
};

function LogLine({ entry }: { entry: CloudLogEntry }) {
  const { t, locale } = useTranslation();
  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-3 border-line border-b px-2 py-1.5 last:border-b-0">
      <time
        className="type-micro text-muted-foreground tabular-nums"
        dateTime={new Date(entry.at).toISOString()}
        title={formatDateTime(entry.at, locale)}
      >
        {formatClock(entry.at, locale)}
      </time>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="type-micro flex flex-wrap items-center gap-x-2">
          <span className={cn("weight-semibold", LEVEL_CLASS[entry.level])}>
            {t(`cloudSources.runs.levels.${entry.level}`)}
          </span>
          <span className="break-all text-muted-foreground">{entry.event}</span>
          {entry.http_status === undefined ? null : (
            <span className="text-muted-foreground tabular-nums">
              {t("cloudSources.runs.http", { status: entry.http_status })}
            </span>
          )}
          {entry.ms === undefined ? null : (
            <span className="text-muted-foreground tabular-nums">
              {formatDuration(entry.ms, locale)}
            </span>
          )}
        </span>
        <PlainText
          className="type-caption break-words text-foreground"
          text={entry.message}
        />
        {entry.url ? (
          <PlainText
            className="type-micro break-all text-muted-foreground"
            text={entry.url}
          />
        ) : null}
      </div>
    </li>
  );
}

function RunCounts({ run }: { run: CloudRunView }) {
  const { t, locale } = useTranslation();
  const { stats } = run;
  if (run.kind === "directory") {
    return (
      <span>
        {t("cloudSources.runs.directoryCounts", {
          entries: formatNumber(stats.entries ?? 0, locale),
          registered: formatNumber(stats.registered ?? 0, locale),
        })}
      </span>
    );
  }
  return (
    <span>
      {t("cloudSources.runs.counts", {
        found: formatNumber(stats.postings_found ?? 0, locale),
        added: formatNumber(stats.new ?? 0, locale),
        updated: formatNumber(stats.updated ?? 0, locale),
      })}
    </span>
  );
}

/** Keys for repeated lines: content-based, a counter only for exact repeats. */
function keyed<T>(items: readonly T[], keyOf: (item: T) => string) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = keyOf(item);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { item, key: count === 0 ? base : `${base}#${count}` };
  });
}

function RunDetails({ run, id }: { id: string; run: CloudRunView }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2" id={id}>
      {run.warnings.length > 0 ? (
        <ul
          aria-label={t("cloudSources.runs.warnings")}
          className="flex flex-col gap-1"
        >
          {keyed(
            run.warnings,
            (w) => `${w.code}:${w.field ?? ""}:${w.message}`
          ).map(({ item: warning, key }) => (
            <li
              className="type-caption flex flex-wrap items-baseline gap-x-2"
              key={key}
            >
              <Badge variant="outline">{warning.code}</Badge>
              <PlainText className="inline" text={warning.message} />
              {warning.count === undefined ? null : (
                <span className="text-muted-foreground tabular-nums">
                  ×{warning.count}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {run.log.length > 0 ? (
        <ol
          aria-label={t("cloudSources.runs.log")}
          className="border border-line bg-pane/40"
        >
          {keyed(run.log, (e) => `${e.at}:${e.event}:${e.message}`).map(
            ({ item: entry, key }) => (
              <LogLine entry={entry} key={key} />
            )
          )}
        </ol>
      ) : null}
      {run.engine_version ? (
        <p className="type-micro break-all text-muted-foreground">
          {run.engine_version}
        </p>
      ) : null}
    </div>
  );
}

function RunMeta({ run }: { run: CloudRunView }) {
  const { t } = useTranslation();
  const parts = [t(`cloudSources.runs.triggers.${run.trigger}`)];
  if (run.kind !== "scrape") {
    parts.push(t(`cloudSources.runs.kinds.${run.kind}`));
  }
  if (run.attempt > 1) {
    parts.push(t("cloudSources.runs.attempt", { n: run.attempt }));
  }
  return (
    <span className="type-caption text-muted-foreground">
      {parts.join(" · ")}
    </span>
  );
}

function RunStats({ run }: { run: CloudRunView }) {
  const { t, locale } = useTranslation();
  return (
    <div className="type-caption flex flex-wrap gap-x-3 gap-y-0.5 text-foreground">
      <RunCounts run={run} />
      {run.duration_ms === null ? null : (
        <span className="text-muted-foreground">
          {formatDuration(run.duration_ms, locale)}
        </span>
      )}
      {run.stats.confidence_avg === undefined ? null : (
        <span className="text-muted-foreground">
          {t("cloudSources.runs.confidence", {
            value: Math.round(run.stats.confidence_avg * 100),
          })}
        </span>
      )}
    </div>
  );
}

function RunError({ run }: { run: CloudRunView }) {
  const { t } = useTranslation();
  if (!run.error_class) {
    return null;
  }
  const parts = [t(errorClassLabelKey(run.error_class))];
  if (run.http_status) {
    parts.push(t("cloudSources.runs.http", { status: run.http_status }));
  }
  return (
    <p className="type-caption text-destructive">
      {parts.join(" · ")}
      {run.error_message ? ` — ${run.error_message}` : null}
    </p>
  );
}

export function CloudRunItem({
  run,
  nowMs,
}: {
  nowMs: number;
  run: CloudRunView;
}) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const startedAt = run.started_at ?? run.queued_at;
  const details = run.log.length + run.warnings.length;
  return (
    <li className="flex flex-col gap-1.5 border-line border-b p-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={runVariant(run.status)}>
          {t(runStatusLabelKey(run.status))}
        </Badge>
        <RunMeta run={run} />
        <time
          className="type-caption ml-auto text-muted-foreground"
          dateTime={new Date(startedAt).toISOString()}
          title={formatDateTime(startedAt, locale)}
        >
          {relativeTime(startedAt, nowMs, locale)}
        </time>
      </div>
      <RunStats run={run} />
      <RunError run={run} />
      {details > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Button
            aria-controls={panelId}
            aria-expanded={open}
            className="self-start"
            onClick={() => setOpen((value) => !value)}
            size="xs"
            variant="ghost"
          >
            {open ? (
              <ChevronDown aria-hidden="true" data-icon="inline-start" />
            ) : (
              <ChevronRight aria-hidden="true" data-icon="inline-start" />
            )}
            {open
              ? t("cloudSources.runs.hideLog")
              : t("cloudSources.runs.showLog", { count: details })}
          </Button>
          {open ? <RunDetails id={panelId} run={run} /> : null}
        </div>
      ) : null}
    </li>
  );
}

export function CloudRunsList({
  runs,
  nowMs,
  loading,
  canLoadMore,
  loadingMore,
  onLoadMore,
}: {
  canLoadMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  nowMs: number;
  onLoadMore: () => void;
  runs: readonly CloudRunView[];
}) {
  const { t } = useTranslation();
  if (loading && runs.length === 0) {
    return (
      <p className="type-caption text-muted-foreground">
        {t("cloudSources.runs.loading")}
      </p>
    );
  }
  if (runs.length === 0) {
    return (
      <p className="type-caption text-muted-foreground">
        {t("cloudSources.runs.none")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ul
        aria-label={t("cloudSources.runs.title")}
        className="flex flex-col border border-line"
      >
        {runs.map((run) => (
          <CloudRunItem key={run.id} nowMs={nowMs} run={run} />
        ))}
      </ul>
      {canLoadMore ? (
        <Button
          className="self-start"
          disabled={loadingMore}
          onClick={onLoadMore}
          size="sm"
          variant="outline"
        >
          {t("cloudSources.runs.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}
