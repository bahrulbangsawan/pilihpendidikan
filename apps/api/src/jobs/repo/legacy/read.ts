// Reads of the legacy facade (06 §12.6, leaf-2.10): one application with its
// posting and pending interviews, addressed by the legacy URL key (the
// application's `legacy_job_id`, else its `app_` id), and the full keyset
// listing behind `/api/jobs` and `jobs_list` (no 1,000 cap, T6-14).
//
// Postings are read only through the caller's user_jobs (11 §6.1 rule 4).

import type {
  LegacyApplicationView,
  LegacyInterviewView,
  LegacyPostingView,
  LegacySalary,
  LegacyView,
} from "../../legacy/mapping";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../core/db";
import { decodeJson, fromSqlBool, queryAll, queryFirst } from "../core/db";

const APP_ID_RE = /^app_[0-9A-HJKMNP-TV-Z]{26}$/;

interface ViewRow {
  a_created_at: number;
  a_id: string;
  a_revision: number;
  a_updated_at: number;
  archived: number;
  canonical_url: string | null;
  company_domain: string | null;
  company_name: string;
  description_text: string;
  follow_up_at: number | null;
  last_change_source: LegacyApplicationView["last_change_source"];
  legacy_job_id: string | null;
  owner_user_id: string | null;
  p_id: string;
  p_revision: number;
  requirements: string;
  salary: string | null;
  sections: string;
  source_kind: string;
  stage: LegacyApplicationView["stage"];
  submission_status: LegacyApplicationView["submission_status"];
  title: string;
  user_job_id: string;
  visibility: "public" | "private";
}

/** The view SELECT (append a `WHERE a.user_id = ? …` clause). */
export const LEGACY_VIEW_SELECT = `SELECT a.id AS a_id, a.legacy_job_id, a.user_job_id, a.stage, a.submission_status, a.archived, a.follow_up_at, a.sections, a.last_change_source, a.revision AS a_revision, a.created_at AS a_created_at, a.updated_at AS a_updated_at,
  p.id AS p_id, p.visibility, p.owner_user_id, p.source_kind, p.title, p.company_name, p.company_domain, p.canonical_url, p.salary, p.description_text, p.requirements, p.revision AS p_revision
FROM applications a
JOIN user_jobs u ON u.id = a.user_job_id AND u.user_id = a.user_id
JOIN job_postings p ON p.id = u.posting_id`;

/** The live application of a legacy id (scripts run it over D1 REST). */
export const LEGACY_VIEW_BY_ID_SQL = `${LEGACY_VIEW_SELECT} WHERE a.user_id = ? AND a.legacy_job_id = ? AND a.archived = 0`;

/** Pending interviews, dated ones first (earliest first). */
export const PENDING_INTERVIEWS_SQL =
  "SELECT id, round, scheduled_at, timezone, revision FROM interviews WHERE user_id = ? AND application_id = ? AND outcome = 'pending' ORDER BY scheduled_at IS NULL, scheduled_at, round, id";

export type LegacyViewRow = ViewRow;

function postingOf(row: ViewRow): LegacyPostingView {
  return {
    id: row.p_id,
    visibility: row.visibility,
    owner_user_id: row.owner_user_id,
    source_kind: row.source_kind,
    title: row.title,
    company_name: row.company_name,
    company_domain: row.company_domain,
    canonical_url: row.canonical_url,
    salary: decodeJson<LegacySalary | null>(row.salary, null),
    description_text: row.description_text,
    requirements: decodeJson<string[]>(row.requirements, []),
    revision: row.p_revision,
  };
}

function applicationOf(row: ViewRow): LegacyApplicationView {
  return {
    id: row.a_id,
    legacy_job_id: row.legacy_job_id,
    user_job_id: row.user_job_id,
    stage: row.stage,
    submission_status: row.submission_status,
    archived: fromSqlBool(row.archived),
    follow_up_at: row.follow_up_at,
    sections: decodeJson(row.sections, []),
    last_change_source: row.last_change_source,
    revision: row.a_revision,
    created_at: row.a_created_at,
    updated_at: row.a_updated_at,
  };
}

/** The facade view of a view row and its pending interviews. */
export function legacyViewOf(
  row: LegacyViewRow,
  interviews: LegacyInterviewView[]
): LegacyView {
  return {
    application: applicationOf(row),
    posting: postingOf(row),
    interviews,
  };
}

