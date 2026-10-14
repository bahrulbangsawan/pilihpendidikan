# apps/jobs-scraper — cloud scraper (job-tracker-spec/24, D-38)

Worker `jobs-scraper-pilihpendidikan` + Cloudflare Container (`ScraperContainer`)
running the Python service in `python/` (`pilih-scraper`, uv project, Starlette).
Reached only through apps/api's `SCRAPER` service binding. See `README.md`.

## Commands (run here)

- `bun run dev:python` — the service on 127.0.0.1:8791 (no Docker); `bun run dev` — wrangler dev with the container on :8792 (Docker)
- `bun run lint` / `typecheck` / `test` — biome + ruff; tsc + pyright strict; bun test + pytest
- `bun run build` — Worker bundle only (`--containers-rollout=none`, no Docker); `bun run docker:build` — the image
- `bun run deploy` — owner approval required (builds and pushes the image; Workers Paid)

## Rules

- Every network request goes through `pilih_jobs.discovery.engine.ScraplingJobEngine`
  (`python/src/pilih_scraper/fetching.py` is the only module that touches engine page
  objects). Never import `scrapling` or `patchright` here (ruff `banned-api`), never
  pass Scrapling kwargs, never add stealth / proxy / CAPTCHA features (D-16).
- The SSRF guard (`netguard.py`) is always on in production; tests use
  `NetGuard(allowed_hosts=...)` only — never add an environment bypass.
- Wire shapes come from the generated Pydantic models
  (`pilih_jobs.contracts._generated.cloud`); a contract change starts in
  `packages/jobs-contracts`, then `bun run contracts` in `apps/jobs-cli`.
- Normalization / fingerprints come from `pilih_jobs.discovery` (`postings.py`
  builds on `normalize` / `items`); do not reimplement them.
- Untrusted XML goes through `defusedxml`; embedded JS state is parsed as JSON, never
  executed.
- Python tests: every test dir has `__init__.py`; fixtures are local
  (`pytest-httpserver`); live checks carry `@pytest.mark.live` (excluded by default).
