// Per-application timelines (10 §2): the one definition of "reached" that the
// summary, the breakdowns, the daily rollup and the rebuild share.
//
//   reached(a, s)   the first applied `stage_changed` event with to = s, or a
//                   `created` event in stage s (an application created
//                   straight into a column), at its `recorded_at` (server
//                   clock, 03 §6). Stale writes (`applied_to_state = 0`) are
//                   never loaded.
//   legacy rows     migrated jobs have no history before migration: their
//                   `created` / `legacy_imported` events carry
//                   `payload.legacy_status`, which counts as reached at the
//                   legacy `updatedAt` (`payload.legacy_updated_at`, else the
//                   event's `occurred_at`). A migrated row whose submission is
//                   submitted_* also reached `applied` then (10 §2.1).
//   visits          each stay in a stage: entered by `created` / a stage
//                   change, left by the next stage change (open = still
//                   there).
//   rejections      every applied `→ rejected` event with the stage it came
//                   from; from `interviewing` it carries the latest interview
//                   round recorded before it (10 §2.3).

import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { STAGES, TERMINAL_STAGES } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApplicationFactRow,
  InterviewFactRow,
  StageEventRow,
  TimelineData,
} from "../../repo/analytics";

export const PREP_STAGES: readonly Stage[] = ["saved", "preparing", "ready"];
export const AFTER_APPLIED_STAGES: readonly Stage[] = [
  "applied",
  "interviewing",
  "offer",
];
/** Stages whose "currently in stage" time means nothing (no way out). */
export function isTerminal(stage: Stage): boolean {
  return (TERMINAL_STAGES as readonly Stage[]).includes(stage);
}
const SUBMITTED = new Set(["submitted_verified", "submitted_unverified"]);

/** Where a rejection came from; `legacy` = a migrated rejected job. */
export type RejectionOrigin = Stage | "legacy";

export interface Rejection {
  at: number;
  from: RejectionOrigin;
  /** Interview round for rejections from `interviewing` (≥ 1). */
  round: number | null;
}

export interface StageVisit {
  enter: number;
  /** null while the application is still in the stage. */
  exit: number | null;
  stage: Stage;
}

export interface AppTimeline {
  app: ApplicationFactRow;
  /** When the application was created (its `created` event, else the row). */
  createdAt: number;
  /** First time per stage (10 §2 `t(a, s)`). */
  firsts: Partial<Record<Stage, number>>;
  legacy: boolean;
  /** `applications.mode` when it first reached `applied` (10 §2.6). */
  modeAtApplied: string;
  rejections: Rejection[];
  visits: StageVisit[];
}

function isStage(value: string | null | undefined): value is Stage {
  return (
    typeof value === "string" && (STAGES as readonly string[]).includes(value)
  );
}

function reach(
  firsts: Partial<Record<Stage, number>>,
  stage: Stage,
  at: number
): void {
  const current = firsts[stage];
  if (current === undefined || at < current) {
    firsts[stage] = at;
  }
}

const TYPE_ORDER: Readonly<Record<StageEventRow["type"], number>> = {
  created: 0,
  legacy_imported: 1,
  stage_changed: 2,
};

function byTime(a: StageEventRow, b: StageEventRow): number {
  return (
    a.recorded_at - b.recorded_at ||
    TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
    (a.id < b.id ? -1 : Number(a.id > b.id))
  );
}

function legacyTime(event: StageEventRow): number {
  return event.legacy_updated_at ?? event.occurred_at ?? event.recorded_at;
}

/** The latest interview round recorded at or before `at` (default 1). */
function roundAt(interviews: readonly InterviewFactRow[], at: number): number {
  let round = 0;
  for (const interview of interviews) {
    if (interview.created_at <= at && interview.round > round) {
      round = interview.round;
    }
  }
  return Math.max(1, round);
}

interface Builder {
  firsts: Partial<Record<Stage, number>>;
  legacyAt: number | null;
  legacyStatus: Stage | null;
  modeAtApplied: string | null;
  rejections: Rejection[];
  visits: StageVisit[];
}

function openVisit(builder: Builder, stage: Stage, at: number): void {
  const last = builder.visits.at(-1);
  if (last && last.exit === null) {
    last.exit = at;
  }
  builder.visits.push({ stage, enter: at, exit: null });
}

function applyLegacy(builder: Builder, event: StageEventRow): void {
  if (!(event.legacy_status && isStage(event.legacy_status))) {
    return;
  }
  const at = legacyTime(event);
  builder.legacyStatus = event.legacy_status;
  builder.legacyAt =
    builder.legacyAt === null ? at : Math.min(builder.legacyAt, at);
  reach(builder.firsts, event.legacy_status, at);
}

function applyCreated(builder: Builder, event: StageEventRow): void {
  const stage = isStage(event.to_value)
    ? event.to_value
    : (event.payload_stage as Stage | null);
  if (!isStage(stage)) {
    return;
  }
  reach(builder.firsts, stage, event.recorded_at);
  const enter =
    event.legacy_status && builder.legacyAt !== null
      ? builder.legacyAt
      : event.recorded_at;
  if (builder.visits.length === 0) {
    builder.visits.push({ stage, enter, exit: null });
  }
}

