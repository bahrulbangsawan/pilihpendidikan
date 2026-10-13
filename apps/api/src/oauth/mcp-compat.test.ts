import { beforeEach, describe, expect, it } from "bun:test";
import { createToken, hashToken } from "../auth";
import type { Harness } from "./support.test";
import {
  challengeFor,
  createHarness,
  hiddenFields,
  lastMagicLink,
  PROD,
  row,
  signedInCookie,
  v1,
} from "./support.test";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(43);

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

async function register(body: Record<string, unknown>) {
  const res = await h.call("/oauth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json()) as Record<string, unknown> };
}

// The MCP flow exactly as clients ran it before the Job Tracker.
async function mcpCode(
  clientId: string,
  options: { cookie?: string; state?: string } = {}
): Promise<URL> {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: await challengeFor(VERIFIER),
    code_challenge_method: "S256",
    response_type: "code",
    ...(options.state === undefined ? {} : { state: options.state }),
  });
  const consent = await h.call(`/oauth/authorize?${params}`, {
    cookie: options.cookie,
  });
  expect(consent.status).toBe(200);
  const html = await consent.text();
  // Always the email form for a DCR client (17 §4.3), session or not.
  expect(html).toContain('name="email"');
  const fields = hiddenFields(html);
  fields.set("email", "mcp@example.com");
  const sent = await h.form("/oauth/authorize", fields);
  expect(sent.status).toBe(200);
  const flowCookie = (sent.headers.get("Set-Cookie") ?? "").split(";")[0];
  const link = lastMagicLink(h);
  const confirm = await h.call(`${link.pathname}${link.search}`, {
    cookie: flowCookie,
  });
  expect(await confirm.text()).toContain('action="/oauth/magic"');
  const redirected = await h.form(
    "/oauth/magic",
    { token: link.searchParams.get("token") ?? "" },
    { cookie: flowCookie }
  );
  expect(redirected.status).toBe(303);
  return new URL(redirected.headers.get("Location") ?? "");
}

describe("TOAUTH-MCP-COMPAT existing MCP OAuth keeps working (17 §3.2)", () => {
  it("TOAUTH-MCP-COMPAT DCR register → email consent → code → 90-day write token with scope mcp", async () => {
    const reg = await register({
      client_name: "Claude",
      redirect_uris: [REDIRECT],
    });
    expect(reg.res.status).toBe(201);
    expect(reg.body.grant_types).toEqual(["authorization_code"]);
    const clientId = reg.body.client_id as string;
    const secret = reg.body.client_secret as string;
    const { cookie } = await signedInCookie(h, "someone@example.com");
    const back = await mcpCode(clientId, { cookie, state: "st-1" });
    expect(back.searchParams.get("state")).toBe("st-1");
    expect(back.searchParams.get("iss")).toBe(PROD);
    const res = await h.form(
      "/oauth/token",
      {
        grant_type: "authorization_code",
        code: back.searchParams.get("code") ?? "",
        code_verifier: VERIFIER,
        redirect_uri: REDIRECT,
      },
      {
        noOrigin: true,
        headers: { Authorization: `Basic ${btoa(`${clientId}:${secret}`)}` },
      }
    );
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as Record<string, unknown>;
    expect(tokens).toEqual({
      access_token: expect.any(String),
      token_type: "Bearer",
      expires_in: 90 * 86_400,
      scope: "mcp",
    });
    const stored = row<Record<string, unknown>>(
      h,
      "SELECT kind, scope, scopes, grant_id, device_id, label FROM mcp_tokens WHERE token_hash = ?",
      await hashToken(tokens.access_token as string)
    );
    expect(stored).toEqual({
      kind: "session",
      scope: "write",
      scopes: null,
      grant_id: null,
      device_id: null,
      label: "OAuth: Claude",
    });
    // No grant rows and no refresh tokens for MCP clients.
    expect(row(h, "SELECT COUNT(*) AS n FROM oauth_grants")).toEqual({ n: 0 });
    const me = await v1(h, "GET", "/api/v1/me", tokens.access_token as string);
    expect(me.body.credential_kind).toBe("oauth_mcp");
    const who = await h.call("/api/whoami", {
      headers: { Authorization: `Bearer ${tokens.access_token as string}` },
    });
    expect(await who.json()).toMatchObject({
      email: "mcp@example.com",
      scope: "write",
    });
  });

  it("TOAUTH-MCP-COMPAT state stays optional and the refresh grant is refused for MCP clients", async () => {
    const reg = await register({
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
    });
    const clientId = reg.body.client_id as string;
    const back = await mcpCode(clientId);
    expect(back.searchParams.has("state")).toBe(false);
    const res = await h.form(
      "/oauth/token",
      {
        grant_type: "refresh_token",
        refresh_token: "anything",
        client_id: clientId,
      },
      { noOrigin: true }
    );
    expect(((await res.json()) as { error: string }).error).toBe(
      "invalid_grant"
    );
  });

  it("TOAUTH-MCP-COMPAT DCR clients get the mcp ceiling and can never claim a pilih- client id", async () => {
    const reg = await register({ redirect_uris: [REDIRECT] });
    expect(
      row(
        h,
        "SELECT first_party, allowed_scopes, loopback_any_port FROM oauth_clients WHERE client_id = ?",
        reg.body.client_id as string
      )
    ).toEqual({ first_party: 0, allowed_scopes: "mcp", loopback_any_port: 0 });
    for (const clientId of ["pilih-jobs-cli", "pilih-evil", "PILIH-x"]) {
      const refused = await register({
        client_id: clientId,
        redirect_uris: [REDIRECT],
      });
      expect(refused.res.status).toBe(400);
      expect(refused.body.error).toBe("invalid_client_metadata");
    }
    expect(
      row(
        h,
        "SELECT client_name, first_party FROM oauth_clients WHERE client_id = 'pilih-jobs-cli'"
      )
    ).toEqual({ client_name: "pilih-jobs CLI", first_party: 1 });
  });

  it("TOAUTH-MCP-COMPAT MCP tokens minted before the change keep resolving with the legacy write set", async () => {
    await createToken(h.t.env.DB, {
      email: "old@example.com",
      token: "legacy-mcp-token",
      label: "OAuth: Cursor",
      kind: "session",
      scope: "write",
      expiresAt: Date.now() + 86_400_000,
    });
    const me = await v1(h, "GET", "/api/v1/me", "legacy-mcp-token");
    expect(me.status).toBe(200);
    expect(me.body.credential_kind).toBe("oauth_mcp");
    expect(me.body.scopes).not.toContain("automation:execute");
    expect(me.body.scopes).toContain("jobs:write");
    const mcp = await h.call("/mcp", {
      method: "POST",
      body: "{}",
      headers: { Authorization: "Bearer legacy-mcp-token" },
    });
    expect(await mcp.text()).toBe("mcp-ok");
  });

  it("TOAUTH-MCP-COMPAT a confidential client's wrong secret is still invalid_client", async () => {
    const reg = await register({ redirect_uris: [REDIRECT] });
    const clientId = reg.body.client_id as string;
    const back = await mcpCode(clientId);
    const res = await h.form(
      "/oauth/token",
      {
        grant_type: "authorization_code",
        code: back.searchParams.get("code") ?? "",
        code_verifier: VERIFIER,
      },
      {
        noOrigin: true,
        headers: { Authorization: `Basic ${btoa(`${clientId}:wrong`)}` },
      }
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe(
      "invalid_client"
    );
  });
});
