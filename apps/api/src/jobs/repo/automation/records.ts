// Row → API record decoding for the automation tables (04 §2.3, §2.6) and
// the small statement helpers every automation repo module shares.
//
// JSON columns come back parsed and 0/1 flags as booleans (PLAN C2) through
// the kernel's `decodeRow`. Nothing here runs SQL by itself except
// `executeBatch`, the one entry point services, the queue handler and the
// cron use to run a batch they assembled from repo statements (only repo/**
// may call the kernel's `runBatch`).

import type {
  ApprovalRecord,
  AutomationAttemptRecord,
  AutomationRuleRecord,
  AutomationTaskRecord,
  SubmissionEvidenceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { TaskState } from "@pilihpendidikan/jobs-contracts/enums";
import type { JobsDb } from "../core/db";
import { decodeRow, returnedRows, runBatch } from "../core/db";

export type Row = Record<string, unknown>;

export function toTask(row: Row): AutomationTaskRecord {
  return decodeRow<AutomationTaskRecord>("automation_tasks", row);
}

export function toRule(row: Row): AutomationRuleRecord {
  return decodeRow<AutomationRuleRecord>("automation_rules", row);
}

export function toApproval(row: Row): ApprovalRecord {
  return decodeRow<ApprovalRecord>("approvals", row);
}

export function toAttempt(row: Row): AutomationAttemptRecord {
  return decodeRow<AutomationAttemptRecord>("automation_attempts", row);
}

export function toEvidence(row: Row): SubmissionEvidenceRecord {
  return decodeRow<SubmissionEvidenceRecord>("submission_evidence", row);
}

/** Lease-holding task states (21 §5.2, the heartbeat predicate). */
export const HOLDING_STATES = [
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
] as const satisfies readonly TaskState[];

/** `?, ?, …` for an IN list of `n` values. */
export function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

export const HOLDING_IN = placeholders(HOLDING_STATES.length);

/**
 * Runs statements assembled from repo builders as ONE transactional batch
 * (D1 batches are all-or-nothing). Returns the rows of each RETURNING
 * statement, in order. Guard failures surface as `GuardFailedError`, unique
 * violations as `UniqueViolationError` (both from repo/core/db).
 */
export async function executeBatch(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<Row[][]> {
  const results = await runBatch(db, statements);
  return results.map((result) => returnedRows<Row>(result));
}
