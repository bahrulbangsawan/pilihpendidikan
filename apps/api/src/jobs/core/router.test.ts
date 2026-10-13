import { beforeEach, describe, expect, it } from "bun:test";
import { ErrorEnvelopeSchema } from "@pilihpendidikan/jobs-contracts";
import { API_ERROR_STATUS } from "@pilihpendidikan/jobs-contracts/enums";
import type { ApiErrorCode } from "@pilihpendidikan/jobs-contracts/enums";
import { z } from "zod";
import type {
  FakeClock,
  TestEnv,
  V1Client,
  V1Session,
} from "../../../test/fakes";
import {
  createCtx,
  createFakeClock,
  createTestEnv,
  createV1Client,
  TEST_API_ORIGIN,
} from "../../../test/fakes";
import { AiProviderError } from "../ai/primitives";
import { appendChangeFromRow } from "../repo/core/change-log";
import {
  GuardFailedError,
  guardRevision,
  queryFirst,
  stmt,
  UniqueViolationError,
} from "../repo/core/db";
import { IDEMPOTENCY_TTL_MS } from "../repo/core/idempotency";
import { ensureUserSettingsStatements } from "../repo/core/settings";
import { listRouteTable } from "../routes/table";
import { apiError, errorResponse, notFound } from "./http";
import type { RouteDef } from "./router";
import { buildRouteTable, defineRoute, dispatchV1, matchRoute } from "./router";

let t: TestEnv;
let clock: FakeClock;
let client: V1Client;

beforeEach(() => {
  t = createTestEnv();
  clock = createFakeClock();
  client = createV1Client(t, { clock });
});

const echo =
  (name: string) => (c: { respond(b: unknown): Response; params: unknown }) =>
    c.respond({ name, params: c.params });

