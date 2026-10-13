import { beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  AnalyticsBreakdownResponseSchema,
  AnalyticsSummaryResponseSchema,
  AnalyticsTimeseriesResponseSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import type { TestEnv, V1Client, V1Session } from "../../../../test/fakes";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import {
  DAY,
  HOUR,
  insertEvent,
  seedApp,
  seedFinishedTask,
  seedScore,
  Story,
} from "../../services/analytics/support.test";

const NOW = Date.UTC(2026, 9, 12);
const d = (month: number, day: number, hour = 9) =>
  Date.UTC(2026, month - 1, day, hour);

interface Fixture {
  alice: V1Session;
  bob: V1Session;
  client: V1Client;
  t: TestEnv;
}

let f: Fixture;

function setTimezone(sqlite: Database, userId: string, zone: string): void {
  sqlite
    .query(
      "INSERT INTO user_settings (user_id, timezone, updated_at) VALUES (?, ?, 0) ON CONFLICT(user_id) DO UPDATE SET timezone = excluded.timezone"
    )
    .run(userId, zone);
}

beforeEach(async () => {
  const t = createTestEnv();
  const client = createV1Client(t, { clock: createFakeClock(NOW) });
  const alice = await client.browserSession("alice@example.com");
  const bob = await client.browserSession("bob@example.com");
  setTimezone(t.jobsSqlite, alice.userId as string, "UTC");
  setTimezone(t.jobsSqlite, bob.userId as string, "UTC");
  f = { t, client, alice, bob };
});

function summary(session: V1Session, query: Record<string, string> = {}) {
  return session.get<Record<string, unknown>>("/api/v1/analytics/summary", {
    query,
  });
}

const SEPTEMBER = { from: "2026-09-01", to: "2026-10-11", tz: "UTC" };

/** The T10-01 fixture (see the expected numbers in the test). */
function seedFunnelFixture(sqlite: Database, userId: string): void {
  new Story(sqlite, userId, { createdAt: d(9, 1) })
    .to("ready", d(9, 2))
    .to("applied", d(9, 3))
    .to("interviewing", d(9, 10))
    .to("offer", d(9, 20))
    .to("accepted", d(9, 25));
  new Story(sqlite, userId, { createdAt: d(9, 1) })
    .to("applied", d(9, 4))
    .to("offer", d(9, 15)); // skipped interviewing
  const reopened = new Story(sqlite, userId, { createdAt: d(9, 1) })
    .to("applied", d(9, 5))
    .to("rejected", d(9, 12))
    .to("saved", d(9, 13))
    .to("applied", d(9, 14));
  sqlite
    .query("UPDATE applications SET submission_status = ? WHERE id = ?")
    .run("submitted_unverified", reopened.id);
  new Story(sqlite, userId, { createdAt: d(9, 2) })
    .to("applied", d(9, 6))
    .to("interviewing", d(9, 8), { applied: false }); // stale: ignored
  new Story(sqlite, userId, { createdAt: d(9, 2) })
    .to("applied", d(9, 7))
    .interview(1, d(9, 9))
    .to("interviewing", d(9, 9))
    .to("rejected", d(9, 19));
  new Story(sqlite, userId, { createdAt: d(9, 3) })
    .to("ready", d(9, 4))
    .to("rejected", d(9, 5)); // before applying
  new Story(sqlite, userId, { createdAt: d(8, 1) })
    .to("applied", d(8, 2))
    .to("interviewing", d(9, 5)); // applied before the period
  new Story(sqlite, userId, { createdAt: d(9, 5) }).to("withdrawn", d(9, 6));
}

describe("GET /api/v1/analytics/summary (10 §2, §6)", () => {
  it("T10-01 funnel and cohort rates on a fixture event log (skipped stages, reopen, stale events)", async () => {
    seedFunnelFixture(f.t.jobsSqlite, f.alice.userId as string);
    const res = await summary(f.alice, SEPTEMBER);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    expect(AnalyticsSummaryResponseSchema.safeParse(res.body).success).toBe(
      true
    );
    const body = res.body as Record<string, unknown>;
    expect(body).toMatchObject({
      from: "2026-09-01",
      to: "2026-10-11",
      tz: "UTC",
      source: "live",
      cohort_size: 5,
      unconfirmed_count: 1,
      funnel: {
        tracked: 7,
        applied: 5,
        interviewing: 3,
        offer: 2,
        accepted: 1,
        rejected_total: 3,
        withdrawn_total: 1,
      },
      rejection_by_stage: {
        before_applying: 1,
        after_applying: 1,
        after_interview: [{ round: 1, count: 1 }],
        after_offer: 0,
      },
    });
    const rates = body.rates as Record<string, number>;
    expect(rates.response_rate).toBeCloseTo(0.8);
    expect(rates.interview_rate).toBeCloseTo(0.4);
    expect(rates.offer_rate).toBeCloseTo(0.4);
    expect(rates.acceptance_rate).toBeCloseTo(0.5);
    expect(rates.rejection_rate).toBeCloseTo(0.4);
    expect(rates.ghosting_rate).toBeCloseTo(0.2);
    const time = body.time_metrics as Record<string, unknown>;
    expect(time.time_to_first_response).toEqual({
      median: 7 * DAY,
      p75: 8 * DAY,
      n: 4,
    });
    expect(time.time_to_offer).toEqual({
      median: 14 * DAY,
      p75: 15.5 * DAY,
      n: 2,
    });
  });

  it("T10-02 rates are null below a cohort of 5 while counts still show", async () => {
    const user = f.alice.userId as string;
    for (let i = 0; i < 4; i++) {
      new Story(f.t.jobsSqlite, user, { createdAt: d(9, 1) }).to(
        "applied",
        d(9, 2 + i)
      );
    }
    const res = await summary(f.alice, SEPTEMBER);
    expect(res.body).toMatchObject({ cohort_size: 4, rates: null });
    expect((res.body.funnel as Record<string, number>).applied).toBe(4);
  });

  it("T10-04 legacy-migrated applications are counted via legacy_status", async () => {
    const user = f.alice.userId as string;
    seedApp(f.t.jobsSqlite, user, {
      createdAt: d(10, 1),
      legacy: { status: "applied", updatedAt: d(9, 10) },
      submissionStatus: "submitted_verified",
    });
    seedApp(f.t.jobsSqlite, user, {
      createdAt: d(10, 1),
      legacy: { status: "offer", updatedAt: d(9, 12) },
      submissionStatus: "submitted_verified",
    });
    seedApp(f.t.jobsSqlite, user, {
      createdAt: d(10, 1),
      legacy: { status: "rejected", updatedAt: d(9, 14) },
      submissionStatus: "submitted_verified",
    });
    seedApp(f.t.jobsSqlite, user, {
      createdAt: d(10, 1),
      legacy: { status: "saved", updatedAt: d(9, 16) },
    });
    const res = await summary(f.alice, SEPTEMBER);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      cohort_size: 3,
      funnel: {
        tracked: 4,
        applied: 3,
        offer: 1,
        rejected_total: 1,
        interviewing: 0,
      },
      rejection_by_stage: { after_applying: 1 },
    });
    // A legacy row reaches its stage at the legacy updatedAt, not at the
    // migration: a September-only period still counts it.
    const september = await summary(f.alice, {
      from: "2026-09-01",
      to: "2026-09-30",
      tz: "UTC",
    });
    expect((september.body.funnel as Record<string, number>).applied).toBe(3);
  });

  it("uses the tz parameter for day boundaries and the user's zone by default", async () => {
    const user = f.alice.userId as string;
    // 2026-09-30 18:00 UTC = 2026-10-01 01:00 in Jakarta.
    new Story(f.t.jobsSqlite, user, { createdAt: d(9, 1) }).to(
      "applied",
      Date.UTC(2026, 8, 30, 18)
    );
    const october = { from: "2026-10-01", to: "2026-10-11" };
    const utc = await summary(f.alice, { ...october, tz: "UTC" });
    const jakarta = await summary(f.alice, { ...october, tz: "Asia/Jakarta" });
    expect(utc.body.cohort_size).toBe(0);
    expect(jakarta.body).toMatchObject({ cohort_size: 1, tz: "Asia/Jakarta" });
    setTimezone(f.t.jobsSqlite, user, "Asia/Jakarta");
    const byDefault = await summary(f.alice, october);
    expect(byDefault.body).toMatchObject({
      cohort_size: 1,
      tz: "Asia/Jakarta",
    });
    const bad = await summary(f.alice, { tz: "Not/AZone" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_request");
    const reversed = await summary(f.alice, {
      from: "2026-10-05",
      to: "2026-10-01",
    });
    expect(reversed.status).toBe(400);
  });

  it("reports automation reliability (10 §2.7)", async () => {
    const user = f.alice.userId as string;
    const app = new Story(f.t.jobsSqlite, user, {
      createdAt: d(9, 1),
    });
    const ok = seedFinishedTask(f.t.jobsSqlite, user, app.id, d(9, 3), {
      state: "submitted",
      verified: true,
    });
    seedFinishedTask(f.t.jobsSqlite, user, app.id, d(9, 4), {
      state: "submitted",
    });
    seedFinishedTask(f.t.jobsSqlite, user, app.id, d(9, 5), {
      state: "failed",
      errorClass: "captcha",
    });
    seedFinishedTask(f.t.jobsSqlite, user, app.id, d(9, 6), {
      state: "outcome_unknown",
      errorClass: "lease_expired",
    });
    seedFinishedTask(f.t.jobsSqlite, user, app.id, d(9, 7), {
      state: "cancelled",
    });
    insertEvent(f.t.jobsSqlite, user, app.id, d(9, 3) - 30 * 60_000, {
      type: "automation_task_paused",
      attemptId: ok.attemptId,
      taskId: ok.taskId,
      payload: { pause_reason: "login_required" },
    });
    const res = await summary(f.alice, SEPTEMBER);
    const automation = res.body.automation as Record<string, unknown>;
    expect(automation).toMatchObject({
      apply_tasks: {
        submitted: 2,
        failed: 1,
        cancelled: 1,
        outcome_unknown: 1,
        expired: 0,
      },
      failure_classes: { captcha: 1, lease_expired: 1 },
      pause_reasons: [{ reason: "login_required", count: 1 }],
    });
    expect(automation.apply_success_rate).toBeCloseTo(0.5);
    expect(automation.verified_ratio).toBeCloseTo(0.5);
    expect(automation.pause_rate).toBeCloseTo(0.2);
    expect(automation.median_attempt_duration).toEqual({
      median: HOUR,
      p75: HOUR,
      n: 5,
    });
    expect(automation.human_interventions_per_application).toBeCloseTo(0.5);
  });

  it("periods longer than 180 days read the daily rollup", async () => {
    const user = f.alice.userId as string;
    const insert = f.t.jobsSqlite.query(
      "INSERT INTO analytics_daily (user_id, day, metrics) VALUES (?, ?, ?)"
    );
    insert.run(
      user,
      "2026-02-03",
      JSON.stringify({
        tracked: 4,
        applied: 3,
        interviewing: 1,
        offers: 1,
        accepted: 0,
        rejected_apps: 1,
        responded: 2,
        withdrawn: 0,
        rejected: { applied: 1 },
        rejected_after_round: {},
        tasks: { submitted: 1, failed: 1, outcome_unknown: 0 },
        discovered: 10,
      })
    );
    insert.run(
      user,
      "2026-06-10",
      JSON.stringify({
        tracked: 2,
        applied: 2,
        interviewing: 1,
        responded: 1,
        rejected: { interviewing: 1 },
        rejected_after_round: { 2: 1 },
        rejected_apps: 1,
        ai_cost_micro_usd: 500,
      })
    );
    const res = await summary(f.alice, {
      from: "2026-01-01",
      to: "2026-10-11",
      tz: "UTC",
    });
    expect(res.status).toBe(200);
    expect(AnalyticsSummaryResponseSchema.safeParse(res.body).success).toBe(
      true
    );
    expect(res.body).toMatchObject({
      source: "rollup",
      cohort_size: 5,
      funnel: {
        tracked: 6,
        applied: 5,
        interviewing: 2,
        offer: 1,
        rejected_total: 2,
      },
      rejection_by_stage: {
        after_applying: 1,
        after_interview: [{ round: 2, count: 1 }],
      },
      automation: { apply_tasks: { submitted: 1, failed: 1 } },
    });
    expect(
      (res.body.rates as Record<string, number>).response_rate
    ).toBeCloseTo(0.6);
  });
});

describe("GET /api/v1/analytics/timeseries (10 §4)", () => {
  it("buckets analytics_daily by day, ISO week and month with zero fill", async () => {
    const user = f.alice.userId as string;
    const insert = f.t.jobsSqlite.query(
      "INSERT INTO analytics_daily (user_id, day, metrics) VALUES (?, ?, ?)"
    );
    insert.run(user, "2026-09-27", JSON.stringify({ applied: 1 })); // Sun
    insert.run(user, "2026-09-28", JSON.stringify({ applied: 2 })); // Mon
    insert.run(
      user,
      "2026-10-02",
      JSON.stringify({ applied: 3, rejected: { applied: 1, interviewing: 2 } })
    );
    insert.run(
      user,
      "2026-10-03",
      JSON.stringify({ ai_cost_micro_usd: 41_200 })
    );
    const week = await f.alice.get<Record<string, unknown>>(
      "/api/v1/analytics/timeseries",
      {
        query: {
          metric: "applied",
          interval: "week",
          from: "2026-09-21",
          to: "2026-10-11",
        },
      }
    );
    expect(week.status).toBe(200);
    expect(week.headers.get("Cache-Control")).toBe("private, max-age=60");
    expect(AnalyticsTimeseriesResponseSchema.safeParse(week.body).success).toBe(
      true
    );
    expect(week.body).toMatchObject({
      metric: "applied",
      interval: "week",
      tz: "UTC",
      points: [
        { bucket: "2026-09-21", value: 1 },
        { bucket: "2026-09-28", value: 5 },
        { bucket: "2026-10-05", value: 0 },
      ],
    });
    const rejected = await f.alice.get<Record<string, unknown>>(
      "/api/v1/analytics/timeseries",
      {
        query: {
          metric: "rejected",
          interval: "month",
          from: "2026-09-01",
          to: "2026-10-11",
        },
      }
    );
    expect(rejected.body.points).toEqual([
      { bucket: "2026-09-01", value: 0 },
      { bucket: "2026-10-01", value: 3 },
    ]);
    const days = await f.alice.get<Record<string, unknown>>(
      "/api/v1/analytics/timeseries",
      {
        query: {
          metric: "ai_cost",
          interval: "day",
          from: "2026-10-02",
          to: "2026-10-04",
        },
      }
    );
    expect(days.body.points).toEqual([
      { bucket: "2026-10-02", value: 0 },
      { bucket: "2026-10-03", value: 41_200 },
      { bucket: "2026-10-04", value: 0 },
    ]);
    const invalid = await f.alice.get("/api/v1/analytics/timeseries", {
      query: { metric: "salary" },
    });
    expect(invalid.status).toBe(400);
  });
});

describe("GET /api/v1/analytics/breakdown (10 §2.6)", () => {
  it("T10-09 score band uses the score in force when applied was recorded, not the latest", async () => {
    const sqlite = f.t.jobsSqlite;
    const user = f.alice.userId as string;
    const rescored = new Story(sqlite, user, { createdAt: d(9, 1) });
    seedScore(sqlite, user, rescored.postingId, 85, d(9, 2), 1);
    rescored.to("applied", d(9, 3));
    seedScore(sqlite, user, rescored.postingId, 40, d(9, 4), 2);
    const middling = new Story(sqlite, user, { createdAt: d(9, 1) });
    seedScore(sqlite, user, middling.postingId, 30, d(9, 1), 1);
    seedScore(sqlite, user, middling.postingId, 65, d(9, 2), 2);
    middling.to("applied", d(9, 5));
    const scoredLater = new Story(sqlite, user, { createdAt: d(9, 1) });
    scoredLater.to("applied", d(9, 6));
    seedScore(sqlite, user, scoredLater.postingId, 95, d(9, 7), 1);
    const res = await f.alice.get<{ rows: Record<string, unknown>[] }>(
      "/api/v1/analytics/breakdown",
      { query: { by: "score_band", ...SEPTEMBER } }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    expect(AnalyticsBreakdownResponseSchema.safeParse(res.body).success).toBe(
      true
    );
    const byKey = Object.fromEntries(
      res.body.rows.map((row) => [row.key, row.n])
    );
    expect(byKey).toEqual({ "80_plus": 1, "60_79": 1, unscored: 1 });
  });

  it("groups by mode at applying, method, CV variant, workplace and source", async () => {
    const sqlite = f.t.jobsSqlite;
    const user = f.alice.userId as string;
    sqlite
      .query(
        "INSERT INTO job_sources (id, user_id, adapter, label, config, created_at, updated_at) VALUES ('src_01JA6V8M3W8Z1T6Q4Y2B7K9C0D', ?, 'greenhouse', 'Acme careers', '{}', 0, 0)"
      )
      .run(user);
    sqlite
      .query(
        "INSERT INTO cv_variants (id, user_id, base_cv_id, template, status, created_at, updated_at) VALUES ('cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0D', ?, 'cv-1', 'harvard', 'approved', 0, 0)"
      )
      .run(user);
    new Story(sqlite, user, {
      createdAt: d(9, 1),
      mode: "approval",
      sourceId: "src_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
      cvVariantId: "cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
      submissionMethod: "email",
      posting: { workplace_type: "remote" },
    }).to("applied", d(9, 2));
    const manual = new Story(sqlite, user, {
      createdAt: d(9, 1),
      mode: "manual",
      posting: { source_kind: "manual", workplace_type: "onsite" },
    }).to("applied", d(9, 3));
    // The mode changed after applying: the breakdown keeps "manual".
    sqlite
      .query("UPDATE applications SET mode = 'auto' WHERE id = ?")
      .run(manual.id);
    const rows = async (by: string) => {
      const res = await f.alice.get<{ rows: Record<string, unknown>[] }>(
        "/api/v1/analytics/breakdown",
        { query: { by, ...SEPTEMBER } }
      );
      expect(res.status).toBe(200);
      return Object.fromEntries(
        res.body.rows.map((row) => [row.key, row.label])
      );
    };
    expect(await rows("mode")).toEqual({
      approval: "Approval",
      manual: "Manual",
    });
    expect(await rows("method")).toEqual({
      email: "Email",
      unknown: "Unknown",
    });
    expect(await rows("cv_variant")).toEqual({
      "tailored:harvard": "Tailored CV (Harvard)",
      base: "Base CV",
    });
    expect(await rows("workplace_type")).toEqual({
      remote: "Remote",
      onsite: "On-site",
    });
    expect(await rows("source")).toEqual({
      src_01JA6V8M3W8Z1T6Q4Y2B7K9C0D: "Acme careers",
      manual: "Added manually",
    });
  });

  it("keeps the top 20 companies and folds the rest into Other; rates need n ≥ 5", async () => {
    const sqlite = f.t.jobsSqlite;
    const user = f.alice.userId as string;
    for (let i = 0; i < 5; i++) {
      const story = new Story(sqlite, user, {
        createdAt: d(9, 1),
        posting: { company_name: "Big Co" },
      }).to("applied", d(9, 2, i));
      if (i < 2) {
        story.to("interviewing", d(9, 10, i));
      }
    }
    for (let i = 0; i < 22; i++) {
      new Story(sqlite, user, {
        createdAt: d(9, 1),
        posting: { company_name: `Company ${String(i).padStart(2, "0")}` },
      }).to("applied", d(9, 3, i % 20));
    }
    const res = await f.alice.get<{ rows: Record<string, unknown>[] }>(
      "/api/v1/analytics/breakdown",
      { query: { by: "company", ...SEPTEMBER } }
    );
    expect(res.body.rows).toHaveLength(21);
    expect(res.body.rows[0]).toMatchObject({
      key: "big co",
      label: "Big Co",
      applied: 5,
      n: 5,
      interview_rate: 0.4,
      offer_rate: 0,
      rejection_rate: 0,
    });
    expect(res.body.rows[1]?.interview_rate).toBeNull();
    expect(res.body.rows.at(-1)).toMatchObject({
      key: "other",
      label: "Other",
      n: 3,
    });
  });
});

describe("analytics isolation and scopes (10 §7, 11 §6.1)", () => {
  it("T10-08 every analytics endpoint answers only from the caller's own data", async () => {
    const sqlite = f.t.jobsSqlite;
    const aliceId = f.alice.userId as string;
    const bobId = f.bob.userId as string;
    seedFunnelFixture(sqlite, aliceId);
    new Story(sqlite, bobId, {
      createdAt: d(9, 1),
      posting: { company_name: "Bob Inc" },
    }).to("applied", d(9, 2));
    const insert = sqlite.query(
      "INSERT INTO analytics_daily (user_id, day, metrics) VALUES (?, ?, ?)"
    );
    insert.run(aliceId, "2026-09-10", JSON.stringify({ applied: 7 }));
    insert.run(bobId, "2026-09-10", JSON.stringify({ applied: 1 }));
    const aliceSummary = await summary(f.alice, SEPTEMBER);
    const bobSummary = await summary(f.bob, SEPTEMBER);
    expect(aliceSummary.body.cohort_size).toBe(5);
    expect(bobSummary.body).toMatchObject({
      cohort_size: 1,
      funnel: { tracked: 1, applied: 1, interviewing: 0 },
    });
    const series = await f.bob.get<{ points: Array<{ value: number }> }>(
      "/api/v1/analytics/timeseries",
      { query: { metric: "applied", interval: "month", ...SEPTEMBER } }
    );
    expect(series.body.points.reduce((sum, p) => sum + p.value, 0)).toBe(1);
    const companies = await f.bob.get<{ rows: Array<{ label: string }> }>(
      "/api/v1/analytics/breakdown",
      { query: { by: "company", ...SEPTEMBER } }
    );
    expect(companies.body.rows.map((row) => row.label)).toEqual(["Bob Inc"]);
    // A stranger sees nothing at all.
    const carol = await f.client.browserSession("carol@example.com");
    const empty = await summary(carol, SEPTEMBER);
    expect(empty.body).toMatchObject({
      cohort_size: 0,
      funnel: { tracked: 0, applied: 0 },
      rates: null,
    });
  });

  it("needs jobs:read: read tokens pass, anonymous callers do not", async () => {
    const reader = await f.client.personalToken("alice@example.com", "read");
    expect((await summary(reader, SEPTEMBER)).status).toBe(200);
    const anonymous = f.client.anonymous();
    const res = await summary(anonymous, SEPTEMBER);
    expect(res.status).toBe(401);
  });
});
