import { describe, expect, it } from "bun:test";
import {
  GetScoreResponseSchema,
  RequestScoresResponseSchema,
} from "@pilihpendidikan/jobs-contracts/api/scoring";
import { ScoreComponentsSchema } from "@pilihpendidikan/jobs-contracts/scoring";
import { seedUserJob } from "../../../../test/seed-jobs";
import {
  insertFact,
  scoreRows,
  scoringWorld,
  trackedPosting,
  usageRows,
} from "./fixtures.test";

const HEADLINE_RE = /^\d+ · /;

describe("S-11 bulk scoring of 300 postings (07 §7, 13 S-11)", () => {
  it("S-11 scores 300 postings: processed, cached on re-request, budget counter increments, DLQ empty", async () => {
    const world = await scoringWorld();
    const ids = Array.from({ length: 300 }, (_, i) => trackedPosting(world, i));
    const first = await world.web.post("/api/v1/scores:request", {
      posting_ids: ids,
    });
    expect(first.status).toBe(200);
    const body = RequestScoresResponseSchema.parse(first.body);
    expect(body.queued.sort()).toEqual([...ids].sort());
    expect(body.cached).toEqual([]);
    // ≤ 50 postings per message, one user per message.
    const messages = world.t.queue.sent.map((m) => m.body);
    expect(messages).toHaveLength(6);
    for (const message of messages) {
      expect(message).toMatchObject({
        type: "score_postings",
        user_id: world.userId,
        rubric_version: "r1",
      });
      expect(
        (message as { posting_ids: string[] }).posting_ids.length
      ).toBeLessThanOrEqual(50);
    }
    const report = await world.drain();
    expect(report.deadLettered).toBe(0);
    expect(report.dropped).toBe(0);
    const rows = scoreRows(world);
    expect(rows).toHaveLength(300);
    expect(
      rows.every((row) => row.status === "ready" && row.model === "gpt-6-luna")
    ).toBe(true);
    for (const row of rows.slice(0, 20)) {
      ScoreComponentsSchema.parse(row.components);
    }
    const usage = usageRows(world);
    expect(usage.score.calls).toBe(300);
    expect(usage.score.cost_micro_usd).toBeGreaterThan(0);
    // Scores differ with the postings (the fake rubric reads the input).
    expect(new Set(rows.map((row) => row.score)).size).toBeGreaterThan(1);
    const sent = world.t.queue.sent.length;
    const again = await world.web.post("/api/v1/scores:request", {
      posting_ids: ids,
    });
    expect(again.status).toBe(200);
    expect(RequestScoresResponseSchema.parse(again.body)).toEqual({
      queued: [],
      cached: expect.arrayContaining(ids),
    });
    expect(world.t.queue.sent).toHaveLength(sent);
    expect(usageRows(world).score.calls).toBe(300);
  });
});

