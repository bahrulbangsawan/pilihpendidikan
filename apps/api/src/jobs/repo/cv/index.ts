// CV variant SQL (04 §2.5, 08): `cv_variants`, the `cv_variant` approvals, the
// application link (`applications.cv_variant_id`, `base_cv_id`), `render_cv`
// fallback tasks and the read-only inputs of tailoring (posting, facts).
// Every statement carries the user's `user_id`; the services in
// services/cv build batches from these and commit them once.

import type {
  ActorKind,
  ApprovalDecidedVia,
  ApprovalState,
  ChangeSource,
  CvTemplate,
  CvVariantStatus,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import { TASK_LIVE_STATES } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApplicationRecord,
  ApprovalRecord,
  CvPolicy,
  CvVariantRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { APPROVAL_EXPIRY_MS } from "@pilihpendidikan/jobs-contracts/stage";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { UserScope } from "../../core/scope";
import type { TransitionPlan } from "../core/application-state";
import { planApplicationTransition } from "../core/application-state";
import { appendChange, appendChangeFromRow } from "../core/change-log";
import type { JobsDb } from "../core/db";
import {
  decodeJson,
  decodeRow,
  encodeJson,
  guard,
  guardRevision,
  queryAll,
  queryFirst,
  runBatch,
  stmt,
} from "../core/db";
import { appendEvent } from "../core/events";
import { TASK_QUEUE_TTL_MS } from "../core/leases";

/** Statuses whose variant still holds (or will hold) its file (14 §5.4). */
export const LIVE_VARIANT_STATUSES: readonly CvVariantStatus[] = [
  "generating",
  "draft",
  "approved",
];

/** Runs one batch of CV-area statements. */
export async function commitCvStatements(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<void> {
  await runBatch(db, statements);
}

// ---------------------------------------------------------------------------
// cv_variants
// ---------------------------------------------------------------------------

/** The user's variant (API representation), or null. */
export async function loadVariant(
  db: JobsDb,
  scope: UserScope,
  cvvId: string
): Promise<CvVariantRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM cv_variants WHERE id = ? AND user_id = ?",
    cvvId,
    scope.userId
  );
  return row ? decodeRow<CvVariantRecord>("cv_variants", row) : null;
}

export interface NewVariant {
  applicationId: string | null;
  baseCvId: string;
  id: string;
  /** null until tailoring records the model; "copy" for copy-only variants. */
  model: string | null;
  now: number;
  template: CvTemplate;
}

/** INSERT of a `generating` variant + its change_log row. */
export function insertVariantStatements(
  db: JobsDb,
  scope: UserScope,
  v: NewVariant
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "INSERT INTO cv_variants (id, user_id, application_id, base_cv_id, tailored_cv_id, template, status, file_id, diff, model, approved_at, revision, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, 'generating', NULL, '{}', ?, NULL, 1, ?, ?)",
      v.id,
      scope.userId,
      v.applicationId,
      v.baseCvId,
      v.template,
      v.model,
      v.now,
      v.now
    ),
    appendChange(db, scope, {
      entity: "cv_variant",
      entityId: v.id,
      revision: 1,
      now: v.now,
    }),
  ];
}

