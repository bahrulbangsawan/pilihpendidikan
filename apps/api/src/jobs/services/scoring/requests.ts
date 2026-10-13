// The scoring routes' logic (05 §6, 07 §6): enqueue scores for the caller's
// current profile_version and read the current score of one posting.

import type {
  GetScoreResponse,
  RequestScoresResponse,
} from "@pilihpendidikan/jobs-contracts/api/scoring";
import { RUBRIC_VERSION } from "@pilihpendidikan/jobs-contracts/scoring";
import type { Env } from "../../../env";
import { notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import { enqueueScoring } from "../../repo/core/score-queue";
import {
  findScore,
  isPostingTracked,
  postingIdsOfUserJobs,
  trackedPostingIds,
} from "../../repo/scoring";

export interface ScoreRequestInput {
  now: number;
  postingIds?: readonly string[];
  profileVersion: number;
  userJobIds?: readonly string[];
}

/**
 * `POST /api/v1/scores:request`: postings already scored for the current
 * profile_version come back as `cached` without a message; the rest are
 * queued (placeholders + `score_postings` messages of ≤ 50 ids, `sendBatch`
 * ≤ 100). Rows that ended `failed` are re-queued. Ids the caller does not
 * track are ignored; when none is tracked the answer is 404 (not owned =
 * not found).
 */
export async function requestScores(
  env: Pick<Env, "JOBS_AI_QUEUE">,
  db: JobsDb,
  scope: UserScope,
  input: ScoreRequestInput
): Promise<RequestScoresResponse> {
  let postingIds = [...new Set(input.postingIds ?? [])];
  if (input.userJobIds) {
    const resolved = await postingIdsOfUserJobs(db, scope, input.userJobIds);
    postingIds = [...new Set(resolved.values())];
  }
  const tracked = await trackedPostingIds(db, scope, postingIds);
  const ids = postingIds.filter((id) => tracked.has(id));
  if (ids.length === 0) {
    throw notFound("None of these postings is tracked by you.");
  }
  const result = await enqueueScoring(env, db, scope, {
    postingIds: ids,
    profileVersion: input.profileVersion,
    now: input.now,
    rubricVersion: RUBRIC_VERSION,
    retryFailed: true,
  });
  return {
    queued: [...result.queued, ...result.pending],
    cached: result.cached,
  };
}

/**
 * `GET /api/v1/scores/{posting_id}`: the score for the caller's CURRENT
 * profile_version (07 §2.1). A placeholder still `queued` reads as null.
 */
export async function getCurrentScore(
  db: JobsDb,
  scope: UserScope,
  postingId: string,
  profileVersion: number
): Promise<GetScoreResponse> {
  if (!(await isPostingTracked(db, scope, postingId))) {
    throw notFound("Posting not found.");
  }
  const row = await findScore(db, scope, postingId, {
    profileVersion,
    rubricVersion: RUBRIC_VERSION,
  });
  return {
    score: row && row.status !== "queued" ? row : null,
    profile_version: profileVersion,
  };
}
