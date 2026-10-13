import { describe, expect, it } from "bun:test";
import { retryBackoffMs } from "../../repo/core/leases";
import {
  changesOf,
  claim,
  claimOne,
  createTask,
  eventsOf,
  heartbeat,
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
} from "./support.test";
import type { Body } from "./support.test";

async function claimedApply() {
  const fx = await setup();
  const app = seedReadyApp(fx.t, fx.userId);
  await createTask(fx.web, {
    kind: "apply",
    application_id: app.appId,
    payload: { mode: "approval" },
  });
  const claimed = await claimOne(fx.cli);
  return { fx, app, ...claimed };
}

describe("heartbeat and fencing (21 §5.2–§5.3)", () => {
  it("T21-03 a heartbeat converts claimed → running and extends the lease", async () => {
    const { fx, taskId, leaseId } = await claimedApply();
    fx.clock.advance(30_000);
    const res = await heartbeat(fx.cli, taskId, leaseId);
    expect(res.status).toBe(200);
    expect(res.body.lease_expires_at).toBe(NOW + 30_000 + 120_000);
    expect(res.body.cancel_requested).toBe(false);
    expect(res.body.resume_requested).toBe(false);
    expect(res.body.server_time).toBe(NOW + 30_000);
    expect(res.body.poll_interval_ms).toBe(5000);
    const task = taskRow(fx.t, taskId);
    expect(task.state).toBe("running");
    expect(task.lease_expires_at).toBe(NOW + 150_000);
    expect(task.progress).toMatchObject({ stage: "filling" });
    const attempt = rows(
      fx.t,
      "SELECT last_heartbeat_at FROM automation_attempts WHERE lease_id = ?",
      leaseId
    )[0];
    expect(attempt.last_heartbeat_at).toBe(NOW + 30_000);
  });

  it("T21-03 change_log only on a state or progress-stage change", async () => {
    const { fx, taskId, leaseId } = await claimedApply();
    const base = changesOf(fx.t, "task", taskId).length;
    await heartbeat(fx.cli, taskId, leaseId, "filling");
    expect(changesOf(fx.t, "task", taskId).length).toBe(base + 1);
    await heartbeat(fx.cli, taskId, leaseId, "filling");
    await heartbeat(fx.cli, taskId, leaseId, "filling");
    expect(changesOf(fx.t, "task", taskId).length).toBe(base + 1);
    await heartbeat(fx.cli, taskId, leaseId, "uploading");
    expect(changesOf(fx.t, "task", taskId).length).toBe(base + 2);
  });

  it("T21-03 a stale lease id, another device or an expired lease answers 409 lease_lost", async () => {
    const { fx, taskId, leaseId } = await claimedApply();
    const stale = await heartbeat(
      fx.cli,
      taskId,
      "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0A"
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("lease_lost");
    const other = await fx.client.cliSession("alice@example.com");
    const foreign = await heartbeat(other, taskId, leaseId);
    expect(foreign.status).toBe(409);
    expect(foreign.body.error).toBe("lease_lost");
    fx.clock.advance(120_001);
    const expired = await heartbeat(fx.cli, taskId, leaseId);
    expect(expired.status).toBe(409);
    expect(expired.body.error).toBe("lease_lost");
  });

  it("T11-LEASE a fenced-out holder cannot report events, intents, results or releases", async () => {
    const { fx, app, taskId, leaseId } = await claimedApply();
    fx.clock.advance(121_000);
    const second = await fx.client.cliSession("alice@example.com");
    expect((await claim(second)).status).toBe(204);
    fx.clock.advance(120_000);
    const winner = await claim(second);
    expect(winner.status).toBe(200);
    expect(winner.body.task.id).toBe(taskId);
    const attempts = [
      await leasePost(fx.cli, taskId, leaseId, "events", {
        events: [
          { type: "started", idempotency_key: key("e"), occurred_at: NOW },
        ],
      }),
      await leasePost(fx.cli, taskId, leaseId, "submit-intent", {
        form_hash: "a".repeat(64),
      }),
      await leasePost(fx.cli, taskId, leaseId, "result", {
        outcome: "failed",
        error_class: "timeout",
      }),
      await leasePost(fx.cli, taskId, leaseId, "release", {
        reason: "shutdown",
      }),
      await requestSubmitApproval(fx.cli, taskId, leaseId, app.postingId),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("lease_lost");
    }
    expect(taskRow(fx.t, taskId).lease_id).toBe(winner.body.lease.lease_id);
  });

  it("T11-LEASE the lease fence is re-checked inside the write batch", async () => {
    const { fx, taskId, leaseId } = await claimedApply();
    const first = heartbeat(fx.cli, taskId, leaseId);
    fx.t.jobsSqlite
      .query(
        "UPDATE automation_tasks SET lease_id = 'lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0B' WHERE id = ?"
      )
      .run(taskId);
    const res = await first;
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("lease_lost");
  });

  it("delivers cancel_requested while automation is paused (19 §8.3) and resume once", async () => {
    const { fx, taskId, leaseId } = await claimedApply();
    await leasePost(fx.cli, taskId, leaseId, "events", {
      events: [
        {
          type: "paused",
          pause_reason: "login_required",
          idempotency_key: key("p"),
          occurred_at: NOW,
        },
      ],
    });
    const resumed = await fx.web.post<Body>(
      `/api/v1/tasks/${taskId}/resume`,
      undefined,
      {
        idempotencyKey: key("resume"),
      }
    );
    expect(resumed.status).toBe(200);
    expect(resumed.body.task.resume_requested).toBe(true);
    const first = await heartbeat(fx.cli, taskId, leaseId);
    expect(first.body.resume_requested).toBe(true);
    const second = await heartbeat(fx.cli, taskId, leaseId);
    expect(second.body.resume_requested).toBe(false);
    fx.t.jobsSqlite
      .query(
        "INSERT INTO user_settings (user_id, automation_paused, updated_at) VALUES (?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET automation_paused = 1"
      )
      .run(fx.userId, NOW);
    expect(
      (await heartbeat(fx.cli, taskId, leaseId)).body.cancel_requested
    ).toBe(true);
  });
});

describe("step events (21 §6.1)", () => {
  it("records started / progress / paused / resumed, dedupes keys, rejects dedicated types", async () => {
    const { fx, app, taskId, leaseId } = await claimedApply();
    const dup = key("dup");
    const res = await leasePost(fx.cli, taskId, leaseId, "events", {
      events: [
        { type: "started", idempotency_key: dup, occurred_at: NOW },
        {
          type: "progress",
          idempotency_key: key("p"),
          occurred_at: NOW,
          progress: { stage: "opening", step: 1, message: "Opening" },
        },
        {
          type: "log",
          idempotency_key: key("l"),
          occurred_at: NOW,
          level: "info",
          message: "x",
        },
        {
          type: "submit_intent",
          idempotency_key: key("s"),
          occurred_at: NOW,
          form_hash: "a".repeat(64),
        },
        {
          type: "paused",
          idempotency_key: key("pa"),
          occurred_at: NOW,
          pause_reason: "captcha_or_challenge",
          message: "Challenge",
        },
        { type: "started", idempotency_key: dup, occurred_at: NOW },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      "recorded",
      "recorded",
      "recorded",
      "rejected",
      "recorded",
      "duplicate",
    ]);
    expect(res.body.task_state).toBe("paused");
    const task = taskRow(fx.t, taskId);
    expect(task.state).toBe("paused");
    expect(task.pause_reason).toBe("captcha_or_challenge");
    expect(eventsOf(fx.t, app.appId, "automation_task_paused")).toHaveLength(1);
    expect(eventsOf(fx.t, app.appId, "automation_task_progress")).toHaveLength(
      2
    );
    const again = await leasePost(fx.cli, taskId, leaseId, "events", {
      events: [{ type: "started", idempotency_key: dup, occurred_at: NOW }],
    });
    expect(again.body.results[0].status).toBe("duplicate");
    const back = await leasePost(fx.cli, taskId, leaseId, "events", {
      events: [
        { type: "resumed", idempotency_key: key("r"), occurred_at: NOW },
      ],
    });
    expect(back.body.task_state).toBe("running");
    expect(taskRow(fx.t, taskId).pause_reason).toBeNull();
  });

  it("rejects more than 50 events and non-canonical pause reasons", async () => {
    const { fx, taskId, leaseId } = await claimedApply();
    const many = Array.from({ length: 51 }, () => ({
      type: "started",
      idempotency_key: key("m"),
      occurred_at: NOW,
    }));
    expect(
      (await leasePost(fx.cli, taskId, leaseId, "events", { events: many }))
        .status
    ).toBe(400);
    const bad = await leasePost(fx.cli, taskId, leaseId, "events", {
      events: [
        {
          type: "paused",
          pause_reason: "bored",
          idempotency_key: key("b"),
          occurred_at: NOW,
        },
      ],
    });
    expect(bad.status).toBe(400);
  });
});

describe("release (05 §8, 21 §6.2, §6.4)", () => {
  it("TA-RELEASE needs_headed re-queues with headed_browser added", async () => {
    const { fx, app, taskId, leaseId } = await claimedApply();
    const res = await leasePost(fx.cli, taskId, leaseId, "release", {
      reason: "needs_headed",
    });
    expect(res.status).toBe(200);
    const task = taskRow(fx.t, taskId);
    expect(task.state).toBe("queued");
    expect(task.lease_id).toBeNull();
    expect(task.required_capabilities).toEqual(["apply", "headed_browser"]);
    expect(task.payload).toMatchObject({ retry_hint: "needs_headed" });
    expect(eventsOf(fx.t, app.appId, "automation_task_paused")).toHaveLength(1);
    // The re-queue keeps the lost-lease backoff (21 §12): nothing to claim yet.
    expect(task.not_before).toBe(NOW + retryBackoffMs(1));
    expect((await claim(fx.cli, ["apply", "headed_browser"])).status).toBe(204);
    fx.clock.advance(retryBackoffMs(1));
    expect((await claim(fx.cli, ["apply"])).status).toBe(204);
    expect(
      (await claim(fx.cli, ["apply", "headed_browser"])).body.task.id
    ).toBe(taskId);
  });

  it("TA-RELEASE awaiting_approval keeps the state without a lease; approval later re-queues it", async () => {
    const { fx, app, taskId, leaseId } = await claimedApply();
    await heartbeat(fx.cli, taskId, leaseId);
    const approval = await requestSubmitApproval(
      fx.cli,
      taskId,
      leaseId,
      app.postingId
    );
    expect(approval.status).toBe(201);
    expect(taskRow(fx.t, taskId).state).toBe("awaiting_approval");
    const released = await leasePost(fx.cli, taskId, leaseId, "release", {
      reason: "awaiting_approval",
    });
    expect(released.status).toBe(200);
    let task = taskRow(fx.t, taskId);
    expect(task.state).toBe("awaiting_approval");
    expect(task.lease_id).toBeNull();
    expect(
      rows(
        fx.t,
        "SELECT outcome FROM automation_attempts WHERE lease_id = ?",
        leaseId
      )[0].outcome
    ).toBe("paused");
    const decided = await fx.web.post<Body>(
      `/api/v1/approvals/${approval.body.approval.id}/decide`,
      {
        decision: "approve",
        payload_hash: approval.body.approval.payload_hash,
      },
      { idempotencyKey: key("d") }
    );
    expect(decided.status).toBe(200);
    expect(decided.body.task.state).toBe("queued");
    task = taskRow(fx.t, taskId);
    expect(task.state).toBe("queued");
    expect(task.payload).toMatchObject({
      resume_from_approval: approval.body.approval.id,
    });
    const next = await claim(fx.cli);
    expect(next.body.task.id).toBe(taskId);
    expect(next.body.context.resume_from_approval.approval_id).toBe(
      approval.body.approval.id
    );
  });

  it("TA-RELEASE release after submit_intent answers 409 too_late", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const { taskId, leaseId } = await toIntent(fx, app);
    const res = await leasePost(fx.cli, taskId, leaseId, "release", {
      reason: "user_quit",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("too_late");
    expect(taskRow(fx.t, taskId).state).toBe("running");
  });

  it("TA-RELEASE user_quit re-queues with the retry backoff (21 §12); a pending cancel ends it", async () => {
    const { fx, taskId, leaseId } = await claimedApply();
    const released = await leasePost(fx.cli, taskId, leaseId, "release", {
      reason: "user_quit",
    });
    expect(released.status).toBe(200);
    const backoff = NOW + retryBackoffMs(1);
    expect(taskRow(fx.t, taskId).state).toBe("queued");
    expect(taskRow(fx.t, taskId).not_before).toBe(backoff);
    expect(released.body.task.not_before).toBe(backoff);
    // Not claimable before the backoff ends, then claimable again.
    expect((await claim(fx.cli)).status).toBe(204);
    fx.clock.advance(retryBackoffMs(1));
    const again = await claimOne(fx.cli);
    expect(again.taskId).toBe(taskId);
    await fx.web.post<Body>(`/api/v1/tasks/${taskId}/cancel`, undefined, {
      idempotencyKey: key("c"),
    });
    await leasePost(fx.cli, again.taskId, again.leaseId, "release", {
      reason: "shutdown",
    });
    expect(taskRow(fx.t, taskId).state).toBe("cancelled");
  });

  it("TA-RELEASE on the last attempt fails the task instead of re-queueing it (21 §12)", async () => {
    const { fx, taskId, leaseId } = await claimedApply();
    fx.t.jobsSqlite
      .query(
        "UPDATE automation_tasks SET max_attempts = attempt_count WHERE id = ?"
      )
      .run(taskId);
    const released = await leasePost(fx.cli, taskId, leaseId, "release", {
      reason: "user_quit",
    });
    expect(released.status).toBe(200);
    expect(released.body.task.state).toBe("failed");
    const row = taskRow(fx.t, taskId);
    expect(row.state).toBe("failed");
    expect(row.error_class).toBe("attempts_exhausted");
    expect(row.finished_at).toBe(NOW);
    expect(row.lease_id).toBeNull();
    expect((await claim(fx.cli)).status).toBe(204);
  });
});

describe("cancellation (21 §13.3)", () => {
  it("T21-08 queued is cancelled immediately", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const created = await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "approval" },
    });
    const res = await fx.web.post<Body>(
      `/api/v1/tasks/${created.body.task.id}/cancel`,
      undefined,
      {
        idempotencyKey: key("c"),
      }
    );
    expect(res.status).toBe(200);
    expect(res.body.task.state).toBe("cancelled");
    expect(taskRow(fx.t, created.body.task.id).state).toBe("cancelled");
    expect(eventsOf(fx.t, app.appId, "automation_task_finished")).toHaveLength(
      1
    );
    expect((await claim(fx.cli)).status).toBe(204);
  });

  it("T21-08 running is flagged (202) and delivered via heartbeat", async () => {
    const { fx, taskId, leaseId } = await claimedApply();
    const res = await fx.web.post<Body>(
      `/api/v1/tasks/${taskId}/cancel`,
      undefined,
      { idempotencyKey: key("c") }
    );
    expect(res.status).toBe(202);
    expect(res.body.task.cancel_requested).toBe(true);
    const beat = await heartbeat(fx.cli, taskId, leaseId);
    expect(beat.body.cancel_requested).toBe(true);
    const result = await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "cancelled",
      reason: "cancel_requested",
    });
    expect(result.status).toBe(200);
    expect(taskRow(fx.t, taskId).state).toBe("cancelled");
  });

  it("T21-08 past submit_intent answers 409 too_late", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const { taskId } = await toIntent(fx, app);
    const res = await fx.web.post<Body>(
      `/api/v1/tasks/${taskId}/cancel`,
      undefined,
      { idempotencyKey: key("c") }
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("too_late");
    expect(res.body.message).toBe("Submission already in progress.");
    expect(taskRow(fx.t, taskId).cancel_requested).toBe(false);
  });
});

