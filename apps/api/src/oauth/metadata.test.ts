import { beforeEach, describe, expect, it } from "bun:test";
import { OAUTH_SCOPES } from "@pilihpendidikan/jobs-contracts/enums";
import { createCtx } from "../../test/fakes";
import { createToken } from "../auth";
import { buildRouteTable, defineRoute, dispatchV1 } from "../jobs/core/router";
import { listRouteTable } from "../jobs/routes/table";
import { authorizationServerMetadata } from "./discovery";
import type { Harness } from "./support.test";
import { createHarness, PROD, v1 } from "./support.test";

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

const ALL_SCOPES = [...OAUTH_SCOPES, "mcp"];

describe("T17-08 authorization-server metadata (RFC 8414, 17 §13)", () => {
  it("T17-08 the discovery document matches the implemented grants (snapshot)", async () => {
    const res = await h.call("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await res.json()) as unknown).toEqual({
      issuer: PROD,
      authorization_endpoint: `${PROD}/oauth/authorize`,
      token_endpoint: `${PROD}/oauth/token`,
      registration_endpoint: `${PROD}/oauth/register`,
      revocation_endpoint: `${PROD}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
        "none",
      ],
      revocation_endpoint_auth_methods_supported: [
        "none",
        "client_secret_basic",
        "client_secret_post",
      ],
      scopes_supported: ALL_SCOPES,
      resource_indicators_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    // Path-suffixed discovery answers the same document.
    const suffixed = await h.call(
      "/.well-known/oauth-authorization-server/mcp"
    );
    expect((await suffixed.json()) as unknown).toEqual(
      authorizationServerMetadata(PROD)
    );
  });

  it("T17-08 every advertised endpoint and grant type is served", async () => {
    const doc = authorizationServerMetadata(PROD);
    for (const url of [doc.token_endpoint, doc.revocation_endpoint]) {
      const res = await h.form(new URL(url).pathname, {}, { noOrigin: true });
      expect(res.status).not.toBe(404);
    }
    for (const grantType of doc.grant_types_supported) {
      const res = await h.form(
        "/oauth/token",
        { grant_type: grantType, client_id: "pilih-jobs-cli" },
        { noOrigin: true }
      );
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toBe("unsupported_grant_type");
    }
  });

  it("T17-08 the protected-resource metadata lists the same scopes", async () => {
    const res = await h.call("/.well-known/oauth-protected-resource");
    expect((await res.json()) as unknown).toEqual({
      resource: `${PROD}/`,
      authorization_servers: [PROD],
      bearer_methods_supported: ["header"],
      scopes_supported: ALL_SCOPES,
    });
  });
});

describe("T17-07 scopes are declared and enforced (17 §5.2)", () => {
  it("T17-07 every /api/v1 route declares a scope", () => {
    const valid = new Set<string>([...OAUTH_SCOPES, "any", "none"]);
    const table = listRouteTable();
    expect(table.length).toBeGreaterThan(5);
    const missing = table.filter((route) => !valid.has(route.scope));
    expect(missing).toEqual([]);
    for (const route of table) {
      for (const extra of [
        ...(route.alt_scope ? [route.alt_scope] : []),
        ...route.also_requires,
      ]) {
        expect(valid.has(extra)).toBe(true);
      }
    }
  });

  it("T17-07 a personal token is denied automation:execute and ai:invoke", async () => {
    await createToken(h.t.env.DB, {
      email: "alice@example.com",
      token: "pat-write",
      label: "script",
      kind: "personal",
      scope: "write",
      expiresAt: null,
    });
    const heartbeat = await v1(
      h,
      "POST",
      "/api/v1/devices/dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0D/heartbeat",
      "pat-write",
      {}
    );
    expect(heartbeat.status).toBe(403);
    expect(heartbeat.body).toMatchObject({
      error: "insufficient_scope",
      scope: "automation:execute",
    });
    const table = buildRouteTable([
      defineRoute({
        method: "POST",
        pattern: "/api/v1/ai/probe",
        scope: "ai:invoke",
        idempotency: "none",
        handler: (c) => c.respond({ ok: true }),
      }),
    ]);
    const res = await dispatchV1(
      table,
      new Request(`${PROD}/api/v1/ai/probe`, {
        method: "POST",
        headers: { Authorization: "Bearer pat-write" },
      }),
      h.t.env,
      createCtx()
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "insufficient_scope",
      scope: "ai:invoke",
    });
    expect(res.headers.get("WWW-Authenticate")).toBe(
      'Bearer error="insufficient_scope", scope="ai:invoke"'
    );
  });
});
