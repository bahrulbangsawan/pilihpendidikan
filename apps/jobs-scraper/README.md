# apps/jobs-scraper — the cloud scraper (job-tracker-spec/24, D-38)

A Worker (`jobs-scraper-pilihpendidikan`) with a Cloudflare Container running the
Python service `pilih-scraper` (`python/`). `apps/api` calls it through its
`SCRAPER` service binding from the `jobs-scrape` queue consumer; it has no public
route. Every fetch goes through the CLI's `ScraplingJobEngine`
(`apps/jobs-cli`, `pilih_jobs.discovery.engine`): honest User-Agent
(`pilih-jobs/<ver> (+https://pilihpendidikan.com/bot)`), robots.txt always obeyed,
politeness delays, bounded retries, challenge detection and the forbidden-feature
guard (no stealth fetchers, no CAPTCHA solving, no proxies, D-16).

```
apps/api consumer ──SCRAPER──▶ Worker (src/index.ts) ──getByName("pool-<hash(domain)%3>")──▶ ScraperContainer
                                                                                               └─ pilih-scraper serve :8080
```

## Protocol (`packages/jobs-contracts/src/cloud.ts`)

| Endpoint | Body → answer |
|---|---|
| `GET /healthz` | `{ok, engine}` |
| `POST /v1/scrape` | `ScrapeRequest` → `ScrapeResponse` (normalized `CloudPostingItem`s, AI candidates, cursor, stats, error, warnings, log) |
| `POST /v1/probe` | `ProbeRequest` → `ProbeResponse` (robots, protection, login wall, verified feeds, JSON-LD, embedded JSON, job links) |
| `POST /v1/directory` | `DirectoryRequest` → `DirectoryResponse` (outbound links of a directory page) |

A source-level failure is HTTP 200 with `error` set; 400 means the request broke the
protocol (Pydantic models generated from the contracts); bodies are capped at 4 MB.

Strategies (`python/src/pilih_scraper/strategies/`): `json_api`, `rss` (RSS 2.0 and
Atom; `fetch_details` fills missing fields from the item page's JSON-LD), `json_ld`
(listing JSON-LD / `ItemList`, then same-site detail pages), `embedded_json`
(`__NEXT_DATA__`-style scripts, or `window.<global_name> = {…}` parsed as JSON, never
executed), `html_selectors` (CSS incl. `::text` / `::attr()`, Scrapling adaptive
relocation on a miss), `browser` (opt-in per source, headless Chromium), `ai` (page
text for the api's AI fallback). Normalization, validation, fingerprint, content hash
and `dedupe_group` come from `pilih_jobs.discovery` (byte-identical to the contracts).

## Develop

```sh
cd apps/jobs-scraper/python && uv sync      # once (needs uv)
bun run dev:python                           # the service on 127.0.0.1:8791 (no Docker)
bun run dev                                  # wrangler dev + container on :8792 (Docker, ~1 GB image)
curl -s localhost:8791/healthz
```

`apps/api` in dev uses `SCRAPER_FALLBACK_URL=http://localhost:8791` (its `.dev.vars`)
when the service binding is absent.

## Check

```sh
bun run lint        # biome (Worker) + ruff + ruff format (Python)
bun run typecheck   # wrangler types + tsc + pyright (strict)
bun run test        # bun test (routing) + pytest (strategies, errors, SSRF, endpoints, vectors)
bun run build       # Worker bundle only (--containers-rollout=none): no Docker needed
bun run docker:build
```

Tests serve fixtures from `pytest-httpserver`; the SSRF guard lets them through only
via the test-only `NetGuard(allowed_hosts=…)` constructor argument (no environment
switch exists).

## Deploy (owner approval required)

`bun run deploy` (`wrangler deploy`) builds the `linux/amd64` image with Docker from
the repository root, pushes it to the Cloudflare registry and deploys the Worker.
Needs the Workers Paid plan. Deploy this Worker before binding it from `apps/api`
(`services: [{binding: "SCRAPER", service: "jobs-scraper-pilihpendidikan"}]`). The
first requests after a deploy may fail for a few minutes while the container
provisions; the api retries them through the queue.

The Dockerfile copies explicit paths only: wrangler pipes it on stdin (`-f -`), so a
Dockerfile-specific `.dockerignore` is not applied there; never switch back to
directory-wide `COPY` (it would pull `python/.venv` into the build).

## Security

- **SSRF** (`netguard.py`): http(s) on ports 80/443 only, no credentials, no
  `localhost` / `*.local` / `*.internal` names, and every resolved address must be
  public unicast (no loopback, RFC 1918, link-local, CGNAT, ULA, multicast,
  metadata `169.254.169.254` / `fd00:ec2::254`, IPv4-mapped or NAT64 forms). Checked
  before every request attempt (robots.txt included) and on the final URL after
  redirects; curl's `follow_redirects="safe"` refuses private redirect targets.
- Feeds are parsed with `defusedxml` (no entity expansion); embedded state is parsed
  with `json.loads` after balanced-brace extraction and is never executed.
- Logs carry ids, URLs, counts and timings, never page bodies.

## Limits

- **DNS rebinding:** curl resolves hosts itself, so an answer that changes between the
  guard's check and curl's connect is not caught at the socket level (the final URL is
  re-checked after the response). The container's egress has no private network to
  reach, which bounds the risk.
- **Body size:** responses over 5 MB are discarded after download (the engine reads a
  whole response before the guard sees its size).
- **Browser strategy:** the guard checks the top-level URL; sub-resources a page loads
  in Chromium are not filtered. Enable `allow_browser` only for boards that need it;
  Chromium wants ~1–2 GB, so such sources may need `instance_type: "standard-1"`.
- **Adaptive selectors** live on the container's disk (`/data/scrapling/adaptive.db`)
  and are rebuilt after the container restarts (a `selector_drift`-free first run
  re-saves them).
- One engine per request: politeness state (delays, robots cache) is per scrape; the
  api's per-source lease prevents two runs of one source at once.
