// The reaper (21 §7.1, 14 §7): every 5 minutes from cron, and lazily for
// one user at the start of every claim.
//
//   expired leases           kernel lease-loss effects (outcome_unknown after
//                            submit_intent — never re-queued, D-19; released
//                            approval waits; re-queue with backoff; failed),
//                            fenced by the reaper's own guard (lease still
//                            expired, intent / cancel as read); a lease whose
//                            cancel was requested ends `cancelled`
//   released approval waits  approved → queued (resume_from_approval);
//                            rejected / expired → cancelled
//   expired approvals        → expired; the task is cancelled (released) or
//                            told to stop (leased, pre-intent)
//   expired queued tasks     → expired
//   cancel on queued tasks   → cancelled
//   alerts (21 §15, 11 T-11) outcome_unknown > 3/h, submissions > 20/h per
//                            user, > 50 expired leases in one run

import type { AutomationTaskRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { UserScope } from "../../core/scope";
import { trustedScope } from "../../core/scope";
import {
  expireApprovalStatements,
  latestTaskApproval,
  listExpiredApprovals,
  loadApproval,
} from "../../repo/automation/approvals";
import { closeAttemptStatements } from "../../repo/automation/lease";
import { executeBatch } from "../../repo/automation/records";
import type { QueuedTaskRow } from "../../repo/automation/reaper";
import {
  cancelExpiredLeaseStatement,
  leaseExtras,
  listCancelRequestedQueued,
  listExpiredQueued,
  listSettleableApprovalTasks,
  outcomeUnknownBursts,
  reapFence,
  submissionBursts,
} from "../../repo/automation/reaper";
import {
  attemptOfLease,
  cancelUnleasedApprovalTaskStatements,
  finishUnleasedTaskStatements,
  flagCancelLeasedStatements,
  loadTask,
  resumeFromApprovalStatements,
  taskChange,
} from "../../repo/automation/tasks";
import type { JobsDb } from "../../repo/core/db";
import { GuardFailedError } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";
import type { LeaseTaskRow } from "../../repo/core/leases";
import { listExpiredLeases, planLeaseLoss } from "../../repo/core/leases";
import { SUBMISSION_BURST_PER_HOUR } from "./policy";
import { taskEvent } from "./shared";

/** Rows per scan (21 §7.1). */
const PAGE = 200;
/** Pages per cron run (≤ 5,000 rows, 14 §7). */
const MAX_PAGES = 25;
const HOUR_MS = 3_600_000;
export const OUTCOME_UNKNOWN_ALERT_PER_HOUR = 3;
export const LEASE_LOSS_ALERT_PER_RUN = 50;

export interface ReapReport {
  approvalsExpired: number;
  awaitingApproval: number;
  cancelled: number;
  expiredLeases: number;
  failed: number;
  outcomeUnknown: number;
  requeued: number;
  settled: number;
  skipped: number;
  tasksExpired: number;
}

export function emptyReport(): ReapReport {
  return {
    expiredLeases: 0,
    requeued: 0,
    failed: 0,
    outcomeUnknown: 0,
    awaitingApproval: 0,
    cancelled: 0,
    settled: 0,
    approvalsExpired: 0,
    tasksExpired: 0,
    skipped: 0,
  };
}

async function runGuarded(
  db: JobsDb,
  statements: readonly D1PreparedStatement[]
): Promise<boolean> {
  try {
    await executeBatch(db, statements);
    return true;
  } catch (err) {
    if (err instanceof GuardFailedError) {
      return false;
    }
    throw err;
  }
}

/** One expired lease (fenced; a lost race is a skip). */
async function reapLease(
  db: JobsDb,
  scope: UserScope,
  task: LeaseTaskRow,
  now: number,
  report: ReapReport
): Promise<void> {
  const extras = await leaseExtras(db, scope, task.id);
  if (!extras) {
    report.skipped += 1;
    return;
  }
  const cancelRequested = extras.cancel_requested === 1;
  const fence = reapFence(db, scope, task, cancelRequested, now);
  if (cancelRequested && task.submit_intent_at === null && task.lease_id) {
    const attempt = await attemptOfLease(db, scope, task.id, task.lease_id);
    const statements = [
      fence,
      cancelExpiredLeaseStatement(db, scope, task, now),
      taskChange(db, scope, task.id, now),
      ...(attempt
        ? closeAttemptStatements(db, scope, {
            attemptId: attempt.id,
            outcome: "cancelled",
            errorClass: "lease_expired",
            now,
          })
        : []),
      ...taskEvent(
        db,
        scope,
        { id: task.id, application_id: task.application_id },
        {
          type: "automation_task_finished",
          actorKind: "system",
          state: "cancelled",
          attemptId: attempt?.id ?? null,
          key: `task:${task.id}:finished`,
          message: "Cancelled (the device stopped responding).",
        },
        now
      ),
    ];
    if (await runGuarded(db, statements)) {
      report.cancelled += 1;
    } else {
      report.skipped += 1;
    }
    return;
  }
  const plan = await planLeaseLoss(db, scope, { task, cause: "expired", now });
  if (!(await runGuarded(db, [fence, ...plan.statements]))) {
    report.skipped += 1;
    return;
  }
  if (plan.effect === "outcome_unknown") {
    report.outcomeUnknown += 1;
  } else if (plan.effect === "requeued") {
    report.requeued += 1;
  } else if (plan.effect === "failed") {
    report.failed += 1;
  } else {
    report.awaitingApproval += 1;
  }
}

/**
 * Moves a released `awaiting_approval` task on once its newest approval is
 * decided (21 §6.4): approved → queued, rejected / expired → cancelled.
 */
export async function settleApprovalWait(
  db: JobsDb,
  scope: UserScope,
  taskId: string,
  now: number
): Promise<boolean> {
  const task = await loadTask(db, scope, taskId);
  if (
    !task ||
    task.state !== "awaiting_approval" ||
    task.lease_id !== null ||
    task.submit_intent_at !== null
  ) {
    return false;
  }
  const approval = await latestTaskApproval(db, scope, task.id);
  if (!approval || approval.state === "pending") {
    return false;
  }
  if (approval.state === "approved" && !task.cancel_requested) {
    return await runGuarded(db, [
      ...resumeFromApprovalStatements(db, scope, task.id, approval.id, now),
      ...taskEvent(
        db,
        scope,
        task,
        {
          type: "automation_task_progress",
          actorKind: "system",
          state: "queued",
          key: `task:${task.id}:resume:${approval.id}`,
          message: "Approved; the task is queued to finish the submission.",
        },
        now
      ),
    ]);
  }
  const reason =
    approval.state === "rejected" ? "approval_rejected" : "approval_expired";
  return await runGuarded(db, [
    ...cancelUnleasedApprovalTaskStatements(
      db,
      scope,
      task.id,
      task.cancel_requested ? "cancelled" : reason,
      now
    ),
    ...taskEvent(
      db,
      scope,
      task,
      {
        type: "automation_task_finished",
        actorKind: "system",
        state: "cancelled",
        errorClass: reason,
        key: `task:${task.id}:finished`,
        message: "The approval was not given; the task is cancelled.",
      },
      now
    ),
  ]);
}

/** One expired approval and its task (21 §7.1 "with the task cancelled"). */
async function expireApproval(
  db: JobsDb,
  scope: UserScope,
  approvalId: string,
  now: number
): Promise<boolean> {
  const approval = await loadApproval(db, scope, approvalId);
  if (!approval || approval.state !== "pending" || approval.expires_at > now) {
    return false;
  }
  const statements = [
    ...expireApprovalStatements(db, scope, [approval.id], now),
  ];
  let task: AutomationTaskRecord | null = null;
  if (
    approval.task_id &&
    (approval.kind === "submit" || approval.kind === "answer")
  ) {
    task = await loadTask(db, scope, approval.task_id);
  }
  if (
    task &&
    task.state === "awaiting_approval" &&
    task.submit_intent_at === null
  ) {
    if (task.lease_id === null) {
      statements.push(
        ...cancelUnleasedApprovalTaskStatements(
          db,
          scope,
          task.id,
          "approval_expired",
          now
        ),
        ...taskEvent(
          db,
          scope,
          task,
          {
            type: "automation_task_finished",
            actorKind: "system",
            state: "cancelled",
            errorClass: "approval_expired",
            key: `task:${task.id}:finished`,
            message: "The approval expired; the task is cancelled.",
          },
          now
        )
      );
    } else {
      statements.push(
        ...flagCancelLeasedStatements(
          db,
          scope,
          task.id,
          "approval_expired",
          now
        )
      );
    }
  }
  if (approval.application_id) {
    statements.push(
      ...appendEvent(
        db,
        scope,
        {
          applicationId: approval.application_id,
          type: "approval_decided",
          actorKind: "system",
          taskId: approval.task_id,
          payload: {
            approval_id: approval.id,
            kind: approval.kind,
            decision: "expired",
          },
          idempotencyKey: `approval:${approval.id}:decided`,
        },
        now
      ).statements
    );
  }
  return await runGuarded(db, statements);
}

/** Reaps one user's expired leases and released approval waits (claim path). */
export async function reapUser(
  db: JobsDb,
  scope: UserScope,
  now: number
): Promise<ReapReport> {
  const report = emptyReport();
  const expired = await listExpiredLeases(db, { now, limit: PAGE, scope });
  report.expiredLeases = expired.length;
  for (const task of expired) {
    await reapLease(db, scope, task, now, report);
  }
  const waits = await listSettleableApprovalTasks(db, { limit: 50, scope });
  for (const wait of waits) {
    if (await settleApprovalWait(db, scope, wait.id, now)) {
      report.settled += 1;
    }
  }
  return report;
}

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ evt: event, ...fields }));
}

