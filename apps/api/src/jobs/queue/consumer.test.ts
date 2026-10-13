import { describe, expect, it } from "bun:test";
import type { JobsAiMessage } from "@pilihpendidikan/jobs-contracts/queue";
import { QUEUE_MESSAGE_TYPES } from "@pilihpendidikan/jobs-contracts/queue";
import { createCtx, createFakeClock, createTestEnv } from "../../../test/fakes";
import { handleJobsAiBatch, JOBS_AI_DLQ, QUEUE_HANDLERS } from "./consumer";
import type { QueueOutcome } from "./types";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";

const examples: Record<string, JobsAiMessage> = {
  score_postings: {
    v: 1,
    type: "score_postings",
    message_id: "a",
    user_id: USER,
    posting_ids: ["pst_01JA6V8M3W8Z1T6Q4Y2B7K9C0D"],
    profile_version: 1,
    rubric_version: "r1",
  },
  tailor_cv: {
    v: 1,
    type: "tailor_cv",
    message_id: "b",
    user_id: USER,
    cv_variant_id: "cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
  },
  evaluate_rules: {
    v: 1,
    type: "evaluate_rules",
    message_id: "c",
    user_id: USER,
    posting_ids: ["pst_01JA6V8M3W8Z1T6Q4Y2B7K9C0D"],
  },
  purge_user: {
    v: 1,
    type: "purge_user",
    message_id: "d",
    user_id: USER,
    phase: "jobs_db",
  },
  rollup_user: {
    v: 1,
    type: "rollup_user",
    message_id: "e",
    user_id: USER,
    days: ["2026-10-12"],
  },
  rebuild_analytics: {
    v: 1,
    type: "rebuild_analytics",
    message_id: "f",
    user_id: USER,
    reason: "timezone_change",
  },
  export_user: {
    v: 1,
    type: "export_user",
    message_id: "g",
    user_id: USER,
    export_id: "exp_1",
  },
};

interface Delivered {
  outcome: "ack" | "retry" | "none";
  delaySeconds?: number;
}

function batchOf(queue: string, bodies: unknown[], attempts = 1) {
  const outcomes: Delivered[] = bodies.map(() => ({ outcome: "none" }));
  const batch = {
    queue,
    messages: bodies.map((body, i) => ({
      id: `id-${i}`,
      timestamp: new Date(),
      body,
      attempts,
      ack: () => {
        outcomes[i] = { outcome: "ack" };
      },
      retry: (o?: { delaySeconds?: number }) => {
        outcomes[i] = { outcome: "retry", delaySeconds: o?.delaySeconds };
      },
    })),
    ackAll: () => undefined,
    retryAll: () => undefined,
  } as unknown as MessageBatch<unknown>;
  return { batch, outcomes };
}

describe("TCORE-QUEUE the jobs-ai consumer (14 §6)", () => {
  it("TCORE-QUEUE registers one handler per JobsAiMessage type and acks the stubs", async () => {
    expect(Object.keys(QUEUE_HANDLERS).sort()).toEqual(
      [...QUEUE_MESSAGE_TYPES].sort()
    );
    const t = createTestEnv();
    const { batch, outcomes } = batchOf("jobs-ai", Object.values(examples));
    const report = await handleJobsAiBatch(batch, t.env, createCtx());
    expect(report).toEqual({ acked: 7, retried: 0, dropped: 0 });
    expect(outcomes.every((o) => o.outcome === "ack")).toBe(true);
  });

  it("TCORE-QUEUE dispatches by type with a user scope, the clock and a per-batch memo", async () => {
    const t = createTestEnv();
    const clock = createFakeClock();
    const seen: string[] = [];
    let computed = 0;
    const { batch } = batchOf("jobs-ai", [
      examples.rollup_user,
      examples.rollup_user,
    ]);
    await handleJobsAiBatch(
      batch,
      t.env,
      createCtx(),
      { clock },
      {
        handlers: {
          rollup_user: async (qc) => {
            seen.push(`${qc.scope.userId}@${qc.now}:${qc.deadLetter}`);
            await qc.memo("profile", () => {
              computed += 1;
              return Promise.resolve(1);
            });
            return { action: "ack" };
          },
        },
      }
    );
    expect(seen).toEqual([
      `${USER}@${clock.now()}:false`,
      `${USER}@${clock.now()}:false`,
    ]);
    expect(computed).toBe(1);
  });

  it("TCORE-QUEUE drops invalid bodies, retries on errors with the canonical backoff", async () => {
    const t = createTestEnv();
    const { batch, outcomes } = batchOf(
      "jobs-ai",
      [{ v: 2, type: "nope" }, examples.tailor_cv, examples.export_user],
      3
    );
    const report = await handleJobsAiBatch(
      batch,
      t.env,
      createCtx(),
      {},
      {
        handlers: {
          tailor_cv: () => Promise.reject(new Error("D1 hiccup")),
          export_user: (): Promise<QueueOutcome> =>
            Promise.resolve({ action: "retry", delaySeconds: 42 }),
        },
      }
    );
    expect(report).toEqual({ acked: 0, retried: 2, dropped: 1 });
    expect(outcomes[0].outcome).toBe("ack");
    expect(outcomes[1].outcome).toBe("retry");
    // min(300, 2^3 × 10 + jitter in [0, 10))
    expect(outcomes[1].delaySeconds).toBeGreaterThanOrEqual(80);
    expect(outcomes[1].delaySeconds).toBeLessThan(90);
    expect(outcomes[2]).toEqual({ outcome: "retry", delaySeconds: 42 });
  });

  it("TCORE-QUEUE routes jobs-ai-dlq messages to the dead-letter handler", async () => {
    const t = createTestEnv();
    const dead: string[] = [];
    const { batch } = batchOf(JOBS_AI_DLQ, [
      examples.score_postings,
      examples.tailor_cv,
    ]);
    await handleJobsAiBatch(
      batch,
      t.env,
      createCtx(),
      {},
      {
        handlers: {
          score_postings: () => Promise.reject(new Error("must not run")),
        },
        deadLetter: (qc) => {
          dead.push(`${qc.message.type}:${qc.deadLetter}`);
          return Promise.resolve({ action: "ack" });
        },
      }
    );
    expect(dead).toEqual(["score_postings:true", "tailor_cv:true"]);
  });

  it("TCORE-QUEUE the Worker queue export runs the consumer (scoring producer → drain)", async () => {
    const t = createTestEnv();
    await t.env.JOBS_AI_QUEUE.send(examples.purge_user);
    const report = await t.queue.drain(t.env);
    expect(report).toMatchObject({ delivered: 1, acked: 1 });
  });
});
