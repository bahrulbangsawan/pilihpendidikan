// The UI half of 12 §11: run a conditional write through writeWithConflicts
// and tell the user what happened — "Updated with changes from the CLI" after
// an auto-merge, or the overlap toast with "Apply mine anyway" / "Keep
// theirs" (nothing is retried until they choose).

import type { ChangeSource } from "@pilihpendidikan/jobs-contracts/enums";
import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { UpdateApplicationRequest } from "@pilihpendidikan/jobs-contracts/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { APPLICATION_FIELDS, applicationFieldMerger } from "@/lib/conflict";
import { newIdempotencyKey } from "@/lib/idempotency";
import { changeSourceLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query";
import type {
  RevisionedRecord,
  RevisionedWrite,
  WriteOutcome,
} from "@/lib/revisioned-write";
import { writeWithConflicts } from "@/lib/revisioned-write";
import { commitApplicationToBoard } from "./use-board";

function sourceOf(record: unknown): ChangeSource | null {
  if (
    typeof record === "object" &&
    record !== null &&
    "last_change_source" in record
  ) {
    const source = record.last_change_source;
    return typeof source === "string" ? (source as ChangeSource) : null;
  }
  return null;
}

export function useConflictWrite() {
  const { t } = useTranslation();
  return useCallback(
    async <T extends RevisionedRecord>(
      write: RevisionedWrite<T>,
      options: { onSaved?: (record: T) => void; what?: string } = {}
    ): Promise<WriteOutcome<T> | null> => {
      let outcome: WriteOutcome<T>;
      try {
        outcome = await writeWithConflicts(write);
      } catch (error) {
        toast.error(
          isApiError(error) && error.status === 422
            ? t("conflict.refused", { message: error.message })
            : t("conflict.saveFailed")
        );
        return null;
      }
      if (outcome.kind === "saved") {
        options.onSaved?.(outcome.record);
        if (outcome.mergedFrom.length > 0) {
          const source = sourceOf(outcome.record);
          toast.success(
            t("conflict.merged", {
              source: source
                ? changeSourceLabel(t, source)
                : t("changeSources.web"),
            })
          );
        }
        return outcome;
      }
      if (outcome.kind === "noop") {
        options.onSaved?.(outcome.record);
        return outcome;
      }
      const source = sourceOf(outcome.current);
      toast.warning(
        t("conflict.overlap", {
          what: options.what ?? t("conflict.thisItem"),
          source: source
            ? changeSourceLabel(t, source)
            : t("changeSources.web"),
        }),
        {
          duration: 15_000,
          action: {
            label: t("conflict.applyMine"),
            onClick: async () => {
              try {
                options.onSaved?.(await outcome.applyMine());
              } catch {
                toast.error(t("conflict.saveFailed"));
              }
            },
          },
          cancel: {
            label: t("conflict.keepTheirs"),
            onClick: () => options.onSaved?.(outcome.current),
          },
        }
      );
      options.onSaved?.(outcome.current);
      return outcome;
    },
    [t]
  );
}

export type ApplicationPatch = Omit<UpdateApplicationRequest, "base_revision">;

/**
 * `PATCH /api/v1/applications/{id}` under the conflict rules, updating the
 * board and the detail caches with whatever the server ends up holding.
 */
export function useApplicationPatch() {
  const queryClient = useQueryClient();
  const write = useConflictWrite();
  return useCallback(
    (
      base: { id: string; revision: number } & Record<string, unknown>,
      changes: ApplicationPatch,
      what?: string
    ) =>
      write<ApplicationRecord>(
        {
          base: base as unknown as ApplicationRecord,
          changes,
          fields: APPLICATION_FIELDS,
          merge: applicationFieldMerger,
          send: async (baseRevision, fields) =>
            (
              await api("PATCH /api/v1/applications/{app_id}", {
                params: { app_id: base.id },
                body: {
                  ...(fields as ApplicationPatch),
                  base_revision: baseRevision,
                },
                idempotencyKey: newIdempotencyKey(),
              })
            ).application,
        },
        {
          what,
          onSaved: (record) => {
            commitApplicationToBoard(queryClient, record);
            queryClient.invalidateQueries({
              queryKey: queryKeys.application(record.id),
            });
            queryClient.invalidateQueries({ queryKey: queryKeys.boardAll });
          },
        }
      ),
    [queryClient, write]
  );
}
