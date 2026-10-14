// One cloud source in a sheet (05 §15, 24 §5): status and link, what went
// wrong and what to do about it, the login requirement, terms and
// attribution, run statistics, the follow switch, the recent runs with their
// logs, and the operator controls. Everything the site supplied (reasons,
// notes, messages) renders as plain text.

import type { CloudSourceView } from "@pilihpendidikan/jobs-contracts/api";
import { Alert, AlertDescription, AlertTitle } from "@rulisme/ui/ui/alert";
import { Badge } from "@rulisme/ui/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@rulisme/ui/ui/sheet";
import { Switch } from "@rulisme/ui/ui/switch";
import { CircleAlert, ExternalLink, KeyRound } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { PlainText } from "@/components/rich-text";
import {
  mergeRuns,
  useCloudActions,
  useCloudRunPages,
  useCloudSource,
} from "@/hooks/use-cloud-sources";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import type { Diagnostic } from "@/lib/cloud-sources-model";
import {
  categoryLabelKey,
  diagnosticOf,
  errorClassLabelKey,
  originLabelKey,
  statusBadgeVariant,
  statusLabelKey,
  strategyLabelKey,
} from "@/lib/cloud-sources-model";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { displayUrl, safeHref } from "@/lib/safe-url";
import { CloudRunsList } from "./cloud-runs-list";
import { CloudSourceEditor } from "./cloud-source-editor";
import { NextRunText } from "./cloud-sources-table";

