# Job Tracker — Specification Index

Status: **Draft v1 — implementation-ready architecture, no code written.**
Date: 2026-10-11 · Repository: `pilihpendidikan` (Bun + Turborepo workspace)

This folder specifies the Job Tracker: a web dashboard (`apps/jobs`), a local
cross-platform CLI (`apps/jobs-cli`) that runs Scrapling discovery and
Playwright browser automation on the user's machine, and the Cloudflare backend
(`apps/api`, extended) that is the single source of truth.

> **Roles in one line each**
> - **`apps/jobs-cli`** is the *local execution engine* (discovery, browser automation, CV attachment).
> - **Cloudflare (`apps/api` + D1 + R2 + Queues)** is the *centralized source of truth*.
> - **`apps/jobs`** is the *primary user interface*.

---

## 1. Document map

| # | Document | Scope |
|---|---|---|
| 00 | `00-README.md` | This index, legend, decision register, conflict register, glossary |
| 01 | `01-PRODUCT-OVERVIEW.md` | Goals, personas, application modes, scope and non-goals |
| 02 | `02-SYSTEM-ARCHITECTURE.md` | End-to-end architecture, component boundaries, repo layout, data flows |
| 03 | `03-DOMAIN-MODEL.md` | Entities, identifiers, stages, state machines (canonical vocabulary) |
| 04 | `04-DATABASE-SCHEMA.md` | Full D1 DDL for `pilihpendidikan` and the new `pilihpendidikan-jobs` database |
| 05 | `05-API-SPECIFICATION.md` | REST `/api/v1/*` contract, errors, idempotency, pagination, scopes |
| 06 | `06-KANBAN-AND-APPLICATION-TRACKING.md` | Board, stages, timeline, interviews, offers, legacy jobs migration |
| 07 | `07-JOB-MATCHING-AND-SCORING.md` | Compatibility scoring (deterministic + OpenAI Decisions API), bulk scoring |
| 08 | `08-CV-GENERATION-INTEGRATION.md` | Reuse of the `apps/cv` engine, tailoring, approval, PDF rendering, R2 |
| 09 | `09-EMAIL-APPLICATIONS.md` | Authorized email application flow |
| 10 | `10-ANALYTICS-AND-STATISTICS.md` | Funnel, conversion, interview/offer/rejection analytics |
| 11 | `11-SECURITY-PRIVACY-AND-ISOLATION.md` | System-wide threat model, isolation, PII, retention, compliance |
| 12 | `12-UI-UX-SPECIFICATION.md` | `apps/jobs` screens on the Zedative design system |
| 13 | `13-IMPLEMENTATION-ROADMAP-AND-TESTING.md` | Milestones, OpenSpec change plan, end-to-end test plan |
| 14 | `14-CLOUDFLARE-ARCHITECTURE.md` | Service-by-service justification, bindings, costs |
| 15 | `15-SCRAPLING-ENGINE-WRAPPER.md` | `ScraplingJobEngine`, source adapter registry and contracts |
| 16 | `16-LOCAL-CLI-ARCHITECTURE.md` | CLI package structure, commands, local state, runtime |
| 17 | `17-OAUTH2-PKCE-AUTHENTICATION.md` | CLI login, token lifecycle, scopes, device registration |
| 18 | `18-BROWSER-AUTOMATION.md` | Managed / connected / persistent browser modes, executor |
| 19 | `19-AI-APPLICATION-AGENT.md` | Decision schemas, action schemas, autonomy policy |
| 20 | `20-LOCAL-CLOUD-SYNCHRONIZATION.md` | Sync protocol, revisions, outbox, change feed |
| 21 | `21-AUTOMATION-EXECUTION-PROTOCOL.md` | Remote-to-local tasks, leases, heartbeats, recovery |
| 22 | `22-CLI-DISTRIBUTION-AND-OPERATIONS.md` | Install, upgrade, packaging, telemetry, support |
| 24 | `24-CLOUD-DISCOVERY.md` | Server-side catalog of remote-job boards: hourly cron, queue, Python scraper container, AI fallback, `/sources` |

Read order for implementers: 00 → 02 → 03 → 04 → 05, then the area you build.

---

## 2. Status legend (used in every document)

Every non-trivial statement carries one of these tags.

