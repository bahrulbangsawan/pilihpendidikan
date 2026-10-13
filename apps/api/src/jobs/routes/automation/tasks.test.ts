import { describe, expect, it } from "bun:test";
import {
  AutomationTaskRecordSchema,
  ApprovalRecordSchema,
} from "@pilihpendidikan/jobs-contracts/records";
import { TaskDetailSchema } from "@pilihpendidikan/jobs-contracts/api";
import {
  activeAutoRule,
  appRow,
  claim,
  claimOne,
  createTask,
  eventsOf,
  key,
  leasePost,
  MANAGE_SCOPES,
  NOW,
  seedReadyApp,
  setup,
  taskRow,
  toIntent,
} from "./support.test";
import type { Body } from "./support.test";

describe("task creation (05 §8, 21 §4)", () => {
  it("creates a queued apply task with 72 h expiry, the app mode and a created event", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId, { app: { mode: "manual" } });
    const res = await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "approval" },
    });
    expect(res.status).toBe(201);
    expect(AutomationTaskRecordSchema.safeParse(res.body.task).success).toBe(
      true
    );
    const task = res.body.task;
    expect(task.state).toBe("queued");
    expect(task.created_by).toBe("web");
    expect(task.required_capabilities).toEqual(["apply"]);
    expect(task.expires_at).toBe(NOW + 72 * 3_600_000);
    expect(task.payload.company_key).toBe("d:acme.com");
    expect(appRow(fx.t, app.appId).mode).toBe("approval");
    expect(eventsOf(fx.t, app.appId, "automation_task_created")).toHaveLength(
      1
    );
  });

  it("assisted tasks require headed_browser and a device that has it", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const refused = await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "assisted" },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.details.reason).toBe("no_eligible_device");
    const queued = await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "assisted" },
      queue_without_device: true,
    });
    expect(queued.status).toBe(201);
    expect(queued.body.task.required_capabilities).toEqual([
      "apply",
      "headed_browser",
    ]);
  });

  it("refuses manual mode, archived or submitted applications and unknown ids", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const manual = await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "manual" },
    });
    expect(manual.status).toBe(422);
    expect(manual.body.error).toBe("mode_not_allowed");
    const archived = seedReadyApp(fx.t, fx.userId, { app: { archived: 1 } });
    expect(
      (
        await createTask(fx.web, {
          kind: "apply",
          application_id: archived.appId,
        })
      ).status
    ).toBe(422);
    const submitted = seedReadyApp(fx.t, fx.userId, {
      app: { submission_status: "submitted_verified", stage: "applied" },
    });
    const res = await createTask(fx.web, {
      kind: "apply",
      application_id: submitted.appId,
    });
    expect(res.status).toBe(422);
    expect(res.body.details.reason).toBe("already_submitted");
    const unknown = await createTask(fx.web, {
      kind: "apply",
      application_id: "app_01JA6V8M3W8Z1T6Q4Y2B7K9C0A",
    });
    expect(unknown.status).toBe(404);
    expect((await createTask(fx.web, { kind: "apply" })).status).toBe(400);
  });

  it("refuses while automation is paused and while the automation flag is off", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    fx.t.jobsSqlite
      .query(
        "INSERT INTO user_settings (user_id, automation_paused, updated_at) VALUES (?, 1, ?)"
      )
      .run(fx.userId, NOW);
    const paused = await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
    });
    expect(paused.status).toBe(422);
    expect(paused.body.details.reason).toBe("automation_paused");
    const off = await setup({ flags: { JOBS_AUTOMATION_ENABLED: false } });
    const other = seedReadyApp(off.t, off.userId);
    const res = await createTask(off.web, {
      kind: "apply",
      application_id: other.appId,
    });
    expect(res.status).toBe(422);
    expect(res.body.details.reason).toBe("automation_disabled");
  });

  it("the body idempotency_key returns the existing task", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const body = {
      kind: "apply",
      application_id: app.appId,
      idempotency_key: "web-apply-1",
    };
    const first = await createTask(fx.web, body);
    const second = await createTask(fx.web, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.task.id).toBe(first.body.task.id);
    const other = seedReadyApp(fx.t, fx.userId);
    const mismatch = await createTask(fx.web, {
      ...body,
      application_id: other.appId,
    });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toBe("idempotency_mismatch");
  });

  it("creates discover and render_cv tasks with their capabilities", async () => {
    const fx = await setup();
    const discover = await createTask(fx.web, {
      kind: "discover",
      payload: {},
    });
    expect(discover.status).toBe(201);
    expect(discover.body.task.required_capabilities).toEqual(["discover"]);
    const missing = await createTask(fx.web, {
      kind: "discover",
      payload: { source_ids: ["src_01JA6V8M3W8Z1T6Q4Y2B7K9C0A"] },
    });
    expect(missing.status).toBe(404);
    const app = seedReadyApp(fx.t, fx.userId);
    fx.t.jobsSqlite
      .query(
        "INSERT INTO cv_variants (id, user_id, application_id, base_cv_id, template, status, created_at, updated_at) VALUES ('cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0B', ?, ?, 'cv', 'standard', 'draft', ?, ?)"
      )
      .run(fx.userId, app.appId, NOW, NOW);
    const render = await createTask(fx.web, {
      kind: "render_cv",
      cv_variant_id: "cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0B",
    });
    expect(render.status).toBe(201);
    expect(render.body.task.application_id).toBe(app.appId);
    expect(render.body.task.required_capabilities).toEqual(["render_cv"]);
  });
});

