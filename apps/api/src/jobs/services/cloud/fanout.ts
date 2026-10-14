// Follower fan-out (24 §5.3, §6.5, D-39): new postings of a cloud source
// reach every follower's inbox (origin `discovered`, inbox `new`,
// `user_jobs.source_id` = the csr_ id) and are scored with that follower's
// own profile and budget through the existing scoring producer (07 §7.1).
// Each follower is handled with a trusted scope of their own id; one
// follower's failure never stops the others.

import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { Env } from "../../../env";
import { trustedScope } from "../../core/scope";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import { findUserById } from "../../repo/core/users";
import { computeProfileVersion } from "../../repo/core/profile-version";
import { enqueueScoring } from "../../repo/core/score-queue";
import { followerIds } from "../../repo/cloud/follows";
import {
  backfillCandidates,
  followerLinkStatements,
  unlinkedPostingIds,
  runCloudBatch,
} from "../../repo/cloud/postings";

/** Most new inbox entries one run adds per follower. */
export const MAX_LINKS_PER_USER_PER_RUN = 100;
/** Follow backfill (24 §5.3): open postings of the last 14 days, ≤ 50. */
export const BACKFILL_WINDOW_MS = 14 * 86_400_000;
export const BACKFILL_LIMIT = 50;

type FanoutEnv = Pick<Env, "CV_KV" | "DB" | "JOBS_AI_QUEUE">;

async function queueScores(
  env: FanoutEnv,
  db: JobsDb,
  scope: UserScope,
  postingIds: readonly string[],
  now: number
): Promise<void> {
  if (postingIds.length === 0) {
    return;
  }
  const user = await findUserById(env.DB, scope.userId);
  if (!user || user.deleted_at !== null) {
    return;
  }
  const profileVersion = await computeProfileVersion(env, db, scope, {
    email: user.email,
  });
  await enqueueScoring(env, db, scope, { postingIds, profileVersion, now });
}

/** Links `postingIds` into one user's inbox; returns the ids linked. */
export async function linkPostingsForUser(
  env: FanoutEnv,
  db: JobsDb,
  scope: UserScope,
  sourceId: string,
  postingIds: readonly string[],
  now: number
): Promise<string[]> {
  const fresh = (await unlinkedPostingIds(db, scope, postingIds)).slice(
    0,
    MAX_LINKS_PER_USER_PER_RUN
  );
  if (fresh.length === 0) {
    return [];
  }
  const links = fresh.map((postingId) => ({
    id: newId("ujb", now),
    postingId,
  }));
  await runCloudBatch(
    db,
    followerLinkStatements(db, scope, links, sourceId, now)
  );
  try {
    await queueScores(env, db, scope, fresh, now);
  } catch (err) {
    // The links are stored; the inbox can re-request scores (`score` bulk
    // action). Never fail the fan-out on the scoring queue.
    console.warn(
      JSON.stringify({
        evt: "cloud_score_enqueue_failed",
        source_id: sourceId,
        postings: fresh.length,
        error: err instanceof Error ? err.name : String(err),
      })
    );
  }
  return fresh;
}

/** Fan-out of one run's new postings; returns the number of links made. */
export async function linkFollowers(
  env: FanoutEnv,
  db: JobsDb,
  sourceId: string,
  postingIds: readonly string[],
  now: number
): Promise<number> {
  if (postingIds.length === 0) {
    return 0;
  }
  let linked = 0;
  for (const userId of await followerIds(db, sourceId)) {
    try {
      const scope = trustedScope(userId, "queue");
      linked += (
        await linkPostingsForUser(env, db, scope, sourceId, postingIds, now)
      ).length;
    } catch (err) {
      console.error(
        JSON.stringify({
          evt: "cloud_fanout_failed",
          source_id: sourceId,
          error:
            err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
      );
    }
  }
  return linked;
}

/** Follow backfill for the caller: recent open postings of the source. */
export async function backfillFollow(
  env: FanoutEnv,
  db: JobsDb,
  scope: UserScope,
  sourceId: string,
  now: number
): Promise<number> {
  const candidates = await backfillCandidates(
    db,
    scope,
    sourceId,
    now - BACKFILL_WINDOW_MS,
    BACKFILL_LIMIT
  );
  return (await linkPostingsForUser(env, db, scope, sourceId, candidates, now))
    .length;
}
