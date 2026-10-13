import { API_ROUTE_SCHEMAS } from "@pilihpendidikan/jobs-contracts/api";
import { describe, expect, it, vi } from "vitest";
import { makeApplication, sampleBoard } from "@/test/fixtures";
import { buildApiPath, NON_WEB_ROUTE_KEYS, WEB_ROUTE_KEYS } from "./api-routes";
import type { BffDeps, BffRequest } from "./bff";
import {
  BFF_CACHE_TTL_MS,
  createTtlCache,
  exchangeSignInCode,
  proxyApiRequest,
  redactSecret,
  requestSignInLink,
  revokeApiSession,
} from "./bff";

const BEARER = "bearer-SECRET-0123456789abcdef0123456789";

interface Call {
  init: RequestInit;
  path: string;
}

function fakeApi(
  respond: (path: string, init: RequestInit) => Response | Promise<Response>
) {
  const calls: Call[] = [];
  const deps: BffDeps = {
    fetchApi: async (path, init) => {
      calls.push({ path, init });
      return await respond(path, init);
    },
    clientIp: "203.0.113.9",
  };
  return { calls, deps };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });

function header(call: Call | undefined, name: string): string | null {
  return new Headers(call?.init.headers).get(name);
}

describe("TW-BFF the bearer never reaches the browser", () => {
  it("TW-BFF sends the bearer to the api and returns only the body", async () => {
    const board = sampleBoard();
    const { calls, deps } = fakeApi(() =>
      json(board, { headers: { ETag: '"b1"' } })
    );
    const result = await proxyApiRequest(
      { route: "GET /api/v1/board" },
      BEARER,
      deps
    );
    expect(header(calls[0], "Authorization")).toBe(`Bearer ${BEARER}`);
    expect(header(calls[0], "X-Forwarded-For")).toBe("203.0.113.9");
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      etag: '"b1"',
      notModified: false,
    });
    expect(JSON.stringify(result)).not.toContain(BEARER);
  });

  it("TW-BFF scrubs the bearer even if the api echoes it, in success and error bodies", async () => {
    const echo = (status: number) =>
      fakeApi((_, init) =>
        json(
          status === 200
            ? {
                settings: {
                  note: new Headers(init.headers).get("Authorization"),
                },
              }
            : {
                error: "invalid_request",
                message: `bad ${new Headers(init.headers).get("Authorization")}`,
                request_id: "r",
              },
          { status }
        )
      );
    for (const status of [200, 400]) {
      const { deps } = echo(status);
      const result = await proxyApiRequest(
        { route: "GET /api/v1/settings" },
        BEARER,
        deps
      );
      const text = JSON.stringify(result);
      expect(text).not.toContain(BEARER);
      expect(text).toContain("[redacted]");
    }
  });

  it("TW-BFF network failures, 401s and odd bodies carry no bearer", async () => {
    const cases: BffDeps[] = [
      { fetchApi: () => Promise.reject(new Error(`failed with ${BEARER}`)) },
      fakeApi(() => new Response(`Unauthorized ${BEARER}`, { status: 401 }))
        .deps,
      fakeApi(() => new Response("<html>gateway</html>", { status: 502 })).deps,
    ];
    for (const deps of cases) {
      const result = await proxyApiRequest(
        { route: "GET /api/v1/board" },
        BEARER,
        deps
      );
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(BEARER);
    }
  });

  it("TW-BFF the sign-in exchange keeps the token server-side and caps the session at 7 days", async () => {
    const now = 1_800_000_000_000;
    const { calls, deps } = fakeApi(() =>
      json({
        email: "rina@example.com",
        token: BEARER,
        expiresAt: new Date(now + 30 * 86_400_000).toISOString(),
      })
    );
    const result = await exchangeSignInCode("code-1234567890", deps, now);
    expect(calls[0]?.path).toBe("/auth/exchange");
    expect(result).toEqual({
      ok: true,
      session: {
        bearer: BEARER,
        email: "rina@example.com",
        exp: now + 604_800_000,
      },
    });
    const expired = await exchangeSignInCode(
      "x".repeat(12),
      fakeApi(() => json({ error: "gone" }, { status: 410 })).deps,
      now
    );
    expect(expired).toEqual({ ok: false, status: 410 });
  });

  it("TW-BFF sign-in links return to the jobs origin; logout sends the bearer", async () => {
    const { calls, deps } = fakeApi(() => json({ ok: true }));
    expect(
      await requestSignInLink(
        "rina@example.com",
        "https://jobs.pilihpendidikan.com",
        deps
      )
    ).toEqual({ ok: true });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      email: "rina@example.com",
      returnTo: "https://jobs.pilihpendidikan.com",
    });
    const limited = await requestSignInLink(
      "rina@example.com",
      "https://jobs.pilihpendidikan.com",
      fakeApi(() =>
        json(
          { error: "Too many" },
          { status: 429, headers: { "Retry-After": "60" } }
        )
      ).deps
    );
    expect(limited).toEqual({
      ok: false,
      status: 429,
      message: "Too many",
      retryAfter: 60,
    });
    await revokeApiSession(BEARER, deps);
    expect(calls[1]?.path).toBe("/auth/logout");
    expect(header(calls[1], "Authorization")).toBe(`Bearer ${BEARER}`);
  });

  it("TW-BFF redactSecret ignores short or absent secrets", () => {
    expect(redactSecret("abc", null)).toBe("abc");
    expect(redactSecret(`x${BEARER}y${BEARER}`, BEARER)).toBe(
      "x[redacted]y[redacted]"
    );
  });
});

