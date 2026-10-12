# 15 — Scrapling Engine Wrapper and Source Adapters

This document specifies how the local CLI discovers jobs. **Scrapling is the
mandatory scraping engine** (D-16). We wrap it in `ScraplingJobEngine` and put a
plugin-style **source adapter registry** on top. Official ATS JSON APIs are used
whenever they exist. Scraping respects robots.txt, platform terms and access
restrictions, and never bypasses protections.

Legend: see `00-README.md` §2.

---

## 1. Verified facts about Scrapling

All facts were checked on 2026-10-11 against PyPI, the v0.4.15 source, the GitHub
releases and https://scrapling.readthedocs.io/en/latest/.

| Fact | Value | Source |
|---|---|---|
| Latest version | **0.4.15**, uploaded 2026-08-23. Development status "4 - Beta". v0.4.15 contains breaking MCP-server changes. | **[VERIFIED]** https://pypi.org/project/scrapling/0.4.15/ · https://github.com/D4Vinci/Scrapling/releases/tag/v0.4.15 |
| License | **BSD-3-Clause** ("Copyright (c) 2024, Karim shoair"). Permissive, compatible with our distribution. We must keep the notice in `THIRD_PARTY_NOTICES`. | **[VERIFIED]** GitHub API SPDX id; LICENSE file |
| Python | `requires-python >=3.10` (classifiers 3.10–3.13) | **[VERIFIED]** `pyproject.toml` at v0.4.15 |
| Base install | `pip install scrapling` gives the **parser only**: lxml, cssselect, orjson, tld, w3lib. Importing `scrapling.fetchers` without the extra raises `ModuleNotFoundError`. | **[VERIFIED]** README § Installation |
| `[fetchers]` extra | Adds curl_cffi ≥ 0.16.1, playwright ≥ 1.62.0, patchright ≥ 1.62.1, browserforge, apify-fingerprint-datapoints, msgspec, anyio, protego (robots.txt). | **[VERIFIED]** `pyproject.toml` |
| Other extras | `[ai]` (MCP server), `[shell]`, `[rag]`, `[all]` | **[VERIFIED]** |
| `scrapling install` | Runs `python -m playwright install chromium` plus `install-deps chromium`, refreshes the TLD list, and writes a marker file **inside the package directory**. | **[VERIFIED]** `scrapling/cli.py` |
| HTTP fetchers | `Fetcher`, `AsyncFetcher` and `FetcherSession` (sync and async context manager), built on curl_cffi. Defaults: `impersonate="chrome"`, `stealthy_headers=True`, `timeout=30`, `retries=3`, `retry_delay=1` (**fixed delay, no exponential backoff**), `follow_redirects="safe"`. | **[VERIFIED]** `scrapling/engines/static.py` |
| Browser fetchers | `DynamicFetcher` (alias `PlayWrightFetcher`), `DynamicSession` and `AsyncDynamicSession` drive **plain Playwright**. Parameters include `headless`, `network_idle`, `wait_selector`, `timeout` (ms), `page_action`, `user_data_dir`, `cdp_url`, `real_chrome`, `useragent`, `extra_headers`, `blocked_domains`, `capture_xhr` and `google_search` (**default True: sets a fake Google referer**). | **[VERIFIED]** `scrapling/fetchers/chrome.py:97`, `_validators.py` |
| Stealth fetchers | `StealthyFetcher`, `StealthySession` and `AsyncStealthySession` drive Chromium through **patchright**. They offer `solve_cloudflare` ("Solves all types of the Cloudflare's Turnstile/Interstitial challenges"), `hide_canvas` and `block_webrtc`, plus built-in fingerprint and headless-detection patches **with no off switch**. | **[VERIFIED]** `scrapling/fetchers/stealth_chrome.py`, https://scrapling.readthedocs.io/en/latest/fetching/stealthy.html |
| Parser | `Selector` / `Selectors` (formerly `Adaptor`): `css`, `xpath`, `find_all`, `find_by_text`, `find_by_regex`, `find_similar`, `get`/`getall`, `get_all_text`, `.attrib`, `.json()`, `urljoin`. v0.4 removed `css_first`/`xpath_first`. | **[VERIFIED]** `scrapling/parser.py` |
| Adaptive relocation | With `auto_save=True`, an element's tag, text, attributes, siblings, DOM path and parent are stored, keyed by **(registered domain, identifier)**. With `adaptive=True`, every element is re-scored by `difflib.SequenceMatcher` similarity and the best match at or above `percentage` is returned. Saving overwrites the previous record. | **[VERIFIED]** https://scrapling.readthedocs.io/en/latest/parsing/adaptive.html |
| Adaptive storage | `SQLiteStorageSystem` (thread-safe: RLock and `check_same_thread=False`). **The default file is `<site-packages>/scrapling/elements_storage.db`**, which is read-only in some installs. The location can be overridden with `storage_args={"storage_file": …}`. | **[VERIFIED]** `scrapling/parser.py:47` |
| Spiders | `scrapling.spiders.Spider` (v0.4, 2026-02-15), async and Scrapy-like. Templates: `CrawlSpider`, `SitemapSpider`, `XMLFeedSpider`, `CSVFeedSpider`. Defaults: **`robots_txt_obey = False`**, `concurrent_requests = 4`, `concurrent_requests_per_domain = 0` (unlimited), `download_delay = 0.0`, AutoThrottle off. When blocked, the delay doubles or `Retry-After` is honoured. Statuses 401, 403, 407, 429, 444 and 5xx count as "blocked". | **[VERIFIED]** `scrapling/spiders/spider.py`, `throttle.py` |
| Checkpoints | `Spider(crawldir=…, interval=300)` writes `checkpoint.pkl` with **pickle** (pending queue and seen fingerprints). Only trusted directories should be loaded. | **[VERIFIED]** https://scrapling.readthedocs.io/en/latest/spiders/advanced.html |
| Development cache | `development_mode` caches responses under `.scrapling_cache/` in the current working directory | **[VERIFIED]** |
| Disclaimer | README: "educational and research purposes only … Always respect the terms of service of websites and robots.txt files." | **[VERIFIED]** README |

