// Runs a bulk action on list rows (06 §9 pattern, shared by every screen
// with a selection): one request per row through `runBulk` (four at a time,
// each with its own Idempotency-Key and base_revision), one summary toast
// with a "Details" action that opens the per-row results, then the listed
// queries are invalidated whatever happened.

import type { QueryKey } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/i18n";
import type { BulkItemResult } from "@/lib/bulk";
import { runBulk, summarizeBulk } from "@/lib/bulk";

export interface BulkRunReport {
  action: string;
  /** Row label per id, for the results dialog. */
  labels: ReadonlyMap<string, string>;
  results: BulkItemResult[];
}

export interface BulkRowRef {
  id: string;
  label: string;
}

export interface BulkRun {
  busy: boolean;
  closeReport: () => void;
  report: BulkRunReport | null;
  run: (
    action: string,
    rows: readonly BulkRowRef[],
    worker: (id: string) => Promise<void>
  ) => Promise<BulkItemResult[]>;
}

export function useBulkRun({
  invalidate,
  onSucceeded,
}: {
  /** Queries to refresh after the run (always, also after failures). */
  invalidate: readonly QueryKey[];
  /** Called when at least one row succeeded (e.g. clear the selection). */
  onSucceeded?: () => void;
}): BulkRun {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BulkRunReport | null>(null);

  const run = useCallback(
    async (
      action: string,
      rows: readonly BulkRowRef[],
      worker: (id: string) => Promise<void>
    ) => {
      setBusy(true);
      const labels = new Map(rows.map((row) => [row.id, row.label]));
      try {
        const results = await runBulk(
          rows.map((row) => row.id),
          worker
        );
        const summary = summarizeBulk(results);
        const next: BulkRunReport = { action, labels, results };
        const notify =
          summary.failed + summary.conflict > 0 ? toast.warning : toast.success;
        notify(
          t("bulk.summary", {
            ok: summary.ok,
            skipped: summary.skipped,
            conflict: summary.conflict,
            failed: summary.failed,
          }),
          {
            description: action,
            action: {
              label: t("bulk.details"),
              onClick: () => setReport(next),
            },
          }
        );
        if (summary.ok > 0) {
          onSucceeded?.();
        }
        return results;
      } finally {
        setBusy(false);
        await Promise.all(
          invalidate.map((queryKey) =>
            queryClient.invalidateQueries({ queryKey })
          )
        );
      }
    },
    [invalidate, onSucceeded, queryClient, t]
  );

  const closeReport = useCallback(() => setReport(null), []);
  return { busy, run, report, closeReport };
}
