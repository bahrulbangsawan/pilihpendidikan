## 1. Contracts

- [x] 1.1 `ANALYTICS_METRICS`, `ANALYTICS_INTERVALS`, `ANALYTICS_BREAKDOWNS` in `packages/jobs-contracts/src/enums.ts`; summary / timeseries / breakdown request and response schemas in `packages/jobs-contracts/src/api/analytics.ts` (`API_ROUTE_SCHEMAS`, 05 §12)

## 2. API (`apps/api/src/jobs`)

- [x] 2.1 Routes `routes/analytics/index.ts` (three `jobs:read` routes, `Cache-Control: private, max-age=60`)
- [x] 2.2 Event model with reached semantics, legacy `legacy_status`, interview rounds, mode at applying `services/analytics/model.ts` — `T10-01`, `T10-04` (unit) in `model.test.ts`
- [x] 2.3 Summary (live ≤ 180 days, rollup beyond; funnel, cohort rates, rejection by stage, time metrics, automation reliability, unconfirmed count) `services/analytics/summary.ts`, `stats.ts` — `T10-01`, `T10-02`, `T10-03` in `routes/analytics/analytics.test.ts` and `services/analytics/model.test.ts`
- [x] 2.4 Timezones, ISO weeks, periods `services/analytics/time.ts` — `T10-05` in `time.test.ts`
- [x] 2.5 Timeseries `services/analytics/timeseries.ts` and breakdown `services/analytics/breakdown.ts` (top 20 companies, score in force at application time) — `T10-09` in `routes/analytics/analytics.test.ts`
- [x] 2.6 Repo `repo/analytics/index.ts` (user-scoped reads, `analytics_daily` upserts) — isolation `T10-08` in `routes/analytics/analytics.test.ts` and the S-31 sweep (`src/jobs/isolation-sweep.test.ts`, ledger leaf-2.11 G1 verified)
- [x] 2.7 Daily rollup: cron fan-out `services/analytics/cron.ts` + `cron/handlers/analytics.ts`, consumer `queue/handlers/rollup-user.ts`, computation `services/analytics/{rollup,daily}.ts` — `T10-06` in `services/analytics/rollup.test.ts`
- [x] 2.8 Rebuild consumer `queue/handlers/rebuild-analytics.ts` (sent on timezone change by `services/account/settings.ts`) — `T10-07` in `services/analytics/rollup.test.ts`
- [x] 2.9 `scripts/analytics-rebuild.ts` (`bun run analytics:rebuild`, dry run unless `--execute`, local only, `--remote` refused) — `services/analytics/rebuild-script.test.ts`
- [x] 2.10 S-27 component test: the summary equals a raw-event recomputation for 3 seeded users (`routes/analytics/recompute.test.ts`)
- [x] 2.11 Evidence: ledger leaf-2.9 G1 (`TESTS OK api-analytics-email`, ids T10-01…T10-09, S-27) and `leaf-2.9 VERIFIED` in `.unlazy/jobs/status.log`

## 3. Web (`apps/jobs`)

- [x] 3.1 Stats route `src/routes/stats.tsx` and screen `src/components/stats/{stats-page,stats-sections,stats-charts,chart-frame,range-picker}.tsx` — `TW-STATS`, `T10-10` in `stats-page.test.tsx`
- [x] 3.2 View models `src/lib/stats-model.ts`, `src/lib/stats-range.ts` — `TW-STATS` in `stats-model.test.ts`, `stats-range.test.ts`
- [x] 3.3 Per-user 60 s BFF cache for the analytics routes (`CACHED_ROUTES`, `BFF_CACHE_TTL_MS` in `src/lib/bff.ts`)
- [x] 3.4 Evidence: ledger leaf-3.2 G1 (`TESTS OK web-all`, ids T10-10, TW-STATS) and `leaf-3.2 VERIFIED` in `.unlazy/jobs/status.log`

## 4. CLI (`apps/jobs-cli`)

- [x] 4.1 `pilih-jobs stats [--from] [--to] [--by] [--tz]` in `src/pilih_jobs/cli/board.py` (ledger leaf-4.4 G1/G2 verified)

## 5. Handoffs and owner actions

- [x] 5.1 Handoff recorded (NOT executed — owner action): deploying `apps/api` (routes, cron, queue consumers) and `apps/jobs` (Stats screen). Nothing was deployed.
- [x] 5.2 Handoff recorded (NOT executed — owner action): any rebuild of production `analytics_daily` (through `rebuild_analytics` messages); `analytics:rebuild --execute` was not run against any remote database and refuses `--remote`.
- [x] 5.3 Handoff recorded (NOT executed — leaf-5.1 / owner): the agent-browser review of the Stats screen at 375 / 1280 px in light and Night Desk and the full-stack e2e suite (`e2e/` does not exist yet).
- [x] 5.4 Handoff recorded (NOT executed — owner decision): the operator aggregate script (10 §7) and the "Recalculating statistics…" notice (10 §5) are not implemented (see design.md).
