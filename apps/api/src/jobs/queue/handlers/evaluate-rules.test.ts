import { describe, expect, it } from "bun:test";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { JobsAiMessageOf } from "@pilihpendidikan/jobs-contracts/queue";
import { createCtx } from "../../../../test/fakes";
import { seedPosting, seedUserJob } from "../../../../test/seed-jobs";
import { createCvDocument } from "../../../documents/cv-create";
import { getAiProvider } from "../../ai/provider";
import { BASE_CV_ID, sampleCv } from "../../services/cv/tailoring/fixtures";
import type { Fixture } from "../../routes/automation/support.test";
import type { Body } from "../../routes/automation/support.test";
import {
  activeAutoRule,
  appRow,
  claim,
  claimOne,
  FORM_HASH,
  key,
  leasePost,
  NOW,
  rows,
  seedScore,
  setup,
  taskRow,
} from "../../routes/automation/support.test";
import type { QueueContext } from "../types";
import { handleEvaluateRules } from "./evaluate-rules";

function message(
  fx: Fixture,
  postingIds: string[]
): JobsAiMessageOf<"evaluate_rules"> {
  return {
    v: 1,
    type: "evaluate_rules",
    message_id: `test-${newId("tsk")}`,
    user_id: fx.userId,
    posting_ids: postingIds,
  } as JobsAiMessageOf<"evaluate_rules">;
}

async function evaluate(fx: Fixture, postingIds: string[], now = NOW) {
  const memo = new Map<string, Promise<unknown>>();
  const qc: QueueContext<JobsAiMessageOf<"evaluate_rules">> = {
    ai: () => getAiProvider(fx.t.env),
    attempts: 1,
    ctx: createCtx(),
    db: fx.db,
    deadLetter: false,
    env: fx.t.env,
    log: () => undefined,
    memo: <V>(k: string, compute: () => Promise<V>) => {
      if (!memo.has(k)) {
        memo.set(k, compute());
      }
      return memo.get(k) as Promise<V>;
    },
    message: message(fx, postingIds),
    now,
    scope: fx.scope,
  };
  return await handleEvaluateRules(qc);
}

/** A tracked (inbox) greenhouse posting of the user; no application yet. */
function trackedPosting(
  fx: Fixture,
  overrides: Record<string, string | number | null> = {}
): string {
  const posting = seedPosting(fx.t.jobsSqlite, {
    apply_url: "https://boards.greenhouse.io/acme/jobs/1",
    apply_domain: "greenhouse.io",
    application_support: "browser_supported",
    source_kind: "greenhouse",
    company_domain: `${newId("pst").slice(-6).toLowerCase()}.example`,
    company_name: `Company ${Math.random().toString(36).slice(2, 7)}`,
    title: "Senior Backend Engineer",
    description_text: "Backend services in Go.",
    ...overrides,
  });
  seedUserJob(fx.t.jobsSqlite, fx.userId, {
    posting_id: posting.id,
    inbox_state: "new",
  });
  return posting.id;
}

async function approvalRule(
  fx: Fixture,
  criteria: Record<string, unknown> = {}
) {
  const res = await fx.web.post<Body>(
    "/api/v1/rules",
    {
      name: "Backend approvals",
      mode: "approval",
      enabled: true,
      criteria: {
        min_score: 70,
        require_ai_component: false,
        max_score_age_days: 14,
        exclude_blocking_gates: true,
        exclude_possible_gates: false,
        keywords: ["backend"],
        ...criteria,
      },
      limits: { max_per_day: 10, max_per_company_per_30d: 2 },
    },
    { idempotencyKey: key("rule") }
  );
  expect(res.status).toBe(201);
  return res.body.rule;
}

function tasksOf(fx: Fixture) {
  return rows(
    fx.t,
    "SELECT * FROM automation_tasks WHERE user_id = ? ORDER BY created_at, id",
    fx.userId
  );
}

