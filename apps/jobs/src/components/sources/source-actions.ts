// Source writes (05 §4, 12 §8): create, edit and the enabled switch (PATCH
// with base_revision under the 12 §11 conflict rules), delete (with
// `?base_revision`), and "Run now" (a `discover` task, 21 §4).

import type { CreateSourceRequest } from "@pilihpendidikan/jobs-contracts/api";
import type { JobSourceRecord } from "@pilihpendidikan/jobs-contracts/records";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { useConflictWrite } from "@/hooks/use-conflict-write";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";
import { runNowTask } from "@/lib/sources-model";

/** The writable source fields (conflicts compare only these). */
export const SOURCE_FIELDS = [
  "label",
  "config",
  "enabled",
  "schedule",
] as const;

export type SourceChanges = Partial<
  Pick<JobSourceRecord, "label" | "config" | "enabled" | "schedule">
>;

export function useSourceActions() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const write = useConflictWrite();

  const commit = useCallback(
    (record: JobSourceRecord) => {
      queryClient.setQueryData<JobSourceRecord[]>(queryKeys.sources, (list) =>
        list?.map((source) => (source.id === record.id ? record : source))
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.sources });
    },
    [queryClient]
  );

  const create = useCallback(
    async (body: CreateSourceRequest): Promise<JobSourceRecord | null> => {
      try {
        const { source } = await api("POST /api/v1/sources", {
          body,
          idempotencyKey: newIdempotencyKey(),
        });
        queryClient.setQueryData<JobSourceRecord[]>(
          queryKeys.sources,
          (list) => (list ? [...list, source] : [source])
        );
        queryClient.invalidateQueries({ queryKey: queryKeys.sources });
        toast.success(t("sources.saved", { label: source.label }));
        return source;
      } catch (error) {
        toast.error(
          isApiError(error) && (error.status === 422 || error.status === 400)
            ? t("sources.refused", { message: error.message })
            : t("sources.saveFailed")
        );
        return null;
      }
    },
    [queryClient, t]
  );

  const update = useCallback(
    (source: JobSourceRecord, changes: SourceChanges) =>
      write<JobSourceRecord>(
        {
          base: source,
          changes,
          fields: SOURCE_FIELDS,
          send: async (baseRevision, fields) =>
            (
              await api("PATCH /api/v1/sources/{src_id}", {
                params: { src_id: source.id },
                body: {
                  ...(fields as SourceChanges),
                  base_revision: baseRevision,
                },
                idempotencyKey: newIdempotencyKey(),
              })
            ).source,
        },
        {
          what: t("sources.what", { label: source.label }),
          onSaved: commit,
        }
      ),
    [commit, t, write]
  );

  const remove = useCallback(
    async (source: JobSourceRecord): Promise<boolean> => {
      try {
        await api("DELETE /api/v1/sources/{src_id}", {
          params: { src_id: source.id },
          query: { base_revision: source.revision },
          idempotencyKey: newIdempotencyKey(),
        });
        queryClient.setQueryData<JobSourceRecord[]>(queryKeys.sources, (list) =>
          list?.filter((entry) => entry.id !== source.id)
        );
        queryClient.invalidateQueries({ queryKey: queryKeys.sources });
        toast.success(t("sources.deleted", { label: source.label }));
        return true;
      } catch (error) {
        toast.error(
          isApiError(error) && error.isRevisionConflict
            ? t("sources.changedMeanwhile")
            : t("sources.deleteFailed")
        );
        queryClient.invalidateQueries({ queryKey: queryKeys.sources });
        return false;
      }
    },
    [queryClient, t]
  );

  const runNow = useCallback(
    async (
      sourceIds: readonly string[],
      device: string,
      hasEligibleDevice: boolean
    ): Promise<boolean> => {
      const key = newIdempotencyKey();
      try {
        await api("POST /api/v1/tasks", {
          body: runNowTask(sourceIds, device, key, hasEligibleDevice),
          idempotencyKey: key,
        });
        toast.success(
          hasEligibleDevice
            ? t("sources.runQueued")
            : t("sources.runQueuedNoDevice")
        );
        queryClient.invalidateQueries({ queryKey: queryKeys.tasksAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.discoveryRuns });
        return true;
      } catch (error) {
        toast.error(
          isApiError(error) && error.status === 422
            ? t("sources.refused", { message: error.message })
            : t("sources.runFailed")
        );
        return false;
      }
    },
    [queryClient, t]
  );

  return { create, update, remove, runNow };
}
