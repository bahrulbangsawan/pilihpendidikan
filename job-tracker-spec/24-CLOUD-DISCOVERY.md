# 24 — Cloud Discovery of Remote-Job Boards

A server-side pipeline that keeps a curated catalog of public remote-job
boards fresh every hour on Cloudflare, without giving up the discovery rules
of 15. Decisions D-37 … D-41 (00 §4). OpenSpec change:
`openspec/changes/jobs-add-cloud-discovery`.

Legend: see `00-README.md` §2.

---

## 1. Overview

```text
apps/api  cron "0 * * * *"  ──▶ queue jobs-scrape ──▶ apps/api consumer ──service binding──▶ apps/jobs-scraper Worker ──▶ Container (Python)
          (enqueue only)        (+ jobs-scrape-dlq)    lease · ingest · fan-out                (no public route)            pilih_scraper → pilih_jobs ScraplingJobEngine
                                                       └─▶ JOBS_DB job_postings / cloud_* ──▶ followers' inbox + scoring (jobs-ai)
```

- **Catalog** (`cloud_sources`): system rows, one per platform, seeded from
  the audited `packages/jobs-contracts/cloud-sources.json` (§7.1).
- **Runs** (`cloud_runs`): every scrape, probe and directory refresh, with
  stats, warnings and a structured log.
- **Follows** (`cloud_source_follows`): a user follows a source to receive
  its new postings in their inbox, scored with their own profile and budget.
- **Operators** (`ADMIN_EMAILS`) manage the catalog; everyone else reads it.

Everything ships dark behind `JOBS_CLOUD_DISCOVERY_ENABLED` (pipeline) and
`JOBS_CLOUD_AI_ENABLED` (AI fallback), both `false` by default (D-33).

## 2. Data model (`apps/api/migrations-jobs/0002_cloud_discovery.sql`)

### 2.1 `cloud_sources`

Identity (`id csr_…`, unique `slug` = registrable domain of the platform's
directory URL, `name`, `homepage_url`, `listing_url`, `canonical_domain` =
registrable domain after brand redirects), classification (`category`,
`origin ∈ default | directory | operator`, `directory_ref`, `description`),
extraction (`strategy`, `strategy_config`, `rate_limit`, `allow_browser`,
`ai_enabled`), operations (`enabled`, `priority 0–100`, `interval_minutes
60–10080`, `health`, `status_reason`, `auth_required`, `auth_note`,
`terms_url`, `terms_note`), scheduling (`next_run_at`, `lease_id`,
`lease_expires_at`, `consecutive_failures`, `circuit_open_until`), last run
(`last_run_id`, `last_run_status`, `last_run_at`, `last_success_at`,
`last_error_class`, `last_error_message`), `cursor_state`, `stats` (runs,
successes, failures, total duration, last-run found / new / confidence /
warnings, AI calls), `user_modified` (fields an operator edited),
`revision`, timestamps. No `user_id`: catalog rows are not user data.

### 2.2 `cloud_runs`

`id crn_…`, `source_id` (null for directory refreshes), `kind ∈ scrape |
directory | probe`, `trigger ∈ schedule | manual | retry`, `status ∈ queued |
running | succeeded | partial | failed | blocked | auth_required |
rate_limited | unsupported | skipped`, `attempt`, `requested_by`, queued /
started / finished times, `duration_ms`, `strategy`, `stats`, `error_class`
(the cloud taxonomy: 15 §8 + `auth_required`, `engine_unavailable`,
`invalid_config`), `error_message`, `http_status`, `warnings` (≤ 50), `log`
(≤ 100 lines: start, the scraper's page lines, ingest, AI, expiry, fan-out,
finish), `engine_version`. Retained 90 days (hourly purge).

### 2.3 `cloud_source_follows`

`(user_id, source_id)` primary key, `created_at`. User-scoped.

### 2.4 `cloud_state`

Key/value: `seed_hash`, `directory_refreshed_at`, `ai_spend:<YYYY-MM>`
(micro-USD).

### 2.5 Posting columns (ADD COLUMN only)

`cloud_source_id`, `expires_at`, `skills` (JSON), `benefits` (JSON),
`employment_detail` (`employment_type` + `freelance`), `application_method
∈ external_url | email | platform_account | unknown`, `auth_required`,
`raw_metadata` (JSON, ≤ 8 KB from the scraper). Index
`(cloud_source_id, status, last_seen_at)`.

