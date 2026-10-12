# 10 — Analytics and Statistics

This document specifies the statistics `apps/jobs` shows each user:
- the application funnel and conversion rates;
- interview, offer and rejection analytics;
- response times;
- breakdowns by source, company, mode, CV variant and score band;
- automation reliability and AI cost.

It also covers how each metric is computed from the append-only event log, the
daily rollup, timezone handling, and privacy rules.

Legend: `00-README.md` §2. Tables: `application_events`, `applications`,
`interviews`, `offers`, `automation_attempts`, `analytics_daily` (04).
Endpoints: 05 §12. Charts: 12 §9.

---

## 1. Principles

- **[DECISION]** **Events are the source of truth.** Every metric is derivable
  from `application_events` plus current rows. `analytics_daily` is a cache that
  can be rebuilt at any time (§5).
- **[DECISION]** **Per-user only.** No metric compares a user with other users.
  Operator aggregates are anonymized and thresholded (§7).
- Only events with `applied_to_state = 1` count toward stage metrics. Rejected
  stale writes (20 §6) are audit-only.
- **Unconfirmed submissions count, and are flagged.** `applied` counts include
  `submitted_unverified` and `outcome_unknown` is excluded. The UI shows
  "includes N unconfirmed".
- Archived applications are included. Purged applications are gone (06 §8).
- No cross-database joins: analytics reads only `JOBS_DB`.

---

## 2. Metric catalogue

Notation:
- `A` is the set of the user's applications.
- `reached(a, s)` means application `a` ever had `stage = s`, from the first
  `stage_changed` event with `to_value = s` (or `created` with that stage for
  migrated jobs).
- `t(a, s)` is the time of that event's `recorded_at`.

### 2.1 Funnel

| Metric | Definition |
|---|---|
| `tracked` | \|A\| created in the period |
| `applied` | \|{a : reached(a, applied)}\|, or `submission_status ∈ {submitted_verified, submitted_unverified}` for migrated rows |
| `interviewing` | \|{a : reached(a, interviewing)}\| |
| `offer` | \|{a : reached(a, offer)}\| |
| `accepted` | \|{a : reached(a, accepted)}\| |
| `rejected_total` | \|{a : reached(a, rejected)}\| |
| `withdrawn_total` | \|{a : reached(a, withdrawn)}\| |

Funnel chart steps: saved → applied → interviewing → offer → accepted.
**[DECISION]** "Reached" semantics mean an application that went
`applied → offer` directly still counts in `offer` (and not in
`interviewing`). Rates use the cohort definition in §2.2, so no stage can
exceed 100%.

### 2.2 Conversion rates (cohort-based)

Cohort = applications whose `t(a, applied)` falls in the selected period.
Rates are computed over that cohort only, which avoids mixing old interviews
with new applications.

| Rate | Formula |
|---|---|
| `response_rate` | \|cohort ∩ (reached interviewing ∪ offer ∪ rejected-after-applied)\| / \|cohort\| |
| `interview_rate` | \|cohort ∩ reached(interviewing)\| / \|cohort\| |
| `offer_rate` | \|cohort ∩ reached(offer)\| / \|cohort\| |
| `acceptance_rate` | \|cohort ∩ reached(accepted)\| / \|cohort ∩ reached(offer)\| |
| `rejection_rate` | \|cohort ∩ reached(rejected)\| / \|cohort\| |
| `ghosting_rate` | \|cohort with no response event and age > 30 d\| / \|cohort older than 30 d\| |

"Rejected after applied" means the `stage_changed` event to `rejected` has
`from_value ∈ {applied, interviewing, offer}`.

Cohorts smaller than 5 show counts but **no percentages**, with a hint: "Rates
appear after 5 applications". This avoids misleading 100% / 0% figures.

### 2.3 Rejection by stage

Distribution of `from_value` over `stage_changed → rejected` events:
before applying (user-recorded rejections at `saved`/`preparing`/`ready` are
rare but allowed), after applying (no interview), after interview round *n*
(joined with the latest `interviews.round` before the event), and after offer.

### 2.4 Time metrics (medians and P75; means are misleading with long tails)

| Metric | Definition |
|---|---|
| `time_to_first_response` | t(first of interviewing/offer/rejected after applied) − t(applied) |
| `time_to_interview` | t(interviewing) − t(applied) |
| `time_to_offer` | t(offer) − t(applied) |
| `time_in_stage[s]` | For each stage visit, the next `stage_changed.recorded_at` minus the entering event (open visits: now − entering, reported separately as "currently in stage") |
| `prep_time` | t(ready) − t(created) for applications that reached `ready` |

### 2.5 Volume

- `applications_per_week`: count of `applied` events per ISO week in the
  user's timezone.
- `discovered_per_week`, `tracked_per_week` (from `user_jobs.created_at` and
  `applications.created_at`).
- `follow_ups_due`, `follow_ups_completed`.

