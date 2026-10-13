## Context

Analytics (10) reads only `JOBS_DB` and only the caller's rows. Events in
`application_events` are the source of truth; `analytics_daily` is a cache
that can be rebuilt. The work spans the api (routes, queue consumers, cron,
a local script), the contracts, the web Stats screen and one CLI command. 13
§3 marks this change as not needing a design; this short record exists for
the decisions and the divergences from the spec text.

## Goals / Non-Goals

- Goals: per-user funnel, cohort rates, time metrics and breakdowns that
  equal a raw-event recomputation (S-27); timezone-correct buckets; a cheap
  daily rollup for long periods and time series.
- Non-Goals: cross-user comparisons or operator aggregates in D1 (10 §7: an
  admin-only local script, not part of this change); AI cost on the main
  dashboard (Settings → Usage).

## Decisions

- Decision: compute summaries live for periods ≤ 180 days and from
  `analytics_daily` beyond (10 §4). The rollup cannot rebuild per-application
  cohorts, so rollup-mode rates are period ratios capped at 1 and its time
  metrics are empty (`n = 0`); the response says `source: "live" | "rollup"`.
- Decision: the daily cron only fans out — one `rollup_user` message per user
  active in the last 48 hours (pages of 200, `sendBatch` ≤ 100) — and the
  `jobs-ai` consumer does the work (D-06, 14 §6). Alternative: inline rollups
  in the cron up to ~20k users as 10 §4 sketches; rejected so the cron's wall
  time never depends on the user count.
- Decision: rollups recompute "yesterday + today" in the user's zone (the spec's
  "previous 2 local days"), idempotently; AI spend
  (`metrics.ai_cost_micro_usd`, written by the budget code) is carried over.
- Decision: a timezone change sends `rebuild_analytics`, which recomputes all
  of the user's days (not only the last 90 of 10 §5) and removes rows of days
  that no longer have activity.
- Decision: the BFF caches analytics answers per user for 60 s (D-15), matching
  the api's `Cache-Control: private, max-age=60`.
- Decision: the rebuild script works only on the local `JOBS_DB`; a production
  rebuild goes through the queue, never through the script (`--remote` is
  refused).

## Risks / Trade-offs

- Live queries over large histories → the 180-day switch to rollups; D1's
  per-invocation query budget is respected by loading one user's data once.
- Late CLI events (outbox) → the rollup recomputes yesterday too and is
  idempotent.
- Misleading small-sample rates → rates hidden below 5 in the api and the UI.

## Migration Plan

No new schema: `analytics_daily` is part of
`migrations-jobs/0001_jobs_core.sql`. After deploy, rollups fill in from the
next daily cron; long-range summaries before then show only what the rollup
has. Rollback: remove the routes; the table is a cache.

## Open Questions

- The "Recalculating statistics…" notice of 10 §5 while a rebuild runs is not
  shown by the web app; is it needed given that rebuilds are quick?
- Operator aggregates (10 §7, k ≥ 20) have no script yet; the owner decides
  whether they are needed before GA.
