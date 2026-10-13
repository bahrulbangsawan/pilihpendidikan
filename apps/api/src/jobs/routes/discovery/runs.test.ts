// Discovery runs + completion (05 §4, 15 §9 / §12, 03 §1, 03 §4.3).
import { beforeEach, describe, expect, it } from "bun:test";
import {
  CompleteRunResponseSchema,
  DiscoveryRunPageSchema,
  RunResponseSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { DiscoveryFixture } from "./fixtures.test";
import {
  BOB,
  discoveryFixture,
  postingItem,
  postingRow,
  unchangedItem,
} from "./fixtures.test";

let f: DiscoveryFixture;

beforeEach(async () => {
  f = await discoveryFixture();
});

function runBody(id: string, deviceId: string | null) {
  return {
    id,
    sources: [{ adapter: "greenhouse", label: "Acme" }],
    device_id: deviceId,
    engine_version: "pilih-jobs 0.1.0",
  };
}

describe("TD-RUN creating runs (05 §4, 03 §1)", () => {
  it("TD-RUN a client run_ id creates a running run bound to the calling device", async () => {
    const id = newId("run", f.clock.now());
    const res = await f.cli.post(
      "/api/v1/discovery/runs",
      runBody(id, f.cli.deviceId)
    );
    expect(res.status).toBe(201);
    const { run } = RunResponseSchema.parse(res.body);
    expect(run).toMatchObject({
      id,
      status: "running",
      device_id: f.cli.deviceId,
      user_id: f.cli.userId,
      revision: 1,
      finished_at: null,
    });
    const change = f.t.jobsSqlite
      .query("SELECT entity, entity_id FROM change_log WHERE user_id = ?")
      .get(f.cli.userId) as { entity: string; entity_id: string };
    expect(change).toEqual({ entity: "run", entity_id: id });
  });

  it("TD-RUN creation is idempotent by id", async () => {
    const id = newId("run", f.clock.now());
    await f.cli.post("/api/v1/discovery/runs", runBody(id, f.cli.deviceId));
    const again = await f.cli.post("/api/v1/discovery/runs", {
      ...runBody(id, f.cli.deviceId),
      engine_version: "other",
    });
    expect(again.status).toBe(200);
    expect(
      (again.body as { run: { engine_version: string } }).run.engine_version
    ).toBe("pilih-jobs 0.1.0");
    const n = f.t.jobsSqlite
      .query("SELECT count(*) AS n FROM discovery_runs")
      .get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("TD-RUN an id or started_at more than 24 h from server time is 400", async () => {
    const old = newId("run", f.clock.now() - 25 * 3_600_000);
    const res = await f.cli.post(
      "/api/v1/discovery/runs",
      runBody(old, f.cli.deviceId)
    );
    expect(res.status).toBe(400);
    const id = newId("run", f.clock.now());
    const late = await f.cli.post("/api/v1/discovery/runs", {
      ...runBody(id, f.cli.deviceId),
      started_at: f.clock.now() - 2 * 86_400_000,
    });
    expect(late.status).toBe(400);
    const offline = await f.cli.post("/api/v1/discovery/runs", {
      ...runBody(id, f.cli.deviceId),
      started_at: f.clock.now() - 3_600_000,
    });
    expect(offline.status).toBe(201);
    expect(
      (offline.body as { run: { started_at: number } }).run.started_at
    ).toBe(f.clock.now() - 3_600_000);
  });

  it("TD-RUN runs are device-bound: no device → 403 device_required, another device id → 400", async () => {
    const id = newId("run", f.clock.now());
    const web = await f.web.post(
      "/api/v1/discovery/runs",
      runBody(id, "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0D")
    );
    expect(web.status).toBe(403);
    expect(web.body).toMatchObject({ error: "device_required" });
    const forged = await f.cli.post(
      "/api/v1/discovery/runs",
      runBody(id, "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C0D")
    );
    expect(forged.status).toBe(400);
  });

  it("TD-RUN a run id owned by another user is a 409 duplicate without leaking it", async () => {
    const id = newId("run", f.clock.now());
    const bob = await f.client.cliSession(BOB);
    await bob.post("/api/v1/discovery/runs", runBody(id, bob.deviceId));
    const res = await f.cli.post(
      "/api/v1/discovery/runs",
      runBody(id, f.cli.deviceId)
    );
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "duplicate" });
    expect(JSON.stringify(res.body)).not.toContain(bob.userId ?? "x");
  });

  it("TD-RUN foreign source and task ids are dropped from the run record", async () => {
    const bob = await f.client.cliSession(BOB);
    const bobSource = await f.source(bob);
    const mine = await f.source(f.cli);
    const id = newId("run", f.clock.now());
    const res = await f.cli.post("/api/v1/discovery/runs", {
      ...runBody(id, f.cli.deviceId),
      sources: [
        { adapter: "greenhouse", label: "mine", source_id: mine },
        { adapter: "greenhouse", label: "bob's", source_id: bobSource },
      ],
      task_id: newId("tsk", f.clock.now()),
    });
    const { run } = res.body as {
      run: { sources: { source_id: string | null }[]; task_id: string | null };
    };
    expect(run.sources.map((s) => s.source_id)).toEqual([mine, null]);
    expect(run.task_id).toBeNull();
  });

  it("TD-RUN an Idempotency-Key replay answers Idempotent-Replayed", async () => {
    const id = newId("run", f.clock.now());
    const first = await f.cli.post(
      "/api/v1/discovery/runs",
      runBody(id, f.cli.deviceId),
      { idempotencyKey: `run:${id}:create` }
    );
    const replay = await f.cli.post(
      "/api/v1/discovery/runs",
      runBody(id, f.cli.deviceId),
      { idempotencyKey: `run:${id}:create` }
    );
    expect(replay.status).toBe(first.status);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
  });
});

describe("TD-RUN completion and history", () => {
  it("TD-RUN complete stores status, stats and errors; a second complete changes nothing", async () => {
    const run = await f.startRun(f.cli);
    const stats = {
      pages: 3,
      postings_found: 143,
      new: 12,
      unchanged: 131,
      invalid: 0,
      errors_by_class: { access_denied: 1 },
    };
    const errors = [
      {
        source: "workday:nvidia",
        error_class: "access_denied",
        http_status: 403,
      },
    ];
    const res = await f.complete(f.cli, run, {
      status: "partial",
      stats,
      errors,
      finished_at: f.clock.now() + 10 * 86_400_000,
    });
    expect(res.status).toBe(200);
    const body = CompleteRunResponseSchema.parse(res.body);
    expect(body.run).toMatchObject({
      status: "partial",
      stats,
      errors,
      revision: 2,
      finished_at: f.clock.now(),
    });
    expect(body.closed_postings).toBe(0);
    const again = await f.complete(f.cli, run, { status: "failed" });
    expect(again.status).toBe(200);
    expect(again.body.run).toMatchObject({ status: "partial", revision: 2 });
  });

  it("TD-RUN more than 50 errors, or a foreign / other-device run, is refused", async () => {
    const run = await f.startRun(f.cli);
    const errors = Array.from({ length: 51 }, () => ({
      error_class: "network",
    }));
    expect((await f.complete(f.cli, run, { errors })).status).toBe(400);
    const bob = await f.client.cliSession(BOB);
    expect((await f.complete(bob, run)).status).toBe(404);
    const laptop2 = await f.client.cliSession("alice@example.com");
    expect((await f.complete(laptop2, run)).status).toBe(403);
  });

  it("TD-RUN the history lists the caller's runs newest first with a cursor", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await f.startRun(f.cli));
      f.clock.advance(60_000);
    }
    const bob = await f.client.cliSession(BOB);
    await f.startRun(bob);
    const page1 = await f.web.get("/api/v1/discovery/runs", {
      query: { limit: 2 },
    });
    const body1 = DiscoveryRunPageSchema.parse(page1.body);
    expect(body1.items.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    const page2 = await f.web.get("/api/v1/discovery/runs", {
      query: { limit: 2, cursor: body1.next_cursor ?? "" },
    });
    const body2 = DiscoveryRunPageSchema.parse(page2.body);
    expect(body2.items.map((r) => r.id)).toEqual([ids[0]]);
    expect(body2.next_cursor).toBeNull();
  });

  it("TD-RUN complete updates the sources' last run, last success and cursor state", async () => {
    const src = await f.source(f.cli);
    const run = await f.startRun(f.cli, { sourceId: src });
    const cursor = {
      v: 1,
      listing: { etag: 'W/"abc"' },
      detail_etags: { "1": '"e1"' },
    };
    await f.complete(f.cli, run, {
      complete_sources: [
        { source_id: src, source_kind: "greenhouse", source_org: "acme" },
      ],
      cursor_states: [{ source_id: src, cursor_state: cursor }],
    });
    const source = (await f.web.get("/api/v1/sources")).body as {
      items: {
        cursor_state: unknown;
        last_run_id: string;
        last_success_at: number;
        revision: number;
      }[];
    };
    expect(source.items[0]).toMatchObject({
      last_run_id: run,
      last_success_at: f.clock.now(),
      cursor_state: cursor,
      revision: 2,
    });
  });

  it("TD-RUN a stale run never overwrites a newer run's cursor state (20 §6.2)", async () => {
    const src = await f.source(f.cli);
    const newer = await f.startRun(f.cli, { sourceId: src });
    await f.complete(f.cli, newer, {
      cursor_states: [
        { source_id: src, cursor_state: { v: 1, seen_refs_digest: "new" } },
      ],
    });
    // An older offline run (started an hour earlier) completes afterwards.
    const id = newId("run", f.clock.now() - 3_600_000);
    await f.cli.post("/api/v1/discovery/runs", {
      ...runBody(id, f.cli.deviceId),
      sources: [{ adapter: "greenhouse", label: "Acme", source_id: src }],
      started_at: f.clock.now() - 3_600_000,
    });
    await f.complete(f.cli, id, {
      cursor_states: [
        { source_id: src, cursor_state: { v: 1, seen_refs_digest: "old" } },
      ],
    });
    const row = f.t.jobsSqlite
      .query("SELECT cursor_state, last_run_id FROM job_sources WHERE id = ?")
      .get(src) as { cursor_state: string; last_run_id: string };
    expect(JSON.parse(row.cursor_state).seen_refs_digest).toBe("new");
    expect(row.last_run_id).toBe(newer);
  });
});