### 2.6 Breakdowns

Each funnel metric can be broken down by:

| Dimension | Join |
|---|---|
| `source` | `applications → user_jobs → job_postings.source_kind` (and `job_sources.label`) |
| `company` | `job_postings.company_name` (top 20, rest = "Other") |
| `mode` | `applications.mode` at the time of the `applied` event (from the event payload; the current value is used for legacy rows) |
| `method` | `applications.submission_method` (browser, email, ats_api, manual) |
| `cv_variant` | Tailored vs. base CV (`applications.cv_variant_id IS NOT NULL`), and template |
| `score_band` | `match_scores.score` at application time (the score row in force when `applied` was recorded): ≥ 80, 60–79, < 60, unscored |
| `workplace_type`, `seniority` | Posting fields |

### 2.7 Automation reliability

From `automation_tasks` and `automation_attempts`:

| Metric | Definition |
|---|---|
| `apply_tasks` | Count by terminal state (`submitted`, `failed`, `cancelled`, `outcome_unknown`, `expired`) |
| `apply_success_rate` | submitted / (submitted + failed + outcome_unknown) |
| `verified_ratio` | submitted with evidence `verified` / submitted |
| `pause_rate` | attempts with ≥ 1 `paused` event / attempts |
| `pause_reasons` | Top `progress.stage` values at pause (login_required, challenge, unknown_question, …) |
| `failure_classes` | Counts of `error_class` |
| `median_attempt_duration` | `ended_at − started_at` |
| `human_interventions_per_application` | (pauses + answer approvals) / submitted |

### 2.8 AI cost

From `ai_usage` (04 §2.7, 07 §9): cost per month by purpose (`score`, `tailor_cv`,
`agent`, `email_draft`), cost per submitted application. Shown under
Settings → Usage, never on the main dashboard.

---

## 3. Computation (SQL sketches)

All queries are parameterized by `user_id` and use `recorded_at` (server clock,
03 §6).

```sql
-- First time each application reached each stage
WITH firsts AS (
  SELECT application_id, to_value AS stage, MIN(recorded_at) AS at
  FROM application_events
  WHERE user_id = ?1 AND type = 'stage_changed' AND applied_to_state = 1
  GROUP BY application_id, to_value
),
cohort AS (
  SELECT application_id, at AS applied_at FROM firsts
  WHERE stage = 'applied' AND at BETWEEN ?2 AND ?3
)
SELECT
  COUNT(*)                                                         AS applied,
  SUM(EXISTS(SELECT 1 FROM firsts f WHERE f.application_id = c.application_id AND f.stage = 'interviewing')) AS interviewing,
  SUM(EXISTS(SELECT 1 FROM firsts f WHERE f.application_id = c.application_id AND f.stage = 'offer'))        AS offer,
  SUM(EXISTS(SELECT 1 FROM firsts f WHERE f.application_id = c.application_id AND f.stage = 'accepted'))     AS accepted
FROM cohort c;
```

```sql
-- Median time to first response (computed in TS from the ordered list; SQLite has no MEDIAN)
SELECT c.applied_at,
       (SELECT MIN(f.at) FROM firsts f
        WHERE f.application_id = c.application_id
          AND f.stage IN ('interviewing','offer','rejected') AND f.at > c.applied_at) AS first_response_at
FROM cohort c;
```

```sql
-- Rejection by stage
SELECT from_value, COUNT(*) FROM application_events
WHERE user_id = ?1 AND type = 'stage_changed' AND to_value = 'rejected' AND applied_to_state = 1
  AND recorded_at BETWEEN ?2 AND ?3
GROUP BY from_value;
```

**[LIMITATION]** D1 has no window-function cost guarantees on large sets and a
1,000-queries-per-invocation limit (04 header). Live queries are acceptable up
to about 5,000 applications per user (index `ix_events_user_type`, 04 §2.2).
Beyond that, the summary endpoint reads `analytics_daily` only (§4). Migrated
legacy rows have no event history before migration. Their `created` and
`legacy_imported` events carry `payload.legacy_status`, and the queries treat
that as `reached(legacy_status)` at `updatedAt` time.

---

## 4. Daily rollup (`analytics_daily`)

**[NEW]** Table `analytics_daily (user_id, day, metrics JSON)` (04 §2.7).

- **Producer:** the existing daily cron (`0 3 * * *`, [VERIFIED]
  `apps/api/wrangler.jsonc:103-106`, handler `apps/api/src/app.ts:113`) is
  extended. For each user with events since their last rollup, it recomputes
  the **previous 2 local days** (covers late-arriving CLI events via the outbox,
  20 §5). It upserts one row per user-day with counters:

```json
{ "tracked": 3, "applied": 2, "applied_unverified": 1, "interviews_scheduled": 1, "offers": 0,
  "rejected": { "applied": 1 }, "withdrawn": 0, "discovered": 140, "scored": 140,
  "tasks": { "submitted": 2, "failed": 0, "paused": 1, "outcome_unknown": 0 },
  "ai_cost_micro_usd": 41200 }
```

