# Design: cloud discovery of remote-job boards

Normative detail lives in `job-tracker-spec/24-CLOUD-DISCOVERY.md`; this file
records the decisions and the cross-package contracts the three workstreams
(api, scraper, dashboard) build against.

## Context

- Discovery today is local (15, D-16, D-36). The CLI's `pilih_jobs.discovery`
  already has the engine we need: `ScraplingJobEngine` (honest UA, robots
  gate, politeness scheduler, retry policy, response classification incl.
  challenge detection, the forbidden-feature guard), JSON-LD parsing,
  normalization and the `fp1` fingerprint.
- `apps/api` already ingests normalized postings (`postings:batch`): server
  validation, fingerprint recompute, field-level merge, `dedupe_group`, change
  log fan-out, scoring queue.
- Cloudflare Workers cannot run Python, curl_cffi or Chromium. Cloudflare
  Containers (Workers Paid) can, and are driven from a Durable Object.

## Decisions

### D-37 Server-side discovery is allowed, under the CLI's rules

The cloud pipeline may fetch public job boards. Every rule of 15 still
applies: honest identity (`pilih-jobs/<ver> (+https://pilihpendidikan.com/bot)`),
robots.txt always obeyed, no stealth fetchers, no CAPTCHA/challenge solving,
no proxies, no login, LinkedIn/Indeed excluded, an `access_denied` or
`challenge_detected` stops the source. A board whose listings need an
account is `AUTH_REQUIRED` and is never fetched past the wall.

### D-38 Topology: Worker cron → Queue → Worker consumer → Scraper Worker → Container

```
apps/api (api-pilihpendidikan)                         apps/jobs-scraper (jobs-scraper-pilihpendidikan)
 cron "0 * * * *"  ── due sources ──▶ queue jobs-scrape ──▶ consumer (apps/api)
                                                          │ lease cloud_sources row (D1)
                                                          │ POST /v1/scrape ── service binding SCRAPER ──▶ Worker ──▶ ScraperContainer (DO)
                                                          │                                                   └─ Python: uvicorn + pilih_scraper
                                                          │                                                        └─ pilih_jobs ScraplingJobEngine
                                                          │ ◀── ScrapeResponse (normalized items, log, cursor)
                                                          │ upsert job_postings (repo), runs, health, fan-out, scoring
                                                          ▼ ack / retry(backoff) / DLQ
```

- The scraper is a **separate Worker** so `apps/api` keeps building and
  running without Docker, deploys independently, and stays the only writer of
  `JOBS_DB` (04 §5). It has no routes and `workers_dev: false`: only the
  service binding reaches it. The container instance is chosen by
  `hash(canonical_domain) % SCRAPER_POOL_SIZE` so one domain always lands on
  the same process and the engine's per-domain politeness holds.
- Dev: `apps/api` binds `SCRAPER`; when the binding is absent it uses
  `SCRAPER_FALLBACK_URL` (`.dev.vars`, dev only) — the Python service run with
  `uv run pilih-scraper serve` on `:8791`, or `wrangler dev` of
  `apps/jobs-scraper` (Docker) on `:8792`.
- Queue `jobs-scrape`: `max_batch_size: 1`, `max_concurrency: 4`,
  `max_retries: 3`, DLQ `jobs-scrape-dlq` (D-06 amended: a second queue,
  because scraping has different batch, concurrency and retry needs than AI
  work and must not starve it).

### D-39 One system catalog, per-user follows

Cloud sources are system rows (`cloud_sources`, no `user_id`), scraped once
for everyone; postings are `visibility = public`. A user **follows** a source
(`cloud_source_follows`) to get its new postings in their inbox (origin
`discovered`, `user_jobs.source_id = csr_…`) and scored with their own budget.
Following backfills up to 50 open postings first seen in the last 14 days.
Operators (`ADMIN_EMAILS`) manage the catalog; everyone else reads it.
Non-operators get `403 operator_required` on operator routes.

