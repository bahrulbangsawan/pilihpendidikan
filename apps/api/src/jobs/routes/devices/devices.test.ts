import { beforeEach, describe, expect, it } from "bun:test";
import type {
  FakeClock,
  TestEnv,
  V1Client,
  V1Session,
} from "../../../../test/fakes";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import {
  seedApplication,
  seedAttempt,
  seedTask,
} from "../../../../test/seed-jobs";
import { reportKey } from "../../services/devices/index";

const BODY = {
  name: "alice-mbp (macOS)",
  platform: "macos",
  arch: "arm64",
  cli_version: "0.1.0",
  capabilities: ["render_cv", "discover", "apply", "discover"],
};
const HEARTBEAT = {
  cli_version: "0.1.0",
  local_state_summary: { running: 1 },
  active_lease_ids: [] as string[],
  outbox_depth: 0,
  browser: { mode: "managed", status: "ready" },
};

let t: TestEnv;
let clock: FakeClock;
let client: V1Client;

beforeEach(() => {
  t = createTestEnv();
  clock = createFakeClock();
  client = createV1Client(t, { clock });
});

function lease(n: number): string {
  return `lse_01JA6V8M3W8Z1T6Q4Y2B7K9C${String(n).padStart(2, "0")}`;
}

function db<T = Record<string, unknown>>(
  sql: string,
  ...binds: Array<string | number | null>
): NoInfer<T> {
  return t.sqlite.query(sql).get(...binds) as T;
}

function jobs<T = Record<string, unknown>>(
  sql: string,
  ...binds: Array<string | number | null>
): NoInfer<T> {
  return t.jobsSqlite.query(sql).get(...binds) as T;
}

function deviceOf(session: V1Session): string {
  if (!session.deviceId) {
    throw new Error("session has no device");
  }
  return session.deviceId;
}

async function revision(web: V1Session, id: string): Promise<number> {
  const list = await web.get<{
    items: Array<{ id: string; revision: number }>;
  }>("/api/v1/devices", { query: { include_revoked: 1 } });
  return list.body.items.find((d) => d.id === id)?.revision ?? 0;
}

function seedLease(
  userId: string,
  deviceId: string,
  n: number,
  overrides: Record<string, string | number | null> = {},
  heartbeatAt = clock.now()
) {
  const app = seedApplication(t.jobsSqlite, userId, {
    stage: "ready",
    submission_status: "in_progress",
  });
  const task = seedTask(t.jobsSqlite, userId, {
    application_id: app.id,
    state: "running",
    lease_id: lease(n),
    lease_device_id: deviceId,
    lease_expires_at: clock.now() + 100_000,
    attempt_count: 1,
    ...overrides,
  });
  seedAttempt(t.jobsSqlite, userId, {
    task_id: task.id,
    lease_id: lease(n),
    device_id: deviceId,
    started_at: heartbeatAt,
    last_heartbeat_at: heartbeatAt,
  });
  return { task: task.id, application: app.id };
}

