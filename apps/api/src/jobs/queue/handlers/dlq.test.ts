import { describe, expect, it, spyOn } from "bun:test";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { JobsAiMessage } from "@pilihpendidikan/jobs-contracts/queue";
import { createCtx } from "../../../../test/fakes";
import { seedApplication } from "../../../../test/seed-jobs";
import { handleJobsAiBatch, JOBS_AI_DLQ } from "../consumer";
import {
  scoreRows,
  scoringWorld,
  trackedPosting,
} from "../../routes/scoring/fixtures.test";

const HASH_RE = /^[0-9a-f]{16}$/;

function dlqBatch(bodies: JobsAiMessage[]) {
  const outcomes: string[] = bodies.map(() => "none");
  const batch = {
    queue: JOBS_AI_DLQ,
    messages: bodies.map((body, i) => ({
      id: `m${i}`,
      timestamp: new Date(),
      body,
      attempts: 1,
      ack: () => {
        outcomes[i] = "ack";
      },
      retry: () => {
        outcomes[i] = "retry";
      },
    })),
    ackAll: () => undefined,
    retryAll: () => undefined,
  } as unknown as MessageBatch<unknown>;
  return { batch, outcomes };
}

describe("jobs-ai-dlq consumer (14 §6, 07 §7.2)", () => {
  it("T7-08 writes deterministic-only dlq scores for unscored postings and keeps ready ones", async () => {
    const world = await scoringWorld();
    const [a, b] = [trackedPosting(world, 0), trackedPosting(world, 1)];
    await world.web.post("/api/v1/scores:request", { posting_ids: [a] });
    await world.drain();
    const ready = scoreRows(world)[0];
    await world.web.post("/api/v1/scores:request", { posting_ids: [b] });
    const message = world.t.queue.pending.splice(0)[0].body;
    const pv = (message as { profile_version: number }).profile_version;
    const { batch, outcomes } = dlqBatch([
      { ...message, posting_ids: [a, b] } as JobsAiMessage & {
        profile_version: number;
      },
    ]);
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    try {
      await handleJobsAiBatch(batch, world.t.env, createCtx(), {
        clock: world.clock,
      });
    } finally {
      spy.mockRestore();
    }
    expect(outcomes).toEqual(["ack"]);
    const rows = scoreRows(world);
    expect(rows.find((row) => row.posting_id === a)).toEqual(ready);
    const dlq = rows.find((row) => row.posting_id === b);
    expect(dlq).toMatchObject({
      status: "ready",
      model: "deterministic-only",
      profile_version: pv,
    });
    expect((dlq?.components as { ai: { status: string } }).ai.status).toBe(
      "dlq"
    );
    const line = logs
      .map((l) => JSON.parse(l))
      .find((entry) => entry.evt === "dlq");
    expect(line).toMatchObject({ evt: "dlq", type: "score_postings" });
    expect(line.user_id_hash).toMatch(HASH_RE);
    expect(JSON.stringify(logs)).not.toContain(world.userId);
  });

  it("T7-08 fails a generating tailor_cv variant once via failCvVariant, with a timeline notice and the dlq log, and acks the other types", async () => {
    const world = await scoringWorld();
    const app = seedApplication(world.t.jobsSqlite, world.userId);
    const now = world.clock.now();
    const cvvId = newId("cvv", now);
    world.t.jobsSqlite
      .query(
        "INSERT INTO cv_variants (id, user_id, application_id, base_cv_id, template, status, created_at, updated_at) VALUES (?, ?, ?, 'alice-backend-cv', 'basic', 'generating', ?, ?)"
      )
      .run(cvvId, world.userId, app.id, now, now);
    const tailor: JobsAiMessage = {
      v: 1,
      type: "tailor_cv",
      message_id: "t1",
      user_id: world.userId,
      cv_variant_id: cvvId,
    };
    const others: JobsAiMessage[] = [
      {
        v: 1,
        type: "evaluate_rules",
        message_id: "e1",
        user_id: world.userId,
        posting_ids: [trackedPosting(world, 2)],
      },
      {
        v: 1,
        type: "export_user",
        message_id: "x1",
        user_id: world.userId,
        export_id: "exp_1",
      },
    ];
    const logs: Record<string, unknown>[] = [];
    const spy = spyOn(console, "log").mockImplementation((line: unknown) => {
      logs.push(JSON.parse(String(line)) as Record<string, unknown>);
    });
    try {
      for (let round = 0; round < 2; round++) {
        const { batch, outcomes } = dlqBatch([tailor, ...others]);
        await handleJobsAiBatch(batch, world.t.env, createCtx(), {
          clock: world.clock,
        });
        expect(outcomes).toEqual(["ack", "ack", "ack"]);
      }
    } finally {
      spy.mockRestore();
    }
    const dlqTypes = logs.filter((l) => l.evt === "dlq").map((l) => l.type);
    expect(dlqTypes).toEqual([
      "tailor_cv",
      "evaluate_rules",
      "export_user",
      "tailor_cv",
      "evaluate_rules",
      "export_user",
    ]);
    for (const line of logs.filter((l) => l.evt === "dlq")) {
      expect(line.user_id_hash).toMatch(HASH_RE);
    }
    expect(
      logs.filter((l) => l.evt === "dlq_tailor_cv").map((l) => l.failed)
    ).toEqual([true, false]);
    expect(JSON.stringify(logs)).not.toContain(world.userId);
    const variant = world.t.jobsSqlite
      .query("SELECT status, revision FROM cv_variants WHERE id = ?")
      .get(cvvId);
    expect(variant).toEqual({ status: "failed", revision: 2 });
    const events = world.t.jobsSqlite
      .query(
        "SELECT type, actor_kind, payload FROM application_events WHERE user_id = ? AND application_id = ?"
      )
      .all(world.userId, app.id) as Array<{ payload: string; type: string }>;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("conflict_recorded");
    expect(JSON.parse(events[0].payload)).toMatchObject({
      attempted: "tailor_cv",
      current: "failed",
    });
    const changes = world.t.jobsSqlite
      .query(
        "SELECT entity FROM change_log WHERE user_id = ? AND entity_id = ?"
      )
      .all(world.userId, cvvId);
    expect(changes).toEqual([{ entity: "cv_variant" }]);
  });

  it("never touches another user's variant", async () => {
    const world = await scoringWorld();
    const bob = await world.client.browserSession("bob@example.com");
    const now = world.clock.now();
    const cvvId = newId("cvv", now);
    world.t.jobsSqlite
      .query(
        "INSERT INTO cv_variants (id, user_id, base_cv_id, template, status, created_at, updated_at) VALUES (?, ?, 'b', 'basic', 'generating', ?, ?)"
      )
      .run(cvvId, bob.userId, now, now);
    const { batch } = dlqBatch([
      {
        v: 1,
        type: "tailor_cv",
        message_id: "t",
        user_id: world.userId,
        cv_variant_id: cvvId,
      },
    ]);
    await handleJobsAiBatch(batch, world.t.env, createCtx(), {
      clock: world.clock,
    });
    expect(
      world.t.jobsSqlite
        .query("SELECT status FROM cv_variants WHERE id = ?")
        .get(cvvId)
    ).toEqual({ status: "generating" });
  });
});
