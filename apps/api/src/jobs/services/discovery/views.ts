// API views of discovery records (05 §4, 06 §1.3).

import type { ScoreSummary } from "@pilihpendidikan/jobs-contracts/api";
import type { MatchScoreRecord } from "@pilihpendidikan/jobs-contracts/records";
import { DETERMINISTIC_ONLY_MODEL } from "@pilihpendidikan/jobs-contracts/scoring";

/**
 * The score badge of a `match_scores` row. `deterministic_only` is true for
 * a ready score no AI component contributed to ("AI off", 07 §11).
 */
export function toScoreSummary(row: MatchScoreRecord): ScoreSummary {
  const components = row.components as { ai?: { status?: string } };
  const deterministicOnly =
    row.status === "ready" &&
    (row.model === DETERMINISTIC_ONLY_MODEL || components.ai?.status !== "ok");
  return {
    posting_id: row.posting_id,
    score: row.score,
    status: row.status,
    confidence: row.confidence,
    deterministic_only: deterministicOnly,
    profile_version: row.profile_version,
    rubric_version: row.rubric_version,
    explanation: row.explanation,
    created_at: row.created_at,
  };
}