/** The application's variants still in flight (re-tailoring supersedes them, 08 §10). */
export async function listSupersedableVariants(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<Array<{ id: string; revision: number; status: CvVariantStatus }>> {
  return await queryAll(
    db,
    "SELECT id, status, revision FROM cv_variants WHERE user_id = ? AND application_id = ? AND status IN ('generating', 'draft') ORDER BY created_at",
    scope.userId,
    applicationId
  );
}

/** generating / draft → rejected for superseded variants (+ change_log). */
export function supersedeVariantStatements(
  db: JobsDb,
  scope: UserScope,
  ids: readonly string[],
  now: number
): D1PreparedStatement[] {
  return ids.flatMap((id) => [
    stmt(
      db,
      "UPDATE cv_variants SET status = 'rejected', revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND status IN ('generating', 'draft')",
      now,
      id,
      scope.userId
    ),
    appendChangeFromRow(db, scope, {
      entity: "cv_variant",
      table: "cv_variants",
      id,
      now,
    }),
  ]);
}

/**
 * Tailoring finished (08 §4.1 step 7): one-shot on `status = 'generating'
 * AND tailored_cv_id IS NULL` (14 §6); a lost race aborts the batch.
 */
export function completeTailoringStatements(
  db: JobsDb,
  scope: UserScope,
  done: {
    diff: unknown;
    id: string;
    model: string;
    now: number;
    tailoredCvId: string;
  }
): D1PreparedStatement[] {
  return [
    guard(
      db,
      `tailor_pending:${done.id}`,
      "SELECT 1 FROM cv_variants WHERE id = ? AND user_id = ? AND status = 'generating' AND tailored_cv_id IS NULL",
      done.id,
      scope.userId
    ),
    stmt(
      db,
      "UPDATE cv_variants SET tailored_cv_id = ?, diff = ?, model = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'generating' AND tailored_cv_id IS NULL",
      done.tailoredCvId,
      encodeJson(done.diff),
      done.model,
      done.now,
      done.id,
      scope.userId
    ),
    appendChangeFromRow(db, scope, {
      entity: "cv_variant",
      table: "cv_variants",
      id: done.id,
      now: done.now,
    }),
  ];
}

/** generating → failed (validation, budget, missing inputs, DLQ). */
export function failVariantStatements(
  db: JobsDb,
  scope: UserScope,
  failed: {
    diff: unknown | null;
    id: string;
    model: string | null;
    now: number;
  }
): D1PreparedStatement[] {
  return [
    guard(
      db,
      `tailor_failable:${failed.id}`,
      "SELECT 1 FROM cv_variants WHERE id = ? AND user_id = ? AND status = 'generating'",
      failed.id,
      scope.userId
    ),
    stmt(
      db,
      "UPDATE cv_variants SET status = 'failed', diff = COALESCE(?, diff), model = COALESCE(?, model), revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'generating'",
      failed.diff === null ? null : encodeJson(failed.diff),
      failed.model,
      failed.now,
      failed.id,
      scope.userId
    ),
    appendChangeFromRow(db, scope, {
      entity: "cv_variant",
      table: "cv_variants",
      id: failed.id,
      now: failed.now,
    }),
  ];
}

/**
 * Links a rendered PDF (08 §6.5): `file_id`, the new status (`draft`, or
 * `approved` when the rule auto-approves) and the refreshed diff, guarded on
 * the revision the upload was planned against.
 */
export function attachRenderedFileStatements(
  db: JobsDb,
  scope: UserScope,
  change: {
    approvedAt: number | null;
    diff: unknown;
    fileId: string;
    now: number;
    status: "draft" | "approved";
    variant: Pick<CvVariantRecord, "id" | "revision">;
  }
): D1PreparedStatement[] {
  const { variant } = change;
  return [
    guard(
      db,
      `cv_variant_renderable:${variant.id}`,
      "SELECT 1 FROM cv_variants WHERE id = ? AND user_id = ? AND revision = ? AND status IN ('generating', 'draft') AND tailored_cv_id IS NOT NULL",
      variant.id,
      scope.userId,
      variant.revision
    ),
    stmt(
      db,
      "UPDATE cv_variants SET file_id = ?, status = ?, diff = ?, approved_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?",
      change.fileId,
      change.status,
      encodeJson(change.diff),
      change.approvedAt,
      change.now,
      variant.id,
      scope.userId,
      variant.revision
    ),
    appendChange(db, scope, {
      entity: "cv_variant",
      entityId: variant.id,
      revision: variant.revision + 1,
      now: change.now,
    }),
  ];
}

/** draft → approved | rejected (or generating/failed → rejected), revision-guarded. */
export function decideVariantStatements(
  db: JobsDb,
  scope: UserScope,
  change: {
    now: number;
    status: "approved" | "rejected";
    variant: Pick<CvVariantRecord, "id" | "revision">;
  }
): D1PreparedStatement[] {
  const { variant } = change;
  return [
    guardRevision(db, scope, "cv_variants", variant.id, variant.revision),
    stmt(
      db,
      "UPDATE cv_variants SET status = ?, approved_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?",
      change.status,
      change.status === "approved" ? change.now : null,
      change.now,
      variant.id,
      scope.userId,
      variant.revision
    ),
    appendChange(db, scope, {
      entity: "cv_variant",
      entityId: variant.id,
      revision: variant.revision + 1,
      now: change.now,
    }),
  ];
}

/** Every variant of an application (application purge, 06 §8 / 08 §9). */
export async function listApplicationVariants(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<CvVariantRecord[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    "SELECT * FROM cv_variants WHERE user_id = ? AND application_id = ? ORDER BY created_at",
    scope.userId,
    applicationId
  );
  return rows.map((row) => decodeRow<CvVariantRecord>("cv_variants", row));
}

/** Deletes variants and their approvals (+ change_log op delete). */
export function deleteVariantsStatements(
  db: JobsDb,
  scope: UserScope,
  ids: readonly string[],
  now: number
): D1PreparedStatement[] {
  return ids.flatMap((id) => [
    stmt(
      db,
      "DELETE FROM approvals WHERE user_id = ? AND kind = 'cv_variant' AND json_extract(payload, '$.cv_variant_id') = ?",
      scope.userId,
      id
    ),
    stmt(
      db,
      "DELETE FROM cv_variants WHERE id = ? AND user_id = ?",
      id,
      scope.userId
    ),
    appendChange(db, scope, {
      entity: "cv_variant",
      entityId: id,
      revision: 1,
      op: "delete",
      now,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// approvals (kind = 'cv_variant')
// ---------------------------------------------------------------------------

/** The variant's approvals, newest first. */
export async function listVariantApprovals(
  db: JobsDb,
  scope: UserScope,
  cvvId: string
): Promise<ApprovalRecord[]> {
  const rows = await queryAll<Record<string, unknown>>(
    db,
    "SELECT * FROM approvals WHERE user_id = ? AND kind = 'cv_variant' AND json_extract(payload, '$.cv_variant_id') = ? ORDER BY created_at DESC, id DESC",
    scope.userId,
    cvvId
  );
  return rows.map((row) => decodeRow<ApprovalRecord>("approvals", row));
}

/** One of the user's approvals by id, or null. */
export async function loadApproval(
  db: JobsDb,
  scope: UserScope,
  approvalId: string
): Promise<ApprovalRecord | null> {
  const row = await queryFirst<Record<string, unknown>>(
    db,
    "SELECT * FROM approvals WHERE id = ? AND user_id = ?",
    approvalId,
    scope.userId
  );
  return row ? decodeRow<ApprovalRecord>("approvals", row) : null;
}

/** pending → `state` for the given approvals (+ change_log), no decision fields. */
export function closeApprovalsStatements(
  db: JobsDb,
  scope: UserScope,
  approvalIds: readonly string[],
  state: Extract<ApprovalState, "expired" | "rejected">,
  now: number
): D1PreparedStatement[] {
  return approvalIds.flatMap((id) => [
    stmt(
      db,
      "UPDATE approvals SET state = ?, decided_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND state = 'pending'",
      state,
      now,
      id,
      scope.userId
    ),
    appendChangeFromRow(db, scope, {
      entity: "approval",
      table: "approvals",
      id,
      now,
    }),
  ]);
}

export interface NewVariantApproval {
  applicationId: string | null;
  decidedVia?: ApprovalDecidedVia | null;
  id: string;
  now: number;
  payload: Record<string, unknown>;
  payloadHash: string;
  state: "pending" | "approved";
}

/** INSERT of a `cv_variant` approval (7-day expiry, 03 §8) + change_log. */
export function insertVariantApprovalStatements(
  db: JobsDb,
  scope: UserScope,
  approval: NewVariantApproval
): D1PreparedStatement[] {
  const decided = approval.state === "approved";
  return [
    stmt(
      db,
      "INSERT INTO approvals (id, user_id, kind, task_id, application_id, payload, payload_hash, state, response, decided_via, decided_by_user_id, decided_at, expires_at, created_at, revision) VALUES (?, ?, 'cv_variant', NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 1)",
      approval.id,
      scope.userId,
      approval.applicationId,
      encodeJson(approval.payload),
      approval.payloadHash,
      approval.state,
      approval.decidedVia ?? null,
      decided && approval.decidedVia ? scope.userId : null,
      decided ? approval.now : null,
      approval.now + APPROVAL_EXPIRY_MS.cv_variant,
      approval.now
    ),
    appendChange(db, scope, {
      entity: "approval",
      entityId: approval.id,
      revision: 1,
      now: approval.now,
    }),
  ];
}

/** pending → approved | rejected by the user (decided_via, decided_by). */
export function decideApprovalStatements(
  db: JobsDb,
  scope: UserScope,
  decision: {
    approval: Pick<ApprovalRecord, "id" | "revision">;
    decidedVia: ApprovalDecidedVia;
    now: number;
    response: Record<string, unknown> | null;
    state: "approved" | "rejected";
  }
): D1PreparedStatement[] {
  const { approval } = decision;
  return [
    guard(
      db,
      `approval_pending:${approval.id}`,
      "SELECT 1 FROM approvals WHERE id = ? AND user_id = ? AND state = 'pending' AND revision = ?",
      approval.id,
      scope.userId,
      approval.revision
    ),
    stmt(
      db,
      "UPDATE approvals SET state = ?, response = ?, decided_via = ?, decided_by_user_id = ?, decided_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND state = 'pending'",
      decision.state,
      decision.response === null ? null : encodeJson(decision.response),
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

// ---------------------------------------------------------------------------
// applications
// ---------------------------------------------------------------------------

export interface ApplicationRule {
  activated_approval_id: string | null;
  cv_policy: CvPolicy;
  enabled: boolean;
  id: string;
  mode: "assisted" | "approval" | "auto";
}

/** The application's automation rule (enabled or not), or null. */
export async function loadApplicationRule(
  db: JobsDb,
  scope: UserScope,
  ruleId: string | null
): Promise<ApplicationRule | null> {
  if (!ruleId) {
    return null;
  }
  const row = await queryFirst<{
    activated_approval_id: string | null;
    cv_policy: string;
    enabled: number;
    id: string;
    mode: ApplicationRule["mode"];
  }>(
    db,
    "SELECT id, mode, enabled, cv_policy, activated_approval_id FROM automation_rules WHERE id = ? AND user_id = ?",
    ruleId,
    scope.userId
  );
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    mode: row.mode,
    enabled: row.enabled === 1,
    activated_approval_id: row.activated_approval_id,
    cv_policy: decodeJson<CvPolicy>(row.cv_policy, {}),
  };
}

/** True when the application still has an unanswered `answer` approval (06 §3). */
export async function hasPendingAnswerApprovals(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<boolean> {
  const row = await queryFirst<{ hit: number }>(
    db,
    "SELECT 1 AS hit FROM approvals WHERE user_id = ? AND application_id = ? AND kind = 'answer' AND state = 'pending' LIMIT 1",
    scope.userId,
    applicationId
  );
  return row !== null;
}

export interface ApplicationChange {
  /** Events appended after the application statements (cv_variant_attached …). */
  events?: Parameters<typeof appendEvent>[2][];
  /** Columns to set on the application row besides the transition. */
  fields: { base_cv_id?: string; cv_variant_id?: string };
  now: number;
  source: ChangeSource;
  stage?: { reason: string; to: Stage };
  /** Prefix of the stage event's idempotency key. */
  eventKeyPrefix: string;
}

/**
 * One application change made by the system on behalf of a CV variant: the
 * stage move (system actor, 03 §5.1: saved → preparing on request, preparing
 * → ready on approval) through the kernel's transition planner, plus the
 * `cv_variant_id` / `base_cv_id` columns and extra events — in batch order,
 * starting with the application's revision guard.
 */
export async function planApplicationChange(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  change: ApplicationChange
): Promise<{
  after: ApplicationRecord;
  plan: TransitionPlan;
  statements: D1PreparedStatement[];
}> {
  const plan = await planApplicationTransition(db, scope, {
    applicationId,
    actor: "system",
    source: change.source,
    now: change.now,
    stage: change.stage,
    eventKeyPrefix: change.eventKeyPrefix,
  });
  const after: ApplicationRecord = { ...plan.after };
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [column, value] of Object.entries(change.fields)) {
    if (
      value !== undefined &&
      after[column as keyof ApplicationRecord] !== value
    ) {
      sets.push(`${column} = ?`);
      binds.push(value);
      (after as Record<string, unknown>)[column] = value;
    }
  }
  const statements = [...plan.statements];
  if (sets.length > 0) {
    if (plan.changed) {
      // The transition already bumped the revision and logged the change.
      statements.push(
        stmt(
          db,
          `UPDATE applications SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
          ...binds,
          applicationId,
          scope.userId
        )
      );
    } else {
      after.revision = plan.before.revision + 1;
      after.updated_at = change.now;
      after.last_change_source = change.source;
      statements.push(
        stmt(
          db,
          `UPDATE applications SET ${sets.join(", ")}, last_change_source = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?`,
          ...binds,
          change.source,
          change.now,
          applicationId,
          scope.userId,
          plan.before.revision
        ),
        appendChange(db, scope, {
          entity: "application",
          entityId: applicationId,
          revision: after.revision,
          now: change.now,
        })
      );
    }
  }
  for (const event of change.events ?? []) {
    statements.push(...appendEvent(db, scope, event, change.now).statements);
  }
  return { after, plan, statements };
}

/** Application events on their own (approval requested / decided …). */
export function applicationEventStatements(
  db: JobsDb,
  scope: UserScope,
  events: readonly Parameters<typeof appendEvent>[2][],
  now: number
): D1PreparedStatement[] {
  return events.flatMap(
    (event) => appendEvent(db, scope, event, now).statements
  );
}

// ---------------------------------------------------------------------------
// render_cv tasks (08 §6.3, 21 §4)
// ---------------------------------------------------------------------------

/** A live render_cv task of the variant, or null. */
export async function liveRenderTask(
  db: JobsDb,
  scope: UserScope,
  cvvId: string
): Promise<{ id: string; state: string } | null> {
  const live = TASK_LIVE_STATES.map(() => "?").join(", ");
  return await queryFirst(
    db,
    `SELECT id, state FROM automation_tasks WHERE user_id = ? AND kind = 'render_cv' AND cv_variant_id = ? AND state IN (${live}) LIMIT 1`,
    scope.userId,
    cvvId,
    ...TASK_LIVE_STATES
  );
}

/** True when `deviceId` holds a live lease on the variant's render_cv task. */
export async function deviceHoldsRenderLease(
  db: JobsDb,
  scope: UserScope,
  lease: { cvvId: string; deviceId: string; now: number }
): Promise<boolean> {
  const row = await queryFirst<{ hit: number }>(
    db,
    "SELECT 1 AS hit FROM automation_tasks WHERE user_id = ? AND kind = 'render_cv' AND cv_variant_id = ? AND lease_device_id = ? AND state IN ('claimed', 'running') AND lease_expires_at > ? LIMIT 1",
    scope.userId,
    lease.cvvId,
    lease.deviceId,
    lease.now
  );
  return row !== null;
}

/**
 * The render fallback task (21 §4, created_by `system`): queued for any of
 * the user's devices with `render_cv`, at most once per variant
 * (`idempotency_key = render:<cvv_id>`).
 */
export function renderTaskStatements(
  db: JobsDb,
  scope: UserScope,
  task: {
    actorKind: ActorKind;
    applicationId: string | null;
    cvvId: string;
    now: number;
  }
): { statements: D1PreparedStatement[]; taskId: string } {
  const taskId = newId("tsk", task.now);
  const statements: D1PreparedStatement[] = [
    stmt(
      db,
      "INSERT INTO automation_tasks (id, user_id, kind, application_id, cv_variant_id, payload, state, target_device_id, required_capabilities, priority, not_before, expires_at, created_by, idempotency_key, revision, created_at, updated_at) VALUES (?, ?, 'render_cv', ?, ?, '{}', 'queued', NULL, '[\"render_cv\"]', 0, ?, ?, 'system', ?, 1, ?, ?) ON CONFLICT(user_id, idempotency_key) DO NOTHING",
      taskId,
      scope.userId,
      task.applicationId,
      task.cvvId,
      task.now,
      task.now + TASK_QUEUE_TTL_MS,
      `render:${task.cvvId}`,
      task.now,
      task.now
    ),
    stmt(
      db,
      "INSERT INTO change_log (user_id, entity, entity_id, revision, op, changed_at) SELECT user_id, 'task', id, revision, 'upsert', ? FROM automation_tasks WHERE id = ? AND user_id = ?",
      task.now,
      taskId,
      scope.userId
    ),
  ];
  if (task.applicationId) {
    statements.push(
      ...appendEvent(
        db,
        scope,
        {
          applicationId: task.applicationId,
          type: "automation_task_created",
          actorKind: task.actorKind,
          taskId,
          payload: { task_id: taskId, state: "queued", kind: "render_cv" },
          idempotencyKey: `render-task:${task.cvvId}`,
        },
        task.now
      ).statements
    );
  }
  return { taskId, statements };
}

// ---------------------------------------------------------------------------
// Tailoring inputs (08 §4.1 steps 3, V6)
// ---------------------------------------------------------------------------

export interface TailoringPosting {
  company_name: string;
  description_text: string;
  requirements: string[];
  seniority: string | null;
  title: string;
}

/** The posting behind an application, read through the user's own user_job. */
export async function loadTailoringPosting(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<TailoringPosting | null> {
  const row = await queryFirst<{
    company_name: string;
    description_text: string;
    requirements: string;
    seniority: string | null;
    title: string;
  }>(
    db,
    "SELECT p.title, p.company_name, p.seniority, p.description_text, p.requirements FROM applications AS a JOIN user_jobs AS u ON u.id = a.user_job_id AND u.user_id = a.user_id JOIN job_postings AS p ON p.id = u.posting_id WHERE a.id = ? AND a.user_id = ?",
    applicationId,
    scope.userId
  );
  if (!row) {
    return null;
  }
  return {
    title: row.title,
    company_name: row.company_name,
    seniority: row.seniority,
    description_text: row.description_text,
    requirements: decodeJson<string[]>(row.requirements, []).filter(
      (r) => typeof r === "string"
    ),
  };
}

/** The user's facts among `keys` (parsed values). */
export async function loadFactsByKey(
  db: JobsDb,
  scope: UserScope,
  keys: readonly string[]
): Promise<Map<string, unknown>> {
  if (keys.length === 0) {
    return new Map();
  }
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await queryAll<{ key: string; value: string }>(
    db,
    `SELECT key, value FROM applicant_facts WHERE user_id = ? AND key IN (${placeholders})`,
    scope.userId,
    ...keys
  );
  return new Map(
    rows.map((row) => [row.key, decodeJson<unknown>(row.value, null)])
  );
}

// ---------------------------------------------------------------------------
// Sweeps (cron)
// ---------------------------------------------------------------------------

export interface SweepVariant {
  application_id: string | null;
  id: string;
  updated_at: number;
  user_id: string;
}

/**
 * Tailored variants still without a PDF `graceMs` after tailoring, with no
 * render task yet (08 §4.1 step 8 safety net).
 */
export async function listRenderFallbackCandidates(
  db: JobsDb,
  options: { before: number; limit: number }
): Promise<SweepVariant[]> {
  // sql-allow: system — the cron finds unrendered variants across users
  const sql =
    "SELECT v.id, v.user_id, v.application_id, v.updated_at FROM cv_variants AS v WHERE v.status = 'generating' AND v.tailored_cv_id IS NOT NULL AND v.file_id IS NULL AND v.updated_at < ? AND NOT EXISTS (SELECT 1 FROM automation_tasks AS t WHERE t.user_id = v.user_id AND t.idempotency_key = 'render:' || v.id) ORDER BY v.updated_at LIMIT ?";
  return await queryAll<SweepVariant>(db, sql, options.before, options.limit);
}

/** Variants stuck in `generating` without a tailored document (lost message). */
export async function listStalledTailoring(
  db: JobsDb,
  options: { before: number; limit: number }
): Promise<SweepVariant[]> {
  // sql-allow: system — the cron re-enqueues stalled tailoring across users
  const sql =
    "SELECT id, user_id, application_id, updated_at FROM cv_variants WHERE status = 'generating' AND tailored_cv_id IS NULL AND updated_at < ? ORDER BY updated_at LIMIT ?";
  return await queryAll<SweepVariant>(db, sql, options.before, options.limit);
}
