// An application as the subject of a move (`useMoveCard`), from its detail:
// the board summary fields plus any unfinished task, so the move questions
// (06 §2.2) still guard work that is in flight.

import type {
  ApplicationDetail,
  LiveTaskSummary,
} from "@pilihpendidikan/jobs-contracts/api";
import type { MoveRequest } from "@/components/board/use-move-card";

const LIVE_STATES = new Set([
  "queued",
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
]);

export function moveSubjectOf(detail: ApplicationDetail): MoveRequest["card"] {
  const task = detail.tasks.find((entry) => LIVE_STATES.has(entry.state));
  const live: LiveTaskSummary | null = task
    ? {
        id: task.id,
        kind: task.kind,
        state: task.state,
        device_id: task.lease_device_id ?? task.target_device_id,
        device_name: null,
        pause_reason: task.pause_reason,
        progress_stage: "stage" in task.progress ? task.progress.stage : null,
        submit_intent_at: task.submit_intent_at,
        updated_at: task.updated_at,
      }
    : null;
  return {
    id: detail.application.id,
    stage: detail.application.stage,
    revision: detail.application.revision,
    submission_status: detail.application.submission_status,
    live_task: live,
    company: detail.posting.company_name,
    title: detail.posting.title,
  };
}
