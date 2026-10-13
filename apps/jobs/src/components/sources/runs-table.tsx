// Discovery runs (12 §8, 15 §8): run, device, sources, status, the stats
// (found / new / updated / duplicates / invalid), errors by class ("Access
// denied by <host>") and duration. Stacked rows on phones.

import type { DeviceView } from "@pilihpendidikan/jobs-contracts/api";
import type { DiscoveryRunRecord } from "@pilihpendidikan/jobs-contracts/records";
import { Badge } from "@rulisme/ui/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/format";
import { discoveryErrorLabel, runStatusLabel } from "@/lib/labels";
import type { RunErrorGroup } from "@/lib/sources-model";
import {
  formatDuration,
  runDuration,
  runErrorGroups,
} from "@/lib/sources-model";

/** "Access denied by nvidia.wd5.myworkdayjobs.com · 1" or "Rate limited · 2". */
export function errorGroupText(t: Translate, group: RunErrorGroup): string {
  if (group.errorClass === "access_denied" && group.hosts.length > 0) {
    return t("sources.runs.accessDenied", {
      host: group.hosts.join(", "),
      count: group.count,
    });
  }
  return t("sources.runs.errorCount", {
    error: discoveryErrorLabel(t, group.errorClass),
    count: group.count,
  });
}

function StatusBadge({ run }: { run: DiscoveryRunRecord }) {
  const { t } = useTranslation();
  let variant: "outline" | "secondary" | "destructive" = "outline";
  if (run.status === "failed") {
    variant = "destructive";
  } else if (run.status === "running") {
    variant = "secondary";
  }
  return (
    <Badge data-status={run.status} variant={variant}>
      {runStatusLabel(t, run.status)}
    </Badge>
  );
}

function Errors({ run }: { run: DiscoveryRunRecord }) {
  const { t } = useTranslation();
  const groups = runErrorGroups(run);
  if (groups.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {groups.map((group) => (
        <li
          className={
            group.errorClass === "access_denied" ||
            group.errorClass === "challenge_detected"
              ? "text-destructive"
              : "text-foreground"
          }
          data-error-class={group.errorClass}
          key={group.errorClass}
        >
          {errorGroupText(t, group)}
        </li>
      ))}
    </ul>
  );
}

function Stat({ value }: { value: number | undefined }) {
  const { locale } = useTranslation();
  return (
    <span className="tabular-nums">
      {value === undefined ? "—" : formatNumber(value, locale)}
    </span>
  );
}

function Duration({ run, nowMs }: { nowMs: number; run: DiscoveryRunRecord }) {
  const { t } = useTranslation();
  const duration = runDuration(run);
  if (duration === null) {
    return (
      <span>
        {t("sources.runs.runningFor", {
          duration: formatDuration(Math.max(0, nowMs - run.started_at)),
        })}
      </span>
    );
  }
  return <span className="tabular-nums">{formatDuration(duration)}</span>;
}

function shortId(id: string): string {
  return `${id.slice(0, 4)}…${id.slice(-6)}`;
}

export interface RunsTableProps {
  byId: ReadonlyMap<string, DeviceView>;
  nowMs: number;
  runs: readonly DiscoveryRunRecord[];
}

export function RunsTable({ runs, byId, nowMs }: RunsTableProps) {
  const { t, locale } = useTranslation();
  const phone = useMediaQuery(PHONE_QUERY);
  const deviceName = (id: string) =>
    byId.get(id)?.name ?? t("sources.runs.removedDevice");
  const sources = (run: DiscoveryRunRecord) =>
    run.sources.map((source) => source.label).join(", ");

  if (runs.length === 0) {
    return (
      <p className="type-caption text-muted-foreground">
        {t("sources.runs.empty")}
      </p>
    );
  }

  if (phone) {
    return (
      <ul
        aria-label={t("sources.runs.title")}
        className="flex flex-col border border-line"
      >
        {runs.map((run) => (
          <li
            className="type-caption flex flex-col gap-1.5 border-line border-b p-3 last:border-b-0"
            data-run={run.id}
            key={run.id}
          >
            <div className="flex items-center gap-2">
              <span className="type-body-compact weight-semibold min-w-0 flex-1 truncate text-foreground">
                {sources(run)}
              </span>
              <StatusBadge run={run} />
            </div>
            <span className="text-muted-foreground">
              {deviceName(run.device_id)} ·{" "}
              {relativeTime(run.started_at, nowMs, locale)} ·{" "}
              <Duration nowMs={nowMs} run={run} />
            </span>
            <span className="tabular-nums">
              {t("sources.runs.statsLine", {
                found: run.stats.postings_found ?? 0,
                new: run.stats.new ?? 0,
                updated: run.stats.updated ?? 0,
                duplicates: run.stats.duplicates ?? 0,
                invalid: run.stats.invalid ?? 0,
              })}
            </span>
            <Errors run={run} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="border border-line">
      <Table aria-label={t("sources.runs.title")} className="type-body-compact">
        <TableHeader>
          <TableRow>
            <TableHead>{t("sources.runs.run")}</TableHead>
            <TableHead>{t("sources.runs.device")}</TableHead>
            <TableHead>{t("sources.runs.sources")}</TableHead>
            <TableHead>{t("sources.runs.status")}</TableHead>
            <TableHead className="text-right">
              {t("sources.runs.found")}
            </TableHead>
            <TableHead className="text-right">
              {t("sources.runs.new")}
            </TableHead>
            <TableHead className="text-right">
              {t("sources.runs.updated")}
            </TableHead>
            <TableHead className="text-right">
              {t("sources.runs.duplicates")}
            </TableHead>
            <TableHead className="text-right">
              {t("sources.runs.invalid")}
            </TableHead>
            <TableHead>{t("sources.runs.errors")}</TableHead>
            <TableHead>{t("sources.runs.duration")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow data-run={run.id} key={run.id}>
              <TableCell>
                <span className="flex flex-col">
                  <span className="text-foreground" title={run.id}>
                    {shortId(run.id)}
                  </span>
                  <time
                    className="type-caption text-muted-foreground"
                    dateTime={new Date(run.started_at).toISOString()}
                    title={formatDateTime(run.started_at, locale)}
                  >
                    {relativeTime(run.started_at, nowMs, locale)}
                  </time>
                </span>
              </TableCell>
              <TableCell>{deviceName(run.device_id)}</TableCell>
              <TableCell className="max-w-48">{sources(run)}</TableCell>
              <TableCell>
                <StatusBadge run={run} />
              </TableCell>
              <TableCell className="text-right">
                <Stat value={run.stats.postings_found} />
              </TableCell>
              <TableCell className="text-right">
                <Stat value={run.stats.new} />
              </TableCell>
              <TableCell className="text-right">
                <Stat value={run.stats.updated} />
              </TableCell>
              <TableCell className="text-right">
                <Stat value={run.stats.duplicates} />
              </TableCell>
              <TableCell className="text-right">
                <Stat value={run.stats.invalid} />
              </TableCell>
              <TableCell>
                <Errors run={run} />
              </TableCell>
              <TableCell>
                <Duration nowMs={nowMs} run={run} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