describe("TDEV-REGISTER POST /api/v1/devices (17 §6)", () => {
  it("TDEV-REGISTER binds the grant and its live access tokens in one batch", async () => {
    const cli = await client.cliSession("alice@example.com", { device: false });
    const res = await cli.post<{ device: Record<string, unknown> }>(
      "/api/v1/devices",
      BODY
    );
    expect(res.status).toBe(201);
    const device = res.body.device;
    expect(device).toMatchObject({
      name: "alice-mbp (macOS)",
      platform: "macos",
      arch: "arm64",
      cli_version: "0.1.0",
      capabilities: ["discover", "apply", "render_cv"],
      accepts_tasks: true,
      revoked_at: null,
      revision: 1,
      online: false,
      active: false,
      signed_in: true,
      public_key: null,
      user_id: cli.userId,
    });
    expect(device).not.toHaveProperty("grant_id");
    expect(device).not.toHaveProperty("last_ip_hash");
    expect(
      db("SELECT device_id FROM oauth_grants WHERE id = ?", cli.grantId)
    ).toEqual({ device_id: device.id as string });
    expect(
      db("SELECT device_id FROM mcp_tokens WHERE id = ?", cli.tokenId)
    ).toEqual({ device_id: device.id as string });
    expect(
      jobs(
        "SELECT entity, revision FROM change_log WHERE entity_id = ?",
        device.id as string
      )
    ).toEqual({
      entity: "device",
      revision: 1,
    });
    // The same token is device-bound from now on.
    const me = await cli.get("/api/v1/me");
    expect(me.body.device).toEqual({
      id: device.id,
      name: "alice-mbp (macOS)",
    });
  });

  it("TDEV-REGISTER a second registration on the same grant is 409 duplicate", async () => {
    const cli = await client.cliSession("alice@example.com", { device: false });
    const first = await cli.post<{ device: { id: string } }>(
      "/api/v1/devices",
      BODY
    );
    const again = await cli.post("/api/v1/devices", { ...BODY, name: "other" });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      error: "duplicate",
      details: { device_id: first.body.device.id },
    });
    expect(t.sqlite.query("SELECT id FROM devices").all()).toHaveLength(1);
    // A token whose grant already has a device (the usual CLI session) too.
    const bound = await client.cliSession("bob@example.com");
    expect((await bound.post("/api/v1/devices", BODY)).status).toBe(409);
  });

  it("TDEV-REGISTER replays an idempotent registration", async () => {
    const cli = await client.cliSession("alice@example.com", { device: false });
    const a = await cli.post("/api/v1/devices", BODY, {
      idempotencyKey: "reg-1",
    });
    const b = await cli.post("/api/v1/devices", BODY, {
      idempotencyKey: "reg-1",
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get("Idempotent-Replayed")).toBe("true");
    expect(b.body).toEqual(a.body);
  });

  it("TDEV-REGISTER only a CLI grant token with offline_access may register", async () => {
    const web = await client.browserSession("alice@example.com");
    const fromWeb = await web.post("/api/v1/devices", BODY);
    expect(fromWeb.status).toBe(403);
    expect(fromWeb.body.error).toBe("insufficient_scope");
    const noOffline = await client.cliSession("carol@example.com", {
      device: false,
      scopes: ["jobs:read", "automation:execute"],
    });
    const res = await noOffline.post("/api/v1/devices", BODY);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: "insufficient_scope",
      scope: "offline_access",
    });
    expect(t.sqlite.query("SELECT id FROM devices").all()).toHaveLength(0);
  });

  it("TDEV-REGISTER validates the body", async () => {
    const cli = await client.cliSession("alice@example.com", { device: false });
    for (const body of [
      { ...BODY, platform: "beos" },
      { ...BODY, name: "" },
      { ...BODY, name: "x".repeat(61) },
      { ...BODY, capabilities: ["teleport"] },
      { ...BODY, cli_version: "latest" },
    ]) {
      const res = await cli.post("/api/v1/devices", body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    }
    const blank = await cli.post("/api/v1/devices", {
      ...BODY,
      name: "\u0007 ",
    });
    expect(blank.status).toBe(400);
  });
});

