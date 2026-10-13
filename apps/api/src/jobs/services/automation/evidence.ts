// Submission evidence as the device reports it (19 §9, 04 §2.6
// `submission_evidence`): the API record and the submission status a verdict
// stands for (03 §5.2, D-18: `submitted_verified` needs verified evidence).

import type { TaskResultRequest } from "@pilihpendidikan/jobs-contracts/api";
import type { SubmissionStatus } from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  AutomationTaskRecord,
  SubmissionEvidenceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";

export type EvidenceInput = NonNullable<TaskResultRequest["evidence"]>;

/** verified → submitted_verified, unverified → submitted_unverified, negative → failed. */
export function evidenceStatus(
  verdict: EvidenceInput["verdict"]
): SubmissionStatus {
  if (verdict === "verified") {
    return "submitted_verified";
  }
  return verdict === "unverified" ? "submitted_unverified" : "failed";
}

/** True for the two `submitted_*` statuses. */
export function isSubmitted(status: SubmissionStatus | null): boolean {
  return status === "submitted_verified" || status === "submitted_unverified";
}

/** The evidence row of an apply task's attempt. */
export function evidenceRecord(
  scope: UserScope,
  task: Pick<AutomationTaskRecord, "application_id" | "id">,
  attemptId: string | null,
  evidence: EvidenceInput,
  now: number
): SubmissionEvidenceRecord {
  return {
    id: newId("evd", now),
    user_id: scope.userId,
    application_id: task.application_id as string,
    task_id: task.id,
    attempt_id: attemptId,
    kind: evidence.kind,
    verdict: evidence.verdict,
    signals: evidence.signals,
    final_url: evidence.final_url ?? null,
    page_title: evidence.page_title ?? null,
    text_excerpt: evidence.text_excerpt ?? null,
    screenshot_file_id: evidence.screenshot_file_id ?? null,
    form_hash: evidence.form_hash ?? null,
    captured_at: evidence.captured_at,
    recorded_at: now,
  };
}
