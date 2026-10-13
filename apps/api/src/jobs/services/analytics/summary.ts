// `GET /api/v1/analytics/summary` (10 §2, §6): funnel, cohort rates,
// rejection by stage, time metrics, volume and automation reliability.
//
// Live mode (periods ≤ 180 days) computes from events + rows; longer periods
// read the daily rollup (`summaryFromRollups`, 10 §4). Both report the same
// funnel; the rollup cannot rebuild per-application cohorts, so its rates are
// period ratios (`interviewing in period / applied in period`, capped at 1)
// and its time metrics are empty (`n = 0`). `source` says which one answered.

import type { AnalyticsSummaryResponse } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { STAGES } from "@pilihpendidikan/jobs-contracts/enums";
import { DAY_MS, localDay } from "../../core/clock";
import type { AnalyticsData, DailyRow } from "../../repo/analytics";
import type { AppTimeline } from "./model";
import {
  firstResponseAt,
  isTerminal,
  rejectionBucket,
  responded,
} from "./model";
import type { DurationStat } from "./stats";
import { durationStat, ratio, showsRates } from "./stats";
import type { Period } from "./time";
import { addDays, inPeriod, isoWeekStart } from "./time";

/** Cohort members older than this without a response count as ghosted. */
export const GHOSTING_AFTER_MS = 30 * DAY_MS;

export type ApplyTerminalState =
  | "submitted"
  | "failed"
  | "cancelled"
  | "outcome_unknown"
  | "expired";

const APPLY_TERMINAL: readonly ApplyTerminalState[] = [
  "submitted",
  "failed",
  "cancelled",
  "outcome_unknown",
  "expired",
];

export interface StageTimes {
  /** Finished stays (entered in the period). */
  closed: DurationStat;
  /** Stays still open now ("currently in stage"); non-terminal stages only. */
  open: DurationStat;
}

export interface SummaryExtras {
  automation: AnalyticsSummaryResponse["automation"] & {
    human_interventions_per_application: number | null;
    median_attempt_duration: DurationStat;
    pause_reasons: Array<{ count: number; reason: string }>;
  };
  source: "live" | "rollup";
  time_metrics: AnalyticsSummaryResponse["time_metrics"] & {
    time_in_stage: Partial<Record<Stage, StageTimes>>;
  };
  volume: {
    applications_per_week: Array<{ bucket: string; value: number }>;
    discovered: number;
    follow_ups_completed: number;
    follow_ups_due: number;
    tracked: number;
  };
}

/** The summary body: the contract shape plus additive fields. */
export type SummaryBody = Omit<
  AnalyticsSummaryResponse,
  "automation" | "time_metrics"
> &
  SummaryExtras;

type Funnel = AnalyticsSummaryResponse["funnel"];
type Rates = NonNullable<AnalyticsSummaryResponse["rates"]>;
type RejectionByStage = AnalyticsSummaryResponse["rejection_by_stage"];

function emptyDuration(): DurationStat {
  return { median: null, p75: null, n: 0 };
}

/** Cohort rates (10 §2.2); null below 5 applications. */
export function cohortRates(
  cohort: readonly AppTimeline[],
  now: number
): Rates | null {
  if (!showsRates(cohort.length)) {
    return null;
  }
  const size = cohort.length;
  const count = (test: (t: AppTimeline) => boolean) =>
    cohort.filter(test).length;
  const offers = count((t) => t.firsts.offer !== undefined);
  const older = cohort.filter(
    (t) => now - (t.firsts.applied as number) > GHOSTING_AFTER_MS
  );
  return {
    response_rate: ratio(count(responded), size) ?? 0,
    interview_rate:
      ratio(
        count((t) => t.firsts.interviewing !== undefined),
        size
      ) ?? 0,
    offer_rate: ratio(offers, size) ?? 0,
    acceptance_rate: ratio(
      count(
        (t) => t.firsts.offer !== undefined && t.firsts.accepted !== undefined
      ),
      offers
    ),
    rejection_rate:
      ratio(
        count((t) => t.firsts.rejected !== undefined),
        size
      ) ?? 0,
    ghosting_rate: ratio(
      older.filter((t) => !responded(t)).length,
      older.length
    ),
  };
}

function emptyRejections(): RejectionByStage {
  return {
    before_applying: 0,
    after_applying: 0,
    after_interview: [],
    after_offer: 0,
  };
}