**[LIMITATION]** The project is Beta and its API breaks between minor versions
(v0.3, v0.4, the 0.4.15 MCP changes). The wrapper isolates every Scrapling call
behind `ScraplingJobEngine` (§4) so that an upgrade touches a single module. The
version is pinned to `scrapling[fetchers]==0.4.15` and changed only through
22 §6.

**[LIMITATION]** `scrapling[fetchers]` always installs **patchright** even
though we never use it (A-04). The install footprint grows by one wheel. The
import guard (§13) makes sure the stealth code paths are never reached.

---

## 2. Integration decision

**[DECISION D-36]** The CLI calls Scrapling's **Python APIs directly, in
process**, from the `pilih_jobs.discovery` sub-package of `apps/jobs-cli`. We
do **not** shell out to the `scrapling` CLI (`scrapling extract …`), do **not**
run `scrapling mcp`, and do **not** create a separate Python package in the
monorepo.

| Option | Verdict | Reason |
|---|---|---|
| Direct in-process API (chosen) | ✅ | Typed results, shared asyncio event loop, structured errors, no IPC. It also shares the **same Playwright install** the browser agent uses (D-22). |
| `scrapling extract` subprocess | ❌ | Writes HTML/MD/TXT files only, so we lose structure, there are no adaptive hooks, and per-call process start-up is slow. It also exposes `stealthy-fetch --solve-cloudflare`. |
| `scrapling mcp` server | ❌ | Adds an extra server process and auth token. Its tool set includes the stealth tools we forbid. It has no job semantics. |
| Separate in-repo package (`packages/pilih-scraping`) | ❌ for v1 | Only one consumer (the CLI). A second Python package would need its own build, versioning and publishing, which duplicates infrastructure. Revisit only if a server-side Python consumer appears. |

---

## 3. Architecture

```text
pilih-jobs discover …  /  worker task kind=discover (21)
        │
        ▼
┌──────────────────────────── pilih_jobs.discovery ─────────────────────────────┐
│ DiscoveryManager                                                              │
│   • resolves sources (job_sources from cloud cache + ad-hoc --url/--source)   │
│   • creates discovery_runs (run_ id, client-generated)                        │
│   • schedules adapters with per-domain politeness budget                      │
│        │                                                                      │
│        ▼                                                                      │
│ SourceAdapterRegistry ── manifest (packages/jobs-contracts/adapters.json)     │
│   greenhouse · lever · ashby · smartrecruiters · workable · workday(opt-in)   │
│   career_page · generic_listing · custom_url      (linkedin/indeed: refused)  │
│        │ adapter.discover(ctx) → AsyncIterator[RawPosting]                     │
│        ▼                                                                      │
│ ScraplingJobEngine  (the ONLY module importing scrapling)                     │
│   ├─ JsonApiClient      → FetcherSession (honest UA, impersonate=None)         │
│   ├─ HtmlFetcher        → Fetcher/AsyncFetcher + Selector(adaptive)            │
│   ├─ BrowserFetcher     → AsyncDynamicSession (google_search=False)            │
│   ├─ Crawler            → Spider / CrawlSpider / SitemapSpider (robots on)     │
│   ├─ RobotsGate         → protego cache per host                               │
│   ├─ PolitenessScheduler (per-domain concurrency ≤2, delay ≥1 s, throttle)     │
│   ├─ RetryPolicy        (exp. backoff + jitter, error taxonomy §8)             │
│   └─ AdaptiveStore      (SQLite at <data>/scrapling/adaptive.db)               │
│        │ RawPosting (+ provenance)                                             │
│        ▼                                                                      │
│ Normalizer → Validator → Fingerprinter (fp1, 03 §4.2) → RunDeduper            │
│        │ NormalizedPosting                                                    │
│        ▼                                                                      │
│ LocalSeenCache (state.db: fingerprint → content_hash, last_sent_at)           │
└────────┬──────────────────────────────────────────────────────────────────────┘
         ▼
pilih_jobs.sync.Outbox  ── batches ≤100 ──▶  POST /api/v1/discovery/runs/{run}/postings:batch (05 §4)
                                              └─▶ JOBS_DB job_postings / user_jobs / discovery_run_items
                                                     └─▶ jobs-ai queue (scoring, 07) ─▶ apps/jobs inbox
```

Component boundaries:

- **Only `pilih_jobs/discovery/engine/`** may `import scrapling`. This is
  enforced by the guard in §13 and by a ruff `banned-api` rule.
- Adapters never perform raw HTTP. They call the engine through
  `EngineContext`, so politeness, robots and retry policies cannot be skipped.
- Discovery never talks to the API directly. It writes to the **outbox**
  (20 §5), which makes discovery work offline.

---

## 4. `ScraplingJobEngine` contract

Pseudo-signatures (Python 3.12, `async` throughout; Pydantic v2 models from
`packages/jobs-contracts`, D-20).

