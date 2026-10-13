// 05 §12 — Analytics (10 §6).
import { z } from "zod";
import { DaySchema } from "../common";
import {
  AnalyticsBreakdownSchema,
  AnalyticsIntervalSchema,
  AnalyticsMetricSchema,
} from "../enums";
import { defineSchema } from "../registry";
import { route } from "./route";

/** Cohorts smaller than this show counts but no rates (10 §2.2). */
export const MIN_COHORT_FOR_RATES = 5;

const count = z.number().int().min(0);
const rate = z.number().min(0).max(1);

/** `from` / `to` are ISO dates interpreted in `tz` (10 §5). */
export const AnalyticsRangeQuerySchema = defineSchema(
  "api",
  "AnalyticsRangeQuery",
  z.object({
    from: DaySchema.optional(),
    to: DaySchema.optional(),
    tz: z.string().max(64).optional(),
  })
);

/** Median and P75 in milliseconds; null when n = 0 (10 §2.4). */
export const DurationStatSchema = defineSchema(
  "api",
  "DurationStat",
  z.object({
    median: z.number().min(0).nullable(),
    p75: z.number().min(0).nullable(),
    n: count,
  })
);

/** Time spent per stage (10 §2.4): finished stays and stays still open. */
const StageTimesSchema = z.object({
  closed: DurationStatSchema,
  open: DurationStatSchema,
});

const WeeklyPointSchema = z.object({ bucket: DaySchema, value: count });

export const AnalyticsSummaryResponseSchema = defineSchema(
  "api",
  "AnalyticsSummaryResponse",
  z.object({
    from: DaySchema,
    to: DaySchema,
    tz: z.string(),
    /** Additive: computed live, or from the analytics_daily rollup (10 §4). */
    source: z.enum(["live", "rollup"]).optional(),
    cohort_size: count,
    funnel: z.object({
      tracked: count,
      applied: count,
      interviewing: count,
      offer: count,
      accepted: count,
      rejected_total: count,
      withdrawn_total: count,
    }),
    /** null when the cohort is smaller than 5. */
    rates: z
      .object({
        response_rate: rate,
        interview_rate: rate,
        offer_rate: rate,
        /** null when no application in the cohort reached offer. */
        acceptance_rate: rate.nullable(),
        rejection_rate: rate,
        /** null when no cohort member is older than 30 days. */
        ghosting_rate: rate.nullable(),
      })
      .nullable(),
    /** 10 §2.3. */
    rejection_by_stage: z.object({
      before_applying: count,
      after_applying: count,
      after_interview: z.array(
        z.object({ round: z.number().int().min(1), count })
      ),
      after_offer: count,
    }),
    time_metrics: z.object({
      time_to_first_response: DurationStatSchema,
      time_to_interview: DurationStatSchema,
      time_to_offer: DurationStatSchema,
      prep_time: DurationStatSchema,
      /** Additive: keyed by stage; empty for the rollup source. */
      time_in_stage: z.record(z.string(), StageTimesSchema).optional(),
    }),
    /** 10 §2.7. */
    automation: z.object({
      apply_tasks: z.object({
        submitted: count,
        failed: count,
        cancelled: count,
        outcome_unknown: count,
        expired: count,
      }),
      apply_success_rate: rate.nullable(),
      verified_ratio: rate.nullable(),
      pause_rate: rate.nullable(),
      failure_classes: z.record(z.string(), count),
      /** Additive (10 §2.7). */
      pause_reasons: z
        .array(z.object({ reason: z.string(), count }))
        .optional(),
      median_attempt_duration: DurationStatSchema.optional(),
      human_interventions_per_application: z
        .number()
        .min(0)
        .nullable()
        .optional(),
    }),
    unconfirmed_count: count,
    /** Additive: volume counters for the period (10 §2.1). */
    volume: z
      .object({
        tracked: count,
        discovered: count,
        follow_ups_due: count,
        follow_ups_completed: count,
        applications_per_week: z.array(WeeklyPointSchema),
      })
      .optional(),
  })
);
export type AnalyticsSummaryResponse = z.infer<
  typeof AnalyticsSummaryResponseSchema
>;

export const AnalyticsTimeseriesQuerySchema = defineSchema(
  "api",
  "AnalyticsTimeseriesQuery",
  AnalyticsRangeQuerySchema.extend({
    metric: AnalyticsMetricSchema,
    interval: AnalyticsIntervalSchema.optional(),
  })
);

export const AnalyticsTimeseriesResponseSchema = defineSchema(
  "api",
  "AnalyticsTimeseriesResponse",
  z.object({
    metric: AnalyticsMetricSchema,
    interval: AnalyticsIntervalSchema,
    tz: z.string(),
    /** `bucket` is the bucket's first day (YYYY-MM-DD, ISO weeks start Monday). */
    points: z.array(z.object({ bucket: DaySchema, value: z.number() })),
  })
);
export type AnalyticsTimeseriesResponse = z.infer<
  typeof AnalyticsTimeseriesResponseSchema
>;

export const AnalyticsBreakdownQuerySchema = defineSchema(
  "api",
  "AnalyticsBreakdownQuery",
  AnalyticsRangeQuerySchema.extend({ by: AnalyticsBreakdownSchema })
);

export const AnalyticsBreakdownResponseSchema = defineSchema(
  "api",
  "AnalyticsBreakdownResponse",
  z.object({
    by: AnalyticsBreakdownSchema,
    /** Additive: the resolved period (10 §5). */
    from: DaySchema.optional(),
    to: DaySchema.optional(),
    tz: z.string().optional(),
    rows: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        applied: count,
        /** Additive; rates are null for rows with n < 5. */
        response_rate: rate.nullable().optional(),
        interview_rate: rate.nullable(),
        offer_rate: rate.nullable(),
        rejection_rate: rate.nullable(),
        n: count,
      })
    ),
  })
);
export type AnalyticsBreakdownResponse = z.infer<
  typeof AnalyticsBreakdownResponseSchema
>;

export const analyticsRoutes = {
  "GET /api/v1/analytics/summary": route({
    method: "GET",
    path: "/api/v1/analytics/summary",
    operation: "getAnalyticsSummary",
    section: "05 §12",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: AnalyticsRangeQuerySchema,
    response: AnalyticsSummaryResponseSchema,
  }),
  "GET /api/v1/analytics/timeseries": route({
    method: "GET",
    path: "/api/v1/analytics/timeseries",
    operation: "getAnalyticsTimeseries",
    section: "05 §12",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: AnalyticsTimeseriesQuerySchema,
    response: AnalyticsTimeseriesResponseSchema,
  }),
  "GET /api/v1/analytics/breakdown": route({
    method: "GET",
    path: "/api/v1/analytics/breakdown",
    operation: "getAnalyticsBreakdown",
    section: "05 §12",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: AnalyticsBreakdownQuerySchema,
    response: AnalyticsBreakdownResponseSchema,
  }),
} as const;
