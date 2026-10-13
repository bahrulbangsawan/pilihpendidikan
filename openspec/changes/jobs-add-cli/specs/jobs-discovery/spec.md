## ADDED Requirements

### Requirement: Scrapling engine boundary
Discovery SHALL call Scrapling (`scrapling[fetchers]==0.4.15`) in-process only
through `ScraplingJobEngine` in `pilih_jobs/discovery/engine/`, which MUST be
the only module tree that imports `scrapling`; the CLI MUST NOT shell out to
the `scrapling` CLI or run `scrapling mcp`, and adapters reach the network only
through the engine. (Source: 15 §2, §4, §14.2; D-36)

#### Scenario: Import outside the engine
- **WHEN** a module outside `discovery/engine/` imports `scrapling`
- **THEN** the policy test fails

### Requirement: Forbidden-feature guard
The CLI SHALL enforce, at three layers, that `StealthyFetcher`,
`StealthySession`, `AsyncStealthySession`, `ProxyRotator`, `solve_cloudflare`,
`hide_canvas`, `block_webrtc`, `patchright`, `scrapling.cli` and
`scrapling.mcp` are never used: an AST test over `src/pilih_jobs/`, an
import-time `sys.meta_path` finder that raises `PolicyViolation` on
`patchright` or the stealth fetcher module, and an allow-list of engine
kwargs that rejects `solve_cloudflare`, `impersonate`, `stealthy_headers`,
`proxy_rotator` and `google_search` before any request. (Source: 15 §13;
D-16)

#### Scenario: Stealth import at runtime
- **WHEN** code in the CLI process imports `scrapling.fetchers.stealth_chrome` or `patchright`
- **THEN** `PolicyViolation` is raised

#### Scenario: Proxy rotation requested
- **WHEN** a source config tries to pass a proxy rotator
- **THEN** the engine refuses before any network call

### Requirement: Fetch strategy without escalation
Each adapter SHALL declare its fetch mode in the manifest and the engine SHALL
use `JSON_API`, then `STATIC_HTML`, then `BROWSER` only when the manifest
requires a browser and the source opted in (`allow_browser`, default false),
failing with `unsupported_content` otherwise; a 403 or a challenge MUST NOT
cause a retry in another mode. (Source: 15 §5)

#### Scenario: 403 on a JSON API
- **WHEN** a JSON API source answers 403
- **THEN** the source stops with `access_denied` and no browser fetch is attempted

### Requirement: Honest identity and politeness
Discovery SHALL send `User-Agent: pilih-jobs/<ver> (+https://pilihpendidikan.com/bot)`,
use no proxies other than the user's `HTTPS_PROXY`, always obey robots.txt
(honouring a larger `Crawl-delay`, skipping disallowed paths as
`robots_disallowed` without a fallback path), and enforce as minimums 4
concurrent requests overall, ≤ 2 per registrable domain for JSON APIs and 1
for HTML, ≥ 1.0 s (HTML ≥ 2.0 s) between requests to one domain with jitter,
and 50 listing pages / 2,000 detail fetches per source per run; users may only
be more polite. (Source: 15 §7.1; C-12)

#### Scenario: robots disallow
- **WHEN** robots.txt disallows a listing path
- **THEN** the URL is skipped and recorded as `robots_disallowed`

### Requirement: Wrapper-owned retries
Scrapling fetchers SHALL be called with `retries=0` and the wrapper SHALL
retry only retryable classes with
`min(120 s, 2 s · 2^(attempt-1)) · uniform(0.8, 1.2)`, at most 4 attempts for
network/timeout/5xx and 3 for 429, waiting `max(Retry-After, delay)` up to
15 min and stopping the source as `rate_limited` beyond that. (Source:
15 §7.2)

#### Scenario: Retry-After beyond the cap
- **WHEN** a source answers 429 with `Retry-After: 3600`
- **THEN** the source stops for this run with `rate_limited`

