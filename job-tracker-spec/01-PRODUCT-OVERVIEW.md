# 01 — Product Overview

This document defines what the Job Tracker is, who it serves and which outcomes it promises. It also states what it deliberately does not do.
It also maps the end-to-end automated flow onto the three components and the
documents that own each step. Every other document refines a part of this one.

Legend: see `00-README.md` §2.

---

## 1. Vision

A job seeker should be able to say *"find me roles that fit, tailor my CV, and
apply where I allow it"* and then watch progress on a calm Kanban board. The
same seeker must be able to see exactly what was submitted, when, with which
CV, and on what evidence.

Three principles shape every design choice:

1. **The user stays in control.** Automation is opt-in, scoped, reversible and
   auditable. The default application mode is `approval` (03 §5.3). Nothing is
   ever marked submitted without evidence (D-18).
2. **Local execution, cloud truth.** Scraping and browser automation run on
   the user's own machine through `pilih-jobs` (D-07). Cloudflare stores every
   durable record (D-01, D-02, D-05). The dashboard works whether or not a CLI
   is online.
3. **Honest automation.** We use official APIs first. We obey robots.txt and
   platform terms. We never bypass CAPTCHAs, bot challenges or access
   controls (D-16, D-17).

---

## 2. Personas

| Persona | Context | Primary needs | Default mode |
|---|---|---|---|
| **Rina, fresh graduate (Indonesia)** | Final-year student or recent graduate. Uses `cv.pilihpendidikan.com` in Indonesian. Applies to many internships and entry-level roles, often by email or on company career pages. | One place to track applications; one-click tailored CV; email applications with the right attachment; Indonesian UI. | `assisted` → `approval` |
| **Arjun, international job seeker** | Experienced engineer applying to remote or relocation roles hosted on Greenhouse, Lever and Ashby boards. Comfortable with a terminal. | Daily discovery across many company boards, match scoring, bulk triage, controlled auto-apply on supported ATS forms, an interview/offer pipeline. | `approval` → `auto` for narrow rules |
| **Career counsellor (secondary)** | Advises students; does not operate accounts. | Exportable stats and timelines that the student shares voluntarily. | n/a (read-only exports; no multi-tenant access in v1) |

**[DECISION D-27]** The UI is bilingual (English and Indonesian), but unlike
the other apps (`apps/cv/src/routes/index.tsx` and `id.tsx` [VERIFIED]) it has
no `/id/*` route tree: the locale comes from `user_settings.locale` plus a
`jobs-lang` cookie (`Accept-Language` as the default), and `/id` only sets the
locale and redirects (12 §2). CLI output is English in v1, and its messages are
catalogued so they can be localized (16 §11).

---

## 3. Goals and non-goals

### 3.1 Goals

| # | Goal | Measured by (§8) |
|---|---|---|
| G1 | Track every application through one Kanban board shared by web, CLI and MCP | Board load p95, stale-write conflicts |
| G2 | Discover relevant postings locally through Scrapling-wrapped adapters, synced to the cloud | Postings/run, dedupe ratio, sync success |
| G3 | Score compatibility cheaply and explainably | Score latency, user override rate |
| G4 | Generate tailored CVs with the existing `apps/cv` engine, without fabrication | Validator rejection rate, approval rate |
| G5 | Apply through browser automation in four modes, with approvals and evidence | Verified-submission rate, `outcome_unknown` rate |
| G6 | Support authorized email applications | Drafts approved / sent |
| G7 | Provide interview, rejection, offer and conversion analytics | Funnel completeness |
| G8 | Keep each user's data strictly separate, across multiple devices | Cross-user test suite, zero duplicate executions |

### 3.2 Non-goals (v1)

- Hosting browsers in the cloud. Cloudflare never launches a browser for
  application submission (02 §3).
- A mobile app. The web dashboard is responsive (12) but there is no native client.
- Recruiter or employer-side features, or team and agency multi-tenancy.
- Bring-your-own-key AI (planned for M8, A-05).
- Real-time collaborative editing. A board is single-owner.

---

## 4. Components and roles