```python
class FetchMode(StrEnum):
    JSON_API = "json_api"       # FetcherSession → JSON
    STATIC_HTML = "static_html" # Fetcher → Selector
    BROWSER = "browser"         # AsyncDynamicSession → Selector

@dataclass(frozen=True)
class FetchRequest:
    url: str
    mode: FetchMode
    method: Literal["GET", "POST"] = "GET"
    json_body: dict | None = None          # Workday cxs only
    headers: Mapping[str, str] = {}
    etag: str | None = None                # conditional GET (incremental, §9)
    last_modified: str | None = None
    wait_selector: str | None = None       # BROWSER only
    timeout_s: float = 30.0
    purpose: Literal["listing", "detail", "robots", "sitemap"] = "listing"

@dataclass(frozen=True)
class FetchResult:
    url: str                    # final URL after redirects
    status: int
    headers: Mapping[str, str]
    not_modified: bool          # 304
    json: Any | None
    page: "Selector | None"     # scrapling Selector, never escapes the engine package as a type in public APIs
    elapsed_ms: int
    fetch_mode: FetchMode
    attempt: int

class ScraplingJobEngine(Protocol):
    async def fetch(self, req: FetchRequest, *, source: SourceRef) -> FetchResult: ...
    async def fetch_listing(self, req: FetchRequest, *, source: SourceRef) -> FetchResult: ...
    def iter_listing_pages(
        self, first: FetchRequest, *, source: SourceRef,
        next_page: Callable[[FetchResult], FetchRequest | None],
        max_pages: int = 50,
    ) -> AsyncIterator[FetchResult]: ...
    async def fetch_detail(self, req: FetchRequest, *, source: SourceRef) -> FetchResult: ...
    def extract(
        self, result: FetchResult, spec: ExtractionSpec, *, source: SourceRef,
    ) -> ExtractionOutcome: ...            # sync, CPU-only; adaptive relocation + JSON-LD
    def crawl(
        self, config: CrawlConfig, *, source: SourceRef,
    ) -> AsyncIterator[CrawlEvent]: ...    # Spider-backed; yields page results & progress
    async def aclose(self) -> None: ...
```

Semantics:

- **Async model.** All network calls run on the CLI's single asyncio loop.
  Browser fetches use `AsyncDynamicSession`, because Playwright is not
  thread-safe (18 §2). Sync Scrapling classes (`Fetcher`, `DynamicFetcher`)
  are **not** used. `extract` is CPU-bound and runs inline. Pages larger than
  2 MB are parsed in `asyncio.to_thread`. lxml releases the GIL, and Selector
  objects never cross threads afterwards.
- **Sessions.** The engine keeps one `FetcherSession` per **registrable
  domain**, reused across a run. Keep-alive applies, and cookies are not
  persisted between runs. It keeps **at most one** `AsyncDynamicSession` per
  run (`max_pages ≤ 2`). This session is separate from the agent's application
  browser profile and uses a disposable `user_data_dir` under
  `<cache>/discovery-browser/`. No login state is used for public discovery.
- **Honest identity** (forced, not configurable):
  - `FetcherSession(impersonate=None, stealthy_headers=False, follow_redirects="safe")`, with header `User-Agent: pilih-jobs/<ver> (+https://pilihpendidikan.com/bot)`.
  - `AsyncDynamicSession(google_search=False, useragent=<same UA>, block_ads=False, real_chrome=False)`.
  - `retries=0` on every Scrapling call, because the wrapper owns retries (§7).
- **Errors.** Every failure is raised as `DiscoveryError(error_class, retryable, http_status?, detail)`
  using the taxonomy in §8. Raw Scrapling or curl_cffi exceptions never
  escape the engine.
- `ExtractionSpec` is declared by the adapter:

```python
@dataclass(frozen=True)
class FieldSpec:
    name: str                    # "title", "location", "description_html", "apply_url", …
    css: str | None = None
    xpath: str | None = None
    attr: str | None = None      # e.g. "href"
    many: bool = False
    required: bool = False
    adaptive: bool = True        # use Scrapling adaptive relocation on miss

@dataclass(frozen=True)
class ExtractionSpec:
    identifier_prefix: str       # "<adapter_id>" (see §5)
    item_css: str | None         # listing container (list pages)
    fields: tuple[FieldSpec, ...]
    prefer_json_ld: bool = True  # schema.org JobPosting first (career_page, generic)

@dataclass
class ExtractionOutcome:
    values: dict[str, Any]
    method: Literal["json_api", "json_ld", "css", "xpath", "adaptive"]
    relocated_fields: list[str]  # fields recovered by adaptive relocation
    missing_required: list[str]
    confidence: float            # 0..1 (§11)
```

---

## 5. Fetch strategy selection

Each adapter declares its strategy in its manifest. The engine enforces this
order:

```text
1. Official / public JSON API?  ──yes──▶ JSON_API (FetcherSession)
        │ no
2. Static HTML contains the data (JSON-LD JobPosting or stable markup)? ──yes──▶ STATIC_HTML (Fetcher + Selector)
        │ no
3. Adapter manifest browser_required = true AND user enabled browser discovery? ──yes──▶ BROWSER (AsyncDynamicSession)
        │ no
4. Fail with error_class = unsupported_content (no silent escalation)
```

- **No automatic escalation** to BROWSER mode after a 403 or a challenge.
  A 403 or challenge means "access denied" (§8). It is not a reason to try
  harder.