describe("TDEV-PRESENCE online / active (04 §1)", () => {
  it("TDEV-PRESENCE online means last_seen_at ≤ 6 min; revoked devices are hidden by default", async () => {
    const cli = await client.cliSession("alice@example.com");
    const web = await client.browserSession("alice@example.com");
    const id = deviceOf(cli);
    t.sqlite
      .query("UPDATE devices SET last_seen_at = ? WHERE id = ?")
      .run(clock.now() - 359_000, id);
    let list = await web.get<{ items: Record<string, unknown>[] }>(
      "/api/v1/devices"
    );
    expect(list.body.items[0]).toMatchObject({
      id,
      online: true,
      active: false,
    });
    t.sqlite
      .query("UPDATE devices SET last_seen_at = ? WHERE id = ?")
      .run(clock.now() - 361_000, id);
    list = await web.get("/api/v1/devices");
    expect(list.body.items[0]).toMatchObject({ id, online: false });
    t.sqlite.query("UPDATE devices SET revoked_at = 1 WHERE id = ?").run(id);
    list = await web.get("/api/v1/devices");
    expect(list.body.items).toHaveLength(0);
    list = await web.get("/api/v1/devices", {
      query: { include_revoked: "true" },
    });
    expect(list.body.items[0]).toMatchObject({
      id,
      online: false,
      signed_in: false,
    });
  });

  it("TDEV-PRESENCE active means a live lease with an attempt heartbeat ≤ 90 s", async () => {
    const cli = await client.cliSession("alice@example.com");
    const web = await client.browserSession("alice@example.com");
    const id = deviceOf(cli);
    seedLease(cli.userId ?? "", id, 1, {}, clock.now() - 89_000);
    let list = await web.get<{ items: Record<string, unknown>[] }>(
      "/api/v1/devices"
    );
    expect(list.body.items[0]).toMatchObject({ id, active: true });
    t.jobsSqlite
      .query("UPDATE automation_attempts SET last_heartbeat_at = ?")
      .run(clock.now() - 91_000);
    list = await web.get("/api/v1/devices");
    expect(list.body.items[0]).toMatchObject({ id, active: false });
  });

  it("TDEV-PRESENCE presence is written at most once per 5 minutes per device", async () => {
    const cli = await client.cliSession("alice@example.com");
    const id = deviceOf(cli);
    await cli.get("/api/v1/me");
    const first = clock.now();
    expect(db("SELECT last_seen_at FROM devices WHERE id = ?", id)).toEqual({
      last_seen_at: first,
    });
    clock.advance(240_000);
    await cli.get("/api/v1/me");
    expect(db("SELECT last_seen_at FROM devices WHERE id = ?", id)).toEqual({
      last_seen_at: first,
    });
    clock.advance(61_000);
    await cli.get("/api/v1/me");
    expect(db("SELECT last_seen_at FROM devices WHERE id = ?", id)).toEqual({
      last_seen_at: clock.now(),
    });
    const web = await client.browserSession("alice@example.com");
    const list = await web.get<{ items: Record<string, unknown>[] }>(
      "/api/v1/devices"
    );
    expect(list.body.items[0]).toMatchObject({
      online: true,
      last_seen_at: clock.now(),
    });
  });

  it("TDEV-PRESENCE lists only the caller's devices, newest first, with keyset pagination", async () => {
    await client.cliSession("alice@example.com", { device: { name: "one" } });
    clock.advance(1000);
    await client.cliSession("alice@example.com", { device: { name: "two" } });
    await client.cliSession("bob@example.com", { device: { name: "bob's" } });
    const web = await client.browserSession("alice@example.com");
    const page1 = await web.get<{
      items: Array<{ name: string }>;
      next_cursor: string | null;
    }>("/api/v1/devices", { query: { limit: 1 } });
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.next_cursor).toBeTruthy();
    const page2 = await web.get<{
      items: Array<{ name: string }>;
      next_cursor: string | null;
    }>("/api/v1/devices", {
      query: { limit: 1, cursor: page1.body.next_cursor ?? "" },
    });
    const names = [...page1.body.items, ...page2.body.items].map((d) => d.name);
    expect(names.sort()).toEqual(["one", "two"]);
    expect(page2.body.next_cursor).toBeNull();
    const cli = await client.cliSession("alice@example.com");
    const denied = await cli.get("/api/v1/devices");
    expect(denied.status).toBe(403);
    expect(denied.body.scope).toBe("devices:manage");
  });
});

