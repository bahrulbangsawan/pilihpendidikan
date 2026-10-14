// "Remote job boards" on /sources (24 §5, 05 §15): the cloud catalog our
// servers check every hour, which anyone can follow to get new postings in
// their inbox. A notice when the pipeline is off, filters (status group,
// following, search), the list, the detail sheet, and for operators
// "Refresh directory" and "Add board".

import type {
  CloudPipeline,
  CloudSourceView,
} from "@pilihpendidikan/jobs-contracts/api";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Button } from "@rulisme/ui/ui/button";
import { Input } from "@rulisme/ui/ui/input";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { cn } from "@rulisme/ui/lib/utils";
import { CircleAlert, CloudOff, Plus, RefreshCw, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useCloudActions, useCloudSources } from "@/hooks/use-cloud-sources";
import { useTranslation } from "@/i18n";
import type { CloudFilters, StatusGroup } from "@/lib/cloud-sources-model";
import {
  countByGroup,
  DEFAULT_CLOUD_FILTERS,
  filterCloudSources,
  sortCloudSources,
  STATUS_GROUPS,
} from "@/lib/cloud-sources-model";
import { formatDateTime, relativeTime } from "@/lib/format";
import { CloudAddDialog } from "./cloud-add-dialog";
import { CloudSourceSheet } from "./cloud-source-sheet";
import { CloudSourcesTable } from "./cloud-sources-table";

const FLAG_NAME = "JOBS_CLOUD_DISCOVERY_ENABLED";

