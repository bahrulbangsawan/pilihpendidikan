// Automation rules CRUD with the `auto` activation flow (05 §8, 19 §8.3,
// 20 §6.2 "enabling auto is a separate approval flow", D-29, D-35).
//
// - `assisted` / `approval` rules: plain CRUD with `jobs:write`.
// - `auto` rules: min_score ≥ 70, a narrowing criterion, non-empty
//   allowed_domains, an expiry ≤ 30 days (default now + 30 d), the D-35
//   ceilings. ENABLING one needs `automation:manage` and does not enable it:
//   it creates a pending `rule_activation` approval bound to the rule's
//   content; the rule turns on only when that approval is APPROVED
//   (`decideApproval`). Any change to an enabled auto rule's content voids
//   its activation (a new approval is created); disabling never needs the
//   step-up scope.

import type {
  CreateRuleRequest,
  UpdateRuleRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApprovalRecord,
  AutomationRuleRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { APPROVAL_EXPIRY_MS } from "@pilihpendidikan/jobs-contracts/stage";
import type { FeatureFlags } from "../../core/flags";
import {
  apiError,
  insufficientScope,
  notFound,
  revisionConflict,
} from "../../core/http";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import {
  expireApprovalStatements,
  insertApprovalStatements,
  pendingRuleActivationIds,
} from "../../repo/automation/approvals";
import {
  deleteRuleStatements,
  insertRuleStatements,
  loadRule,
  ruleActivations,
  updateRuleStatements,
} from "../../repo/automation/rules";
import {
  activationContent,
  activationSummary,
  assertNoProblems,
  autoRuleProblems,
  canonicalJson,
  limitProblems,
  normalizeDomains,
  payloadHash,
  withAutoDefaults,
} from "./policy";

export interface RulePlan {
  approval?: ApprovalRecord;
  rule: AutomationRuleRecord;
  statements: D1PreparedStatement[];
}

interface Actor {
  /** The caller holds `automation:manage` (05 §8 step-up). */
  canManage: boolean;
  flags: Pick<FeatureFlags, "JOBS_AUTO_MODE_ENABLED">;
  now: number;
}

/** A pending `rule_activation` approval for the rule as it is now. */
async function activationApproval(
  rule: AutomationRuleRecord,
  now: number
): Promise<ApprovalRecord> {
  const payload = {
    type: "rule_activation" as const,
    rule_id: rule.id,
    name: rule.name,
    mode: rule.mode,
    summary: activationSummary(rule),
    criteria: rule.criteria,
    limits: rule.limits,
    allowed_domains: rule.allowed_domains,
  };
  return {
    id: newId("apr", now),
    user_id: rule.user_id,
    kind: "rule_activation",
    task_id: null,
    application_id: null,
    payload,
    payload_hash: await payloadHash(payload),
    state: "pending",
    response: null,
    decided_via: null,
    decided_by_user_id: null,
    decided_at: null,
    expires_at: now + APPROVAL_EXPIRY_MS.rule_activation,
    created_at: now,
    revision: 1,
  };
}

function requireManage(actor: Actor): void {
  if (!actor.canManage) {
    throw insufficientScope(["automation:manage"]);
  }
}

function requireAutoMode(actor: Actor): void {
  if (!actor.flags.JOBS_AUTO_MODE_ENABLED) {
    throw apiError(
      "mode_not_allowed",
      "Automatic submission (auto mode) is not available right now.",
      { details: { flag: "JOBS_AUTO_MODE_ENABLED" } }
    );
  }
}

function validate(rule: AutomationRuleRecord, now: number): void {
  assertNoProblems([
    ...limitProblems(rule.limits),
    ...autoRuleProblems(rule, now),
  ]);
}

/** POST /api/v1/rules. */
export async function planCreateRule(
  db: JobsDb,
  scope: UserScope,
  body: CreateRuleRequest,
  actor: Actor
): Promise<RulePlan> {
  const { now } = actor;
  const mode = body.mode;
  const rule: AutomationRuleRecord = {
    id: newId("rul", now),
    user_id: scope.userId,
    name: body.name,
    enabled: false,
    mode,
    criteria: body.criteria,
    limits: mode === "auto" ? withAutoDefaults(body.limits, now) : body.limits,
    allowed_domains: normalizeDomains(body.allowed_domains ?? []),
    cv_policy: body.cv_policy ?? {},
    activated_approval_id: null,
    revision: 1,
    created_at: now,
    updated_at: now,
  };
  validate(rule, now);
  const statements: D1PreparedStatement[] = [];
  let approval: ApprovalRecord | undefined;
  if (body.enabled === true) {
    if (mode === "auto") {
      requireManage(actor);
      requireAutoMode(actor);
      approval = await activationApproval(rule, now);
    } else {
      rule.enabled = true;
    }
  }
  statements.push(...insertRuleStatements(db, scope, rule));
  if (approval) {
    statements.push(...insertApprovalStatements(db, scope, approval));
  }
  return { rule, approval, statements };
}

function contentChanged(
  before: AutomationRuleRecord,
  after: AutomationRuleRecord
): boolean {
  return (
    canonicalJson(activationContent(before)) !==
    canonicalJson(activationContent(after))
  );
}

/**
 * What an edit does to the `auto` activation (mutates `after.enabled` and
 * `after.activated_approval_id`): an unchanged active rule stays on, an
 * unchanged pending activation stays pending, anything else that wants to be
 * on needs a fresh activation (step-up scope); turning off or leaving `auto`
 * drops the activation and expires pending ones.
 */
async function activationOnUpdate(
  before: AutomationRuleRecord,
  after: AutomationRuleRecord,
  input: { actor: Actor; pending: string[]; wantsEnabled: boolean }
): Promise<{ approval?: ApprovalRecord; expire: string[] }> {
  const { actor, pending, wantsEnabled } = input;
  if (!(after.mode === "auto" && wantsEnabled)) {
    after.enabled = after.mode !== "auto" && wantsEnabled;
    after.activated_approval_id = null;
    return { expire: pending };
  }
  const changed = contentChanged(before, after);
  const stillActive =
    before.enabled &&
    before.mode === "auto" &&
    before.activated_approval_id !== null &&
    !changed;
  if (stillActive) {
    after.enabled = true;
    return { expire: [] };
  }
  after.enabled = false;
  after.activated_approval_id = null;
  if (pending.length > 0 && !changed && !before.enabled) {
    return { expire: [] };
  }
  requireManage(actor);
  requireAutoMode(actor);
  const approval = await activationApproval(
    { ...after, revision: before.revision + 1 },
    actor.now
  );
  return { approval, expire: pending };
}

/** PATCH /api/v1/rules/{id}. */
export async function planUpdateRule(
  db: JobsDb,
  scope: UserScope,
  ruleId: string,
  body: UpdateRuleRequest,
  actor: Actor
): Promise<RulePlan> {
  const { now } = actor;
  const before = await loadRule(db, scope, ruleId);
  if (!before) {
    throw notFound("Rule not found.");
  }
  if (body.base_revision !== before.revision) {
    throw revisionConflict(
      before,
      `Rule changed since revision ${body.base_revision} (now ${before.revision}).`
    );
  }
  const mode = body.mode ?? before.mode;
  const limits = body.limits ?? before.limits;
  const after: AutomationRuleRecord = {
    ...before,
    name: body.name ?? before.name,
    mode,
    criteria: body.criteria ?? before.criteria,
    limits: mode === "auto" ? withAutoDefaults(limits, now) : limits,
    allowed_domains:
      body.allowed_domains === undefined
        ? before.allowed_domains
        : normalizeDomains(body.allowed_domains),
    cv_policy: body.cv_policy ?? before.cv_policy,
    updated_at: now,
  };
  validate(after, now);
  const pending = await pendingRuleActivationIds(db, scope, before.id);
  const wantsEnabled = body.enabled ?? (before.enabled || pending.length > 0);
  const { approval, expire } = await activationOnUpdate(before, after, {
    actor,
    pending,
    wantsEnabled,
  });
  after.revision = before.revision + 1;
  const statements = [
    ...updateRuleStatements(db, scope, before, after),
    ...expireApprovalStatements(db, scope, expire, now),
  ];
  if (approval) {
    statements.push(...insertApprovalStatements(db, scope, approval));
  }
  return { rule: after, approval, statements };
}

/** DELETE /api/v1/rules/{id} (pending activations expire with it). */
export async function planDeleteRule(
  db: JobsDb,
  scope: UserScope,
  ruleId: string,
  input: { baseRevision?: number; now: number }
): Promise<{ statements: D1PreparedStatement[] }> {
  const rule = await loadRule(db, scope, ruleId);
  if (!rule) {
    throw notFound("Rule not found.");
  }
  if (
    input.baseRevision !== undefined &&
    input.baseRevision !== rule.revision
  ) {
    throw revisionConflict(rule);
  }
  const pending = await pendingRuleActivationIds(db, scope, rule.id);
  return {
    statements: [
      ...deleteRuleStatements(db, scope, rule, input.now),
      ...expireApprovalStatements(db, scope, pending, input.now),
    ],
  };
}

/** GET /api/v1/rules/{id}: the rule and its newest activation approval. */
export async function getRule(
  db: JobsDb,
  scope: UserScope,
  ruleId: string
): Promise<{ approval?: ApprovalRecord; rule: AutomationRuleRecord }> {
  const rule = await loadRule(db, scope, ruleId);
  if (!rule) {
    throw notFound("Rule not found.");
  }
  if (rule.mode !== "auto") {
    return { rule };
  }
  const [latest] = await ruleActivations(db, scope, rule.id);
  return latest ? { rule, approval: latest } : { rule };
}
