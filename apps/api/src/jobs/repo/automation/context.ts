// Reads behind the claim context bundle (21 §5.1, 19 §2) and the rule
// engine (07 §10, 19 §8.3, §10): the application's posting, its CV variant
// file, the discovery sources of a discover task, tracked postings with
// their applications and scores.
//
// Postings are shared rows (public visibility): they are always reached
// through the caller's own `user_jobs` row, never by bare id.

import type {
  ApplicationRecord,
  JobPostingRecord,
  JobSourceRecord,
  MatchScoreRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { decodeRow, queryAll, queryFirst } from "../core/db";
import type { Row } from "./records";
import { placeholders } from "./records";

/** The posting behind a user's tracked job. */
export async function postingOfUserJob(
  db: JobsDb,
  scope: UserScope,
  userJobId: string
): Promise<JobPostingRecord | null> {
  const row = await queryFirst<Row>(
    db,
    "SELECT p.* FROM user_jobs u JOIN job_postings p ON p.id = u.posting_id WHERE u.id = ? AND u.user_id = ?",
    userJobId,
    scope.userId
  );
  return row ? decodeRow<JobPostingRecord>("job_postings", row) : null;
}

export interface VariantFile {
  cv_variant_id: string;
  file_id: string | null;
  file_status: string | null;
  sha256: string | null;
  status: string;
}

/** A CV variant and its rendered PDF (if any). */
export async function variantFile(
  db: JobsDb,
  scope: UserScope,
  cvVariantId: string
): Promise<VariantFile | null> {
  return await queryFirst<VariantFile>(
    db,
    "SELECT v.id AS cv_variant_id, v.status AS status, v.file_id AS file_id, f.sha256 AS sha256, f.status AS file_status FROM cv_variants v LEFT JOIN files f ON f.id = v.file_id AND f.user_id = v.user_id WHERE v.id = ? AND v.user_id = ?",
    cvVariantId,
    scope.userId
  );
}

/** A CV variant's application (render_cv tasks), or null when not the user's. */
export async function variantApplication(
  db: JobsDb,
  scope: UserScope,
  cvVariantId: string
): Promise<{ application_id: string | null; id: string } | null> {
  return await queryFirst<{ application_id: string | null; id: string }>(
    db,
    "SELECT id, application_id FROM cv_variants WHERE id = ? AND user_id = ?",
    cvVariantId,
    scope.userId
  );
}

/** Discovery sources of a discover task (or every enabled one). */
export async function sourcesFor(
  db: JobsDb,
  scope: UserScope,
  sourceIds: readonly string[] | null
): Promise<JobSourceRecord[]> {
  const rows =
    sourceIds && sourceIds.length > 0
      ? await queryAll<Row>(
          db,
          `SELECT * FROM job_sources WHERE user_id = ? AND id IN (${placeholders(sourceIds.length)}) ORDER BY created_at`,
          scope.userId,
          ...sourceIds
        )
      : await queryAll<Row>(
          db,
          "SELECT * FROM job_sources WHERE user_id = ? AND enabled = 1 ORDER BY created_at",
          scope.userId
        );
  return rows.map((row) => decodeRow<JobSourceRecord>("job_sources", row));
}

export interface TrackedPosting {
  posting: JobPostingRecord;
  source_id: string | null;
  user_job_id: string;
}

/** Postings the user tracks among `postingIds` (≤ 90 per call). */
export async function trackedPostings(
  db: JobsDb,
  scope: UserScope,
  postingIds: readonly string[]
): Promise<TrackedPosting[]> {
  if (postingIds.length === 0) {
    return [];
  }
  const rows = await queryAll<Row>(
    db,
    `SELECT u.id AS uj_id, u.source_id AS uj_source_id, p.* FROM user_jobs u JOIN job_postings p ON p.id = u.posting_id WHERE u.user_id = ? AND u.posting_id IN (${placeholders(postingIds.length)})`,
    scope.userId,
    ...postingIds
  );
  return rows.map((row) => {
    const { uj_id, uj_source_id, ...posting } = row;
    return {
      user_job_id: uj_id as string,
      source_id: (uj_source_id as string | null) ?? null,
      posting: decodeRow<JobPostingRecord>("job_postings", posting),
    };
  });
}

/** The applications of some tracked jobs (user_job_id → application). */
export async function applicationsOfUserJobs(
  db: JobsDb,
  scope: UserScope,
  userJobIds: readonly string[]
): Promise<Map<string, ApplicationRecord>> {
  if (userJobIds.length === 0) {
    return new Map();
  }
  const rows = await queryAll<Row>(
    db,
    `SELECT * FROM applications WHERE user_id = ? AND user_job_id IN (${placeholders(userJobIds.length)})`,
    scope.userId,
    ...userJobIds
  );
  const map = new Map<string, ApplicationRecord>();
  for (const row of rows) {
    const app = decodeRow<ApplicationRecord>("applications", row);
    map.set(app.user_job_id, app);
  }
  return map;
}

/** Score rows of the CURRENT profile version (07 §10), any status. */
export async function scoresFor(
  db: JobsDb,
  scope: UserScope,
  input: {
    postingIds: readonly string[];
    profileVersion: number;
    rubricVersion: string;
  }
): Promise<Map<string, MatchScoreRecord>> {
  if (input.postingIds.length === 0) {
    return new Map();
  }
  const rows = await queryAll<Row>(
    db,
    `SELECT * FROM match_scores WHERE user_id = ? AND profile_version = ? AND rubric_version = ? AND posting_id IN (${placeholders(input.postingIds.length)})`,
    scope.userId,
    input.profileVersion,
    input.rubricVersion,
    ...input.postingIds
  );
  return new Map(
    rows.map((row) => {
      const score = decodeRow<MatchScoreRecord>("match_scores", row);
      return [score.posting_id, score] as const;
    })
  );
}

/**
 * True when another application of the user for the same job (same posting
 * dedupe group, i.e. a repost) is already applied or submitted (19 §10).
 */
export async function appliedInDedupeGroup(
  db: JobsDb,
  scope: UserScope,
  input: { applicationId: string | null; dedupeGroup: string }
): Promise<boolean> {
  const row = await queryFirst<{ one: number }>(
    db,
    "SELECT 1 AS one FROM applications a JOIN user_jobs u ON u.id = a.user_job_id AND u.user_id = a.user_id JOIN job_postings p ON p.id = u.posting_id WHERE a.user_id = ? AND p.dedupe_group = ? AND a.id <> ? AND (a.stage IN ('applied', 'interviewing', 'offer', 'accepted', 'rejected') OR a.submission_status IN ('submitted_verified', 'submitted_unverified', 'outcome_unknown')) LIMIT 1",
    scope.userId,
    input.dedupeGroup,
    input.applicationId ?? ""
  );
  return row !== null;
}

/** The user's primary base CV slug (fact `profile.primary_cv_id`, 03 §9). */
export async function primaryCvId(
  db: JobsDb,
  scope: UserScope
): Promise<string | null> {
  const row = await queryFirst<{ value: string }>(
    db,
    "SELECT value FROM applicant_facts WHERE user_id = ? AND key = 'profile.primary_cv_id'",
    scope.userId
  );
  if (!row) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(row.value);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
