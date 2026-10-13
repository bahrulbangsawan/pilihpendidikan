// Bulk actions on the selected sources (12 §8): Enable / Disable (one PATCH
// per source with its base_revision), Run now (one `discover` task for all
// the enabled ones, at most 50 sources per task, exactly what the single
// "Run now" sends) and Delete (confirmed, one DELETE per source).

import type { DeviceView } from "@pilihpendidikan/jobs-contracts/api";
import type { JobSourceRecord } from "@pilihpendidikan/jobs-contracts/records";
import { Button } from "@rulisme/ui/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { ChevronDown, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  BulkConfirmDialog,
  BulkRunResultsDialog,
  BulkToolbar,
} from "@/components/bulk/bulk-toolbar";
import { useBulkRun } from "@/hooks/use-bulk-run";
import type { Selection } from "@/hooks/use-selection";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { BulkSkip } from "@/lib/bulk";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";
import {
  ANY_DEVICE,
  discoverCapable,
  RUN_NOW_MAX_SOURCES,
  runNowBatches,
  runNowTask,
} from "@/lib/sources-model";

const INVALIDATE = [
  queryKeys.sources,
  queryKeys.tasksAll,
  queryKeys.discoveryRuns,
] as const;

export function SourcesBulkBar({
  selection,
  sources,
  devices,
}: {
  devices: readonly DeviceView[];
  selection: Selection;
  sources: readonly JobSourceRecord[];
}) {
  const { t } = useTranslation();
  const bulk = useBulkRun({
    invalidate: INVALIDATE,
    onSucceeded: selection.clear,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const byId = new Map(sources.map((source) => [source.id, source]));
  const selected = selection.selectedIds
    .map((id) => byId.get(id))
    .filter((source): source is JobSourceRecord => source !== undefined);
  const rows = selected.map((source) => ({
    id: source.id,
    label: source.label,
  }));
  const capable = discoverCapable(devices);

  function sourceOf(id: string): JobSourceRecord {
    const source = byId.get(id);
    if (!source) {
      throw new BulkSkip("gone", t("sources.bulk.gone"));
    }
    return source;
  }

  function setEnabled(enabled: boolean) {
    return bulk.run(
      enabled ? t("sources.bulk.enable") : t("sources.bulk.disable"),
      rows,
      async (id) => {
        const source = sourceOf(id);
        if (source.enabled === enabled) {
          throw new BulkSkip(
            "unchanged",
            enabled
              ? t("sources.bulk.alreadyEnabled")
              : t("sources.bulk.alreadyDisabled")
          );
        }
        await api("PATCH /api/v1/sources/{src_id}", {
          params: { src_id: id },
          body: { enabled, base_revision: source.revision },
          idempotencyKey: newIdempotencyKey(),
        });
      }
    );
  }

  function runNow(device: string, eligible: boolean) {
    const runnable = selected
      .filter((source) => source.enabled)
      .map((source) => source.id);
    // One task per batch of sources; every row of a batch shares its answer.
    const batches = new Map<string, Promise<void>>();
    const batchOf = new Map<string, string[]>();
    for (const batch of runNowBatches(runnable)) {
      for (const id of batch) {
        batchOf.set(id, batch);
      }
    }
    return bulk.run(t("sources.bulk.runNow"), rows, async (id) => {
      const batch = batchOf.get(id);
      if (!batch) {
        throw new BulkSkip("disabled", t("sources.bulk.disabledSkip"));
      }
      const head = batch[0] as string;
      let sent = batches.get(head);
      if (!sent) {
        const key = newIdempotencyKey();
        sent = api("POST /api/v1/tasks", {
          body: runNowTask(batch, device, key, eligible),
          idempotencyKey: key,
        }).then(() => undefined);
        batches.set(head, sent);
      }
      await sent;
    });
  }

  async function remove() {
    await bulk.run(t("sources.bulk.delete"), rows, async (id) => {
      const source = sourceOf(id);
      await api("DELETE /api/v1/sources/{src_id}", {
        params: { src_id: id },
        query: { base_revision: source.revision },
        idempotencyKey: newIdempotencyKey(),
      });
    });
    setConfirmDelete(false);
  }

  const enabledCount = selected.filter((source) => source.enabled).length;
  return (
    <>
      <BulkToolbar count={selected.length} onClear={selection.clear}>
        <Button
          disabled={bulk.busy || enabledCount === selected.length}
          onClick={() => setEnabled(true)}
          size="sm"
          variant="outline"
        >
          {t("sources.bulk.enable")}
        </Button>
        <Button
          disabled={bulk.busy || enabledCount === 0}
          onClick={() => setEnabled(false)}
          size="sm"
          variant="outline"
        >
          {t("sources.bulk.disable")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              disabled={bulk.busy || enabledCount === 0}
              size="sm"
              variant="outline"
            >
              <Play aria-hidden="true" data-icon="inline-start" />
              {t("sources.bulk.runNow")}
              <ChevronDown aria-hidden="true" data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{t("sources.runOn")}</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => runNow(ANY_DEVICE, capable.length > 0)}
            >
              {t("sources.anyDevice")}
            </DropdownMenuItem>
            {capable.length > 0 ? <DropdownMenuSeparator /> : null}
            {capable.map((device) => (
              <DropdownMenuItem
                key={device.id}
                onSelect={() => runNow(device.id, true)}
              >
                {device.name}
              </DropdownMenuItem>
            ))}
            {enabledCount > RUN_NOW_MAX_SOURCES ? (
              <p className="type-caption max-w-56 px-2 py-1.5 text-muted-foreground">
                {t("sources.bulk.runBatches", { max: RUN_NOW_MAX_SOURCES })}
              </p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          disabled={bulk.busy}
          onClick={() => setConfirmDelete(true)}
          size="sm"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" data-icon="inline-start" />
          {t("sources.bulk.delete")}
        </Button>
      </BulkToolbar>
      <BulkConfirmDialog
        body={t("sources.bulk.deleteBody")}
        busy={bulk.busy}
        confirmLabel={t("bulk.delete", { count: selected.length })}
        onConfirm={remove}
        onOpenChange={setConfirmDelete}
        open={confirmDelete}
        title={t("sources.bulk.deleteTitle", { count: selected.length })}
      />
      <BulkRunResultsDialog onClose={bulk.closeReport} report={bulk.report} />
    </>
  );
}
