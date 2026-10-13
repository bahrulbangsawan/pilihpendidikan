// Scoring producer (07 §7.1, 14 §6): the one way to request match scores.
//
// For each posting the producer first inserts a `match_scores` placeholder
// (`status = 'queued'`, `score = 0`, `components = '{}'`, model "queued")
// with `INSERT … ON CONFLICT(user_id, posting_id, profile_version,
// rubric_version) DO NOTHING RETURNING posting_id`, and sends `score_postings`
// messages (≤ 50 postings each, `sendBatch` ≤ 100 messages) ONLY for the rows
// it inserted. A duplicate request therefore never sends a second message
// (T7-06). Placeholders are only created for postings the user tracks
// (`user_jobs`), so a user cannot get scores for postings they cannot see.
//
//   const r = await enqueueScoring(c.env, c.db, c.scope, {
//     postingIds, profileVersion: await getProfileVersion(c.env, c.db, c.scope), now: c.now,
//   });
//   // r.queued: newly queued, r.pending: already queued, r.cached: ready,
//   // r.failed: failed rows (re-queued when retryFailed), r.untracked: no user_jobs link

import { RUBRIC_VERSION } from "@pilihpendidikan/jobs-contracts/scoring";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { JobsAiMessage } from "@pilihpendidikan/jobs-contracts/queue";
import {
  chunkPostingIds,
  parseQueueMessage,
} from "@pilihpendidikan/jobs-contracts/queue";
import type { Env } from "../../../env";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "./db";
import { queryAll, returnedRows, runBatch, stmt } from "./db";

/** Placeholder `model` of a queued score row. */
export const QUEUED_SCORE_MODEL = "queued";
/** Queue `sendBatch` limit (14 §6). */
export const SEND_BATCH_MAX = 100;
/** D1 allows 100 bound parameters per statement (04 header). */
const IN_CHUNK = 90;

export interface ScoreRequest {
  now: number;
  postingIds: readonly string[];
  profileVersion: number;
  /** Re-queue rows that ended `failed` (default false). */
  retryFailed?: boolean;
  rubricVersion?: string;
}

export interface ScoreRequestResult {
  cached: string[];
  failed: string[];
  /** Messages sent. */
  messages: number;
  pending: string[];
  queued: string[];
  untracked: string[];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function insertPlaceholders(
  db: JobsDb,
  scope: UserScope,
  ids: readonly string[],
  request: Required<Pick<ScoreRequest, "now" | "profileVersion">> & {
    rubricVersion: string;
  }
): Promise<string[]> {
  const inserted: string[] = [];
  for (const group of chunk(ids, SEND_BATCH_MAX)) {
    const results = await runBatch(
      db,
      group.map((postingId) =>
        stmt(
          db,
          "INSERT INTO match_scores (id, user_id, posting_id, profile_version, rubric_version, model, score, confidence, components, explanation, status, created_at) SELECT ?, ?, ?, ?, ?, ?, 0, NULL, '{}', '', 'queued', ? WHERE EXISTS (SELECT 1 FROM user_jobs WHERE user_id = ? AND posting_id = ?) ON CONFLICT(user_id, posting_id, profile_version, rubric_version) DO NOTHING RETURNING posting_id",
          newId("scr", request.now),
          scope.userId,
          postingId,
          request.profileVersion,
          request.rubricVersion,
          QUEUED_SCORE_MODEL,
          request.now,
          scope.userId,
          postingId
        )
      )
    );
    for (const result of results) {
      for (const row of returnedRows<{ posting_id: string }>(result)) {
        inserted.push(row.posting_id);
      }
    }
  }
  return inserted;
}

async function requeueFailed(
  db: JobsDb,
  scope: UserScope,
  ids: readonly string[],
  request: { now: number; profileVersion: number; rubricVersion: string }
): Promise<string[]> {
  const requeued: string[] = [];
  for (const group of chunk(ids, IN_CHUNK)) {
    const marks = group.map(() => "?").join(", ");
    const results = await runBatch(db, [
      stmt(
        db,
        `UPDATE match_scores SET status = 'queued', model = ?, score = 0, components = '{}', explanation = '', created_at = ? WHERE user_id = ? AND profile_version = ? AND rubric_version = ? AND status = 'failed' AND posting_id IN (${marks}) RETURNING posting_id`,
        QUEUED_SCORE_MODEL,
        request.now,
        scope.userId,
        request.profileVersion,
        request.rubricVersion,
        ...group
      ),
    ]);
    for (const row of returnedRows<{ posting_id: string }>(results[0])) {
      requeued.push(row.posting_id);
    }
  }
  return requeued;
}

async function statusesOf(
  db: JobsDb,
  scope: UserScope,
  ids: readonly string[],
  request: { profileVersion: number; rubricVersion: string }
): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
  for (const group of chunk(ids, IN_CHUNK)) {
    const marks = group.map(() => "?").join(", ");
    const rows = await queryAll<{ posting_id: string; status: string }>(
      db,
      `SELECT posting_id, status FROM match_scores WHERE user_id = ? AND profile_version = ? AND rubric_version = ? AND posting_id IN (${marks})`,
      scope.userId,
      request.profileVersion,
      request.rubricVersion,
      ...group
    );
    for (const row of rows) {
      statuses.set(row.posting_id, row.status);
    }
  }
  return statuses;
}