function addRejection(
  out: RejectionByStage,
  rounds: Map<number, number>,
  bucket: ReturnType<typeof rejectionBucket>,
  round: number | null,
  count = 1
): void {
  switch (bucket) {
    case "before_applying":
      out.before_applying += count;
      break;
    case "after_applying":
      out.after_applying += count;
      break;
    case "after_offer":
      out.after_offer += count;
      break;
    case "after_interview": {
      const key = round ?? 1;
      rounds.set(key, (rounds.get(key) ?? 0) + count);
      break;
    }
    default:
      break;
  }
}

function finishRounds(
  out: RejectionByStage,
  rounds: Map<number, number>
): RejectionByStage {
  out.after_interview = [...rounds.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, count]) => ({ round, count }));
  return out;
}

/** 10 §2.3 over the rejections recorded in the period. */
export function rejectionByStage(
  timelines: readonly AppTimeline[],
  period: Pick<Period, "fromMs" | "toMs">
): RejectionByStage {
  const out = emptyRejections();
  const rounds = new Map<number, number>();
  for (const timeline of timelines) {
    for (const rejection of timeline.rejections) {
      if (inPeriod(period, rejection.at)) {
        addRejection(
          out,
          rounds,
          rejectionBucket(rejection.from),
          rejection.round
        );
      }
    }
  }
  return finishRounds(out, rounds);
}

function durationsSince(
  cohort: readonly AppTimeline[],
  stage: "interviewing" | "offer"
): number[] {
  const out: number[] = [];
  for (const timeline of cohort) {
    const applied = timeline.firsts.applied as number;
    const at = timeline.firsts[stage];
    if (at !== undefined && at > applied) {
      out.push(at - applied);
    }
  }
  return out;
}

/** Time in each stage (10 §2.4): stays entered in the period. */
export function timeInStage(
  timelines: readonly AppTimeline[],
  period: Pick<Period, "fromMs" | "toMs">,
  now: number
): Partial<Record<Stage, StageTimes>> {
  const closed = new Map<Stage, number[]>();
  const open = new Map<Stage, number[]>();
  for (const timeline of timelines) {
    for (const visit of timeline.visits) {
      if (!inPeriod(period, visit.enter)) {
        continue;
      }
      if (visit.exit !== null) {
        const list = closed.get(visit.stage) ?? [];
        list.push(visit.exit - visit.enter);
        closed.set(visit.stage, list);
      } else if (!isTerminal(visit.stage)) {
        const list = open.get(visit.stage) ?? [];
        list.push(now - visit.enter);
        open.set(visit.stage, list);
      }
    }
  }
  const out: Partial<Record<Stage, StageTimes>> = {};
  for (const stage of STAGES) {
    if (closed.has(stage) || open.has(stage)) {
      out[stage] = {
        closed: durationStat(closed.get(stage) ?? []),
        open: durationStat(open.get(stage) ?? []),
      };
    }
  }
  return out;
}

/** Time metrics of 10 §2.4 (cohort-based; responses after applying). */
export function timeMetrics(
  timelines: readonly AppTimeline[],
  cohort: readonly AppTimeline[],
  period: Pick<Period, "fromMs" | "toMs">,
  now: number
): SummaryExtras["time_metrics"] {
  const firstResponse: number[] = [];
  for (const timeline of cohort) {
    const at = firstResponseAt(timeline);
    if (at !== null) {
      firstResponse.push(at - (timeline.firsts.applied as number));
    }
  }
  const prep: number[] = [];
  for (const timeline of timelines) {
    const ready = timeline.firsts.ready;
    if (ready !== undefined && inPeriod(period, ready)) {
      prep.push(ready - timeline.createdAt);
    }
  }
  return {
    time_to_first_response: durationStat(firstResponse),
    time_to_interview: durationStat(durationsSince(cohort, "interviewing")),
    time_to_offer: durationStat(durationsSince(cohort, "offer")),
    prep_time: durationStat(prep),
    time_in_stage: timeInStage(timelines, period, now),
  };
}

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