### Requirement: Error classification and run status
Every discovery failure SHALL be classified as one of `network`, `timeout`,
`http_5xx`, `rate_limited`, `access_denied`, `challenge_detected`,
`robots_disallowed`, `not_found`, `source_closed`, `parse_error`,
`schema_invalid`, `selector_drift`, `unsupported_content`, `policy_blocked`
or `cancelled`, with `access_denied` and `challenge_detected` stopping the
source immediately and never being solved or bypassed; a run MUST end
`completed`, `partial`, `failed` or `cancelled` as 15 §8 defines. (Source:
15 §8; D-16)

#### Scenario: Challenge page
- **WHEN** a listing returns a CAPTCHA or JS challenge interstitial
- **THEN** the source stops with `challenge_detected` and the run is `partial`

### Requirement: Normalization, validation and fingerprints
Adapters SHALL normalize postings into the `postings:batch` item shape per
15 §10.1 (title ≤ 300 chars, locations split and mapped, workplace and
employment enums, salary objects, description text ≤ 64 KB with a truncation
flag, requirements, canonical `apply_url`), reject items without title,
company and an https URL or with `javascript:`/`data:` URLs, flag thin
descriptions, and compute the `fp1` fingerprint and content hash with the
contract rules. (Source: 15 §10; 03 §4.2)

#### Scenario: Missing title
- **WHEN** an API item has no title
- **THEN** the item is dropped as `schema_invalid` or `parse_error` and counted

### Requirement: Provenance and deduplication
Each uploaded posting SHALL carry `extraction` provenance (adapter and
version, engine versions, fetch mode, method, source URLs, confidence,
flags, `observed_at`, run and device ids), and duplicates SHALL be removed in
run (first occurrence wins), locally (a fingerprint with the same content
hash in `seen_postings` uploaded within 24 h is sent as an unchanged-only
item) and on the server (unique fingerprint index and `dedupe_group`).
(Source: 15 §11; 20 §7)

#### Scenario: Unchanged posting
- **WHEN** a posting is rediscovered with the same content hash within 24 h
- **THEN** only `{client_ref, fingerprint, content_hash, observed_at}` is sent

### Requirement: Incremental crawling and expiry
Adapters SHALL keep `cursor_state` (ETag / Last-Modified, watermarks, content
hashes) and report it with the run's completion, list a source in
`complete_sources[]` only when every listing page was fetched without a
stopping error, and `discover --check-tracked` SHALL re-check tracked open
postings at most once per 24 h, uploading `status_hint` with
`status_evidence`. (Source: 15 §9, §12)

#### Scenario: 304 listing
- **WHEN** a listing answers 304 Not Modified
- **THEN** every posting of the last successful run counts as seen without refetching

### Requirement: Official ATS adapters
The registry SHALL provide `greenhouse` (`boards-api.greenhouse.io` board
API, `{board_token}`), `lever` (`api.lever.co` / `api.eu.lever.co` postings
API with offset pagination of 100, `{site, region}`) and `ashby`
(`api.ashbyhq.com` posting API, skipping `isListed=false`,
`{job_board_name}`) as stable, unauthenticated JSON adapters registered
statically in `pilih_jobs/adapters`, each tested against recorded fixtures.
(Source: 15 §14.1–§14.3; 13 M2)

#### Scenario: Greenhouse board
- **WHEN** `pilih-jobs discover --source greenhouse:acme` runs against the recorded board
- **THEN** every listed job is normalized with `source_job_ref` = the job id and confidence ≥ 0.95

### Requirement: Excluded sources
LinkedIn and Indeed SHALL be refused by the CLI registry (`policy_blocked`,
exit 9) before any request, by `custom_url` host checks, and by the server
with `422 unsupported_source` on source create or update, including configs
whose URLs point at an excluded host; exclusions come from the `excluded`
entries of `adapters.json`. (Source: 15 §14.4; D-17)

#### Scenario: CLI refuses LinkedIn
- **WHEN** a user runs `pilih-jobs discover --url https://www.linkedin.com/jobs/view/1`
- **THEN** the CLI exits 9 and makes no network request

#### Scenario: API refuses Indeed
- **WHEN** `POST /api/v1/sources` names an Indeed URL
- **THEN** the response is 422 `unsupported_source`