function alert(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "error", evt: event, ...fields }));
}

/** Runs `step` on pages of rows until a page is short or moves nothing. */
async function paged<T>(
  list: () => Promise<T[]>,
  step: (row: T) => Promise<boolean>
): Promise<number> {
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await list();
    let moved = 0;
    for (const row of rows) {
      moved += (await step(row)) ? 1 : 0;
    }
    total += moved;
    if (rows.length < PAGE || moved === 0) {
      break;
    }
  }
  return total;
}

async function expiredLeasesPass(
  db: JobsDb,
  now: number,
  report: ReapReport
): Promise<void> {
  for (let page = 0; page < MAX_PAGES; page++) {
    const expired = await listExpiredLeases(db, { now, limit: PAGE });
    if (expired.length === 0) {
      return;
    }
    report.expiredLeases += expired.length;
    const before = report.skipped;
    for (const task of expired) {
      await reapLease(
        db,
        trustedScope(task.user_id, "cron"),
        task,
        now,
        report
      );
    }
    if (report.skipped - before === expired.length) {
      return;
    }
  }
}

async function finishQueued(
  db: JobsDb,
  row: QueuedTaskRow,
  input: {
    errorClass: string;
    message: string;
    now: number;
    state: "cancelled" | "expired";
  }
): Promise<boolean> {
  const scope = trustedScope(row.user_id, "cron");
  return await runGuarded(db, [
    ...finishUnleasedTaskStatements(db, scope, row, {
      state: input.state,
      errorClass: input.errorClass,
      now: input.now,
    }),
    ...taskEvent(
      db,
      scope,
      row,
      {
        type: "automation_task_finished",
        actorKind: "system",
        state: input.state,
        key: `task:${row.id}:finished`,
        message: input.message,
      },
      input.now
    ),
  ]);
}