/** Automation reliability (10 §2.7) over the period's apply tasks. */
export function automationStats(
  data: Pick<
    AnalyticsData,
    "tasks" | "attempts" | "activity" | "answerApprovals"
  >
): SummaryExtras["automation"] {
  const applyTasks = {
    submitted: 0,
    failed: 0,
    cancelled: 0,
    outcome_unknown: 0,
    expired: 0,
  };
  let verified = 0;
  const failures: string[] = [];
  for (const task of data.tasks) {
    if (!(APPLY_TERMINAL as readonly string[]).includes(task.state)) {
      continue;
    }
    applyTasks[task.state as ApplyTerminalState] += 1;
    if (task.state === "submitted" && task.verified) {
      verified += 1;
    }
    if (task.state !== "submitted" && task.error_class) {
      failures.push(task.error_class);
    }
  }
  const pauses = data.activity.filter(
    (event) => event.type === "automation_task_paused"
  );
  const reasons = countBy(
    pauses.map((event) => event.pause_reason ?? "unknown")
  );
  const durations = data.attempts
    .filter((attempt) => attempt.ended_at !== null)
    .map((attempt) => (attempt.ended_at as number) - attempt.started_at);
  return {
    apply_tasks: applyTasks,
    apply_success_rate: ratio(
      applyTasks.submitted,
      applyTasks.submitted + applyTasks.failed + applyTasks.outcome_unknown
    ),
    verified_ratio: ratio(verified, applyTasks.submitted),
    pause_rate: ratio(
      data.attempts.filter((attempt) => attempt.paused).length,
      data.attempts.length
    ),
    failure_classes: countBy(failures),
    pause_reasons: Object.entries(reasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1)),
    median_attempt_duration: durationStat(durations),
    human_interventions_per_application:
      applyTasks.submitted > 0
        ? (pauses.length + data.answerApprovals.length) / applyTasks.submitted
        : null,
  };
}

