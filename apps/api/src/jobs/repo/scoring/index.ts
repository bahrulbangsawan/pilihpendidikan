// JOBS_DB access of scoring (07): profile inputs, postings to score, the
// `match_scores` writes of the consumer and the reads of `GET /scores`.
// Every statement is scoped by `user_id` (T11-SQL); postings are only read
// through the user's own `user_jobs` link, so a user can never score (or
// learn about) a posting they do not track.

import type { MatchScoreRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import type { PostingForScoring } from "../../services/scoring/features";
import type { JobsDb } from "../core/db";
import {
  decodeJson,
  decodeRow,
  GuardFailedError,
  guard,
  queryAll,
  queryFirst,
  runBatch,
  stmt,
} from "../core/db";
import { appendEvent } from "../core/events";

/** D1 binds at most 100 parameters per statement. */
const IN_CHUNK = 80;
const YEARS_PREFIX = "years_experience.";

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

// ---------------------------------------------------------------------------
// Profile inputs (07 §2.1)
// ---------------------------------------------------------------------------

export interface ProfileInputs {
  facts: Array<{ key: string; value: unknown }>;
  yearsAnswers: Array<{ answer: string; question_key: string }>;
}

/** The user's facts (parsed) and `years_experience.*` answers. */
export async function loadProfileInputs(
  db: JobsDb,
  scope: UserScope
): Promise<ProfileInputs> {
  const facts = await queryAll<{ key: string; value: string }>(
    db,
    "SELECT key, value FROM applicant_facts WHERE user_id = ? ORDER BY key",
    scope.userId
  );
  const answers = await queryAll<{ answer: string; question_key: string }>(
    db,
    "SELECT question_key, answer FROM screening_answers WHERE user_id = ? AND question_key LIKE 'years_experience.%' ORDER BY question_key",
    scope.userId
  );
  return {
    facts: facts.map((fact) => ({
      key: fact.key,
      value: decodeJson<unknown>(fact.value, null),
    })),
    yearsAnswers: answers.filter((answer) =>
      answer.question_key.startsWith(YEARS_PREFIX)
    ),
  };
}

// ---------------------------------------------------------------------------
// Postings and score rows
// ---------------------------------------------------------------------------

const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function locationList(value: unknown): PostingForScoring["locations"] {
  return Array.isArray(value)
    ? (value as PostingForScoring["locations"]).filter(
        (location) => typeof location?.raw === "string"
      )
    : [];
}

function toPosting(row: Record<string, unknown>): PostingForScoring {
  const posting = decodeRow<Record<string, unknown>>("job_postings", row);
  const salary = posting.salary;
  return {
    id: String(posting.id),
    revision: Number(posting.revision ?? 1),
    title: text(posting.title) ?? "",
    department: text(posting.department),
    seniority: text(posting.seniority),
    locations: locationList(posting.locations),
    workplace_type: text(posting.workplace_type),
    employment_type: text(posting.employment_type),
    salary:
      salary && typeof salary === "object"
        ? (salary as PostingForScoring["salary"])
        : null,
    requirements: stringList(posting.requirements),
    description_text: text(posting.description_text) ?? "",
    posted_at: typeof posting.posted_at === "number" ? posting.posted_at : null,
    first_seen_at: Number(posting.first_seen_at ?? 0),
  };
}

/** The postings among `postingIds` that the user tracks, decoded. */
export async function loadPostingsForScoring(
  db: JobsDb,
  scope: UserScope,
  postingIds: readonly string[]
): Promise<PostingForScoring[]> {
  const out: PostingForScoring[] = [];
  for (const group of chunk([...new Set(postingIds)], IN_CHUNK)) {
    const rows = await queryAll<Record<string, unknown>>(
      db,
      `SELECT p.id, p.revision, p.title, p.department, p.seniority, p.locations, p.workplace_type, p.employment_type, p.salary, p.requirements, p.description_text, p.posted_at, p.first_seen_at FROM job_postings p JOIN user_jobs u ON u.posting_id = p.id WHERE u.user_id = ? AND p.id IN (${marks(group.length)})`,
      scope.userId,
      ...group
    );
    out.push(...rows.map(toPosting));
  }
  return out;
}

export interface ScoreKey {
  profileVersion: number;
  rubricVersion: string;
}

/** `status` of the user's score rows for these postings at one key. */
export async function scoreStatuses(
  db: JobsDb,
  scope: UserScope,
  postingIds: readonly string[],
  key: ScoreKey
): Promise<Map<string, "queued" | "ready" | "failed">> {
  const statuses = new Map<string, "queued" | "ready" | "failed">();
  for (const group of chunk([...new Set(postingIds)], IN_CHUNK)) {
    const rows = await queryAll<{
      posting_id: string;
      status: "queued" | "ready" | "failed";
    }>(
      db,
      `SELECT posting_id, status FROM match_scores WHERE user_id = ? AND profile_version = ? AND rubric_version = ? AND posting_id IN (${marks(group.length)})`,
      scope.userId,
      key.profileVersion,
      key.rubricVersion,
      ...group
    );
    for (const row of rows) {
      statuses.set(row.posting_id, row.status);
    }
  }
  return statuses;
}

export interface ReadyScore extends ScoreKey {
  components: unknown;
  confidence: number | null;
  explanation: string;
  id: string;
  model: string;
  now: number;
  postingId: string;
  score: number;
}

/**
 * The write of one ready score (07 §7.2): a guard that the row is not ready
 * yet (a redelivered message must not write twice nor count its usage
 * twice, T7-07), the upsert (the placeholder, or a fresh row when none
 * exists) and its change_log row. Append the usage statements to the same
 * batch and run it with `commitScore`.
 */
export function readyScoreStatements(
  db: JobsDb,
  scope: UserScope,
  row: ReadyScore
): D1PreparedStatement[] {
  return [
    guard(
      db,
      `score-not-ready:${row.postingId}`,
      "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM match_scores WHERE user_id = ? AND posting_id = ? AND profile_version = ? AND rubric_version = ? AND status = 'ready')",
      scope.userId,
      row.postingId,
      row.profileVersion,
      row.rubricVersion
    ),
    stmt(
      db,
      "INSERT INTO match_scores (id, user_id, posting_id, profile_version, rubric_version, model, score, confidence, components, explanation, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?) ON CONFLICT(user_id, posting_id, profile_version, rubric_version) DO UPDATE SET model = excluded.model, score = excluded.score, confidence = excluded.confidence, components = excluded.components, explanation = excluded.explanation, status = 'ready', created_at = excluded.created_at WHERE match_scores.status != 'ready'",
      row.id,
      scope.userId,
      row.postingId,
      row.profileVersion,
      row.rubricVersion,
      row.model,
      row.score,
      row.confidence,
      JSON.stringify(row.components),
      row.explanation,
      row.now
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'score', id, 1, 'upsert', ? FROM match_scores WHERE user_id = ? AND posting_id = ? AND profile_version = ? AND rubric_version = ?",
      row.now,
      scope.userId,
      row.postingId,
      row.profileVersion,
      row.rubricVersion
    ),
  ];
}

/** Runs a score batch; "already_ready" when another delivery won (nothing written). */
export async function commitScore(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<"written" | "already_ready"> {
  try {
    await runBatch(db, statements);
    return "written";
  } catch (err) {
    if (err instanceof GuardFailedError) {
      return "already_ready";
    }
    throw err;
  }
}

/**
 * Removes `queued` placeholders of an outdated profile version (the profile
 * changed before the consumer ran; the new version is scored instead).
 */
export async function deleteQueuedPlaceholders(
  db: JobsDb,
  scope: UserScope,
  postingIds: readonly string[],
  key: ScoreKey
): Promise<void> {
  const statements = chunk([...new Set(postingIds)], IN_CHUNK).map((group) =>
    stmt(
      db,
      `DELETE FROM match_scores WHERE user_id = ? AND profile_version = ? AND rubric_version = ? AND status = 'queued' AND posting_id IN (${marks(group.length)})`,
      scope.userId,
      key.profileVersion,
      key.rubricVersion,
      ...group
    )
  );
  await runBatch(db, statements);
}

/** The user's score row of one posting at one key (any status). */
export async function findScore(
  db: JobsDb,
  scope: UserScope,
  postingId: string,
  key: ScoreKey
): Promise<MatchScoreRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT id, user_id, posting_id, profile_version, rubric_version, model, score, confidence, components, explanation, status, created_at FROM match_scores WHERE user_id = ? AND posting_id = ? AND profile_version = ? AND rubric_version = ?",
    scope.userId,
    postingId,
    key.profileVersion,
    key.rubricVersion
  );
  return row ? decodeRow<MatchScoreRecord>("match_scores", row) : null;
}