function ExternalAnchor({
  href,
  children,
}: {
  children: ReactNode;
  href: string | null;
}) {
  const safe = safeHref(href);
  if (!safe) {
    return <span>{children}</span>;
  }
  return (
    <a
      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
      href={safe}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

function diagnosticText(
  t: Translate,
  diagnostic: Diagnostic,
  source: CloudSourceView,
  locale: "en" | "id"
): string {
  if (diagnostic.kind === "rate_limited" && source.next_run_at !== null) {
    return t("cloudSources.diagnostics.rate_limitedUntil", {
      at: formatDateTime(source.next_run_at, locale),
    });
  }
  return t(diagnostic.key);
}

function Stat({ label, children }: { children: ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-line border-b px-3 py-2 sm:border-r">
      <dt className="type-caption text-muted-foreground">{label}</dt>
      <dd className="type-body text-foreground tabular-nums">{children}</dd>
    </div>
  );
}

function StatsGrid({ source }: { source: CloudSourceView }) {
  const { t, locale } = useTranslation();
  const dash = "—";
  const { stats } = source;
  return (
    <dl
      aria-label={t("cloudSources.sheet.stats")}
      className="grid grid-cols-2 border-line border-t border-l sm:grid-cols-3 [&>div]:border-r"
    >
      <Stat label={t("cloudSources.sheet.runs")}>
        {formatNumber(stats.runs ?? 0, locale)}
      </Stat>
      <Stat label={t("cloudSources.columns.successRate")}>
        {source.success_rate === null
          ? dash
          : formatPercent(source.success_rate, locale)}
      </Stat>
      <Stat label={t("cloudSources.sheet.avgDuration")}>
        {source.avg_duration_ms === null
          ? dash
          : formatDuration(source.avg_duration_ms, locale)}
      </Stat>
      <Stat label={t("cloudSources.sheet.jobs")}>
        {t("cloudSources.sheet.jobsValue", {
          total: formatNumber(source.jobs_total, locale),
          open: formatNumber(source.jobs_open, locale),
        })}
      </Stat>
      <Stat label={t("cloudSources.sheet.newLastRun")}>
        {stats.jobs_new_last_run === undefined
          ? dash
          : formatNumber(stats.jobs_new_last_run, locale)}
      </Stat>
      <Stat label={t("cloudSources.sheet.followers")}>
        {formatNumber(source.followers, locale)}
      </Stat>
      <Stat label={t("cloudSources.sheet.confidence")}>
        {stats.confidence_avg_last_run === undefined
          ? dash
          : formatPercent(stats.confidence_avg_last_run, locale)}
      </Stat>
      <Stat label={t("cloudSources.sheet.warnings")}>
        {stats.warnings_last_run === undefined
          ? dash
          : formatNumber(stats.warnings_last_run, locale)}
      </Stat>
      <Stat label={t("cloudSources.sheet.aiCalls")}>
        {formatNumber(stats.ai_calls ?? 0, locale)}
      </Stat>
    </dl>
  );
}

function Facts({
  source,
  nowMs,
  pipelineEnabled,
}: {
  nowMs: number;
  pipelineEnabled: boolean;
  source: CloudSourceView;
}) {
  const { t, locale } = useTranslation();
  const attribution =
    typeof source.strategy_config.attribution === "string"
      ? source.strategy_config.attribution
      : null;
  return (
    <dl className="type-body-compact grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
      <dt className="text-muted-foreground">
        {t("cloudSources.columns.type")}
      </dt>
      <dd className="flex flex-wrap gap-1">
        <Badge variant="outline">{t(categoryLabelKey(source.category))}</Badge>
        <Badge variant="outline">{t(strategyLabelKey(source.strategy))}</Badge>
        <Badge variant="ghost">{t(originLabelKey(source.origin))}</Badge>
      </dd>
      {source.listing_url ? (
        <>
          <dt className="text-muted-foreground">
            {t("cloudSources.sheet.listing")}
          </dt>
          <dd className="min-w-0 break-all">
            <ExternalAnchor href={source.listing_url}>
              {displayUrl(safeHref(source.listing_url) ?? source.listing_url)}
            </ExternalAnchor>
          </dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">
        {t("cloudSources.columns.lastSuccess")}
      </dt>
      <dd>
        {source.last_success_at === null
          ? t("cloudSources.never")
          : formatDateTime(source.last_success_at, locale)}
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
      {source.terms_url || source.terms_note ? (
        <>
          <dt className="text-muted-foreground">
            {t("cloudSources.sheet.terms")}
          </dt>
          <dd className="flex min-w-0 flex-col gap-0.5">
            {source.terms_url ? (
              <ExternalAnchor href={source.terms_url}>
                {t("cloudSources.sheet.termsLink")}
              </ExternalAnchor>
            ) : null}
            {source.terms_note ? (
              <PlainText
                className="type-caption text-muted-foreground"
                text={source.terms_note}
              />
            ) : null}
          </dd>
        </>
      ) : null}
      {attribution ? (
        <>
          <dt className="text-muted-foreground">
            {t("cloudSources.sheet.attribution")}
          </dt>
          <dd>
            <PlainText text={attribution} />
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function DiagnosticBlock({ source }: { source: CloudSourceView }) {
  const { t, locale } = useTranslation();
  const diagnostic = diagnosticOf(source);
  if (!diagnostic) {
    return null;
  }
  const severe = source.status === "FAILED" || source.status === "BLOCKED";
  return (
    <Alert variant={severe ? "destructive" : "default"}>
      <CircleAlert aria-hidden="true" />
      <AlertTitle>
        {diagnostic.errorClass
          ? t(errorClassLabelKey(diagnostic.errorClass))
          : t(statusLabelKey(source.status))}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        <p>{diagnosticText(t, diagnostic, source, locale)}</p>
        {diagnostic.message ? (
          <PlainText
            className="type-caption text-muted-foreground"
            text={diagnostic.message}
          />
        ) : null}
        {source.status_reason ? (
          <PlainText className="type-caption" text={source.status_reason} />
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function FollowRow({ source }: { source: CloudSourceView }) {
  const { t } = useTranslation();
  const { setFollowing } = useCloudActions();
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <div className="flex items-start gap-3 border border-line p-3">
      <Switch
        aria-describedby={`${id}-help`}
        checked={source.following}
        disabled={busy}
        id={id}
        onCheckedChange={async (value) => {
          setBusy(true);
          await setFollowing(source, value);
          setBusy(false);
        }}
      />
      <div className="flex flex-col gap-0.5">
        <label className="type-body text-foreground" htmlFor={id}>
          {t("cloudSources.follow.label")}
        </label>
        <p className="type-caption text-muted-foreground" id={`${id}-help`}>
          {t("cloudSources.follow.help")}
        </p>
      </div>
    </div>
  );
}

export interface CloudSourceSheetProps {
  /** The list's copy, shown until the detail answers. */
  fallback: CloudSourceView | null;
  nowMs: number;
  onClose: () => void;
  operator: boolean;
  pipelineEnabled: boolean;
}

export function CloudSourceSheet({
  fallback,
  nowMs,
  onClose,
  operator,
  pipelineEnabled,
}: CloudSourceSheetProps) {
  const { t } = useTranslation();
  const id = fallback?.id ?? null;
  const detail = useCloudSource(id);
  const [moreRequested, setMoreRequested] = useState(false);
  const pages = useCloudRunPages(id, moreRequested);
  const source =
    detail.data && detail.data.source.id === id ? detail.data.source : fallback;
  const runs = mergeRuns(
    detail.data?.source.id === id ? detail.data.runs : [],
    pages.data?.pages ?? []
  );
  const canLoadMore = moreRequested
    ? Boolean(pages.hasNextPage)
    : runs.length >= 10;

  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) {
          setMoreRequested(false);
          onClose();
        }
      }}
      open={fallback !== null}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" side="right">
        {source ? (
          <>
            <SheetHeader>
              <SheetTitle>{source.name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <Badge variant={statusBadgeVariant(source.status)}>
                  {t(statusLabelKey(source.status))}
                </Badge>
                <ExternalAnchor href={source.homepage_url}>
                  {source.canonical_domain}
                </ExternalAnchor>
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              {source.description ? (
                <PlainText
                  className="type-body text-ink"
                  text={source.description}
                />
              ) : null}
              <DiagnosticBlock source={source} />
              {source.auth_required ? (
                <Alert>
                  <KeyRound aria-hidden="true" />
                  <AlertTitle>{t("cloudSources.sheet.authTitle")}</AlertTitle>
                  <AlertDescription className="flex flex-col gap-1">
                    <p>{t("cloudSources.sheet.authBody")}</p>
                    {source.auth_note ? (
                      <PlainText text={source.auth_note} />
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}
              <FollowRow source={source} />
              <Facts
                nowMs={nowMs}
                pipelineEnabled={pipelineEnabled}
                source={source}
              />
              <StatsGrid source={source} />
              <section
                aria-labelledby={`${source.id}-runs`}
                className="flex flex-col gap-2"
              >
                <h3
                  className="type-body weight-semibold text-foreground"
                  id={`${source.id}-runs`}
                >
                  {t("cloudSources.runs.title")}
                </h3>
                {detail.isError ? (
                  <p className="type-caption text-destructive" role="alert">
                    {t("cloudSources.runs.error")}
                  </p>
                ) : null}
                <CloudRunsList
                  canLoadMore={canLoadMore}
                  loading={detail.isPending}
                  loadingMore={pages.isFetching}
                  nowMs={nowMs}
                  onLoadMore={() => {
                    if (moreRequested) {
                      pages.fetchNextPage();
                    } else {
                      setMoreRequested(true);
                    }
                  }}
                  runs={runs}
                />
              </section>
              {operator ? <CloudSourceEditor source={source} /> : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
