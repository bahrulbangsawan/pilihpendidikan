// Race-level checks of the repo fences: the interleavings a single request
// cannot produce, driven step by step against the real SQLite batch.

import { describe, expect, it } from "bun:test";
import { createTestEnv } from "../../../../test/fakes";
import {
  seedApplication,
  seedAttempt,
  seedTask,
} from "../../../../test/seed-jobs";
import { trustedScope } from "../../core/scope";
import { GuardFailedError, jobsDb } from "../core/db";
import { listExpiredLeases, planLeaseLoss } from "../core/leases";
import type { ClaimFilter } from "./claim";
import {
  CLAIM_LOST_LABEL,
  claimStatements,
  listClaimCandidates,
} from "./claim";
import { reapFence } from "./reaper";
import { executeBatch } from "./records";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";
const DEVICE = "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0D";
const OTHER_DEVICE = "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0E";
const LEASE = "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0L";
const NOW = Date.UTC(2026, 9, 12, 10);

function fixture() {
  const t = createTestEnv();
  const db = jobsDb(t.env);
  const scope = trustedScope(USER, "script");
  const app = seedApplication(t.jobsSqlite, USER, { stage: "ready" });
  const task = seedTask(t.jobsSqlite, USER, {
    application_id: app.id,
    state: "running",
    lease_id: LEASE,
    lease_device_id: DEVICE,
    lease_expires_at: NOW - 1,
    attempt_count: 1,
    created_at: NOW - 3_600_000,
    expires_at: NOW + 3_600_000,
  });
  seedAttempt(t.jobsSqlite, USER, {
    task_id: task.id,
    lease_id: LEASE,
    device_id: DEVICE,
  });
  const state = () =>
    t.jobsSqlite
      .query(
        "SELECT state, lease_id, submit_intent_at FROM automation_tasks WHERE id = ?"
      )
      .get(task.id) as {
      lease_id: string | null;
      state: string;
      submit_intent_at: number | null;
    };
  return { t, db, scope, taskId: task.id, appId: app.id, state };
}

describe("reaper fence (21 §7.1, D-19)", () => {
  it("T11-LEASE a heartbeat landing between the reaper's read and write wins", async () => {
    const fx = fixture();
    const [task] = await listExpiredLeases(fx.db, {
      now: NOW,
      limit: 10,
      scope: fx.scope,
    });
    expect(task.id).toBe(fx.taskId);
    fx.t.jobsSqlite
      .query("UPDATE automation_tasks SET lease_expires_at = ? WHERE id = ?")
      .run(NOW + 120_000, fx.taskId);
    const plan = await planLeaseLoss(fx.db, fx.scope, {
      task,
      cause: "expired",
      now: NOW,
    });
    expect(plan.effect).toBe("requeued");
    await expect(
      executeBatch(fx.db, [
        reapFence(fx.db, fx.scope, task, false, NOW),
        ...plan.statements,
      ])
    ).rejects.toBeInstanceOf(GuardFailedError);
    expect(fx.state()).toMatchObject({ state: "running", lease_id: LEASE });
  });

  it("T11-LEASE an intent landing between the reaper's read and write is never re-queued", async () => {
    const fx = fixture();
    const [task] = await listExpiredLeases(fx.db, {
      now: NOW,
      limit: 10,
      scope: fx.scope,
    });
    fx.t.jobsSqlite
      .query("UPDATE automation_tasks SET submit_intent_at = ? WHERE id = ?")
      .run(NOW - 10, fx.taskId);
    const plan = await planLeaseLoss(fx.db, fx.scope, {
      task,
      cause: "expired",
      now: NOW,
    });
    await expect(
      executeBatch(fx.db, [
        reapFence(fx.db, fx.scope, task, false, NOW),
        ...plan.statements,
      ])
    ).rejects.toBeInstanceOf(GuardFailedError);
    expect(fx.state().state).toBe("running");
    const [again] = await listExpiredLeases(fx.db, {
      now: NOW,
      limit: 10,
      scope: fx.scope,
    });
    const replan = await planLeaseLoss(fx.db, fx.scope, {
      task: again,
      cause: "expired",
      now: NOW,
    });
    expect(replan.effect).toBe("outcome_unknown");
    await executeBatch(fx.db, [
      reapFence(fx.db, fx.scope, again, false, NOW),
      ...replan.statements,
    ]);
    expect(fx.state().state).toBe("outcome_unknown");
  });
});

describe("claim statement (04 §3)", () => {
  it("T21-01 the losing batch of a raced candidate writes nothing", async () => {
    const t = createTestEnv();
    const db = jobsDb(t.env);
    const scope = trustedScope(USER, "script");
    const app = seedApplication(t.jobsSqlite, USER, { stage: "ready" });
    seedTask(t.jobsSqlite, USER, {
      application_id: app.id,
      required_capabilities: '["apply"]',
      not_before: NOW - 1000,
      expires_at: NOW + 3_600_000,
    });
    const filter = (deviceId: string): ClaimFilter => ({
      capabilities: ["apply"],
      deviceId,
      excludeAutoApply: false,
      kinds: ["apply"],
      now: NOW,
    });
    const [candidate] = await listClaimCandidates(db, scope, filter(DEVICE), 5);
    const [same] = await listClaimCandidates(
      db,
      scope,
      filter(OTHER_DEVICE),
      5
    );
    const lease = (n: string) => ({
      attemptId: `att_01JA6V8M3W8Z1T6Q4Y2B7K9C${n}`,
      cliVersion: "0.1.0",
      expiresAt: NOW + 120_000,
      leaseId: `lse_01JA6V8M3W8Z1T6Q4Y2B7K9C${n}`,
    });
    const winner = await executeBatch(
      db,
      claimStatements(db, scope, filter(DEVICE), candidate, lease("1A"))
    );
    expect(winner[0]).toHaveLength(1);
    const lost = executeBatch(
      db,
      claimStatements(db, scope, filter(OTHER_DEVICE), same, lease("2A"))
    );
    await expect(lost).rejects.toMatchObject({ label: CLAIM_LOST_LABEL });
    const attempts = t.jobsSqlite
      .query("SELECT lease_id FROM automation_attempts")
      .all() as { lease_id: string }[];
    expect(attempts.map((a) => a.lease_id)).toEqual([
      "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C1A",
    ]);
    const events = t.jobsSqlite
      .query(
        "SELECT COUNT(*) AS n FROM application_events WHERE type = 'automation_task_claimed'"
      )
      .get() as { n: number };
    expect(events.n).toBe(1);
  });
});
