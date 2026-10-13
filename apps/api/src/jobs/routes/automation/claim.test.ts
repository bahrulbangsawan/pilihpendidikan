import { describe, expect, it } from "bun:test";
import { newUlid } from "@pilihpendidikan/jobs-contracts/ids";
import { ClaimTaskResponseSchema } from "@pilihpendidikan/jobs-contracts/api";
import {
  appRow,
  changesOf,
  claim,
  claimOne,
  createTask,
  eventsOf,
  HOUR,
  NOW,
  rows,
  seedQueued,
  seedReadyApp,
  setup,
  taskRow,
} from "./support.test";
import type { Body } from "./support.test";

describe("claim (21 §5.1)", () => {
  it("T21-01 50 concurrent claims for 10 queued tasks yield 10 distinct winners", async () => {
    const fx = await setup();
    for (let i = 0; i < 10; i++) {
      const app = seedReadyApp(fx.t, fx.userId);
      seedQueued(fx.t, fx.userId, { application_id: app.appId });
    }
    const devices = [fx.cli];
    for (let i = 1; i < 50; i++) {
      devices.push(await fx.client.cliSession("alice@example.com"));
    }
    const responses = await Promise.all(devices.map((cli) => claim(cli)));
    const winners = responses.filter((r) => r.status === 200);
    expect(winners).toHaveLength(10);
    expect(responses.filter((r) => r.status === 204)).toHaveLength(40);
    const taskIds = winners.map((r) => r.body.task.id);
    expect(new Set(taskIds).size).toBe(10);
    const attempts = rows(
      fx.t,
      "SELECT task_id, lease_id FROM automation_attempts"
    );
    expect(attempts).toHaveLength(10);
    expect(new Set(attempts.map((a) => a.task_id)).size).toBe(10);
    expect(new Set(attempts.map((a) => a.lease_id)).size).toBe(10);
    for (const winner of winners) {
      const row = taskRow(fx.t, winner.body.task.id);
      expect(row.state).toBe("claimed");
      expect(row.lease_id).toBe(winner.body.lease.lease_id);
      expect(row.attempt_count).toBe(1);
    }
  });

  it("S-14 two devices poll one apply task: exactly one claims, the other gets 204", async () => {
    const fx = await setup();
    const other = await fx.client.cliSession("alice@example.com");
    const app = seedReadyApp(fx.t, fx.userId);
    const created = await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "approval" },
    });
    expect(created.status).toBe(201);
    const [a, b] = await Promise.all([claim(fx.cli), claim(other)]);
    expect([a.status, b.status].sort()).toEqual([200, 204]);
    const second = await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "approval" },
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("duplicate");
    expect(second.body.details.task_id).toBe(created.body.task.id);
  });

  it("returns the 21 §5.1 bundle and writes attempt, event and change_log in one batch", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "approval" },
    });
    const res = await claim(fx.cli);
    expect(res.status).toBe(200);
    expect(ClaimTaskResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.lease.heartbeat_interval_ms).toBe(30_000);
    expect(res.body.lease.expires_at).toBe(NOW + 120_000);
    const ctx = res.body.context;
    expect(ctx.kind).toBe("apply");
    expect(ctx.application.id).toBe(app.appId);
    expect(ctx.posting.id).toBe(app.postingId);
    expect(ctx.mode).toBe("approval");
    expect(ctx.allowed_domains).toContain("greenhouse.io");
    expect(ctx.allowed_domains).toContain("boards.greenhouse.io");
    expect(ctx.adapter.id).toBe("greenhouse");
    expect(ctx.approval_policy.submit_requires_approval).toBe(true);
    const task = taskRow(fx.t, res.body.task.id);
    expect(task.state).toBe("claimed");
    expect(task.lease_device_id).toBe(fx.cli.deviceId);
    const attempts = rows(
      fx.t,
      "SELECT * FROM automation_attempts WHERE task_id = ?",
      task.id
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0].attempt_no).toBe(1);
    expect(attempts[0].lease_id).toBe(task.lease_id);
    expect(attempts[0].cli_version).toBe("0.1.0");
    expect(eventsOf(fx.t, app.appId, "automation_task_claimed")).toHaveLength(
      1
    );
    expect(changesOf(fx.t, "task", task.id).length).toBeGreaterThanOrEqual(2);
    expect(changesOf(fx.t, "attempt", attempts[0].id as string)).toHaveLength(
      1
    );
  });

  it("replays the same claim for the same Idempotency-Key", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    seedQueued(fx.t, fx.userId, { application_id: app.appId });
    seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
      kind: "apply",
    });
    const idem = `claim:${fx.cli.deviceId}:${newUlid()}`;
    const first = await claim(fx.cli, undefined, idem);
    const replay = await claim(fx.cli, undefined, idem);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(replay.body).toEqual(first.body);
    expect(rows(fx.t, "SELECT * FROM automation_attempts")).toHaveLength(1);
  });

  it("TA-CLAIM the lease carries the attempt id, on the claim and on its replay", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    seedQueued(fx.t, fx.userId, { application_id: app.appId });
    const idem = `claim:${fx.cli.deviceId}:${newUlid()}`;
    const first = await claim(fx.cli, undefined, idem);
    expect(first.status).toBe(200);
    expect(ClaimTaskResponseSchema.safeParse(first.body).success).toBe(true);
    const attempts = rows(
      fx.t,
      "SELECT id, lease_id FROM automation_attempts WHERE task_id = ?",
      first.body.task.id
    );
    expect(attempts).toHaveLength(1);
    expect(first.body.lease.attempt_id).toBe(attempts[0].id);
    expect(first.body.lease.lease_id).toBe(attempts[0].lease_id);
    const replay = await claim(fx.cli, undefined, idem);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(replay.body.lease.attempt_id).toBe(attempts[0].id);
    expect(rows(fx.t, "SELECT id FROM automation_attempts")).toHaveLength(1);
  });

  it("answers 204 with Retry-After when there is no work", async () => {
    const fx = await setup();
    const res = await claim(fx.cli);
    expect(res.status).toBe(204);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(5);
  });

  it("TA-CAPS required capabilities must be a subset of the claimed capabilities", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    const id = seedQueued(fx.t, fx.userId, {
      application_id: app.appId,
      payload: JSON.stringify({ mode: "assisted" }),
      required_capabilities: JSON.stringify(["apply", "headed_browser"]),
    });
    expect((await claim(fx.cli, ["apply"])).status).toBe(204);
    const res = await claim(fx.cli, ["apply", "headed_browser"]);
    expect(res.status).toBe(200);
    expect(res.body.task.id).toBe(id);
  });

  it("TA-CAPS one live lease per kind and device; discover runs beside apply", async () => {
    const fx = await setup();
    seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
    });
    seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
    });
    seedQueued(fx.t, fx.userId, {
      kind: "discover",
      application_id: null,
      payload: "{}",
      required_capabilities: JSON.stringify(["discover"]),
      created_at: NOW - 1000,
    });
    const first = await claim(fx.cli);
    expect(first.body.task.kind).toBe("apply");
    const second = await claim(fx.cli);
    expect(second.status).toBe(200);
    expect(second.body.task.kind).toBe("discover");
    expect(second.body.context.kind).toBe("discover");
    expect((await claim(fx.cli)).status).toBe(204);
    const other = await fx.client.cliSession("alice@example.com");
    expect((await claim(other)).body.task.kind).toBe("apply");
  });

  it("T21-02 target device, accepts_tasks = 0 and the CLI version gate", async () => {
    const fx = await setup();
    const other = await fx.client.cliSession("alice@example.com");
    const app = seedReadyApp(fx.t, fx.userId);
    const pinned = seedQueued(fx.t, fx.userId, {
      application_id: app.appId,
      target_device_id: other.deviceId,
    });
    expect((await claim(fx.cli)).status).toBe(204);
    const res = await claim(other);
    expect(res.body.task.id).toBe(pinned);

    const idle = await fx.client.cliSession("alice@example.com", {
      device: { acceptsTasks: false },
    });
    seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
    });
    const refused = await claim(idle);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("device_not_accepting_tasks");

    fx.t.env.JOBS_MIN_CLI_VERSION = "0.2.0";
    const old = await claim(fx.cli);
    expect(old.status).toBe(426);
    expect(old.body.error).toBe("cli_upgrade_required");
  });

  it("T21-02 a revoked device never claims (401 revoked_token)", async () => {
    const fx = await setup();
    seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
    });
    fx.t.sqlite
      .query("UPDATE devices SET revoked_at = ? WHERE id = ?")
      .run(NOW, fx.cli.deviceId);
    const res = await claim(fx.cli);
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe("revoked_token");
    expect(rows(fx.t, "SELECT * FROM automation_attempts")).toHaveLength(0);
  });

  it("T21-02 another device's path id is not found", async () => {
    const fx = await setup();
    const other = await fx.client.cliSession("alice@example.com");
    const res = await fx.cli.post<Body>(
      `/api/v1/devices/${other.deviceId}/tasks:claim`,
      { capabilities: ["apply"], max: 1 },
      { idempotencyKey: `claim:${other.deviceId}:${newUlid()}` }
    );
    expect(res.status).toBe(404);
  });

  it("TA-FLAGS JOBS_AUTOMATION_ENABLED off: claims answer 204 and tasks stay queued", async () => {
    const fx = await setup({ flags: { JOBS_AUTOMATION_ENABLED: false } });
    const id = seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
    });
    expect((await claim(fx.cli)).status).toBe(204);
    expect(taskRow(fx.t, id).state).toBe("queued");
  });

  it("TA-FLAGS JOBS_AUTO_MODE_ENABLED off: auto apply tasks are not claimed, approval ones are", async () => {
    const fx = await setup();
    const auto = seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
      payload: JSON.stringify({
        mode: "auto",
        rule_id: "rul_01JA6V8M3W8Z1T6Q4Y2B7K9C0A",
      }),
      priority: 5,
    });
    const approval = seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
    });
    const res = await claim(fx.cli);
    expect(res.body.task.id).toBe(approval);
    expect(taskRow(fx.t, auto).state).toBe("queued");
  });

  it("automation_paused refuses apply claims but not discovery", async () => {
    const fx = await setup();
    seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
    });
    fx.t.jobsSqlite
      .query(
        "INSERT INTO user_settings (user_id, automation_paused, updated_at) VALUES (?, 1, ?)"
      )
      .run(fx.userId, NOW);
    expect((await claim(fx.cli)).status).toBe(204);
    seedQueued(fx.t, fx.userId, {
      kind: "discover",
      application_id: null,
      payload: "{}",
      required_capabilities: JSON.stringify(["discover"]),
    });
    expect((await claim(fx.cli)).body.task.kind).toBe("discover");
  });

  it("honours not_before, expires_at and priority order", async () => {
    const fx = await setup();
    seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
      not_before: NOW + HOUR,
    });
    seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
      expires_at: NOW - 1,
    });
    const low = seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
      created_at: NOW - 2 * HOUR,
    });
    const high = seedQueued(fx.t, fx.userId, {
      application_id: seedReadyApp(fx.t, fx.userId).appId,
      priority: 3,
    });
    const first = await claim(fx.cli);
    expect(first.body.task.id).toBe(high);
    const other = await fx.client.cliSession("alice@example.com");
    expect((await claim(other)).body.task.id).toBe(low);
    const third = await fx.client.cliSession("alice@example.com");
    expect((await claim(third)).status).toBe(204);
  });

  it("lazily reaps the user's expired leases before claiming (21 §5.1 step 2)", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    await createTask(fx.web, {
      kind: "apply",
      application_id: app.appId,
      payload: { mode: "approval" },
    });
    const { taskId } = await claimOne(fx.cli);
    fx.clock.advance(121_000);
    const other = await fx.client.cliSession("alice@example.com");
    const early = await claim(other);
    expect(early.status).toBe(204);
    const reaped = taskRow(fx.t, taskId);
    expect(reaped.state).toBe("queued");
    expect(reaped.not_before).toBe(NOW + 121_000 + 2 * 60_000);
    fx.clock.advance(2 * 60_000);
    const res = await claim(other);
    expect(res.status).toBe(200);
    expect(res.body.task.id).toBe(taskId);
    expect(res.body.task.attempt_count).toBe(2);
    const attempts = rows(
      fx.t,
      "SELECT outcome FROM automation_attempts WHERE task_id = ? ORDER BY attempt_no",
      taskId
    );
    expect(attempts.map((a) => a.outcome)).toEqual(["lease_expired", null]);
  });

  it("a render_cv claim carries a single-use render ticket (PLAN C8)", async () => {
    const fx = await setup();
    const app = seedReadyApp(fx.t, fx.userId);
    fx.t.jobsSqlite
      .query(
        "INSERT INTO cv_variants (id, user_id, application_id, base_cv_id, template, status, created_at, updated_at) VALUES ('cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0A', ?, ?, 'my-cv', 'standard', 'draft', ?, ?)"
      )
      .run(fx.userId, app.appId, NOW, NOW);
    seedQueued(fx.t, fx.userId, {
      kind: "render_cv",
      application_id: app.appId,
      cv_variant_id: "cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0A",
      payload: "{}",
      required_capabilities: JSON.stringify(["render_cv"]),
      created_by: "system",
    });
    const res = await claim(fx.cli);
    expect(res.status).toBe(200);
    expect(res.body.context.kind).toBe("render_cv");
    expect(res.body.context.render.expires_in).toBe(120);
    expect(res.body.context.render.url).toContain(
      "/render/cv/cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0A?ticket="
    );
    expect(fx.t.kv.AUTH_KV.store.size).toBeGreaterThan(0);
    expect(appRow(fx.t, app.appId).stage).toBe("ready");
  });
});
