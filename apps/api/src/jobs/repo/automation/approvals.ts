// `approvals` (04 §2.6, 03 §8): pending → approved | rejected | expired.
//
// First decision wins (20 §6.2): a decision is ONE batch led by a guard that
// the row is still `pending`, unexpired and bound to the presented
// `payload_hash`; a racing second decision aborts on that guard.

import type {
  ApprovalKind,
  ApprovalState,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { ApprovalRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { CursorKey, Page, PageRequest } from "../../core/pagination";
import { keysetAfter, pageOf } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import { appendChange, appendChangeFromRow } from "../core/change-log";
import type { JobsDb } from "../core/db";
import { encodeJson, guard, queryAll, queryFirst, stmt } from "../core/db";
import type { Row } from "./records";
import { toApproval } from "./records";

export async function loadApproval(
  db: JobsDb,
  scope: UserScope,
  approvalId: string
): Promise<ApprovalRecord | null> {
  const row = await queryFirst<Row>(
    db,
    "SELECT * FROM approvals WHERE id = ? AND user_id = ?",
    approvalId,
    scope.userId
  );
  return row ? toApproval(row) : null;
}

export interface ApprovalFilter {
  kind?: ApprovalKind;
  now: number;
  state?: ApprovalState;
}

/**
 * The approval queue (05 §8). `state=pending` lists only unexpired rows (an
 * expired-but-not-yet-reaped approval can no longer be decided).
 */
export async function listApprovals(
  db: JobsDb,
  scope: UserScope,
  filter: ApprovalFilter,
  page: PageRequest
): Promise<Page<ApprovalRecord>> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.state) {
    where.push("state = ?");
    binds.push(filter.state);
    if (filter.state === "pending") {
      where.push("expires_at > ?");
      binds.push(filter.now);
    }
  }
  if (filter.kind) {
    where.push("kind = ?");
    binds.push(filter.kind);
  }
  const after = keysetAfter(["created_at", "id"], page.cursor, "desc");
  if (after.sql) {
    where.push(after.sql);
    binds.push(...after.binds);
  }
  const rows = await queryAll<Row>(
    db,
    `SELECT * FROM approvals WHERE user_id = ?${where.map((w) => ` AND ${w}`).join("")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    scope.userId,
    ...binds,
    page.limit + 1
  );
  return pageOf(
    rows.map(toApproval),
    page.limit,
    (approval): CursorKey => [approval.created_at, approval.id]
  );
}

/** Every approval of a task, newest first. */
export async function approvalsOfTask(
  db: JobsDb,
  scope: UserScope,
  taskId: string
): Promise<ApprovalRecord[]> {
  const rows = await queryAll<Row>(
    db,
    "SELECT * FROM approvals WHERE user_id = ? AND task_id = ? ORDER BY created_at DESC, id DESC LIMIT 50",
    scope.userId,
    taskId
  );
  return rows.map(toApproval);
}

/** The newest submit/answer approval of a task (resume after release). */
export async function latestTaskApproval(
  db: JobsDb,
  scope: UserScope,
  taskId: string
): Promise<ApprovalRecord | null> {
  const row = await queryFirst<Row>(
    db,
    "SELECT * FROM approvals WHERE user_id = ? AND task_id = ? AND kind IN ('submit', 'answer') ORDER BY created_at DESC, id DESC LIMIT 1",
    scope.userId,
    taskId
  );
  return row ? toApproval(row) : null;
}

/** INSERT of a new pending approval + change_log. */
export function insertApprovalStatements(
  db: JobsDb,
  scope: UserScope,
  approval: ApprovalRecord
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO approvals (id, user_id, kind, task_id, application_id, payload, payload_hash, state, response, decided_via, decided_by_user_id, decided_at, expires_at, created_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?, ?, 1)",
      approval.id,
      scope.userId,
      approval.kind,
      approval.task_id,
      approval.application_id,
      encodeJson(approval.payload),
      approval.payload_hash,
      approval.expires_at,
      approval.created_at
    ),
    appendChange(db, scope, {
      entity: "approval",
      entityId: approval.id,
      revision: 1,
      now: approval.created_at,
    }),
  ];
}

export interface DecisionWrite {
  decidedVia: "web" | "cli" | "mcp";
  now: number;
  response: unknown;
  state: "approved" | "rejected";
}

/**
 * The decision itself, led by the first-decision-wins guard: still pending,
 * unexpired and bound to `approval.payload_hash`.
 */
export function decideApprovalStatements(
  db: JobsDb,
  scope: UserScope,
  approval: ApprovalRecord,
  decision: DecisionWrite
): D1PreparedStatement[] {
  return [
    guard(
      db,
      `approval:${approval.id}:pending`,
      "SELECT 1 FROM approvals WHERE id = ? AND user_id = ? AND state = 'pending' AND payload_hash = ? AND expires_at > ?",
      approval.id,
      scope.userId,
      approval.payload_hash,
      decision.now
    ),
    stmt(
      db,
      "UPDATE approvals SET state = ?, response = ?, decided_via = ?, decided_by_user_id = ?, decided_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND state = 'pending'",
      decision.state,
      decision.response === undefined || decision.response === null
        ? null
        : encodeJson(decision.response),
      decision.decidedVia,
      scope.userId,
      decision.now,
      approval.id,
      scope.userId
    ),
    appendChange(db, scope, {
      entity: "approval",
      entityId: approval.id,
      revision: approval.revision + 1,
      now: decision.now,
    }),
  ];
}

/**
 * Marks pending approvals expired (reaper, superseded approvals, rule
 * edits). Only rows still pending change; the change_log row follows the
 * stored revision.
 */
export function expireApprovalStatements(
  db: JobsDb,
  scope: UserScope,
  approvalIds: readonly string[],
  now: number
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const id of approvalIds) {
    statements.push(
      stmt(
        db,
        "UPDATE approvals SET state = 'expired', revision = revision + 1 WHERE id = ? AND user_id = ? AND state = 'pending'",
        id,
        scope.userId
      ),
      stmt(
        db,
        "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'approval', id, revision, 'upsert', ? FROM approvals WHERE id = ? AND user_id = ? AND state = 'expired' AND changes() > 0",
        now,
        id,
        scope.userId
      )
    );
  }
  return statements;
}

/** Pending approvals of one task and kind (superseded by a new one). */
export async function pendingTaskApprovals(
  db: JobsDb,
  scope: UserScope,
  taskId: string,
  kind: ApprovalKind
): Promise<string[]> {
  const rows = await queryAll<{ id: string }>(
    db,
    "SELECT id FROM approvals WHERE user_id = ? AND task_id = ? AND kind = ? AND state = 'pending'",
    scope.userId,
    taskId,
    kind
  );
  return rows.map((row) => row.id);
}

/** Every pending approval of a task (cancel of an unleased task). */
export async function pendingApprovalsOfTask(
  db: JobsDb,
  scope: UserScope,
  taskId: string
): Promise<string[]> {
  const rows = await queryAll<{ id: string }>(
    db,
    "SELECT id FROM approvals WHERE user_id = ? AND task_id = ? AND state = 'pending'",
    scope.userId,
    taskId
  );
  return rows.map((row) => row.id);
}

/** Pending `rule_activation` approvals of one rule. */
export async function pendingRuleActivationIds(
  db: JobsDb,
  scope: UserScope,
  ruleId: string
): Promise<string[]> {
  const rows = await queryAll<{ id: string }>(
    db,
    "SELECT id FROM approvals WHERE user_id = ? AND kind = 'rule_activation' AND state = 'pending' AND json_extract(payload, '$.rule_id') = ?",
    scope.userId,
    ruleId
  );
  return rows.map((row) => row.id);
}

export interface ExpiredApprovalRow {
  id: string;
  kind: ApprovalKind;
  task_id: string | null;
  user_id: string;
}

/** Pending approvals past `expires_at`, across users (the `*\/5` cron). */
export async function listExpiredApprovals(
  db: JobsDb,
  options: { limit: number; now: number }
): Promise<ExpiredApprovalRow[]> {
  // sql-allow: system — the cron expires every user's stale approvals (21 §7.1)
  return await queryAll<ExpiredApprovalRow>(
    db,
    "SELECT id, user_id, kind, task_id FROM approvals WHERE state = 'pending' AND expires_at <= ? ORDER BY expires_at LIMIT ?",
    options.now,
    options.limit
  );
}

/** The change_log row of an approval after an UPDATE in the same batch. */
export function approvalChange(
  db: JobsDb,
  scope: UserScope,
  approvalId: string,
  now: number
): D1PreparedStatement {
  return appendChangeFromRow(db, scope, {
    entity: "approval",
    table: "approvals",
    id: approvalId,
    now,
  });
}
