// S-27: the summary endpoint equals a naive recomputation from the raw event
// log (straight from the 10 §2 definitions) for three seeded users, and no
// user's numbers move when another user's data changes.

import { describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { AnalyticsSummaryResponseSchema } from "@pilihpendidikan/jobs-contracts/api";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import { DAY, Story } from "../../services/analytics/support.test";

const NOW = Date.UTC(2026, 9, 12);
const START = Date.UTC(2026, 5, 1);

/** Deterministic PRNG (Park–Miller minimal standard). */
function prng(seed: number): () => number {
  let state = (seed % 2_147_483_646) + 1;
  return () => {
    state = (state * 48_271) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
}

interface Walker {
  next(): number;
  pick<T>(items: readonly T[]): T;
  rand(): number;
  story: Story;
}

/** After interviewing: maybe rejected, maybe nothing, maybe an offer. */
function interviewOutcome(w: Walker): boolean {
  w.story.interview(1, w.next()).to("interviewing", w.next());
  if (w.rand() < 0.4) {
    w.story.to("rejected", w.next());
    return false;
  }
  if (w.rand() < 0.5) {
    return false;
  }
  w.story.to("offer", w.next());
  return true;
}

/** After an offer: accepted, rejected, withdrawn or pending. */
function offerOutcome(w: Walker): void {
  const end = w.rand();
  if (end < 0.4) {
    w.story.to("accepted", w.next());
  } else if (end < 0.7) {
    w.story.to("rejected", w.next());
  } else if (end < 0.8) {
    w.story.to("withdrawn", w.next());
  }
}

/** The employer's side after applying. */
function afterApplying(w: Walker): void {
  const outcome = w.rand();
  if (outcome < 0.25) {
    return; // no answer
  }
  if (outcome < 0.45) {
    w.story.to("rejected", w.next());
    if (w.rand() < 0.4) {
      w.story.to("saved", w.next()).to("applied", w.next()); // reopen
    }
    return;
  }
  if (outcome < 0.55) {
    w.story.to("offer", w.next()); // offer without interviews
    offerOutcome(w);
    return;
  }
  if (interviewOutcome(w)) {
    offerOutcome(w);
  }
}

/** One application with a random but legal history (03 §5.1). */
function walkOne(w: Walker): void {
  if (w.rand() < 0.15) {
    return; // stays saved
  }
  if (w.rand() < 0.5) {
    w.story.to("preparing", w.next()).to("ready", w.next());
  }
  if (w.rand() < 0.12) {
    w.story.to(w.pick(["rejected", "withdrawn"]), w.next());
    return;
  }
  if (w.rand() < 0.1) {
    return; // prepared, never applied
  }
  const appliedAt = w.next();
  w.story.to("applied", appliedAt);
  w.story.submission(
    w.rand() < 0.3 ? "submitted_unverified" : "submitted_verified",
    appliedAt
  );
  if (w.rand() < 0.15) {
    w.story.to("offer", w.next(), { applied: false }); // stale: ignored
  }
  afterApplying(w);
}

function seedUser(sqlite: Database, userId: string, seed: number): void {
  const rand = prng(seed);
  for (let i = 0; i < 30; i++) {
    let at = START + Math.floor(rand() * 110) * DAY;
    const story = new Story(sqlite, userId, {
      createdAt: at,
      mode: ["manual", "approval", "assisted"][Math.floor(rand() * 3)],
    });
    walkOne({
      story,
      rand,
      pick: (items) => items[Math.floor(rand() * items.length)] as never,
      next: () => {
        at += Math.floor(1 + rand() * 9) * DAY + Math.floor(rand() * DAY);
        return at;
      },
    });
  }
}

interface RawEvent {
  application_id: string;
  from_value: string | null;
  recorded_at: number;
  to_value: string | null;
  type: string;
}

/** The 10 §2 numbers, computed naively from SQL rows. */
function recompute(
  sqlite: Database,
  userId: string,
  fromMs: number,
  toMs: number
) {
  const events = sqlite
    .query(
      "SELECT application_id, type, from_value, to_value, recorded_at FROM application_events WHERE user_id = ? AND applied_to_state = 1 AND type IN ('created', 'stage_changed') ORDER BY recorded_at, id"
    )
    .all(userId) as RawEvent[];
  const apps = sqlite
    .query(
      "SELECT id, created_at, submission_status FROM applications WHERE user_id = ?"
    )
    .all(userId) as Array<{
    created_at: number;
    id: string;
    submission_status: string;
  }>;
  const firsts = new Map<string, Map<string, number>>();
  const rejections: RawEvent[] = [];
  for (const event of events) {
    const map = firsts.get(event.application_id) ?? new Map<string, number>();
    firsts.set(event.application_id, map);
    if (event.to_value && !map.has(event.to_value)) {
      map.set(event.to_value, event.recorded_at);
    }
    if (event.type === "stage_changed" && event.to_value === "rejected") {
      rejections.push(event);
    }
  }
  const inPeriod = (at: number | undefined) =>
    at !== undefined && at >= fromMs && at < toMs;
  const reached = (app: string, stage: string) => firsts.get(app)?.get(stage);
  const count = (stage: string) =>
    apps.filter((app) => inPeriod(reached(app.id, stage))).length;
  const cohort = apps.filter((app) => inPeriod(reached(app.id, "applied")));
  const responded = (app: string) =>
    reached(app, "interviewing") !== undefined ||
    reached(app, "offer") !== undefined ||
    rejections.some(
      (event) =>
        event.application_id === app &&
        ["applied", "interviewing", "offer"].includes(event.from_value ?? "")
    );
  const share = (test: (id: string) => boolean) =>
    cohort.filter((app) => test(app.id)).length / cohort.length;
  const offers = cohort.filter((app) => reached(app.id, "offer") !== undefined);
  const older = cohort.filter(
    (app) => NOW - (reached(app.id, "applied") as number) > 30 * DAY
  );
  const periodRejections = rejections.filter((event) =>
    inPeriod(event.recorded_at)
  );
  const from = (stages: string[]) =>
    periodRejections.filter((event) => stages.includes(event.from_value ?? ""))
      .length;
  return {
    cohort_size: cohort.length,
    unconfirmed_count: cohort.filter(
      (app) => app.submission_status === "submitted_unverified"
    ).length,
    funnel: {
      tracked: apps.filter((app) => inPeriod(app.created_at)).length,
      applied: count("applied"),
      interviewing: count("interviewing"),
      offer: count("offer"),
      accepted: count("accepted"),
      rejected_total: count("rejected"),
      withdrawn_total: count("withdrawn"),
    },
    rates:
      cohort.length < 5
        ? null
        : {
            response_rate: share(responded),
            interview_rate: share(
              (id) => reached(id, "interviewing") !== undefined
            ),
            offer_rate: share((id) => reached(id, "offer") !== undefined),
            acceptance_rate:
              offers.length === 0
                ? null
                : offers.filter(
                    (app) => reached(app.id, "accepted") !== undefined
                  ).length / offers.length,
            rejection_rate: share(
              (id) => reached(id, "rejected") !== undefined
            ),
            ghosting_rate:
              older.length === 0
                ? null
                : older.filter((app) => !responded(app.id)).length /
                  older.length,
          },
    rejection_by_stage: {
      before_applying: from(["saved", "preparing", "ready"]),
      after_applying: from(["applied"]),
      after_interview: from(["interviewing"]),
      after_offer: from(["offer"]),
    },
  };
}

type Expected = ReturnType<typeof recompute>;

function expectRates(
  actual: Record<string, number | null> | null,
  expected: Expected["rates"]
): void {
  if (expected === null) {
    expect(actual).toBeNull();
    return;
  }
  for (const [name, value] of Object.entries(expected)) {
    if (value === null) {
      expect(actual?.[name]).toBeNull();
    } else {
      expect(actual?.[name] as number).toBeCloseTo(value, 10);
    }
  }
}

function expectSummary(raw: unknown, expected: Expected): void {
  const body = raw as Record<string, unknown> & {
    rates: Record<string, number | null> | null;
    rejection_by_stage: {
      after_interview: Array<{ count: number }>;
    } & Record<string, unknown>;
  };
  expect(body.cohort_size).toBe(expected.cohort_size);
  expect(body.unconfirmed_count).toBe(expected.unconfirmed_count);
  expect(body.funnel).toEqual(expected.funnel);
  const rejections = body.rejection_by_stage;
  expect({
    before_applying: rejections.before_applying,
    after_applying: rejections.after_applying,
    after_interview: rejections.after_interview.reduce(
      (sum, row) => sum + row.count,
      0
    ),
    after_offer: rejections.after_offer,
  }).toEqual(expected.rejection_by_stage);
  expectRates(body.rates, expected.rates);
}

describe("S-27 analytics correctness", () => {
  it("S-27 the summary equals a raw-event recomputation for 3 seeded users", async () => {
    const t = createTestEnv();
    const client = createV1Client(t, { clock: createFakeClock(NOW) });
    const sessions = await Promise.all(
      ["ana@example.com", "budi@example.com", "citra@example.com"].map(
        (email) => client.browserSession(email)
      )
    );
    sessions.forEach((session, index) => {
      t.jobsSqlite
        .query(
          "INSERT INTO user_settings (user_id, timezone, updated_at) VALUES (?, 'UTC', 0)"
        )
        .run(session.userId);
      seedUser(t.jobsSqlite, session.userId as string, 1000 + index * 77);
    });
    const periods = [
      { from: "2026-06-01", to: "2026-10-11" },
      { from: "2026-08-01", to: "2026-08-31" },
      { from: "2026-07-15", to: "2026-09-30" },
    ];
    let compared = 0;
    for (const session of sessions) {
      for (const period of periods) {
        const res = await session.get<Record<string, unknown>>(
          "/api/v1/analytics/summary",
          { query: { ...period, tz: "UTC" } }
        );
        expect(res.status).toBe(200);
        expect(AnalyticsSummaryResponseSchema.safeParse(res.body).success).toBe(
          true
        );
        const fromMs = Date.parse(`${period.from}T00:00:00Z`);
        const toMs = Date.parse(`${period.to}T00:00:00Z`) + DAY;
        const expected = recompute(
          t.jobsSqlite,
          session.userId as string,
          fromMs,
          toMs
        );
        expectSummary(res.body, expected);
        compared += 1;
      }
    }
    expect(compared).toBe(9);
    // Enough signal: the seeded users have real cohorts.
    const big = await sessions[0]?.get<Record<string, number>>(
      "/api/v1/analytics/summary",
      { query: { ...periods[0], tz: "UTC" } }
    );
    expect(big?.body.cohort_size).toBeGreaterThanOrEqual(5);
  });
});
