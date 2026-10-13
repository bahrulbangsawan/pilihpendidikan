// Sources CRUD + the adapter registry (05 §4, 15 §14, D-17, 11 T-08).
import { beforeEach, describe, expect, it } from "bun:test";
import { AdaptersFileSchema } from "@pilihpendidikan/jobs-contracts/adapters";
import {
  JobSourcePageSchema,
  SourceResponseSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import adaptersJson from "@pilihpendidikan/jobs-contracts/adapters.json" with {
  type: "json",
};
import type { V1Session } from "../../../../test/fakes";
import type { DiscoveryFixture } from "./fixtures.test";
import { BOB, discoveryFixture } from "./fixtures.test";

let f: DiscoveryFixture;
let web: V1Session;

beforeEach(async () => {
  f = await discoveryFixture();
  web = f.web;
});

function create(
  session: V1Session,
  adapter: string,
  config: Record<string, unknown>,
  label = "A source"
) {
  return session.post<{ source: { id: string; revision: number } }>(
    "/api/v1/sources",
    { adapter, label, config }
  );
}

describe("TD-SOURCES sources CRUD (05 §4)", () => {
  it("TD-SOURCES create validates the config and returns the record", async () => {
    const res = await create(
      web,
      "greenhouse",
      { board_token: "acme" },
      "Acme"
    );
    expect(res.status).toBe(201);
    const { source } = SourceResponseSchema.parse(res.body);
    expect(source).toMatchObject({
      adapter: "greenhouse",
      label: "Acme",
      enabled: true,
      revision: 1,
      cursor_state: {},
      last_run_id: null,
      config: { board_token: "acme" },
    });
    expect(source.id.startsWith("src_")).toBe(true);
    const change = f.t.jobsSqlite
      .query("SELECT entity, entity_id FROM change_log WHERE user_id = ?")
      .get(web.userId) as { entity: string };
    expect(change.entity).toBe("source");
  });

  it("TD-SOURCES a config that fails the adapter's schema is 400 with config paths", async () => {
    const res = await create(web, "greenhouse", {
      board_token: "acme",
      extra: 1,
    });
    expect(res.status).toBe(400);
    const missing = await create(web, "lever", { region: "eu" });
    expect(missing.status).toBe(400);
    const issues = (
      missing.body as unknown as { details: { issues: { path: unknown[] }[] } }
    ).details.issues;
    expect(issues[0].path).toEqual(["config", "site"]);
    const badWorkday = await create(web, "workday", {
      tenant: "nvidia",
      site: "External",
      wd_host_number: 0,
    });
    expect(badWorkday.status).toBe(400);
  });

  it("TD-SOURCES an unknown adapter is 422 unsupported_source", async () => {
    const res = await create(web, "monster", { url: "https://monster.com" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "unsupported_source" });
  });

  it("TD-SOURCES list pages oldest first and filters by enabled", async () => {
    const a = (await create(web, "greenhouse", { board_token: "a" })).body
      .source.id;
    f.clock.advance(1000);
    const b = (await create(web, "ashby", { job_board_name: "b" })).body.source
      .id;
    f.clock.advance(1000);
    const c = (
      await web.post<{ source: { id: string } }>("/api/v1/sources", {
        adapter: "lever",
        label: "C",
        config: { site: "c" },
        enabled: false,
      })
    ).body.source.id;
    const page1 = JobSourcePageSchema.parse(
      (await web.get("/api/v1/sources", { query: { limit: 2 } })).body
    );
    expect(page1.items.map((s) => s.id)).toEqual([a, b]);
    const page2 = JobSourcePageSchema.parse(
      (
        await web.get("/api/v1/sources", {
          query: { limit: 2, cursor: page1.next_cursor ?? "" },
        })
      ).body
    );
    expect(page2.items.map((s) => s.id)).toEqual([c]);
    const disabled = JobSourcePageSchema.parse(
      (await web.get("/api/v1/sources", { query: { enabled: "0" } })).body
    );
    expect(disabled.items.map((s) => s.id)).toEqual([c]);
  });

  it("TD-SOURCES PATCH needs base_revision; a stale one is 409 with details.current", async () => {
    const { id } = (await create(web, "greenhouse", { board_token: "acme" }))
      .body.source;
    const missing = await web.patch(`/api/v1/sources/${id}`, {
      label: "x",
    } as never);
    expect(missing.status).toBe(400);
    const ok = await web.patch(`/api/v1/sources/${id}`, {
      base_revision: 1,
      label: "Renamed",
      enabled: false,
      schedule: "daily@08:00",
    });
    expect(ok.status).toBe(200);
    expect(SourceResponseSchema.parse(ok.body).source).toMatchObject({
      label: "Renamed",
      enabled: false,
      schedule: "daily@08:00",
      revision: 2,
    });
    const stale = await web.patch(`/api/v1/sources/${id}`, {
      base_revision: 1,
      label: "Lost",
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: "revision_conflict",
      details: { current: { id, label: "Renamed", revision: 2 } },
    });
    // The contract requires base_revision in the body; If-Match must agree.
    const disagree = await web.patch(
      `/api/v1/sources/${id}`,
      { base_revision: 2, label: "x" },
      { headers: { "If-Match": '"1"' } }
    );
    expect(disagree.status).toBe(400);
    const agree = await web.patch(
      `/api/v1/sources/${id}`,
      { base_revision: 2, label: "Via If-Match" },
      { headers: { "If-Match": '"2"' } }
    );
    expect(agree.status).toBe(200);
  });

  it("TD-SOURCES PATCH re-validates config against the stored adapter and caps cursor_state", async () => {
    const { id } = (await create(web, "greenhouse", { board_token: "acme" }))
      .body.source;
    const bad = await web.patch(`/api/v1/sources/${id}`, {
      base_revision: 1,
      config: { site: "acme" },
    });
    expect(bad.status).toBe(400);
    const etags = Object.fromEntries(
      Array.from({ length: 2001 }, (_, i) => [`r${i}`, `"e${i}"`])
    );
    const big = await web.patch(`/api/v1/sources/${id}`, {
      base_revision: 1,
      cursor_state: { v: 1, detail_etags: etags },
    });
    expect(big.status).toBe(400);
    const cursor = await f.cli.patch(`/api/v1/sources/${id}`, {
      base_revision: 1,
      cursor_state: { v: 1, seen_refs_digest: "abc" },
    });
    expect(cursor.status).toBe(200);
    expect(
      (cursor.body as { source: { cursor_state: unknown } }).source.cursor_state
    ).toEqual({ v: 1, seen_refs_digest: "abc" });
  });

  it("TD-SOURCES DELETE removes the source (optional base_revision) and logs a delete change", async () => {
    const { id } = (await create(web, "greenhouse", { board_token: "acme" }))
      .body.source;
    const stale = await web.delete(`/api/v1/sources/${id}`, {
      query: { base_revision: 5 },
    });
    expect(stale.status).toBe(409);
    const res = await web.delete(`/api/v1/sources/${id}`, {
      query: { base_revision: 1 },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, deleted: true });
    expect((await web.delete(`/api/v1/sources/${id}`)).status).toBe(404);
    const op = f.t.jobsSqlite
      .query("SELECT op FROM change_log WHERE entity_id = ? ORDER BY seq DESC")
      .get(id) as { op: string };
    expect(op.op).toBe("delete");
  });

  it("TD-SOURCES another user's source is not found and never listed", async () => {
    const { id } = (await create(web, "greenhouse", { board_token: "acme" }))
      .body.source;
    const bob = await f.client.browserSession(BOB);
    expect(
      (
        await bob.patch(`/api/v1/sources/${id}`, {
          base_revision: 1,
          label: "x",
        })
      ).status
    ).toBe(404);
    expect((await bob.delete(`/api/v1/sources/${id}`)).status).toBe(404);
    expect((await bob.get("/api/v1/sources")).body).toEqual({
      items: [],
      next_cursor: null,
    });
  });

  it("TD-SOURCES read tokens can list but not write (403 insufficient_scope)", async () => {
    const reader = await f.client.personalToken("alice@example.com", "read");
    expect((await reader.get("/api/v1/sources")).status).toBe(200);
    const res = await create(reader, "greenhouse", { board_token: "acme" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: "insufficient_scope",
      scope: "jobs:write",
    });
  });

  it("TD-SOURCES config URLs: http(s) only, no userinfo, ≤ 2048 (11 T-08)", async () => {
    expect(
      (
        await create(web, "career_page", {
          url: "http://careers.acme.com/jobs",
        })
      ).status
    ).toBe(201);
    expect(
      (
        await create(web, "custom_url", {
          url: "https://user:pw@acme.com/jobs/1",
        })
      ).status
    ).toBe(400);
    expect(
      (
        await create(web, "custom_url", {
          url: `https://acme.com/${"a".repeat(2100)}`,
        })
      ).status
    ).toBe(400);
    expect(
      (await create(web, "custom_url", { url: "ftp://acme.com/jobs/1" })).status
    ).toBe(400);
  });
});

describe("S-29 excluded sources (D-17, 15 §14.4)", () => {
  it("S-29 adding a LinkedIn or Indeed source via the API is 422 unsupported_source", async () => {
    for (const adapter of ["linkedin", "indeed"]) {
      const res = await create(web, adapter, { url: "https://example.com" });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        error: "unsupported_source",
        details: { adapter },
      });
    }
    expect(
      f.t.jobsSqlite.query("SELECT count(*) AS n FROM job_sources").get()
    ).toEqual({ n: 0 });
  });

  it("S-29 custom_url / career_page / generic_listing configs on excluded hosts are 422", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["custom_url", { url: "https://www.linkedin.com/jobs/view/123" }],
      ["career_page", { url: "https://id.indeed.com/cmp/acme/jobs" }],
      [
        "generic_listing",
        {
          start_url: "https://linkedin.com/company/acme/jobs",
          detail_url_pattern: "/jobs/view/\\d+",
          max_pages: 5,
        },
      ],
      ["custom_url", { url: "https://lnkd.in/abc" }],
      ["career_page", { url: "https://www.indeed.co.uk/jobs?q=x" }],
    ];
    for (const [adapter, config] of cases) {
      const res = await create(web, adapter, config);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ error: "unsupported_source" });
    }
  });

  it("S-29 a PATCH that points a source at an excluded host is 422", async () => {
    const { id } = (
      await create(web, "custom_url", { url: "https://acme.com/jobs/1" })
    ).body.source;
    const res = await web.patch(`/api/v1/sources/${id}`, {
      base_revision: 1,
      config: { url: "https://www.linkedin.com/jobs/view/9" },
    });
    expect(res.status).toBe(422);
  });
});