describe("evaluate_rules (07 §10, 21 §4)", () => {
  it("T7-10 a ready score of the current profile version creates the task (key rule:<rule>:<posting>)", async () => {
    const fx = await setup();
    const rule = await approvalRule(fx);
    const postingId = trackedPosting(fx);
    await seedScore(fx, postingId, { score: 82 });
    expect(await evaluate(fx, [postingId])).toEqual({ action: "ack" });
    const tasks = tasksOf(fx);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].idempotency_key).toBe(`rule:${rule.id}:${postingId}`);
    expect(tasks[0].created_by).toBe("rule");
    expect(JSON.parse(tasks[0].payload as string)).toMatchObject({
      mode: "approval",
      rule_id: rule.id,
    });
    const app = appRow(fx.t, tasks[0].application_id as string);
    expect(app.stage).toBe("ready");
    expect(app.automation_rule_id).toBe(rule.id);
    await evaluate(fx, [postingId]);
    expect(tasksOf(fx)).toHaveLength(1);
  });

  it("T7-10 never matches on a queued score: it defers", async () => {
    const fx = await setup();
    await approvalRule(fx);
    const postingId = trackedPosting(fx);
    await seedScore(fx, postingId, { status: "queued", score: 0 });
    await evaluate(fx, [postingId]);
    expect(tasksOf(fx)).toHaveLength(0);
    expect(fx.t.queue.sent).toHaveLength(0);
  });

  it("T7-10 never matches on a stale profile version: it re-queues scoring and defers", async () => {
    const fx = await setup();
    await approvalRule(fx);
    const postingId = trackedPosting(fx);
    await seedScore(fx, postingId, { profile_version: 1, score: 99 });
    await evaluate(fx, [postingId]);
    expect(tasksOf(fx)).toHaveLength(0);
    const sent = fx.t.queue.sent.map(
      (m) => m.body as { posting_ids: string[]; type: string }
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("score_postings");
    expect(sent[0].posting_ids).toEqual([postingId]);
    const placeholder = rows(
      fx.t,
      "SELECT status FROM match_scores WHERE posting_id = ? AND profile_version <> 1",
      postingId
    );
    expect(placeholder[0].status).toBe("queued");
  });

  it("T7-10 blocking gates always exclude; possible gates and deterministic-only scores per criteria", async () => {
    const fx = await setup();
    await approvalRule(fx, {
      exclude_possible_gates: true,
      require_ai_component: true,
    });
    const blocked = trackedPosting(fx);
    await seedScore(fx, blocked, {
      score: 95,
      gates: [
        {
          predicate: "requires_unavailable_work_authorization",
          level: "blocking",
          probability: 0.9,
          multiplier: 0,
        },
      ],
    });
    const possible = trackedPosting(fx);
    await seedScore(fx, possible, {
      score: 95,
      gates: [
        {
          predicate: "requires_degree_user_lacks",
          level: "possible",
          probability: 0.6,
          multiplier: 0.8,
        },
      ],
    });
    const deterministic = trackedPosting(fx);
    await seedScore(fx, deterministic, { score: 95, aiStatus: "budget" });
    const low = trackedPosting(fx);
    await seedScore(fx, low, { score: 60 });
    await evaluate(fx, [blocked, possible, deterministic, low]);
    expect(tasksOf(fx)).toHaveLength(0);
  });

  it("the criteria, the coverage and other jobs' submissions filter postings", async () => {
    const fx = await setup();
    await approvalRule(fx, { exclude_companies: ["Evil Corp"] });
    const offTopic = trackedPosting(fx, {
      title: "Office Manager",
      description_text: "Admin",
    });
    const excluded = trackedPosting(fx, { company_name: "Evil Corp" });
    const email = trackedPosting(fx, { application_support: "email" });
    const closed = trackedPosting(fx, { status: "closed" });
    for (const id of [offTopic, excluded, email, closed]) {
      await seedScore(fx, id, { score: 95 });
    }
    await evaluate(fx, [offTopic, excluded, email, closed]);
    expect(tasksOf(fx)).toHaveLength(0);
  });

  it("an existing card must be ready; untracked postings are ignored; paused automation creates nothing", async () => {
    const fx = await setup();
    await approvalRule(fx);
    const posting = seedPosting(fx.t.jobsSqlite, {
      application_support: "browser_supported",
      apply_domain: "greenhouse.io",
      title: "Backend Engineer",
    });
    const unrelated = seedPosting(fx.t.jobsSqlite, {
      application_support: "browser_supported",
      title: "Backend Engineer",
    });
    const job = seedUserJob(fx.t.jobsSqlite, fx.userId, {
      posting_id: posting.id,
    });
    fx.t.jobsSqlite
      .query(
        "INSERT INTO applications (id, user_id, user_job_id, stage, stage_changed_at, board_rank, last_change_source, created_at, updated_at) VALUES ('app_01JA6V8M3W8Z1T6Q4Y2B7K9C0A', ?, ?, 'saved', ?, 'i', 'web', ?, ?)"
      )
      .run(fx.userId, job.id, NOW, NOW, NOW);
    await seedScore(fx, posting.id, { score: 90 });
    await seedScore(fx, unrelated.id, { score: 90 });
    await evaluate(fx, [posting.id, unrelated.id]);
    expect(tasksOf(fx)).toHaveLength(0);
    fx.t.jobsSqlite
      .query(
        "UPDATE applications SET stage = 'ready' WHERE id = 'app_01JA6V8M3W8Z1T6Q4Y2B7K9C0A'"
      )
      .run();
    fx.t.jobsSqlite
      .query(
        "INSERT INTO user_settings (user_id, automation_paused, updated_at) VALUES (?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET automation_paused = 1"
      )
      .run(fx.userId, NOW);
    await evaluate(fx, [posting.id]);
    expect(tasksOf(fx)).toHaveLength(0);
    fx.t.jobsSqlite
      .query("UPDATE user_settings SET automation_paused = 0 WHERE user_id = ?")
      .run(fx.userId);
    await evaluate(fx, [posting.id]);
    expect(tasksOf(fx)).toHaveLength(1);
  });

  it("S-28 auto rule: 3 matching jobs are submitted within limits; the 4th exceeds max_per_day", async () => {
    const fx = await setup({ flags: { JOBS_AUTO_MODE_ENABLED: true } });
    const rule = await activeAutoRule(fx, {
      limits: { max_per_day: 3, max_per_company_per_30d: 3 },
    });
    const postings = [
      trackedPosting(fx),
      trackedPosting(fx),
      trackedPosting(fx),
      trackedPosting(fx),
    ];
    for (const id of postings) {
      await seedScore(fx, id, { score: 92 });
    }
    await evaluate(fx, postings);
    const tasks = tasksOf(fx);
    expect(tasks).toHaveLength(3);
    for (const task of tasks) {
      expect(JSON.parse(task.payload as string)).toMatchObject({
        mode: "auto",
        rule_id: rule.id,
      });
    }
    for (let i = 0; i < 3; i++) {
      const cli =
        i === 0 ? fx.cli : await fx.client.cliSession("alice@example.com");
      const { taskId, leaseId } = await claimOne(cli);
      const intent = await leasePost(cli, taskId, leaseId, "submit-intent", {
        form_hash: FORM_HASH,
        rule_id: rule.id,
      });
      expect(intent.status).toBe(200);
      const result = await leasePost(cli, taskId, leaseId, "result", {
        outcome: "submitted",
        evidence: {
          kind: "browser_confirmation",
          verdict: "verified",
          signals: { url_match: true },
          captured_at: NOW,
        },
      });
      expect(result.status).toBe(200);
      expect(taskRow(fx.t, taskId).state).toBe("submitted");
    }
    expect(
      rows(
        fx.t,
        "SELECT * FROM application_events WHERE type = 'submit_intent'"
      )
    ).toHaveLength(3);
    const fourth = postings.find(
      (id) =>
        !tasks.some(
          (t) =>
            rows(
              fx.t,
              "SELECT u.posting_id FROM applications a JOIN user_jobs u ON u.id = a.user_job_id WHERE a.id = ?",
              t.application_id as string
            )[0]?.posting_id === id
        )
    ) as string;
    await evaluate(fx, [fourth]);
    expect(tasksOf(fx)).toHaveLength(3);
    const fourthApp = rows(
      fx.t,
      "SELECT a.stage FROM applications a JOIN user_jobs u ON u.id = a.user_job_id WHERE u.posting_id = ?",
      fourth
    );
    expect(fourthApp.every((a) => a.stage === "ready")).toBe(true);
  });

  it("TA-FLAGS rules create nothing while JOBS_AUTOMATION_ENABLED is off; auto rules need JOBS_AUTO_MODE_ENABLED", async () => {
    const fx = await setup({ flags: { JOBS_AUTO_MODE_ENABLED: true } });
    await activeAutoRule(fx);
    const postingId = trackedPosting(fx);
    await seedScore(fx, postingId, { score: 95 });
    await fx.t.setFlag("JOBS_AUTO_MODE_ENABLED", false);
    await evaluate(fx, [postingId]);
    expect(tasksOf(fx)).toHaveLength(0);
    await fx.t.setFlag("JOBS_AUTO_MODE_ENABLED", true);
    await fx.t.setFlag("JOBS_AUTOMATION_ENABLED", false);
    await evaluate(fx, [postingId]);
    expect(tasksOf(fx)).toHaveLength(0);
    await fx.t.setFlag("JOBS_AUTOMATION_ENABLED", true);
    await evaluate(fx, [postingId]);
    expect(tasksOf(fx)).toHaveLength(1);
  });
  it("a tailoring rule requests a CV variant first; its task waits for the approved CV", async () => {
    const fx = await setup();
    await createCvDocument(
      fx.t.env,
      { email: "alice@example.com" },
      BASE_CV_ID,
      sampleCv()
    );
    fx.t.jobsSqlite
      .query(
        "INSERT INTO user_settings (user_id, ai_consent_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET ai_consent_at = excluded.ai_consent_at"
      )
      .run(fx.userId, NOW, NOW);
    const res = await fx.web.post<Body>(
      "/api/v1/rules",
      {
        name: "Tailored backend",
        mode: "approval",
        enabled: true,
        criteria: {
          min_score: 70,
          require_ai_component: false,
          max_score_age_days: 14,
          exclude_blocking_gates: true,
          exclude_possible_gates: false,
          keywords: ["backend"],
        },
        limits: { max_per_day: 10, max_per_company_per_30d: 2 },
        cv_policy: {
          tailor: true,
          base_cv_id: BASE_CV_ID,
          require_cv_approval: true,
        },
      },
      { idempotencyKey: key("rule") }
    );
    expect(res.status).toBe(201);
    const postingId = trackedPosting(fx);
    await seedScore(fx, postingId, { score: 88 });
    await evaluate(fx, [postingId]);
    const tasks = tasksOf(fx);
    expect(tasks).toHaveLength(1);
    const app = appRow(fx.t, tasks[0].application_id as string);
    expect(app.stage).toBe("preparing");
    expect(app.base_cv_id).toBe(BASE_CV_ID);
    const variants = rows(
      fx.t,
      "SELECT id, status FROM cv_variants WHERE application_id = ?",
      app.id as string
    );
    expect(variants).toHaveLength(1);
    expect(variants[0].status).toBe("generating");
    expect(
      fx.t.queue.sent.some(
        (m) => (m.body as { type: string }).type === "tailor_cv"
      )
    ).toBe(true);
    expect((await claim(fx.cli)).status).toBe(204);
    fx.t.jobsSqlite
      .query("UPDATE cv_variants SET status = 'approved' WHERE id = ?")
      .run(variants[0].id as string);
    fx.t.jobsSqlite
      .query(
        "UPDATE applications SET cv_variant_id = ?, stage = 'ready' WHERE id = ?"
      )
      .run(variants[0].id as string, app.id as string);
    expect((await claim(fx.cli)).status).toBe(200);
  });
});
