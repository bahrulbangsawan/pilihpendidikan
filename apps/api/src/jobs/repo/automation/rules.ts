// `automation_rules` (04 §2.3, 05 §8, 19 §8.3) and the `rule_activation`
// approvals that bind them.
//
// An approval of kind `rule_activation` names its rule in
// `payload.rule_id` (the approvals table has no rule column). A rule in mode
// `auto` is effective only while `activated_approval_id` points at an
// APPROVED activation of that same rule (checked by the service).

import type {
  ApprovalRecord,
  AutomationRuleRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { CursorKey, Page, PageRequest } from "../../core/pagination";
import { keysetAfter, pageOf } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import { appendChange } from "../core/change-log";
import type { JobsDb } from "../core/db";
import {
  encodeJson,
  guardRevision,
  queryAll,
  queryFirst,
  sqlBool,
  stmt,
} from "../core/db";
import type { Row } from "./records";
import { toApproval, toRule } from "./records";

export async function loadRule(
  db: JobsDb,
  scope: UserScope,
  ruleId: string
): Promise<AutomationRuleRecord | null> {
  const row = await queryFirst<Row>(
    db,
    "SELECT * FROM automation_rules WHERE id = ? AND user_id = ?",
    ruleId,
    scope.userId
  );
  return row ? toRule(row) : null;
}

/** Newest first (05 §1.5 keyset pagination). */
export async function listRules(
  db: JobsDb,
  scope: UserScope,
  page: PageRequest
): Promise<Page<AutomationRuleRecord>> {
  const after = keysetAfter(["created_at", "id"], page.cursor, "desc");
  const rows = await queryAll<Row>(
    db,
    `SELECT * FROM automation_rules WHERE user_id = ?${after.sql ? ` AND ${after.sql}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`,
    scope.userId,
    ...after.binds,
    page.limit + 1
  );
  return pageOf(
    rows.map(toRule),
    page.limit,
    (rule): CursorKey => [rule.created_at, rule.id]
  );
}

/** The user's enabled rules (evaluate_rules, task coverage). */
export async function listEnabledRules(
  db: JobsDb,
  scope: UserScope
): Promise<AutomationRuleRecord[]> {
  const rows = await queryAll<Row>(
    db,
    "SELECT * FROM automation_rules WHERE user_id = ? AND enabled = 1 ORDER BY created_at",
    scope.userId
  );
  return rows.map(toRule);
}

export async function hasEnabledRuleRows(
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

/** INSERT of a new rule + its change_log row. */
export function insertRuleStatements(
  db: JobsDb,
  scope: UserScope,
  rule: AutomationRuleRecord
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO automation_rules (id, user_id, name, enabled, mode, criteria, limits, allowed_domains, cv_policy, activated_approval_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      rule.id,
      scope.userId,
      rule.name,
      sqlBool(rule.enabled),
      rule.mode,
      encodeJson(rule.criteria),
      encodeJson(rule.limits),
      encodeJson(rule.allowed_domains),
      encodeJson(rule.cv_policy),
      rule.activated_approval_id,
      rule.created_at,
      rule.updated_at
    ),
    appendChange(db, scope, {
      entity: "rule",
      entityId: rule.id,
      revision: 1,
      now: rule.created_at,
    }),
  ];
}

/**
 * Revision-guarded full UPDATE from `before` to `after` (D-21): a concurrent
 * edit aborts the batch (`GuardFailedError`).
 */
export function updateRuleStatements(
  db: JobsDb,
  scope: UserScope,
  before: AutomationRuleRecord,
  after: AutomationRuleRecord
): D1PreparedStatement[] {
  return [
    guardRevision(db, scope, "automation_rules", before.id, before.revision),
    stmt(
      db,
      "UPDATE automation_rules SET name = ?, enabled = ?, mode = ?, criteria = ?, limits = ?, allowed_domains = ?, cv_policy = ?, activated_approval_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?",
      after.name,
      sqlBool(after.enabled),
      after.mode,
      encodeJson(after.criteria),
      encodeJson(after.limits),
      encodeJson(after.allowed_domains),
      encodeJson(after.cv_policy),
      after.activated_approval_id,
      after.updated_at,
      before.id,
      scope.userId,
      before.revision
    ),
    appendChange(db, scope, {
      entity: "rule",
      entityId: before.id,
      revision: before.revision + 1,
      now: after.updated_at,
    }),
  ];
}

/** Hard delete (05 §8 CRUD) + a change_log `delete`. */
export function deleteRuleStatements(
  db: JobsDb,
  scope: UserScope,
  rule: AutomationRuleRecord,
  now: number
): D1PreparedStatement[] {
  return [
    guardRevision(db, scope, "automation_rules", rule.id, rule.revision),
    stmt(
      db,
      "DELETE FROM automation_rules WHERE id = ? AND user_id = ? AND revision = ?",
      rule.id,
      scope.userId,
      rule.revision
    ),
    appendChange(db, scope, {
      entity: "rule",
      entityId: rule.id,
      revision: rule.revision + 1,
      op: "delete",
      now,
    }),
  ];
}

/**
 * Turns an `auto` rule on with its approved activation, only if the rule is
 * still at the revision the activation was checked against.
 */
export function activateRuleStatements(
  db: JobsDb,
  scope: UserScope,
  rule: AutomationRuleRecord,
  approvalId: string,
  now: number
): D1PreparedStatement[] {
  return [
    guardRevision(db, scope, "automation_rules", rule.id, rule.revision),
    stmt(
      db,
      "UPDATE automation_rules SET enabled = 1, activated_approval_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ? AND mode = 'auto'",
      approvalId,
      now,
      rule.id,
      scope.userId,
      rule.revision
    ),
    appendChange(db, scope, {
      entity: "rule",
      entityId: rule.id,
      revision: rule.revision + 1,
      now,
    }),
  ];
}

/** `rule_activation` approvals of one rule, newest first. */
export async function ruleActivations(
  db: JobsDb,
  scope: UserScope,
  ruleId: string
): Promise<ApprovalRecord[]> {
  const rows = await queryAll<Row>(
    db,
    "SELECT * FROM approvals WHERE user_id = ? AND kind = 'rule_activation' AND json_extract(payload, '$.rule_id') = ? ORDER BY created_at DESC, id DESC LIMIT 20",
    scope.userId,
    ruleId
  );
  return rows.map(toApproval);
}

/** The approval an `auto` rule's activation points at (any state). */
export async function loadActivation(
  db: JobsDb,
  scope: UserScope,
  approvalId: string
): Promise<ApprovalRecord | null> {
  const row = await queryFirst<Row>(
    db,
    "SELECT * FROM approvals WHERE id = ? AND user_id = ? AND kind = 'rule_activation'",
    approvalId,
    scope.userId
  );
  return row ? toApproval(row) : null;
}
