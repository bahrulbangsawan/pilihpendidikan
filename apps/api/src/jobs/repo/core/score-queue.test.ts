import { beforeEach, describe, expect, it } from "bun:test";
import { JobsAiMessageSchema } from "@pilihpendidikan/jobs-contracts/queue";
import type { TestEnv } from "../../../../test/fakes";
import { createTestEnv } from "../../../../test/fakes";
import { seedApplication, seedUserJob } from "../../../../test/seed-jobs";
import type { UserScope } from "../../core/scope";
import { trustedScope } from "../../core/scope";
import type { JobsDb } from "./db";
import { jobsDb } from "./db";
import { computeProfileVersion } from "./profile-version";
import {
  enqueueProfileRescore,
  enqueueScoring,
  profileRescoreCandidates,
} from "./score-queue";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";
const NOW = Date.UTC(2026, 9, 12, 10);

let t: TestEnv;
let db: JobsDb;
let scope: UserScope;

beforeEach(() => {
  t = createTestEnv();
  db = jobsDb(t.env);
  scope = trustedScope(USER, "script");
});

function scores() {
  return t.jobsSqlite
    .query(
      "SELECT posting_id, status, model, profile_version FROM match_scores WHERE user_id = ? ORDER BY posting_id"
    )
    .all(USER) as Array<{
    model: string;
    posting_id: string;
    profile_version: number;
    status: string;
  }>;
}

describe("TCORE-SCOREQ the scoring producer (07 §7.1)", () => {
  it("TCORE-SCOREQ inserts queued placeholders and sends ≤ 50 postings per message", async () => {
    const postings = Array.from(
      { length: 120 },
      () => seedUserJob(t.jobsSqlite, USER).posting_id
    );
    const result = await enqueueScoring(t.env, db, scope, {
      postingIds: postings,
      profileVersion: 7,
      now: NOW,
    });
    expect(result.queued).toHaveLength(120);
    expect(result.messages).toBe(3);
    expect(
      t.queue.sent.map(
        (m) => (m.body as { posting_ids: string[] }).posting_ids.length
      )
    ).toEqual([50, 50, 20]);
    for (const message of t.queue.sent) {
      expect(JobsAiMessageSchema.parse(message.body)).toMatchObject({
        type: "score_postings",
        user_id: USER,
        profile_version: 7,
        rubric_version: "r1",
      });
    }
    expect(
      scores().every((s) => s.status === "queued" && s.model === "queued")
    ).toBe(true);
  });

  it("TCORE-SCOREQ a duplicate request sends no second message (T7-06)", async () => {
    const a = seedUserJob(t.jobsSqlite, USER).posting_id;
    const b = seedUserJob(t.jobsSqlite, USER).posting_id;
    await enqueueScoring(t.env, db, scope, {
      postingIds: [a, b],
      profileVersion: 1,
      now: NOW,
    });
    t.jobsSqlite
      .query("UPDATE match_scores SET status = 'ready' WHERE posting_id = ?")
      .run(a);
    const again = await enqueueScoring(t.env, db, scope, {
      postingIds: [a, b, a],
      profileVersion: 1,
      now: NOW + 1,
    });
    expect(again).toMatchObject({
      queued: [],
      cached: [a],
      pending: [b],
      messages: 0,
    });
    expect(t.queue.sent).toHaveLength(1);
    // A new profile version is a new cache key.
    const next = await enqueueScoring(t.env, db, scope, {
      postingIds: [a],
      profileVersion: 2,
      now: NOW + 2,
    });
    expect(next.queued).toEqual([a]);
  });

  it("TCORE-SCOREQ only scores postings the user tracks", async () => {
    const mine = seedUserJob(t.jobsSqlite, USER).posting_id;
    const foreign = seedUserJob(
      t.jobsSqlite,
      "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0B"
    ).posting_id;
    const result = await enqueueScoring(t.env, db, scope, {
      postingIds: [mine, foreign],
      profileVersion: 1,
      now: NOW,
    });
    expect(result.queued).toEqual([mine]);
    expect(result.untracked).toEqual([foreign]);
    expect(scores()).toHaveLength(1);
  });

  it("TCORE-SCOREQ re-queues failed rows on request", async () => {
    const p = seedUserJob(t.jobsSqlite, USER).posting_id;
    await enqueueScoring(t.env, db, scope, {
      postingIds: [p],
      profileVersion: 1,
      now: NOW,
    });
    t.jobsSqlite.query("UPDATE match_scores SET status = 'failed'").run();
    expect(
      (
        await enqueueScoring(t.env, db, scope, {
          postingIds: [p],
          profileVersion: 1,
          now: NOW,
        })
      ).failed
    ).toEqual([p]);
    const retry = await enqueueScoring(t.env, db, scope, {
      postingIds: [p],
      profileVersion: 1,
      now: NOW,
      retryFailed: true,
    });
    expect(retry.queued).toEqual([p]);
    expect(scores()[0].status).toBe("queued");
  });

  it("TCORE-SCOREQ a failed send rolls the placeholders back", async () => {
    const p = seedUserJob(t.jobsSqlite, USER).posting_id;
    const env = {
      ...t.env,
      JOBS_AI_QUEUE: {
        send: () => Promise.reject(new Error("queue down")),
        sendBatch: () => Promise.reject(new Error("queue down")),
      } as unknown as Queue<never>,
    };
    await expect(
      enqueueScoring(env, db, scope, {
        postingIds: [p],
        profileVersion: 1,
        now: NOW,
      })
    ).rejects.toThrow("queue down");
    expect(scores()).toHaveLength(0);
  });

  it("TCORE-SCOREQ re-scores inbox and active applications after a profile change (07 §2.1)", async () => {
    const inbox = seedUserJob(t.jobsSqlite, USER, {
      inbox_state: "new",
    }).posting_id;
    seedUserJob(t.jobsSqlite, USER, { inbox_state: "dismissed" });
    const active = seedApplication(t.jobsSqlite, USER, {
      stage: "applied",
    }).posting_id;
    seedApplication(t.jobsSqlite, USER, { stage: "rejected" });
    seedApplication(t.jobsSqlite, USER, { stage: "saved", archived: 1 });
    const version = await computeProfileVersion(t.env, db, scope);
    expect(
      (
        await profileRescoreCandidates(db, scope, { profileVersion: version })
      ).sort()
    ).toEqual([inbox, active].sort());
    const result = await enqueueProfileRescore(t.env, db, scope, {
      profileVersion: version,
      now: NOW,
    });
    expect(result.queued.sort()).toEqual([inbox, active].sort());
    expect(
      await profileRescoreCandidates(db, scope, { profileVersion: version })
    ).toEqual([]);
  });
});