- BROWSER mode is opt-in per source (`config.allow_browser = true`, default
  `false`). It is limited to `generic_listing` and `career_page` pages that
  render their listings client-side.

---

## 6. Adaptive selector management

**[DECISION]** Rules for Scrapling's adaptive relocation:

- **Identifier naming.** `"<adapter_id>:<source_org or host>:<field>"`, for
  example `career_page:acme.com:title`. Scrapling keys records by
  (registered domain, identifier). The host is repeated in the identifier so
  subdomains (`jobs.acme.com` and `careers.acme.com`) never collide.
- **Storage path override (mandatory).** `Selector(..., adaptive=True, storage=SQLiteStorageSystem, storage_args={"storage_file": "<data>/scrapling/adaptive.db", "url": <page url>})`.
  The default location is in site-packages, which is read-only under
  `uv tool`/pipx installs and shared across users. The file is per user and
  never synced to the cloud.
- **Save policy.** `auto_save=True` only when the field was found by its
  **primary** selector **and** the extracted value passed validation (§10).
  This means a wrong relocation can never overwrite a good fingerprint.
- **Relocation threshold.** `percentage=60` for required fields and `50` for
  optional fields. Scrapling's own default for `relocate()` is 40; ours is
  stricter to avoid false matches.
- **Drift detection.** A field counts as **drifted** when its primary selector
  missed and adaptive relocation succeeded. The engine records
  `relocated_fields`. When more than 30 % of items in one source run, or the
  same field in 3 consecutive runs, needed relocation:
  1. the run stats record `selector_drift: {field: count}`;
  2. a `discovery_runs.errors` entry is written with class `selector_drift`
     (non-fatal);
  3. the dashboard shows "Source layout changed — extraction may be degraded"
     on the source card (12);
  4. the adapter's `confidence` for those postings is capped at 0.6.
- **Hard failure.** If a required field misses and relocation also fails, the
  item becomes `parse_error` and is never synced.
- `pilih-jobs discover --reset-adaptive <source>` deletes that identifier
  prefix from the local store.

---

## 7. Concurrency, politeness and retries

### 7.1 Defaults (forced minimums; a user may be *more* polite, never less)

| Setting | Value | Notes |
|---|---|---|
| Global concurrent requests | 4 | Across all domains |
| Per registrable domain | **≤ 2** (JSON APIs), **1** (HTML/browser) | Implemented by `PolitenessScheduler` semaphores; Spider `concurrent_requests_per_domain = 2` |
| Delay between requests to one domain | **≥ 1.0 s** (+ 0–500 ms jitter); HTML pages ≥ 2.0 s | Spider `download_delay = 1.0`, `autothrottle_enabled = True`, `autothrottle_max_delay = 60` |
| robots.txt | **Always obeyed** (`robots_txt_obey = True`; `RobotsGate` with protego for non-Spider fetches); `Crawl-delay` honoured if larger | Scrapling's default is off **[VERIFIED]** |
| Page cap per source per run | 50 listing pages, 2,000 detail fetches | Configurable lower |
| Browser pages | 1 concurrent, `disable_resources=True` for images/fonts/media | |
| User-Agent | `pilih-jobs/<ver> (+https://pilihpendidikan.com/bot)` | The bot page explains the tool and how to contact us |
| Proxies | **None.** `ProxyRotator` forbidden (§13) | A user's system proxy is respected only if it is set via `HTTPS_PROXY` |

**[RESTRICTION]** If robots.txt disallows a listing or detail path, the item
is skipped with `robots_disallowed`. The adapter does **not** fall back to
another path to get the same content.

### 7.2 Retry policy (wrapper-owned)

**[LIMITATION]** Scrapling HTTP fetchers retry with a **fixed** `retry_delay`
**[VERIFIED]**. We pass `retries=0` and retry ourselves.

```text
delay(attempt) = min(cap, base * 2^(attempt-1)) * uniform(0.8, 1.2)
base = 2 s, cap = 120 s, max_attempts = 4 (network/timeout/5xx), 3 (429)
429/503 with Retry-After → wait max(Retry-After, delay(attempt)), cap 15 min; beyond cap → stop source (rate_limited)
```

Only error classes marked *retryable* in §8 are retried.

---

## 8. Error classification

| `error_class` | Trigger | Retryable | Action |
|---|---|---|---|
| `network` | DNS, connection reset, TLS error | ✅ | Backoff; after max attempts → the item fails, the source continues |
| `timeout` | Request exceeded `timeout_s` | ✅ | Same as `network` |
| `http_5xx` | 500, 502, 504 | ✅ | Backoff; 5 consecutive → stop the source (`source_unavailable`) |
| `rate_limited` | 429, or 503 with Retry-After | ✅ (bounded) | Honour Retry-After; if over 15 min → **stop the source** for this run |
| `access_denied` | 401, 403, 407 | ❌ | **Stop the source immediately.** No retry, no mode change. Shown to the user: "Access denied by <host>" |
| `challenge_detected` | CAPTCHA, Turnstile, Akamai or PerimeterX interstitial markers, or a JS challenge page (heuristics: known script hosts, `cf-chl`, title patterns) | ❌ | **Stop the source.** Never solve or bypass (D-16). If it is a Workday tenant, set `config.disabled_reason = challenge` |
| `robots_disallowed` | robots.txt disallows the path | ❌ | Skip the URL and record it |
| `not_found` | 404 or 410 on detail | ❌ | Mark the posting `closed` candidate (§12) |
| `source_closed` | Board or tenant no longer exists (404 on the listing root) | ❌ | Stop the source and suggest disabling it |
| `parse_error` | Required field missing after adaptive relocation | ❌ | Drop the item and count it |
| `schema_invalid` | JSON API shape mismatch (Pydantic validation failed) | ❌ | Stop the adapter for this source; report adapter-version drift |
| `selector_drift` | §6 thresholds | n/a (warning) | Continue with a confidence cap |
| `unsupported_content` | §5 step 4 | ❌ | Stop the source |
| `policy_blocked` | Source on the exclusion list or a forbidden feature requested | ❌ | Refuse before any network call |
| `cancelled` | User or task cancellation | ❌ | Graceful stop; the run becomes `cancelled` or `partial` |