async function sendScoreMessages(
  env: Pick<Env, "JOBS_AI_QUEUE">,
  scope: UserScope,
  ids: readonly string[],
  request: { profileVersion: number; rubricVersion: string }
): Promise<number> {
  const messages: JobsAiMessage[] = chunkPostingIds(ids).map((postingIds) =>
    parseQueueMessage({
      v: 1,
      type: "score_postings",
      message_id: crypto.randomUUID(),
      user_id: scope.userId,
      posting_ids: postingIds,
      profile_version: request.profileVersion,
      rubric_version: request.rubricVersion,
    })
  );
  for (const group of chunk(messages, SEND_BATCH_MAX)) {
    await env.JOBS_AI_QUEUE.sendBatch(group.map((body) => ({ body })));
  }
  return messages.length;
}

/** Queues scoring for `postingIds` at `profileVersion` (07 §7.1). */
export async function enqueueScoring(
  env: Pick<Env, "JOBS_AI_QUEUE">,
  db: JobsDb,
  scope: UserScope,
  request: ScoreRequest
): Promise<ScoreRequestResult> {
  const rubricVersion = request.rubricVersion ?? RUBRIC_VERSION;
  const ids = [...new Set(request.postingIds)];
  const shared = {
    now: request.now,
    profileVersion: request.profileVersion,
    rubricVersion,
  };
  const inserted = await insertPlaceholders(db, scope, ids, shared);
  const insertedSet = new Set(inserted);
  const rest = ids.filter((id) => !insertedSet.has(id));
  const statuses = await statusesOf(db, scope, rest, shared);
  const failed = rest.filter((id) => statuses.get(id) === "failed");
  const requeued = request.retryFailed
    ? await requeueFailed(db, scope, failed, shared)
    : [];
  const queued = [...inserted, ...requeued];
  let messages = 0;
  try {
    messages = await sendScoreMessages(env, scope, queued, shared);
  } catch (err) {
    // No message, no consumer: undo what this call queued so no row stays
    // `queued` forever, then let the caller answer 503.
    await rollbackPlaceholders(db, scope, { inserted, requeued }, shared);
    throw err;
  }
  const requeuedSet = new Set(requeued);
  return {
    queued,
    pending: rest.filter((id) => statuses.get(id) === "queued"),
    cached: rest.filter((id) => statuses.get(id) === "ready"),
    failed: failed.filter((id) => !requeuedSet.has(id)),
    untracked: rest.filter((id) => !statuses.has(id)),
    messages,
  };
}

async function rollbackPlaceholders(
  db: JobsDb,
  scope: UserScope,
  ids: { inserted: readonly string[]; requeued: readonly string[] },
  request: { now: number; profileVersion: number; rubricVersion: string }
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const group of chunk(ids.inserted, IN_CHUNK)) {
    const marks = group.map(() => "?").join(", ");
    statements.push(
      stmt(
        db,
        `DELETE FROM match_scores WHERE user_id = ? AND profile_version = ? AND rubric_version = ? AND status = 'queued' AND created_at = ? AND posting_id IN (${marks})`,
        scope.userId,
        request.profileVersion,
        request.rubricVersion,
        request.now,
        ...group
      )
    );
  }
  for (const group of chunk(ids.requeued, IN_CHUNK)) {
    const marks = group.map(() => "?").join(", ");
    statements.push(
      stmt(
        db,
        `UPDATE match_scores SET status = 'failed' WHERE user_id = ? AND profile_version = ? AND rubric_version = ? AND status = 'queued' AND created_at = ? AND posting_id IN (${marks})`,
        scope.userId,
        request.profileVersion,
        request.rubricVersion,
        request.now,
        ...group
      )
    );
  }
  await runBatch(db, statements);
}

/** 07 §2.1: at most this many postings are re-queued per profile change. */
export const PROFILE_RESCORE_LIMIT = 500;

/**
 * Postings to re-score after a `profile_version` change (07 §2.1): inbox
 * `new`/`seen` and active (non-terminal, non-archived) applications without a
 * row for the new version, newest first, capped at 500.
 */
export async function profileRescoreCandidates(
  db: JobsDb,
  scope: UserScope,
  options: { limit?: number; profileVersion: number; rubricVersion?: string }
): Promise<string[]> {
  const rows = await queryAll<{ posting_id: string }>(
    db,
    "SELECT u.posting_id FROM user_jobs u LEFT JOIN applications a ON a.user_job_id = u.id AND a.user_id = u.user_id WHERE u.user_id = ? AND (u.inbox_state IN ('new', 'seen') OR (a.id IS NOT NULL AND a.archived = 0 AND a.stage NOT IN ('accepted', 'rejected', 'withdrawn'))) AND NOT EXISTS (SELECT 1 FROM match_scores m WHERE m.user_id = u.user_id AND m.posting_id = u.posting_id AND m.profile_version = ? AND m.rubric_version = ?) ORDER BY u.updated_at DESC LIMIT ?",
    scope.userId,
    options.profileVersion,
    options.rubricVersion ?? RUBRIC_VERSION,
    Math.min(options.limit ?? PROFILE_RESCORE_LIMIT, PROFILE_RESCORE_LIMIT)
  );
  return rows.map((row) => row.posting_id);
}

/** Lazily re-queues scoring after a profile change (07 §2.1, leaf-2.8). */
export async function enqueueProfileRescore(
  env: Pick<Env, "JOBS_AI_QUEUE">,
  db: JobsDb,
  scope: UserScope,
  options: { now: number; profileVersion: number; rubricVersion?: string }
): Promise<ScoreRequestResult> {
  const postingIds = await profileRescoreCandidates(db, scope, options);
  return await enqueueScoring(env, db, scope, { ...options, postingIds });
}
