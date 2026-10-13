# Change: Add Job Tracker analytics and the Stats screen

## Why

Job seekers need to see whether their search works: how many applications
reach an interview or an offer, where they are rejected, how long employers
take to answer, which sources, modes and CV variants perform, and how reliable
the automation is. `job-tracker-spec/10` defines these per-user metrics over
the append-only event log; milestone M6 (13 §2) ships them with the Stats
screen (12 §9).

## What Changes

- Three `jobs:read` routes (05 §12, 10 §6): `GET /api/v1/analytics/summary`
  (funnel, cohort rates hidden below 5, rejection by stage, median / P75 time
  metrics, volume, automation reliability, unconfirmed count),
  `GET /api/v1/analytics/timeseries` (`applied | interviews | offers |
  rejected | discovered | ai_cost` by `day | week | month`) and
  `GET /api/v1/analytics/breakdown` (`source | company | mode | method |
  cv_variant | score_band | workplace_type`), all with
  `Cache-Control: private, max-age=60`.
- Computation from `application_events` with "reached" semantics, only
  `applied_to_state = 1` events, legacy rows through `payload.legacy_status`,
  timezone-aware days and ISO weeks; live queries for periods ≤ 180 days,
  the `analytics_daily` rollup beyond.
- The daily rollup: the `0 3 * * *` cron enqueues one `rollup_user` message
  per recently active user (yesterday + today in their zone); the
  `rebuild_analytics` consumer recomputes a user's rows after a timezone
  change; `bun run analytics:rebuild --user <id> [--execute]` does the same
  on the local `JOBS_DB` (dry run by default).
- `apps/jobs` Stats screen (`/stats`): stat cells, unconfirmed callout,
  funnel, weekly series, rejection by stage, time to response, breakdown
  switcher, automation card, a data-table toggle on every chart; the BFF
  caches analytics answers per user for 60 s. The CLI gets
  `pilih-jobs stats [--from] [--to] [--by] [--tz]`.

The work is implemented in the working tree (uncommitted, undeployed); this
record documents it after the fact for review.

## Impact

- Affected specs: `jobs-analytics` (new capability), `jobs-dashboard`
  (adds the Stats screen to the dashboard defined by `jobs-add-dashboard`).
- Affected code: `apps/api/src/jobs/{routes,services,repo}/analytics/**`,
  `apps/api/src/jobs/queue/handlers/{rollup-user,rebuild-analytics}.ts`,
  `apps/api/src/jobs/cron/handlers/analytics.ts`,
  `apps/api/scripts/analytics-rebuild.ts`,
  `packages/jobs-contracts/src/api/analytics.ts` and the analytics enums,
  `apps/jobs/src/routes/stats.tsx`, `apps/jobs/src/components/stats/**`,
  `apps/jobs/src/lib/{stats-model,stats-range,bff}.ts`,
  `apps/jobs-cli/src/pilih_jobs/cli/board.py` (`stats`).
- Data: `analytics_daily` (04 §2.7, in `migrations-jobs/0001_jobs_core.sql`).
- Sources: `job-tracker-spec/10` §1–§9, 05 §12, 12 §9, 14 §6–§7; decisions
  D-02, D-06, D-15, D-26.
- Owner actions not performed here: deploys and any production rebuild.
