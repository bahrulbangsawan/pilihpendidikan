// Writes of the legacy facade (06 §12.6, leaf-2.10), as statements for ONE
// batch (kernel rule 4). Application columns go through
// repo/applications `updateFieldsStatements`; this module adds what only the
// facade does:
//
//   - a private posting edited in place (revision-guarded);
//   - a PUBLIC posting forked into a private `manual` copy with the user's
//     user_job re-pointed at it ([DECISION] 06 §12.6: one user can never
//     mutate shared public data);
//   - the "next pending interview" behind the legacy `interviewDate`;
//   - the tombstone rename that frees a deleted (archived) legacy id when the
//     same id is created again;
//   - the 5 s stale guard of a legacy PUT (05 §14).

import type { ChangeSource } from "@pilihpendidikan/jobs-contracts/enums";
import type { PostingChanges } from "../../legacy/mapping";
import type { UserScope } from "../../core/scope";
import { appendChange, appendChangeFromRow } from "../core/change-log";
import type { JobsDb } from "../core/db";
import { encodeJson, guard, runBatch, sqlBool, stmt } from "../core/db";

function postingAssignments(
  changes: PostingChanges,
  contentHash: string
): { binds: unknown[]; sets: string[] } {
  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };
  if (changes.title !== undefined) {
    set("title", changes.title);
  }
  if (changes.company_name !== undefined) {
    set("company_name", changes.company_name);
  }
  if (changes.canonical_url !== undefined) {
    set("canonical_url", changes.canonical_url);
  }
  if (changes.company_domain !== undefined) {
    set("company_domain", changes.company_domain);
  }
  if (changes.salary !== undefined) {
    set("salary", changes.salary === null ? null : encodeJson(changes.salary));
  }
  if (changes.description_text !== undefined) {
    set("description_text", changes.description_text);
  }
  if (changes.description_truncated !== undefined) {
    set("description_truncated", sqlBool(changes.description_truncated));
  }
  if (changes.requirements !== undefined) {
    set("requirements", encodeJson(changes.requirements));
  }
  set("content_hash", contentHash);
  return { sets, binds };
}

/**
 * In-place edit of the caller's own private posting at `revision` (a
 * concurrent edit aborts the batch: `GuardFailedError`).
 */
export function updatePrivatePostingStatements(
  db: JobsDb,
  scope: UserScope,
  posting: { id: string; revision: number },
  changes: PostingChanges,
  contentHash: string,
  now: number
): D1PreparedStatement[] {
  const { sets, binds } = postingAssignments(changes, contentHash);
  return [
    guard(
      db,
      `legacy_posting:${posting.id}`,
      "SELECT 1 FROM job_postings WHERE id = ? AND owner_user_id = ? AND visibility = 'private' AND revision = ?",
      posting.id,
      scope.userId,
      posting.revision
    ),
    stmt(
      db,
      `UPDATE job_postings SET ${sets.join(", ")}, revision = revision + 1, updated_at = ? WHERE id = ? AND owner_user_id = ? AND visibility = 'private'`,
      ...binds,
      now,
      posting.id,
      scope.userId
    ),
    appendChange(db, scope, {
      entity: "posting",
      entityId: posting.id,
      revision: posting.revision + 1,
      now,
    }),
  ];
}

// Every job_postings column, in DDL order (04 §2.1).
const POSTING_COLUMNS = [
  "id",
  "fingerprint",
  "visibility",
  "owner_user_id",
  "source_kind",
  "source_org",
  "source_job_ref",
  "canonical_url",
  "apply_url",
  "apply_domain",
  "company_name",
  "company_domain",
  "title",
  "department",
  "locations",
  "workplace_type",
  "employment_type",
  "seniority",
  "salary",
  "description_text",
  "description_truncated",
  "requirements",
  "content_hash",
  "dedupe_group",
  "posted_at",
  "first_seen_at",
  "last_seen_at",
  "last_checked_at",
  "status",
  "closed_at",
  "missed_runs",
  "extraction",
  "application_support",
  "revision",
  "created_at",
  "updated_at",
] as const;

// Columns of the copy that never come from the public row.
const FORK_FIXED: Readonly<Record<string, string>> = {
  visibility: "'private'",
  source_kind: "'manual'",
  dedupe_group: "NULL",
  extraction: "'{}'",
  revision: "1",
};

/**
 * Forks a public posting the caller tracks into a private `manual` copy with
 * `changes` applied, and re-points the caller's user_job at it. The public
 * row is never written (T6-15). The INSERT copies only when the caller's
 * user_job still points at the public posting.
 */
