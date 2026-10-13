// The automation service (leaf-2.7): the cross-area entry points of 05 §8 /
// 21 (PLAN C5). Other areas call these instead of touching automation rows.
//
//   decideApproval   statements deciding an approval (first decision wins,
//                    payload_hash bound) + its effects; the MCP tool
//                    `jobs_approval_decide` (leaf-2.10) calls it after
//                    checking allow_mcp_approvals and the kind
//   planCreateTask   statements creating a task under the full creation
//                    policy (e.g. leaf-2.6's render_cv fallback, createdBy
//                    "system", requireDevice false)
//   hasEnabledRules  whether an evaluate_rules message is worth sending
//                    (leaf-2.5, after scoring)

import type { FeatureFlags } from "../../core/flags";
import type { UserScope } from "../../core/scope";
import type { Env } from "../../../env";
import { hasEnabledRuleRows } from "../../repo/automation/rules";
import type { JobsDb } from "../../repo/core/db";
import type { DecideApprovalInput, DecideApprovalResult } from "./approvals";
import { decideApproval as decide } from "./approvals";
import type { CreateTaskInput, CreateTaskPlan } from "./tasks";
import { planCreateTask as planTask } from "./tasks";

export type {
  ApprovalApi,
  DecideApprovalInput,
  DecideApprovalResult,
} from "./approvals";
export type { CreateTaskInput, CreateTaskPlan } from "./tasks";

/**
 * Plans an approval decision (POST /approvals/{id}/decide, MCP). Commit
 * `statements` in one batch; a `GuardFailedError` from it means another
 * decision won (answer 409). Throws 404 / 409 revision_conflict (decided,
 * hash mismatch) / 410 approval_expired / 422 policy_violation.
 */
export async function decideApproval(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  input: DecideApprovalInput
): Promise<DecideApprovalResult> {
  return await decide(db, scope, env, input);
}

/** Plans one automation task (21 §4); see `CreateTaskInput`. */
export async function planCreateTask(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  input: CreateTaskInput,
  flags: FeatureFlags
): Promise<CreateTaskPlan> {
  return await planTask(db, scope, env, input, flags);
}

/** True when the user has at least one enabled automation rule. */
export async function hasEnabledRules(
  db: JobsDb,
  scope: UserScope
): Promise<boolean> {
  return await hasEnabledRuleRows(db, scope);
}