### D-40 Deterministic first, AI last

Strategy order per source: `json_api` → `rss` → `json_ld` → `embedded_json`
→ `html_selectors` (Scrapling adaptive relocation on a selector miss) →
`browser` (opt-in, only with `allow_browser`) → `ai`. A source has one
configured strategy; the scraper always tries JSON-LD on detail pages it
fetches. AI runs in `apps/api` (D-12) only when `JOBS_CLOUD_AI_ENABLED`, the
source's `ai_enabled`, `AI_DISABLED` is off and the system budget has room:

- extraction fallback: the scraper returns ≤ 5 page excerpts (`ai_candidates`,
  ≤ 8 KB text each) when the configured extraction found nothing or a page is
  marked `ai`; `structured()` returns `CloudAiExtraction`; a job without a
  same-site absolute URL is dropped; confidence = min(model, 0.7); method
  `ai`; never fills a field the text does not contain (instructions + a
  verbatim-substring check on title and company);
- directory classification: `decide()` chooses a category for a probed site
  whose deterministic signals are inconclusive.
- Deterministic heuristics (no AI) flag suspicious postings
  (`extraction.flags: ["suspicious:<reason>"]`): upfront fees, messaging-app
  only contact, crypto/wire payment requests, implausible pay.

### D-41 Data model: extend, never fork

- `job_postings` gains nullable/defaulted columns (ADD COLUMN only, no table
  rebuild, no CHECK change): `cloud_source_id`, `expires_at`, `skills`,
  `benefits`, `employment_detail`, `application_method`, `auth_required`,
  `raw_metadata`. Cloud postings use `source_kind = 'generic_listing'`,
  `source_org = <canonical domain>`, `source_job_ref = <external id>`; the
  fingerprint is the `gen|` key (domain + title + location + canonical URL),
  so two vacancies with the same title and employer but different URLs never
  merge, and cross-board copies share a `dedupe_group` instead.
- `employment_detail` ⊇ `employment_type` plus `freelance`
  (`employment_type` stays `contract` for freelance roles).
- `EXTRACTION_METHODS` gains `rss`, `embedded_json`, `ai`.
- Field mapping of the requested job model: `source_name` = join on
  `cloud_sources.name`; `external_job_id` = `source_job_ref`;
  `canonical_job_url` = `canonical_url`; `remote_type` = `workplace_type`;
  `experience_level` = `seniority`; `salary_*` = `salary` JSON;
  `application_url` = `apply_url`; `extraction_method` /
  `extraction_confidence` = `extraction.method` / `.confidence`.

## Scraper protocol (`packages/jobs-contracts/src/cloud.ts`)

`POST /v1/scrape` — body `ScrapeRequest`, answer `ScrapeResponse` (always 200
when the service ran; a fatal source error is `error`, not an HTTP error).
`POST /v1/probe` — `ProbeRequest` → `ProbeResponse`. `POST /v1/directory` —
`DirectoryRequest` → `DirectoryResponse`. `GET /healthz`. Every body is JSON
≤ 4 MB. Field lists are in the contract; the essentials:

- `ScrapeRequest {v: 1, run_id, source: {id, slug, name, homepage_url,
  listing_url, canonical_domain, strategy, strategy_config, rate_limit,
  allow_browser, default_workplace}, cursor_state, deadline_ms, ai_fallback}`
- `ScrapeResponse {v: 1, outcome: ok|partial|failed, complete, items:
  CloudPostingItem[], ai_candidates, cursor_state, stats, error|null,
  warnings, log, engine}` where `CloudPostingItem` = `NormalizedPosting` +
  `extras {skills, benefits, expires_at, employment_detail,
  application_method, auth_required, raw_metadata}`.

## Scheduling, leases, retries

