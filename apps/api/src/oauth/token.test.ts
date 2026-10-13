import { beforeEach, describe, expect, it } from "bun:test";
import { hashToken } from "../auth";
import { s256 } from "./token";
import type { Harness, TokenSet } from "./support.test";
import {
  approveWithSession,
  BASE_SCOPE,
  createHarness,
  exchange,
  row,
  rows,
  signedInCookie,
  v1,
  VERIFIER,
} from "./support.test";

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

async function code(scope?: string): Promise<string> {
  const { cookie } = await signedInCookie(h, "alice@example.com");
  const back = await approveWithSession(h, cookie, scope ? { scope } : {});
  return back.searchParams.get("code") ?? "";
}

describe("T17-03 token endpoint for pilih-jobs-cli (17 §7.2)", () => {
  it("T17-03 the PKCE S256 transform matches RFC 7636 Appendix B", async () => {
    expect(await s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("T17-03 issues a 1 h scoped access token and a refresh token with offline_access", async () => {
    const res = await exchange(h, await code());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Pragma")).toBe("no-cache");
    const tokens = (await res.json()) as TokenSet;
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope).toBe(BASE_SCOPE);
    expect(tokens.refresh_token).toBeTruthy();
    const access = row<Record<string, unknown>>(
      h,
      "SELECT kind, scopes, grant_id, user_id, device_id, scope, expires_at - created_at AS ttl, token_hash FROM mcp_tokens WHERE kind = 'oauth'"
    );
    expect(access).toMatchObject({
      kind: "oauth",
      scopes: BASE_SCOPE,
      device_id: null,
      scope: "write",
      ttl: 3_600_000,
      token_hash: await hashToken(tokens.access_token),
    });
    expect(access.grant_id).toStartWith("grt_");
    expect(access.user_id).toStartWith("usr_");
    const refresh = row<Record<string, unknown>>(
      h,
      "SELECT grant_id, parent_id, used_at, token_hash, expires_at - created_at AS ttl FROM oauth_refresh_tokens"
    );
    expect(refresh).toEqual({
      grant_id: access.grant_id,
      parent_id: null,
      used_at: null,
      token_hash: await hashToken(tokens.refresh_token ?? ""),
      ttl: 30 * 86_400_000,
    });
    // Hash-only storage: no plaintext token anywhere in the identity DB.
    const dump =
      JSON.stringify(rows(h, "SELECT * FROM mcp_tokens")) +
      JSON.stringify(rows(h, "SELECT * FROM oauth_refresh_tokens"));
    expect(dump).not.toContain(tokens.access_token);
    expect(dump).not.toContain(tokens.refresh_token ?? "-");
    const me = await v1(h, "GET", "/api/v1/me", tokens.access_token);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      email: "alice@example.com",
      credential_kind: "oauth_cli",
      scopes: BASE_SCOPE.split(" "),
    });
  });

  it("T17-03 the response includes refresh_token only with offline_access", async () => {
    const res = await exchange(h, await code("jobs:read jobs:write"));
    const tokens = (await res.json()) as TokenSet;
    expect(res.status).toBe(200);
    expect(tokens.scope).toBe("jobs:read jobs:write");
    expect(tokens.refresh_token).toBeUndefined();
    expect(rows(h, "SELECT id FROM oauth_refresh_tokens")).toHaveLength(0);
  });

  it("T17-03 the code is single-use", async () => {
    const value = await code();
    expect((await exchange(h, value)).status).toBe(200);
    const replay = await exchange(h, value);
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe(
      "invalid_grant"
    );
    expect(
      rows(h, "SELECT id FROM mcp_tokens WHERE kind = 'oauth'")
    ).toHaveLength(1);
  });

  it("T17-03 a wrong verifier is invalid_grant (and burns the code)", async () => {
    const value = await code();
    const wrong = await exchange(h, value, { verifier: "w".repeat(64) });
    expect(((await wrong.json()) as { error: string }).error).toBe(
      "invalid_grant"
    );
    const right = await exchange(h, value, { verifier: VERIFIER });
    expect(((await right.json()) as { error: string }).error).toBe(
      "invalid_grant"
    );
  });

  it("T17-03 a redirect_uri other than the stored one is invalid_grant", async () => {
    const otherPort = await exchange(h, await code(), {
      redirectUri: "http://127.0.0.1:60000/callback",
    });
    expect(((await otherPort.json()) as { error: string }).error).toBe(
      "invalid_grant"
    );
    const missing = await exchange(h, await code(), { redirectUri: null });
    expect(((await missing.json()) as { error: string }).error).toBe(
      "invalid_grant"
    );
    expect(
      rows(h, "SELECT id FROM mcp_tokens WHERE kind = 'oauth'")
    ).toHaveLength(0);
  });

  it("T17-03 a code presented by another client or for a revoked grant is refused", async () => {
    const value = await code();
    const reg = await h.call("/oauth/register", {
      method: "POST",
      body: JSON.stringify({
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const stolen = await exchange(h, value, { clientId: client_id });
    expect(((await stolen.json()) as { error: string }).error).toBe(
      "invalid_grant"
    );
    const revoked = await code();
    h.t.sqlite
      .query("UPDATE oauth_grants SET revoked_at = 1, revoked_reason = 'user'")
      .run();
    const res = await exchange(h, revoked);
    expect(((await res.json()) as { error: string }).error).toBe(
      "invalid_grant"
    );
  });

  it("T17-03 unsupported grant types and unknown clients are refused", async () => {
    const res = await h.form(
      "/oauth/token",
      { grant_type: "password", client_id: "pilih-jobs-cli" },
      { noOrigin: true }
    );
    expect(((await res.json()) as { error: string }).error).toBe(
      "unsupported_grant_type"
    );
    const unknown = await h.form(
      "/oauth/token",
      { grant_type: "refresh_token", refresh_token: "x", client_id: "nope" },
      { noOrigin: true }
    );
    expect(unknown.status).toBe(401);
  });
});