### Requirement: Discover command and progress
`pilih-jobs discover` SHALL accept `--source` (repeatable), `--all`, `--url`,
`--keywords`, `--location`, `--private`, `--check-tracked`, `--max-pages`,
`--dry-run` and `--reset-adaptive`, create the run, stream `source_started`,
`page_fetched`, `item`, `source_stopped`, `source_finished`, `sync` and
`run_finished` events (NDJSON with `--json`, progress bars on a TTY), and send
the run create, batches and completion through the outbox so an offline run
syncs later. (Source: 15 §15; 16 §3.3; 20 §7)

#### Scenario: Offline discovery
- **WHEN** discovery runs with the network down
- **THEN** the run and its batches wait in the outbox and are uploaded by the next `sync`

### Requirement: Sources API
`/api/v1/sources` SHALL list (`jobs:read`), create, update with
`base_revision` and delete (`jobs:write`) user sources, validating `adapter`
and `config` against the adapter manifest config schemas, and
`GET /api/v1/sources/adapters` SHALL serve the manifests from
`adapters.json`. (Source: 05 §4; 15 §14.1)

#### Scenario: Invalid config
- **WHEN** a Greenhouse source is created without `board_token`
- **THEN** the response is 400 `invalid_request`

### Requirement: Discovery runs and posting batches
`POST /api/v1/discovery/runs` (`discovery:write`) SHALL create a run by its
client `run_` id within ±24 h clock skew, idempotently; `postings:batch` SHALL
accept ≤ 100 items and ≤ 1 MB, recompute every fingerprint (mismatch → item
`invalid`), upsert shared public or private postings with a merge that never
rolls content back for an older `observed_at`, create `user_jobs` without
downgrading tracked or dismissed ones, record run items, enqueue scoring and
answer per item `new|updated|unchanged|invalid`; `complete` SHALL increment
`missed_runs` only for sources listed complete and close postings at 2.
(Source: 05 §4; 20 §6.2, §7; 03 §4.3)

#### Scenario: Re-run
- **WHEN** the same discovery runs twice
- **THEN** the second run reports every item `unchanged`

#### Scenario: Removed postings
- **WHEN** three postings are absent from two complete runs
- **THEN** they are `closed`

#### Scenario: Oversized batch
- **WHEN** a batch carries 101 items
- **THEN** the request is rejected and nothing is written

### Requirement: Inbox and manual jobs API
`GET /api/v1/inbox` SHALL return the caller's discovered jobs joined with
scores, provenance and duplicate groups with `state`, `min_score`, `source`
and `q` filters; `POST /api/v1/inbox:bulk` SHALL apply `track`, `dismiss`,
`seen` or `score` to ≤ 200 ids with per-id results; `POST /api/v1/user-jobs`
SHALL add a job manually from full fields or `{url}` (a validated
`custom_url` stub), and `GET /api/v1/user-jobs/{ujb_id}` SHALL return the
tracked job, posting and latest score, not-owned ids being 404. (Source:
05 §4; 11 §6.1)

#### Scenario: Bulk track
- **WHEN** the user bulk-tracks three inbox ids
- **THEN** each id gets its own result and tracked ones get applications

### Requirement: Inbox and Sources screens
`apps/jobs` SHALL provide `/inbox` (table with score bars and component
breakdown, provenance and duplicates, tabs new/seen/dismissed, bulk
Track `S` / Dismiss `D` / Score / Mark seen, an import status strip, empty
states and a phone layout), `/jobs/$ujbId` (tracked job detail) and `/sources`
(source table, adapter config forms generated from the manifest JSON Schema,
excluded sources shown disabled, discovery runs history). (Source: 12 §4,
§7; 05 §4)

#### Scenario: Excluded adapter in the form
- **WHEN** the user opens the add-source sheet
- **THEN** LinkedIn and Indeed are listed as disabled with the reason

#### Scenario: Bulk dismiss
- **WHEN** the user selects rows and presses `D`
- **THEN** `POST /api/v1/inbox:bulk` with `action: dismiss` is sent through the BFF and the rows leave the New tab