| Tag | Meaning |
|---|---|
| **[VERIFIED]** | Exists today in this repository (cited `path:line`) or was confirmed in official external documentation on 2026-10-11 (URL cited). |
| **[NEW]** | Required new functionality that this spec defines. Does not exist yet. |
| **[DECISION]** | A proposed architectural decision, with the rejected alternatives noted. Numbered `D-xx` in §4. |
| **[LIMITATION]** | A constraint imposed by an external dependency (library, API, platform). |
| **[RESTRICTION]** | A platform rule, terms-of-service or legal restriction that limits what we may do. |
| **[ASSUMPTION]** | An unresolved technical assumption that must be validated (spike or owner decision). Numbered `A-xx` in §6. |

---

## 3. What exists today (verified baseline)

Facts gathered by auditing the repository on 2026-10-11. They drive every
decision below.

| Area | Verified state | Evidence |
|---|---|---|
| `apps/jobs` | **Does not exist.** No jobs UI anywhere in the workspace. | `ls apps/` |
| Jobs backend | Exists in `apps/api`: REST `/api/jobs[/:id]` (GET/POST/PUT/DELETE, authenticated, not-owned = 404) and 9 MCP tools `jobs_*`. | `apps/api/src/documents/jobs.ts`, `apps/api/src/tools/jobs*.ts` |
| Jobs data model | One JSON blob per job: `JobData {id,title,status,company,companyUrl,salaryRange,jobDescription[],requirements[],interviewDate?,sections[{items[]}],createdAt,updatedAt}`; statuses `saved, applied, interviewing, offer, rejected, accepted`. | `apps/api/src/types.ts:317-413` |
| Jobs storage | **KV only** (`JOBS_KV`, `job:{id}` + owner stamp `owner:job:{id}`), whole-blob read-modify-write, no revision/concurrency control, client-chosen ids. MCP `jobs_list` reads at most 1000 keys. | `apps/api/src/helpers.ts:130-146`, `apps/api/src/ownership.ts`, `apps/api/src/tools/jobs-management.ts:58-95` |
| Identity | **The canonical user identifier is the normalized email** (`trim().toLowerCase()`). There is no `users` table and no user UUID. Admins come from `ADMIN_EMAILS`. | `apps/api/src/auth.ts:59-73` |
| Sign-in | Email magic link → KV browser session (7 days) + `__Host-session` cookie (host-only on `api.`) → one-time `?code=` → `POST /auth/exchange` returns a bearer to SPAs on other origins. | `apps/api/src/sign-in.ts`, `apps/api/src/session.ts`, `apps/api/src/routes/auth.ts` |
| Personal tokens | `/connect` mints 256-bit opaque tokens, SHA-256 hashed in D1 `mcp_tokens`, scope `write`/`read`, **never expire** until revoked. | `apps/api/src/personal-tokens.ts:86-117` |
| OAuth | Hand-rolled OAuth 2.1 authorization server for MCP clients: RFC 8414 + RFC 9728 metadata, RFC 7591 DCR, authorization code + **PKCE S256 only**, consent via emailed link bound to the initiating browser. Access token = opaque `mcp_tokens` row (90 days, always `write`). | `apps/api/src/oauth/*` |
| OAuth gaps | **No refresh tokens, no RFC 7009 revocation endpoint, `scope`/`resource` read but ignored, exact redirect match (no RFC 8252 any-port loopback), no device grant, no recognition of an existing browser session.** | `apps/api/src/oauth/shared.ts:24-26`, `authorize.ts:28-48` |
| D1 | One database `pilihpendidikan` (binding `DB`) with `mcp_tokens`, `oauth_clients`, `request_log`. | `apps/api/migrations/0001_initial.sql` |
| Other Cloudflare | KV ×6, D1 ×1, Durable Object `PilihMcpServer` (SQLite-backed), `send_email` binding, daily cron. **No R2, Queues, Workflows, Workers AI, Browser Rendering, service bindings.** No secrets. | `apps/api/wrangler.jsonc` |
| AI | **No LLM integration anywhere in the repo.** `apps/cv` has no AI assistant in code (the `cv-add-ai-chat-assistant` OpenSpec change was carried over without code). | grep, `openspec/changes/cv-add-ai-chat-assistant` |
| CV engine | `CVData` type in `apps/cv/src/components/cv-form.tsx:65-254` (hand-copied to `apps/api/src/types.ts:1-152`); 4 `@react-pdf` templates (`apps/cv/src/components/templates/*-pdf.tsx`) rendered **client-side only**; `formatCvMarkdown()` in `apps/cv/src/lib/cv-markdown.ts:109`. CV ids are user-chosen slugs; public read by id; no REST create (MCP `cv_create` only). | apps/cv audit |
| PDF on server | **None.** `/cv/:slug.pdf` only 302s to the browser print view; `@react-pdf` (yoga-layout runtime WASM compile) does not run in Workers as shipped. | `apps/api/src/documents/handlers.ts:161-177` |
| CORS | Credentialed CORS only for `cv.`, `invoice.`, `portfolio.` origins (+ localhost 4003–4005 in dev). **No jobs origin.** | `apps/api/src/origins.ts:7-20` |
| Design system | In-progress OpenSpec change `update-zedative-design-system` replaces dark Warp with **Zedative** (`zedative.DESIGN.md`) via shared `@rulisme/ui/styles/theme.css`; `apps/home` already imports it; `apps/cv` still on Warp. | `openspec/changes/update-zedative-design-system/proposal.md` |
| Python | **No Python anywhere in the repository.** | `find` |
| Previous Job Tracker spec | **No earlier documents exist** (no `job-tracker-spec/`, no 01–13 files in this or sibling repos). Documents 01–13 are therefore written fresh in this pass and already embody the local-CLI architecture; "previous specification" assumptions are recorded in the conflict register (§5). | filesystem search |