/** Pending interviews of an application, dated ones first (earliest first). */
export async function pendingInterviews(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<LegacyInterviewView[]> {
  return await queryAll<LegacyInterviewView>(
    db,
    PENDING_INTERVIEWS_SQL,
    scope.userId,
    applicationId
  );
}

/** Highest interview round of an application (0 when none). */
export async function lastInterviewRound(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<number> {
  const row = await queryFirst<{ round: number | null }>(
    db,
    "SELECT MAX(round) AS round FROM interviews WHERE user_id = ? AND application_id = ?",
    scope.userId,
    applicationId
  );
  return row?.round ?? 0;
}

async function viewOf(
  db: JobsDb,
  scope: UserScope,
  row: ViewRow | null
): Promise<LegacyView | null> {
  if (!row) {
    return null;
  }
  return legacyViewOf(row, await pendingInterviews(db, scope, row.a_id));
}

/**
 * The caller's live (non-archived) application addressed by `key`: its
 * `legacy_job_id`, else (for an `app_` id) its id. Null = not found or not
 * owned (the same answer, 11 §6.1 rule 3).
 */
export async function findLegacyView(
  db: JobsDb,
  scope: UserScope,
  key: string
): Promise<LegacyView | null> {
  const byLegacy = await queryFirst<ViewRow>(
    db,
    LEGACY_VIEW_BY_ID_SQL,
    scope.userId,
    key
  );
  if (byLegacy || !APP_ID_RE.test(key)) {
    return await viewOf(db, scope, byLegacy);
  }
  const byId = await queryFirst<ViewRow>(
    db,
    `${LEGACY_VIEW_SELECT} WHERE a.user_id = ? AND a.id = ? AND a.archived = 0`,
    scope.userId,
    key
  );
  return await viewOf(db, scope, byId);
}

/**
 * The application holding `legacyId` for the caller, archived or not (an
 * archived row is the tombstone of a deleted legacy job), or null.
 */
export async function legacyIdHolder(
  db: JobsDb,
  scope: UserScope,
  legacyId: string
): Promise<{ archived: boolean; id: string; revision: number } | null> {
  const row = await queryFirst<{
    archived: number;
    id: string;
    revision: number;
  }>(
    db,
    "SELECT id, archived, revision FROM applications WHERE user_id = ? AND legacy_job_id = ?",
    scope.userId,
    legacyId
  );
  return row
    ? {
        id: row.id,
        archived: fromSqlBool(row.archived),
        revision: row.revision,
      }
    : null;
}

/** One row of the facade listing (enough for `/api/jobs` and `jobs_list`). */
export interface LegacyListRow {
  company_name: string;
  id: string;
  legacy_job_id: string | null;
  next_interview_at: number | null;
  next_interview_tz: string | null;
  source_kind: string;
  stage: LegacyApplicationView["stage"];
  title: string;
  updated_at: number;
}

/** Page size of the full listing (keyset on `applications.id`). */
export const LEGACY_LIST_PAGE = 500;

/**
 * Every live application of the caller, `pageSize` rows per query, keyset on
 * the primary key: no cap on the total (T6-14).
 */
export async function listLegacyRows(
  db: JobsDb,
  scope: UserScope,
  pageSize: number = LEGACY_LIST_PAGE
): Promise<LegacyListRow[]> {
  const rows: LegacyListRow[] = [];
  let after = "";
  for (;;) {
    const page = await queryAll<LegacyListRow>(
      db,
      `SELECT a.id, a.legacy_job_id, a.stage, a.updated_at, p.title, p.company_name, p.source_kind,
  (SELECT i.scheduled_at FROM interviews i WHERE i.user_id = a.user_id AND i.application_id = a.id AND i.outcome = 'pending' AND i.scheduled_at IS NOT NULL ORDER BY i.scheduled_at, i.round, i.id LIMIT 1) AS next_interview_at,
  (SELECT i.timezone FROM interviews i WHERE i.user_id = a.user_id AND i.application_id = a.id AND i.outcome = 'pending' AND i.scheduled_at IS NOT NULL ORDER BY i.scheduled_at, i.round, i.id LIMIT 1) AS next_interview_tz
FROM applications a
JOIN user_jobs u ON u.id = a.user_job_id AND u.user_id = a.user_id
JOIN job_postings p ON p.id = u.posting_id
WHERE a.user_id = ? AND a.archived = 0 AND a.id > ?
ORDER BY a.id LIMIT ?`,
      scope.userId,
      after,
      pageSize
    );
    rows.push(...page);
    const last = page.at(-1);
    if (page.length < pageSize || !last) {
      return rows;
    }
    after = last.id;
  }
}
