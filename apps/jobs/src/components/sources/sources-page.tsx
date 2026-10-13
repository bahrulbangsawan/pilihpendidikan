// Sources (`/sources`, 12 §8): the job sources the CLI discovers from, an
// add / edit sheet whose config form is generated from each adapter's JSON
// Schema, "Run now" on a device, and the discovery runs with their errors
// by class. Excluded platforms are shown, disabled, with the reason (D-17).

import type { JobSourceRecord } from "@pilihpendidikan/jobs-contracts/records";
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
  EmptyTitle,
} from "@rulisme/ui/ui/empty";
import { Band, Rail } from "@rulisme/ui/ui/rails";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { CircleAlert, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { CopyCommand } from "@/components/copy-command";
import { useDevices } from "@/hooks/use-devices";
import { useAdapters, useDiscoveryRuns, useSources } from "@/hooks/use-sources";
import { useTranslation } from "@/i18n";
import { cliStep } from "@/lib/devices-install";
import { splitRegistry } from "@/lib/sources-model";
import { RunsTable } from "./runs-table";
import type { SheetTarget } from "./source-sheet";
import { SourceSheet } from "./source-sheet";
import { SourcesTable } from "./sources-table";

const TICK_MS = 30_000;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function NoSources({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  const discover = cliStep("next")?.commands.linux;
  return (
    <Empty className="graph-paper border border-dashed py-8">
      <EmptyHeader>
        <EmptyTitle>{t("sources.emptyTitle")}</EmptyTitle>
        <EmptyDescription>{t("sources.empty")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="items-center gap-3">
        <Button onClick={onAdd} size="sm" variant="outline">
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t("sources.add")}
        </Button>
        {discover ? (
          <div className="flex flex-col items-center gap-1.5">
            <p className="type-caption text-muted-foreground">
              {t("sources.emptyThen")}
            </p>
            <CopyCommand command={discover} />
          </div>
        ) : null}
      </EmptyContent>
    </Empty>
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

export function SourcesPage() {
  const { t } = useTranslation();
  const nowMs = useNow(TICK_MS);
  const sources = useSources();
  const adapters = useAdapters();
  const runs = useDiscoveryRuns();
  const { devices, byId } = useDevices();
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const registry = splitRegistry(adapters.data);
  const list = sources.data ?? [];

  const openAdd = () => setSheet({ mode: "create" });
  const openEdit = (source: JobSourceRecord) =>
    setSheet({ mode: "edit", source });

  return (
    <div className="flex flex-col">
      <Band>
        <Rail
          className="flex flex-wrap items-end gap-3 px-4 py-6 sm:px-8"
          nodes={false}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="type-title">{t("sources.title")}</h1>
            <p className="type-caption max-w-2xl text-muted-foreground">
              {t("sources.intro")}
            </p>
          </div>
          {list.length > 0 ? (
            <Button onClick={openAdd} size="sm" variant="outline">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t("sources.add")}
            </Button>
          ) : null}
        </Rail>
      </Band>
      <Band>
        <Rail className="flex flex-col gap-3 px-4 py-6 sm:px-8" nodes={false}>
          <h2 className="type-subtitle weight-semibold">
            {t("sources.listTitle")}
          </h2>
          {sources.isPending ? <ListSkeleton /> : null}
          {sources.isError ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>{t("sources.errorTitle")}</AlertTitle>
              <AlertDescription>{t("sources.error")}</AlertDescription>
              <AlertAction>
                <Button
                  onClick={() => sources.refetch()}
                  size="sm"
                  variant="outline"
                >
                  {t("common.retry")}
                </Button>
              </AlertAction>
            </Alert>
          ) : null}
          {sources.isSuccess && list.length === 0 ? (
            <NoSources onAdd={openAdd} />
          ) : null}
          {list.length > 0 ? (
            <SourcesTable
              devices={devices}
              manifests={registry.manifests}
              nowMs={nowMs}
              onEdit={openEdit}
              runs={runs.data ?? []}
              sources={list}
            />
          ) : null}
        </Rail>
      </Band>
      <Band id="runs">
        <Rail className="flex flex-col gap-3 px-4 py-6 sm:px-8" nodes={false}>
          <h2 className="type-subtitle weight-semibold">
            {t("sources.runs.title")}
          </h2>
          {runs.isPending ? <ListSkeleton /> : null}
          {runs.isError ? (
            <p className="type-caption text-destructive" role="alert">
              {t("sources.runs.error")}
            </p>
          ) : null}
          {runs.isSuccess ? (
            <RunsTable byId={byId} nowMs={nowMs} runs={runs.data} />
          ) : null}
        </Rail>
      </Band>
      <SourceSheet
        excluded={registry.excluded}
        loading={adapters.isPending}
        manifests={registry.manifests}
        onClose={() => setSheet(null)}
        target={sheet}
      />
    </div>
  );
}