A run's status is `completed` (all sources finished without fatal errors),
`partial` (at least one source stopped), `failed` (no source produced items)
or `cancelled`.

---

## 9. Incremental crawling

`job_sources.cursor_state` (04 §2.4) is synced to the cloud. The CLI updates it
in the `…/complete` call (05 §4), so any device can continue where another left
off.

```json
{
  "v": 1,
  "listing": { "etag": "W/\"abc\"", "last_modified": "Sat, 10 Oct 2026 08:00:00 GMT" },
  "watermark_updated_at": "2026-10-10T08:00:00Z",
  "seen_refs_digest": "sha256-of-sorted-source_job_refs",
  "detail_etags": { "<source_job_ref>": "\"etag\"" }     // capped at 2,000 entries (LRU)
}
```

- **Conditional GET:** JSON APIs and listing pages send `If-None-Match` /
  `If-Modified-Since`. A 304 means "unchanged": every posting from the last
  successful run counts as **seen** (for expiry, §12) without refetching.
- **Watermarks:** if an API exposes `updated_at` (Greenhouse `updated_at`,
  Ashby `publishedAt`, SmartRecruiters `releasedDate`), only items newer than
  the watermark get a detail fetch. Older items are still listed (so they count
  as seen) but are sent as `unchanged`, which carries just the fingerprint and
  `observed_at`.
- **Content hash:** a detail page is re-synced only when `content_hash`
  differs from the `LocalSeenCache` entry (03 §4.2).
- **Complete-run flag:** a source is reported in `complete_sources[]` only if
  every listing page was fetched with no `access_denied`, `rate_limited` or
  `challenge_detected` stop. Only complete runs increment `missed_runs` on the server.

---

## 10. Normalization and validation

### 10.1 Normalization (into `NormalizedPosting`, the `postings:batch` item shape)

| Field | Rule |
|---|---|
| `title` | Strip HTML, collapse whitespace, ≤ 300 chars; keep original casing |
| `company_name` | From the adapter config (board owner) when the API does not provide it; otherwise JSON-LD `hiringOrganization.name` |
| `company_domain` | Registrable domain of the company site or careers host (via `tld`) |
| `locations[]` | Split on ` / `, `;`, `\|` and ` or `. Each entry is `{raw, city?, region?, country_code?}`. The country comes from the ISO 3166 name/alias table and US states; no geocoding service. "Remote", "Anywhere" or "WFH" become `workplace_type = remote` |
| `workplace_type` | API field (Ashby `workplaceType`, Lever `workplaceType`) → else keywords (`remote`, `hybrid`, `on-site`) → else `unknown` |
| `employment_type` | Map API vocabularies (`FullTime`, `full-time`, `Permanent`) → enum (04 §2.1) → else `unknown` |
| `salary` | API compensation objects map directly. From text, a regex for a currency symbol or ISO code and a range (`$120k–150k`, `IDR 15.000.000 - 20.000.000 / bulan`) fills `{min,max,currency,period,raw}`. Ambiguous text keeps only `raw` |
| `description_text` | HTML → text: block elements become newlines, `<li>` becomes `- `, scripts and styles are dropped, whitespace is collapsed. ≤ 64 KB; on overflow set `description_truncated = 1` |
| `requirements[]` | Bullets under a heading matching `requirements\|qualifications\|what you'll need\|kualifikasi\|persyaratan` (≤ 50 items, ≤ 500 chars each) |
| `apply_url` | Absolute, `canonical_url()` (03 §4.2); `apply_domain` = registrable domain |
| `posted_at` | ISO 8601 → epoch ms (UTC); relative text ("3 days ago") → `observed_at - n days`, flagged in provenance |
| `application_support` | From the adapter manifest default (§14), refined later by the agent (19) |

### 10.2 Validation (item rejected as `schema_invalid` / `parse_error` when failing)

- `title`, `company_name` and one of `apply_url`/`canonical_url` must be present.
- URLs must be `https:` (or `http:` for user-provided custom URLs, flagged).
  No `javascript:` or `data:` URLs.
- `posted_at` must not be later than now + 1 day.
- `description_text` must have at least 50 characters, or the item is flagged
  `thin` (synced with confidence ≤ 0.5).
- Pydantic model validation runs against the generated contract. The server
  validates again and recomputes the fingerprint (05 §4).

---

## 11. Deduplication and provenance

Dedupe runs in three layers:

1. **In-run** (`RunDeduper`): a fingerprint set keeps the first occurrence.
   Later duplicates count as `duplicates` in stats. This covers aggregator
   pages that list the same job twice.
2. **Local** (`LocalSeenCache`, state.db): a matching fingerprint with the same
   `content_hash` is sent as `unchanged` (fingerprint plus `observed_at` only,
   about 200 bytes).
