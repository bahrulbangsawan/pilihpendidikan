// The counters of one `analytics_daily` row (10 §4). A day's counters depend
// only on facts recorded that day (server clock) plus each application's
// first time per stage, so a day is final once it is over: the incremental
// rollup (yesterday + today) and a full rebuild write the same rows
// (T10-07), and replays are harmless (14 §6).
//
//   tracked               applications created that day
//   applied               applications that first reached applied that day
//   applied_unverified    submission changes to submitted_unverified that day
//   interviewing / offers / accepted / withdrawn / rejected_apps
//                         first reach of that stage that day
//   responded             first response after applying that day (10 §2.2)
//   interviews_scheduled  interview_scheduled events
//   rejected              {from stage: n} of → rejected events ("legacy" for
//                         migrated rejections); rejected_after_round {n: count}
//   discovered / scored   jobs delivered by discovery / scores that became ready
//   tasks                 apply tasks finished that day by state (+ paused
//                         events, verified submissions); failure_classes
//   attempts / attempts_paused   apply attempts started that day (+ paused)
//   answer_approvals / follow_ups_completed
//
// `ai_cost_micro_usd` is never computed here: the AI budget owns it and the
// writes keep it (repo/analytics). A day with no activity has no row (or only
// its AI spend).

import { localDay } from "../../core/clock";
import type { AnalyticsData } from "../../repo/analytics";
import type { AppTimeline } from "./model";
import { firstResponseAt } from "./model";

export interface DailyTasks {
  cancelled: number;
  expired: number;
  failed: number;
  outcome_unknown: number;
  paused: number;
  submitted: number;
  verified: number;
}

export interface DailyMetrics {
  accepted: number;
  answer_approvals: number;
  applied: number;
  applied_unverified: number;
  attempts: number;
  attempts_paused: number;
  discovered: number;
  failure_classes: Record<string, number>;
  follow_ups_completed: number;
  interviewing: number;
  interviews_scheduled: number;
  offers: number;
  rejected: Record<string, number>;
  rejected_after_round: Record<string, number>;
  rejected_apps: number;
  responded: number;
  scored: number;
  tasks: DailyTasks;
  tracked: number;
  withdrawn: number;
}

export function emptyDailyMetrics(): DailyMetrics {
  return {
    tracked: 0,
    applied: 0,
    applied_unverified: 0,
    interviewing: 0,
    interviews_scheduled: 0,
    offers: 0,
    accepted: 0,
    rejected: {},
    rejected_apps: 0,
    rejected_after_round: {},
    withdrawn: 0,
    responded: 0,
    discovered: 0,
    scored: 0,
    tasks: {
      submitted: 0,
      failed: 0,
      cancelled: 0,
      outcome_unknown: 0,
      expired: 0,
      paused: 0,
      verified: 0,
    },
    failure_classes: {},
    attempts: 0,
    attempts_paused: 0,
    answer_approvals: 0,
    follow_ups_completed: 0,
  };
}

type NumericKey = {
  [K in keyof DailyMetrics]: DailyMetrics[K] extends number ? K : never;
}[keyof DailyMetrics];

const TASK_STATES = new Set([
  "submitted",
  "failed",
  "cancelled",
  "outcome_unknown",
  "expired",
]);

class DayAccumulator {
  readonly days = new Map<string, DailyMetrics>();
  readonly #only: ReadonlySet<string> | null;
  readonly #zone: string;

  constructor(zone: string, only: ReadonlySet<string> | null) {
    this.#zone = zone;
    this.#only = only;
  }

  /** The metrics of the day of `at`, or null when the day is not wanted. */
  at(at: number | undefined | null): DailyMetrics | null {
    if (at === undefined || at === null) {
      return null;
    }
    const day = localDay(at, this.#zone);
    if (this.#only && !this.#only.has(day)) {
      return null;
    }
    let metrics = this.days.get(day);
    if (!metrics) {
      metrics = emptyDailyMetrics();
      this.days.set(day, metrics);
    }
    return metrics;
  }

  inc(at: number | undefined | null, key: NumericKey): void {
    const metrics = this.at(at);
    if (metrics) {
      metrics[key] += 1;
    }
  }
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function addTimelines(acc: DayAccumulator, timelines: readonly AppTimeline[]) {
  for (const timeline of timelines) {
    const { firsts } = timeline;
    acc.inc(firsts.applied, "applied");
    acc.inc(firsts.interviewing, "interviewing");
    acc.inc(firsts.offer, "offers");
    acc.inc(firsts.accepted, "accepted");
    acc.inc(firsts.rejected, "rejected_apps");
    acc.inc(firsts.withdrawn, "withdrawn");
    acc.inc(firstResponseAt(timeline), "responded");
    for (const rejection of timeline.rejections) {
      const metrics = acc.at(rejection.at);
      if (!metrics) {
        continue;
      }
      bump(metrics.rejected, rejection.from);
      if (rejection.from === "interviewing") {
        bump(metrics.rejected_after_round, String(rejection.round ?? 1));
      }
    }
  }
}

function addAutomation(acc: DayAccumulator, data: AnalyticsData): void {
  for (const task of data.tasks) {
    const metrics = acc.at(task.finished_at);
    if (!(metrics && TASK_STATES.has(task.state))) {
      continue;
    }
    metrics.tasks[task.state as keyof DailyTasks] += 1;
    if (task.state === "submitted" && task.verified) {
      metrics.tasks.verified += 1;
    }
    if (task.state !== "submitted" && task.error_class) {
      bump(metrics.failure_classes, task.error_class);
    }
  }
  for (const attempt of data.attempts) {
    acc.inc(attempt.started_at, "attempts");
    if (attempt.paused) {
      acc.inc(attempt.started_at, "attempts_paused");
    }
  }
  for (const at of data.answerApprovals) {
    acc.inc(at, "answer_approvals");
  }
}

function addActivity(acc: DayAccumulator, data: AnalyticsData): void {
  for (const app of data.applications) {
    acc.inc(app.created_at, "tracked");
  }
  for (const event of data.submissionEvents) {
    if (event.to_value === "submitted_unverified") {
      acc.inc(event.recorded_at, "applied_unverified");
    }
  }
  for (const event of data.activity) {
    if (event.type === "interview_scheduled") {
      acc.inc(event.recorded_at, "interviews_scheduled");
    } else if (event.type === "note_added") {
      acc.inc(event.recorded_at, "follow_ups_completed");
    } else {
      const metrics = acc.at(event.recorded_at);
      if (metrics) {
        metrics.tasks.paused += 1;
      }
    }
  }
  for (const at of data.discovered) {
    acc.inc(at, "discovered");
  }
  for (const at of data.scored) {
    acc.inc(at, "scored");
  }
}

/**
 * Counters per local day in `zone`. `only` limits the output to those days
 * (the incremental rollup); null computes every day with activity (rebuild).
 * Days without any activity are absent.
 */
export function computeDailyMetrics(
  data: AnalyticsData,
  timelines: readonly AppTimeline[],
  zone: string,
  only: ReadonlySet<string> | null
): Map<string, DailyMetrics> {
  const acc = new DayAccumulator(zone, only);
  addTimelines(acc, timelines);
  addActivity(acc, data);
  addAutomation(acc, data);
  return acc.days;
}
