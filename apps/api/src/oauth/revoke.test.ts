import { beforeEach, describe, expect, it } from "bun:test";
import { createToken } from "../auth";
import { seedAttempt, seedTask } from "../../test/seed-jobs";
import type { Harness, LoggedIn } from "./support.test";
import {
  cliLogin,
  createHarness,
  refresh,
  registerCliDevice,
  revoke,
  row,
  rows,
  v1,
} from "./support.test";

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

async function error(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: string }).error;
}

async function dcrClient(): Promise<string> {
  const reg = await h.call("/oauth/register", {
    method: "POST",
    body: JSON.stringify({
      redirect_uris: ["http://127.0.0.1/callback"],
      token_endpoint_auth_method: "none",
    }),
  });
  return ((await reg.json()) as { client_id: string }).client_id;
}

function grantOf(session: LoggedIn) {
  return row<{ revoked_at: number | null; revoked_reason: string | null }>(
    h,
    "SELECT revoked_at, revoked_reason FROM oauth_grants WHERE id = ?",
    session.grantId
  );
}

describe("T17-05 RFC 7009 revocation (17 §8)", () => {
  it("T17-05 an unknown or already revoked token answers 200", async () => {
    const res = await revoke(h, { token: "never-issued" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const session = await cliLogin(h, "alice@example.com");
    const token = session.tokens.refresh_token ?? "";
    expect((await revoke(h, { token })).status).toBe(200);
    expect((await revoke(h, { token })).status).toBe(200);
  });

  it("T17-05 revoking a refresh token kills the whole family", async () => {
    const session = await cliLogin(h, "alice@example.com");
    const next = (await (
      await refresh(h, session.tokens.refresh_token ?? "")
    ).json()) as { access_token: string; refresh_token: string };
    const res = await revoke(h, {
      token: next.refresh_token,
      token_type_hint: "refresh_token",
    });
    expect(res.status).toBe(200);
    expect(grantOf(session)).toEqual({
      revoked_at: expect.any(Number),
      revoked_reason: "user",
    });
    expect(
      rows<{ revoked_at: number | null }>(
        h,
        "SELECT revoked_at FROM oauth_refresh_tokens WHERE grant_id = ?",
        session.grantId
      ).every((r) => r.revoked_at !== null)
    ).toBe(true);
    for (const token of [session.tokens.access_token, next.access_token]) {
      const me = await v1(h, "GET", "/api/v1/me", token);
      expect(me.status).toBe(401);
      expect(me.body.reason).toBe("revoked_token");
    }
    expect(await error(await refresh(h, next.refresh_token))).toBe(
      "invalid_grant"
    );
  });

  it("T17-05 revoking an access token leaves the refresh token intact", async () => {
    const session = await cliLogin(h, "alice@example.com");
    const res = await revoke(h, {
      token: session.tokens.access_token,
      token_type_hint: "access_token",
    });
    expect(res.status).toBe(200);
    expect(
      (await v1(h, "GET", "/api/v1/me", session.tokens.access_token)).status
    ).toBe(401);
    expect(grantOf(session).revoked_at).toBeNull();
    const next = await refresh(h, session.tokens.refresh_token ?? "");
    expect(next.status).toBe(200);
    // Without a hint the access token is found as well.
    const other = await cliLogin(h, "bob@example.com");
    expect((await revoke(h, { token: other.tokens.access_token })).status).toBe(
      200
    );
    expect(
      (await v1(h, "GET", "/api/v1/me", other.tokens.access_token)).status
    ).toBe(401);
  });

  it("T17-05 a client_id mismatch is ignored: 200, nothing revoked", async () => {
    const session = await cliLogin(h, "alice@example.com");
    const otherClient = await dcrClient();
    for (const token of [
      session.tokens.refresh_token ?? "",
      session.tokens.access_token,
    ]) {
      const res = await revoke(h, { token, client_id: otherClient });
      expect(res.status).toBe(200);
    }
    expect(grantOf(session).revoked_at).toBeNull();
    expect(
      (await v1(h, "GET", "/api/v1/me", session.tokens.access_token)).status
    ).toBe(200);
  });

  it("T17-05 tokens not issued through a grant cannot be revoked here", async () => {
    await createToken(h.t.env.DB, {
      email: "alice@example.com",
      token: "personal-token-value",
      label: "script",
      kind: "personal",
      scope: "write",
      expiresAt: null,
    });
    const res = await revoke(h, { token: "personal-token-value" });
    expect(res.status).toBe(200);
    expect(
      row(h, "SELECT status FROM mcp_tokens WHERE kind = 'personal'")
    ).toEqual({ status: "active" });
  });

  it("T17-05 the client must identify itself; the token is required", async () => {
    const noClient = await h.form(
      "/oauth/revoke",
      { token: "x" },
      { noOrigin: true }
    );
    expect(noClient.status).toBe(401);
    expect(await error(noClient)).toBe("invalid_client");
    const noToken = await revoke(h, {});
    expect(noToken.status).toBe(400);
    expect(await error(noToken)).toBe("invalid_request");
  });

  it("T17-05 forget_device=true also revokes the bound device and applies 21 §10", async () => {
    const session = await cliLogin(h, "alice@example.com");
    const reg = await registerCliDevice(h, session.tokens.access_token);
    const deviceId = (reg.body.device as { id: string }).id;
    const lease = "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C77";
    const task = seedTask(h.t.jobsSqlite, session.userId, {
      kind: "discover",
      state: "running",
      lease_id: lease,
      lease_device_id: deviceId,
      lease_expires_at: Date.now() + 100_000,
      attempt_count: 1,
    });
    seedAttempt(h.t.jobsSqlite, session.userId, {
      task_id: task.id,
      lease_id: lease,
      device_id: deviceId,
    });
    // Without forget_device the device stays registered (no live grant).
    const other = await cliLogin(h, "bob@example.com");
    const bobReg = await registerCliDevice(h, other.tokens.access_token);
    const bobDevice = (bobReg.body.device as { id: string }).id;
    await revoke(h, { token: other.tokens.refresh_token ?? "" });
    expect(
      row(h, "SELECT revoked_at FROM devices WHERE id = ?", bobDevice)
    ).toEqual({ revoked_at: null });
    const res = await revoke(h, {
      token: session.tokens.refresh_token ?? "",
      token_type_hint: "refresh_token",
      forget_device: "true",
    });
    expect(res.status).toBe(200);
    expect(
      row<{ revoked_at: number | null }>(
        h,
        "SELECT revoked_at FROM devices WHERE id = ?",
        deviceId
      ).revoked_at
    ).not.toBeNull();
    expect(grantOf(session).revoked_at).not.toBeNull();
    expect(
      h.t.jobsSqlite
        .query("SELECT state, lease_id FROM automation_tasks WHERE id = ?")
        .get(task.id)
    ).toEqual({ state: "queued", lease_id: null });
  });
});