3. **Server:** the unique fingerprint index (04 §2.1) is authoritative. A
   cross-source duplicate (the same job on Greenhouse and on a career page)
   produces **different `src|` fingerprints**. **[DECISION]** The server links
   both to the user, and the inbox groups them by
   `gen|`-style secondary key (`company_domain + normalized title + primary location`)
   computed server-side as `dedupe_group`. In a group, the newest-seen posting
   with an official API source is the representative.

Extraction provenance, stored in `job_postings.extraction`:

```json
{
  "v": 1,
  "adapter": "greenhouse", "adapter_version": "1.2.0",
  "engine": { "pilih_jobs": "0.3.0", "scrapling": "0.4.15", "playwright": "1.63.0" },
  "fetch_mode": "json_api",
  "method": "json_api",                     // json_api | json_ld | css | xpath | adaptive
  "source_urls": { "listing": "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
                   "detail": "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123" },
  "relocated_fields": [],
  "confidence": 0.98,
  "flags": ["posted_at_relative"],
  "observed_at": "2026-10-11T07:12:03Z",
  "run_id": "run_01J…", "device_id": "dev_01J…"
}
```

Confidence: JSON API 0.95–1.0; JSON-LD 0.9; primary CSS selectors 0.8;
adaptive relocation ≤ 0.6; thin description ≤ 0.5.

---

## 12. Job expiration detection

Combined with the server rules in 03 §4.3:

- **Listing absence:** for complete runs, postings of that source not seen get
  `missed_runs + 1` server-side, and reaching 2 closes them.
- **Detail check:** `pilih-jobs discover --check-tracked` (also run daily by
  the worker when idle) re-fetches the detail URL of every **tracked**,
  still-`open` application posting, at most 1 request per posting per 24 h.
  404/410 or `source_closed` closes it. A detected closed marker (Greenhouse
  job gone from the board API, Lever 404, Ashby `isListed=false`, JSON-LD
  `validThrough` in the past, page text like "no longer accepting applications"
  matched by a per-adapter regex) also closes it.
- **Result upload:** results go through the same batch endpoint as items with
  `status_hint: "closed" | "open"` and `status_evidence: {http_status, marker}` (05 §4). The
  server sets `status`/`closed_at` and emits `posting` changes. The board shows
  a "posting closed" badge (06).

---

## 13. Forbidden-feature guard

**[DECISION D-16]** Enforced at three levels:

1. **Static (CI):** `tests/policy/test_forbidden_scrapling.py` walks the AST of
   every module under `src/pilih_jobs/` and fails on any import or attribute
   access of `StealthyFetcher`, `StealthySession`, `AsyncStealthySession`,
   `ProxyRotator`, `solve_cloudflare`, `hide_canvas`, `block_webrtc`,
   `patchright`, `scrapling.cli` and `scrapling.mcp` (in any spelling,
   including `getattr` with string literals). It also fails on any
   `import scrapling` outside `pilih_jobs/discovery/engine/`. The same names
   are configured in ruff `flake8-tidy-imports.banned-api`.
2. **Import-time guard:** `pilih_jobs/discovery/engine/__init__.py` installs a
   `sys.meta_path` finder that raises `PolicyViolation` on import of
   `patchright` or `scrapling.fetchers.stealth_chrome` inside the CLI process.
   It imports only `scrapling.fetchers.{static,chrome}` names explicitly; it
   never uses the lazy `scrapling.fetchers.__getattr__` that resolves all
   fetchers.
3. **Runtime option filter:** the engine builds Scrapling kwargs from an
   **allow-list**. Unknown or forbidden keys (`solve_cloudflare`,
   `google_search=True`, `impersonate`, `stealthy_headers=True`, `proxy_rotator`)
   raise `PolicyViolation` before any request. Adapter configs cannot pass raw
   Scrapling kwargs.

`development_mode` (the response cache) is allowed only in tests
(`PILIH_JOBS_ENV=test`), and its cache dir is redirected to the test tmpdir.

---

## 14. Source adapter registry

### 14.1 Manifest schema (`packages/jobs-contracts/adapters.json`, D-20)

Served to the web by `GET /api/v1/sources/adapters` and bundled in the CLI. The
CLI refuses adapters whose `min_cli_version` exceeds its own version.

```ts
AdapterManifest = {
  id: "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workable" | "workday"
    | "career_page" | "generic_listing" | "custom_url",
  version: string,                     // semver of adapter logic
  min_cli_version: string,
  display_name: string,
  status: "stable" | "beta" | "opt_in" | "excluded",
  capabilities: {
    discovery: boolean,                // can enumerate postings from a board
    pagination: "none" | "offset" | "cursor" | "page_links" | "single_response",
    detail: boolean,                   // has per-posting detail fetch
    structured_fields: string[],       // fields provided natively (no text parsing)
    auth_required: boolean,            // always false in v1 (public only)
    browser_required: boolean,
    incremental: ("etag" | "watermark" | "content_hash")[],
    application_support: "browser_supported" | "browser_unsupported" | "external_redirect" | "unknown",
    application_api: "none" | "employer_key_required"
  },
  restrictions: {
    robots_respected: true,
    tos_notes: string,                 // shown in UI when adding the source
    requires_opt_in: boolean,
    stop_on: string[]                  // error classes that disable the source
  },
  rate_limits: { per_domain_concurrency: 1 | 2, min_delay_ms: number, max_pages: number },
  automation: {                        // read by the browser agent (18 §10, 19 §8.3)
    headless_ok: boolean,              // `auto` may run headless on this adapter's forms
    auto_ok: boolean,                  // `auto` mode allowed at all (never for career_page, generic_listing, custom_url, workday)
    ats_hosts: string[],               // known application hosts added to the domain allowlist (18)
    confirmation_url_patterns: string[],   // regex sources matched against the post-submit URL (19 §9)
    confirmation_selectors: string[]       // CSS selectors of confirmation markers (19 §9)
  },
  config_schema: JSONSchema            // validated server-side on POST /api/v1/sources
}
```

