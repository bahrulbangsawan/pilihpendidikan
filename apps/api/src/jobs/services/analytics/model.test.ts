import { describe, expect, it } from "bun:test";
import type {
  ApplicationFactRow,
  StageEventRow,
  TimelineData,
} from "../../repo/analytics";
import { buildTimelines, firstResponseAt, responded } from "./model";
import { durationStat, quantile, ratio, showsRates } from "./stats";
import { cohortRates, rejectionByStage, timeMetrics } from "./summary";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 1);

function appRow(id: string, overrides: Partial<ApplicationFactRow> = {}) {
  return {
    id,
    created_at: T0,
    updated_at: T0,
    stage: "saved",
    submission_status: "not_started",
    submission_method: null,
    mode: "manual",
    cv_variant_id: null,
    legacy_job_id: null,
    follow_up_at: null,
    archived: 0,
    posting_id: `pst_${id}`,
    source_id: null,
    ...overrides,
  } satisfies ApplicationFactRow;
}

let seq = 0;
function event(
  applicationId: string,
  type: StageEventRow["type"],
  at: number,
  fields: Partial<StageEventRow> = {}
): StageEventRow {
  seq += 1;
  return {
    id: `evt_${String(seq).padStart(26, "0")}`,
    application_id: applicationId,
    type,
    from_value: null,
    to_value: null,
    recorded_at: at,
    occurred_at: at,
    legacy_status: null,
    legacy_updated_at: null,
    mode: null,
    payload_stage: null,
    ...fields,
  };
}

/** One application walking through `path` (one stage per day). */
function walk(
  id: string,
  path: [string, number][],
  options: { mode?: string; start?: number } = {}
): { app: ApplicationFactRow; events: StageEventRow[] } {
  const start = options.start ?? T0;
  const events: StageEventRow[] = [
    event(id, "created", start, { to_value: "saved", payload_stage: "saved" }),
  ];
  let from = "saved";
  for (const [to, at] of path) {
    events.push(
      event(id, "stage_changed", at, {
        from_value: from,
        to_value: to,
        mode: options.mode ?? null,
      })
    );
    from = to;
  }
  return {
    app: appRow(id, { created_at: start, stage: from, mode: "auto" }),
    events,
  };
}

function data(
  parts: Array<{ app: ApplicationFactRow; events: StageEventRow[] }>,
  interviews: TimelineData["interviews"] = []
): TimelineData {
  return {
    applications: parts.map((part) => part.app),
    stageEvents: parts.flatMap((part) => part.events),
    interviews,
  };
}

describe("analytics timelines (10 §2)", () => {
  it("T10-01 reached semantics: skipped stages and reopen (unit)", () => {
    const skipped = walk("app_a", [
      ["applied", T0 + DAY],
      ["offer", T0 + 5 * DAY],
    ]);
    const reopened = walk("app_b", [
      ["applied", T0 + DAY],
      ["rejected", T0 + 3 * DAY],
      ["saved", T0 + 4 * DAY],
      ["applied", T0 + 6 * DAY],
    ]);
    const [a, b] = buildTimelines(data([skipped, reopened]));
    expect(a?.firsts.offer).toBe(T0 + 5 * DAY);
    expect(a?.firsts.interviewing).toBeUndefined();
    expect(responded(a as never)).toBe(true);
    expect(firstResponseAt(a as never)).toBe(T0 + 5 * DAY);
    // The first applied counts; the rejection came after applying.
    expect(b?.firsts.applied).toBe(T0 + DAY);
    expect(b?.rejections).toEqual([
      { at: T0 + 3 * DAY, from: "applied", round: null },
    ]);
    expect(b?.visits.map((visit) => visit.stage)).toEqual([
      "saved",
      "applied",
      "rejected",
      "saved",
      "applied",
    ]);
    expect(b?.visits.at(-1)?.exit).toBeNull();
  });

  it("T10-04 legacy rows reach their legacy_status at the legacy updatedAt", () => {
    const updatedAt = T0 - 40 * DAY;
    const legacyApp = {
      app: appRow("app_l", {
        legacy_job_id: "job-1",
        stage: "interviewing",
        submission_status: "submitted_verified",
        updated_at: T0,
      }),
      events: [
        event("app_l", "created", T0, {
          to_value: "interviewing",
          legacy_status: "interviewing",
          occurred_at: updatedAt,
        }),
        event("app_l", "legacy_imported", T0, {
          legacy_status: "interviewing",
          legacy_updated_at: updatedAt,
        }),
      ],
    };
    const rejectedLegacy = {
      app: appRow("app_r", {
        legacy_job_id: "job-2",
        stage: "rejected",
        submission_status: "submitted_verified",
      }),
      events: [
        event("app_r", "legacy_imported", T0, {
          legacy_status: "rejected",
          legacy_updated_at: updatedAt,
        }),
      ],
    };
    const [l, r] = buildTimelines(data([legacyApp, rejectedLegacy]));
    expect(l?.legacy).toBe(true);
    expect(l?.firsts.interviewing).toBe(updatedAt);
    // submitted_verified on a migrated row = applied (10 §2.1).
    expect(l?.firsts.applied).toBe(updatedAt);
    expect(r?.firsts.rejected).toBe(updatedAt);
    expect(r?.rejections).toEqual([
      { at: updatedAt, from: "legacy", round: null },
    ]);
    expect(responded(r as never)).toBe(true);
  });

  it("mode at the time of applying comes from the stage event, the current mode otherwise", () => {
    const fromEvent = walk("app_m", [["applied", T0 + DAY]], {
      mode: "approval",
    });
    const older = walk("app_o", [["applied", T0 + DAY]]);
    const [m, o] = buildTimelines(data([fromEvent, older]));
    expect(m?.modeAtApplied).toBe("approval");
    expect(o?.modeAtApplied).toBe("auto");
  });

  it("a rejection after interviewing carries the latest round recorded before it", () => {
    const story = walk("app_i", [
      ["applied", T0 + DAY],
      ["interviewing", T0 + 3 * DAY],
      ["rejected", T0 + 9 * DAY],
    ]);
    const interviews = [
      { application_id: "app_i", round: 1, created_at: T0 + 3 * DAY },
      { application_id: "app_i", round: 2, created_at: T0 + 6 * DAY },
      { application_id: "app_i", round: 3, created_at: T0 + 10 * DAY },
    ];
    const timelines = buildTimelines(data([story], interviews));
    expect(timelines[0]?.rejections[0]).toEqual({
      at: T0 + 9 * DAY,
      from: "interviewing",
      round: 2,
    });
    expect(
      rejectionByStage(timelines, { fromMs: T0, toMs: T0 + 30 * DAY })
    ).toEqual({
      before_applying: 0,
      after_applying: 0,
      after_interview: [{ round: 2, count: 1 }],
      after_offer: 0,
    });
  });
});