describe("TW-BFF requests are validated against the contracts before leaving the Worker", () => {
  it("TW-BFF builds the path, query, Idempotency-Key and body from the contract", async () => {
    const application = makeApplication();
    const { calls, deps } = fakeApi(() => json({ application }));
    const request: BffRequest = {
      route: "POST /api/v1/applications/{app_id}/move",
      params: { app_id: application.id },
      body: { base_revision: 5, stage: "applied", before_id: null },
      idempotency_key: "web:KEY",
    };
    const result = await proxyApiRequest(request, BEARER, deps);
    expect(result.ok).toBe(true);
    expect(calls[0]?.path).toBe(`/api/v1/applications/${application.id}/move`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(header(calls[0], "Idempotency-Key")).toBe("web:KEY");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      base_revision: 5,
      stage: "applied",
      before_id: null,
    });
  });

  it("TW-BFF refuses an invalid body, query, route or path param with a 400 and sends nothing", async () => {
    const { calls, deps } = fakeApi(() => json({}));
    const bad: unknown[] = [
      {
        route: "POST /api/v1/applications/{app_id}/move",
        params: { app_id: "app_X" },
        body: { stage: "nowhere" },
      },
      { route: "GET /api/v1/board", query: { include_archived: "yes" } },
      {
        route: "POST /api/v1/devices/{dev_id}/tasks:claim",
        params: { dev_id: "dev_x" },
        body: {},
      },
      {
        route: "GET /api/v1/applications/{app_id}",
        params: { app_id: "../../auth/logout" },
      },
      { route: "GET /api/v1/applications/{app_id}", params: {} },
      { route: "GET /api/v1/meta", body: { x: 1 } },
      "not an envelope",
    ];
    for (const input of bad) {
      const result = await proxyApiRequest(input, BEARER, deps);
      expect(result, JSON.stringify(input)).toMatchObject({
        ok: false,
        status: 400,
      });
    }
    expect(calls).toEqual([]);
  });

  it("TW-BFF If-None-Match turns a 304 into notModified", async () => {
    const { calls, deps } = fakeApi(
      () => new Response(null, { status: 304, headers: { ETag: '"b1"' } })
    );
    const result = await proxyApiRequest(
      { route: "GET /api/v1/board", if_none_match: '"b1"' },
      BEARER,
      deps
    );
    expect(header(calls[0], "If-None-Match")).toBe('"b1"');
    expect(result).toMatchObject({
      ok: true,
      status: 304,
      notModified: true,
      data: null,
      etag: '"b1"',
    });
  });

  it("TW-BFF passes the api error envelope through (409 details.current)", async () => {
    const current = makeApplication({ stage: "applied" });
    const { deps } = fakeApi(() =>
      json(
        {
          error: "revision_conflict",
          message: "changed",
          details: { current },
          request_id: "r1",
        },
        { status: 409 }
      )
    );
    const result = await proxyApiRequest(
      {
        route: "PATCH /api/v1/applications/{app_id}",
        params: { app_id: current.id },
        body: { base_revision: 1, priority: 1 },
      },
      BEARER,
      deps
    );
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: {
        error: "revision_conflict",
        message: "changed",
        details: { current },
        request_id: "r1",
      },
    });
  });

  it("TW-BFF reports contract mismatches in dev without failing the call", async () => {
    const onContractMismatch = vi.fn();
    const { deps } = fakeApi(() => json({ columns: "nope" }));
    const result = await proxyApiRequest(
      { route: "GET /api/v1/board" },
      BEARER,
      {
        ...deps,
        validateResponses: true,
        onContractMismatch,
      }
    );
    expect(result.ok).toBe(true);
    expect(onContractMismatch).toHaveBeenCalledWith(
      "GET /api/v1/board",
      expect.any(Array)
    );
  });

  it("TW-BFF the web route list plus the exclusions cover every contract route; no device-bound route is web", () => {
    const keys = Object.keys(API_ROUTE_SCHEMAS).sort();
    const covered = [
      ...WEB_ROUTE_KEYS,
      ...Object.keys(NON_WEB_ROUTE_KEYS),
    ].sort();
    expect(covered).toEqual(keys);
    for (const key of WEB_ROUTE_KEYS) {
      const contract = API_ROUTE_SCHEMAS[key];
      expect("device" in contract && contract.device, key).toBeFalsy();
      expect(
        ["automation:execute", "ai:invoke", "discovery:write"],
        key
      ).not.toContain(contract.scope);
    }
  });

  it("TW-BFF path params are encoded plain ids only", () => {
    expect(
      buildApiPath("GET /api/v1/applications/{app_id}", { app_id: "app_01J9" })
    ).toBe("/api/v1/applications/app_01J9");
    expect(
      buildApiPath("GET /api/v1/applications/{app_id}", { app_id: "a/b" })
    ).toBeNull();
    expect(
      buildApiPath("GET /api/v1/applications/{app_id}", { app_id: ".." })
    ).toBeNull();
    expect(
      buildApiPath("GET /api/v1/applications/{app_id}", {
        app_id: "x",
        other: "y",
      })
    ).toBeNull();
  });
});

