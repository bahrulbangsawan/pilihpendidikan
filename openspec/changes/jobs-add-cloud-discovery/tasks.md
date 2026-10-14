## 1. Audit and design
- [x] 1.1 Audit the 78 directory entries and the two explicit sources against the live sites (robots, feeds, JSON-LD, protection, login walls, terms)
- [x] 1.2 Design (D-37 … D-41), `job-tracker-spec/24`, 05 §15, 00 decision register

## 2. Contracts
- [x] 2.1 Cloud enums, ids (`csr_`, `crn_`), records, posting columns, flags, `operator_required`
- [x] 2.2 Strategy configs (`cloud-config.ts`), scraper protocol and queue messages (`cloud.ts`), route contracts (`api/cloud.ts`)
- [x] 2.3 Seed catalog `cloud-sources.json` + tests; regenerate schema, examples and CLI models

## 3. API
- [x] 3.1 Migration `0002_cloud_discovery.sql`, flags migration `0004`, row codecs, lint system tables
- [x] 3.2 Repo (`repo/cloud/*`), planner system mode, seed sync, dispatch, ingestion, fan-out, health, classification, AI fallback
- [x] 3.3 `jobs-scrape` consumer + DLQ, hourly dispatch and reaper crons, routes, inbox provenance for `csr_` ids
- [x] 3.4 Tests: T24 integration, units, isolation sweep, cron, migrations

## 4. Scraper
- [x] 4.1 `apps/jobs-scraper`: Worker + Container, Python service on the CLI engine, strategies, SSRF guard, probe, directory
- [x] 4.2 Dockerfile (image built, `/healthz` in the container), tests, live smoke against accessible sources
- [x] 4.4 Browser Rendering renderer for the `browser` strategy (24 §4.4): container preflight, Worker render with robots / tracker blocking, `accept_rendered` classification; Dynamite Jobs on it
- [ ] 4.3 `wrangler dev` of `apps/jobs-scraper` with the container through the Worker (blocked locally: disk full, Docker VM read-only; the Python service was verified natively and inside the container)

## 5. Dashboard
- [x] 5.1 `/sources` remote job boards: table, sheet, logs, follow, operator editor, add / refresh
- [x] 5.2 BFF route keys, polling, mock api, i18n (en + id), tests, screenshots

## 6. Docs and verification
- [x] 6.1 `DEPLOY.md`, `CLAUDE.md` files, hub `/bot` page
- [x] 6.2 `bun run check`, `bun run check-types`, local end-to-end run against live sources