describe("POST /api/v1/scores:request and GET /api/v1/scores/{posting_id} (05 §6)", () => {
  it("returns the current profile_version's score with components and explanation, null while queued", async () => {
    const world = await scoringWorld();
    const id = trackedPosting(world, 0);
    await world.web.post("/api/v1/scores:request", { posting_ids: [id] });
    const queued = await world.web.get(`/api/v1/scores/${id}`);
    expect(queued.status).toBe(200);
    const pending = GetScoreResponseSchema.parse(queued.body);
    expect(pending.score).toBeNull();
    await world.drain();
    const ready = await world.web.get(`/api/v1/scores/${id}`);
    const parsed = GetScoreResponseSchema.parse(ready.body);
    expect(parsed.profile_version).toBe(pending.profile_version);
    expect(parsed.score).toMatchObject({
      posting_id: id,
      status: "ready",
      rubric_version: "r1",
      profile_version: pending.profile_version,
    });
    expect(parsed.score?.explanation.split("\n")[0]).toMatch(HEADLINE_RE);
    expect(ready.headers.get("ETag")).toBeTruthy();
    const cached = await world.web.get(`/api/v1/scores/${id}`, {
      headers: { "If-None-Match": ready.headers.get("ETag") as string },
    });
    expect(cached.status).toBe(304);
  });

  it("a profile change gives a new profile_version: the old score is not current any more", async () => {
    const world = await scoringWorld();
    const id = trackedPosting(world, 0);
    await world.web.post("/api/v1/scores:request", { posting_ids: [id] });
    await world.drain();
    const before = GetScoreResponseSchema.parse(
      (await world.web.get(`/api/v1/scores/${id}`)).body
    );
    world.clock.advance(1000);
    insertFact(
      world.t,
      world.userId,
      "skills.extra",
      ["Kubernetes"],
      world.clock.now()
    );
    const after = GetScoreResponseSchema.parse(
      (await world.web.get(`/api/v1/scores/${id}`)).body
    );
    expect(after.profile_version).not.toBe(before.profile_version);
    expect(after.score).toBeNull();
    const requeued = RequestScoresResponseSchema.parse(
      (await world.web.post("/api/v1/scores:request", { posting_ids: [id] }))
        .body
    );
    expect(requeued.queued).toEqual([id]);
    await world.drain();
    const rescored = GetScoreResponseSchema.parse(
      (await world.web.get(`/api/v1/scores/${id}`)).body
    );
    expect(rescored.score?.profile_version).toBe(after.profile_version);
    expect(scoreRows(world)).toHaveLength(2);
  });

  it("accepts user_job_ids, ignores untracked ids and answers 404 when none is tracked", async () => {
    const world = await scoringWorld();
    const id = trackedPosting(world, 1);
    const userJob = world.t.jobsSqlite
      .query("SELECT id FROM user_jobs WHERE posting_id = ?")
      .get(id) as { id: string };
    const byUserJob = await world.web.post("/api/v1/scores:request", {
      user_job_ids: [userJob.id],
    });
    expect(RequestScoresResponseSchema.parse(byUserJob.body).queued).toEqual([
      id,
    ]);
    const bob = await world.client.browserSession("bob@example.com");
    const foreign = await bob.post("/api/v1/scores:request", {
      posting_ids: [id],
    });
    expect(foreign.status).toBe(404);
    expect((await bob.get(`/api/v1/scores/${id}`)).status).toBe(404);
    const other = seedUserJob(world.t.jobsSqlite, bob.userId as string);
    const mixed = await world.web.post("/api/v1/scores:request", {
      posting_ids: [id, other.posting_id],
    });
    expect(RequestScoresResponseSchema.parse(mixed.body).queued).toEqual([id]);
  });

  it("validates the body: ≤ 500 ids and exactly one of posting_ids / user_job_ids; needs jobs:write", async () => {
    const world = await scoringWorld();
    const ids = Array.from({ length: 501 }, (_, i) =>
      `pst_01JA6V8M3W8Z1T6Q4Y2B7K${String(i).padStart(4, "0")}`.slice(0, 30)
    );
    expect(
      (await world.web.post("/api/v1/scores:request", { posting_ids: ids }))
        .status
    ).toBe(400);
    expect((await world.web.post("/api/v1/scores:request", {})).status).toBe(
      400
    );
    const reader = await world.client.personalToken(
      "alice@example.com",
      "read"
    );
    const denied = await reader.post("/api/v1/scores:request", {
      posting_ids: [trackedPosting(world, 2)],
    });
    expect(denied.status).toBe(403);
    expect(
      (await reader.get(`/api/v1/scores/${trackedPosting(world, 3)}`)).status
    ).toBe(200);
  });

  it("re-queues a failed score on request", async () => {
    const world = await scoringWorld();
    const id = trackedPosting(world, 0);
    await world.web.post("/api/v1/scores:request", { posting_ids: [id] });
    world.t.jobsSqlite
      .query("UPDATE match_scores SET status = 'failed' WHERE posting_id = ?")
      .run(id);
    const again = RequestScoresResponseSchema.parse(
      (await world.web.post("/api/v1/scores:request", { posting_ids: [id] }))
        .body
    );
    expect(again.queued).toEqual([id]);
    await world.drain();
    expect(scoreRows(world)[0]).toMatchObject({ status: "ready" });
  });
});