function applyStageChange(
  builder: Builder,
  event: StageEventRow,
  interviews: readonly InterviewFactRow[]
): void {
  if (!isStage(event.to_value)) {
    return;
  }
  const to = event.to_value;
  const at = event.recorded_at;
  if (to === "applied" && builder.firsts.applied === undefined) {
    builder.modeAtApplied = event.mode;
  }
  reach(builder.firsts, to, at);
  openVisit(builder, to, at);
  if (to === "rejected") {
    const from = isStage(event.from_value) ? event.from_value : "legacy";
    builder.rejections.push({
      at,
      from,
      round: from === "interviewing" ? roundAt(interviews, at) : null,
    });
  }
}

function applyEvent(
  builder: Builder,
  event: StageEventRow,
  interviews: readonly InterviewFactRow[]
): void {
  applyLegacy(builder, event);
  if (event.type === "created") {
    applyCreated(builder, event);
  } else if (event.type === "stage_changed") {
    applyStageChange(builder, event, interviews);
  }
}

function buildOne(
  app: ApplicationFactRow,
  events: readonly StageEventRow[],
  interviews: readonly InterviewFactRow[]
): AppTimeline {
  const builder: Builder = {
    firsts: {},
    legacyAt: null,
    legacyStatus: null,
    modeAtApplied: null,
    rejections: [],
    visits: [],
  };
  const sorted = [...events].sort(byTime);
  const created = sorted.find((event) => event.type === "created");
  if (!created) {
    // No creation event (older data): the row's creation opens the first visit.
    const first = sorted.find((event) => event.type === "stage_changed");
    const stage = isStage(first?.from_value) ? first.from_value : app.stage;
    if (isStage(stage)) {
      builder.visits.push({ stage, enter: app.created_at, exit: null });
      reach(builder.firsts, stage, app.created_at);
    }
  }
  for (const event of sorted) {
    applyEvent(builder, event, interviews);
  }
  const legacy = app.legacy_job_id !== null || builder.legacyStatus !== null;
  const legacyAt = builder.legacyAt ?? app.updated_at;
  if (legacy) {
    if (
      builder.firsts.applied === undefined &&
      SUBMITTED.has(app.submission_status)
    ) {
      reach(builder.firsts, "applied", legacyAt);
    }
    if (
      builder.legacyStatus === "rejected" &&
      !builder.rejections.some((r) => r.from !== "legacy")
    ) {
      builder.rejections.push({ at: legacyAt, from: "legacy", round: null });
    }
  }
  builder.rejections.sort((a, b) => a.at - b.at);
  return {
    app,
    createdAt: created?.recorded_at ?? app.created_at,
    firsts: builder.firsts,
    legacy,
    modeAtApplied: builder.modeAtApplied ?? app.mode,
    rejections: builder.rejections,
    visits: builder.visits,
  };
}

/** One timeline per application (applications without events included). */
export function buildTimelines(data: TimelineData): AppTimeline[] {
  const eventsByApp = new Map<string, StageEventRow[]>();
  for (const event of data.stageEvents) {
    const list = eventsByApp.get(event.application_id);
    if (list) {
      list.push(event);
    } else {
      eventsByApp.set(event.application_id, [event]);
    }
  }
  const interviewsByApp = new Map<string, InterviewFactRow[]>();
  for (const interview of data.interviews) {
    const list = interviewsByApp.get(interview.application_id);
    if (list) {
      list.push(interview);
    } else {
      interviewsByApp.set(interview.application_id, [interview]);
    }
  }
  return data.applications.map((app) =>
    buildOne(
      app,
      eventsByApp.get(app.id) ?? [],
      interviewsByApp.get(app.id) ?? []
    )
  );
}

/**
 * A response (10 §2.2): the application reached interviewing or offer, or was
 * rejected after applying (from applied / interviewing / offer, or a migrated
 * rejected job).
 */
export function responded(timeline: AppTimeline): boolean {
  return (
    timeline.firsts.interviewing !== undefined ||
    timeline.firsts.offer !== undefined ||
    timeline.rejections.some(
      (rejection) =>
        rejection.from === "legacy" ||
        AFTER_APPLIED_STAGES.includes(rejection.from)
    )
  );
}

/** First response after applying (interviewing, offer or a rejection). */
export function firstResponseAt(timeline: AppTimeline): number | null {
  const applied = timeline.firsts.applied;
  if (applied === undefined) {
    return null;
  }
  const candidates = [
    timeline.firsts.interviewing,
    timeline.firsts.offer,
    ...timeline.rejections.map((rejection) => rejection.at),
  ].filter((at): at is number => at !== undefined && at > applied);
  return candidates.length === 0 ? null : Math.min(...candidates);
}

/** Rejection-by-stage bucket of 10 §2.3. */
export type RejectionBucket =
  | "before_applying"
  | "after_applying"
  | "after_interview"
  | "after_offer";

export function rejectionBucket(from: RejectionOrigin): RejectionBucket | null {
  if (from === "legacy" || from === "applied") {
    return "after_applying";
  }
  if (PREP_STAGES.includes(from)) {
    return "before_applying";
  }
  if (from === "interviewing") {
    return "after_interview";
  }
  if (from === "offer") {
    return "after_offer";
  }
  return null;
}
