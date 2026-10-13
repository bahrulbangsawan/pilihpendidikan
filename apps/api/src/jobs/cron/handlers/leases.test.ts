import { describe, expect, it, spyOn } from "bun:test";
import type { TestEnv } from "../../../../test/fakes";
import { createCtx } from "../../../../test/fakes";
import { seedAttempt } from "../../../../test/seed-jobs";
import { jobsDb } from "../../repo/core/db";
import {
  appRow,
  claim,
  claimOne,
  createTask,
  DAY,
  eventsOf,
  heartbeat,
  HOUR,
  key,
  leasePost,
  NOW,
  requestSubmitApproval,
  rows,
  seedQueued,
  seedReadyApp,
  setup,
  taskRow,
  toIntent,
} from "../../routes/automation/support.test";
import type { Body } from "../../routes/automation/support.test";
import type { CronContext } from "../types";
import { runLeaseCron } from "./leases";

async function runCron(t: TestEnv, now: number): Promise<void> {
  const cc: CronContext = {
    env: t.env,
    ctx: createCtx(),
    db: jobsDb(t.env),
    cron: "*/5 * * * *",
    now,
    log: () => undefined,
  };
  await runLeaseCron(cc);
}

let leaseSeq = 0;

/** A task leased by `deviceId` whose lease expired at `NOW - 1`. */
function seedLeased(
  t: TestEnv,
  userId: string,
  deviceId: string,
  overrides: Record<string, string | number | null> = {}
): { appId: string; leaseId: string; taskId: string } {
  leaseSeq += 1;
  const leaseId = `lse_01JA6V8M3W8Z1T6Q4Y2B7K${String(leaseSeq).padStart(4, "0")}`;
  const app = seedReadyApp(t, userId, {
    app: {
      submission_status: overrides.submit_intent_at
        ? "in_progress"
        : "not_started",
    },
  });
  const taskId = seedQueued(t, userId, {
    application_id: app.appId,
    state: "running",
    lease_id: leaseId,
    lease_device_id: deviceId,
    lease_expires_at: NOW - 1,
    attempt_count: 1,
    ...overrides,
  });
  seedAttempt(t.jobsSqlite, userId, {
    task_id: taskId,
    lease_id: leaseId,
    device_id: deviceId,
  });
  return { appId: app.appId, taskId, leaseId };
}