function Toolbar({
  filters,
  counts,
  onChange,
}: {
  counts: Record<StatusGroup, number>;
  filters: CloudFilters;
  onChange: (next: Partial<CloudFilters>) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <fieldset className="flex flex-wrap items-center gap-0.5">
        <legend className="sr-only">{t("cloudSources.filters.status")}</legend>
        {STATUS_GROUPS.map((group) => {
          const current = group === filters.group;
          return (
            <Button
              aria-pressed={current}
              className={cn(
                current && "weight-semibold bg-pane-2 text-foreground"
              )}
              key={group}
              onClick={() => onChange({ group })}
              size="sm"
              variant="ghost"
            >
              {t(`cloudSources.filters.groups.${group}`)}
              <span className="type-micro text-muted-foreground tabular-nums">
                {counts[group]}
              </span>
            </Button>
          );
        })}
      </fieldset>
      <Button
        aria-pressed={filters.following}
        className={cn(
          filters.following && "weight-semibold bg-pane-2 text-foreground"
        )}
        onClick={() => onChange({ following: !filters.following })}
        size="sm"
        variant="ghost"
      >
        {t("cloudSources.filters.following")}
      </Button>
      <div className="relative w-full sm:ml-auto sm:w-56">
        <label className="sr-only" htmlFor={`${id}-q`}>
          {t("cloudSources.filters.search")}
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="field-touch h-8 pl-8"
          id={`${id}-q`}
          onChange={(event) => onChange({ q: event.target.value })}
          placeholder={t("cloudSources.filters.searchPlaceholder")}
          type="search"
          value={filters.q}
        />
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function SectionHeader({
  operator,
  onAdd,
}: {
  onAdd: () => void;
  operator: boolean;
}) {
  const { t } = useTranslation();
  const actions = useCloudActions();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="type-subtitle weight-semibold" id="cloud-sources-title">
          {t("cloudSources.title")}
        </h2>
        <p className="type-caption max-w-prose text-muted-foreground">
          {t("cloudSources.intro")}
        </p>
      </div>
      {operator ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await actions.refreshDirectory();
              setRefreshing(false);
            }}
            size="sm"
            variant="outline"
          >
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
            {t("cloudSources.directory.refresh")}
          </Button>
          <Button onClick={onAdd} size="sm" variant="outline">
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t("cloudSources.add.open")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PipelineStatus({
  pipeline,
  operator,
  stale,
  nowMs,
}: {
  nowMs: number;
  operator: boolean;
  pipeline: CloudPipeline;
  stale: boolean;
}) {
  const { t, locale } = useTranslation();
  const refreshedAt = pipeline.last_directory_refresh_at;
  return (
    <>
      {pipeline.enabled ? null : (
        <Alert>
          <CloudOff aria-hidden="true" />
          <AlertTitle>{t("cloudSources.pipeline.offTitle")}</AlertTitle>
          <AlertDescription>
            {operator
              ? t("cloudSources.pipeline.offOperator", { flag: FLAG_NAME })
              : t("cloudSources.pipeline.off")}
          </AlertDescription>
        </Alert>
      )}
      <p className="type-caption text-muted-foreground">
        {t("cloudSources.pipeline.schedule")}
        {refreshedAt === null ? null : (
          <>
            {" · "}
            <time
              dateTime={new Date(refreshedAt).toISOString()}
              title={formatDateTime(refreshedAt, locale)}
            >
              {t("cloudSources.pipeline.directoryRefreshed", {
                time: relativeTime(refreshedAt, nowMs, locale),
              })}
            </time>
          </>
        )}
        {stale ? ` · ${t("cloudSources.stale")}` : null}
      </p>
    </>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert role="alert" variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{t("cloudSources.errorTitle")}</AlertTitle>
      <AlertDescription>{t("cloudSources.error")}</AlertDescription>
      <AlertAction>
        <Button onClick={onRetry} size="sm" variant="outline">
          {t("common.retry")}
        </Button>
      </AlertAction>
    </Alert>
  );
}

export function CloudSourcesSection({ nowMs }: { nowMs: number }) {
  const { t } = useTranslation();
  const list = useCloudSources();
  const actions = useCloudActions();
  const [filters, setFilters] = useState<CloudFilters>(DEFAULT_CLOUD_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const items = list.data?.items ?? [];
  const operator = list.data?.viewer.operator ?? false;
  const pipeline = list.data?.pipeline;
  const pipelineEnabled = pipeline?.enabled ?? true;
  const shown = useMemo(
    () => sortCloudSources(filterCloudSources(items, filters)),
    [items, filters]
  );
  const counts = useMemo(() => countByGroup(items), [items]);
  const open: CloudSourceView | null =
    items.find((source) => source.id === openId) ?? null;
  const emptyText =
    items.length === 0 ? t("cloudSources.empty") : t("cloudSources.noMatch");

  return (
    <section
      aria-labelledby="cloud-sources-title"
      className="flex flex-col gap-3"
    >
      <SectionHeader onAdd={() => setAdding(true)} operator={operator} />
      {pipeline ? (
        <PipelineStatus
          nowMs={nowMs}
          operator={operator}
          pipeline={pipeline}
          stale={list.stale}
        />
      ) : null}
      {list.isPending ? <ListSkeleton /> : null}
      {list.isError && !list.data ? (
        <LoadError onRetry={() => list.refetch()} />
      ) : null}
      {list.data ? (
        <>
          <Toolbar
            counts={counts}
            filters={filters}
            onChange={(next) =>
              setFilters((current) => ({ ...current, ...next }))
            }
          />
          {shown.length > 0 ? (
            <CloudSourcesTable
              nowMs={nowMs}
              onFollow={actions.setFollowing}
              onOpen={(source) => setOpenId(source.id)}
              pipelineEnabled={pipelineEnabled}
              sources={shown}
            />
          ) : (
            <p className="type-body-compact border border-line border-dashed p-4 text-muted-foreground">
              {emptyText}
            </p>
          )}
        </>
      ) : null}
      <CloudSourceSheet
        fallback={open}
        nowMs={nowMs}
        onClose={() => setOpenId(null)}
        operator={operator}
        pipelineEnabled={pipelineEnabled}
      />
      {operator ? (
        <CloudAddDialog onClose={() => setAdding(false)} open={adding} />
      ) : null}
    </section>
  );
}