Field mapping of the requested job model: `source_name` = join on the
source; `external_job_id` = `source_job_ref`; `canonical_job_url` =
`canonical_url`; `remote_type` = `workplace_type`; `experience_level` =
`seniority`; `salary_*` = `salary` JSON; `application_url` = `apply_url`;
`extraction_method` / `extraction_confidence` = `extraction.method` /
`.confidence` (provenance also carries `cloud: {source_id, run_id,
strategy}`).

## 3. Scraper protocol (`packages/jobs-contracts/src/cloud.ts`)

The api calls the scraper Worker through the `SCRAPER` service binding (dev:
`SCRAPER_FALLBACK_URL`). Bodies are JSON ≤ 4 MB, protocol `v: 1`.

| Endpoint | Request | Response |
|---|---|---|
| `POST /v1/scrape` | `ScrapeRequest {run_id, source{id, slug, name, homepage_url, listing_url, canonical_domain, strategy, strategy_config, rate_limit, allow_browser}, cursor_state, deadline_ms, ai_fallback}` | `ScrapeResponse {outcome, complete, items: CloudPostingItem[] ≤ 500, ai_candidates ≤ 5, cursor_state, stats, error, warnings, log, engine}` |
| `POST /v1/probe` | `ProbeRequest {url}` | `ProbeResponse {final_url, http_status, reachable, robots, protection, auth_wall, title, meta_description, feeds[], jsonld_job_postings, embedded_json[], job_link_count, text_excerpt, error, log, engine}` |
| `POST /v1/directory` | `DirectoryRequest {directory: DirectoryConfig}` | `DirectoryResponse {final_url, http_status, entries[], error, log, engine}` |
| `GET /healthz` | — | `200` |

A source-level failure is `error` in a `200` answer, never an HTTP error; a
transport failure, non-200 or contract mismatch is `engine_unavailable` on
the api side. The api validates the envelope strictly and each item on its
own, so one malformed item is counted `invalid` without discarding the run.

`CloudPostingItem` = `NormalizedPosting` (15 §10, `source_kind:
generic_listing`, `source_org` = canonical domain, `visibility: public`) +
`extras`. The api recomputes fingerprint, content hash and dedupe group.

## 4. Extraction

### 4.1 Strategies (`cloud-config.ts`, validated by `parseStrategyConfig`)

| Strategy | Config essentials | Notes |
|---|---|---|
| `json_api` | `url`, `items_path`, `skip_items`, `fields{title, url, company, location, posted_at, description_html, salary_*, tags, …}` | Documented public APIs only |
| `rss` | `url`, `title_pattern` (`company_title` / `title_company` / `title`), `separator`, `company_field` / `location_field` / `type_field` (namespaced elements allowed), `fetch_details` | RSS 2.0 and Atom; `fetch_details` reads JSON-LD on each item page |
| `json_ld` | `listing_url`, `detail_link_selector`, `detail_url_pattern`, `listing_jsonld`, `next_page` | schema.org `JobPosting` / `ItemList` |
| `embedded_json` | `url`, `script_selector`, `global_name`, `items_path`, `fields`, `url_base` | `__NEXT_DATA__`, `window.X = {…}` parsed as JSON, never executed |
| `html_selectors` | `url`, `item`, `fields{title, link, company, location, posted_at, …}`, `next_page`, `adaptive`, `detail` | Scrapling CSS with `::text` / `::attr()`; adaptive relocation on a miss |
| `browser` | `html_selectors` + `wait_selector` | Only with `allow_browser`; headless Chromium in the container |
| `ai` | `url` | Page text goes to the AI extractor |
| `none` | — | Never scheduled |

Every config takes `defaults {workplace_type, employment_type, location,
company}` and `attribution`. Rate limits: `min_delay_ms ≥ 1000` (default
2000), `max_pages ≤ 10` (3), `max_items ≤ 500` (200), `max_details ≤ 50`
(20).

### 4.2 Order (D-40)

`json_api` → `rss` → `json_ld` → `embedded_json` → `html_selectors` (+
adaptive) → `browser` → `ai`. A source has one configured strategy, chosen
from that order at audit or probe time.

### 4.3 AI fallback (`apps/api/src/jobs/services/cloud/ai.ts`)

