import { beforeEach, describe, expect, it } from "bun:test";
import { CLI_BASE_SCOPES } from "../jobs/core/scopes";
import { grantableScopes, redirectMatches } from "./shared";
import type { Harness } from "./support.test";
import {
  approveWithSession,
  authorizeQuery,
  createHarness,
  LOOPBACK,
  row,
  signedInCookie,
} from "./support.test";

const CLI_CLIENT = {
  redirect_uris: '["http://127.0.0.1/callback", "http://[::1]/callback"]',
  loopback_any_port: 1,
};
const DCR_CLIENT = {
  redirect_uris: '["http://127.0.0.1/callback"]',
  loopback_any_port: 0,
};

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

async function authorize(options: Parameters<typeof authorizeQuery>[0] = {}) {
  const query = await authorizeQuery(options);
  return await h.call(`/oauth/authorize?${query}`);
}

describe("T17-01 RFC 8252 any-port loopback (17 §4.2)", () => {
  it("T17-01 redirectMatches accepts any port on 127.0.0.1 and [::1] for a loopback_any_port client", () => {
    expect(redirectMatches(CLI_CLIENT, "http://127.0.0.1:53127/callback")).toBe(
      true
    );
    expect(redirectMatches(CLI_CLIENT, "http://[::1]:61000/callback")).toBe(
      true
    );
    // The registered port-less URIs still match exactly.
    expect(redirectMatches(CLI_CLIENT, "http://127.0.0.1/callback")).toBe(true);
  });

  it("T17-01 redirectMatches rejects localhost, other paths, queries, fragments, userinfo and other hosts", () => {
    for (const uri of [
      "http://localhost:53127/callback",
      "http://127.0.0.1:53127/callback/",
      "http://127.0.0.1:53127/cb",
      "http://127.0.0.1:53127/callback?x=1",
      "http://127.0.0.1:53127/callback?",
      "http://127.0.0.1:53127/callback#frag",
      "http://user:pw@127.0.0.1:53127/callback",
      "https://127.0.0.1:53127/callback",
      "http://127.0.0.2:53127/callback",
      "http://127.0.0.1:0/callback",
      "HTTP://127.0.0.1:53127/callback",
      "http://127.0.0.1:53127/x/../callback",
      "not a url",
    ]) {
      expect({ uri, ok: redirectMatches(CLI_CLIENT, uri) }).toEqual({
        uri,
        ok: false,
      });
    }
  });

  it("T17-01 redirectMatches never wildcards the port of a DCR client", () => {
    expect(redirectMatches(DCR_CLIENT, "http://127.0.0.1/callback")).toBe(true);
    expect(redirectMatches(DCR_CLIENT, "http://127.0.0.1:53127/callback")).toBe(
      false
    );
  });

  it("T17-01 the CLI's ephemeral loopback port is accepted by /oauth/authorize", async () => {
    const v4 = await authorize();
    expect(v4.status).toBe(200);
    expect(await v4.text()).toContain('name="email"');
    const v6 = await authorize({ redirectUri: "http://[::1]:49152/callback" });
    expect(v6.status).toBe(200);
  });

  it("T17-01 any-port is rejected for a DCR client", async () => {
    const reg = await h.call("/oauth/register", {
      method: "POST",
      body: JSON.stringify({
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const exact = await authorize({
      clientId: client_id,
      redirectUri: "http://127.0.0.1/callback",
    });
    expect(exact.status).toBe(200);
    const anyPort = await authorize({
      clientId: client_id,
      redirectUri: "http://127.0.0.1:53127/callback",
    });
    expect(anyPort.status).toBe(400);
    expect(anyPort.headers.get("Location")).toBeNull();
  });

  it("T17-01 a localhost host, a path mismatch and a query string are rejected without redirecting", async () => {
    for (const redirectUri of [
      "http://localhost:53127/callback",
      "http://127.0.0.1:53127/other",
      "http://127.0.0.1:53127/callback?next=evil",
    ]) {
      const res = await authorize({ redirectUri });
      expect(res.status).toBe(400);
      expect(res.headers.get("Location")).toBeNull();
      expect(await res.text()).toContain("redirect_uri is not registered");
    }
  });
});

describe("T17-01 state, scopes and the CLI login flag (17 §4.1, §5)", () => {
  it("T17-01 a missing or short state is rejected for a first-party client", async () => {
    const missing = await authorize({ state: null });
    expect(missing.status).toBe(400);
    expect(await missing.text()).toContain("state is required");
    const short = await authorize({ state: "x".repeat(21) });
    expect(short.status).toBe(400);
  });

  it("T17-01 unknown scopes are dropped and scopes above the client ceiling are clipped", async () => {
    expect(
      grantableScopes(
        { allowed_scopes: "jobs:read offline_access" },
        "jobs:read jobs:write bogus mcp offline_access"
      )
    ).toEqual(["jobs:read", "offline_access"]);
    // A first-party client whose ceiling is narrower than what the CLI asks.
    h.t.sqlite
      .query(
        "INSERT INTO oauth_clients (client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method, created_at, first_party, allowed_scopes, loopback_any_port) VALUES ('pilih-test', '', 'Test CLI', '[\"http://127.0.0.1/callback\"]', 'none', 0, 1, 'jobs:read offline_access', 1)"
      )
      .run();
    const { cookie } = await signedInCookie(h, "alice@example.com");
    const back = await approveWithSession(h, cookie, {
      clientId: "pilih-test",
      scope:
        "jobs:read jobs:write automation:manage nonsense:scope offline_access",
    });
    expect(back.searchParams.get("code")).toBeTruthy();
    const grant = row<{ scopes: string; device_id: string | null }>(
      h,
      "SELECT scopes, device_id FROM oauth_grants WHERE client_id = 'pilih-test'"
    );
    expect(grant).toEqual({
      scopes: "jobs:read offline_access",
      device_id: null,
    });
  });

  it("T17-01 a request whose scopes are all unknown or above the ceiling is refused", async () => {
    const res = await authorize({ scope: "bogus mcp" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("None of the requested scopes");
  });

  it("T17-01 no scope parameter means the CLI base set (17 §5.1)", async () => {
    const { cookie } = await signedInCookie(h, "alice@example.com");
    await approveWithSession(h, cookie, { scope: "" });
    const grant = row<{ scopes: string }>(
      h,
      "SELECT scopes FROM oauth_grants WHERE client_id = 'pilih-jobs-cli'"
    );
    expect(grant.scopes.split(" ")).toEqual([...CLI_BASE_SCOPES]);
  });

  it("T17-01 PKCE S256 stays mandatory; plain is rejected", async () => {
    const query = await authorizeQuery();
    query.set("code_challenge_method", "plain");
    const res = await h.call(`/oauth/authorize?${query}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("S256");
  });

  it("T17-01 the first-party login is dark while JOBS_CLI_LOGIN_ENABLED is off", async () => {
    await h.t.setFlag("JOBS_CLI_LOGIN_ENABLED", false);
    const res = await authorize();
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("CLI sign-in is not available");
    expect(LOOPBACK).toContain("127.0.0.1");
  });
});
