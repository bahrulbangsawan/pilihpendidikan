// The sources list (12 §8): label, adapter with its capability icons,
// config summary, last run, last success, the enabled switch, "Run now" on
// a chosen device and a row menu (Edit, Test, Delete). Stacked rows on
// phones.

import type { DeviceView } from "@pilihpendidikan/jobs-contracts/api";
import type { AdapterManifest } from "@pilihpendidikan/jobs-contracts/adapters";
import type {
  DiscoveryRunRecord,
  JobSourceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@rulisme/ui/ui/alert-dialog";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@rulisme/ui/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
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
import type { LucideIcon } from "lucide-react";
import {
  ChevronDown,
  FileText,
  Layers,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import { useState } from "react";
import { CopyCommand } from "@/components/copy-command";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { formatDateTime, relativeTime } from "@/lib/format";
import { runStatusLabel } from "@/lib/labels";
import {
  ANY_DEVICE,
  configSummary,
  disabledReason,
  requiresOptIn,
  testCommand,
  translateOr,
} from "@/lib/sources-model";
import { useSourceActions } from "./source-actions";

interface Capability {
  icon: LucideIcon;
  key: string;
  text: string;
}

/** The manifest's capabilities as icon + sentence pairs (12 §8). */
export function capabilityList(
  t: Translate,
  manifest: AdapterManifest
): Capability[] {
  const { capabilities } = manifest;
  const list: Capability[] = [];
  if (capabilities.discovery) {
    list.push({
      key: "discovery",
      icon: Search,
      text: t("sources.capabilities.discovery"),
    });
  }
  if (capabilities.pagination !== "none") {
    list.push({
      key: "pagination",
      icon: Layers,
      text: t("sources.capabilities.pagination", {
        kind: translateOr(
          t,
          `sources.pagination.${capabilities.pagination}`,
          capabilities.pagination
        ),
      }),
    });
  }
  if (capabilities.detail) {
    list.push({
      key: "detail",
      icon: FileText,
      text: t("sources.capabilities.detail"),
    });
  }
  if (capabilities.incremental.length > 0) {
    list.push({
      key: "incremental",
      icon: RefreshCw,
      text: t("sources.capabilities.incremental", {
        kinds: capabilities.incremental
          .map((kind) => translateOr(t, `sources.incremental.${kind}`, kind))
          .join(", "),
      }),
    });
  }
  list.push({
    key: "applicationSupport",
    icon: Send,
    text: translateOr(
      t,
      `sources.applicationSupport.${capabilities.application_support}`,
      capabilities.application_support
    ),
  });
  return list;
}

function AdapterCell({
  adapter,
  manifest,
}: {
  adapter: string;
  manifest: AdapterManifest | undefined;
}) {
  const { t } = useTranslation();
  if (!manifest) {
    return <span>{adapter}</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5 text-foreground">
        {manifest.display_name}
        {manifest.status === "beta" ? (
          <Badge variant="outline">{t("sources.status.beta")}</Badge>
        ) : null}
        {requiresOptIn(manifest) ? (
          <Badge variant="outline">{t("sources.status.optIn")}</Badge>
        ) : null}
      </span>
      <ul aria-label={t("sources.capabilities.label")} className="flex gap-1.5">
        {capabilityList(t, manifest).map((capability) => (
          <li key={capability.key}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={capability.text}
                  className="inline-flex rounded-sm text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2"
                  type="button"
                >
                  <capability.icon aria-hidden="true" className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{capability.text}</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LastRun({
  run,
  nowMs,
}: {
  nowMs: number;
  run: DiscoveryRunRecord | undefined;
}) {
  const { t, locale } = useTranslation();
  if (!run) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="flex flex-col">
      <time
        dateTime={new Date(run.started_at).toISOString()}
        title={formatDateTime(run.started_at, locale)}
      >
        {relativeTime(run.started_at, nowMs, locale)}
      </time>
      <span className="type-caption text-muted-foreground">
        {runStatusLabel(t, run.status)}
      </span>
    </span>
  );
}

function LastSuccess({ at, nowMs }: { at: number | null; nowMs: number }) {
  const { t, locale } = useTranslation();
  if (at === null) {
    return <span className="text-muted-foreground">{t("sources.never")}</span>;
  }
  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={formatDateTime(at, locale)}
    >
      {relativeTime(at, nowMs, locale)}
    </time>
  );
}

function RunNowMenu({
  source,
  devices,
  onRun,
}: {
  devices: readonly DeviceView[];
  onRun: (device: string, eligible: boolean) => void;
  source: JobSourceRecord;
}) {
  const { t } = useTranslation();
  const capable = devices.filter(
    (device) =>
      device.revoked_at === null &&
      device.capabilities.includes("discover") &&
      device.accepts_tasks
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("sources.runNowFor", { label: source.label })}
          disabled={!source.enabled}
          size="xs"
          variant="outline"
        >
          <Play aria-hidden="true" data-icon="inline-start" />
          {t("sources.runNow")}
          <ChevronDown aria-hidden="true" data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("sources.runOn")}</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => onRun(ANY_DEVICE, capable.length > 0)}
        >
          {t("sources.anyDevice")}
        </DropdownMenuItem>
        {capable.length > 0 ? <DropdownMenuSeparator /> : null}
        {capable.map((device) => (
          <DropdownMenuItem
            key={device.id}
            onSelect={() => onRun(device.id, true)}
          >
            {device.name}
            <span className="type-caption ml-auto text-muted-foreground">
              {device.online ? t("sources.online") : t("sources.offline")}
            </span>
          </DropdownMenuItem>
        ))}
        {capable.length === 0 ? (
          <p className="type-caption max-w-56 px-2 py-1.5 text-muted-foreground">
            {t("sources.noDevice")}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowMenu({
  source,
  onEdit,
  onTest,
  onDelete,
}: {
  onDelete: () => void;
  onEdit: () => void;
  onTest: () => void;
  source: JobSourceRecord;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("sources.actionsFor", { label: source.label })}
          size="icon-sm"
          variant="ghost"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          {t("common.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onTest}>
          {t("sources.test.action")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} variant="destructive">
          {t("common.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EnabledSwitch({
  source,
  onToggle,
}: {
  onToggle: (value: boolean) => Promise<unknown>;
  source: JobSourceRecord;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Switch
      aria-label={t("sources.enabledFor", { label: source.label })}
      checked={source.enabled}
      disabled={busy}
      onCheckedChange={async (value) => {
        setBusy(true);
        await onToggle(value);
        setBusy(false);
      }}
    />
  );
}

function LabelCell({ source }: { source: JobSourceRecord }) {
  const { t } = useTranslation();
  const reason = disabledReason(source);
  return (
    <div className="flex flex-col gap-1">
      <span className="weight-semibold text-foreground">{source.label}</span>
      {reason ? (
        <Badge className="self-start" variant="destructive">
          {t("sources.disabledBecause", {
            reason: translateOr(t, `sources.disabledReasons.${reason}`, reason),
          })}
        </Badge>
      ) : null}
    </div>
  );
}

export function TestDialog({
  source,
  onClose,
}: {
  onClose: () => void;
  source: JobSourceRecord | null;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={source !== null}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("sources.test.title")}</DialogTitle>
          <DialogDescription>{t("sources.test.explain")}</DialogDescription>
        </DialogHeader>
        {source ? <CopyCommand command={testCommand(source.id)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  source,
  onClose,
}: {
  onClose: () => void;
  source: JobSourceRecord | null;
}) {
  const { t } = useTranslation();
  const { remove } = useSourceActions();
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={source !== null}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("sources.delete.title", { label: source?.label ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("sources.delete.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={async (event) => {
              event.preventDefault();
              if (!source) {
                return;
              }
              setBusy(true);
              await remove(source);
              setBusy(false);
              onClose();
            }}
            variant="destructive"
          >
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface SourcesTableProps {
  devices: readonly DeviceView[];
  manifests: readonly AdapterManifest[];
  nowMs: number;
  onEdit: (source: JobSourceRecord) => void;
  runs: readonly DiscoveryRunRecord[];
  sources: readonly JobSourceRecord[];
}

export function SourcesTable({
  sources,
  manifests,
  runs,
  devices,
  nowMs,
  onEdit,
}: SourcesTableProps) {
  const { t } = useTranslation();
  const phone = useMediaQuery(PHONE_QUERY);
  const actions = useSourceActions();
  const [testing, setTesting] = useState<JobSourceRecord | null>(null);
  const [deleting, setDeleting] = useState<JobSourceRecord | null>(null);
  const manifestOf = (adapter: string) =>
    manifests.find((manifest) => manifest.id === adapter);
  const runOf = (id: string | null) =>
    id === null ? undefined : runs.find((run) => run.id === id);
  const run =
    (source: JobSourceRecord) => (device: string, eligible: boolean) =>
      actions.runNow([source.id], device, eligible);
  const toggle = (source: JobSourceRecord) => (value: boolean) =>
    actions.update(source, { enabled: value });

  const dialogs = (
    <>
      <TestDialog onClose={() => setTesting(null)} source={testing} />
      <DeleteDialog onClose={() => setDeleting(null)} source={deleting} />
    </>
  );

  if (phone) {
    return (
      <>
        <ul
          aria-label={t("sources.listLabel")}
          className="flex flex-col border border-line"
        >
          {sources.map((source) => (
            <li
              className="flex flex-col gap-2 border-line border-b p-3 last:border-b-0"
              data-source={source.id}
              key={source.id}
            >
              <div className="flex items-start gap-2">
                <div className="type-body min-w-0 flex-1">
                  <LabelCell source={source} />
                </div>
                <RowMenu
                  onDelete={() => setDeleting(source)}
                  onEdit={() => onEdit(source)}
                  onTest={() => setTesting(source)}
                  source={source}
                />
              </div>
              <div className="type-body-compact">
                <AdapterCell
                  adapter={source.adapter}
                  manifest={manifestOf(source.adapter)}
                />
              </div>
              <p className="type-caption break-all text-muted-foreground">
                {configSummary(source.adapter, source.config)}
              </p>
              <dl className="type-caption grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">
                  {t("sources.columns.lastRun")}
                </dt>
                <dd>
                  <LastRun nowMs={nowMs} run={runOf(source.last_run_id)} />
                </dd>
                <dt className="text-muted-foreground">
                  {t("sources.columns.lastSuccess")}
                </dt>
                <dd>
                  <LastSuccess at={source.last_success_at} nowMs={nowMs} />
                </dd>
              </dl>
              <div className="flex items-center gap-3">
                <EnabledSwitch onToggle={toggle(source)} source={source} />
                <span className="type-body-compact">
                  {t("sources.columns.enabled")}
                </span>
                <div className="ml-auto">
                  <RunNowMenu
                    devices={devices}
                    onRun={run(source)}
                    source={source}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <div className="border border-line">
        <Table
          aria-label={t("sources.listLabel")}
          className="type-body-compact"
        >
          <TableHeader>
            <TableRow>
              <TableHead>{t("sources.columns.label")}</TableHead>
              <TableHead>{t("sources.columns.adapter")}</TableHead>
              <TableHead>{t("sources.columns.config")}</TableHead>
              <TableHead>{t("sources.columns.lastRun")}</TableHead>
              <TableHead>{t("sources.columns.lastSuccess")}</TableHead>
              <TableHead>{t("sources.columns.enabled")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("common.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((source) => (
              <TableRow data-source={source.id} key={source.id}>
                <TableCell>
                  <LabelCell source={source} />
                </TableCell>
                <TableCell>
                  <AdapterCell
                    adapter={source.adapter}
                    manifest={manifestOf(source.adapter)}
                  />
                </TableCell>
                <TableCell className="max-w-56 break-all text-muted-foreground">
                  {configSummary(source.adapter, source.config)}
                </TableCell>
                <TableCell>
                  <LastRun nowMs={nowMs} run={runOf(source.last_run_id)} />
                </TableCell>
                <TableCell>
                  <LastSuccess at={source.last_success_at} nowMs={nowMs} />
                </TableCell>
                <TableCell>
                  <EnabledSwitch onToggle={toggle(source)} source={source} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <RunNowMenu
                      devices={devices}
                      onRun={run(source)}
                      source={source}
                    />
                    <RowMenu
                      onDelete={() => setDeleting(source)}
                      onEdit={() => onEdit(source)}
                      onTest={() => setTesting(source)}
                      source={source}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {dialogs}
    </>
  );
}
