## ADDED Requirements

### Requirement: Analytics routes
The api Worker SHALL serve `GET /api/v1/analytics/summary?from&to&tz`, `GET /api/v1/analytics/timeseries?metric&interval&from&to&tz` and `GET /api/v1/analytics/breakdown?by&from&to&tz`, each requiring `jobs:read` and answering with `Cache-Control: private, max-age=60`; `from` / `to` SHALL be calendar days in `tz` (default the user's timezone, `to` = today, `from` = 90 days earlier), and unknown zones, impossible days, `from` after `to` or spans over ten years MUST be refused with 400 `invalid_request`. (Source: 10 §6; 05 §12)

#### Scenario: Read token
- **WHEN** a read-scoped token requests the summary
- **THEN** the response is 200 with `Cache-Control: private, max-age=60`

#### Scenario: Anonymous caller
- **WHEN** a request carries no bearer
- **THEN** the response is 401

#### Scenario: Bad zone
- **WHEN** `tz=Mars/Olympus` is passed
- **THEN** the response is 400 `invalid_request`

### Requirement: Per-user isolation of analytics
Every analytics query MUST read only the caller's own rows in `JOBS_DB` (no cross-database joins, no cross-user aggregates, no admin bypass); there SHALL be no endpoint that aggregates across users. (Source: 10 §1, §7; 11 §6.1; D-26; T10-08)

#### Scenario: Two users
- **WHEN** users A and B both have applications and B calls every analytics endpoint
- **THEN** B's answers contain only B's data

### Requirement: Funnel with reached semantics
The summary funnel SHALL count `tracked` (applications created in the period) and, for `applied`, `interviewing`, `offer`, `accepted`, `rejected_total` and `withdrawn_total`, the applications that ever reached that stage, from the first `stage_changed` event to it with `applied_to_state = 1`; stale events (`applied_to_state = 0`) MUST be ignored, a skipped stage (`applied → offer`) SHALL count only in the stages reached, archived applications SHALL be included, and applied applications whose submission is `submitted_unverified` SHALL count and be reported as `unconfirmed_count`. (Source: 10 §1, §2.1; T10-01)

#### Scenario: Skipped and reopened stages
- **WHEN** one application goes `applied → offer` and another `rejected → saved → applied`
- **THEN** the first counts in `offer` but not in `interviewing`, and the second counts once in `applied`

#### Scenario: Stale event
- **WHEN** an event to `interviewing` was stored with `applied_to_state = 0`
- **THEN** it does not count toward `interviewing`

### Requirement: Cohort conversion rates
Rates SHALL be computed over the cohort of applications whose first `applied` falls in the period: `response_rate`, `interview_rate`, `offer_rate`, `acceptance_rate` (over cohort members that reached offer), `rejection_rate` and `ghosting_rate` (no response after 30 days, over cohort members older than 30 days); when the cohort is smaller than 5 the rates MUST be `null` while counts still show. (Source: 10 §2.2; T10-02)

#### Scenario: Small cohort
- **WHEN** only 4 applications were applied in the period
- **THEN** the funnel counts are returned and every rate is `null`

### Requirement: Rejection by stage
The summary SHALL distribute `stage_changed → rejected` events by their `from_value` into before applying, after applying, after interview round *n* (the latest `interviews.round` recorded before the rejection) and after offer. (Source: 10 §2.3)

#### Scenario: Rejection after the second interview
- **WHEN** an application with interview rounds 1 and 2 is rejected from `interviewing`
- **THEN** it counts in the "after interview round 2" bucket

### Requirement: Time metrics as medians and P75
Time metrics (`time_to_first_response`, `time_to_interview`, `time_to_offer`, `time_in_stage` with open visits reported separately, `prep_time`) SHALL be reported as `{median, p75, n}` and never as means; applications without a response SHALL be left out of the response metrics. (Source: 10 §2.4; T10-03)

#### Scenario: Open visit
- **WHEN** an application has been in `interviewing` since 10 days ago
- **THEN** that stay is reported under "currently in stage", not among finished stays

### Requirement: Legacy applications
Applications migrated from the legacy KV tracker SHALL count as having reached their `payload.legacy_status` (on the `created` / `legacy_imported` events) at the legacy `updatedAt` time. (Source: 10 §3; 06 §12; T10-04)

#### Scenario: Migrated interviewing job
- **WHEN** a migrated job has `legacy_status = "interviewing"` and no stage events
- **THEN** it counts in `applied` and `interviewing`

### Requirement: Timezone-aware days and ISO weeks
Day boundaries, weekly buckets and periods SHALL use the user's IANA timezone (`user_settings.timezone`, overridable by `tz`, default `Asia/Jakarta`), with ISO weeks starting on Monday and correct handling of DST days; responses SHALL echo `tz`. (Source: 10 §5; T10-05)

#### Scenario: Late evening in Jakarta
- **WHEN** an `applied` event is recorded at 23:30 Asia/Jakarta on a Sunday
- **THEN** it lands on that Sunday and in the ISO week that ends on it

#### Scenario: DST zone
- **WHEN** the zone is `Europe/Amsterdam` on the day clocks change
- **THEN** that day spans 23 or 25 hours from local midnight to local midnight

### Requirement: Live queries up to 180 days, rollups beyond
The summary SHALL compute from events and current rows for periods of at most 180 days and SHALL read `analytics_daily` for longer periods, reporting which source answered; the timeseries SHALL read only `analytics_daily`, zero-filled per day, ISO week or month. (Source: 10 §4, §6)

#### Scenario: One-year period
- **WHEN** the summary is requested for 365 days
- **THEN** it is answered from `analytics_daily` with `source: "rollup"`

#### Scenario: Weekly series
- **WHEN** `timeseries?metric=applied&interval=week` is requested
- **THEN** every ISO week of the period has a point, weeks without activity with value 0

### Requirement: Breakdowns
The breakdown SHALL group applied applications by `source`, `company` (top 20, the rest as "Other"), `mode` at the time of applying (current mode for legacy rows), `method`, `cv_variant` (tailored vs base), `score_band` (≥ 80, 60–79, < 60, unscored, using the score in force when `applied` was recorded) or `workplace_type`, returning `{key, label, applied, interview_rate, offer_rate, rejection_rate, n}` with rates only for groups of 5 or more. (Source: 10 §2.6; T10-09)

#### Scenario: Score re-computed after applying
- **WHEN** an application was applied with score 85 and its posting was later re-scored to 55
- **THEN** it is counted in the ≥ 80 band

### Requirement: Automation reliability
The summary SHALL report apply tasks by terminal state (`submitted`, `failed`, `cancelled`, `outcome_unknown`, `expired`), `apply_success_rate`, `verified_ratio`, `pause_rate`, the top pause reasons, failure classes, the median attempt duration and human interventions per application. (Source: 10 §2.7)

#### Scenario: Unknown outcomes lower the success rate
- **WHEN** a user has 3 submitted, 1 failed and 1 `outcome_unknown` apply task
- **THEN** `apply_success_rate` is 0.6

### Requirement: Daily rollup
The daily cron SHALL enqueue, in user pages of 200 and `sendBatch` calls of at most 100, one `rollup_user` message per user with activity in the last 48 hours covering yesterday and today in that user's timezone; the consumer SHALL recompute those days from the events and upsert one `analytics_daily` row per user-day, idempotently (a replay or late event yields the same row) and keeping the stored AI spend. (Source: 10 §4; 14 §6–§7; D-06; T10-06)

#### Scenario: Replayed message
- **WHEN** the same `rollup_user` message is processed twice
- **THEN** the `analytics_daily` rows are identical after both runs

#### Scenario: Purged user
- **WHEN** a message arrives for a user without data
- **THEN** nothing is written and no settings row is created

### Requirement: Rebuild
A `rebuild_analytics` message (sent when the user's timezone changes) SHALL recompute every day of the user's `analytics_daily` from the events, removing rows of days without activity and keeping AI spend; `bun run analytics:rebuild --user <usr_id>` SHALL report the same computation as a dry run, write only with `--execute`, act only on the local `JOBS_DB` and refuse `--remote`. (Source: 10 §4, §5; T10-07)

#### Scenario: Rebuild equals incremental rollup
- **WHEN** a 90-day event fixture is rolled up day by day and separately rebuilt
- **THEN** both produce the same rows

#### Scenario: Script without --execute
- **WHEN** `analytics:rebuild --user usr_…` runs without `--execute`
- **THEN** it prints the days it would write and writes nothing

### Requirement: CLI stats command
The CLI SHALL provide `pilih-jobs stats [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--by <dimension>] [--tz <zone>]` that prints the summary from `GET /api/v1/analytics/summary` (and the breakdown when `--by` is given) and rejects malformed days before any request. (Source: 10 §6; 16 §3.3)

#### Scenario: Malformed day
- **WHEN** `pilih-jobs stats --from 2026/10/01` is run
- **THEN** it exits with a usage error and calls no API