- Cron `0 * * * *` (`cloud-dispatch`): flag off → nothing. Due = enabled,
  `health ∈ {ACTIVE, FAILED, RATE_LIMITED}`, strategy ≠ `none`, `next_run_at ≤
  now`, breaker closed, no live lease; order `priority DESC, next_run_at`;
  ≤ 50 per tick. Each gets a `cloud_runs` row (`queued`) and `next_run_at =
  now + interval` in the same batch, then one queue message. Weekly directory
  refresh when the last one is > 7 days old.
- Cron `*/5` (`cloud-reaper`): leases past `lease_expires_at` are cleared and
  their `running` runs become `failed` (`timeout`); the next tick resumes from
  the stored `cursor_state` (checkpoint after every completed page).
- Consumer: lease (`UPDATE … WHERE lease_expires_at IS NULL OR < now
  RETURNING`, 15 min) → overlap = run `skipped`, ack. Transient errors
  (`network`, `timeout`, `http_5xx`, scraper unreachable) → `retry` with
  `delay = min(900, 60·2^(attempt−1)) · U(0.8, 1.2)` s, ≤ 3 retries, then the
  DLQ marks the run failed. Non-retryable classes set health directly:
  `access_denied`/`challenge_detected`/`robots_disallowed` → `BLOCKED`,
  `rate_limited` → `RATE_LIMITED` (next run ≥ Retry-After, ≥ 2 h),
  `auth_required` → `AUTH_REQUIRED`, `parse_error`/`schema_invalid`/
  `unsupported_content` → `FAILED` with the layout-change diagnostic.
- Breaker: 3 consecutive failures open it for `min(24 h, 1 h · 2^(n−3))`;
  `BLOCKED`/`AUTH_REQUIRED` sources are not scheduled until an operator retries.
- Status shown = `DISABLED` if not enabled, else `SCRAPING` while leased,
  else `health`.

## Security

- SSRF: http(s) only, default ports, no credentials in URLs; the host must
  resolve only to public unicast addresses (no loopback, RFC 1918, link-local,
  CGNAT, ULA, multicast, metadata `169.254.169.254`/`fd00:ec2::254`); curl's
  `follow_redirects="safe"` rejects private redirect targets and the scraper
  re-validates every hop; the final URL is re-resolved and re-checked after
  the response. Scrapling hides curl's connected address, so DNS rebinding
  between the check and the connect is a documented residual risk. Timeouts 20 s per request, bodies ≤ 5 MB, ≤ 10
  listing pages, ≤ 50 detail pages, crawl depth 1.
- Source URLs are validated in the api (same rules minus DNS) before
  registration and again in the scraper before every fetch.
- Scraped text is plain text in `JOBS_DB` and renders through `PlainText`
  (no HTML reaches the browser). AI prompts wrap page text as untrusted data;
  outputs are schema-validated and cannot trigger actions.
- The browser strategy runs Chromium inside the container only, headless,
  with a disposable profile; page scripts never run outside it.

## Cost (Workers Paid, Oct 2026 list prices)

About 25 schedulable boards × 24 runs/day, ~10 s container time each ≈ 70 h
of `basic` instance time per month (with a 5 min `sleepAfter`): memory 70
GiB-h (25 included) ≈ $0.40, CPU (active only) ≈ $0.70, disk ≈ $0.02, egress
inside the 1 TB allowance; queue operations ≈ 2,200/day (1 M/month included);
D1 writes ≈ 4–6 M rows/month (50 M included). Expected ≈ $1–2/month on top of
the $5 Workers Paid plan; AI capped by `JOBS_CLOUD_AI_MONTHLY_BUDGET_USD`
(default $2).

## Risks / trade-offs

- Containers cold-start in seconds; the consumer allows 4 min per scrape.
- Adaptive selector fingerprints live on the container's ephemeral disk and
  are rebuilt after a restart (logged as a warning, not an error).
- One shared catalog means one operator mistake affects every follower:
  every operator write is revisioned and logged with the operator's user id.