describe("TDEV-PATCH PATCH /api/v1/devices/{dev_id} (05 §3)", () => {
  it("TDEV-PATCH renames and toggles accepts_tasks with devices:manage and base_revision", async () => {
    const cli = await client.cliSession("alice@example.com");
    const web = await client.browserSession("alice@example.com");
    const id = deviceOf(cli);
    const res = await web.patch<{ device: Record<string, unknown> }>(
      `/api/v1/devices/${id}`,
      {
        base_revision: 1,
        name: "  Work\nlaptop  ",
        accepts_tasks: false,
      }
    );
    expect(res.status).toBe(200);
    expect(res.body.device).toMatchObject({
      name: "Work laptop",
      accepts_tasks: false,
      revision: 2,
    });
    expect(
      jobs(
        "SELECT revision FROM change_log WHERE entity = 'device' AND entity_id = ?",
        id
      )
    ).toEqual({ revision: 2 });
    const stale = await web.patch(`/api/v1/devices/${id}`, {
      base_revision: 1,
      name: "x",
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("revision_conflict");
    expect(
      (stale.body.details as { current: Record<string, unknown> }).current
    ).toMatchObject({
      id,
      revision: 2,
      name: "Work laptop",
    });
    const blank = await web.patch(`/api/v1/devices/${id}`, {
      base_revision: 2,
      name: " \t ",
    });
    expect(blank.status).toBe(400);
  });

  it("TDEV-PATCH automation:execute may toggle only its own device's accepts_tasks", async () => {
    const cli = await client.cliSession("alice@example.com");
    const other = await client.cliSession("alice@example.com", {
      device: { name: "desktop" },
    });
    const id = deviceOf(cli);
    const toggle = await cli.patch<{ device: Record<string, unknown> }>(
      `/api/v1/devices/${id}`,
      {
        base_revision: 1,
        accepts_tasks: false,
      }
    );
    expect(toggle.status).toBe(200);
    expect(toggle.body.device.accepts_tasks).toBe(false);
    const rename = await cli.patch(`/api/v1/devices/${id}`, {
      base_revision: 2,
      name: "pwned",
    });
    expect(rename.status).toBe(403);
    expect(rename.body).toMatchObject({
      error: "insufficient_scope",
      scope: "devices:manage",
    });
    const foreign = await cli.patch(`/api/v1/devices/${deviceOf(other)}`, {
      base_revision: 1,
      accepts_tasks: false,
    });
    expect(foreign.status).toBe(403);
    expect(
      db("SELECT accepts_tasks FROM devices WHERE id = ?", deviceOf(other))
    ).toEqual({ accepts_tasks: 1 });
  });

  it("TDEV-PATCH another user's device is 404 and a revoked device 403 device_revoked", async () => {
    const bob = await client.cliSession("bob@example.com");
    const web = await client.browserSession("alice@example.com");
    const res = await web.patch(`/api/v1/devices/${deviceOf(bob)}`, {
      base_revision: 1,
      name: "mine",
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
    const cli = await client.cliSession("alice@example.com");
    const id = deviceOf(cli);
    expect((await web.post(`/api/v1/devices/${id}/revoke`)).status).toBe(200);
    const after = await web.patch(`/api/v1/devices/${id}`, {
      base_revision: 2,
      name: "again",
    });
    expect(after.status).toBe(403);
    expect(after.body.error).toBe("device_revoked");
  });
});

describe("TDEV-REVOKE POST /api/v1/devices/{dev_id}/revoke (17 §9, 21 §10)", () => {
  it("TDEV-REVOKE revokes credentials in DB and applies the lease effects in JOBS_DB", async () => {
    const cli = await client.cliSession("alice@example.com");
    const web = await client.browserSession("alice@example.com");
    const id = deviceOf(cli);
    const userId = cli.userId ?? "";
    t.sqlite
      .query(
        "INSERT INTO oauth_refresh_tokens (id, grant_id, token_hash, created_at, expires_at) VALUES ('rft_01JA6V8M3W8Z1T6Q4Y2B7K9C0X', ?, 'h', 0, ?)"
      )
      .run(cli.grantId, clock.now() + 86_400_000);
    const before = seedLease(userId, id, 1, { target_device_id: id });
    const after = seedLease(userId, id, 2, {
      submit_intent_at: clock.now() - 5000,
    });
    const waiting = seedLease(userId, id, 3, { state: "awaiting_approval" });
    const pinned = seedTask(t.jobsSqlite, userId, {
      target_device_id: id,
      application_id: seedApplication(t.jobsSqlite, userId).id,
    });
    const elsewhere = seedTask(t.jobsSqlite, userId, {});
    const res = await web.post<Record<string, unknown>>(
      `/api/v1/devices/${id}/revoke`,
      undefined,
      {
        idempotencyKey: "rev-1",
      }
    );
    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual({
      outcome_unknown: 1,
      requeued: 1,
      awaiting_approval: 1,
      cancelled: 1,
    });
    expect(res.body.device).toMatchObject({
      id,
      revoked_at: clock.now(),
      revision: 2,
      signed_in: false,
      online: false,
    });
    expect(
      db("SELECT revoked_reason FROM oauth_grants WHERE id = ?", cli.grantId)
    ).toEqual({ revoked_reason: "device_revoked" });
    expect(
      db(
        "SELECT revoked_at FROM oauth_refresh_tokens WHERE grant_id = ?",
        cli.grantId
      )
    ).toEqual({ revoked_at: clock.now() });
    expect(
      db("SELECT status FROM mcp_tokens WHERE id = ?", cli.tokenId)
    ).toEqual({ status: "revoked" });
    const task = (taskId: string) =>
      jobs(
        "SELECT state, lease_id, target_device_id, error_class FROM automation_tasks WHERE id = ?",
        taskId
      );
    expect(task(before.task)).toMatchObject({
      state: "queued",
      lease_id: null,
      target_device_id: null,
    });
    expect(task(after.task)).toMatchObject({
      state: "outcome_unknown",
      lease_id: null,
    });
    expect(
      jobs(
        "SELECT submission_status FROM applications WHERE id = ?",
        after.application
      )
    ).toEqual({
      submission_status: "outcome_unknown",
    });
    expect(task(waiting.task)).toMatchObject({
      state: "awaiting_approval",
      lease_id: null,
    });
    expect(task(pinned.id)).toMatchObject({
      state: "cancelled",
      error_class: "device_revoked",
    });
    expect(task(elsewhere.id)).toMatchObject({ state: "queued" });
    expect(
      jobs(
        "SELECT revision FROM change_log WHERE entity = 'device' AND entity_id = ?",
        id
      )
    ).toEqual({ revision: 2 });
    // The revoked CLI is signed out on its next call.
    const next = await cli.get("/api/v1/me");
    expect(next.status).toBe(401);
    expect(next.body.reason).toBe("revoked_token");
    // A replay with the key answers the stored response.
    const replay = await web.post(`/api/v1/devices/${id}/revoke`, undefined, {
      idempotencyKey: "rev-1",
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(replay.body).toEqual(res.body);
  });

  it("TDEV-REVOKE addressing a revoked device from another credential is 403 device_revoked", async () => {
    const cli = await client.cliSession("alice@example.com");
    const web = await client.browserSession("alice@example.com");
    const id = deviceOf(cli);
    expect((await web.post(`/api/v1/devices/${id}/revoke`)).status).toBe(200);
    const again = await web.post(`/api/v1/devices/${id}/revoke`);
    expect(again.status).toBe(403);
    expect(again.body.error).toBe("device_revoked");
    expect(await revision(web, id)).toBe(2);
  });

  it("TDEV-REVOKE another user's device is 404; a CLI base token cannot revoke", async () => {
    const bob = await client.cliSession("bob@example.com");
    const web = await client.browserSession("alice@example.com");
    expect(
      (await web.post(`/api/v1/devices/${deviceOf(bob)}/revoke`)).status
    ).toBe(404);
    expect(
      db("SELECT revoked_at FROM devices WHERE id = ?", deviceOf(bob))
    ).toEqual({ revoked_at: null });
    const cli = await client.cliSession("alice@example.com");
    const res = await cli.post(`/api/v1/devices/${deviceOf(cli)}/revoke`);
    expect(res.status).toBe(403);
    expect(res.body.scope).toBe("devices:manage");
  });
});

describe("TDEV-HEARTBEAT POST /api/v1/devices/{dev_id}/heartbeat (05 §3, 21 §1.1)", () => {
  it("TDEV-HEARTBEAT answers server time, poll interval, leases to stop and the minimum CLI version", async () => {
    const cli = await client.cliSession("alice@example.com");
    const id = deviceOf(cli);
    const res = await cli.post(`/api/v1/devices/${id}/heartbeat`, HEARTBEAT);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      server_time: clock.now(),
      poll_interval_ms: 30_000,
      cancel_lease_ids: [],
      min_cli_version: "0.1.0",
    });
  });

  it("TDEV-HEARTBEAT is for the caller's own device only", async () => {
    const cli = await client.cliSession("alice@example.com");
    const other = await client.cliSession("alice@example.com", {
      device: { name: "other" },
    });
    expect(
      (
        await cli.post(
          `/api/v1/devices/${deviceOf(other)}/heartbeat`,
          HEARTBEAT
        )
      ).status
    ).toBe(404);
    const unbound = await client.cliSession("alice@example.com", {
      device: false,
    });
    const res = await unbound.post(
      `/api/v1/devices/${deviceOf(cli)}/heartbeat`,
      HEARTBEAT
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("device_required");
    const web = await client.browserSession("alice@example.com");
    const fromWeb = await web.post(
      `/api/v1/devices/${deviceOf(cli)}/heartbeat`,
      HEARTBEAT
    );
    expect(fromWeb.status).toBe(403);
    expect(fromWeb.body.scope).toBe("automation:execute");
  });

  it("TDEV-HEARTBEAT lists lost, cancelled and paused-all leases in cancel_lease_ids", async () => {
    const cli = await client.cliSession("alice@example.com");
    const id = deviceOf(cli);
    const userId = cli.userId ?? "";
    seedLease(userId, id, 1);
    seedLease(userId, id, 2, { cancel_requested: 1 });
    seedLease(userId, id, 3, {
      lease_device_id: "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0Z",
    });
    seedLease(userId, id, 4, { submit_intent_at: clock.now() - 1000 });
    seedLease(userId, id, 5, { kind: "discover", application_id: null });
    const reported = [
      lease(1),
      lease(2),
      lease(3),
      lease(4),
      lease(5),
      lease(9),
    ];
    let res = await cli.post<{ cancel_lease_ids: string[] }>(
      `/api/v1/devices/${id}/heartbeat`,
      {
        ...HEARTBEAT,
        active_lease_ids: reported,
      }
    );
    expect(res.body.cancel_lease_ids).toEqual([lease(2), lease(3), lease(9)]);
    // "Pause all automation" stops apply leases before submit_intent.
    t.jobsSqlite
      .query(
        "INSERT INTO user_settings (user_id, automation_paused, updated_at) VALUES (?, 1, 0)"
      )
      .run(userId);
    res = await cli.post(`/api/v1/devices/${id}/heartbeat`, {
      ...HEARTBEAT,
      active_lease_ids: reported,
    });
    expect(res.body.cancel_lease_ids).toEqual([
      lease(1),
      lease(2),
      lease(3),
      lease(9),
    ]);
  });

  it("TDEV-HEARTBEAT the poll interval follows 21 §1.1 (5 s hot, 30 s idle, 60 s cold)", async () => {
    const cli = await client.cliSession("alice@example.com");
    const id = deviceOf(cli);
    const userId = cli.userId ?? "";
    const beat = async () =>
      (
        await cli.post<{ poll_interval_ms: number }>(
          `/api/v1/devices/${id}/heartbeat`,
          HEARTBEAT
        )
      ).body.poll_interval_ms;
    t.sqlite
      .query("UPDATE devices SET created_at = ? WHERE id = ?")
      .run(clock.now() - 7_200_000, id);
    expect(await beat()).toBe(60_000);
    seedLease(userId, id, 1, {}, clock.now() - 1_800_000);
    expect(await beat()).toBe(30_000);
    await t.env.AUTH_KV.put(`jobs:watch:${userId}`, "1");
    expect(await beat()).toBe(5000);
    await t.env.AUTH_KV.delete(`jobs:watch:${userId}`);
    seedTask(t.jobsSqlite, userId, { created_at: clock.now() - 60_000 });
    expect(await beat()).toBe(5000);
    clock.advance(301_000);
    expect(await beat()).toBe(30_000);
  });

  it("TDEV-HEARTBEAT records the version, capabilities and the device report", async () => {
    const cli = await client.cliSession("alice@example.com");
    const id = deviceOf(cli);
    const res = await cli.post(`/api/v1/devices/${id}/heartbeat`, {
      ...HEARTBEAT,
      cli_version: "0.2.0",
      capabilities: ["headed_browser", "apply"],
      outbox_depth: 3,
      outbox_dead: 1,
      last_sync_at: clock.now() - 5000,
      browser: { mode: "persistent", status: "busy" },
    });
    expect(res.status).toBe(200);
    expect(
      db("SELECT cli_version, capabilities FROM devices WHERE id = ?", id)
    ).toEqual({
      cli_version: "0.2.0",
      capabilities: '["apply","headed_browser"]',
    });
    expect(await t.env.AUTH_KV.get(reportKey(id), "json")).toMatchObject({
      cli_version: "0.2.0",
      outbox_depth: 3,
      outbox_dead: 1,
      outbox_pending_since: clock.now(),
      last_sync_at: clock.now() - 5000,
      browser: { mode: "persistent", status: "busy" },
    });
    const web = await client.browserSession("alice@example.com");
    const list = await web.get<{ items: Record<string, unknown>[] }>(
      "/api/v1/devices"
    );
    expect(list.body.items[0]).toMatchObject({
      cli_version: "0.2.0",
      capabilities: ["apply", "headed_browser"],
      report: { outbox_depth: 3, browser: { status: "busy" } },
    });
    // The pending-since mark survives while the outbox stays non-empty.
    clock.advance(60_000);
    await cli.post(`/api/v1/devices/${id}/heartbeat`, {
      ...HEARTBEAT,
      cli_version: "0.2.0",
      outbox_depth: 2,
    });
    expect(await t.env.AUTH_KV.get(reportKey(id), "json")).toMatchObject({
      outbox_pending_since: clock.now() - 60_000,
    });
  });
});