describe("S-07 re-run and closure by absence (13 S-07, 03 §4.3)", () => {
  it("S-07 a re-run is all unchanged; postings removed for two complete runs close", async () => {
    const src = await f.source(f.cli);
    const items = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        postingItem({ ref: `${i + 1}`, source_id: src })
      )
    );
    const complete = {
      complete_sources: [
        { source_id: src, source_kind: "greenhouse", source_org: "acme" },
      ],
    };
    const run1 = await f.startRun(f.cli, { sourceId: src });
    const first = await f.batch(f.cli, run1, items);
    expect(first.body.items.every((i) => i.outcome === "new")).toBe(true);
    await f.complete(f.cli, run1, complete);

    // Second run: same postings → 0 new, all unchanged.
    f.clock.advance(86_400_000);
    const run2 = await f.startRun(f.cli, { sourceId: src });
    const second = await f.batch(
      f.cli,
      run2,
      items.map((item) => unchangedItem(item, { observed_at: f.clock.now() }))
    );
    expect(second.body.items.map((i) => i.outcome)).toEqual(
      new Array(6).fill("unchanged")
    );
    expect((await f.complete(f.cli, run2, complete)).body.closed_postings).toBe(
      0
    );

    // Two complete runs without the last 3 postings close them.
    const kept = items.slice(0, 3);
    const removed = first.body.items.slice(3).map((i) => i.posting_id ?? "");
    let closed = 0;
    for (let round = 0; round < 2; round++) {
      f.clock.advance(86_400_000);
      const runN = await f.startRun(f.cli, { sourceId: src });
      await f.batch(
        f.cli,
        runN,
        kept.map((item) => unchangedItem(item, { observed_at: f.clock.now() }))
      );
      const res = await f.complete(f.cli, runN, complete);
      closed = res.body.closed_postings;
      if (round === 0) {
        expect(closed).toBe(0);
        expect(removed.map((id) => postingRow(f.t, id).missed_runs)).toEqual([
          1, 1, 1,
        ]);
      }
    }
    expect(closed).toBe(3);
    for (const id of removed) {
      expect(postingRow(f.t, id)).toMatchObject({
        status: "closed",
        missed_runs: 2,
        closed_at: f.clock.now(),
        revision: 2,
      });
    }
    const keptIds = first.body.items.slice(0, 3).map((i) => i.posting_id ?? "");
    expect(keptIds.map((id) => postingRow(f.t, id).status)).toEqual([
      "open",
      "open",
      "open",
    ]);
    const changes = f.t.jobsSqlite
      .query(
        "SELECT count(*) AS n FROM change_log WHERE user_id = ? AND entity = 'posting' AND revision = 2"
      )
      .get(f.cli.userId) as { n: number };
    expect(changes.n).toBe(3);
  });

  it("S-07 sources not reported complete never increment missed_runs", async () => {
    const src = await f.source(f.cli);
    const item = await postingItem({ source_id: src });
    const run1 = await f.startRun(f.cli, { sourceId: src });
    const first = await f.batch(f.cli, run1, [item]);
    await f.complete(f.cli, run1);
    for (let i = 0; i < 3; i++) {
      const runN = await f.startRun(f.cli, { sourceId: src });
      await f.complete(f.cli, runN, {
        status: "partial",
        complete_sources: [],
      });
    }
    expect(postingRow(f.t, first.body.items[0].posting_id ?? "")).toMatchObject(
      { status: "open", missed_runs: 0 }
    );
  });

  it("S-07 a sighting resets missed_runs; (kind, org) completes match without a source id", async () => {
    const item = await postingItem({ ref: "9" });
    const run1 = await f.startRun(f.cli);
    const first = await f.batch(f.cli, run1, [item]);
    const id = first.body.items[0].posting_id ?? "";
    const byOrg = {
      complete_sources: [{ source_kind: "greenhouse", source_org: "acme" }],
    };
    await f.complete(f.cli, run1, byOrg);
    const run2 = await f.startRun(f.cli);
    await f.complete(f.cli, run2, byOrg);
    expect(postingRow(f.t, id).missed_runs).toBe(1);
    const run3 = await f.startRun(f.cli);
    await f.batch(f.cli, run3, [
      unchangedItem(item, { observed_at: f.clock.now() }),
    ]);
    await f.complete(f.cli, run3, byOrg);
    expect(postingRow(f.t, id)).toMatchObject({
      missed_runs: 0,
      status: "open",
    });
    // A null org without a source id is ambiguous and ignored.
    const run4 = await f.startRun(f.cli);
    await f.complete(f.cli, run4, {
      complete_sources: [{ source_kind: "greenhouse", source_org: null }],
    });
    expect(postingRow(f.t, id).missed_runs).toBe(0);
  });

  it("S-07 another user's complete run never touches postings only Alice tracks", async () => {
    const item = await postingItem({ ref: "77" });
    const run1 = await f.startRun(f.cli);
    const first = await f.batch(f.cli, run1, [item]);
    const bob = await f.client.cliSession(BOB);
    for (let i = 0; i < 2; i++) {
      const runN = await f.startRun(bob);
      await f.complete(bob, runN, {
        complete_sources: [{ source_kind: "greenhouse", source_org: "acme" }],
      });
    }
    expect(postingRow(f.t, first.body.items[0].posting_id ?? "")).toMatchObject(
      { status: "open", missed_runs: 0 }
    );
  });
});