---

## 4. Decision register

Each decision is restated in the document that owns it. IDs are stable; do not
renumber.

| ID | Decision | Owner doc | Rejected alternatives (short) |
|---|---|---|---|
| D-01 | **Extend `apps/api`** (Worker `api-pilihpendidikan`) with the Job Tracker API under `/api/v1/*`. No second backend Worker. | 02, 14 | New `jobs-api` Worker (duplicates auth, CORS, rate limiting, MCP). |
| D-02 | **New D1 database `pilihpendidikan-jobs`** (binding `JOBS_DB`) for all Job Tracker data; identity tables stay in `pilihpendidikan` (`DB`). | 04, 14 | Same DB (Time Travel restores would roll back auth tokens; shared 10 GB cap). |
| D-03 | **Introduce a stable user id** (`users.id`, `usr_…`) in `DB`, created lazily from the normalized email at caller resolution. All new tables key on `user_id`, never email. Existing documents keep email owner stamps. | 03, 04, 17 | Keep email as key (PII in every row, email change breaks ownership). |
| D-04 | **Migrate legacy jobs from `JOBS_KV` to D1**, keep `/api/jobs` + `jobs_*` MCP tools as a compatibility facade over D1; retire `JOBS_KV` after a read-only grace period. | 06, 20 | Keep KV for jobs (no queries, no revisions, no transactions — fails "do not store critical records in KV"). |
| D-05 | **R2 bucket `pilihpendidikan-jobs-files`** (binding `JOBS_FILES`) for CV PDFs, cover letters, attachments and optional evidence screenshots; access only through authorized Worker routes. | 08, 14 | Presigned URLs (do not work on custom domains, need S3 credentials); KV (25 MiB values, no lifecycle). |
| D-06 | **One Cloudflare Queue `jobs-ai`** (+ DLQ `jobs-ai-dlq`) for bulk scoring and CV tailoring. **No Workflows and no new Durable Object in v1.** | 14 | Workflows (state already lives in D1; adds a second state store); `waitUntil` (not durable). |
| D-07 | **CLI is a Python 3.12 application** in `apps/jobs-cli` (dist `pilih-jobs`, import package `pilih_jobs`), because Scrapling is Python-only. | 16 | Node/Bun CLI calling a Python sidecar (two runtimes on the user's machine). |
| D-08 | **CLI executable is `pilih-jobs`** (optional alias `pj`). **Not `jobs`**: `jobs` is a POSIX shell builtin in bash/zsh/sh, so `jobs login` would never reach the binary. | 16 | `jobs` (shadowed by builtin), `pilih` (too broad for the hub's other tools). |
| D-09 | **CLI login = OAuth 2.1 authorization code + PKCE S256 with an RFC 8252 loopback redirect**, as a pre-registered first-party public client `pilih-jobs-cli`, by **extending the existing hand-rolled authorization server** (refresh rotation, RFC 7009 revocation, scopes, device binding, session-aware consent). | 17 | Migrate to `@cloudflare/workers-oauth-provider` 1.2.3 (stores grants in `OAUTH_KV`, different token format; would orphan existing MCP tokens) — kept as a later option; personal tokens (never expire, no device binding). |
| D-10 | **Device registration**: each CLI installation registers a `devices` row bound to its OAuth grant; revoking a device revokes the grant's refresh-token family and fails every lease it holds. | 17, 21 | Anonymous installations (no per-device revocation, no duplicate-execution control). |
| D-11 | **Remote-to-local coordination by HTTPS polling + D1 leases** (atomic conditional `UPDATE … RETURNING`), adaptive poll interval; WebSocket "doorbell" via a per-user Durable Object is an optional later optimization. | 21 | WebSockets first (needs a DO, reconnect logic, proxies; D1 still authoritative). |
| D-12 | **AI provider: OpenAI, called only from `apps/api`** (secret `OPENAI_API_KEY`), never from the CLI or browser. Decisions API (`POST /v1/decisions`, `gpt-6-luna`) for classification/choice/score; Responses API Structured Outputs (`store: false`) for anything that must *generate* structured content. | 07, 19 | Client-side keys (leak), BYOK in v1 (support burden) — BYOK is a later option. |
| D-13 | **The browser agent never lets a model emit raw actions.** The executor enumerates candidate actions deterministically; the Decisions API *chooses* among them; Structured Outputs *propose* field values that are validated against the user's fact sheet before execution. | 19 | Free-form computer-use loop (`computer` tool) — unbounded action space, harder to validate. |
| D-14 | **Tailored CVs are produced by the existing CV engine**, extracted into `packages/cv-engine` (types, 4 `@react-pdf` templates, markdown export). PDFs are rendered **in a browser runtime** (the `apps/jobs` page, or headless in the CLI's Playwright Chromium loading the same route) and stored in R2 with a SHA-256. | 08 | Server-side `@react-pdf` in a Worker (runtime WASM compile blocked); Browser Rendering (new paid product, different output than the Download button); a Bun sidecar binary (second runtime to distribute). |
| D-15 | **`apps/jobs` uses a BFF session**: TanStack Start server functions hold the API bearer server-side in an `HttpOnly` `__Host-` cookie on `jobs.pilihpendidikan.com` and call `apps/api` through a **service binding**. | 12, 11 | Bearer in `localStorage` (the cv/invoice/portfolio pattern) — unacceptable for an app that can trigger submissions. |
| D-16 | **Scrapling is used via `scrapling[fetchers]`; `StealthyFetcher`, `StealthySession`, `AsyncStealthySession`, `solve_cloudflare`, fingerprint spoofing, fake referers and proxy rotation are forbidden** and blocked by an import guard + policy tests. Official ATS JSON APIs are preferred over HTML scraping. | 15 | Using stealth fetchers (violates "must not bypass protections"). |
| D-17 | **LinkedIn and Indeed are excluded** from discovery and automated application (their terms prohibit scraping and automated applying). Workday is best-effort, per-tenant opt-in. | 15 | Supporting them (ToS violation). |
| D-18 | **Submission is never inferred.** An application reaches `submitted_verified` only with recorded evidence meeting the verification rules; otherwise `submitted_unverified` or `outcome_unknown`, which require human confirmation. | 19, 21 | Treat "clicked Submit" as submitted. |
| D-19 | **A lease that expires after a `submit_intent` checkpoint is never retried automatically**; it becomes `outcome_unknown` for human review. | 21 | Blind retry (risk of duplicate applications). |
| D-20 | **Shared contracts**: request/response and record schemas are authored once in Zod in `packages/jobs-contracts`, exported to JSON Schema, and code-generated into Pydantic v2 models for the CLI. | 05, 16 | Hand-maintained parallel types (the current `CVData` duplication is a known drift risk). |
| D-21 | **Optimistic concurrency everywhere**: every mutable record has an integer `revision`; writes carry `base_revision`; stale writes get `409 revision_conflict`. Stage history is an append-only event log. | 20 | Last-write-wins (lets stale CLI data overwrite newer cloud statuses). |
| D-22 | **Browser automation is Playwright for Python** (the same `playwright` package Scrapling's fetchers depend on), so one Chromium install serves discovery and applications. | 18 | Node Playwright (second runtime), Selenium (weaker auto-waiting). |
| D-23 | **Mode B "existing browser" means a user-launched Chrome on a dedicated, non-default profile** with `--remote-debugging-port` bound to `127.0.0.1`. Attaching to the user's everyday Chrome profile is impossible by design (Chrome ≥ 136) and not attempted. | 18 | Attaching to the default profile; extracting cookies. |
| D-24 | **`apps/jobs` follows Zedative** (`zedative.DESIGN.md`) through `@rulisme/ui/styles/theme.css`; no jobs-specific token set. | 12 | Warp (being replaced), a bespoke CLI-integration look. |
| D-25 | CV documents gain a `visibility` flag; tailored variants default to `private` (owner-only read); existing CVs stay `public`. | 08, 11 |
| D-26 | Admins do **not** bypass ownership on `JOBS_DB`; the legacy facade ignores `?mine=0` for jobs (BREAKING for admin tooling); break-glass access is logged in `support_access_log` (`DB`). | 11 |
| D-27 | `apps/jobs` has no `/id/*` route tree; locale comes from a user setting + `jobs-lang` cookie. | 12 |
| D-28 | `POST /api/v1/tasks/{t}/lease/{l}/submit-intent` is synchronous and never queued offline; the CLI clicks Submit only after a 200 (enforces D-19 server-side). | 19, 21 |
| D-29 | The CLI's base grant excludes `automation:manage`. With its base `automation:execute` the CLI may create `assisted`/`approval` apply tasks **targeted at itself** (local `pilih-jobs apply`). Deciding submit approvals from the CLI (`apply --approve`, `approvals decide`), `--mode auto`, remote-targeted tasks and rule activation need step-up `pilih-jobs login --scope automation:manage` (or the web). | 05 §8, 17 |
| D-30 | Refresh-token reuse: the same child token is re-issued for up to 60 s while unused; later reuse revokes the family and the device's leases. | 17 |
| D-31 | CLI automation command group is `worker` (hidden alias `automation`); one worker per device (lock file + local IPC). | 16 |
| D-32 | Discovery and apply browser profiles are always separate; connected mode (B) is limited to `assisted`/`approval`. | 18 |
| D-33 | Feature flags / kill switches live in `DB.feature_flags` (30 s isolate cache), never in wrangler vars. Canonical keys: `JOBS_V1_ENABLED`, `JOBS_CLI_LOGIN_ENABLED`, `JOBS_AUTOMATION_ENABLED`, `JOBS_AUTO_MODE_ENABLED`, `JOBS_EMAIL_SERVER_SEND_ENABLED`, `AI_DISABLED`, `JOBS_LEGACY_BACKEND`, `JOBS_CLOUD_DISCOVERY_ENABLED`, `JOBS_CLOUD_AI_ENABLED` (24). Only versions (`JOBS_MIN_CLI_VERSION`, `JOBS_RECOMMENDED_CLI_VERSION`) are vars. | 13, 14 |
| D-34 | AI budget: $3.00/user/month, $0.50/day sub-cap, 80 % warning; exhaustion ⇒ `429 ai_budget_exhausted` and deterministic-only scoring; the agent pauses (`ai_unavailable`). | 14, 19 |
| D-35 | Abuse caps: rule `max_per_day` default 10 (ceiling 25), `max_per_company_per_30d` default 2 (ceiling 3), global 40 submissions/user/day, `auto` needs `min_score ≥ 70`. | 11, 19 |
| D-36 | The CLI talks to Scrapling in-process (`pilih_jobs.discovery.engine`); never via the `scrapling` CLI/MCP. Three-layer forbidden-feature guard. | 15 |
| D-37 | **Server-side discovery is allowed** for the cloud catalog of public remote-job boards, under every rule of 15 (honest UA, robots.txt, no stealth/challenge solving/proxies/login, D-17 exclusions, stop on `access_denied` / `challenge_detected`); listings behind an account are `AUTH_REQUIRED` and never fetched. Amends D-16. | 24 |
| D-38 | Topology: `apps/api` cron `0 * * * *` → queue `jobs-scrape` (+ DLQ) → `apps/api` consumer (D1 lease per source) → service binding → Worker `jobs-scraper-pilihpendidikan` → Cloudflare Container running the Python scraper, which reuses `pilih_jobs.discovery` (`ScraplingJobEngine`). `apps/api` stays the only `JOBS_DB` writer. Amends D-06 (second queue) and D-36 (a server-side Python consumer of the engine). | 24 |
| D-39 | One system catalog (`cloud_sources`), scraped once for everyone into public postings; users **follow** sources to get them in their inbox; operators (`ADMIN_EMAILS`) manage the catalog (`403 operator_required` otherwise). | 24 |
| D-40 | Extraction order `json_api` → `rss` → `json_ld` → `embedded_json` → `html_selectors` (+ Scrapling adaptive) → `browser` (opt-in) → `ai`; AI runs in `apps/api` only (D-12), behind `JOBS_CLOUD_AI_ENABLED`, per-source `ai_enabled` and the system budget `JOBS_CLOUD_AI_MONTHLY_BUDGET_USD`; schema-validated, never invents fields, confidence ≤ 0.7. | 24 |
| D-41 | Postings are extended, never forked: ADD COLUMN only (`cloud_source_id`, `expires_at`, `skills`, `benefits`, `employment_detail` (+ `freelance`), `application_method`, `auth_required`, `raw_metadata`); cloud postings are `generic_listing` with the `gen|` fingerprint, cross-board copies share `dedupe_group`. Flags `JOBS_CLOUD_DISCOVERY_ENABLED`, `JOBS_CLOUD_AI_ENABLED` (D-33). | 24 |

---

## 5. Conflict register (assumptions in the brief vs. reality)

| # | Brief / earlier assumption | Reality | Resolution |
|---|---|---|---|
| C-01 | "Inspect `apps/jobs` if it already exists"; previous spec documents exist. | Neither exists. A headless jobs tracker exists in `apps/api` (KV + MCP). | Documents 01–13 written fresh; legacy jobs migrated (D-04). |
| C-02 | "Use the existing `apps/jobs` login system." | There is no `apps/jobs`; the login system is the `apps/api` email-link + OAuth server. | CLI and `apps/jobs` both authenticate against `apps/api` (D-09, D-15). |
| C-03 | "Map OAuth identity to the canonical user ID." | Canonical id today is the email; no user table. | Introduce `users.id`, keep email as login key (D-03). |
| C-04 | CLI commands named `jobs …`. | `jobs` is a shell builtin. | Executable `pilih-jobs` (D-08); command tree otherwise as proposed. |
| C-05 | "OpenAI Decisions API for AI-driven application planning." | Decisions is a beta classifier/selector: predicates, choices, scores; no tool calling, no custom JSON output, no state, no browser control. | Decisions chooses among executor-enumerated actions and gates; Responses API Structured Outputs generates field values (D-12, D-13). |
| C-06 | "`apps/cv` engine generates tailored CVs." | The engine renders client-side only and has no AI; no copy/tailor operation; types duplicated. | Extract `packages/cv-engine`, add tailoring in `apps/api`, render in a browser runtime (D-14). |
| C-07 | "Connect to existing browser sessions." | Chrome ≥ 136 ignores `--remote-debugging-port` on the default profile; profiles lock; CDP connections are lower fidelity. | Mode B limited to a dedicated debug profile (D-23). |
| C-08 | Root `CLAUDE.md` / `DESIGN.md` describe Warp (dark, weights 400/500, `text-heading` tokens). | The brief mandates Zedative; the Zedative migration is in progress. | `apps/jobs` is born on Zedative and depends on that change landing first (D-24, roadmap M0). |
| C-09 | Diagram lists Workflows, Durable Objects and KV as backend parts. | Evaluated; not needed for v1 (D-06, D-11). | Documented as optional later additions with triggers for adoption. |
| C-10 | "Cookies/session tokens remain local." | Already true for the CLI design; the existing SPA pattern stores bearers in `localStorage`. | `apps/jobs` uses BFF cookies (D-15). Browser profiles never leave the machine. |
| C-11 | "Workday adapter." | No public Workday job-board API; the `cxs` JSON endpoint is undocumented and often bot-protected. | Best-effort, opt-in, rate-limited, no protection bypass (D-17). |
| C-12 | `scrapling` "pagination / retries and backoff." | Scrapling HTTP fetchers retry with a **fixed** delay; Spider AutoThrottle doubles delays on blocks; robots.txt obedience is **off by default**. | Wrapper owns exponential backoff with jitter and forces `robots_txt_obey=True` (15). |

---

## 6. Open assumptions (must be validated)

| ID | Assumption | Validation | Blocking milestone |
|---|---|---|---|
| A-01 | The OpenAI Decisions API (public beta, `gpt-6-luna`) reaches GA or remains available with the documented request/response shape; the full response envelope (`id`, `usage`) is as expected. | Spike against `POST /v1/decisions`; contract test. | M4 |
| A-02 | `packages/cv-engine` PDFs rendered in headless Chromium (CLI) are byte-for-byte equivalent in content to the `apps/cv` "Download PDF" output (fonts are built-in Helvetica, so this is expected). | Render-diff test in CI. | M3 |
| A-03 | Cloudflare Email Sending (used by `apps/api`) can send to arbitrary external recipients from `pilihpendidikan.com` with a `Reply-To` of the user; otherwise server-sent email applications fall back to local hand-off only. | Check account entitlement; send test. | M6 |
| A-04 | `uv tool install pilih-jobs` + `pilih-jobs browser install` works on macOS 13+, Windows 11 and Ubuntu 22.04+ including Scrapling's `[fetchers]` extra (pulls patchright, unused). | CI matrix smoke test. | M2 |
| A-05 | Operator pays OpenAI cost within a per-user monthly budget (see 14 §9.4); BYOK is not needed for launch. | Owner decision. | M4 |
| A-06 | The owner accepts Python + `uv` as a second toolchain in the workspace (`bun run check` gains a Python leg). | Owner decision. | M2 |
| A-07 | Users have legal authority to apply on their own behalf to each target employer through automation; per-platform terms for Greenhouse/Lever/Ashby-hosted application forms do not prohibit user-directed browser automation. | Legal review per platform; default mode stays approval-based. | M7 (auto mode); review starts in M5 |
| A-08 | The Zedative design-system change (`update-zedative-design-system`) lands before `apps/jobs` UI work starts. | Track the OpenSpec change. | M1 |
| A-09 | Indonesia's Personal Data Protection Law (UU PDP, Law 27/2022) and GDPR-style handling (consent for AI processing, export, deletion, breach notification) are satisfied by the design in 11. | Legal review. | Release gate G6 (13) |
| A-10 | The Workers request and CPU prices used in 14 §9.3 are current (not re-verified on 2026-10-11). | Check the Workers pricing page before budgeting. | M7 |
| A-11 | The CLI and repository are published under the MIT license. | Owner decision. | M2 (PyPI publish) |

---

## 7. Glossary (canonical names — use exactly these)

| Term | Meaning |
|---|---|
| **Posting** | A job advertisement as published by a source (`job_postings`). Public-source postings are shared across users and deduplicated by **fingerprint**. |
| **Fingerprint** | `fp1:` + SHA-256 of the normalized `(source_kind, source_org, source_job_ref)` when a stable source id exists, else of `(company_domain, normalized_title, normalized_location, apply_url_canonical)`. See 03 §4. |
| **Tracked job** | A user's association with a posting (`user_jobs`). Owned by exactly one user. |
| **Application** | The Kanban card: a user's pursuit of one tracked job (`applications`), with a `stage` and a `submission_status`. |
| **Stage** | Kanban column: `saved`, `preparing`, `ready`, `applied`, `interviewing`, `offer`, `accepted`, `rejected`, `withdrawn`. |
| **Submission status** | `not_started`, `in_progress`, `submitted_verified`, `submitted_unverified`, `failed`, `outcome_unknown`. |
| **Application mode** | `manual`, `assisted`, `approval`, `auto` (controlled auto-apply). |
| **Automation task** | A unit of work for a local CLI (`automation_tasks`): `apply`, `discover`, `render_cv`. |
| **Lease** | A time-bounded, fenced claim of a task by one device (`lease_id`, `lease_expires_at`). |
| **Attempt** | One execution of a task under one lease (`automation_attempts`). |
| **Device** | A registered CLI installation (`devices`). |
| **Fact sheet** | The user's verified applicant facts (`applicant_facts`) — the only source of values the agent may type into forms. |
| **Answer bank** | Saved answers to screening questions (`screening_answers`), each with a sensitivity class and auto-use permission. |
| **Evidence** | Recorded signals that an application was submitted (`submission_evidence`). |
| **Outbox** | The CLI's local SQLite queue of pending writes to the cloud. |
| **Change feed** | Per-user ordered list of record changes (`change_log`), read with a cursor. |
| **Discovery run** | One execution of discovery over one or more sources (`discovery_runs`). |
| **Source adapter** | A plugin that knows how to discover and extract postings from one source kind (`greenhouse`, `lever`, …). |

### Naming quick reference

| Thing | Name |
|---|---|
| Web app | `apps/jobs` → `jobs.pilihpendidikan.com`, Worker `jobs-pilihpendidikan`, dev port **4007** |
| Backend | `apps/api` → `api.pilihpendidikan.com`, routes `/api/v1/*` |
| Jobs D1 | database `pilihpendidikan-jobs`, binding `JOBS_DB`, migrations `apps/api/migrations-jobs/` |
| Identity D1 | database `pilihpendidikan`, binding `DB` (existing) |
| R2 | bucket `pilihpendidikan-jobs-files`, binding `JOBS_FILES` |
| Queue | `jobs-ai` (binding `JOBS_AI_QUEUE`), DLQ `jobs-ai-dlq` |
| Secrets | `OPENAI_API_KEY` (apps/api only); `BFF_COOKIE_KEY` (apps/jobs, AES-GCM for `__Host-jobs-session`) |
| Flags | `DB.feature_flags` (D-33): `JOBS_V1_ENABLED`, `JOBS_CLI_LOGIN_ENABLED`, `JOBS_AUTOMATION_ENABLED`, `JOBS_AUTO_MODE_ENABLED`, `JOBS_EMAIL_SERVER_SEND_ENABLED`, `AI_DISABLED`, `JOBS_LEGACY_BACKEND` (`kv`\|`d1`), `JOBS_CLOUD_DISCOVERY_ENABLED`, `JOBS_CLOUD_AI_ENABLED` |
| Vars | `JOBS_MIN_CLI_VERSION`, `JOBS_RECOMMENDED_CLI_VERSION` (apps/api) |
| Crons (apps/api) | `0 3 * * *` (existing daily) + `*/5 * * * *` (lease reaper, expiries) |
| CLI | `apps/jobs-cli`, PyPI dist `pilih-jobs`, package `pilih_jobs`, executable `pilih-jobs` |
| OAuth client | `client_id = pilih-jobs-cli` (public, `token_endpoint_auth_method = none`) |
| Contracts | `packages/jobs-contracts` (Zod → JSON Schema → Pydantic) |
| CV engine | `packages/cv-engine` (extracted from `apps/cv`) |
| ID prefixes | `usr_ pst_ ujb_ app_ evt_ ivw_ ofr_ scr_ rul_ dev_ grt_ rft_ tsk_ att_ lse_ apr_ evd_ fil_ cvv_ run_ src_ fct_ ans_ eml_ sal_` + ULID; cloud discovery (24): `csr_` (cloud source), `crn_` (cloud run) |

---

## 8. Reconciliation log

The six authoring passes (2026-10-11) introduced decisions D-25 to D-36 and
found gaps in 03/04/05. All of them are now applied to the backbone:

| Change | Where |
|---|---|
| `user_settings`, `ai_usage`, `telemetry_daily`, `job_postings.dedupe_group`, `automation_tasks.pause_reason` / `resume_requested` / `retry_of`; `DB.feature_flags`, `DB.support_access_log` | 04 §1, §2 |
| Presence throttled to one `last_seen_at` write per 5 min; online ≤ 6 min; active = lease heartbeat ≤ 90 s; device rebind updates in place | 04 §1 (02, 12, 14, 21 aligned) |
| Session bearers get `ai:invoke`; personal tokens never do; CLI may create assisted/approval tasks for itself with `automation:execute` | 05 §1.2, §8 |
| Error codes `device_required`, `too_late`, `cursor_expired`, `ai_budget_exhausted`, `mode_not_allowed` | 05 §1.3 |
| Routes: `submit-intent`, `resume`, release reasons, retry with `confirm_not_submitted`, `render-ticket`, `.ics`, settings, account export/delete, telemetry; batch `unchanged`-only items; adapter automation flags; new MCP tools; admin bypass removed for jobs | 05 §4, §5, §7, §8, §10a, §14 |
| `note_deleted` event; `outcome_unknown → submitted`; lease-less `awaiting_approval`; canonical fact keys | 03 §6, §7.2, §9 |
| Queue contract: 14 §6 `JobsAiMessage` is canonical (07 §7 aligned) | 07, 14 |
| Secret `BFF_COOKIE_KEY`; Windows browser profiles under `%LOCALAPPDATA%` | 14, 16, 18 |
| **Consistency audit (2026-10-12)**: a full read-through found 60 contradictions. All are resolved: submit-intent transport, D-35 caps, D-27 locale, MCP approval limits, stage actors (03 §5.1), the D-29 scope rule, D-33 flag keys, one canonical PauseReason list (03 §7.2), queue `type` discriminator with `rollup_user` / `rebuild_analytics` / `export_user` (14 §6), the late-evidence route, revoked device = `401 revoked_token`, a single `state.db` schema (20 §3), the full CLI command table (16 §3.3), naming (`--api-url`, `persistent`, keyring/scrypt), and cross-references | all |

Verification after the audit: all `NN §X` cross-references resolve; every `/api/v1` path used in any document is defined in 05; no non-canonical scopes, flag names, pause reasons or retired names remain.
