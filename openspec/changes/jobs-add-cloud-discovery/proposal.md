# Change: Cloud discovery of remote-job boards

## Why

Discovery runs only on the user's machine today (D-16, D-36): nothing is
found unless a CLI is installed, logged in and running, and no one sees the
public remote-job boards (We Work Remotely, Remotive, Remote OK, the two
Indonesian boards, …) unless they configure each one by hand. The owner
wants a server-side pipeline that keeps a curated catalog of remote-job
boards fresh every hour, on Cloudflare, without giving up the discovery
rules the CLI already enforces (honest identity, robots.txt, no protection
bypass, error taxonomy).

## What Changes

- **Cloud source catalog** (`JOBS_DB.cloud_sources`): system-wide remote-job
  boards seeded from an audited list (the `bahrul.me` remote-jobs directory
  plus `remotefreelance.id/jobs` and `workfromhome.id`), each with a
  category, strategy, priority, interval, health, status note, terms note
  and run statistics. Non-boards (marketplaces, tutoring, staffing,
  defunct) are registered as `UNSUPPORTED`/`DISABLED` so the audit is
  visible; nothing is scraped without verification.
- **Directory discovery**: a weekly (and on-demand) refresh re-reads the
  directory, registers new platforms by canonical domain, probes each new one
  (robots, feeds, JSON-LD, protection, login walls) and never re-enables,
  duplicates or overwrites an operator-edited source.
- **Hourly pipeline**: cron `0 * * * *` enqueues one message per due source
  on the new queue `jobs-scrape` (+ `jobs-scrape-dlq`); the consumer takes a
  D1 lease per source (no overlap), calls the scraper, upserts postings
  through the existing posting merge (fingerprint + `dedupe_group`), links
  new postings to followers, queues scoring, closes postings missing from two
  complete runs, and records a run with stats, warnings and a structured log.
  Bounded exponential backoff with jitter, a per-source circuit breaker and a
  DLQ handler.
- **Scraper runtime** (`apps/jobs-scraper`, new): a Worker with a
  Cloudflare Container running a Python service that reuses the CLI's
  `ScraplingJobEngine` (robots gate, politeness, error classification,
  forbidden-feature guard) plus cloud strategies: JSON API, RSS/Atom,
  JSON-LD `JobPosting`, embedded JSON, CSS selectors with Scrapling adaptive
  relocation, opt-in browser rendering (Playwright), and page excerpts for
  the AI fallback. SSRF guard (public addresses only before every attempt,
  safe redirects, final-URL re-check), timeouts, size and page caps.
- **AI fallback** (optional, behind `JOBS_CLOUD_AI_ENABLED` + per-source
  `ai_enabled` + a system budget `JOBS_CLOUD_AI_MONTHLY_BUDGET_USD`): schema
  validated extraction from page excerpts and directory classification,
  through the existing provider (OpenRouter/OpenAI), never inventing fields,
  confidence-capped, injection-resistant.
- **Posting columns**: `cloud_source_id`, `expires_at`, `skills`, `benefits`,
  `employment_detail` (adds `freelance`), `application_method`,
  `auth_required`, `raw_metadata` (ALTER TABLE ADD COLUMN only).
- **API** (`/api/v1/cloud-sources…`, `/api/v1/cloud-discovery…`): list,
  detail, runs, follow/unfollow for every user; create, edit, run, retry and
  refresh for operators (`ADMIN_EMAILS`), new error code `operator_required`.
- **Dashboard** `/sources`: a "Remote job boards" section with status, health,
  stats, follow switches, diagnostics, run logs and operator controls.
- Flags `JOBS_CLOUD_DISCOVERY_ENABLED` and `JOBS_CLOUD_AI_ENABLED` (dark).
- Decisions D-37 … D-41 amend D-06 (second queue), D-16 (server-side
  scraping allowed under the same guard) and D-36 (server-side Python
  consumer of the engine).

## Impact

- Affected specs: `jobs-tracker-api`, `jobs-dashboard`, new `jobs-cloud-scraper`
- Affected code: `packages/jobs-contracts` (enums, ids, records, `api/cloud.ts`,
  `cloud.ts`, `cloud-sources.json`), `apps/api` (migration
  `0002_cloud_discovery.sql`, `src/jobs/{repo,services,routes}/cloud`,
  `src/jobs/cloud/*` consumer + cron, `wrangler.jsonc`), `apps/jobs`
  (`/sources`, BFF route keys, mock api, i18n), `apps/jobs-cli` (engine
  network guard hook), new `apps/jobs-scraper`, `job-tracker-spec/24`,
  `00-README.md`, `DEPLOY.md`, `CLAUDE.md`
- New Cloudflare resources: queues `jobs-scrape`, `jobs-scrape-dlq`; Worker
  `jobs-scraper-pilihpendidikan` with a Container (Workers Paid plan).