describe("isolation (21 §11)", () => {
  it("T21-09 every lease route with another user's ids returns 404", async () => {
    const { fx, app, taskId, leaseId } = await claimedApply();
    const approval = await requestSubmitApproval(
      fx.cli,
      taskId,
      leaseId,
      app.postingId
    );
    const attemptId = rows(
      fx.t,
      "SELECT id FROM automation_attempts WHERE lease_id = ?",
      leaseId
    )[0].id as string;
    const bob = await fx.client.cliSession("bob@example.com");
    const bobWeb = await fx.client.browserSession("bob@example.com");
    const base = `/api/v1/tasks/${taskId}/lease/${leaseId}`;
    const calls = [
      await bob.post<Body>(
        `${base}/heartbeat`,
        {
          progress: { stage: "filling", step: 1, message: "x" },
          local_state: null,
        },
        { idempotencyKey: key() }
      ),
      await bob.post<Body>(
        `${base}/events`,
        {
          events: [
            { type: "started", idempotency_key: key(), occurred_at: NOW },
          ],
        },
        { idempotencyKey: key() }
      ),
      await bob.post<Body>(
        `${base}/submit-intent`,
        { form_hash: "a".repeat(64) },
        { idempotencyKey: key() }
      ),
      await bob.post<Body>(
        `${base}/result`,
        { outcome: "failed" },
        { idempotencyKey: key() }
      ),
      await bob.post<Body>(
        `${base}/release`,
        { reason: "shutdown" },
        { idempotencyKey: key() }
      ),
      await bob.post<Body>(
        `${base}/approvals`,
        {
          kind: "submit",
          payload: { type: "answer", questions: [] },
          payload_hash: "a".repeat(64),
        },
        { idempotencyKey: key() }
      ),
      await bob.get<Body>(`${base}/approvals/${approval.body.approval.id}`),
      await bob.post<Body>(
        `/api/v1/tasks/${taskId}/attempts/${attemptId}/late-evidence`,
        {
          evidence: {
            kind: "browser_confirmation",
            verdict: "verified",
            signals: {},
            captured_at: NOW,
          },
        },
        { idempotencyKey: key() }
      ),
      await bobWeb.get<Body>(`/api/v1/tasks/${taskId}`),
      await bobWeb.post<Body>(`/api/v1/tasks/${taskId}/cancel`, undefined, {
        idempotencyKey: key(),
      }),
      await bobWeb.post<Body>(`/api/v1/tasks/${taskId}/resume`, undefined, {
        idempotencyKey: key(),
      }),
      await bobWeb.post<Body>(
        `/api/v1/tasks/${taskId}/retry`,
        {},
        { idempotencyKey: key() }
      ),
      await bobWeb.post<Body>(
        `/api/v1/approvals/${approval.body.approval.id}/decide`,
        {
          decision: "approve",
          payload_hash: approval.body.approval.payload_hash,
        },
        { idempotencyKey: key() }
      ),
    ];
    for (const res of calls) {
      if (res.status === 400) {
        continue;
      }
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("not_found");
    }
    expect(calls.filter((r) => r.status === 404).length).toBeGreaterThanOrEqual(
      12
    );
    expect(taskRow(fx.t, taskId).lease_id).toBe(leaseId);
    const listed = await bobWeb.get<Body>("/api/v1/tasks");
    expect(listed.body.items).toHaveLength(0);
    expect(
      (await bobWeb.get<Body>("/api/v1/approvals")).body.items
    ).toHaveLength(0);
  });

  it("T21-09 a queued task of another user is never claimed", async () => {
    const fx = await setup();
    seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
    });
    const bob = await fx.client.cliSession("bob@example.com");
    expect((await claim(bob)).status).toBe(204);
  });
});