| Component | Role | Runs where | Owns durable data? | Docs |
|---|---|---|---|---|
| **`apps/jobs`** (web dashboard) | **Primary user interface**: board, discovery inbox, approvals, automation settings, devices, statistics | Cloudflare Worker `jobs-pilihpendidikan` (SSR + BFF), browser | No. It reads and writes through `apps/api` | 06, 10, 12 |
| **`pilih-jobs`** (`apps/jobs-cli`) | **Local execution engine**: discovery (Scrapling), browser automation (Playwright), CV download and attachment, offline queue | User's macOS, Windows or Linux machine | No. It keeps only caches, credentials, browser profiles, checkpoints and the outbox (16 §6) | 15–22 |
| **`apps/api`** + D1/R2/Queue | **Centralized source of truth**: authentication, sync, scoring, tailoring, task coordination, analytics | Cloudflare Worker `api-pilihpendidikan` | Yes: `JOBS_DB`, `DB`, `JOBS_FILES` | 04, 05, 14, 17, 20, 21 |
| `apps/cv` engine (`packages/cv-engine`) | Single CV data model and PDF templates | Browser runtime (web page or the CLI's headless Chromium) | CV documents remain in `CV_KV` [VERIFIED] | 08 |
| MCP server (existing) | AI-client access to the same records | `apps/api` Durable Object `PilihMcpServer` [VERIFIED] | Through the same repositories | 05 §14 |

---

## 5. Application modes

Defined canonically in 03 §5.3. Summary:

| Mode | Fills the form | Clicks Submit | Approval needed | Evidence |
|---|---|---|---|---|
| `manual` | User (outside the system) | User | n/a | `user_attestation` |
| `assisted` | Agent, in a headed browser the user watches | **User** | n/a (the user acts) | Browser confirmation, or user confirms |
| `approval` (default) | Agent | Agent, after a per-application `submit` approval (03 §8) | Yes, bound to `payload_hash` | Browser confirmation |
| `auto` | Agent | Agent, under an activated, narrowly scoped rule (19 §8) | Rule activation only (`rule_activation`) | Browser confirmation. Unverified results escalate to the user |

When a browser application is unavailable or prohibited
(`job_postings.application_support ∈ {email, prohibited, browser_unsupported}`),
the system offers the email flow (09) or manual tracking. It never forces
automation.

---

## 6. End-to-end automated flow

The 16-step target flow from the brief, annotated with owners.

| # | Step | Component | Key records | Owner doc |
|---|---|---|---|---|
| 1 | CLI discovers jobs using Scrapling | `pilih-jobs` → `ScraplingJobEngine` + adapters | `discovery_runs` | 15 |
| 2 | Extract and normalize job information | CLI (adapter normalizers, fingerprint `fp1`) | Normalized posting payloads | 15, 03 §4.2 |
| 3 | Sync discovered jobs to Cloudflare | CLI outbox → `POST /api/v1/discovery/runs/{id}/postings:batch` | `job_postings`, `user_jobs`, `discovery_run_items` | 20, 05 §4 |
| 4 | Evaluate job compatibility | `apps/api` queue consumer: deterministic features + Decisions API `score` | `match_scores` | 07 |
| 5 | Filter by the user's automation preferences | `apps/api` rule evaluator | `automation_rules` → `applications` (tracked) + `automation_tasks` | 07 §7, 19 §8 |
| 6 | Generate a tailored CV using `apps/cv` | `apps/api` tailoring (Responses API Structured Outputs) → new CV doc in `CV_KV` → PDF rendered in a browser runtime | `cv_variants`, `files` | 08 |
| 7 | Download the approved CV to the CLI securely | CLI `GET /api/v1/files/{id}/content`, verify SHA-256 | Run staging directory | 08 §7, 18 §8 |
| 8 | Open the application in a local browser | CLI browser controller (mode A/B/C) | `automation_attempts` | 18 |
| 9 | AI agent analyzes the application requirements | `/api/v1/ai/page-classify`, `/ai/field-plan` | Observation (untrusted) | 19 §4–6 |
| 10 | Playwright fills supported fields | Deterministic executor | Step log (R2 `run_log`) | 18 §6, 19 §7 |
| 11 | Attach CV and supporting documents | Executor `set_input_files` from staging only | Hash check vs `files.sha256` | 18 §8 |
| 12 | Validate the completed application | Executor + Decisions predicates; form hash | `approvals` (mode `approval`) | 19 §8 |
| 13 | Submit if authorized and supported | Executor, after a `submit_intent` checkpoint | `application_events(submit_intent)` | 21 §6, D-19 |
| 14 | Verify the submission result | Adapter confirmation signals + `/ai/verify-submission` | `submission_evidence` | 19 §9, D-18 |
| 15 | Sync the result to D1 | CLI outbox → `…/lease/{lease_id}/result` | `applications.submission_status`, `stage` | 20, 21 |
| 16 | Update the Kanban board and analytics | `apps/jobs` polling; cron rollup | `change_log`, `analytics_daily` | 06, 10 |

Steps 1–3 and 7–15 need a CLI device. Steps 4–6 and 16 run without one. A
web-initiated application creates an `automation_tasks` row that an
authenticated CLI claims (21). Cloudflare never reaches into the user's
machine.

---

## 7. Feature inventory

There is no earlier specification document (C-01). The features the brief
requires preserving are listed below with their current state.

| Feature | Today | Target | Docs |
|---|---|---|---|
| Kanban board | **[VERIFIED]** data only: 6 statuses in `JOBS_KV`, no UI (`apps/api/src/types.ts:317`) | **[NEW]** 9-stage board, drag and drop, revisions, history | 06 |
| Job records (title, company, salary, description, requirements, interview date, checklist sections) | **[VERIFIED]** `JobData` blob + MCP tools | **[NEW]** split into posting, tracked job and application. The checklist is kept as `applications.sections` | 03, 06 §12 |
| Job matching | None | **[NEW]** deterministic + Decisions API score, explanations | 07 |
| CV generation | **[VERIFIED]** `apps/cv` builder, client-side PDF; no AI | **[NEW]** tailored variants via `packages/cv-engine`, approval, R2 | 08 |
| Email applications | None (only the sign-in email binding [VERIFIED] `apps/api/src/email.ts`) | **[NEW]** local hand-off + optional server send | 09 |
| Statistics | None | **[NEW]** funnel, response times, breakdowns | 10 |
| User isolation | **[VERIFIED]** owner stamps, not-owned returns 404 (`apps/api/src/ownership.ts`) | **[NEW]** `user_id` on every row, repository guard, cross-user test suite | 04 §5, 11 |
| UI/UX | Zedative being rolled out [VERIFIED] (`openspec/changes/update-zedative-design-system`) | **[NEW]** `apps/jobs` on Zedative | 12 |
| Discovery | None | **[NEW]** Scrapling engine + adapters | 15 |
| CLI | None | **[NEW]** `pilih-jobs` | 16, 22 |
| Browser automation | None | **[NEW]** modes A/B/C, deterministic executor | 18 |
| AI agent | None | **[NEW]** Decisions + Structured Outputs, validated | 19 |
| Remote-to-local tasks | None | **[NEW]** leases, heartbeats | 21 |
| MCP access | **[VERIFIED]** `jobs_*` tools | **[NEW]** facade over D1 plus board/approval tools | 05 §14 |

---

## 8. Success metrics

| Metric | Target (first 90 days after M5) | Source |
|---|---|---|
| Verified-submission rate (`submitted_verified` / automated submits) | ≥ 90 % | `submission_evidence` |
| `outcome_unknown` rate | ≤ 2 % of attempts | `automation_attempts.outcome` |
| Duplicate submissions | **0** (any occurrence is a P0 incident) | Per-application events with more than one `submit_intent` and no matching failure |
| Fabrication incidents (agent typed a value not traceable to facts or answers) | **0** | Field-plan audit (19 §6) |
| Board p95 load (≤ 500 cards) | < 400 ms server time | Worker analytics |
| Sync success within 60 s of CLI reconnect | ≥ 99 % | Outbox telemetry (22 §6) |
| Discovery dedupe ratio | Reported, not targeted | `discovery_runs.stats` |
| Tailored-CV approval rate | ≥ 70 % (signal of usefulness) | `cv_variants.status` |
| Weekly active trackers (users who moved at least one card) | Growth KPI | `application_events` |

---

## 9. Explicitly out of scope

| Item | Reason | Tag |
|---|---|---|
| LinkedIn and Indeed discovery or automated application | Their terms prohibit scraping and automated applying (LinkedIn User Agreement §8.2; Indeed §21 and Job Seekers §3) | **[RESTRICTION]** D-17 |
| Solving or bypassing CAPTCHAs, Turnstile, bot challenges, 2FA or login walls | Platform protection, terms, ethics. The agent pauses for the human (18 §9) | **[RESTRICTION]** D-16 |
| Stealth or fingerprint-spoofing browsers (`StealthyFetcher`, patchright, rebrowser) | Evasion tooling | **[RESTRICTION]** D-16 |
| Cloud-hosted browsers (Cloudflare Browser Rendering, OpenAI hosted Agents API) for applications | Keeps cookies and sessions local; the brief requires local execution | **[DECISION]** 14 §2 |
| Extracting cookies or passwords from the user's browsers | Security; impossible by design for the default Chrome profile (Chrome ≥ 136) | **[RESTRICTION]** D-23 |
| Mobile app | Scope | — |
| Sending email from the user's own mailbox through stored SMTP or OAuth credentials | Credential risk in v1 (09) | **[DECISION]** |
| Proxy rotation to dodge rate limits | Evasion | **[RESTRICTION]** |