describe("task scope (D-29)", () => {
  it("TA-TASK-SCOPE the CLI's base automation:execute creates assisted/approval tasks for itself only", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const own = await createTask(fx.cli, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "approval" },
      target_device_id: fx.cli.deviceId,
    });
    expect(own.status).toBe(201);
    expect(own.body.task.created_by).toBe("cli");
    expect(own.body.task.target_device_id).toBe(fx.cli.deviceId);
    const other = await fx.client.cliSession("alice@example.com");
    const app2 = seedReadyApp(fx.t, fx.userId);
    const remote = await createTask(fx.cli, {
      kind: "apply",
      application_id: app2.appId,
      payload: { mode: "approval" },
      target_device_id: other.deviceId,
    });
    expect(remote.status).toBe(403);
    expect(remote.body.error).toBe("insufficient_scope");
    expect(remote.body.scope).toBe("automation:manage");
    const untargeted = await createTask(fx.cli, {
      kind: "apply",
      application_id: app2.appId,
      payload: { mode: "approval" },
    });
    expect(untargeted.status).toBe(403);
    const discover = await createTask(fx.cli, {
      kind: "discover",
      target_device_id: fx.cli.deviceId,
    });
    expect(discover.status).toBe(403);
  });

  it("TA-TASK-SCOPE auto tasks need automation:manage even when targeted at the caller", async () => {
    const fx = await setup({ flags: { JOBS_AUTO_MODE_ENABLED: true } });
    const app = seedReadyApp(fx.t, fx.userId);
    const res = await createTask(fx.cli, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "auto" },
      target_device_id: fx.cli.deviceId,
    });
    expect(res.status).toBe(403);
    const stepped = await fx.client.cliSession("alice@example.com", {
      scopes: MANAGE_SCOPES,
    });
    const app2 = seedReadyApp(fx.t, fx.userId);
    const remote = await createTask(stepped, {
      kind: "apply",
      application_id: app2.appId,
      payload: { mode: "approval" },
      target_device_id: fx.cli.deviceId,
    });
    expect(remote.status).toBe(201);
  });

  it("TA-TASK-SCOPE personal and read tokens cannot create tasks", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const write = await fx.client.personalToken("alice@example.com", "write");
    const res = await createTask(write, {
      kind: "apply",
      application_id: app.appId,
    });
    expect(res.status).toBe(403);
    const mcp = await fx.client.mcpOAuthToken("alice@example.com");
    expect(
      (await createTask(mcp, { kind: "apply", application_id: app.appId }))
        .status
    ).toBe(403);
  });

  it("TA-TASK-SCOPE auto tasks need an enabled rule with an approved activation covering them", async () => {
    const fx = await setup({ flags: { JOBS_AUTO_MODE_ENABLED: true } });
    const app = seedReadyApp(fx.t, fx.userId);
    const uncovered = await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "auto" },
    });
    expect(uncovered.status).toBe(422);
    expect(uncovered.body.details.reason).toBe("rule_coverage");
    const rule = await activeAutoRule(fx);
    const covered = await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "auto" },
    });
    expect(covered.status).toBe(201);
    expect(covered.body.task.payload.rule_id).toBe(rule.id);
    expect(appRow(fx.t, app.appId).automation_rule_id).toBe(rule.id);
    const offDomain = seedReadyApp(fx.t, fx.userId, {
      posting: {
        apply_domain: "lever.co",
        source_kind: "lever",
        apply_url: "https://jobs.lever.co/acme/1",
      },
    });
    expect(
      (
        await createTask(fx.web, {
          kind: "apply",
          application_id: offDomain.appId,
          payload: { mode: "auto" },
        })
      ).status
    ).toBe(422);
  });
});

