import { describe, expect, it } from "bun:test";
import {
  activeAutoRule,
  appRow,
  claim,
  claimOne,
  createTask,
  decide,
  eventsOf,
  evidence,
  FORM_HASH,
  heartbeat,
  key,
  leasePost,
  NOW,
  OTHER_HASH,
  requestSubmitApproval,
  rows,
  seedQueued,
  seedReadyApp,
  setup,
  taskRow,
  toIntent,
} from "./support.test";
import type { Body } from "./support.test";

async function approvalTask(mode: "approval" | "assisted" = "approval") {
  const fx = await setup({
    cli: {
      device: {
        capabilities: ["discover", "apply", "render_cv", "headed_browser"],
      },
    },
  });
  const app = seedReadyApp(fx.t, fx.userId);
  const created = await createTask(fx.web, {
    kind: "apply",
    application_id: app.appId,
    payload: { mode },
  });
  expect(created.status).toBe(201);
  const { taskId, leaseId } = await claimOne(fx.cli, [
    "apply",
    "headed_browser",
  ]);
  await heartbeat(fx.cli, taskId, leaseId);
  return { fx, app, taskId, leaseId };
}

describe("submit-intent (21 §6.5, D-28)", () => {
  it("T21-04 refused without an approval, then accepted with the approved one", async () => {
    const { fx, app, taskId, leaseId } = await approvalTask();
    const none = await leasePost(fx.cli, taskId, leaseId, "submit-intent", {
      form_hash: FORM_HASH,
    });
    expect(none.status).toBe(422);
    expect(none.body.details.reason).toBe("approval_required");
    const approval = await requestSubmitApproval(
      fx.cli,
      taskId,
      leaseId,
      app.postingId
    );
    const pending = await leasePost(fx.cli, taskId, leaseId, "submit-intent", {
      form_hash: FORM_HASH,
      approval_id: approval.body.approval.id,
    });
    expect(pending.status).toBe(422);
    expect(pending.body.details.reason).toBe("approval_not_approved");
    await decide(fx.web, approval.body.approval);
    const ok = await leasePost(fx.cli, taskId, leaseId, "submit-intent", {
      form_hash: FORM_HASH,
      approval_id: approval.body.approval.id,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.submit_intent_at).toBe(NOW);
    const task = taskRow(fx.t, taskId);
    expect(task.submit_intent_at).toBe(NOW);
    expect(task.state).toBe("running");
    expect(appRow(fx.t, app.appId).submission_status).toBe("in_progress");
    const events = eventsOf(fx.t, app.appId, "submit_intent");
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload as string)).toMatchObject({
      task_id: taskId,
      form_hash: FORM_HASH,
      approval_id: approval.body.approval.id,
    });
  });

  it("T21-04 S-22 refused with a mismatched form hash (a new approval is needed)", async () => {
    const { fx, app, taskId, leaseId } = await approvalTask();
    const approval = await requestSubmitApproval(
      fx.cli,
      taskId,
      leaseId,
      app.postingId
    );
    await decide(fx.web, approval.body.approval);
    const changed = await leasePost(fx.cli, taskId, leaseId, "submit-intent", {
      form_hash: OTHER_HASH,
      approval_id: approval.body.approval.id,
    });
    expect(changed.status).toBe(422);
    expect(changed.body.details.reason).toBe("approval_mismatch");
    expect(taskRow(fx.t, taskId).submit_intent_at).toBeNull();
    const second = await requestSubmitApproval(
      fx.cli,
      taskId,
      leaseId,
      app.postingId,
      OTHER_HASH
    );
    expect(second.status).toBe(201);
    expect(taskRow(fx.t, taskId).state).toBe("awaiting_approval");
  });

  it("T21-04 refused for a withdrawn or rejected application", async () => {
    for (const stage of ["withdrawn", "rejected"]) {
      const { fx, app, taskId, leaseId } = await approvalTask();
      const approval = await requestSubmitApproval(
        fx.cli,
        taskId,
        leaseId,
        app.postingId
      );
      await decide(fx.web, approval.body.approval);
      fx.t.jobsSqlite
        .query("UPDATE applications SET stage = ? WHERE id = ?")
        .run(stage, app.appId);
      const res = await leasePost(fx.cli, taskId, leaseId, "submit-intent", {
        form_hash: FORM_HASH,
        approval_id: approval.body.approval.id,
      });
      expect(res.status).toBe(422);
      expect(res.body.details.reason).toBe("application_closed");
    }
  });

  it("T21-04 refused when the application was already submitted", async () => {
    const { fx, app, taskId, leaseId } = await approvalTask();
    const approval = await requestSubmitApproval(
      fx.cli,
      taskId,
      leaseId,
      app.postingId
    );
    await decide(fx.web, approval.body.approval);
    fx.t.jobsSqlite
      .query(
        "UPDATE applications SET submission_status = 'submitted_verified' WHERE id = ?"
      )
      .run(app.appId);
    const res = await leasePost(fx.cli, taskId, leaseId, "submit-intent", {
      form_hash: FORM_HASH,
      approval_id: approval.body.approval.id,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate");
    expect(res.body.details.reason).toBe("already_submitted");
  });

  it("T21-04 an approval backs exactly one submit_intent (single use, T-06)", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const { taskId, leaseId } = await toIntent(fx, app);
    const approvalId = rows(
      fx.t,
      "SELECT id FROM approvals WHERE task_id = ?",
      taskId
    )[0].id;
    const again = await leasePost(fx.cli, taskId, leaseId, "submit-intent", {
      form_hash: FORM_HASH,
      approval_id: approvalId,
    });
    expect(again.status).toBe(422);
    expect(again.body.details.reason).toBe("approval_used");
  });

  it("T21-04 refused after the auto rule's daily limit is exceeded", async () => {
    const fx = await setup({ flags: { JOBS_AUTO_MODE_ENABLED: true } });
    const rule = await activeAutoRule(fx, {
      limits: { max_per_day: 1, max_per_company_per_30d: 3 },
    });
    const one = seedReadyApp(fx.t, fx.userId);
    const two = seedReadyApp(fx.t, fx.userId, {
      posting: { company_domain: "beta.io", company_name: "Beta" },
    });
    for (const app of [one, two]) {
      seedQueued(fx.t, fx.userId, {
        application_id: app.appId,
        payload: JSON.stringify({ mode: "auto", rule_id: rule.id }),
      });
    }
    const first = await claimOne(fx.cli);
    const firstIntent = await leasePost(
      fx.cli,
      first.taskId,
      first.leaseId,
      "submit-intent",
      {
        form_hash: FORM_HASH,
        rule_id: rule.id,
      }
    );
    expect(firstIntent.status).toBe(200);
    const other = await fx.client.cliSession("alice@example.com");
    const second = await claim(other);
    expect(second.status).toBe(204);
    const pending = rows(
      fx.t,
      "SELECT id FROM automation_tasks WHERE state = 'queued'"
    );
    expect(pending).toHaveLength(1);
    fx.t.jobsSqlite
      .query(
        "UPDATE automation_tasks SET state = 'running', lease_id = 'lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0Z', lease_device_id = ?, lease_expires_at = ?, attempt_count = 1 WHERE id = ?"
      )
      .run(other.deviceId, NOW + 100_000, pending[0].id as string);
    fx.t.jobsSqlite
      .query(
        "INSERT INTO automation_attempts (id, task_id, user_id, device_id, lease_id, attempt_no, started_at, last_heartbeat_at, cli_version) VALUES ('att_01JA6V8M3W8Z1T6Q4Y2B7K9C0Z', ?, ?, ?, 'lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0Z', 1, ?, ?, '0.1.0')"
      )
      .run(pending[0].id as string, fx.userId, other.deviceId, NOW, NOW);
    const refused = await leasePost(
      other,
      pending[0].id as string,
      "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0Z",
      "submit-intent",
      {
        form_hash: FORM_HASH,
        rule_id: rule.id,
      }
    );
    expect(refused.status).toBe(422);
    expect(refused.body.details.reason).toBe("limit_reached");
  });

  it("refuses assisted mode (the human clicks Submit) and a cancelled task", async () => {
    const assisted = await approvalTask("assisted");
    const res = await leasePost(
      assisted.fx.cli,
      assisted.taskId,
      assisted.leaseId,
      "submit-intent",
      {
        form_hash: FORM_HASH,
      }
    );
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("mode_not_allowed");
    const { fx, taskId, leaseId } = await approvalTask();
    await fx.web.post<Body>(`/api/v1/tasks/${taskId}/cancel`, undefined, {
      idempotencyKey: key("c"),
    });
    const cancelled = await leasePost(
      fx.cli,
      taskId,
      leaseId,
      "submit-intent",
      { form_hash: FORM_HASH }
    );
    expect(cancelled.status).toBe(422);
    expect(cancelled.body.details.reason).toBe("cancel_requested");
  });

  it("the global cap of 40 submissions a day applies to every mode (D-35)", async () => {
    const { fx, app, taskId, leaseId } = await approvalTask();
    const approval = await requestSubmitApproval(
      fx.cli,
      taskId,
      leaseId,
      app.postingId
    );
    await decide(fx.web, approval.body.approval);
    for (let i = 0; i < 40; i++) {
      fx.t.jobsSqlite
        .query(
          "INSERT INTO application_events (id, user_id, application_id, type, payload, actor_kind, applied_to_state, occurred_at, recorded_at, idempotency_key) VALUES (?, ?, ?, 'submit_intent', '{}', 'automation', 1, ?, ?, ?)"
        )
        .run(
          `evt_01JA6V8M3W8Z1T6Q4Y2B7K${String(i).padStart(4, "0")}`,
          fx.userId,
          app.appId,
          NOW - 1000,
          NOW - 1000,
          `seed:${i}`
        );
    }
    const res = await leasePost(fx.cli, taskId, leaseId, "submit-intent", {
      form_hash: FORM_HASH,
      approval_id: approval.body.approval.id,
    });
    expect(res.status).toBe(422);
    expect(res.body.details.reason).toBe("limit_reached");
    expect(res.body.details.limit).toBe("global");
  });
});