Runs only when `JOBS_CLOUD_AI_ENABLED`, not `AI_DISABLED`, the source's
`ai_enabled`, and the system budget (`JOBS_CLOUD_AI_MONTHLY_BUDGET_USD`,
default $2, tracked in `cloud_state`) has room for the estimate. The scraper
returns ≤ 5 text excerpts (≤ 8 KB) when the configured extraction found
nothing or the strategy is `ai`; the api reads ≤ 3 per run.

- `structured()` with the strict `CloudAiExtraction` schema; the page text is
  fenced as untrusted data; instructions forbid guessing.
- Grounding: the title (and the company unless a source default applies)
  must appear verbatim in the page text; the URL must be same-site; expired
  or below `JOBS_CLOUD_AI_MIN_CONFIDENCE` (0.5) jobs are dropped; confidence
  is capped at 0.7; method `ai`; every rejection is a counted warning.
- Fraud signals from the model and deterministic heuristics become
  `extraction.flags: ["suspicious:<reason>"]` plus a warning.
- Directory classification uses `decide()` with a category choice only when
  the deterministic probe rules leave `unknown`.

## 5. API and dashboard

Routes: 05 §15. Status shown = `DISABLED` (switched off) → `SCRAPING` (leased)
→ `health` (`ACTIVE`, `FAILED`, `BLOCKED`, `AUTH_REQUIRED`, `RATE_LIMITED`,
`UNSUPPORTED`).

### 5.3 Follows

`PUT …/follow` backfills ≤ 50 open postings first seen in the last 14 days;
every later run links its new postings (≤ 100 per follower per run) as
`user_jobs (origin discovered, inbox new, source_id = csr_…)` with change-log
rows for the link and the posting, then queues scoring through 07 §7.1.
`DELETE …/follow` keeps existing inbox entries. The inbox filter and
provenance accept `csr_` ids and show the board name.

### 5.4 Operators

`ADMIN_EMAILS` callers create, edit (revisioned, changed fields join
`user_modified`), run, retry (closes the breaker, clears BLOCKED /
AUTH_REQUIRED / RATE_LIMITED) and re-probe sources and refresh the
directory. Others get `403 operator_required`.

### 5.5 Dashboard (`apps/jobs` `/sources`)

A "Remote job boards" band above the CLI sources (platforms that are not job boards are stored but not listed, `isListed` in `services/cloud/catalog.ts`): pipeline notice, filters
(status group, following, search), a table (status with reason, category,
strategy, origin, last success / next check, jobs total / new, success rate,
average duration, follow switch) and a sheet with diagnostics, auth and terms
notes, attribution, stats, recent runs with expandable logs and warnings,
and the operator editor (enable, priority, interval, strategy + validated
config, rate limits, AI, browser, health override, notes, run / retry /
re-probe). See `apps/jobs/CLAUDE.md`.

## 6. Scheduling and reliability

### 6.1 Dispatch (`cron/handlers/cloud.ts`, `0 * * * *`)

Flag off → nothing. Sync the seed catalog if its hash changed; select due
sources (enabled, health ∈ ACTIVE / FAILED / RATE_LIMITED, strategy ≠ none,
`next_run_at ≤ now`, breaker closed, no live lease; `priority DESC`; ≤ 50);
insert a `queued` run per source and move `next_run_at` forward by the
interval in one batch; send one `scrape_source` message each. Weekly
directory refresh; purge runs older than 90 days. The cron never scrapes.

### 6.2 Consumer (`cloud/runner.ts`, queue `jobs-scrape`)

`max_batch_size 1`, `max_concurrency 4`, `max_retries 3`, DLQ
`jobs-scrape-dlq`. Per message: run gone or final → ack (idempotent
redelivery); flag off → `skipped`; source missing → `failed`; not
schedulable → `skipped`; lease (`lease_id` = run id, 15 min, re-entrant)
held by another run → `skipped` (never overlap); call the scraper with the
checkpoint; ingest; AI fallback; expiry; fan-out; one write closes the run
and updates the source, fenced on the lease.

### 6.3 Failures

| Error class | Run status | Health | Retry |
|---|---|---|---|
| `network`, `timeout`, `http_5xx`, `source_unavailable`, `engine_unavailable` | retried, then `failed` | FAILED after the last try | ≤ 3, `min(900, 60·2^(n−1))·U(0.8,1.2)` s |
| `access_denied`, `challenge_detected`, `robots_disallowed`, `policy_blocked` | `blocked` | BLOCKED (paused until an operator retries) | no |
| `rate_limited` | `rate_limited` | RATE_LIMITED, next run ≥ max(Retry-After, 2 h) | no |
| `auth_required` | `auth_required` | AUTH_REQUIRED (paused) | no |
| layout / config (`parse_error`, `schema_invalid`, `selector_drift`, `unsupported_content`, `invalid_config`, `not_found`, `source_closed`) | `failed` | FAILED | next scheduled run |

