// The approval queue (12 §6.1, 05 §8): pending approvals polled every 10 s
// (60 s hidden), recently decided ones on demand, and the decision call —
// bound to the approval's payload_hash with one idempotency key per intent.

import type { DecideApprovalRequest } from "@pilihpendidikan/jobs-contracts/api";
import type { ApprovalRecord } from "@pilihpendidikan/jobs-contracts/records";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/lib/api-client";
import type { ApprovalResponse } from "@/lib/approval-view";
import { sortApprovals } from "@/lib/approval-view";
import { newIdempotencyKey } from "@/lib/idempotency";
import { POLL_POLICIES } from "@/lib/polling";
import { queryKeys } from "@/lib/query";
import { usePollingQuery } from "./use-polling-query";

export type ApprovalView = "pending" | "decided";

const LIST_LIMIT = 200;

export function usePendingApprovals(enabled = true) {
  return usePollingQuery({
    queryKey: queryKeys.approvals("pending"),
    queryFn: async () =>
      sortApprovals(
        (
          await api("GET /api/v1/approvals", {
            query: { state: "pending", limit: LIST_LIMIT },
          })
        ).items
      ),
    policy: POLL_POLICIES.approvals,
    enabled,
  });
}

/** Approved, rejected and expired approvals, newest first. */
export function useDecidedApprovals(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.approvals("decided"),
    queryFn: async () =>
      sortApprovals(
        (
          await api("GET /api/v1/approvals", { query: { limit: LIST_LIMIT } })
        ).items.filter((approval) => approval.state !== "pending")
      ),
    enabled,
    staleTime: 30_000,
  });
}

export interface DecideInput {
  approval: ApprovalRecord;
  decision: DecideApprovalRequest["decision"];
  response?: ApprovalResponse;
}

/**
 * `POST /api/v1/approvals/{id}/decide` with the approval's own payload_hash
 * (03 §8): if the device changed the form since, the API refuses and the
 * agent asks again. Refreshes everything the decision touches.
 */
export function useDecideApproval() {
  const queryClient = useQueryClient();
  return useCallback(
    async ({ approval, decision, response }: DecideInput) => {
      const result = await api("POST /api/v1/approvals/{apr_id}/decide", {
        params: { apr_id: approval.id },
        body: {
          decision,
          payload_hash: approval.payload_hash,
          ...(response ? { response } : {}),
        },
        idempotencyKey: newIdempotencyKey(),
      });
      await refreshAfterDecision(queryClient, approval);
      return result;
    },
    [queryClient]
  );
}

export async function refreshAfterDecision(
  queryClient: ReturnType<typeof useQueryClient>,
  approval: Pick<ApprovalRecord, "application_id" | "task_id" | "kind">
): Promise<void> {
  const work: Promise<void>[] = [
    queryClient.invalidateQueries({ queryKey: queryKeys.approvalsAll }),
    queryClient.invalidateQueries({ queryKey: queryKeys.boardAll }),
  ];
  if (approval.application_id) {
    work.push(
      queryClient.invalidateQueries({
        queryKey: queryKeys.application(approval.application_id),
      })
    );
  }
  if (approval.task_id) {
    work.push(
      queryClient.invalidateQueries({
        queryKey: queryKeys.task(approval.task_id),
      })
    );
  }
  if (approval.kind === "rule_activation") {
    work.push(queryClient.invalidateQueries({ queryKey: queryKeys.rules }));
  }
  await Promise.all(work);
}
