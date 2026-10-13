import { beforeEach, describe, expect, it } from "bun:test";
import { seedApplication, seedAttempt, seedTask } from "../../test/seed-jobs";
import { createBrowserSession } from "../session";
import type { Harness, LoggedIn, TokenSet } from "./support.test";
import {
  approvePage,
  BASE_SCOPE,
  cliLogin,
  createHarness,
  refresh,
  registerCliDevice,
  row,
  v1,
} from "./support.test";

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

async function loginWithDevice(email = "alice@example.com") {
  const session = await cliLogin(h, email);
  const reg = await registerCliDevice(h, session.tokens.access_token);
  expect(reg.status).toBe(201);
  return { session, deviceId: (reg.body.device as { id: string }).id };
}

async function me(token: string) {
  return await v1(h, "GET", "/api/v1/me", token);
}

function grant(session: LoggedIn) {
  return row<Record<string, unknown>>(
    h,
    "SELECT device_id, revoked_at, revoked_reason FROM oauth_grants WHERE id = ?",
    session.grantId
  );
}

describe("T17-06 device registration and binding (17 §6, D-10)", () => {
  it("T17-06 registration binds the grant; refreshed access tokens carry the device", async () => {
    const { session, deviceId } = await loginWithDevice();
    expect(grant(session)).toMatchObject({
      device_id: deviceId,
      revoked_at: null,
    });
    expect((await me(session.tokens.access_token)).body.device).toEqual({
      id: deviceId,
      name: "alice-mbp (macOS)",
    });
    const next = (await (
      await refresh(h, session.tokens.refresh_token ?? "")
    ).json()) as TokenSet;
    expect((await me(next.access_token)).body.device).toMatchObject({
      id: deviceId,
    });
    // Until registration the automation scope was inert; now heartbeats work.
    const beat = await v1(
      h,
      "POST",
      `/api/v1/devices/${deviceId}/heartbeat`,
      next.access_token,
      {
        cli_version: "0.1.0",
        local_state_summary: {},
        active_lease_ids: [],
        outbox_depth: 0,
        browser: { mode: "managed", status: "ready" },
      }
    );
    expect(beat.status).toBe(200);
  });

  it("T17-06 a second registration on the same grant is 409 duplicate", async () => {
    const { session } = await loginWithDevice();
    const again = await registerCliDevice(h, session.tokens.access_token);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("duplicate");
  });

  it("T17-06 device_hint re-binds the device to the new grant and revokes the old grant", async () => {
    const first = await loginWithDevice();
    const second = await cliLogin(h, "alice@example.com", {
      deviceHint: first.deviceId,
      cookie: first.session.cookie,
    });
    expect(second.grantId).not.toBe(first.session.grantId);
    // The new grant's tokens carry the device (no registration needed).
    const who = await me(second.tokens.access_token);
    expect(who.body.device).toEqual({
      id: first.deviceId,
      name: "alice-mbp (macOS)",
    });
    expect(
      row(
        h,
        "SELECT device_id FROM mcp_tokens WHERE grant_id = ?",
        second.grantId
      )
    ).toEqual({ device_id: first.deviceId });
    expect(
      row(
        h,
        "SELECT grant_id, revision FROM devices WHERE id = ?",
        first.deviceId
      )
    ).toEqual({
      grant_id: second.grantId,
      revision: 2,
    });
    expect(row(h, "SELECT COUNT(*) AS n FROM devices")).toEqual({ n: 1 });
    expect(grant(first.session)).toMatchObject({ revoked_reason: "user" });
    expect((await me(first.session.tokens.access_token)).status).toBe(401);
    const old = await refresh(h, first.session.tokens.refresh_token ?? "");
    expect(((await old.json()) as { error: string }).error).toBe(
      "invalid_grant"
    );
    // Refreshes of the new grant keep the binding.
    const next = (await (
      await refresh(h, second.tokens.refresh_token ?? "")
    ).json()) as TokenSet;
    expect((await me(next.access_token)).body.device).toMatchObject({
      id: first.deviceId,
    });
    expect(
      (await registerCliDevice(h, second.tokens.access_token)).status
    ).toBe(409);
  });

  it("T17-06 device_hint is ignored for another user's or a revoked device", async () => {
    const bob = await loginWithDevice("bob@example.com");
    const alice = await cliLogin(h, "alice@example.com", {
      deviceHint: bob.deviceId,
    });
    expect((await me(alice.tokens.access_token)).body.device).toBeUndefined();
    expect(grant(bob.session)).toMatchObject({ revoked_at: null });
    expect(
      row(h, "SELECT grant_id FROM devices WHERE id = ?", bob.deviceId)
    ).toEqual({
      grant_id: bob.session.grantId,
    });
    const web = await createBrowserSession(h.t.env, "bob@example.com");
    expect(
      (await v1(h, "POST", `/api/v1/devices/${bob.deviceId}/revoke`, web))
        .status
    ).toBe(200);
    const again = await cliLogin(h, "bob@example.com", {
      deviceHint: bob.deviceId,
    });
    expect((await me(again.tokens.access_token)).body.device).toBeUndefined();
    expect((await registerCliDevice(h, again.tokens.access_token)).status).toBe(
      201
    );
  });

  it("T17-06 step-up consent (automation:manage) on the same device shows what it adds", async () => {
    const first = await loginWithDevice();
    const { html } = await approvePage(h, first.session.cookie, {
      deviceHint: first.deviceId,
      scope: `${BASE_SCOPE} automation:manage`,
    });
    expect(html).toContain(
      "signs in your existing device <strong>alice-mbp (macOS)</strong> again"
    );
    expect(html).toContain("managing automation");
    const stepped = await cliLogin(h, "alice@example.com", {
      deviceHint: first.deviceId,
      cookie: first.session.cookie,
      scope: `${BASE_SCOPE} automation:manage`,
    });
    expect(stepped.tokens.scope).toContain("automation:manage");
    expect((await me(stepped.tokens.access_token)).body.device).toMatchObject({
      id: first.deviceId,
    });
  });

  it("T17-06 a web revoke signs the CLI out on its next call and fails its leases per 21", async () => {
    const { session, deviceId } = await loginWithDevice();
    const lease = (n: number) => `lse_01JA6V8M3W8Z1T6Q4Y2B7K9C${n}0`;
    const now = Date.now();
    const pre = seedTask(h.t.jobsSqlite, session.userId, {
      application_id: seedApplication(h.t.jobsSqlite, session.userId, {
        stage: "ready",
      }).id,
      state: "running",
      lease_id: lease(1),
      lease_device_id: deviceId,
      lease_expires_at: now + 100_000,
      attempt_count: 1,
    });
    seedAttempt(h.t.jobsSqlite, session.userId, {
      task_id: pre.id,
      lease_id: lease(1),
      device_id: deviceId,
    });
    const post = seedTask(h.t.jobsSqlite, session.userId, {
      application_id: seedApplication(h.t.jobsSqlite, session.userId, {
        stage: "ready",
        submission_status: "in_progress",
      }).id,
      state: "running",
      lease_id: lease(2),
      lease_device_id: deviceId,
      lease_expires_at: now + 100_000,
      attempt_count: 1,
      submit_intent_at: now - 1000,
    });
    seedAttempt(h.t.jobsSqlite, session.userId, {
      task_id: post.id,
      lease_id: lease(2),
      device_id: deviceId,
    });
    const web = await createBrowserSession(h.t.env, "alice@example.com");
    const res = await v1(h, "POST", `/api/v1/devices/${deviceId}/revoke`, web);
    expect(res.status).toBe(200);
    expect(res.body.tasks).toMatchObject({ requeued: 1, outcome_unknown: 1 });
    const next = await me(session.tokens.access_token);
    expect(next.status).toBe(401);
    expect(next.body.reason).toBe("revoked_token");
    const state = (id: string) =>
      (
        h.t.jobsSqlite
          .query("SELECT state FROM automation_tasks WHERE id = ?")
          .get(id) as { state: string }
      ).state;
    expect(state(pre.id)).toBe("queued");
    expect(state(post.id)).toBe("outcome_unknown");
    expect(grant(session)).toMatchObject({ revoked_reason: "device_revoked" });
    const refused = await refresh(h, session.tokens.refresh_token ?? "");
    expect(((await refused.json()) as { error: string }).error).toBe(
      "invalid_grant"
    );
  });
});