describe("TD-ADAPTERS the adapter registry (15 §14.1)", () => {
  it("TD-ADAPTERS GET /sources/adapters serves adapters.json, excluded entries with their reasons", async () => {
    const res = await web.get("/api/v1/sources/adapters");
    expect(res.status).toBe(200);
    const file = AdaptersFileSchema.parse(res.body);
    expect(res.body).toEqual(adaptersJson);
    const byId = new Map(file.adapters.map((a) => [a.id, a]));
    expect(byId.get("linkedin")).toMatchObject({ status: "excluded" });
    expect(
      (byId.get("indeed") as { reason: string }).reason.length
    ).toBeGreaterThan(10);
    expect(byId.get("workday")).toMatchObject({ status: "opt_in" });
    expect(byId.get("greenhouse")).toMatchObject({
      automation: { auto_ok: true },
      config_schema: { required: ["board_token"] },
    });
    expect(file.adapters).toHaveLength(11);
  });

  it("TD-ADAPTERS the registry carries an ETag and answers 304", async () => {
    const res = await web.get("/api/v1/sources/adapters");
    const etag = res.headers.get("ETag") ?? "";
    expect(etag.length).toBeGreaterThan(0);
    const cached = await web.get("/api/v1/sources/adapters", {
      headers: { "If-None-Match": etag },
    });
    expect(cached.status).toBe(304);
  });

  it("TD-ADAPTERS needs an authenticated jobs:read credential", async () => {
    expect(
      (await f.client.anonymous().get("/api/v1/sources/adapters")).status
    ).toBe(401);
    const reader = await f.client.personalToken("alice@example.com", "read");
    expect((await reader.get("/api/v1/sources/adapters")).status).toBe(200);
  });
});