// Dispatches through a custom route table with a session's credentials.
async function callTable(
  routes: RouteDef[],
  session: V1Session | null,
  method: string,
  path: string,
  init: { body?: string; headers?: Record<string, string> } = {}
): Promise<{
  body: Record<string, unknown>;
  response: Response;
  status: number;
}> {
  const headers = new Headers({ ...(session?.headers ?? {}), ...init.headers });
  if (session?.bearer) {
    headers.set("Authorization", `Bearer ${session.bearer}`);
  }
  const ctx = createCtx();
  const response = await dispatchV1(
    buildRouteTable(routes),
    new Request(`${TEST_API_ORIGIN}${path}`, {
      method,
      headers,
      body: init.body,
    }),
    t.env,
    ctx,
    { clock }
  );
  await ctx.drain();
  const text = await response.clone().text();
  return {
    status: response.status,
    response,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

function expectEnvelope(body: unknown, code: ApiErrorCode): void {
  const parsed = ErrorEnvelopeSchema.parse(body);
  expect(parsed.error).toBe(code);
  expect(parsed.request_id.length).toBeGreaterThan(0);
}

describe("TCORE-ROUTER matching", () => {
  const routes = [
    defineRoute({
      method: "GET",
      pattern: "/api/v1/sources/{src_id}",
      scope: "none",
      idempotency: "none",
      handler: echo("source"),
    }),
    defineRoute({
      method: "GET",
      pattern: "/api/v1/sources/adapters",
      scope: "none",
      idempotency: "none",
      handler: echo("adapters"),
    }),
    defineRoute({
      method: "GET",
      pattern: "/api/v1/a/{app_id}/interviews/{ivw_id}",
      scope: "none",
      idempotency: "none",
      handler: echo("interview"),
    }),
    defineRoute({
      method: "GET",
      pattern: "/api/v1/a/{app_id}/interviews/{ivw_id}.ics",
      scope: "none",
      idempotency: "none",
      handler: echo("ics"),
    }),
    defineRoute({
      method: "POST",
      pattern: "/api/v1/runs/{run_id}/postings:batch",
      scope: "none",
      idempotency: "none",
      handler: echo("batch"),
    }),
  ];
  const table = buildRouteTable(routes);

  it("TCORE-ROUTER prefers the most literal pattern and decodes params", () => {
    const adapters = matchRoute(table, "GET", "/api/v1/sources/adapters");
    expect(adapters.kind === "matched" && adapters.route.pattern).toBe(
      "/api/v1/sources/adapters"
    );
    const source = matchRoute(table, "GET", "/api/v1/sources/src_1");
    expect(source.kind === "matched" && source.params).toEqual({
      src_id: "src_1",
    });
    const ics = matchRoute(
      table,
      "GET",
      "/api/v1/a/app_1/interviews/ivw_2.ics"
    );
    expect(ics.kind === "matched" && ics.params).toEqual({
      app_id: "app_1",
      ivw_id: "ivw_2",
    });
    expect(ics.kind === "matched" && ics.route.pattern.endsWith(".ics")).toBe(
      true
    );
    const batch = matchRoute(
      table,
      "POST",
      "/api/v1/runs/run_9/postings:batch"
    );
    expect(batch.kind === "matched" && batch.params).toEqual({
      run_id: "run_9",
    });
    const encoded = matchRoute(table, "GET", "/api/v1/sources/a%20b");
    expect(encoded.kind === "matched" && encoded.params).toEqual({
      src_id: "a b",
    });
  });

  it("TCORE-ROUTER answers 404 for unknown paths and bad escapes, 405 with Allow", async () => {
    expect(matchRoute(table, "GET", "/api/v1/sources/%E0%A4%A").kind).toBe(
      "not_found"
    );
    const unknown = await callTable(routes, null, "GET", "/api/v1/nope");
    expect(unknown.status).toBe(404);
    expectEnvelope(unknown.body, "not_found");
    expect(unknown.response.headers.get("X-Request-Id")).toBe(
      unknown.body.request_id as string
    );
    const wrong = await callTable(
      routes,
      null,
      "DELETE",
      "/api/v1/sources/src_1"
    );
    expect(wrong.status).toBe(405);
    expect(wrong.response.headers.get("Allow")).toBe("GET");
  });

  it("TCORE-ROUTER refuses duplicate routes and patterns outside /api/v1", () => {
    expect(() => buildRouteTable([routes[0], routes[0]])).toThrow(
      "duplicate route"
    );
    expect(() =>
      defineRoute({
        method: "GET",
        pattern: "/api/jobs",
        scope: "none",
        idempotency: "none",
        handler: echo("x"),
      })
    ).toThrow();
  });

  it("TCORE-ROUTER serves /api/v1/meta to anyone and /api/v1/me to every credential", async () => {
    const meta = await client.anonymous().get("/api/v1/meta");
    expect(meta.status).toBe(200);
    expect(meta.body).toMatchObject({
      api_version: "v1",
      min_cli_version: "0.1.0",
      recommended_cli_version: "0.1.0",
      server_time: clock.now(),
    });
    expect(meta.body.features).toContain("jobs_v1");
    expect(meta.headers.get("Cache-Control")).toContain("no-store");

    const web = await client.browserSession("alice@example.com");
    const me = await web.get("/api/v1/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      user_id: web.userId,
      email: "alice@example.com",
      is_admin: false,
      credential_kind: "browser_session",
    });
    expect(me.body.device).toBeUndefined();

    const cli = await client.cliSession("alice@example.com", {
      device: { name: "Work Mac" },
    });
    const cliMe = await cli.get("/api/v1/me");
    expect(cliMe.body).toMatchObject({
      user_id: web.userId,
      credential_kind: "oauth_cli",
      device: { id: cli.deviceId, name: "Work Mac" },
    });
    const pat = await client.personalToken("bob@example.com", "read");
    const patMe = await pat.get("/api/v1/me");
    expect(patMe.body).toMatchObject({
      credential_kind: "personal_read",
      scopes: ["jobs:read", "cv:read", "files:read"],
    });
  });

  it("TCORE-ROUTER answers 401 invalid_token with reason and never reads cookies", async () => {
    const anon = await client.anonymous().get("/api/v1/me");
    expect(anon.status).toBe(401);
    expectEnvelope(anon.body, "invalid_token");
    expect(anon.body.reason).toBe("no_bearer");
    expect(anon.headers.get("WWW-Authenticate")).toBe(
      'Bearer error="invalid_token"'
    );
    const web = await client.browserSession("cookie@example.com");
    const viaCookie = await client.anonymous().get("/api/v1/me", {
      headers: { Cookie: `__Host-session=${web.bearer}` },
    });
    expect(viaCookie.status).toBe(401);
    const bogus = await client.anonymous().get("/api/v1/me", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(bogus.body.reason).toBe("unknown_token");
  });

  it("TCORE-ROUTER refuses tombstoned users and revoked devices with revoked_token", async () => {
    const cli = await client.cliSession("dev@example.com");
    expect((await cli.get("/api/v1/me")).status).toBe(200);
    t.sqlite
      .query("UPDATE devices SET revoked_at = 1 WHERE id = ?")
      .run(cli.deviceId as string);
    const revoked = await cli.get("/api/v1/me");
    expect(revoked.status).toBe(401);
    expect(revoked.body.reason).toBe("revoked_token");
    const web = await client.browserSession("gone@example.com");
    t.sqlite
      .query("UPDATE users SET deleted_at = 1 WHERE id = ?")
      .run(web.userId as string);
    expect((await web.get("/api/v1/me")).body.reason).toBe("revoked_token");
  });

  it("TFIX-ACCOUNT-DELETED-401 marks only a deleted account's revoked_token with details.revoked_reason (11 §10, 20 §5.3)", async () => {
    const device = await client.cliSession("device-gone@example.com");
    t.sqlite
      .query("UPDATE devices SET revoked_at = 1 WHERE id = ?")
      .run(device.deviceId as string);
    const deviceRevoked = await device.get("/api/v1/me");
    expect(deviceRevoked.body.reason).toBe("revoked_token");
    expect(deviceRevoked.body.details).toBeUndefined();

    const tombstoned = await client.cliSession("account-gone@example.com");
    t.sqlite
      .query("UPDATE users SET deleted_at = 1 WHERE id = ?")
      .run(tombstoned.userId as string);
    const live = await tombstoned.get("/api/v1/me");
    expect(live.status).toBe(401);
    expect(live.body.details).toEqual({ revoked_reason: "account_deleted" });

    // Account deletion also revokes every token (11 §10 step 1).
    t.sqlite
      .query(
        "UPDATE mcp_tokens SET status = 'revoked', revoked_at = 1 WHERE user_id = ?"
      )
      .run(tombstoned.userId as string);
    const revoked = await tombstoned.get("/api/v1/me");
    expect(revoked.body.reason).toBe("revoked_token");
    expect(revoked.body.details).toEqual({ revoked_reason: "account_deleted" });
  });

  it("TCORE-ROUTER writes device presence at most once per 5 minutes (04 §1)", async () => {
    const cli = await client.cliSession("presence@example.com");
    const seen = () =>
      (
        t.sqlite
          .query("SELECT last_seen_at FROM devices WHERE id = ?")
          .get(cli.deviceId as string) as {
          last_seen_at: number | null;
        }
      ).last_seen_at;
    await cli.get("/api/v1/me");
    const first = seen();
    expect(first).toBe(clock.now());
    clock.advance(60_000);
    await cli.get("/api/v1/me");
    expect(seen()).toBe(first);
    clock.advance(300_000);
    await cli.get("/api/v1/me");
    expect(seen()).toBe(clock.now());
  });

  it("TCORE-ROUTER enforces the device rule (403 device_required)", async () => {
    const routes = [
      defineRoute({
        method: "POST",
        pattern: "/api/v1/devices/{dev_id}/tasks:claim",
        scope: "automation:execute",
        idempotency: "none",
        device: true,
        handler: (c) => c.respond({ device: c.device?.id ?? null }),
      }),
    ];
    const web = await client.browserSession("w@example.com");
    const fromWeb = await callTable(
      routes,
      web,
      "POST",
      "/api/v1/devices/dev_x/tasks:claim"
    );
    expect(fromWeb.status).toBe(403);
    expectEnvelope(fromWeb.body, "insufficient_scope");
    const unbound = await client.cliSession("w@example.com", { device: false });
    const noDevice = await callTable(
      routes,
      unbound,
      "POST",
      "/api/v1/devices/dev_x/tasks:claim"
    );
    expect(noDevice.status).toBe(403);
    expectEnvelope(noDevice.body, "device_required");
    const bound = await client.cliSession("w@example.com");
    const ok = await callTable(
      routes,
      bound,
      "POST",
      "/api/v1/devices/dev_x/tasks:claim"
    );
    expect(ok.status).toBe(200);
    expect(ok.body.device).toBe(bound.deviceId);
  });

  it("TCORE-ROUTER applies the 05 §1.9 rate limits (429 + Retry-After)", async () => {
    const routes = [
      defineRoute({
        method: "GET",
        pattern: "/api/v1/poll",
        scope: "any",
        idempotency: "none",
        rateLimit: "task-poll",
        handler: (c) => c.respond({ ok: true }),
      }),
    ];
    const cli = await client.cliSession("poll@example.com");
    for (let i = 0; i < 30; i++) {
      expect((await callTable(routes, cli, "GET", "/api/v1/poll")).status).toBe(
        200
      );
    }
    const limited = await callTable(routes, cli, "GET", "/api/v1/poll");
    expect(limited.status).toBe(429);
    expectEnvelope(limited.body, "rate_limited");
    expect(Number(limited.response.headers.get("Retry-After"))).toBeGreaterThan(
      0
    );
    // Another device of the same user has its own window.
    const other = await client.cliSession("poll@example.com");
    expect((await callTable(routes, other, "GET", "/api/v1/poll")).status).toBe(
      200
    );
  });

  it("TCORE-ROUTER validates bodies and queries (413, 400 + issues)", async () => {
    const routes = [
      defineRoute({
        method: "POST",
        pattern: "/api/v1/things",
        scope: "any",
        idempotency: "optional",
        body: z.object({ name: z.string().min(1), count: z.number().int() }),
        query: z.object({ mode: z.enum(["a", "b"]).optional() }),
        handler: (c) =>
          c.respond({
            name: c.body.name,
            count: c.body.count,
            mode: c.queryData.mode ?? null,
          }),
      }),
    ];
    const web = await client.browserSession("v@example.com");
    const json = { "Content-Type": "application/json" };
    const ok = await callTable(routes, web, "POST", "/api/v1/things?mode=b", {
      body: JSON.stringify({ name: "x", count: 2 }),
      headers: json,
    });
    expect(ok.body).toEqual({ name: "x", count: 2, mode: "b" });
    const invalid = await callTable(routes, web, "POST", "/api/v1/things", {
      body: JSON.stringify({ name: "", count: 1.5 }),
      headers: json,
    });
    expect(invalid.status).toBe(400);
    expectEnvelope(invalid.body, "invalid_request");
    const issues = (
      invalid.body.details as { issues: Array<{ path: string[] }> }
    ).issues;
    expect(issues.map((i) => i.path[0]).sort()).toEqual(["count", "name"]);
    const badQuery = await callTable(
      routes,
      web,
      "POST",
      "/api/v1/things?mode=z",
      {
        body: JSON.stringify({ name: "x", count: 1 }),
        headers: json,
      }
    );
    expect(badQuery.status).toBe(400);
    const malformed = await callTable(routes, web, "POST", "/api/v1/things", {
      body: "{",
      headers: json,
    });
    expect(malformed.status).toBe(400);
    const wrongType = await callTable(routes, web, "POST", "/api/v1/things", {
      body: JSON.stringify({ name: "x", count: 1 }),
      headers: { "Content-Type": "text/plain" },
    });
    expect(wrongType.status).toBe(400);
    const huge = await callTable(routes, web, "POST", "/api/v1/things", {
      body: JSON.stringify({ name: "x".repeat(1_100_000), count: 1 }),
      headers: json,
    });
    expect(huge.status).toBe(413);
    expectEnvelope(huge.body, "payload_too_large");
  });

  it("TCORE-ROUTER serves credentialed CORS for the jobs origin", async () => {
    const preflight = await client.fetch(
      new Request(`${TEST_API_ORIGIN}/api/v1/me`, {
        method: "OPTIONS",
        headers: { Origin: "https://jobs.pilihpendidikan.com" },
      })
    );
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://jobs.pilihpendidikan.com"
    );
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain(
      "Idempotency-Key"
    );
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain(
      "PATCH"
    );
    const meta = await client.anonymous().get("/api/v1/meta", {
      headers: { Origin: "https://jobs.pilihpendidikan.com" },
    });
    expect(meta.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(meta.headers.get("Access-Control-Expose-Headers")).toContain(
      "Idempotent-Replayed"
    );
    const devFromProd = await client.anonymous().get("/api/v1/meta", {
      headers: { Origin: "http://localhost:4007" },
    });
    expect(devFromProd.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("TCORE-ROUTER alternative credentials (PLAN C8 render tickets)", () => {
  it("TCORE-ROUTER altAuth runs only without Authorization and still checks scopes", async () => {
    const web = await client.browserSession("ticket@example.com");
    const routes = [
      defineRoute({
        method: "GET",
        pattern: "/api/v1/cv-variants/{cvv_id}",
        scope: "cv:read",
        idempotency: "none",
        altAuth: (request) => {
          const ticket = request.headers.get("X-Render-Ticket");
          if (ticket !== "good" && ticket !== "narrow") {
            return Promise.resolve(null);
          }
          return Promise.resolve({
            email: "ticket@example.com",
            isAdmin: false,
            scope: "read" as const,
            userId: web.userId as string,
            scopes:
              ticket === "good"
                ? (["cv:read"] as const)
                : (["files:write"] as const),
            deviceId: null,
            grantId: null,
            credentialKind: "browser_session" as const,
            tokenId: null,
            userDeletedAt: null,
          });
        },
        handler: (c) =>
          c.respond({ user: c.caller.userId, id: c.params.cvv_id }),
      }),
    ];
    const ok = await callTable(
      routes,
      null,
      "GET",
      "/api/v1/cv-variants/cvv_1",
      {
        headers: { "X-Render-Ticket": "good" },
      }
    );
    expect(ok.body).toEqual({ user: web.userId, id: "cvv_1" });
    const bad = await callTable(
      routes,
      null,
      "GET",
      "/api/v1/cv-variants/cvv_1",
      {
        headers: { "X-Render-Ticket": "forged" },
      }
    );
    expect(bad.status).toBe(401);
    const narrow = await callTable(
      routes,
      null,
      "GET",
      "/api/v1/cv-variants/cvv_1",
      {
        headers: { "X-Render-Ticket": "narrow" },
      }
    );
    expect(narrow.status).toBe(403);
    const bearer = await callTable(
      routes,
      web,
      "GET",
      "/api/v1/cv-variants/cvv_2",
      {
        headers: { "X-Render-Ticket": "forged" },
      }
    );
    expect(bearer.body).toEqual({ user: web.userId, id: "cvv_2" });
  });
});

describe("TCORE-ROUTER scopes (05 §1.2)", () => {
  const routes = [
    defineRoute({
      method: "POST",
      pattern: "/api/v1/write",
      scope: "jobs:write",
      idempotency: "none",
      handler: (c) => c.respond({ via: c.grantedVia }),
    }),
    defineRoute({
      method: "POST",
      pattern: "/api/v1/alt",
      scope: "automation:manage",
      altScope: "automation:execute",
      idempotency: "none",
      handler: (c) => c.respond({ via: c.grantedVia }),
    }),
    defineRoute({
      method: "POST",
      pattern: "/api/v1/both",
      scope: "cv:write",
      alsoRequires: ["ai:invoke"],
      idempotency: "none",
      handler: (c) => c.respond({ via: c.grantedVia }),
    }),
  ];

  it("TCORE-SCOPES 403 insufficient_scope names the missing scope", async () => {
    const reader = await client.personalToken("r@example.com", "read");
    const denied = await callTable(routes, reader, "POST", "/api/v1/write");
    expect(denied.status).toBe(403);
    expectEnvelope(denied.body, "insufficient_scope");
    expect(denied.body.scope).toBe("jobs:write");
    expect(denied.response.headers.get("WWW-Authenticate")).toBe(
      'Bearer error="insufficient_scope", scope="jobs:write"'
    );
    const writer = await client.personalToken("r@example.com", "write");
    expect(
      (await callTable(routes, writer, "POST", "/api/v1/write")).body.via
    ).toBe("scope");
  });

  it("TCORE-SCOPES alt scopes and combined scopes", async () => {
    const web = await client.browserSession("s@example.com");
    expect((await callTable(routes, web, "POST", "/api/v1/alt")).body.via).toBe(
      "scope"
    );
    const cli = await client.cliSession("s@example.com");
    expect((await callTable(routes, cli, "POST", "/api/v1/alt")).body.via).toBe(
      "alt_scope"
    );
    expect((await callTable(routes, web, "POST", "/api/v1/both")).status).toBe(
      200
    );
    const pat = await client.personalToken("s@example.com", "write");
    const noAi = await callTable(routes, pat, "POST", "/api/v1/both");
    expect(noAi.status).toBe(403);
    expect(noAi.body.scope).toBe("ai:invoke");
  });
});

describe("TCORE-FLAGS JOBS_V1_ENABLED and the flag cache (D-33)", () => {
  it("TCORE-FLAGS every route but /meta is 404 while v1 is dark", async () => {
    const dark = createTestEnv({}, { flags: { JOBS_V1_ENABLED: false } });
    const darkClient = createV1Client(dark, { clock });
    const web = await darkClient.browserSession("dark@example.com");
    const me = await web.get("/api/v1/me");
    expect(me.status).toBe(404);
    expectEnvelope(me.body, "not_found");
    const meta = await darkClient.anonymous().get("/api/v1/meta");
    expect(meta.status).toBe(200);
    expect(meta.body.features).not.toContain("jobs_v1");
    await dark.setFlag("JOBS_V1_ENABLED", true);
    expect((await web.get("/api/v1/me")).status).toBe(200);
  });

  it("TCORE-FLAGS rows are cached for 30 s per isolate", async () => {
    const { getFeatureFlags } = await import("./flags");
    const now = clock.now();
    expect((await getFeatureFlags(t.env, now)).JOBS_AUTOMATION_ENABLED).toBe(
      false
    );
    t.sqlite
      .query(
        "UPDATE feature_flags SET value = 'true' WHERE key = 'JOBS_AUTOMATION_ENABLED'"
      )
      .run();
    expect(
      (await getFeatureFlags(t.env, now + 29_000)).JOBS_AUTOMATION_ENABLED
    ).toBe(false);
    expect(
      (await getFeatureFlags(t.env, now + 30_000)).JOBS_AUTOMATION_ENABLED
    ).toBe(true);
  });

  it("TCORE-FLAGS parses JSON scalars and falls back to dark defaults", async () => {
    const { parseFlagRows, enabledFeatureNames, FLAG_DEFAULTS } = await import(
      "./flags"
    );
    const flags = parseFlagRows([
      { key: "JOBS_V1_ENABLED", value: "true" },
      { key: "AI_DISABLED", value: "1" },
      { key: "JOBS_AUTOMATION_ENABLED", value: "maybe" },
      { key: "JOBS_LEGACY_BACKEND", value: '"d1"' },
      { key: "UNKNOWN_FLAG", value: "true" },
    ]);
    expect(flags).toEqual({
      ...FLAG_DEFAULTS,
      JOBS_V1_ENABLED: true,
      AI_DISABLED: true,
      JOBS_LEGACY_BACKEND: "d1",
    });
    expect(enabledFeatureNames(flags)).toEqual(["jobs_v1", "legacy_d1"]);
    expect(
      parseFlagRows([{ key: "JOBS_LEGACY_BACKEND", value: "bogus" }])
        .JOBS_LEGACY_BACKEND
    ).toBe("kv");
  });
});

describe("S-32 CLI below min_cli_version gets 426 (05 §1.7)", () => {
  it("S-32 every declared route but /meta answers 426 cli_upgrade_required", async () => {
    const gated = createTestEnv({
      JOBS_MIN_CLI_VERSION: "0.3.0",
      JOBS_RECOMMENDED_CLI_VERSION: "0.4.0",
    });
    const gatedClient = createV1Client(gated, { clock });
    const old = await gatedClient.cliSession("old@example.com", {
      cliVersion: "0.2.9",
    });
    for (const route of listRouteTable()) {
      const path = route.pattern.replace(/\{[^}]+\}/g, "x_1");
      const res = await old.call(route.method, path);
      if (route.version_exempt) {
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          min_cli_version: "0.3.0",
          recommended_cli_version: "0.4.0",
        });
      } else {
        expect(res.status).toBe(426);
        expect(res.body).toMatchObject({
          error: "cli_upgrade_required",
          details: { client_version: "0.2.9", min_cli_version: "0.3.0" },
        });
      }
    }
  });

  it("S-32 current, pre-release-of-minimum and header-less clients pass; garbage fails", async () => {
    const gated = createTestEnv({ JOBS_MIN_CLI_VERSION: "0.3.0" });
    const gatedClient = createV1Client(gated, { clock });
    for (const [version, status] of [
      ["0.3.0", 200],
      ["1.0.0", 200],
      ["0.3.0-rc.1", 200],
      ["0.3.0.dev4", 200],
      [null, 200],
      ["0.2.99", 426],
      ["banana", 426],
    ] as const) {
      const cli = await gatedClient.cliSession(`v${version}@example.com`, {
        cliVersion: version,
      });
      expect((await cli.get("/api/v1/me")).status).toBe(status);
    }
  });
});

describe("TCORE-ERRORS the error envelope (05 §1.3)", () => {
  it("TCORE-ERRORS every error code renders with its 05 §1.3 status", async () => {
    for (const [code, status] of Object.entries(API_ERROR_STATUS)) {
      const response = errorResponse(
        apiError(code as ApiErrorCode, `msg ${code}`),
        "req-1"
      );
      expect(response.status).toBe(status);
      const body = await response.json();
      expectEnvelope(body, code as ApiErrorCode);
      expect(body).toMatchObject({
        message: `msg ${code}`,
        request_id: "req-1",
      });
      expect(response.headers.get("X-Request-Id")).toBe("req-1");
    }
  });

  it("TCORE-ERRORS maps handler failures to envelopes", async () => {
    const thrower = (pattern: string, error: () => unknown) =>
      defineRoute({
        method: "GET",
        pattern,
        scope: "none",
        idempotency: "none",
        handler: () => {
          throw error();
        },
      });
    const routes = [
      thrower("/api/v1/e/api", () => notFound("Application not found.")),
      thrower("/api/v1/e/guard", () => new GuardFailedError("revision:x")),
      thrower(
        "/api/v1/e/unique",
        () => new UniqueViolationError("job_sources.id")
      ),
      thrower("/api/v1/e/zod", () => z.object({ a: z.string() }).parse({})),
      thrower(
        "/api/v1/e/ai",
        () => new AiProviderError("rate_limited", "slow down", 429)
      ),
      thrower("/api/v1/e/bug", () => new TypeError("boom")),
    ];
    const cases: [string, number, ApiErrorCode][] = [
      ["/api/v1/e/api", 404, "not_found"],
      ["/api/v1/e/guard", 409, "revision_conflict"],
      ["/api/v1/e/unique", 409, "duplicate"],
      ["/api/v1/e/zod", 400, "invalid_request"],
      ["/api/v1/e/ai", 503, "upstream_unavailable"],
      ["/api/v1/e/bug", 503, "upstream_unavailable"],
    ];
    for (const [path, status, code] of cases) {
      const res = await callTable(routes, null, "GET", path);
      expect(res.status).toBe(status);
      expectEnvelope(res.body, code);
    }
    const notFoundRes = await callTable(routes, null, "GET", "/api/v1/e/api");
    expect(notFoundRes.body.message).toBe("Application not found.");
  });
});

// A user_settings writer that follows the kernel write pattern: guard →
// update → change_log → idempotency, all in one batch via c.commit.
function settingsRoutes(counter: { executions: number }): RouteDef[] {
  return [
    defineRoute({
      method: "POST",
      pattern: "/api/v1/test/settings",
      scope: "jobs:write",
      idempotency: "required",
      body: z.object({
        locale: z.enum(["en", "id"]),
        base_revision: z.number().int().optional(),
      }),
      async handler(c) {
        counter.executions += 1;
        const base = c.baseRevision(c.body.base_revision);
        return await c.commit(
          [
            ...ensureUserSettingsStatements(c.db, c.scope, c.now),
            guardRevision(c.db, c.scope, "user_settings", c.scope.userId, base),
            stmt(
              c.db,
              "UPDATE user_settings SET locale = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?",
              c.body.locale,
              c.now,
              c.scope.userId,
              base
            ),
            appendChangeFromRow(c.db, c.scope, {
              entity: "settings",
              table: "user_settings",
              id: c.scope.userId,
              now: c.now,
            }),
          ],
          { status: 201, body: { locale: c.body.locale, revision: base + 1 } }
        );
      },
    }),
    defineRoute({
      method: "POST",
      pattern: "/api/v1/test/no-db",
      scope: "any",
      idempotency: "optional",
      handler(c) {
        counter.executions += 1;
        return c.respond({ n: counter.executions }, 202);
      },
    }),
  ];
}

describe("TCORE-IDEMPOTENCY Idempotency-Key (05 §1.4)", () => {
  const json = { "Content-Type": "application/json" };

  it("TCORE-IDEMPOTENCY replays, rejects a different body, and requires the key", async () => {
    const counter = { executions: 0 };
    const routes = settingsRoutes(counter);
    const web = await client.browserSession("idem@example.com");
    const body = JSON.stringify({ locale: "id", base_revision: 1 });
    const first = await callTable(
      routes,
      web,
      "POST",
      "/api/v1/test/settings",
      {
        body,
        headers: { ...json, "Idempotency-Key": "k-1" },
      }
    );
    expect(first.status).toBe(201);
    expect(first.response.headers.get("Idempotent-Replayed")).toBeNull();
    const replay = await callTable(
      routes,
      web,
      "POST",
      "/api/v1/test/settings",
      {
        body,
        headers: { ...json, "Idempotency-Key": "k-1" },
      }
    );
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.response.headers.get("Idempotent-Replayed")).toBe("true");
    expect(counter.executions).toBe(1);
    const mismatch = await callTable(
      routes,
      web,
      "POST",
      "/api/v1/test/settings",
      {
        body: JSON.stringify({ locale: "en", base_revision: 1 }),
        headers: { ...json, "Idempotency-Key": "k-1" },
      }
    );
    expect(mismatch.status).toBe(409);
    expectEnvelope(mismatch.body, "idempotency_mismatch");
    const missing = await callTable(
      routes,
      web,
      "POST",
      "/api/v1/test/settings",
      { body, headers: json }
    );
    expect(missing.status).toBe(400);
    const tooLong = await callTable(
      routes,
      web,
      "POST",
      "/api/v1/test/settings",
      {
        body,
        headers: { ...json, "Idempotency-Key": "x".repeat(129) },
      }
    );
    expect(tooLong.status).toBe(400);
    const stored = t.jobsSqlite
      .query(
        "SELECT status_code, expires_at, created_at FROM idempotency_keys WHERE user_id = ?"
      )
      .all(web.userId as string) as Array<{
      created_at: number;
      expires_at: number;
      status_code: number;
    }>;
    expect(stored).toHaveLength(1);
    expect(stored[0].expires_at - stored[0].created_at).toBe(
      IDEMPOTENCY_TTL_MS
    );
  });

  it("TCORE-IDEMPOTENCY a racing duplicate executes the mutation once", async () => {
    const counter = { executions: 0 };
    const routes = settingsRoutes(counter);
    const web = await client.browserSession("race@example.com");
    const body = JSON.stringify({ locale: "id", base_revision: 1 });
    const [a, b] = await Promise.all([
      callTable(routes, web, "POST", "/api/v1/test/settings", {
        body,
        headers: { ...json, "Idempotency-Key": "race" },
      }),
      callTable(routes, web, "POST", "/api/v1/test/settings", {
        body,
        headers: { ...json, "Idempotency-Key": "race" },
      }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body).toEqual(b.body);
    const replayed = [a, b].filter(
      (r) => r.response.headers.get("Idempotent-Replayed") === "true"
    );
    expect(replayed).toHaveLength(1);
    const settings = t.jobsSqlite
      .query("SELECT revision FROM user_settings WHERE user_id = ?")
      .get(web.userId as string) as { revision: number };
    expect(settings.revision).toBe(2);
  });

  it("TCORE-IDEMPOTENCY a second commit in one request is refused", async () => {
    const routes = [
      defineRoute({
        method: "POST",
        pattern: "/api/v1/test/twice",
        scope: "any",
        idempotency: "optional",
        async handler(c) {
          await c.commit(
            ensureUserSettingsStatements(c.db, c.scope, c.now),
            {}
          );
          return await c.commit([], { body: { ok: true } });
        },
      }),
    ];
    const web = await client.browserSession("twice@example.com");
    const res = await callTable(routes, web, "POST", "/api/v1/test/twice", {
      headers: { "Idempotency-Key": "twice" },
    });
    expect(res.status).toBe(503);
  });

  it("TCORE-IDEMPOTENCY expired keys execute again; non-DB handlers are recorded after the fact", async () => {
    const counter = { executions: 0 };
    const routes = settingsRoutes(counter);
    const web = await client.browserSession("ttl@example.com");
    const call = () =>
      callTable(routes, web, "POST", "/api/v1/test/no-db", {
        headers: { "Idempotency-Key": "nodb" },
      });
    expect((await call()).body).toEqual({ n: 1 });
    const replay = await call();
    expect(replay.status).toBe(202);
    expect(replay.body).toEqual({ n: 1 });
    expect(replay.response.headers.get("Idempotent-Replayed")).toBe("true");
    clock.advance(IDEMPOTENCY_TTL_MS + 1);
    expect((await call()).body).toEqual({ n: 2 });
  });
});

describe("TCORE-REVISION optimistic concurrency (D-21)", () => {
  const json = { "Content-Type": "application/json" };

  it("TCORE-REVISION two writers with the same base_revision: one 201, one 409", async () => {
    const routes = settingsRoutes({ executions: 0 });
    const web = await client.browserSession("rev@example.com");
    const [a, b] = await Promise.all([
      callTable(routes, web, "POST", "/api/v1/test/settings", {
        body: JSON.stringify({ locale: "id", base_revision: 1 }),
        headers: { ...json, "Idempotency-Key": "w-a" },
      }),
      callTable(routes, web, "POST", "/api/v1/test/settings", {
        body: JSON.stringify({ locale: "en", base_revision: 1 }),
        headers: { ...json, "Idempotency-Key": "w-b" },
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expectEnvelope(loser.body, "revision_conflict");
    const changes = t.jobsSqlite
      .query(
        "SELECT COUNT(*) AS n FROM change_log WHERE user_id = ? AND entity = 'settings' AND revision = 2"
      )
      .get(web.userId as string) as { n: number };
    expect(changes.n).toBe(1);
    const keys = t.jobsSqlite
      .query("SELECT key FROM idempotency_keys")
      .all() as Array<{ key: string }>;
    expect(keys.map((k) => k.key)).not.toContain(loser === a ? "w-a" : "w-b");
  });

  it("TCORE-REVISION If-Match works in place of base_revision; both missing is 400", async () => {
    const routes = settingsRoutes({ executions: 0 });
    const web = await client.browserSession("ifmatch@example.com");
    const ok = await callTable(routes, web, "POST", "/api/v1/test/settings", {
      body: JSON.stringify({ locale: "id" }),
      headers: { ...json, "Idempotency-Key": "im-1", "If-Match": '"1"' },
    });
    expect(ok.status).toBe(201);
    const none = await callTable(routes, web, "POST", "/api/v1/test/settings", {
      body: JSON.stringify({ locale: "id" }),
      headers: { ...json, "Idempotency-Key": "im-2" },
    });
    expect(none.status).toBe(400);
    const disagree = await callTable(
      routes,
      web,
      "POST",
      "/api/v1/test/settings",
      {
        body: JSON.stringify({ locale: "id", base_revision: 2 }),
        headers: { ...json, "Idempotency-Key": "im-3", "If-Match": '"3"' },
      }
    );
    expect(disagree.status).toBe(400);
  });

  it("TCORE-REVISION assertRevision and baseRevision helpers", async () => {
    const { assertRevision, baseRevision } = await import("./revision");
    expect(() => assertRevision({ revision: 3, id: "x" }, 3)).not.toThrow();
    try {
      assertRevision({ revision: 4, id: "x" }, 3, (row) => ({ shown: row.id }));
      throw new Error("expected a conflict");
    } catch (err) {
      const response = errorResponse(err as never, "r");
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: "revision_conflict",
        details: { current: { shown: "x" } },
      });
    }
    const request = new Request(TEST_API_ORIGIN, {
      headers: { "If-Match": 'W/"5"' },
    });
    expect(baseRevision(request, undefined)).toBe(5);
    expect(
      baseRevision(new Request(TEST_API_ORIGIN), undefined, { optional: true })
    ).toBeNull();
    const row = await queryFirst<{ n: number }>(
      (await import("../repo/core/db")).jobsDb(t.env),
      "SELECT COUNT(*) AS n FROM change_log WHERE user_id = ?",
      "usr_nobody"
    );
    expect(row?.n).toBe(0);
  });
});