/** The `*\/5` cron run across users (21 §7.1, §15). */
export async function runReaper(db: JobsDb, now: number): Promise<ReapReport> {
  const report = emptyReport();
  await expiredLeasesPass(db, now, report);
  report.settled = await paged(
    () => listSettleableApprovalTasks(db, { limit: PAGE }),
    (wait) =>
      settleApprovalWait(db, trustedScope(wait.user_id, "cron"), wait.id, now)
  );
  report.approvalsExpired = await paged(
    () => listExpiredApprovals(db, { now, limit: PAGE }),
    (row) => expireApproval(db, trustedScope(row.user_id, "cron"), row.id, now)
  );
  report.tasksExpired = await paged(
    () => listExpiredQueued(db, { now, limit: PAGE }),
    (row) =>
      finishQueued(db, row, {
        state: "expired",
        errorClass: "task_expired",
        message: "No device picked the task up within 72 hours.",
        now,
      })
  );
  report.cancelled += await paged(
    () => listCancelRequestedQueued(db, { limit: PAGE }),
    (row) =>
      finishQueued(db, row, {
        state: "cancelled",
        errorClass: "cancelled",
        message: "Cancelled.",
        now,
      })
  );
  await alerts(db, now, report);
  log("lease_reaper", { ...report });
  return report;
}

async function alerts(
  db: JobsDb,
  now: number,
  report: ReapReport
): Promise<void> {
  if (report.expiredLeases > LEASE_LOSS_ALERT_PER_RUN) {
    alert("alert_lease_loss_burst", { expired_leases: report.expiredLeases });
  }
  for (const row of await outcomeUnknownBursts(db, {
    since: now - HOUR_MS,
    threshold: OUTCOME_UNKNOWN_ALERT_PER_HOUR,
  })) {
    alert("alert_outcome_unknown_burst", {
      user_id: row.user_id,
      count: row.n,
    });
  }
  for (const row of await submissionBursts(db, {
    since: now - HOUR_MS,
    threshold: SUBMISSION_BURST_PER_HOUR,
  })) {
    alert("alert_submission_burst", { user_id: row.user_id, count: row.n });
  }
}