/** True when the user tracks the posting (`user_jobs`). */
export async function isPostingTracked(
  db: JobsDb,
  scope: UserScope,
  postingId: string
): Promise<boolean> {
  const row = await queryFirst<{ one: number }>(
    db,
    "SELECT 1 AS one FROM user_jobs WHERE user_id = ? AND posting_id = ?",
    scope.userId,
    postingId
  );
  return row !== null;
}

/** Posting ids of the user's own `user_jobs` among `userJobIds`. */
export async function postingIdsOfUserJobs(
  db: JobsDb,
  scope: UserScope,
  userJobIds: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const group of chunk([...new Set(userJobIds)], IN_CHUNK)) {
    const rows = await queryAll<{ id: string; posting_id: string }>(
      db,
      `SELECT id, posting_id FROM user_jobs WHERE user_id = ? AND id IN (${marks(group.length)})`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      out.set(row.id, row.posting_id);
    }
  }
  return out;
}

/** Postings among `postingIds` that the user tracks. */
export async function trackedPostingIds(
  db: JobsDb,
  scope: UserScope,
  postingIds: readonly string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const group of chunk([...new Set(postingIds)], IN_CHUNK)) {
    const rows = await queryAll<{ posting_id: string }>(
      db,
      `SELECT posting_id FROM user_jobs WHERE user_id = ? AND posting_id IN (${marks(group.length)})`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      out.add(row.posting_id);
    }
  }
  return out;
}

