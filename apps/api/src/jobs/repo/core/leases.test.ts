import { beforeEach, describe, expect, it } from "bun:test";
import { ApplicationEventRecordSchema } from "@pilihpendidikan/jobs-contracts/records";
import type { TestEnv } from "../../../../test/fakes";
import { createTestEnv } from "../../../../test/fakes";
import {
  seedApplication,
  seedAttempt,
  seedTask,
} from "../../../../test/seed-jobs";
import type { UserScope } from "../../core/scope";
import { trustedScope } from "../../core/scope";
import type { JobsDb } from "./db";
import { decodeRow, GuardFailedError, jobsDb, runBatch } from "./db";
import {
  decideLeaseEffect,
  LEASE_DURATION_MS,
  listDeviceLeases,
  listExpiredLeases,
  loadLeaseTask,
  planLeaseLoss,
  retryBackoffMs,
} from "./leases";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";
const OTHER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0B";
const DEVICE = "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0D";
const NOW = Date.UTC(2026, 9, 12, 10);

let t: TestEnv;
let db: JobsDb;
let scope: UserScope;

beforeEach(() => {
  t = createTestEnv();
  db = jobsDb(t.env);
  scope = trustedScope(USER, "script");
});

let leaseCounter = 10;

function seedLeased(overrides: Record<string, string | number | null> = {}) {
  const application = seedApplication(t.jobsSqlite, USER, {
    stage: "ready",
    submission_status: "in_progress",
  });
  leaseCounter += 1;
  const leaseId = `lse_01JA6V8M3W8Z1T6Q4Y2B7K9C${String(leaseCounter).padStart(2, "0")}`;
  const task = seedTask(t.jobsSqlite, USER, {
    application_id: application.id,
    state: "running",
    lease_id: leaseId,
    lease_device_id: DEVICE,
    lease_expires_at: NOW - 1,
    attempt_count: 1,
    max_attempts: 3,
    created_at: NOW - 3_600_000,
    ...overrides,
  });
  const attempt = seedAttempt(t.jobsSqlite, USER, {
    task_id: task.id,
    lease_id: leaseId,
    device_id: DEVICE,
  });
  return { application, task, attempt, leaseId };
}