### 14.2 Adapter interface

```python
class SourceAdapter(Protocol):
    manifest: AdapterManifest

    def validate_config(self, config: dict) -> AdapterConfig: ...            # raises ConfigError
    def discover(self, ctx: AdapterContext, cfg: AdapterConfig
                 ) -> AsyncIterator[RawPosting | ProgressEvent]: ...
    async def fetch_detail(self, ctx: AdapterContext, cfg: AdapterConfig,
                           ref: RawPosting) -> RawPosting: ...                # no-op if listing is complete
    def to_normalized(self, raw: RawPosting) -> NormalizedPosting: ...       # adapter-specific mapping
    async def check_open(self, ctx: AdapterContext, posting: TrackedPostingRef
                         ) -> Literal["open", "closed", "unknown"]: ...

@dataclass
class AdapterContext:
    engine: ScraplingJobEngine        # the ONLY network access
    run_id: str
    cursor_state: dict                # read; adapter returns updated state via ProgressEvent(kind="cursor")
    cancel: asyncio.Event
    emit: Callable[[ProgressEvent], None]
```

Registration is static: an `ADAPTERS` dict in `pilih_jobs/adapters/__init__.py`.
There is no third-party plugin loading in v1, which keeps the attack surface
small. The registry is the single place that maps `source_kind` (04
`job_postings.source_kind`) to adapter ids.

### 14.3 Per-adapter specifications

| Adapter | Status | Discovery endpoint | Pagination | Detail | Config | Notes |
|---|---|---|---|---|---|---|
| `greenhouse` | stable | `GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true` — "authentication is not required for any GET endpoints" **[VERIFIED]** https://docs.greenhouse.io/job-board.html | single response | `…/jobs/{id}?questions=true&pay_transparency=true` (only when `questions` are needed by the agent) | `{board_token}` | `source_job_ref` = job id. Application POST needs an **employer** API key, so `application_api = employer_key_required` and applications go through the hosted form in the browser (`boards.greenhouse.io` / `job-boards.greenhouse.io`). `application_support = browser_supported` |
| `lever` | stable | `GET https://api.lever.co/v0/postings/{site}?mode=json` (EU: `api.eu.lever.co`) **[VERIFIED]** https://github.com/lever/postings-api | `skip`/`limit` (offset; 100 per page) | `…/postings/{site}/{id}` | `{site, region: "global"\|"eu", filters?: {location, commitment, team, department}}` | Apply POST needs a key (≈ 2 req/s), so applications go through the browser form at `jobs.lever.co`. `application_support = browser_supported` |
| `ashby` | stable | `GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true` **[VERIFIED]** https://developers.ashbyhq.com/docs/public-job-posting-api | single response | not needed (`descriptionHtml`/`descriptionPlain` in the listing) | `{job_board_name}` | Skip `isListed=false`. Application API not documented on that page **[ASSUMPTION]**, so browser form at `jobs.ashbyhq.com`. `application_support = browser_supported` |
| `smartrecruiters` | beta | `GET https://api.smartrecruiters.com/v1/companies/{companyIdentifier}/postings?limit=100&offset=` | offset | `…/postings/{id}` | `{company_identifier}` | **[LIMITATION]** The docs say the Posting API "supports both API Key and OAuth 2.0", yet keyless calls returned public postings. Treat keyless access as best-effort; on 401/403 → `access_denied`, stop |
| `workable` | beta | `GET https://apply.workable.com/api/v1/widget/accounts/{subdomain}` | single response | `…/accounts/{subdomain}/jobs/{shortcode}` (if needed) | `{subdomain}` | **[LIMITATION]** Undocumented widget endpoint, so the adapter may break without notice. `schema_invalid` stops it |
| `workday` | **opt_in** | `POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` with `{limit:20, offset, searchText, appliedFacets}` | offset (≤ ~2,000 results reported) | `GET …/wday/cxs/{tenant}/{site}{externalPath}` | `{tenant, wd_host_number, site, search_text?}` | **[RESTRICTION]** The endpoint is undocumented and often bot-protected. Per-tenant opt-in with the ToS note shown, 1 concurrent request, ≥ 3 s delay, `stop_on: [access_denied, challenge_detected, rate_limited]`, and the tenant is auto-disabled on the first denial. `application_support = unknown` (Workday apply flows usually need an account → the agent pauses for the user) |
| `career_page` | stable | `GET` a configured careers URL (static HTML) | `page_links` (follows `rel=next` or a configured `next_css`; ≤ 50 pages) | Detail URL per item | `{url, item_css?, fields?, next_css?, allow_browser?: false}` | **JSON-LD first**: parse `<script type="application/ld+json">` `JobPosting` (`title`, `datePosted`, `validThrough`, `employmentType`, `hiringOrganization`, `jobLocation`, `baseSalary`, `description`). If there is none, use the configured CSS + adaptive selectors. A URL pointing at a known ATS host is **redirected to that ATS adapter** (for example a `boards.greenhouse.io/acme` link becomes `greenhouse{board_token: acme}`) |
| `generic_listing` | beta | Spider (`CrawlSpider`) from `start_url`, restricted to `allowed_domains = [host]`, `CrawlRule`s for listing and detail URL regexes | Spider | Spider callbacks | `{start_url, detail_url_pattern, listing_url_pattern?, max_pages ≤ 50, allow_browser?: false}` | Uses `SitemapSpider` when the site has a sitemap. Checkpoints (`crawldir`) live under `<data>/crawls/<src_id>/`. **Pickle checkpoints are loaded only from that directory**, and only when created by the same CLI major version |
| `custom_url` | stable | Single URL (`pilih-jobs discover --url`, or a manual add in web) | none | the URL itself | `{url, private?: bool}` | JSON-LD → OpenGraph → adaptive heuristics (largest `<h1>` for the title, main content block for the description). With `private=true`, or when fetched in the user's logged-in browser (Mode C) → `visibility = private` (03 §4.1) |