/** True when the user has at least one enabled automation rule (07 §10). */
export async function hasEnabledRules(
  db: JobsDb,
  scope: UserScope
): Promise<boolean> {
  const row = await queryFirst<{ one: number }>(
    db,
    "SELECT 1 AS one FROM automation_rules WHERE user_id = ? AND enabled = 1 LIMIT 1",
    scope.userId
  );
  return row !== null;
}

// ---------------------------------------------------------------------------
// Dead letters (14 §6)
// ---------------------------------------------------------------------------

/** The variant a dead `tailor_cv` message points at (owned), or null. */
export async function findTailorVariant(
  db: JobsDb,
  scope: UserScope,
  cvVariantId: string
): Promise<{ application_id: string | null; status: string } | null> {
  return await queryFirst<{ application_id: string | null; status: string }>(
    db,
    "SELECT application_id, status FROM cv_variants WHERE id = ? AND user_id = ?",
    cvVariantId,
    scope.userId
  );
}

/**
 * The timeline notice of a dead `tailor_cv` message (14 §6): a
 * `conflict_recorded` event on the variant's application, idempotent per
 * variant. Hand these to the CV area's `failCvVariant` as `extra`, so they
 * commit with the status change or not at all.
 */
export function tailorDeadLetterEventStatements(
  db: JobsDb,
  scope: UserScope,
  input: { applicationId: string; cvVariantId: string; now: number }
): D1PreparedStatement[] {
  return appendEvent(
    db,
    scope,
    {
      applicationId: input.applicationId,
      type: "conflict_recorded",
      actorKind: "system",
      appliedToState: true,
      idempotencyKey: `dlq:tailor_cv:${input.cvVariantId}`,
      payload: {
        attempted: "tailor_cv",
        current: "failed",
        reason: "tailoring_retries_exhausted",
        cv_variant_id: input.cvVariantId,
      },
    },
    input.now
  ).statements;
}