describe("TCORE-SCOREQ profile_version (07 §2.1)", () => {
  it("TCORE-SCOREQ changes with facts, years-of-experience answers, the AI-sensitivity setting and the primary CV", async () => {
    const email = "alice@example.com";
    const v0 = await computeProfileVersion(t.env, db, scope, { email });
    expect(Number.isSafeInteger(v0)).toBe(true);
    expect(await computeProfileVersion(t.env, db, scope, { email })).toBe(v0);
    t.jobsSqlite
      .query(
        "INSERT INTO applicant_facts (id, user_id, key, value, source, created_at, updated_at) VALUES ('fct_1', ?, 'profile.primary_cv_id', '\"my-cv\"', 'user_entered', 1, 1)"
      )
      .run(USER);
    const v1 = await computeProfileVersion(t.env, db, scope, { email });
    expect(v1).not.toBe(v0);
    // The CV is read only when the user owns it.
    await t.env.CV_KV.put("cv:my-cv", JSON.stringify({ summary: "a" }));
    expect(await computeProfileVersion(t.env, db, scope, { email })).toBe(v1);
    await t.env.CV_KV.put("owner:cv:my-cv", email);
    const v2 = await computeProfileVersion(t.env, db, scope, { email });
    expect(v2).not.toBe(v1);
    await t.env.CV_KV.put("cv:my-cv", JSON.stringify({ summary: "b" }));
    const v3 = await computeProfileVersion(t.env, db, scope, { email });
    expect(v3).not.toBe(v2);
    t.jobsSqlite
      .query(
        "INSERT INTO screening_answers (id, user_id, question_key, answer, answer_kind, sensitivity, auto_use, created_at, updated_at) VALUES ('ans_1', ?, 'years_experience.python', '5', 'number', 'none', 'always', 1, 1)"
      )
      .run(USER);
    const v4 = await computeProfileVersion(t.env, db, scope, { email });
    expect(v4).not.toBe(v3);
    t.jobsSqlite
      .query(
        "INSERT INTO screening_answers (id, user_id, question_key, answer, answer_kind, sensitivity, auto_use, created_at, updated_at) VALUES ('ans_2', ?, 'notice_period', '30', 'number', 'none', 'always', 1, 1)"
      )
      .run(USER);
    expect(await computeProfileVersion(t.env, db, scope, { email })).toBe(v4);
    t.jobsSqlite
      .query(
        "INSERT INTO user_settings (user_id, ai_scoring_sensitive, updated_at) VALUES (?, 0, 1)"
      )
      .run(USER);
    expect(await computeProfileVersion(t.env, db, scope, { email })).not.toBe(
      v4
    );
  });
});
