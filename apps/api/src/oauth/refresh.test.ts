import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
} from "bun:test";
import { seedApplication, seedAttempt, seedTask } from "../../test/seed-jobs";
import { createBrowserSession } from "../session";
import type { Harness, LoggedIn, TokenSet } from "./support.test";
import {
  BASE_SCOPE,
  cliLogin,
  createHarness,
  refresh,
  registerCliDevice,
  row,
  rows,
  v1,
} from "./support.test";

const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 9, 12, 9);

let h: Harness;

beforeEach(() => {
  setSystemTime(new Date(T0));
  h = createHarness();
});

afterEach(() => {
  setSystemTime();
});

function at(ms: number) {
  setSystemTime(new Date(ms));
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

async function login(email = "alice@example.com"): Promise<LoggedIn> {
  return await cliLogin(h, email);
}

async function rotate(token: string, extra: Record<string, string> = {}) {
  const res = await refresh(h, token, extra);
  return { res, body: (await res.json()) as TokenSet };
}

function refreshRows(grantId: string) {
  return rows<Record<string, unknown>>(
    h,
    "SELECT id, parent_id, used_at, revoked_at FROM oauth_refresh_tokens WHERE grant_id = ? ORDER BY created_at, id",
    grantId
  );
}

// A device bound to the login plus one leased task per effect of 21 §10.
async function deviceWithLeases(session: LoggedIn) {
  const reg = await registerCliDevice(h, session.tokens.access_token);
  expect(reg.status).toBe(201);
  const deviceId = (reg.body.device as { id: string }).id;
  const lease = (n: number) =>
    `lse_01JA6V8M3W8Z1T6Q4Y2B7K9C${String(n).padStart(2, "0")}`;
  const userId = session.userId;
  const app = seedApplication(h.t.jobsSqlite, userId, {
    stage: "ready",
    submission_status: "in_progress",
  });
  const before = seedTask(h.t.jobsSqlite, userId, {
    application_id: app.id,
    state: "running",
    lease_id: lease(1),
    lease_device_id: deviceId,
    lease_expires_at: T0 + 100_000,
    attempt_count: 1,
    target_device_id: deviceId,
  });
  seedAttempt(h.t.jobsSqlite, userId, {
    task_id: before.id,
    lease_id: lease(1),
    device_id: deviceId,
  });
  const app2 = seedApplication(h.t.jobsSqlite, userId, {
    stage: "ready",
    submission_status: "in_progress",
  });
  const after = seedTask(h.t.jobsSqlite, userId, {
    application_id: app2.id,
    state: "running",
    lease_id: lease(2),
    lease_device_id: deviceId,
    lease_expires_at: T0 + 100_000,
    attempt_count: 1,
    submit_intent_at: T0 - 1000,
  });
  seedAttempt(h.t.jobsSqlite, userId, {
    task_id: after.id,
    lease_id: lease(2),
    device_id: deviceId,
  });
  return { deviceId, before: before.id, after: after.id };
}

/** The dashboard's bearer (a browser session of the same user). */
async function webBearer(email = "alice@example.com"): Promise<string> {
  return await createBrowserSession(h.t.env, email);
}

function task(id: string) {
  return h.t.jobsSqlite
    .query(
      "SELECT state, lease_id, target_device_id, error_class FROM automation_tasks WHERE id = ?"
    )
    .get(id) as Record<string, unknown>;
}

describe("S-05 refresh rotation (17 §7.2 step 2)", () => {
  it("S-05 a refresh rotates the token: the parent is used, the child chained, a new 1 h access token issued", async () => {
    const session = await login();
    at(T0 + 1_800_000);
    const { res, body } = await rotate(session.tokens.refresh_token ?? "");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(body.expires_in).toBe(3600);
    expect(body.scope).toBe(BASE_SCOPE);
    expect(body.refresh_token).not.toBe(session.tokens.refresh_token);
    expect(body.access_token).not.toBe(session.tokens.access_token);
    const [parent, child] = refreshRows(session.grantId);
    expect(parent.used_at).toBe(T0 + 1_800_000);
    expect(child).toMatchObject({
      parent_id: parent.id,
      used_at: null,
      revoked_at: null,
    });
    const me = await v1(h, "GET", "/api/v1/me", body.access_token);
    expect(me.status).toBe(200);
    // The previous access token keeps working until its own expiry.
    expect(
      (await v1(h, "GET", "/api/v1/me", session.tokens.access_token)).status
    ).toBe(200);
    // The grace record never holds the child in plaintext.
    const kv = JSON.stringify([...h.t.kv.AUTH_KV.store]);
    expect(kv).toContain("oauth:rft-grace:");
    expect(kv).not.toContain(body.refresh_token ?? "-");
  });

  it("S-05 replaying a used refresh token after its child was used revokes the whole family", async () => {
    const session = await login();
    const first = await rotate(session.tokens.refresh_token ?? "");
    const second = await rotate(first.body.refresh_token ?? "");
    expect(second.res.status).toBe(200);
    const replay = await refresh(h, session.tokens.refresh_token ?? "");
    expect(replay.status).toBe(400);
    expect((await json(replay)).error).toBe("invalid_grant");
    expect(
      row(
        h,
        "SELECT revoked_reason FROM oauth_grants WHERE id = ?",
        session.grantId
      )
    ).toEqual({
      revoked_reason: "refresh_reuse",
    });
    expect(
      refreshRows(session.grantId).every((r) => r.revoked_at !== null)
    ).toBe(true);
    for (const token of [
      session.tokens.access_token,
      first.body.access_token,
      second.body.access_token,
    ]) {
      const res = await v1(h, "GET", "/api/v1/me", token);
      expect(res.status).toBe(401);
      expect(res.body.reason).toBe("revoked_token");
    }
    // The legitimate holder of the newest token is signed out as well.
    expect(
      (await json(await refresh(h, second.body.refresh_token ?? ""))).error
    ).toBe("invalid_grant");
  });
});

describe("T17-04 refresh grace, reuse, expiry and narrowing (17 §7.2, D-30)", () => {
  it("T17-04 within 60 s a used token re-issues the SAME unused child and a new access token", async () => {
    const session = await login();
    const first = await rotate(session.tokens.refresh_token ?? "");
    at(T0 + 59_000);
    const again = await rotate(session.tokens.refresh_token ?? "");
    expect(again.res.status).toBe(200);
    expect(again.body.refresh_token).toBe(first.body.refresh_token);
    expect(again.body.access_token).not.toBe(first.body.access_token);
    expect(refreshRows(session.grantId)).toHaveLength(2);
    expect(
      row(
        h,
        "SELECT revoked_at FROM oauth_grants WHERE id = ?",
        session.grantId
      )
    ).toEqual({ revoked_at: null });
    // The re-issued child still rotates normally.
    expect((await rotate(again.body.refresh_token ?? "")).res.status).toBe(200);
  });

  it("T17-04 after 60 s the used token is reuse even though the child is unused", async () => {
    const session = await login();
    await rotate(session.tokens.refresh_token ?? "");
    at(T0 + 61_000);
    const late = await refresh(h, session.tokens.refresh_token ?? "");
    expect((await json(late)).error).toBe("invalid_grant");
    expect(
      row(
        h,
        "SELECT revoked_reason FROM oauth_grants WHERE id = ?",
        session.grantId
      )
    ).toEqual({
      revoked_reason: "refresh_reuse",
    });
  });

  it("T17-04 reuse revokes the grant, every access token and the device's live leases (21 §10)", async () => {
    const session = await login();
    const { deviceId, before, after } = await deviceWithLeases(session);
    const first = await rotate(session.tokens.refresh_token ?? "");
    await rotate(first.body.refresh_token ?? "");
    // The original token: its child (`first`) was used → reuse.
    const replay = await refresh(h, session.tokens.refresh_token ?? "");
    expect((await json(replay)).error).toBe("invalid_grant");
    expect(task(before)).toMatchObject({
      state: "queued",
      lease_id: null,
      target_device_id: null,
    });
    expect(task(after)).toMatchObject({
      state: "outcome_unknown",
      lease_id: null,
    });
    const tokens = rows<{ status: string }>(
      h,
      "SELECT status FROM mcp_tokens WHERE grant_id = ?",
      session.grantId
    );
    expect(tokens.length).toBeGreaterThan(1);
    expect(tokens.every((t) => t.status === "revoked")).toBe(true);
    // The device row stays (it may sign in again with device_hint); the
    // dashboard sees it signed out for reuse and gets a change.
    const list = await v1(h, "GET", "/api/v1/devices", await webBearer());
    const device = (list.body.items as Record<string, unknown>[]).find(
      (d) => d.id === deviceId
    );
    expect(device).toMatchObject({
      signed_in: false,
      signed_out_reason: "refresh_reuse",
      revoked_at: null,
    });
    const changes = h.t.jobsSqlite
      .query(
        "SELECT entity FROM change_log WHERE entity = 'device' AND entity_id = ?"
      )
      .all(deviceId);
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });

  it("T17-04 the absolute 90 d and idle 30 d expiries refuse without revoking", async () => {
    const session = await login();
    at(T0 + 30 * DAY_MS + 1);
    const idle = await refresh(h, session.tokens.refresh_token ?? "");
    expect((await json(idle)).error).toBe("invalid_grant");
    expect(
      row(
        h,
        "SELECT revoked_at FROM oauth_grants WHERE id = ?",
        session.grantId
      )
    ).toEqual({ revoked_at: null });
    // Keep a second login alive by refreshing every 29 days: the 90 d cap
    // from grant creation still ends it.
    at(T0);
    const other = await login("bob@example.com");
    let token = other.tokens.refresh_token ?? "";
    for (const day of [29, 58, 87]) {
      at(T0 + day * DAY_MS);
      const next = await rotate(token);
      expect(next.res.status).toBe(200);
      token = next.body.refresh_token ?? "";
    }
    const child = row<{ expires_at: number }>(
      h,
      "SELECT expires_at FROM oauth_refresh_tokens WHERE grant_id = ? AND used_at IS NULL",
      other.grantId
    );
    expect(child.expires_at).toBe(T0 + 90 * DAY_MS);
    at(T0 + 90 * DAY_MS);
    expect((await json(await refresh(h, token))).error).toBe("invalid_grant");
  });

  it("T17-04 scope narrows the access token to a subset; a wider scope is invalid_scope", async () => {
    const session = await login();
    const narrow = await rotate(session.tokens.refresh_token ?? "", {
      scope: "jobs:read",
    });
    expect(narrow.res.status).toBe(200);
    expect(narrow.body.scope).toBe("jobs:read");
    expect(
      row(
        h,
        "SELECT scopes FROM mcp_tokens WHERE token_hash = (SELECT token_hash FROM mcp_tokens WHERE kind='oauth' ORDER BY created_at DESC, rowid DESC LIMIT 1)"
      )
    ).toEqual({ scopes: "jobs:read" });
    const me = await v1(h, "GET", "/api/v1/me", narrow.body.access_token);
    expect(me.body.scopes).toEqual(["jobs:read"]);
    // The refresh token keeps the grant: the next refresh gets the full set.
    const full = await rotate(narrow.body.refresh_token ?? "");
    expect(full.body.scope).toBe(BASE_SCOPE);
    const wide = await refresh(h, full.body.refresh_token ?? "", {
      scope: "jobs:read automation:manage",
    });
    expect(wide.status).toBe(400);
    expect((await json(wide)).error).toBe("invalid_scope");
  });

  it("T17-04 refresh-grant allows 10 refreshes per minute per grant", async () => {
    const session = await login();
    let token = session.tokens.refresh_token ?? "";
    for (let i = 0; i < 10; i++) {
      const next = await rotate(token);
      expect(next.res.status).toBe(200);
      token = next.body.refresh_token ?? "";
    }
    const limited = await refresh(h, token);
    expect(limited.status).toBe(429);
    expect((await json(limited)).error).toBe("slow_down");
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });

  it("T17-04 two concurrent refreshes of one token: one rotation, both get the same child", async () => {
    const session = await login();
    const token = session.tokens.refresh_token ?? "";
    const [a, b] = await Promise.all([refresh(h, token), refresh(h, token)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const [ta, tb] = (await Promise.all([a.json(), b.json()])) as TokenSet[];
    expect(ta.refresh_token).toBe(tb.refresh_token);
    expect(refreshRows(session.grantId)).toHaveLength(2);
  });

  it("T17-04 a revoked grant, a foreign client and an unknown token are invalid_grant", async () => {
    const session = await login();
    const reg = await h.call("/oauth/register", {
      method: "POST",
      body: JSON.stringify({
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const foreign = await refresh(h, session.tokens.refresh_token ?? "", {
      client_id,
    });
    expect((await json(foreign)).error).toBe("invalid_grant");
    expect((await json(await refresh(h, "not-a-token"))).error).toBe(
      "invalid_grant"
    );
    h.t.sqlite
      .query("UPDATE oauth_grants SET revoked_at = 1, revoked_reason = 'admin'")
      .run();
    expect(
      (await json(await refresh(h, session.tokens.refresh_token ?? ""))).error
    ).toBe("invalid_grant");
  });
});

describe("T11-TOKEN token lifecycle (11 §13)", () => {
  it("T11-TOKEN rotation works; reuse of an old refresh token revokes the family", async () => {
    const session = await login();
    const first = await rotate(session.tokens.refresh_token ?? "");
    expect(first.res.status).toBe(200);
    await rotate(first.body.refresh_token ?? "");
    expect(
      (await json(await refresh(h, session.tokens.refresh_token ?? ""))).error
    ).toBe("invalid_grant");
    expect(
      row(
        h,
        "SELECT revoked_reason FROM oauth_grants WHERE id = ?",
        session.grantId
      )
    ).toEqual({
      revoked_reason: "refresh_reuse",
    });
  });

  it("T11-TOKEN an expired access token is 401 expired_token; a refresh restores access", async () => {
    const session = await login();
    at(T0 + 3_600_000 + 1);
    const expired = await v1(
      h,
      "GET",
      "/api/v1/me",
      session.tokens.access_token
    );
    expect(expired.status).toBe(401);
    expect(expired.body.reason).toBe("expired_token");
    expect(expired.response.headers.get("WWW-Authenticate")).toBe(
      'Bearer error="invalid_token"'
    );
    const next = await rotate(session.tokens.refresh_token ?? "");
    expect(
      (await v1(h, "GET", "/api/v1/me", next.body.access_token)).status
    ).toBe(200);
  });

  it("T11-TOKEN a revoked device is 401 revoked_token within one call and cannot refresh", async () => {
    const session = await login();
    const { deviceId } = await deviceWithLeases(session);
    const web = await webBearer();
    const revoked = await v1(
      h,
      "POST",
      `/api/v1/devices/${deviceId}/revoke`,
      web
    );
    expect(revoked.status).toBe(200);
    const next = await v1(h, "GET", "/api/v1/me", session.tokens.access_token);
    expect(next.status).toBe(401);
    expect(next.body.reason).toBe("revoked_token");
    expect(
      (await json(await refresh(h, session.tokens.refresh_token ?? ""))).error
    ).toBe("invalid_grant");
  });
});
