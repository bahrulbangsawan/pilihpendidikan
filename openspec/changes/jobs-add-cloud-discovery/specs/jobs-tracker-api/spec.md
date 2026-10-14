## ADDED Requirements

### Requirement: Cloud source catalog
The API SHALL keep a system catalog of remote-job platforms in `JOBS_DB.cloud_sources`, seeded from the audited `cloud-sources.json`, deduplicated by registrable domain, with a category, strategy, priority, interval, health, status note and run statistics per source, and SHALL never overwrite operator-edited fields, re-enable a disabled source or duplicate a source when the seed or the directory is synced again. (Source: 24 §2, §7.1)

#### Scenario: Seed sync keeps operator edits
- **WHEN** an operator disabled a source and changed its priority, and a new deploy ships a changed seed file
- **THEN** the source stays disabled with the operator's priority and exactly one row exists for its slug

#### Scenario: Non-boards are registered, never scraped
- **WHEN** the catalog lists a freelance marketplace from the directory
- **THEN** it appears with status `UNSUPPORTED` and an explanatory note and is never dispatched

### Requirement: Hourly cloud dispatch
A cron trigger `0 * * * *` SHALL enqueue one `jobs-scrape` message per due source (enabled, schedulable health, a real strategy, `next_run_at` reached, breaker closed, no live lease) and move its schedule forward in the same batch, SHALL never scrape inside the cron, and SHALL do nothing while `JOBS_CLOUD_DISCOVERY_ENABLED` is off. (Source: 24 §6.1)

#### Scenario: One message per due source
- **WHEN** the hourly cron fires twice in a row
- **THEN** each schedulable source is enqueued exactly once and the scraper received no request from the cron

### Requirement: Scrape consumer
The `jobs-scrape` consumer SHALL lease the source for the run (runs never overlap), call the scraper with the stored checkpoint, store items as shared public postings through the postings:batch merge rules in system mode, link new postings to followers and queue their scoring, close postings missing from two complete runs, and close the run and update the source health, breaker, schedule and statistics in one write. (Source: 24 §6.2, §6.5)

#### Scenario: Re-runs never duplicate
- **WHEN** the same two items are scraped in two runs
- **THEN** two postings exist, the second run reports two unchanged items and followers have two inbox entries

#### Scenario: Same title, different vacancy
- **WHEN** two items share title and company but have different URLs
- **THEN** two postings are stored and they share one dedupe group

### Requirement: Failure classification
The consumer SHALL classify failures: transient errors retry with bounded jittered exponential backoff (at most three retries); access denials, challenges and robots disallows set `BLOCKED`; rate limits set `RATE_LIMITED` with the next run after Retry-After and at least two hours; login walls set `AUTH_REQUIRED`; layout and configuration errors set `FAILED`; three consecutive failures open a breaker; every failure stores an actionable note that never suggests bypassing a protection. (Source: 24 §6.3)

#### Scenario: Challenge blocks the source
- **WHEN** the scraper reports `challenge_detected`
- **THEN** the run is `blocked`, the source is `BLOCKED` with a note saying Pilih never solves or bypasses challenges, and it is not dispatched again until an operator retries

### Requirement: Cloud catalog routes
The API SHALL serve `/api/v1/cloud-sources…` and `/api/v1/cloud-discovery…` (05 §15): reads and follows for every signed-in user, and create, edit (with `base_revision`), run, retry, re-probe and directory refresh for operators only, answering `403 operator_required` to everyone else. (Source: 05 §15)

#### Scenario: Non-operator edit
- **WHEN** a user who is not in `ADMIN_EMAILS` patches a cloud source
- **THEN** the answer is `403 operator_required` and nothing changes

### Requirement: Grounded AI fallback
When `JOBS_CLOUD_AI_ENABLED`, the source's `ai_enabled` and the system budget allow it, the API SHALL extract jobs from scraper page excerpts with a strict schema, keep only jobs whose title (and company, unless a source default applies) appear in the page text and whose URL is same-site, cap their confidence at 0.7 and record every rejection as a warning. (Source: 24 §4.3)

#### Scenario: Invented job dropped
- **WHEN** the model returns a title that does not occur in the page text
- **THEN** no posting is stored for it and the run carries an `ai_rejected` warning