A transient stop after stored items is `partial` and counts as a success.
Pages read without any extracted job is `parse_error` ("layout changed").
Three consecutive failures open the breaker for `min(24 h, 1 h·2^(n−3))`.
Each failure stores an actionable `status_reason` (`health.ts`
`diagnosticMessage`). The DLQ handler closes a run that kept throwing and
releases its lease. The `*/5` reaper clears expired leases and fails runs
untouched for 30 minutes.

### 6.4 Checkpoints

`cursor_state {listing etag/last_modified, resume_url, resume_page,
detail_seen ≤ 500, last_complete_at}` is saved after every run and before a
retry; the scraper resumes paging from it.

### 6.5 Ingestion, dedupe and expiry (`services/cloud/ingest.ts`)

Items are forced public with the server's `observed_at`, deduplicated within
the run, validated by the `postings:batch` validator, and merged in chunks of
50 by the `postings:batch` planner in system mode (no caller links).
Unchanged postings get one bulk sighting statement per 90; new and changed
postings get their cloud columns. The `gen|` fingerprint (domain, title,
location, canonical URL) keeps two vacancies with the same title and employer
but different URLs apart; copies across boards share a `dedupe_group` and
are grouped in the inbox (15 §11). After a complete, error-free read,
postings of the source not seen in the run get `missed_runs + 1` and close at
2 (or past `expires_at`), with a change row for every linked user.

### 6.6 Scheduler fallback (Durable Object alarm clock)

Cloudflare did not dispatch the Cron Triggers added to `api-pilihpendidikan`
after 2026-10-06 (incident "Workers – Cron Trigger Activation Issues",
2026-10-13/14): only the original `0 3 * * *` fired, so neither the hourly
dispatch nor the `*/5` lease reaper ran. The scraper Worker therefore hosts a
`DispatchClock` Durable Object whose **alarm** (independent of Cron Trigger
activation) fires 30 s after every 5-minute boundary (UTC) and calls the api's
private RPC entrypoint `CloudScheduler.tick(cron)` (service binding with
`entrypoint: "CloudScheduler"`, no route): `*/5 * * * *` every time, then
`0 * * * *` on the hour. The alarm re-arms itself even when a tick fails and
stores its last tick (`GET /clock` on the scraper Worker). It is armed by the
api (at most once per isolate every 10 min, from requests and its working daily
cron, `POST /clock/ensure`) and by the scraper's own hourly cron (watchdog).
Double ticks are harmless: the reaper and expiry jobs are idempotent and the
dispatch moves `next_run_at` forward; the 30 s offset keeps the clock clear of
the api's own crons once Cloudflare dispatches them again.

## 7. Source discovery

### 7.1 Seed catalog

`cloud-sources.json` holds the directory config
(`https://bahrul.me/tools?category=remote-jobs`, list
`#resources-remote-jobs-list`) and one audited entry per platform: the 78
directory entries plus `remotefreelance.id` and `workfromhome.id`. Every
entry was checked against the live site on 2026-10-13 with the honest UA
(robots.txt, reachability, feeds, JSON-LD, embedded data, protection, login
walls, terms), and keeps its evidence lines. Sync rules: insert new slugs;
for known slugs update seed-managed fields except those in `user_modified`;
never touch `enabled`, `health`, `status_reason`, schedule, stats or cursor.

Audit result (2026-10-13, after the live smoke of every usable board; the full audit table is `docs/cloud-discovery/source-audit-2026-10-13.md`):