describe("result (21 §6.6, 20 §6.2)", () => {
  it("T21-06 submitted + verified evidence: task submitted, app applied + submitted_verified", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const { taskId, leaseId } = await toIntent(fx, app);
    const res = await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "submitted",
      evidence: evidence("verified"),
      stats: { steps_count: 12, ai_calls: 4, duration_ms: 90_000 },
    });
    expect(res.status).toBe(200);
    expect(res.body.task.state).toBe("submitted");
    expect(res.body.conflict_recorded).toBe(false);
    expect(res.body.application.stage).toBe("applied");
    const row = appRow(fx.t, app.appId);
    expect(row.stage).toBe("applied");
    expect(row.submission_status).toBe("submitted_verified");
    expect(row.submission_method).toBe("browser");
    expect(row.submitted_at).toBe(NOW);
    const task = taskRow(fx.t, taskId);
    expect(task.lease_id).toBeNull();
    expect(task.finished_at).toBe(NOW);
    const attempt = rows(
      fx.t,
      "SELECT * FROM automation_attempts WHERE lease_id = ?",
      leaseId
    )[0];
    expect(attempt.outcome).toBe("submitted");
    expect(attempt.steps_count).toBe(12);
    expect(attempt.ended_at).toBe(NOW);
    expect(
      rows(fx.t, "SELECT * FROM submission_evidence WHERE task_id = ?", taskId)
    ).toHaveLength(1);
  });

  it("T21-06 a user stage change after task creation wins over the automation (conflict)", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const { taskId, leaseId } = await toIntent(fx, app);
    fx.clock.advance(1000);
    fx.t.jobsSqlite
      .query("UPDATE applications SET stage = 'rejected' WHERE id = ?")
      .run(app.appId);
    fx.t.jobsSqlite
      .query(
        "INSERT INTO application_events (id, user_id, application_id, type, from_value, to_value, payload, actor_kind, applied_to_state, occurred_at, recorded_at, idempotency_key) VALUES ('evt_01JA6V8M3W8Z1T6Q4Y2B7K9C9Z', ?, ?, 'stage_changed', 'ready', 'rejected', '{\"from\":\"ready\",\"to\":\"rejected\"}', 'user', 1, ?, ?, 'user-move')"
      )
      .run(fx.userId, app.appId, NOW + 1000, NOW + 1000);
    const res = await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "submitted",
      evidence: evidence("unverified"),
    });
    expect(res.status).toBe(200);
    expect(res.body.conflict_recorded).toBe(true);
    const row = appRow(fx.t, app.appId);
    expect(row.stage).toBe("rejected");
    expect(row.submission_status).toBe("submitted_unverified");
    expect(eventsOf(fx.t, app.appId, "conflict_recorded")).toHaveLength(1);
  });

  it("T21-06 submission status only moves forward (a user-confirmed status is not lowered)", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const { taskId, leaseId } = await toIntent(fx, app);
    fx.t.jobsSqlite
      .query(
        "UPDATE applications SET submission_status = 'submitted_verified' WHERE id = ?"
      )
      .run(app.appId);
    const res = await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "outcome_unknown",
    });
    expect(res.status).toBe(200);
    expect(taskRow(fx.t, taskId).state).toBe("outcome_unknown");
    expect(appRow(fx.t, app.appId).submission_status).toBe(
      "submitted_verified"
    );
    const ignored = eventsOf(
      fx.t,
      app.appId,
      "submission_status_changed"
    ).filter((e) => e.to_value === "outcome_unknown");
    expect(ignored[0].applied_to_state).toBe(0);
  });

  it("after the intent a failure without negative evidence is outcome_unknown, never re-queued (D-19)", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const { taskId, leaseId } = await toIntent(fx, app);
    const res = await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "failed",
      error_class: "network_offline",
      retryable: true,
    });
    expect(res.status).toBe(200);
    expect(taskRow(fx.t, taskId).state).toBe("outcome_unknown");
    expect(appRow(fx.t, app.appId).submission_status).toBe("outcome_unknown");
    expect((await claim(fx.cli)).status).toBe(204);
  });

  it("after the intent negative evidence fails the task and the submission", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const { taskId, leaseId } = await toIntent(fx, app);
    await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "failed",
      evidence: evidence("negative"),
    });
    expect(taskRow(fx.t, taskId).state).toBe("failed");
    expect(appRow(fx.t, app.appId).submission_status).toBe("failed");
    expect(appRow(fx.t, app.appId).stage).toBe("ready");
  });

  it("TA-RETRY a retryable failure before the intent re-queues with backoff while attempts remain", async () => {
    const { fx, app, taskId, leaseId } = await approvalTask();
    const res = await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "failed",
      error_class: "network_offline",
      retryable: true,
    });
    expect(res.status).toBe(200);
    const task = taskRow(fx.t, taskId);
    expect(task.state).toBe("queued");
    expect(task.not_before).toBe(NOW + 2 * 60_000);
    expect(task.error_class).toBe("network_offline");
    expect(appRow(fx.t, app.appId).submission_status).toBe("not_started");
    const fatal = await approvalTask();
    await leasePost(fatal.fx.cli, fatal.taskId, fatal.leaseId, "result", {
      outcome: "failed",
      error_class: "login_required",
      retryable: true,
    });
    expect(taskRow(fatal.fx.t, fatal.taskId).state).toBe("failed");
  });

  it("a submitted report without a recorded intent is refused (except assisted mode)", async () => {
    const { fx, taskId, leaseId } = await approvalTask();
    const res = await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "submitted",
      evidence: evidence("verified"),
    });
    expect(res.status).toBe(422);
    expect(taskRow(fx.t, taskId).state).toBe("running");
    const assisted = await approvalTask("assisted");
    const ok = await leasePost(
      assisted.fx.cli,
      assisted.taskId,
      assisted.leaseId,
      "result",
      {
        outcome: "submitted",
        evidence: evidence("verified"),
      }
    );
    expect(ok.status).toBe(200);
    const via = eventsOf(
      assisted.fx.t,
      assisted.app.appId,
      "submission_status_changed"
    );
    expect(JSON.parse(via[0].payload as string).via).toBe(
      "assisted_user_click"
    );
  });

  it("discover tasks end succeeded and link their run", async () => {
    const fx = await setup();
    seedQueued(fx.t, fx.userId, {
      kind: "discover",
      application_id: null,
      payload: "{}",
      required_capabilities: JSON.stringify(["discover"]),
    });
    fx.t.jobsSqlite
      .query(
        "INSERT INTO discovery_runs (id, user_id, device_id, sources, status, started_at, engine_version) VALUES ('run_01JA6V8M3W8Z1T6Q4Y2B7K9C0A', ?, ?, '[]', 'completed', ?, 'test')"
      )
      .run(fx.userId, fx.cli.deviceId, NOW);
    const { taskId, leaseId } = await claimOne(fx.cli);
    const res = await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "succeeded",
      run_id: "run_01JA6V8M3W8Z1T6Q4Y2B7K9C0A",
    });
    expect(res.status).toBe(200);
    expect(taskRow(fx.t, taskId).state).toBe("succeeded");
    expect(rows(fx.t, "SELECT task_id FROM discovery_runs")[0].task_id).toBe(
      taskId
    );
  });
});