describe("list, detail, retry, resume", () => {
  it("lists with filters and serves the detail with an ETag (304 on If-None-Match)", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const created = await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
    });
    await createTask(fx.web, { kind: "discover" });
    const all = await fx.web.get<Body>("/api/v1/tasks");
    expect(all.body.items).toHaveLength(2);
    const applies = await fx.web.get<Body>("/api/v1/tasks", {
      query: { kind: "apply", application_id: app.appId },
    });
    expect(applies.body.items).toHaveLength(1);
    const page = await fx.web.get<Body>("/api/v1/tasks", {
      query: { limit: 1 },
    });
    expect(page.body.items).toHaveLength(1);
    expect(page.body.next_cursor).not.toBeNull();
    const detail = await fx.web.get<Body>(
      `/api/v1/tasks/${created.body.task.id}`
    );
    expect(detail.status).toBe(200);
    expect(TaskDetailSchema.safeParse(detail.body).success).toBe(true);
    expect(detail.body.context.kind).toBe("apply");
    const etag = detail.headers.get("ETag") as string;
    const again = await fx.web.get<Body>(
      `/api/v1/tasks/${created.body.task.id}`,
      { headers: { "If-None-Match": etag } }
    );
    expect(again.status).toBe(304);
    await claimOne(fx.cli, ["apply"]);
    const changed = await fx.web.get<Body>(
      `/api/v1/tasks/${created.body.task.id}`,
      { headers: { "If-None-Match": etag } }
    );
    expect(changed.status).toBe(200);
    expect(changed.body.attempts).toHaveLength(1);
    expect(changed.body.device_name).toBe("Test laptop (macOS)");
  });

  it("TA-RETRY retry from failed creates a new task with retry_of; the old one stays terminal", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    await createTask(fx.web, { kind: "apply", application_id: app.appId });
    const { taskId, leaseId } = await claimOne(fx.cli);
    await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "failed",
      error_class: "unsupported_form",
    });
    expect(taskRow(fx.t, taskId).state).toBe("failed");
    const res = await fx.web.post<Body>(
      `/api/v1/tasks/${taskId}/retry`,
      {},
      { idempotencyKey: key("retry") }
    );
    expect(res.status).toBe(201);
    expect(res.body.task.retry_of).toBe(taskId);
    expect(res.body.task.state).toBe("queued");
    expect(res.body.task.id).not.toBe(taskId);
    expect(taskRow(fx.t, taskId).state).toBe("failed");
    const notTerminal = await fx.web.post<Body>(
      `/api/v1/tasks/${res.body.task.id}/retry`,
      {},
      { idempotencyKey: key("retry") }
    );
    expect(notTerminal.status).toBe(422);
  });

  it("TA-RETRY from outcome_unknown needs confirm_not_submitted, recorded as the user's decision", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const { taskId, leaseId } = await toIntent(fx, app);
    await leasePost(fx.cli, taskId, leaseId, "result", {
      outcome: "outcome_unknown",
    });
    expect(appRow(fx.t, app.appId).submission_status).toBe("outcome_unknown");
    const refused = await fx.web.post<Body>(
      `/api/v1/tasks/${taskId}/retry`,
      {},
      { idempotencyKey: key("r") }
    );
    expect(refused.status).toBe(422);
    expect(refused.body.details.reason).toBe("confirm_not_submitted_required");
    const res = await fx.web.post<Body>(
      `/api/v1/tasks/${taskId}/retry`,
      { confirm_not_submitted: true },
      { idempotencyKey: key("r") }
    );
    expect(res.status).toBe(201);
    expect(appRow(fx.t, app.appId).submission_status).toBe("failed");
    const decision = eventsOf(fx.t, app.appId, "submission_status_changed").at(
      -1
    ) as Record<string, unknown>;
    expect(decision.actor_kind).toBe("user");
    expect(decision.to_value).toBe("failed");
    const created = eventsOf(fx.t, app.appId, "automation_task_created").at(
      -1
    ) as Record<string, unknown>;
    expect(JSON.parse(created.payload as string)).toMatchObject({
      confirm_not_submitted: true,
      retry_of: taskId,
    });
    expect(taskRow(fx.t, taskId).state).toBe("outcome_unknown");
  });

  it("TA-RESUME resume only for paused tasks; the flag reaches the device once", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    await createTask(fx.web, { kind: "apply", application_id: app.appId });
    const { taskId, leaseId } = await claimOne(fx.cli);
    const early = await fx.web.post<Body>(
      `/api/v1/tasks/${taskId}/resume`,
      undefined,
      { idempotencyKey: key("res") }
    );
    expect(early.status).toBe(422);
    await leasePost(fx.cli, taskId, leaseId, "events", {
      events: [
        {
          type: "paused",
          pause_reason: "mfa_required",
          idempotency_key: key("p"),
          occurred_at: NOW,
        },
      ],
    });
    const res = await fx.web.post<Body>(
      `/api/v1/tasks/${taskId}/resume`,
      undefined,
      { idempotencyKey: key("res") }
    );
    expect(res.status).toBe(200);
    expect(taskRow(fx.t, taskId).resume_requested).toBe(true);
    const beat = await leasePost(fx.cli, taskId, leaseId, "heartbeat", {
      progress: { stage: "filling", step: 2, message: "x" },
      local_state: "paused",
    });
    expect(beat.body.resume_requested).toBe(true);
    expect(taskRow(fx.t, taskId).resume_requested).toBe(false);
    const read = await fx.client.personalToken("alice@example.com", "read");
    expect(
      (
        await read.post<Body>(`/api/v1/tasks/${taskId}/resume`, undefined, {
          idempotencyKey: key(),
        })
      ).status
    ).toBe(403);
    expect((await claim(fx.cli)).status).toBe(204);
  });

  it("approval records listed by the queue parse against the contract", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    await createTask(fx.web, { kind: "apply", application_id: app.appId });
    const { taskId, leaseId } = await claimOne(fx.cli);
    await leasePost(fx.cli, taskId, leaseId, "approvals", {
      kind: "answer",
      payload: {
        type: "answer",
        questions: [
          {
            ref: "q1",
            question: "Do you need sponsorship?",
            required: true,
            options: [],
            question_key: "requires_sponsorship",
            sensitivity: "protected",
            suggestion: null,
          },
        ],
      },
      payload_hash: "c".repeat(64),
    });
    const list = await fx.web.get<Body>("/api/v1/approvals", {
      query: { state: "pending" },
    });
    expect(list.body.items).toHaveLength(1);
    expect(ApprovalRecordSchema.safeParse(list.body.items[0]).success).toBe(
      true
    );
  });
});
