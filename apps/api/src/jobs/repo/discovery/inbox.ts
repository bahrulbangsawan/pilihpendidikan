// The discovery inbox and tracked jobs (05 §4, 12 §4, 15 §11).
//
// Postings are only ever reached through the caller's `user_jobs` (11 §6.1
// rule 4). Cross-source duplicates share a `dedupe_group`; the inbox lists
// one representative per group — ranked by inbox state (tracked, then
// dismissed: a group the user already handled stays handled), then official
// API sources, then the newest `last_seen_at` (15 §11) — and reports how many
// other linked postings the group has.

import type {
  ApplicationRecord,
  MatchScoreRecord,
  UserJobRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { STABLE_SOURCE_KINDS } from "@pilihpendidikan/jobs-contracts/enums";
import type { CursorKey } from "../../core/pagination";
import { keysetAfter } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { decodeRow, guard, queryAll, queryFirst, stmt } from "../core/db";
import { chunk, IN_CHUNK, likePattern, marks } from "./sql";

const STABLE_KIND_LIST = STABLE_SOURCE_KINDS.map((kind) => `'${kind}'`).join(
  ", "
);
const RANK_U = `(CASE u.inbox_state WHEN 'tracked' THEN 2 WHEN 'dismissed' THEN 1 ELSE 0 END), (CASE WHEN p.source_kind IN (${STABLE_KIND_LIST}) THEN 1 ELSE 0 END), p.last_seen_at, p.id`;
const RANK_U2 = `(CASE u2.inbox_state WHEN 'tracked' THEN 2 WHEN 'dismissed' THEN 1 ELSE 0 END), (CASE WHEN p2.source_kind IN (${STABLE_KIND_LIST}) THEN 1 ELSE 0 END), p2.last_seen_at, p2.id`;
const REPRESENTATIVE = `(p.dedupe_group IS NULL OR NOT EXISTS (SELECT 1 FROM user_jobs u2 JOIN job_postings p2 ON p2.id = u2.posting_id WHERE u2.user_id = u.user_id AND p2.dedupe_group = p.dedupe_group AND u2.id <> u.id AND (${RANK_U2}) > (${RANK_U})))`;

export interface InboxFilter {
  cursor: CursorKey | null;
  limit: number;
  minScore: number | null;
  profileVersion: number;
  q: string | null;
  rubricVersion: string;
  /** A `src_…` id or a source kind. */
  source: string | null;
  states: readonly string[];
}

export interface InboxRow {
  created_at: number;
  id: string;
  posting_id: string;
}

/** One page of inbox user_job ids (limit + 1 rows), newest first. */
export async function listInboxIds(
  db: JobsDb,
  scope: UserScope,
  filter: InboxFilter
): Promise<InboxRow[]> {
  const where: string[] = [`u.inbox_state IN (${marks(filter.states.length)})`];
  const binds: unknown[] = [...filter.states];
  let join = "";
  const joinBinds: unknown[] = [];
  if (filter.minScore !== null) {
    join =
      " JOIN match_scores s ON s.user_id = u.user_id AND s.posting_id = u.posting_id AND s.profile_version = ? AND s.rubric_version = ?";
    joinBinds.push(filter.profileVersion, filter.rubricVersion);
    where.push("s.status = 'ready' AND s.score >= ?");
    binds.push(filter.minScore);
  }
  if (filter.source?.startsWith("src_")) {
    where.push("u.source_id = ?");
    binds.push(filter.source);
  } else if (filter.source) {
    where.push("p.source_kind = ?");
    binds.push(filter.source);
  }
  if (filter.q) {
    where.push(
      "(p.title LIKE ? ESCAPE '\\' OR p.company_name LIKE ? ESCAPE '\\')"
    );
    binds.push(likePattern(filter.q), likePattern(filter.q));
  }
  where.push(REPRESENTATIVE);
  const after = keysetAfter(["u.created_at", "u.id"], filter.cursor, "desc");
  if (after.sql) {
    where.push(after.sql);
    binds.push(...after.binds);
  }
  return await queryAll<InboxRow>(
    db,
    `SELECT u.id, u.created_at, u.posting_id FROM user_jobs u JOIN job_postings p ON p.id = u.posting_id${join} WHERE u.user_id = ? AND ${where.join(" AND ")} ORDER BY u.created_at DESC, u.id DESC LIMIT ?`,
    ...joinBinds,
    scope.userId,
    ...binds,
    filter.limit + 1
  );
}

/** The caller's user_jobs by id. */
export async function getUserJobs(
  db: JobsDb,
  scope: UserScope,
  ids: readonly string[]
): Promise<Map<string, UserJobRecord>> {
  const out = new Map<string, UserJobRecord>();
  for (const group of chunk([...new Set(ids)], IN_CHUNK)) {
    const rows = await queryAll<Record<string, unknown>>(
      db,
      `SELECT * FROM user_jobs WHERE user_id = ? AND id IN (${marks(group.length)})`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      const record = decodeRow<UserJobRecord>("user_jobs", row);
      out.set(record.id, record);
    }
  }
  return out;
}

export async function getUserJob(
  db: JobsDb,
  scope: UserScope,
  id: string
): Promise<UserJobRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM user_jobs WHERE id = ? AND user_id = ?",
    id,
    scope.userId
  );
  return row ? decodeRow<UserJobRecord>("user_jobs", row) : null;
}