| Seed status | Count | Platforms |
|---|---|---|
| ACTIVE, enabled | 7 | We Work Remotely (rss, 89 jobs), Remote OK (json_api, 99, attribution required), Jobspresso (rss, 10), Workew (rss, 10), JustRemote (embedded_json, 84), Remote Freelance ID (json_ld ItemList, 12 per page), Work From Home ID (html_selectors + JSON-LD details, 10 per page) |
| ACTIVE, disabled pending owner review | 2 | Working Nomads (json_api works, 51 jobs; terms ban using the service "to build a competitive product"), Dynamite Jobs (JavaScript listing: only 6 featured jobs without a browser) |
| BLOCKED | 18 | 9 refuse our honest client: Remote.co, FlexJobs, SimplyHired, Stack Overflow, Behance, Fancy Hands, Remotive (Cloudflare challenge even on robots.txt; also held back for its API terms), Hubstaff Talent (challenge in headless Chromium), ProBlogger (reCAPTCHA on job pages, no company in the feed). 9 are restricted by terms or robots: SkipTheDrive, EuropeRemotely, Crossover, Dice, Wellfound/AngelList, Dribbble, Coroflot, Teach Away, and Y Combinator Jobs (added on request 2026-10-14; its terms forbid scraping) |
| AUTH_REQUIRED | 1 | Virtual Vocations (paid membership) |
| UNSUPPORTED | 41 | Freelance marketplaces, talent networks, staffing / VA services, tutoring platforms, content services, one community |
| UNSUPPORTED, disabled (gone) | 12 | Pangian, Remote Global, Outsourcely, CloudPeeps, Hired, GitHub Jobs, HackerRank Jobs, Envato Studio, Working Not Working, Contena, Virtual Assistant Jobs, Chegg Tutors |

### 7.2 Directory refresh (`cloud/directory.ts`)

Weekly and on demand: read the directory through the scraper; skip the
directory's own host and invalid URLs; match entries by slug and canonical
domain; refresh `directory_ref` / `description` on known sources unless
operator-edited; register at most 20 new platforms per refresh as disabled
`UNSUPPORTED` "probing" rows and queue a probe for each. The probe decides
(`classify.ts`): protection, robots or a challenge → BLOCKED; login wall →
AUTH_REQUIRED; unreachable → defunct, disabled; a verified RSS/Atom feed with
items → `rss` strategy, enabled (the only automatic enable); JSON-LD or ≥ 5
job links → job board, disabled until an operator configures it; nothing →
UNSUPPORTED.

## 8. Security

- SSRF: the api refuses non-http(s) schemes, userinfo, non-default ports, IP
  literals, local and internal host names and D-17 platforms at
  registration; the scraper repeats the checks with DNS resolution before
  every attempt, robots.txt included (every resolved address must be public
  unicast; loopback, RFC 1918, ULA, link-local, CGNAT, NAT64 / IPv4-mapped
  forms and metadata endpoints are refused), curl refuses redirects to private
  addresses (`follow_redirects="safe"`), and the final URL is re-resolved and
  re-checked after the response; timeouts, size and page caps apply.
  **[LIMITATION]** Scrapling does not expose curl's connected address, so a
  DNS answer that changes between the check and curl's connect (rebinding) is
  only caught by the post-response re-check, not at the socket; bodies over
  5 MB are discarded after download; the browser strategy guards the
  top-level page only.
- Scraped content is stored as plain text and rendered as text; links pass
  `safeHref`.
- AI input is fenced untrusted text; outputs are schema-validated and cannot
  trigger actions.
- No credentials are collected or used for discovery; the scraper has no
  secrets; the scraper Worker has no public route.
- 8.6 Diagnostics never suggest bypassing a protection.

## 9. Operations

- Local: `apps/api` with `SCRAPER_FALLBACK_URL=http://localhost:8791` and
  `bun run dev:python` in `apps/jobs-scraper` (or its `wrangler dev` with
  Docker on :8792); `bun run db:seed:local` turns the pipeline flag on.
  Trigger the hourly cron with `curl "http://localhost:8788/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"`
  (wrangler dev `--test-scheduled`) or use "Run now" in `/sources`.
- Deploy order: `DEPLOY.md` § Cloud discovery.
- Cost (Workers Paid list prices, Oct 2026): ≈ $1–2 / month for the
  container (basic instance, active-CPU billing, 5 min sleep), queue
  operations and D1 writes well inside the included allowances; AI capped by
  its budget.

## 10. Limitations

- Adaptive selector fingerprints live on the container's ephemeral disk and
  are rebuilt after a restart.
- Boards whose listings render client-side need the opt-in browser strategy
  and selectors configured by an operator.
- Free feeds carry only recent jobs (Remotive's API holds 16, delayed 24 h;
  Jobspresso / Workew feeds the latest 10).
- Remote Freelance ID re-lists Upwork, SEEK and Glints jobs; their apply
  links need an account on those platforms (`application_method:
  platform_account`).