export function forkPostingStatements(
  db: JobsDb,
  scope: UserScope,
  input: {
    changes: PostingChanges;
    contentHash: string;
    fingerprint: string;
    newPostingId: string;
    now: number;
    sourcePostingId: string;
    userJobId: string;
  }
): D1PreparedStatement[] {
  const { sets, binds } = postingAssignments(input.changes, input.contentHash);
  const overrides = new Map<string, unknown>(
    sets.map((assignment, i) => [
      assignment.slice(0, assignment.indexOf(" =")),
      binds[i],
    ])
  );
  overrides.set("id", input.newPostingId);
  overrides.set("fingerprint", input.fingerprint);
  overrides.set("owner_user_id", scope.userId);
  overrides.set("created_at", input.now);
  overrides.set("updated_at", input.now);
  const selectBinds: unknown[] = [];
  const select = POSTING_COLUMNS.map((column) => {
    const fixed = FORK_FIXED[column];
    if (fixed !== undefined) {
      return fixed;
    }
    if (overrides.has(column)) {
      selectBinds.push(overrides.get(column));
      return "?";
    }
    return `p.${column}`;
  });
  return [
    guard(
      db,
      `legacy_fork:${input.userJobId}`,
      "SELECT 1 FROM job_postings p JOIN user_jobs u ON u.posting_id = p.id WHERE p.id = ? AND p.visibility = 'public' AND u.id = ? AND u.user_id = ?",
      input.sourcePostingId,
      input.userJobId,
      scope.userId
    ),
    stmt(
      db,
      // sql-allow: public-posting — copies a public posting the caller tracks
      // (the EXISTS joins the caller's user_job) into a row they own
      `INSERT INTO job_postings (${POSTING_COLUMNS.join(", ")}) SELECT ${select.join(", ")} FROM job_postings p WHERE p.id = ? AND p.visibility = 'public' AND EXISTS (SELECT 1 FROM user_jobs u WHERE u.id = ? AND u.posting_id = p.id AND u.user_id = ?)`,
      ...selectBinds,
      input.sourcePostingId,
      input.userJobId,
      scope.userId
    ),
    stmt(
      db,
      "UPDATE user_jobs SET posting_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?",
      input.newPostingId,
      input.now,
      input.userJobId,
      scope.userId
    ),
    appendChange(db, scope, {
      entity: "posting",
      entityId: input.newPostingId,
      revision: 1,
      now: input.now,
    }),
    appendChangeFromRow(db, scope, {
      entity: "user_job",
      table: "user_jobs",
      id: input.userJobId,
      now: input.now,
    }),
  ];
}

/** Moves the caller's interview to `scheduledAt` (revision-guarded). */
export function rescheduleInterviewStatements(
  db: JobsDb,
  scope: UserScope,
  interview: { id: string; revision: number },
  scheduledAt: number,
  now: number
): D1PreparedStatement[] {
  return [
    guard(
      db,
      `legacy_interview:${interview.id}`,
      "SELECT 1 FROM interviews WHERE id = ? AND user_id = ? AND revision = ? AND outcome = 'pending'",
      interview.id,
      scope.userId,
      interview.revision
    ),
    stmt(
      db,
      "UPDATE interviews SET scheduled_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?",
      scheduledAt,
      now,
      interview.id,
      scope.userId
    ),
    appendChangeFromRow(db, scope, {
      entity: "interview",
      table: "interviews",
      id: interview.id,
      now,
    }),
  ];
}

/** Cancels the caller's pending interview (a cleared legacy `interviewDate`). */
export function cancelInterviewStatements(
  db: JobsDb,
  scope: UserScope,
  interview: { id: string; revision: number },
  now: number
): D1PreparedStatement[] {
  return [
    guard(
      db,
      `legacy_interview:${interview.id}`,
      "SELECT 1 FROM interviews WHERE id = ? AND user_id = ? AND revision = ? AND outcome = 'pending'",
      interview.id,
      scope.userId,
      interview.revision
    ),
    stmt(
      db,
      "UPDATE interviews SET outcome = 'cancelled', revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?",
      now,
      interview.id,
      scope.userId
    ),
    appendChangeFromRow(db, scope, {
      entity: "interview",
      table: "interviews",
      id: interview.id,
      now,
    }),
  ];
}

/** A new pending interview of kind `other` (a legacy `interviewDate`, 06 §12.2). */
export function insertInterviewStatements(
  db: JobsDb,
  scope: UserScope,
  input: {
    applicationId: string;
    id: string;
    now: number;
    round: number;
    scheduledAt: number;
  }
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO interviews (id, user_id, application_id, round, kind, scheduled_at, timezone, interviewers, outcome, notes, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 'other', ?, NULL, '[]', 'pending', '', 1, ?, ?)",
      input.id,
      scope.userId,
      input.applicationId,
      input.round,
      input.scheduledAt,
      input.now,
      input.now
    ),
    appendChange(db, scope, {
      entity: "interview",
      entityId: input.id,
      revision: 1,
      now: input.now,
    }),
  ];
}

/**
 * Frees a deleted legacy id for re-use: the archived application keeps its
 * history under `<legacy id>#archived:<app id>`.
 */
export function renameArchivedLegacyIdStatements(
  db: JobsDb,
  scope: UserScope,
  holder: { id: string; revision: number },
  legacyId: string,
  now: number
): D1PreparedStatement[] {
  return [
    guard(
      db,
      `legacy_tombstone:${holder.id}`,
      "SELECT 1 FROM applications WHERE id = ? AND user_id = ? AND archived = 1 AND revision = ?",
      holder.id,
      scope.userId,
      holder.revision
    ),
    stmt(
      db,
      "UPDATE applications SET legacy_job_id = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND archived = 1",
      `${legacyId}#archived:${holder.id}`,
      holder.id,
      scope.userId
    ),
    appendChangeFromRow(db, scope, {
      entity: "application",
      table: "applications",
      id: holder.id,
      now,
    }),
  ];
}

/** Legacy PUT stale guard (05 §14): no change from another source in the window. */
export const LEGACY_STALE_WINDOW_MS = 5000;

/**
 * Aborts the batch when the application changed less than 5 s ago from a
 * source other than `source` (race-safe twin of the facade's pre-check).
 */
export function staleGuardStatement(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  source: ChangeSource,
  now: number
): D1PreparedStatement {
  return guard(
    db,
    `legacy_stale:${applicationId}`,
    "SELECT 1 FROM applications WHERE id = ? AND user_id = ? AND NOT (updated_at > ? AND last_change_source != ?)",
    applicationId,
    scope.userId,
    now - LEGACY_STALE_WINDOW_MS,
    source
  );
}

/** Runs one facade batch (outside a route context). */
export async function commitLegacyBatch(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<void> {
  await runBatch(db, statements);
}