const row = (table: string, id: string) =>
  t.jobsSqlite.query(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;

async function lose(
  taskId: string,
  cause: "expired" | "device_revoked" = "expired"
) {
  const task = await loadLeaseTask(db, scope, taskId);
  if (!task) {
    throw new Error("task missing");
  }
  const plan = await planLeaseLoss(db, scope, { task, cause, now: NOW });
  await runBatch(db, plan.statements);
  return plan.effect;
}

function events(applicationId: string) {
  return (
    t.jobsSqlite
      .query(
        "SELECT * FROM application_events WHERE application_id = ? ORDER BY rowid"
      )
      .all(applicationId) as Record<string, unknown>[]
  ).map((r) => decodeRow<Record<string, unknown>>("application_events", r));
}

describe("TCORE-LEASE-EFFECTS lease expiry and revocation (21 §7, §10)", () => {
  it("TCORE-LEASE-EFFECTS decides the effect in 21 §7.1 order", () => {
    const base = {
      attempt_count: 1,
      max_attempts: 3,
      state: "running" as const,
      submit_intent_at: null,
    };
    expect(decideLeaseEffect({ ...base, submit_intent_at: 5 })).toBe(
      "outcome_unknown"
    );
    expect(
      decideLeaseEffect({
        ...base,
        state: "awaiting_approval",
        submit_intent_at: 5,
      })
    ).toBe("outcome_unknown");
    expect(decideLeaseEffect({ ...base, state: "awaiting_approval" })).toBe(
      "awaiting_approval_unleased"
    );
    expect(decideLeaseEffect(base)).toBe("requeued");
    expect(decideLeaseEffect({ ...base, attempt_count: 3 })).toBe("failed");
    expect(retryBackoffMs(1)).toBe(120_000);
    expect(retryBackoffMs(2)).toBe(240_000);
    expect(LEASE_DURATION_MS).toBe(120_000);
  });

  it("TCORE-LEASE-EFFECTS after submit_intent: outcome_unknown, never re-queued (D-19)", async () => {
    const { application, task, attempt } = seedLeased({
      submit_intent_at: NOW - 60_000,
    });
    expect(await lose(task.id)).toBe("outcome_unknown");
    expect(row("automation_tasks", task.id)).toMatchObject({
      state: "outcome_unknown",
      lease_id: null,
      lease_device_id: null,
      lease_expires_at: null,
      error_class: "lease_expired",
      finished_at: NOW,
      revision: 2,
    });
    expect(row("automation_attempts", attempt.id)).toMatchObject({
      outcome: "outcome_unknown",
      ended_at: NOW,
    });
    expect(row("applications", application.id)).toMatchObject({
      submission_status: "outcome_unknown",
      stage: "ready",
    });
    const types = events(application.id).map((e) => e.type);
    expect(types).toEqual([
      "submission_status_changed",
      "automation_task_finished",
    ]);
    for (const event of events(application.id)) {
      expect(ApplicationEventRecordSchema.safeParse(event).success).toBe(true);
    }
  });

  it("TCORE-LEASE-EFFECTS awaiting_approval keeps its state without a lease", async () => {
    const { task, attempt, application } = seedLeased({
      state: "awaiting_approval",
    });
    expect(await lose(task.id)).toBe("awaiting_approval_unleased");
    expect(row("automation_tasks", task.id)).toMatchObject({
      state: "awaiting_approval",
      lease_id: null,
      finished_at: null,
    });
    expect(row("automation_attempts", attempt.id).outcome).toBe(
      "lease_expired"
    );
    expect(row("applications", application.id).submission_status).toBe(
      "in_progress"
    );
  });

  it("TCORE-LEASE-EFFECTS re-queues with backoff while attempts remain", async () => {
    const { task, attempt } = seedLeased({
      state: "paused",
      pause_reason: "login_required",
      resume_requested: 1,
    });
    expect(await lose(task.id)).toBe("requeued");
    expect(row("automation_tasks", task.id)).toMatchObject({
      state: "queued",
      lease_id: null,
      not_before: NOW + 120_000,
      pause_reason: null,
      resume_requested: 0,
      error_class: "lease_expired",
    });
    expect(row("automation_attempts", attempt.id)).toMatchObject({
      outcome: "lease_expired",
      error_class: "lease_expired",
    });
  });

  it("TCORE-LEASE-EFFECTS fails with lease_expired when attempts are exhausted", async () => {
    const { task } = seedLeased({ attempt_count: 3 });
    expect(await lose(task.id)).toBe("failed");
    expect(row("automation_tasks", task.id)).toMatchObject({
      state: "failed",
      error_class: "lease_expired",
      finished_at: NOW,
    });
  });

  it("TCORE-LEASE-EFFECTS a revoked device frees its pinned task and records device_revoked", async () => {
    const { task } = seedLeased({ target_device_id: DEVICE });
    expect(await listDeviceLeases(db, scope, DEVICE)).toHaveLength(1);
    expect(await lose(task.id, "device_revoked")).toBe("requeued");
    expect(row("automation_tasks", task.id)).toMatchObject({
      state: "queued",
      target_device_id: null,
      error_class: "device_revoked",
    });
  });

  it("TCORE-LEASE-EFFECTS is fenced on the old lease (a new claim is never clobbered)", async () => {
    const { task } = seedLeased();
    const loaded = await loadLeaseTask(db, scope, task.id);
    const plan = await planLeaseLoss(db, scope, {
      task: loaded as NonNullable<typeof loaded>,
      cause: "expired",
      now: NOW,
    });
    t.jobsSqlite
      .query(
        "UPDATE automation_tasks SET lease_id = 'lse_01JA6V8M3W8Z1T6Q4Y2B7K9C99' WHERE id = ?"
      )
      .run(task.id);
    await expect(runBatch(db, plan.statements)).rejects.toBeInstanceOf(
      GuardFailedError
    );
    expect(row("automation_tasks", task.id).state).toBe("running");
  });

  async function planThen(
    taskId: string,
    race: string,
    cause: "expired" | "device_revoked" = "expired"
  ) {
    const loaded = await loadLeaseTask(db, scope, taskId);
    const plan = await planLeaseLoss(db, scope, {
      task: loaded as NonNullable<typeof loaded>,
      cause,
      now: NOW,
    });
    t.jobsSqlite.query(race).run(taskId);
    return plan;
  }

  it("TCORE-LEASE-EFFECTS a submit-intent landing after the read aborts the re-queue (D-19)", async () => {
    const { task } = seedLeased();
    const plan = await planThen(
      task.id,
      `UPDATE automation_tasks SET submit_intent_at = ${NOW - 10} WHERE id = ?`
    );
    expect(plan.effect).toBe("requeued");
    await expect(runBatch(db, plan.statements)).rejects.toBeInstanceOf(
      GuardFailedError
    );
    expect(row("automation_tasks", task.id)).toMatchObject({
      state: "running",
      submit_intent_at: NOW - 10,
    });
    // A fresh plan from the current row ends in outcome_unknown.
    expect(await lose(task.id)).toBe("outcome_unknown");
  });

  it("TCORE-LEASE-EFFECTS a heartbeat landing after the read keeps the task alive", async () => {
    const { task } = seedLeased();
    const plan = await planThen(
      task.id,
      `UPDATE automation_tasks SET lease_expires_at = ${NOW + LEASE_DURATION_MS} WHERE id = ?`
    );
    await expect(runBatch(db, plan.statements)).rejects.toBeInstanceOf(
      GuardFailedError
    );
    expect(row("automation_tasks", task.id).state).toBe("running");
  });

  it("TCORE-LEASE-EFFECTS a cancel requested while leased cancels instead of re-queueing", async () => {
    const { task, attempt } = seedLeased({ cancel_requested: 1 });
    expect(await lose(task.id, "device_revoked")).toBe("cancelled");
    expect(row("automation_tasks", task.id)).toMatchObject({
      state: "cancelled",
      lease_id: null,
    });
    expect(row("automation_attempts", attempt.id).outcome).toBe("cancelled");
  });

  it("TCORE-LEASE-EFFECTS a cancel landing after the read aborts the re-queue", async () => {
    const { task } = seedLeased();
    const plan = await planThen(
      task.id,
      "UPDATE automation_tasks SET cancel_requested = 1 WHERE id = ?"
    );
    await expect(runBatch(db, plan.statements)).rejects.toBeInstanceOf(
      GuardFailedError
    );
    expect(await lose(task.id)).toBe("cancelled");
  });

  it("TCORE-LEASE-EFFECTS lists expired leases per user and system-wide", async () => {
    seedLeased();
    seedLeased({ lease_expires_at: NOW + 60_000 });
    seedTask(t.jobsSqlite, OTHER, {
      state: "claimed",
      lease_id: "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C77",
      lease_expires_at: NOW - 5,
    });
    expect(
      await listExpiredLeases(db, { now: NOW, limit: 10, scope })
    ).toHaveLength(1);
    const all = await listExpiredLeases(db, { now: NOW, limit: 10 });
    expect(all.map((task) => task.user_id).sort()).toEqual([USER, OTHER]);
  });
});