- **Batching:** users are processed in pages of 200, one `batch()` per user.
  **[LIMITATION]** The cron gets 15 min wall time (Cloudflare limits, 14 §1);
  above roughly 20k active users the rollup moves to the `jobs-ai` queue as
  `{type: "rollup_user", user_id, days}` messages (one per user, 14 §6), chained from the cron.
- **Rebuild:** `bun run analytics:rebuild --user <id> [--execute]` (dry run by
  default, like other scripts) recomputes all days from events.
- **Time series** (`GET /api/v1/analytics/timeseries`) reads only
  `analytics_daily`. **Summary** (`/summary`) uses live queries for periods
  ≤ 180 days and falls back to rollups beyond that.

---

## 5. Timezones

- Each user's timezone is `user_settings.timezone` (IANA; 04 §2.7), mirrored
  in the fact key `prefs.timezone` (03 §9). It defaults to
  the browser timezone captured at first sign-in to `apps/jobs`, then the CLI's
  system timezone, then `Asia/Jakarta` (primary market; **[ASSUMPTION]**).
- Day boundaries for rollups and "per week" charts use that zone. ISO weeks
  start on Monday.
- Changing the timezone triggers a background rebuild of the last 90 days of
  rollups (queue message `{type: "rebuild_analytics", user_id, reason: "timezone_change"}`, 14 §6) and shows "Recalculating statistics…" until it
  finishes.
- API parameters `from` / `to` are ISO dates interpreted in `tz` (05 §12);
  responses echo `tz`.

---

## 6. API mapping (05 §12)

| Endpoint | Returns |
|---|---|
| `GET /api/v1/analytics/summary?from&to&tz` | `{funnel, rates (null when cohort < 5), rejection_by_stage, time_metrics {median, p75, n}, automation, unconfirmed_count, cohort_size}` |
| `GET /api/v1/analytics/timeseries?metric=applied|interviews|offers|rejected|discovered|ai_cost&interval=day|week|month&from&to&tz` | `{points: [{bucket, value}]}` |
| `GET /api/v1/analytics/breakdown?by=source|company|mode|method|cv_variant|score_band|workplace_type&from&to` | `{rows: [{key, label, applied, interview_rate, offer_rate, rejection_rate, n}]}` |

All are `jobs:read`. Responses get `Cache-Control: private, max-age=60`, and
the BFF caches per user for 60 s.

CLI: `pilih-jobs stats [--from] [--to] [--by source] [--json]` prints the
summary and a compact funnel in the terminal.

---

## 7. Privacy

- Every analytics query is user-scoped (04 §5 repository rule). There is no
  endpoint that aggregates across users.
- **Operator aggregates** (product health, not shown to users): computed by an
  admin-only script from `analytics_daily`. They only include buckets with
  **k ≥ 20 distinct users**, never expose company names below that threshold,
  and never include free-text fields. Results stay in the operator's local
  environment and are not stored in D1.
- Matching feedback (07 §13 item 4) stays per-user.
- Account deletion removes `analytics_daily` rows with the rest of the user's
  data (11 §8).

---

## 8. UI surfacing (details in 12 §9)

- **Overview strip** on the board header: applied this week, response rate
  (cohort last 30 days), interviews upcoming, follow-ups due.
- **Statistics page:**
  - funnel bar chart;
  - weekly applications line;
  - rejection-by-stage bars;
  - time-to-response median with a P75 whisker;
  - breakdown table with source/mode/CV/score band switcher;
  - automation reliability card;
  - unconfirmed submissions callout linking to the filtered board.
- Charts use `@rulisme/ui` `chart` (recharts) styled per Zedative (12 §2).
  Every chart has a data table toggle for accessibility.

---

## 9. Test plan

| # | Test | Level |
|---|---|---|
| T10-01 | Funnel and cohort rates on a fixture event log incl. skipped stages (`applied → offer`), reopen (`rejected → saved → applied`), stale events (`applied_to_state = 0` ignored) | api (real SQLite) |
| T10-02 | Rates hidden when cohort < 5 | unit |
| T10-03 | Medians/P75 with open visits and unmatched responses | unit |
| T10-04 | Legacy-migrated applications counted via `legacy_status` | api |
| T10-05 | Timezone boundaries: an event at 23:30 Asia/Jakarta lands on the right day and ISO week; DST zones (Europe/Amsterdam) | unit |
| T10-06 | Rollup idempotent and late-event tolerant (re-run for the same day yields the same row) | api |
| T10-07 | Rebuild equals incremental rollup on a 90-day fixture | api |
| T10-08 | Cross-user isolation on every analytics endpoint | api |
| T10-09 | Breakdown by score band uses the score in force at application time, not the latest | api |
| T10-10 | Chart data table toggle and keyboard access | web (agent-browser) |