describe("late evidence (20 §6.3 A)", () => {
  async function lostAfterIntent() {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const { taskId, leaseId } = await toIntent(fx, app);
    const attemptId = rows(
      fx.t,
      "SELECT id FROM automation_attempts WHERE lease_id = ?",
      leaseId
    )[0].id as string;
    fx.clock.advance(121_000);
    expect((await claim(fx.cli)).status).toBe(204);
    expect(taskRow(fx.t, taskId).state).toBe("outcome_unknown");
    return { fx, app, taskId, leaseId, attemptId };
  }

  it("TA-LATE-EVIDENCE example A: evidence after a user rejection keeps the stage, moves status forward", async () => {
    const { fx, app, taskId, leaseId, attemptId } = await lostAfterIntent();
    fx.t.jobsSqlite
      .query("UPDATE applications SET stage = 'rejected' WHERE id = ?")
      .run(app.appId);
    fx.t.jobsSqlite
      .query(
        "INSERT INTO application_events (id, user_id, application_id, type, from_value, to_value, payload, actor_kind, applied_to_state, occurred_at, recorded_at, idempotency_key) VALUES ('evt_01JA6V8M3W8Z1T6Q4Y2B7K9C8Z', ?, ?, 'stage_changed', 'ready', 'rejected', '{\"from\":\"ready\",\"to\":\"rejected\"}', 'user', 1, ?, ?, 'user-reject')"
      )
      .run(fx.userId, app.appId, NOW + 200_000, NOW + 200_000);
    const late = await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "submitted",
      evidence: evidence("verified"),
    });
    expect(late.status).toBe(409);
    const res = await fx.cli.post<Body>(
      `/api/v1/tasks/${taskId}/attempts/${attemptId}/late-evidence`,
      { evidence: evidence("verified", NOW + 10_000), outcome: "submitted" },
      { idempotencyKey: key("late") }
    );
    expect(res.status).toBe(200);
    expect(res.body.conflict_recorded).toBe(true);
    expect(res.body.task.state).toBe("submitted");
    const row = appRow(fx.t, app.appId);
    expect(row.stage).toBe("rejected");
    expect(row.submission_status).toBe("submitted_verified");
    expect(taskRow(fx.t, taskId).state).toBe("submitted");
    const changed = eventsOf(fx.t, app.appId, "submission_status_changed").at(
      -1
    ) as Record<string, unknown>;
    expect(JSON.parse(changed.payload as string).via).toBe("late_evidence");
    expect(eventsOf(fx.t, app.appId, "conflict_recorded")).toHaveLength(1);
  });

  it("TFIX-EVIDENCE-EDGE S-24: offline submit, lease expired, user withdraws; unverified late evidence → submitted_unverified, stage kept", async () => {
    const { fx, app, taskId, leaseId, attemptId } = await lostAfterIntent();
    expect(appRow(fx.t, app.appId).submission_status).toBe("outcome_unknown");
    // The user withdraws on the web while the device is offline.
    const revision = appRow(fx.t, app.appId).revision as number;
    const withdrawn = await fx.web.patch<Body>(
      `/api/v1/applications/${app.appId}`,
      { base_revision: revision, stage: "withdrawn" },
      { idempotencyKey: key("withdraw") }
    );
    expect(withdrawn.status).toBe(200);
    // The device reconnects: the result is fenced, the evidence is not.
    const result = await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "submitted",
      evidence: evidence("unverified", NOW + 10_000),
    });
    expect(result.status).toBe(409);
    const res = await fx.cli.post<Body>(
      `/api/v1/tasks/${taskId}/attempts/${attemptId}/late-evidence`,
      { evidence: evidence("unverified", NOW + 10_000), outcome: "submitted" },
      { idempotencyKey: key("late") }
    );
    expect(res.status).toBe(200);
    expect(res.body.conflict_recorded).toBe(true);
    expect(res.body.task.state).toBe("submitted");
    expect(res.body.evidence.verdict).toBe("unverified");
    expect(res.body.application).toMatchObject({
      stage: "withdrawn",
      submission_status: "submitted_unverified",
      submitted_at: NOW + 10_000,
    });
    expect(appRow(fx.t, app.appId)).toMatchObject({
      stage: "withdrawn",
      submission_status: "submitted_unverified",
      submission_method: "browser",
    });
    expect(taskRow(fx.t, taskId).state).toBe("submitted");
    const viaLate = eventsOf(fx.t, app.appId, "submission_status_changed")
      .map((e) => ({
        ...e,
        payload: JSON.parse(e.payload as string) as { via?: string },
      }))
      .filter((e) => e.payload.via === "late_evidence");
    expect(viaLate).toHaveLength(1);
    expect(viaLate[0]).toMatchObject({
      from_value: "outcome_unknown",
      to_value: "submitted_unverified",
      applied_to_state: 1,
      actor_kind: "automation",
    });
    expect(eventsOf(fx.t, app.appId, "conflict_recorded")).toHaveLength(1);
    expect(eventsOf(fx.t, app.appId, "stage_changed").at(-1)).toMatchObject({
      to_value: "applied",
      applied_to_state: 0,
    });
  });

  it("TFIX-EVIDENCE-EDGE a user's “not submitted” stays final against later unverified evidence", async () => {
    const { fx, app, taskId, attemptId } = await lostAfterIntent();
    const revision = appRow(fx.t, app.appId).revision as number;
    const denied = await fx.web.post<Body>(
      `/api/v1/applications/${app.appId}/submission`,
      { base_revision: revision, action: "deny" },
      { idempotencyKey: key("deny") }
    );
    expect(denied.status).toBe(200);
    expect(appRow(fx.t, app.appId).submission_status).toBe("failed");
    expect(taskRow(fx.t, taskId).state).toBe("failed");
    const res = await fx.cli.post<Body>(
      `/api/v1/tasks/${taskId}/attempts/${attemptId}/late-evidence`,
      { evidence: evidence("unverified", NOW + 10_000), outcome: "submitted" },
      { idempotencyKey: key("late") }
    );
    expect(res.status).toBe(200);
    expect(res.body.task.state).toBe("failed");
    expect(appRow(fx.t, app.appId).submission_status).toBe("failed");
    expect(
      eventsOf(fx.t, app.appId, "submission_status_changed").at(-1)
    ).toMatchObject({ to_value: "submitted_unverified", applied_to_state: 0 });
    expect(
      rows(
        fx.t,
        "SELECT verdict FROM submission_evidence WHERE task_id = ?",
        taskId
      )
    ).toEqual([{ verdict: "unverified" }]);
  });

  it("TA-LATE-EVIDENCE only the device that held the attempt's lease may send it", async () => {
    const { fx, taskId, attemptId } = await lostAfterIntent();
    const other = await fx.client.cliSession("alice@example.com");
    const res = await other.post<Body>(
      `/api/v1/tasks/${taskId}/attempts/${attemptId}/late-evidence`,
      { evidence: evidence("verified") },
      { idempotencyKey: key("late") }
    );
    expect(res.status).toBe(404);
    expect(taskRow(fx.t, taskId).state).toBe("outcome_unknown");
  });

  it("TA-LATE-EVIDENCE is append-only and refused while the lease is still valid", async () => {
    const { fx, app, taskId, leaseId } = await approvalTask();
    const attemptId = rows(
      fx.t,
      "SELECT id FROM automation_attempts WHERE lease_id = ?",
      leaseId
    )[0].id as string;
    const live = await fx.cli.post<Body>(
      `/api/v1/tasks/${taskId}/attempts/${attemptId}/late-evidence`,
      { evidence: evidence("verified") },
      { idempotencyKey: key("late") }
    );
    expect(live.status).toBe(422);
    const lost = await lostAfterIntent();
    for (const verdict of ["unverified", "verified"] as const) {
      const res = await lost.fx.cli.post<Body>(
        `/api/v1/tasks/${lost.taskId}/attempts/${lost.attemptId}/late-evidence`,
        { evidence: evidence(verdict) },
        { idempotencyKey: key("late") }
      );
      expect(res.status).toBe(200);
    }
    expect(
      rows(
        lost.fx.t,
        "SELECT * FROM submission_evidence WHERE task_id = ?",
        lost.taskId
      )
    ).toHaveLength(2);
    expect(appRow(lost.fx.t, lost.app.appId).submission_status).toBe(
      "submitted_verified"
    );
    expect(appRow(fx.t, app.appId).submission_status).toBe("not_started");
  });
});