describe("analytics statistics (10 §2.2, §2.4)", () => {
  it("T10-02 rates are hidden while the cohort is smaller than 5", () => {
    const four = [1, 2, 3, 4].map((n) =>
      walk(`app_${n}`, [["applied", T0 + n * DAY]])
    );
    const timelines = buildTimelines(data(four));
    expect(showsRates(4)).toBe(false);
    expect(cohortRates(timelines, T0 + 60 * DAY)).toBeNull();
    const five = buildTimelines(
      data([...four, walk("app_5", [["applied", T0 + 5 * DAY]])])
    );
    const rates = cohortRates(five, T0 + 60 * DAY);
    expect(rates).not.toBeNull();
    expect(rates?.response_rate).toBe(0);
    // Everyone is older than 30 days without a response: all ghosted.
    expect(rates?.ghosting_rate).toBe(1);
    expect(rates?.acceptance_rate).toBeNull();
  });

  it("T10-03 medians and P75 with open visits and unmatched responses", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(quantile([], 0.5)).toBeNull();
    expect(durationStat([])).toEqual({ median: null, p75: null, n: 0 });
    expect(durationStat([5, -1, Number.NaN, 1])).toEqual({
      median: 3,
      p75: 4,
      n: 2,
    });
    expect(ratio(1, 0)).toBeNull();
    // Responses after 2, 4 and 10 days; one application never answered.
    const cohort = [
      walk("app_r1", [
        ["applied", T0],
        ["interviewing", T0 + 2 * DAY],
      ]),
      walk("app_r2", [
        ["applied", T0],
        ["rejected", T0 + 4 * DAY],
      ]),
      walk("app_r3", [
        ["applied", T0],
        ["offer", T0 + 10 * DAY],
      ]),
      walk("app_r4", [["applied", T0]]),
    ];
    const timelines = buildTimelines(data(cohort));
    const now = T0 + 20 * DAY;
    const period = { fromMs: T0 - DAY, toMs: T0 + DAY };
    const metrics = timeMetrics(timelines, timelines, period, now);
    expect(metrics.time_to_first_response).toEqual({
      median: 4 * DAY,
      p75: 7 * DAY,
      n: 3,
    });
    expect(metrics.time_to_interview).toEqual({
      median: 2 * DAY,
      p75: 2 * DAY,
      n: 1,
    });
    expect(metrics.time_to_offer.n).toBe(1);
    // Stays entered in the period: the open `applied` stay of app_r4 is
    // "currently in stage" (now − entered), never mixed with closed ones.
    const applied = metrics.time_in_stage.applied;
    expect(applied?.closed).toEqual({ median: 4 * DAY, p75: 7 * DAY, n: 3 });
    expect(applied?.open).toEqual({ median: 20 * DAY, p75: 20 * DAY, n: 1 });
    // Terminal stages have no "currently in" figure.
    expect(metrics.time_in_stage.rejected).toBeUndefined();
  });
});
