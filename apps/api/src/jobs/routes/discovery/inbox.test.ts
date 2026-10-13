// The inbox and inbox:bulk (05 §4, 12 §4, 15 §11, 20 §6.2).
import { beforeEach, describe, expect, it } from "bun:test";
import {
  InboxBulkResponseSchema,
  InboxItemPageSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import { RUBRIC_VERSION } from "@pilihpendidikan/jobs-contracts/scoring";
import { jobsDb } from "../../repo/core/db";
import { computeProfileVersion } from "../../repo/core/profile-version";
import type { V1Session } from "../../../../test/fakes";
import { seedApplication, seedUserJob } from "../../../../test/seed-jobs";
import type { DiscoveryFixture } from "./fixtures.test";
import {
  BOB,
  discoveryFixture,
  postingItem,
  userJobRows,
} from "./fixtures.test";

let f: DiscoveryFixture;

beforeEach(async () => {
  f = await discoveryFixture();
});

interface Page {
  items: {
    duplicates: number;
    posting: { id: string; title: string };
    provenance: {
      run_id: string | null;
      source_id: string | null;
      source_label: string | null;
      source_kind: string;
    };
    score: {
      score: number;
      status: string;
      deterministic_only: boolean;
    } | null;
    user_job: { id: string; inbox_state: string };
  }[];
  next_cursor: string | null;
}

async function inbox(
  session: V1Session,
  query: Record<string, string | number> = {}
) {
  const res = await session.get<Page>("/api/v1/inbox", { query });
  expect(res.status).toBe(200);
  InboxItemPageSchema.parse(res.body);
  return res.body;
}

async function discover(
  items: Awaited<ReturnType<typeof postingItem>>[],
  options: { sourceId?: string } = {}
) {
  const run = await f.startRun(f.cli, { sourceId: options.sourceId ?? null });
  const res = await f.batch(f.cli, run, items);
  return { run, items: res.body.items };
}

async function seedScore(
  userId: string,
  postingId: string,
  score: number,
  options: { model?: string; status?: string; ai?: string } = {}
) {
  const scope = f.cli.scope;
  if (!scope) {
    throw new Error("no scope");
  }
  const version = await computeProfileVersion(f.t.env, jobsDb(f.t.env), scope);
  f.t.jobsSqlite
    .query("DELETE FROM match_scores WHERE user_id = ? AND posting_id = ?")
    .run(userId, postingId);
  f.t.jobsSqlite
    .query(
      "INSERT INTO match_scores (id, user_id, posting_id, profile_version, rubric_version, model, score, confidence, components, explanation, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0.8, ?, 'Strong skills match.', ?, ?)"
    )
    .run(
      newId("scr", f.clock.now()),
      userId,
      postingId,
      version,
      RUBRIC_VERSION,
      options.model ?? "gpt-6-luna",
      score,
      JSON.stringify({ ai: { status: options.ai ?? "ok" } }),
      options.status ?? "ready",
      f.clock.now()
    );
}

describe("TD-INBOX listing (05 §4, 12 §4)", () => {
  it("TD-INBOX lists new + seen jobs newest first with posting, score and provenance", async () => {
    const src = await f.source(f.cli);
    const a = await postingItem({
      ref: "1",
      title: "Backend Engineer",
      source_id: src,
    });
    const { run, items } = await discover([a], { sourceId: src });
    f.clock.advance(1000);
    const b = await postingItem({ ref: "2", title: "Frontend Engineer" });
    const second = await discover([b]);
    await seedScore(f.cli.userId ?? "", items[0].posting_id ?? "", 91);
    const page = await inbox(f.web);
    expect(page.items.map((i) => i.posting.title)).toEqual([
      "Frontend Engineer",
      "Backend Engineer",
    ]);
    const backend = page.items[1];
    expect(backend.score).toMatchObject({
      score: 91,
      status: "ready",
      deterministic_only: false,
    });
    expect(backend.provenance).toEqual({
      run_id: run,
      source_id: src,
      source_label: "Acme on Greenhouse",
      source_kind: "greenhouse",
    });
    expect(page.items[0].provenance.run_id).toBe(second.run);
    expect(page.items[0].score?.status).toBe("queued");
  });

  it("TD-INBOX filters by state, min_score, source and q", async () => {
    const src = await f.source(f.cli);
    const { items } = await discover(
      await Promise.all([
        postingItem({ ref: "1", title: "Senior Go Engineer", source_id: src }),
        postingItem({ ref: "2", title: "Data Analyst" }),
        postingItem({
          ref: "3",
          title: "Designer",
          company_name: "Globex 100%_off",
        }),
      ]),
      { sourceId: src }
    );
    await seedScore(f.cli.userId ?? "", items[0].posting_id ?? "", 85);
    await seedScore(f.cli.userId ?? "", items[1].posting_id ?? "", 40);
    f.t.jobsSqlite
      .query("UPDATE user_jobs SET inbox_state = 'dismissed' WHERE id = ?")
      .run(items[2].user_job_id ?? "");
    expect(
      (await inbox(f.web, { min_score: 70 })).items.map((i) => i.posting.title)
    ).toEqual(["Senior Go Engineer"]);
    expect(
      (await inbox(f.web, { state: "dismissed" })).items.map(
        (i) => i.posting.title
      )
    ).toEqual(["Designer"]);
    expect(
      (await inbox(f.web, { q: "analyst" })).items.map((i) => i.posting.title)
    ).toEqual(["Data Analyst"]);
    expect(
      (await inbox(f.web, { q: "100%_", state: "dismissed" })).items
    ).toHaveLength(1);
    expect((await inbox(f.web, { q: "%" })).items).toHaveLength(0);
    expect(
      (await inbox(f.web, { source: src })).items.map((i) => i.posting.title)
    ).toEqual(["Senior Go Engineer"]);
    expect((await inbox(f.web, { source: "greenhouse" })).items).toHaveLength(
      2
    );
    expect((await inbox(f.web, { source: "lever" })).items).toHaveLength(0);
  });

  it("TD-INBOX pages with a keyset cursor", async () => {
    for (let i = 0; i < 5; i++) {
      // Distinct titles: same company + title + place would be one group.
      await discover([
        await postingItem({ ref: `${i}`, title: `Engineer ${i}` }),
      ]);
      f.clock.advance(1000);
    }
    const p1 = await inbox(f.web, { limit: 2 });
    const p2 = await inbox(f.web, { limit: 2, cursor: p1.next_cursor ?? "" });
    const p3 = await inbox(f.web, { limit: 2, cursor: p2.next_cursor ?? "" });
    const ids = [...p1.items, ...p2.items, ...p3.items].map(
      (i) => i.user_job.id
    );
    expect(new Set(ids).size).toBe(5);
    expect(p3.next_cursor).toBeNull();
    expect(
      (await f.web.get("/api/v1/inbox", { query: { cursor: "!!" } })).status
    ).toBe(400);
  });

  it("TD-INBOX a deterministic-only score is flagged; another user's inbox is empty", async () => {
    const { items } = await discover([await postingItem()]);
    await seedScore(f.cli.userId ?? "", items[0].posting_id ?? "", 60, {
      model: "deterministic-only",
      ai: "disabled",
    });
    expect((await inbox(f.web)).items[0].score?.deterministic_only).toBe(true);
    const bob = await f.client.browserSession(BOB);
    expect((await inbox(bob)).items).toEqual([]);
  });

  it("TD-DEDUPE the inbox shows one representative per dedupe group (official API first) with a duplicates count", async () => {
    const ats = await postingItem({ ref: "9", title: "Senior Data Engineer" });
    const page = await postingItem({
      source_kind: "career_page",
      org: null,
      ref: null,
      title: "Senior Data Engineer",
      apply_url: "https://careers.acme.com/jobs/9",
    });
    const other = await postingItem({ ref: "10", title: "Product Manager" });
    const { items } = await discover([page, ats, other]);
    const listed = await inbox(f.web);
    expect(listed.items).toHaveLength(2);
    const group = listed.items.find(
      (i) => i.posting.title === "Senior Data Engineer"
    );
    expect(group?.posting.id).toBe(items[1].posting_id ?? "");
    expect(group?.provenance.source_kind).toBe("greenhouse");
    expect(group?.duplicates).toBe(1);
    expect(
      listed.items.find((i) => i.posting.title === "Product Manager")
        ?.duplicates
    ).toBe(0);
    // Tracking one member settles the whole group: it leaves new/seen.
    f.t.jobsSqlite
      .query("UPDATE user_jobs SET inbox_state = 'tracked' WHERE id = ?")
      .run(items[0].user_job_id ?? "");
    expect((await inbox(f.web)).items.map((i) => i.posting.title)).toEqual([
      "Product Manager",
    ]);
  });
});

describe("TD-BULK inbox:bulk (05 §4)", () => {
  async function bulk(
    session: V1Session,
    ids: string[],
    action: string,
    idempotencyKey?: string
  ) {
    const res = await session.post(
      "/api/v1/inbox:bulk",
      { user_job_ids: ids, action },
      idempotencyKey ? { idempotencyKey } : {}
    );
    return res;
  }

  it("TD-BULK seen and dismiss apply per id; tracked jobs conflict on dismiss; foreign ids are not_found", async () => {
    const { items } = await discover(
      await Promise.all(
        [1, 2, 3].map((n) => postingItem({ ref: `${n}`, title: `Role ${n}` }))
      )
    );
    const [a, b, c] = items.map((i) => i.user_job_id ?? "");
    f.t.jobsSqlite
      .query("UPDATE user_jobs SET inbox_state = 'tracked' WHERE id = ?")
      .run(c);
    const bob = await f.client.cliSession(BOB);
    const bobRun = await f.startRun(bob);
    const bobJob =
      (await f.batch(bob, bobRun, [await postingItem({ ref: "9" })])).body
        .items[0].user_job_id ?? "";
    const seen = await bulk(f.web, [a], "seen");
    expect(InboxBulkResponseSchema.parse(seen.body).results).toEqual([
      { user_job_id: a, status: "ok", inbox_state: "seen" },
    ]);
    const res = await bulk(f.web, [a, b, c, bobJob, newId("ujb")], "dismiss");
    const results = InboxBulkResponseSchema.parse(res.body).results;
    expect(results.map((r) => r.status)).toEqual([
      "ok",
      "ok",
      "conflict",
      "not_found",
      "not_found",
    ]);
    expect(results[0].inbox_state).toBe("dismissed");
    const states = Object.fromEntries(
      userJobRows(f.t, f.cli.userId ?? "").map((u) => [u.id, u.inbox_state])
    );
    expect(states).toEqual({
      [a]: "dismissed",
      [b]: "dismissed",
      [c]: "tracked",
    });
    const bobState = userJobRows(f.t, bob.userId ?? "")[0].inbox_state;
    expect(bobState).toBe("new");
    const revs = f.t.jobsSqlite
      .query("SELECT revision FROM user_jobs WHERE id = ?")
      .get(a) as { revision: number };
    expect(revs.revision).toBe(3);
    const changes = f.t.jobsSqlite
      .query(
        "SELECT count(*) AS n FROM change_log WHERE user_id = ? AND entity = 'user_job' AND entity_id = ?"
      )
      .get(f.cli.userId, a) as { n: number };
    expect(changes.n).toBe(3);
  });

  it("TD-BULK seen leaves dismissed / tracked jobs alone", async () => {
    const { items } = await discover(
      await Promise.all([1, 2].map((n) => postingItem({ ref: `${n}` })))
    );
    const [a, b] = items.map((i) => i.user_job_id ?? "");
    await bulk(f.web, [a], "dismiss");
    const res = InboxBulkResponseSchema.parse(
      (await bulk(f.web, [a, b], "seen")).body
    );
    expect(res.results.map((r) => r.inbox_state)).toEqual([
      "dismissed",
      "seen",
    ]);
  });

  it("TD-BULK restore brings dismissed jobs back as seen and leaves the others alone", async () => {
    const { items } = await discover(
      await Promise.all([1, 2, 3].map((n) => postingItem({ ref: `${n}` })))
    );
    const [a, b, c] = items.map((i) => i.user_job_id ?? "");
    await bulk(f.web, [a, b], "dismiss");
    await bulk(f.web, [c], "track");
    const res = InboxBulkResponseSchema.parse(
      (await bulk(f.web, [a, b, c, newId("ujb")], "restore")).body
    );
    expect(res.results.map((r) => [r.status, r.inbox_state])).toEqual([
      ["ok", "seen"],
      ["ok", "seen"],
      ["ok", "tracked"],
      ["not_found", undefined],
    ]);
    const states = f.t.jobsSqlite
      .query(
        "SELECT id, inbox_state FROM user_jobs WHERE user_id = ? AND id IN (?, ?, ?)"
      )
      .all(f.cli.userId, a, b, c) as { id: string; inbox_state: string }[];
    expect(
      Object.fromEntries(states.map((row) => [row.id, row.inbox_state]))
    ).toEqual({ [a]: "seen", [b]: "seen", [c]: "tracked" });
  });

  it("TD-BULK track creates applications through the board service; repeat tracks return the same card", async () => {
    const { items } = await discover(
      await Promise.all([1, 2].map((n) => postingItem({ ref: `${n}` })))
    );
    const ids = items.map((i) => i.user_job_id ?? "");
    const res = await bulk(f.web, ids, "track", "bulk-track-1");
    const results = InboxBulkResponseSchema.parse(res.body).results;
    expect(
      results.every(
        (r) =>
          r.status === "ok" &&
          r.inbox_state === "tracked" &&
          r.application_id?.startsWith("app_")
      )
    ).toBe(true);
    const apps = f.t.jobsSqlite
      .query(
        "SELECT id, user_job_id, stage, board_rank FROM applications WHERE user_id = ? ORDER BY board_rank"
      )
      .all(f.cli.userId) as {
      board_rank: string;
      id: string;
      stage: string;
      user_job_id: string;
    }[];
    expect(apps.map((a) => a.user_job_id)).toEqual(ids);
    expect(apps.every((a) => a.stage === "saved")).toBe(true);
    expect(apps[0].board_rank < apps[1].board_rank).toBe(true);
    expect(
      userJobRows(f.t, f.cli.userId ?? "").every(
        (u) => u.inbox_state === "tracked"
      )
    ).toBe(true);
    const again = InboxBulkResponseSchema.parse(
      (await bulk(f.web, ids, "track")).body
    ).results;
    expect(again.map((r) => r.application_id)).toEqual(
      results.map((r) => r.application_id)
    );
    const replay = await bulk(f.web, ids, "track", "bulk-track-1");
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
  });

  it("TD-BULK score queues missing scores and reports cached ones", async () => {
    const { items } = await discover(
      await Promise.all([1, 2].map((n) => postingItem({ ref: `${n}` })))
    );
    const ids = items.map((i) => i.user_job_id ?? "");
    await seedScore(f.cli.userId ?? "", items[0].posting_id ?? "", 77);
    f.t.jobsSqlite
      .query("DELETE FROM match_scores WHERE posting_id = ?")
      .run(items[1].posting_id ?? "");
    const sentBefore = f.t.queue.sent.length;
    const res = InboxBulkResponseSchema.parse(
      (await bulk(f.web, ids, "score")).body
    ).results;
    expect(res.map((r) => r.score_status)).toEqual(["cached", "queued"]);
    expect(f.t.queue.sent.length).toBe(sentBefore + 1);
  });

  it("TD-BULK at most 200 ids; read tokens cannot run bulk actions", async () => {
    const tooMany = Array.from({ length: 201 }, () => newId("ujb"));
    expect((await bulk(f.web, tooMany, "seen")).status).toBe(400);
    const reader = await f.client.personalToken("alice@example.com", "read");
    expect((await bulk(reader, [newId("ujb")], "seen")).status).toBe(403);
    expect((await bulk(f.web, [newId("ujb")], "explode")).status).toBe(400);
  });

  it("TD-BULK track 200 ids in one call within D1 limits (≤ 100 params per statement, few queries)", async () => {
    const userId = f.web.userId ?? "";
    const existing = seedApplication(f.t.jobsSqlite, userId, {
      board_rank: "m",
    });
    const ids = Array.from(
      { length: 199 },
      () => seedUserJob(f.t.jobsSqlite, userId, { inbox_state: "new" }).id
    );
    ids.splice(57, 0, existing.user_job_id);
    const db = f.t.env.JOBS_DB as unknown as {
      batch: (s: { params: unknown[] }[]) => Promise<unknown>;
      prepare: (sql: string) => unknown;
    };
    const batches: { params: unknown[] }[][] = [];
    let prepared = 0;
    const batch = db.batch.bind(db);
    const prepare = db.prepare.bind(db);
    db.batch = (statements) => {
      batches.push(statements);
      return batch(statements);
    };
    db.prepare = (sql) => {
      prepared++;
      return prepare(sql);
    };
    const res = await bulk(f.web, ids, "track", "track-200");
    db.batch = batch;
    db.prepare = prepare;
    expect(res.status).toBe(200);
    const results = InboxBulkResponseSchema.parse(res.body).results;
    expect(results).toHaveLength(200);
    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(results[57].application_id).toBe(existing.id);
    const written = batches.flat();
    expect(written.length).toBeLessThanOrEqual(40);
    expect(
      Math.max(...written.map((st) => st.params.length))
    ).toBeLessThanOrEqual(100);
    expect(prepared).toBeLessThan(100);
    const apps = f.t.jobsSqlite
      .query(
        "SELECT id, user_job_id, board_rank, stage, mode, revision FROM applications WHERE user_id = ? ORDER BY board_rank"
      )
      .all(userId) as {
      board_rank: string;
      id: string;
      revision: number;
      stage: string;
      user_job_id: string;
    }[];
    expect(apps).toHaveLength(200);
    // the existing card stays first, the new ones follow in request order
    expect(apps.map((a) => a.user_job_id)).toEqual([
      existing.user_job_id,
      ...ids.filter((id) => id !== existing.user_job_id),
    ]);
    expect(new Set(apps.map((a) => a.board_rank)).size).toBe(200);
    expect(apps.every((a) => a.board_rank.length <= 32)).toBe(true);
    const created = f.t.jobsSqlite
      .query(
        "SELECT application_id, payload, idempotency_key FROM application_events WHERE user_id = ? AND type = 'created'"
      )
      .all(userId) as {
      application_id: string;
      idempotency_key: string;
      payload: string;
    }[];
    expect(created).toHaveLength(199);
    expect(JSON.parse(created[0].payload)).toEqual({
      origin: "manual",
      stage: "saved",
    });
    expect(
      created.every((e) => e.idempotency_key.startsWith("track-200:ujb_"))
    ).toBe(true);
    const changes = f.t.jobsSqlite
      .query(
        "SELECT entity, COUNT(*) AS n FROM change_log WHERE user_id = ? GROUP BY entity ORDER BY entity"
      )
      .all(userId);
    expect(changes).toEqual([
      { entity: "application", n: 199 },
      { entity: "event", n: 199 },
      { entity: "user_job", n: 199 },
    ]);
    expect(
      userJobRows(f.t, userId).filter((u) => u.inbox_state === "tracked")
    ).toHaveLength(200);
    const replay = await bulk(f.web, ids, "track", "track-200");
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
  });

  it("TD-BULK bulk track rebalances a column whose last rank cannot grow", async () => {
    const userId = f.web.userId ?? "";
    const full = seedApplication(f.t.jobsSqlite, userId, {
      board_rank: "z".repeat(32),
    });
    const ids = [1, 2, 3].map(
      () => seedUserJob(f.t.jobsSqlite, userId, { inbox_state: "new" }).id
    );
    const res = await bulk(f.web, ids, "track");
    expect(res.status).toBe(200);
    const apps = f.t.jobsSqlite
      .query(
        "SELECT id, user_job_id, board_rank, revision FROM applications WHERE user_id = ? ORDER BY board_rank"
      )
      .all(userId) as {
      board_rank: string;
      id: string;
      revision: number;
      user_job_id: string;
    }[];
    expect(apps.map((a) => a.user_job_id)).toEqual([full.user_job_id, ...ids]);
    expect(apps.every((a) => a.board_rank.length === 6)).toBe(true);
    expect(apps[0].revision).toBe(2);
  });
});