/** The caller's link to one posting, if any. */
export async function getUserJobByPosting(
  db: JobsDb,
  scope: UserScope,
  postingId: string
): Promise<UserJobRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM user_jobs WHERE user_id = ? AND posting_id = ?",
    scope.userId,
    postingId
  );
  return row ? decodeRow<UserJobRecord>("user_jobs", row) : null;
}

/** Current-version score rows of postings (any status), keyed by posting. */
export async function scoresFor(
  db: JobsDb,
  scope: UserScope,
  postingIds: readonly string[],
  version: { profileVersion: number; rubricVersion: string }
): Promise<Map<string, MatchScoreRecord>> {
  const out = new Map<string, MatchScoreRecord>();
  for (const group of chunk([...new Set(postingIds)], IN_CHUNK)) {
    const rows = await queryAll<Record<string, unknown>>(
      db,
      `SELECT * FROM match_scores WHERE user_id = ? AND profile_version = ? AND rubric_version = ? AND posting_id IN (${marks(group.length)})`,
      scope.userId,
      version.profileVersion,
      version.rubricVersion,
      ...group
    );
    for (const row of rows) {
      const record = decodeRow<MatchScoreRecord>("match_scores", row);
      out.set(record.posting_id, record);
    }
  }
  return out;
}

/**
 * The score to show for one posting: the current profile version's row, or
 * else the newest `ready` row of an older version.
 */
export async function latestScore(
  db: JobsDb,
  scope: UserScope,
  postingId: string,
  version: { profileVersion: number; rubricVersion: string }
): Promise<MatchScoreRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM match_scores WHERE user_id = ? AND posting_id = ? AND ((profile_version = ? AND rubric_version = ?) OR status = 'ready') ORDER BY (profile_version = ? AND rubric_version = ?) DESC, created_at DESC LIMIT 1",
    scope.userId,
    postingId,
    version.profileVersion,
    version.rubricVersion,
    version.profileVersion,
    version.rubricVersion
  );
  return row ? decodeRow<MatchScoreRecord>("match_scores", row) : null;
}

/** Number of the caller's linked postings per dedupe group. */
export async function groupSizes(
  db: JobsDb,
  scope: UserScope,
  groups: readonly string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const group of chunk([...new Set(groups)], IN_CHUNK)) {
    const rows = await queryAll<{ dedupe_group: string; n: number }>(
      db,
      `SELECT p.dedupe_group, count(*) AS n FROM user_jobs u JOIN job_postings p ON p.id = u.posting_id WHERE u.user_id = ? AND p.dedupe_group IN (${marks(group.length)}) GROUP BY p.dedupe_group`,
      scope.userId,
      ...group
    );
    for (const row of rows) {
      out.set(row.dedupe_group, row.n);
    }
  }
  return out;
}

/** The application created from a user_job, if any. */
export async function applicationForUserJob(
  db: JobsDb,
  scope: UserScope,
  userJobId: string
): Promise<ApplicationRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM applications WHERE user_id = ? AND user_job_id = ?",
    scope.userId,
    userJobId
  );
  return row ? decodeRow<ApplicationRecord>("applications", row) : null;
}

/**
 * Moves `ids` (all currently in one of `from`) to `to`: per chunk a guard
 * (every id still in `from`, else the service re-plans), the UPDATE and the
 * change_log rows (20 §6.2: bulk inbox actions apply per id).
 */
export function inboxStateStatements(
  db: JobsDb,
  scope: UserScope,
  change: { from: readonly string[]; ids: readonly string[]; to: string },
  now: number
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const fromList = marks(change.from.length);
  for (const group of chunk(change.ids, IN_CHUNK - change.from.length)) {
    const idList = marks(group.length);
    statements.push(
      guard(
        db,
        `inbox:${group[0]}`,
        `SELECT 1 FROM (SELECT count(*) AS n FROM user_jobs WHERE user_id = ? AND id IN (${idList}) AND inbox_state IN (${fromList})) WHERE n = ?`,
        scope.userId,
        ...group,
        ...change.from,
        group.length
      ),
      stmt(
        db,
        `UPDATE user_jobs SET inbox_state = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND id IN (${idList}) AND inbox_state IN (${fromList})`,
        change.to,
        now,
        scope.userId,
        ...group,
        ...change.from
      ),
      stmt(
        db,
        `INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'user_job', id, revision, 'upsert', ? FROM user_jobs WHERE user_id = ? AND id IN (${idList})`,
        now,
        scope.userId,
        ...group
      )
    );
  }
  return statements;
}

/** `user_settings.default_mode` without creating the row (03 §5.3). */
export async function defaultModeOf(
  db: JobsDb,
  scope: UserScope
): Promise<string | null> {
  const row = await queryFirst<{ default_mode: string }>(
    db,
    "SELECT default_mode FROM user_settings WHERE user_id = ?",
    scope.userId
  );
  return row?.default_mode ?? null;
}