describe("TW-STATS the BFF caches analytics per user for 60 s (10 §6)", () => {
  it("TW-STATS serves a repeat analytics GET from the cache, per bearer and per query, until it expires", async () => {
    let now = 1_000_000;
    const cache = createTtlCache(BFF_CACHE_TTL_MS, 10, () => now);
    const summary = { from: "2026-07-14", to: "2026-10-12" };
    const { calls, deps } = fakeApi(() => json(summary));
    const withCache = { ...deps, cache };
    const request = {
      route: "GET /api/v1/analytics/summary",
      query: { from: "2026-07-14", to: "2026-10-12", tz: "Asia/Jakarta" },
    } as const;
    const first = await proxyApiRequest(request, BEARER, withCache);
    const second = await proxyApiRequest(request, BEARER, withCache);
    expect(first).toEqual(second);
    expect(calls).toHaveLength(1);
    // Another user (another bearer) never sees this user's entry.
    await proxyApiRequest(request, `${BEARER}-other`, withCache);
    expect(calls).toHaveLength(2);
    // Another query is another entry.
    await proxyApiRequest(
      { ...request, query: { ...request.query, from: "2026-01-01" } },
      BEARER,
      withCache
    );
    expect(calls).toHaveLength(3);
    now += BFF_CACHE_TTL_MS;
    await proxyApiRequest(request, BEARER, withCache);
    expect(calls).toHaveLength(4);
  });

  it("TW-STATS never caches writes, other routes or failures", async () => {
    const cache = createTtlCache(BFF_CACHE_TTL_MS, 10);
    let status = 503;
    const { calls, deps } = fakeApi(() =>
      json({ error: "upstream_unavailable", message: "x" }, { status })
    );
    const withCache = { ...deps, cache };
    const request = {
      route: "GET /api/v1/analytics/breakdown",
      query: { by: "source" },
    } as const;
    await proxyApiRequest(request, BEARER, withCache);
    status = 200;
    await proxyApiRequest(request, BEARER, withCache);
    expect(calls).toHaveLength(2);
    await proxyApiRequest({ route: "GET /api/v1/board" }, BEARER, withCache);
    await proxyApiRequest({ route: "GET /api/v1/board" }, BEARER, withCache);
    expect(calls).toHaveLength(4);
  });
});