/** Weekly buckets (ISO weeks, Monday labels) over the period, zero-filled. */
export function weeklySeries(
  times: readonly number[],
  period: Period
): Array<{ bucket: string; value: number }> {
  const counts = new Map<string, number>();
  for (
    let week = isoWeekStart(period.from);
    week <= period.to;
    week = addDays(week, 7)
  ) {
    counts.set(week, 0);
  }
  for (const at of times) {
    if (inPeriod(period, at)) {
      const week = isoWeekStart(localDay(at, period.tz));
      counts.set(week, (counts.get(week) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([bucket, value]) => ({ bucket, value }));
}

/** The live summary (10 §2) over `period`. */
export function computeSummary(
  data: AnalyticsData,
  timelines: readonly AppTimeline[],
  period: Period,
  now: number
): SummaryBody {
  const within = (at: number | undefined) =>
    at !== undefined && inPeriod(period, at);
  const funnel: Funnel = {
    tracked: data.applications.filter((app) => within(app.created_at)).length,
    applied: 0,
    interviewing: 0,
    offer: 0,
    accepted: 0,
    rejected_total: 0,
    withdrawn_total: 0,
  };
  const cohort: AppTimeline[] = [];
  for (const timeline of timelines) {
    const { firsts } = timeline;
    if (within(firsts.applied)) {
      funnel.applied += 1;
      cohort.push(timeline);
    }
    funnel.interviewing += Number(within(firsts.interviewing));
    funnel.offer += Number(within(firsts.offer));
    funnel.accepted += Number(within(firsts.accepted));
    funnel.rejected_total += Number(within(firsts.rejected));
    funnel.withdrawn_total += Number(within(firsts.withdrawn));
  }
  const followUpsCompleted = data.activity.filter(
    (event) =>
      event.type === "note_added" && inPeriod(period, event.recorded_at)
  ).length;
  return {
    from: period.from,
    to: period.to,
    tz: period.tz,
    source: "live",
    cohort_size: cohort.length,
    funnel,
    rates: cohortRates(cohort, now),
    rejection_by_stage: rejectionByStage(timelines, period),
    time_metrics: timeMetrics(timelines, cohort, period, now),
    automation: automationStats(data),
    unconfirmed_count: cohort.filter(
      (timeline) => timeline.app.submission_status === "submitted_unverified"
    ).length,
    volume: {
      tracked: funnel.tracked,
      discovered: data.discovered.filter((at) => inPeriod(period, at)).length,
      follow_ups_due: data.applications.filter(
        (app) => app.follow_up_at !== null && within(app.follow_up_at)
      ).length,
      follow_ups_completed: followUpsCompleted,
      applications_per_week: weeklySeries(
        cohort.map((timeline) => timeline.firsts.applied as number),
        period
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Rollup mode (> 180 days)
// ---------------------------------------------------------------------------

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sumOf(rows: readonly DailyRow[], key: string): number {
  return rows.reduce((total, row) => total + num(row.metrics[key]), 0);
}

function sumNested(rows: readonly DailyRow[], key: string, inner: string) {
  return rows.reduce(
    (total, row) => total + num(record(row.metrics[key])[inner]),
    0
  );
}

function sumMap(rows: readonly DailyRow[], key: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    for (const [name, value] of Object.entries(record(row.metrics[key]))) {
      out.set(name, (out.get(name) ?? 0) + num(value));
    }
  }
  return out;
}

function periodRatio(part: number, whole: number): number {
  return ratio(part, whole) ?? 0;
}

/** The summary of a long period from `analytics_daily` (10 §4). */
export function summaryFromRollups(
  rows: readonly DailyRow[],
  period: Period,
  live: { followUpsDue: number; unconfirmed: number }
): SummaryBody {
  const funnel: Funnel = {
    tracked: sumOf(rows, "tracked"),
    applied: sumOf(rows, "applied"),
    interviewing: sumOf(rows, "interviewing"),
    offer: sumOf(rows, "offers"),
    accepted: sumOf(rows, "accepted"),
    rejected_total: sumOf(rows, "rejected_apps"),
    withdrawn_total: sumOf(rows, "withdrawn"),
  };
  const rejections = emptyRejections();
  const rounds = new Map<number, number>();
  const rejectedFrom = sumMap(rows, "rejected");
  for (const [from, count] of rejectedFrom) {
    if (from !== "interviewing") {
      addRejection(
        rejections,
        rounds,
        rejectionBucket(from as Stage | "legacy"),
        null,
        count
      );
    }
  }
  for (const [round, count] of sumMap(rows, "rejected_after_round")) {
    addRejection(rejections, rounds, "after_interview", Number(round), count);
  }
  const submitted = sumNested(rows, "tasks", "submitted");
  const failed = sumNested(rows, "tasks", "failed");
  const outcomeUnknown = sumNested(rows, "tasks", "outcome_unknown");
  const paused = sumNested(rows, "tasks", "paused");
  const attempts = sumOf(rows, "attempts");
  const applied = funnel.applied;
  const weeks = new Map<string, number>();
  for (
    let week = isoWeekStart(period.from);
    week <= period.to;
    week = addDays(week, 7)
  ) {
    weeks.set(week, 0);
  }
  for (const row of rows) {
    const week = isoWeekStart(row.day);
    weeks.set(week, (weeks.get(week) ?? 0) + num(row.metrics.applied));
  }
  return {
    from: period.from,
    to: period.to,
    tz: period.tz,
    source: "rollup",
    cohort_size: applied,
    funnel,
    rates: showsRates(applied)
      ? {
          response_rate: periodRatio(sumOf(rows, "responded"), applied),
          interview_rate: periodRatio(funnel.interviewing, applied),
          offer_rate: periodRatio(funnel.offer, applied),
          acceptance_rate: ratio(funnel.accepted, funnel.offer),
          rejection_rate: periodRatio(funnel.rejected_total, applied),
          ghosting_rate: null,
        }
      : null,
    rejection_by_stage: finishRounds(rejections, rounds),
    time_metrics: {
      time_to_first_response: emptyDuration(),
      time_to_interview: emptyDuration(),
      time_to_offer: emptyDuration(),
      prep_time: emptyDuration(),
      time_in_stage: {},
    },
    automation: {
      apply_tasks: {
        submitted,
        failed,
        cancelled: sumNested(rows, "tasks", "cancelled"),
        outcome_unknown: outcomeUnknown,
        expired: sumNested(rows, "tasks", "expired"),
      },
      apply_success_rate: ratio(submitted, submitted + failed + outcomeUnknown),
      verified_ratio: ratio(sumNested(rows, "tasks", "verified"), submitted),
      pause_rate: ratio(sumOf(rows, "attempts_paused"), attempts),
      failure_classes: Object.fromEntries(sumMap(rows, "failure_classes")),
      pause_reasons: [],
      median_attempt_duration: emptyDuration(),
      human_interventions_per_application:
        submitted > 0
          ? (paused + sumOf(rows, "answer_approvals")) / submitted
          : null,
    },
    unconfirmed_count: live.unconfirmed,
    volume: {
      tracked: funnel.tracked,
      discovered: sumOf(rows, "discovered"),
      follow_ups_due: live.followUpsDue,
      follow_ups_completed: sumOf(rows, "follow_ups_completed"),
      applications_per_week: [...weeks.entries()].map(([bucket, value]) => ({
        bucket,
        value,
      })),
    },
  };
}