### 14.4 Excluded sources

**[RESTRICTION] [DECISION D-17]** These are refused by the registry
(`policy_blocked`), by the server (`422 unsupported_source`) and by
`custom_url` (host check on `linkedin.com`, `*.indeed.*`). The user can still
**manually** track a job from these sites by pasting the title and company
without a fetch (`origin = manual`, `source_kind = manual`). Automated applying
to these hosts is blocked by the agent's domain policy (19).

| Platform | Evidence |
|---|---|
| LinkedIn | robots.txt `User-agent: * Disallow: /` and "use of robots or other automated means … without the express permission of LinkedIn is strictly prohibited" (https://www.linkedin.com/robots.txt). User Agreement §8.2 prohibits software, scripts, robots or browser plugins "to scrape or copy the Services" and "bots or other unauthorized automated methods" (https://www.linkedin.com/legal/user-agreement) |
| Indeed | Terms (updated 2026-09-29) §21 prohibit "any automated system (bots, scrapers, spiders, AI or Agentic AI) to access, data-mine, or submit content" and "Submit job applications … by automated means". Job Seekers §3 says automating Indeed Apply "outside of Indeed's official vendors and tooling is prohibited" (https://www.indeed.com/legal). robots.txt disallows `/applystart` |

New exclusions are added to `adapters.json` (`status: "excluded"`, with a
`hosts[]` list) and take effect on the server immediately and in the CLI on the
next `meta` refresh.

---

## 15. Progress reporting and execution history

`ProgressEvent` (NDJSON in `--json` mode, Rich progress bars in a TTY, and
heartbeat `progress` for remote tasks, 21):

```json
{"type":"source_started","run_id":"run_…","source":"greenhouse:acme","ts":"…"}
{"type":"page_fetched","source":"greenhouse:acme","page":1,"items":143,"mode":"json_api","elapsed_ms":420}
{"type":"item","source":"greenhouse:acme","outcome":"new","fingerprint":"fp1:…","title":"Backend Engineer"}
{"type":"source_stopped","source":"workday:nvidia","error_class":"access_denied","http_status":403}
{"type":"source_finished","source":"greenhouse:acme","stats":{"found":143,"new":12,"unchanged":131,"invalid":0}}
{"type":"sync","pending":12,"sent":12}
{"type":"run_finished","run_id":"run_…","status":"partial","stats":{…}}
```

Execution history is `discovery_runs` (04 §2.4), plus `discovery_run_items`
for per-posting outcomes (90 d retention). The run is created (`POST …/runs`)
before the first fetch and completed (`…/complete`) at the end. Both calls go
through the outbox, so offline runs sync later (20). Locally, the last 50 runs
are indexed in state.db `runs` (16 §8) with their log file path.

---

## 16. Test plan

| Layer | What | How |
|---|---|---|
| Unit | Normalizers (locations, salary, employment/workplace mapping, HTML→text), validators, fingerprint, canonical_url | pytest. **Golden fingerprint vectors** `packages/jobs-contracts/test-vectors/fingerprint.json`, shared with the TypeScript server tests (byte-identical results) |
| Adapter contract | Each adapter against recorded fixtures (JSON API responses, HTML pages, robots.txt) | `tests/fixtures/<adapter>/*.json\|html`, served by a local `pytest-httpserver`. The engine's base URL is overridden in test mode. Asserts normalized output snapshots, pagination and cursor_state updates |
| Engine | Retry/backoff timing (fake clock), error taxonomy mapping (simulated 401/403/407/429/5xx, challenge pages), robots gate, politeness scheduler concurrency | Local HTTP server with scripted responses |
| Adaptive | Selector drift: fixture v1 saves, fixture v2 (renamed classes) relocates above threshold; v3 (unrelated layout) fails without saving | Temp `adaptive.db` |
| Policy | Forbidden-feature AST scan; import guard raises on `patchright`; kwargs allow-list | `tests/policy/` (runs in `bun run check` via turbo `test`) |
| Exclusion | LinkedIn/Indeed URLs refused by the registry and by `custom_url` | Unit |
| Sync integration | Run → outbox → mock API (`packages/jobs-contracts` schemas) → item outcomes | Contract test against `apps/api` in `wrangler dev` (13) |
| Live canary (opt-in) | One public board per stable adapter (greenhouse, lever, ashby), ≤ 1 request per endpoint per day | Nightly GitHub Action with `PILIH_JOBS_LIVE=1`. Failures open an issue labelled `adapter-drift`. Never run against workday/linkedin/indeed |
