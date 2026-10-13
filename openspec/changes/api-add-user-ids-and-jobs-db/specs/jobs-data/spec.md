## ADDED Requirements

### Requirement: Separate jobs database
Every Job Tracker record SHALL be stored in a second D1 database
`pilihpendidikan-jobs` bound to `apps/api` as `JOBS_DB`, with its schema in
`apps/api/migrations-jobs/` (`0001_jobs_core.sql` = 04 §2), while identity
and credential tables stay in `DB`; cross-database `user_id` and
`device_id` references MUST be enforced in code, not by SQL foreign keys.
(Source: 04 intro, §2; 14 §3; D-02)

#### Scenario: Local schema
- **WHEN** `bun run db:migrate:jobs:local` runs
- **THEN** the local `JOBS_DB` holds every 04 §2 table (`job_postings` … `analytics_daily`) with the 04 CHECK constraints and indexes

#### Scenario: No email in jobs rows
- **WHEN** any `JOBS_DB` table is inspected
- **THEN** rows are keyed by `user_id`, and no column stores the account email

### Requirement: Jobs schema conventions
The `JOBS_DB` schema SHALL store timestamps as epoch milliseconds, JSON as
`TEXT` validated by the shared contracts on write, give every mutable row an
integer `revision` starting at 1, lead every user-scoped access index with
`user_id`, and include `change_log` (per-user ordered feed),
`idempotency_keys` (per-user, 7-day expiry), `user_settings`, `ai_usage`,
`telemetry_daily` and `analytics_daily`. (Source: 04 §2, §2.7; 03 §10; D-21)

#### Scenario: Revision column
- **WHEN** a row is inserted into `applications`
- **THEN** its `revision` is 1 and every later update increments it in the same statement

### Requirement: Repository-only access to JOBS_DB
Only modules under `apps/api/src/jobs/repo/**` (and the `Env` declaration)
SHALL reference `JOBS_DB` or the SQL helpers of `repo/core/db.ts`; every
other module MUST hold the opaque `JobsDb` handle and call repository
functions that take a `UserScope`. A test MUST fail on any violation.
(Source: 04 §5; 11 §6.1)

#### Scenario: Stray database access
- **WHEN** a route or service module references `env.JOBS_DB`
- **THEN** `T11-JOBSDB` in `src/jobs/isolation.test.ts` fails naming the file

### Requirement: user_id predicate on every user-scoped statement
Every SQL statement in `apps/api/src/jobs/repo/**` that touches a
user-scoped table SHALL carry a `user_id` predicate (an INSERT names
`user_id`), except statements explicitly marked
`// sql-allow: system | public-posting | anonymous — <reason>`; a test MUST
parse every SQL string in `repo/**` and fail otherwise. Rows owned by
someone else MUST read as not found. (Source: 04 §5; 11 §6.1, §13)

#### Scenario: Missing predicate
- **WHEN** a repository statement `SELECT * FROM applications WHERE id = ?` is added without a marker
- **THEN** `T11-SQL` fails

#### Scenario: Cron scan
- **WHEN** a system-wide expiry scan carries `// sql-allow: system — lease reaper`
- **THEN** the lint accepts it

### Requirement: Job Tracker bindings
`apps/api/wrangler.jsonc` and `Env` SHALL declare `JOBS_DB`, the R2 bucket
`pilihpendidikan-jobs-files` as `JOBS_FILES`, the producer `JOBS_AI_QUEUE`
for queue `jobs-ai` with consumers for `jobs-ai` (max 5 retries, DLQ
`jobs-ai-dlq`, max concurrency 10) and `jobs-ai-dlq`, the crons
`0 3 * * *` and `*/5 * * * *`, the vars `JOBS_MIN_CLI_VERSION`,
`JOBS_RECOMMENDED_CLI_VERSION`, `JOBS_AI_MODE`, `JOBS_AI_MONTHLY_BUDGET_USD`
and `JOBS_APP_ORIGIN`, and the secret `OPENAI_API_KEY` outside the file; the
`JOBS_DB` id MUST stay a `REPLACE_WITH_…` placeholder until the owner creates
the database. (Source: 14 §3, §8; D-05, D-06)

#### Scenario: Placeholder id
- **WHEN** `wrangler.jsonc` is read before provisioning
- **THEN** `JOBS_DB.database_id` is `REPLACE_WITH_JOBS_DB_ID` and no remote resource has been created by the repository

#### Scenario: Tests without Cloudflare
- **WHEN** `bun test` runs in `apps/api`
- **THEN** `JOBS_DB` is a second real SQLite database with the real migrations applied, and R2 and the queue are in-memory fakes

### Requirement: Gated legacy jobs migration script
`apps/api/scripts/migrate-jobs-kv-to-d1.ts` SHALL inventory every `job:` and
`owner:job:` key of `JOBS_KV` (following the cursor to the end), classify
each job (`ok`, `orphan`, `invalid`, `already_migrated`, `stale`), print a
plan with emails hashed and write `migration-plan.jsonl`, and SHALL write
nothing unless `--execute` is passed; with `--execute` it MUST write one
idempotent batch per job, checkpoint for resume, verify per-user counts and
a 2 % field sample through the facade mapping, record the pre-execution Time
Travel bookmark, and never write or delete KV. (Source: 06 §12.4; D-04)

#### Scenario: Dry run
- **WHEN** the script runs without `--execute`
- **THEN** it prints counts per class and status and writes neither `JOBS_DB` nor `DB` nor KV

#### Scenario: Re-run
- **WHEN** `--execute` runs twice over the same export
- **THEN** the second run inserts nothing new and verification passes

#### Scenario: More than 1,000 jobs
- **WHEN** the namespace holds more than 1,000 job keys
- **THEN** every key is inventoried