describe("the */5 reaper (21 §7.1)", () => {
  it("T21-05 reaper matrix: intent → outcome_unknown, approval wait → unleased, attempts left → queued, none → failed", async () => {
    const fx = await setup();
    const device = fx.cli.deviceId as string;
    const intent = seedLeased(fx.t, fx.userId, device, {
      submit_intent_at: NOW - 60_000,
    });
    const waiting = seedLeased(fx.t, fx.userId, device, {
      state: "awaiting_approval",
    });
    const retry = seedLeased(fx.t, fx.userId, device);
    const exhausted = seedLeased(fx.t, fx.userId, device, {
      attempt_count: 3,
      max_attempts: 3,
    });
    const alive = seedLeased(fx.t, fx.userId, device, {
      lease_expires_at: NOW + 60_000,
    });
    await runCron(fx.t, NOW);
    expect(taskRow(fx.t, intent.taskId).state).toBe("outcome_unknown");
    expect(appRow(fx.t, intent.appId).submission_status).toBe(
      "outcome_unknown"
    );
    const wait = taskRow(fx.t, waiting.taskId);
    expect(wait.state).toBe("awaiting_approval");
    expect(wait.lease_id).toBeNull();
    const requeued = taskRow(fx.t, retry.taskId);
    expect(requeued.state).toBe("queued");
    expect(requeued.not_before).toBe(NOW + 2 * 60_000);
    expect(taskRow(fx.t, exhausted.taskId).state).toBe("failed");
    expect(taskRow(fx.t, exhausted.taskId).error_class).toBe("lease_expired");
    expect(taskRow(fx.t, alive.taskId).state).toBe("running");
    const outcomes = rows(
      fx.t,
      "SELECT lease_id, outcome FROM automation_attempts ORDER BY lease_id"
    );
    const byLease = new Map(outcomes.map((o) => [o.lease_id, o.outcome]));
    expect(byLease.get(intent.leaseId)).toBe("outcome_unknown");
    expect(byLease.get(retry.leaseId)).toBe("lease_expired");
    expect(byLease.get(alive.leaseId)).toBeNull();
  });

  it("T21-05 queued tasks past expires_at become expired; a pending cancel ends cancelled", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const stale = seedQueued(fx.t, fx.userId, {
      application_id: app.appId,
      expires_at: NOW - 1,
    });
    const flagged = seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
      cancel_requested: 1,
    });
    const fresh = seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
    });
    await runCron(fx.t, NOW);
    expect(taskRow(fx.t, stale).state).toBe("expired");
    expect(taskRow(fx.t, stale).finished_at).toBe(NOW);
    expect(eventsOf(fx.t, app.appId, "automation_task_finished")).toHaveLength(
      1
    );
    expect(taskRow(fx.t, flagged).state).toBe("cancelled");
    expect(taskRow(fx.t, fresh).state).toBe("queued");
  });

  it("T21-05 a cancel requested before the lease expired ends cancelled, never re-queued", async () => {
    const fx = await setup();
    const leased = seedLeased(fx.t, fx.userId, fx.cli.deviceId as string, {
      cancel_requested: 1,
    });
    await runCron(fx.t, NOW);
    expect(taskRow(fx.t, leased.taskId).state).toBe("cancelled");
    expect(taskRow(fx.t, leased.taskId).lease_id).toBeNull();
  });

  it("T21-05 a heartbeat that lands after the reaper read wins (fence)", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    await createTask(fx.web, { kind: "apply", application_id: app.appId });
    const { taskId, leaseId } = await claimOne(fx.cli);
    fx.clock.advance(119_000);
    expect((await heartbeat(fx.cli, taskId, leaseId)).status).toBe(200);
    await runCron(fx.t, NOW + 121_000);
    expect(taskRow(fx.t, taskId).state).toBe("running");
    expect(taskRow(fx.t, taskId).lease_id).toBe(leaseId);
  });

  it("S-15 lease loss before submit_intent: attempt lease_expired, queued, retried by another device", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    await createTask(fx.web, { kind: "apply", application_id: app.appId });
    const first = await claimOne(fx.cli);
    await heartbeat(fx.cli, first.taskId, first.leaseId);
    await runCron(fx.t, NOW + 121_000);
    expect(taskRow(fx.t, first.taskId).state).toBe("queued");
    const other = await fx.client.cliSession("alice@example.com");
    fx.clock.advance(121_000 + 2 * 60_000);
    const second = await claim(other);
    expect(second.status).toBe(200);
    expect(second.body.task.id).toBe(first.taskId);
    expect(second.body.task.attempt_count).toBe(2);
    const late = await heartbeat(fx.cli, first.taskId, first.leaseId);
    expect(late.status).toBe(409);
    expect(late.body.error).toBe("lease_lost");
  });

  it("S-16 lease loss after submit_intent: outcome_unknown and no automatic retry (D-19)", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const { taskId } = await toIntent(fx, app);
    await runCron(fx.t, NOW + 121_000);
    const task = taskRow(fx.t, taskId);
    expect(task.state).toBe("outcome_unknown");
    expect(task.lease_id).toBeNull();
    expect(appRow(fx.t, app.appId).submission_status).toBe("outcome_unknown");
    await runCron(fx.t, NOW + DAY);
    const other = await fx.client.cliSession("alice@example.com");
    fx.clock.advance(DAY);
    expect((await claim(other)).status).toBe(204);
    expect(taskRow(fx.t, taskId).state).toBe("outcome_unknown");
    const finished = eventsOf(fx.t, app.appId, "automation_task_finished");
    expect(JSON.parse(finished[0].payload as string).message).toContain(
      "mark Applied or Not submitted"
    );
  });

  it("S-21 an approval expires after 24 h: approval expired, task cancelled, application stays ready", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    await createTask(fx.web, { kind: "apply", application_id: app.appId });
    const { taskId, leaseId } = await claimOne(fx.cli);
    const approval = (
      await requestSubmitApproval(fx.cli, taskId, leaseId, app.postingId)
    ).body.approval;
    await leasePost(fx.cli, taskId, leaseId, "release", {
      reason: "awaiting_approval",
    });
    await runCron(fx.t, NOW + DAY + 1);
    expect(
      rows(fx.t, "SELECT state FROM approvals WHERE id = ?", approval.id)[0]
        .state
    ).toBe("expired");
    const task = taskRow(fx.t, taskId);
    expect(task.state).toBe("cancelled");
    expect(task.error_class).toBe("approval_expired");
    expect(appRow(fx.t, app.appId).stage).toBe("ready");
    expect(appRow(fx.t, app.appId).submission_status).toBe("not_started");
    const decided = eventsOf(fx.t, app.appId, "approval_decided");
    expect(JSON.parse(decided[0].payload as string).decision).toBe("expired");
  });

  it("S-21 a leased task whose approval expired is told to stop at its next heartbeat", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    await createTask(fx.web, { kind: "apply", application_id: app.appId });
    const { taskId, leaseId } = await claimOne(fx.cli);
    await requestSubmitApproval(fx.cli, taskId, leaseId, app.postingId);
    fx.t.jobsSqlite
      .query("UPDATE automation_tasks SET lease_expires_at = ? WHERE id = ?")
      .run(NOW + DAY + 100_000, taskId);
    await runCron(fx.t, NOW + DAY + 1);
    expect(taskRow(fx.t, taskId).cancel_requested).toBe(true);
    fx.clock.advance(DAY + 2);
    expect(
      (await heartbeat(fx.cli, taskId, leaseId)).body.cancel_requested
    ).toBe(true);
  });

  it("an approval decided while the device was gone re-queues the released wait (21 §6.4)", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    await createTask(fx.web, { kind: "apply", application_id: app.appId });
    const { taskId, leaseId } = await claimOne(fx.cli);
    const approval = (
      await requestSubmitApproval(fx.cli, taskId, leaseId, app.postingId)
    ).body.approval;
    const decided = await fx.web.post<Body>(
      `/api/v1/approvals/${approval.id}/decide`,
      { decision: "approve", payload_hash: approval.payload_hash },
      { idempotencyKey: key("d") }
    );
    expect(decided.body.task.state).toBe("awaiting_approval");
    await runCron(fx.t, NOW + 121_000);
    const task = taskRow(fx.t, taskId);
    expect(task.state).toBe("queued");
    expect(task.payload).toMatchObject({ resume_from_approval: approval.id });
  });

  it("T21-07 revocation: post-intent → outcome_unknown, pre-intent → queued untargeted, approval wait kept, pinned cancelled", async () => {
    const fx = await setup();
    const device = fx.cli.deviceId as string;
    const live = { lease_expires_at: NOW + 100_000 };
    const intent = seedLeased(fx.t, fx.userId, device, {
      ...live,
      submit_intent_at: NOW - 1000,
    });
    const running = seedLeased(fx.t, fx.userId, device, {
      ...live,
      target_device_id: device,
    });
    const waiting = seedLeased(fx.t, fx.userId, device, {
      ...live,
      state: "awaiting_approval",
    });
    const pinned = seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
      target_device_id: device,
    });
    const res = await fx.web.post<Body>(
      `/api/v1/devices/${device}/revoke`,
      undefined,
      {
        idempotencyKey: key("revoke"),
      }
    );
    expect(res.status).toBe(200);
    expect(taskRow(fx.t, intent.taskId).state).toBe("outcome_unknown");
    expect(appRow(fx.t, intent.appId).submission_status).toBe(
      "outcome_unknown"
    );
    const requeued = taskRow(fx.t, running.taskId);
    expect(requeued.state).toBe("queued");
    expect(requeued.target_device_id).toBeNull();
    const wait = taskRow(fx.t, waiting.taskId);
    expect(wait.state).toBe("awaiting_approval");
    expect(wait.lease_id).toBeNull();
    expect(taskRow(fx.t, pinned).state).toBe("cancelled");
    const beat = await heartbeat(fx.cli, running.taskId, running.leaseId);
    expect(beat.status).toBe(401);
    expect(beat.body.reason).toBe("revoked_token");
    const other = await fx.client.cliSession("alice@example.com");
    fx.clock.advance(HOUR);
    const next = await claim(other);
    expect(next.status).toBe(200);
    expect(next.body.task.id).toBe(running.taskId);
    expect(
      (await claim(await fx.client.cliSession("alice@example.com"))).status
    ).toBe(204);
  });

  it("alerts: outcome_unknown bursts and lease-loss bursts log level=error (21 §15)", async () => {
    const fx = await setup();
    const device = fx.cli.deviceId as string;
    for (let i = 0; i < 4; i++) {
      seedLeased(fx.t, fx.userId, device, { submit_intent_at: NOW - 1000 });
    }
    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await runCron(fx.t, NOW);
      const lines = errors.mock.calls.map((call) => String(call[0]));
      expect(
        lines.some((line) => line.includes("alert_outcome_unknown_burst"))
      ).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });
});
