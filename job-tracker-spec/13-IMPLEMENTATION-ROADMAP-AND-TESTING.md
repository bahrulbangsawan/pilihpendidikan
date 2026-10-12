# 13 — Implementation Roadmap and Testing

This document splits the Job Tracker into milestones M0–M8. Each milestone
lists its scope, deliverables, exit criteria, dependencies and risks. The
document then maps the milestones to OpenSpec changes, defines the test
strategy per component, lists the end-to-end scenarios that gate releases,
and sets the rollout plan and the definition of done.

Legend: see `00-README.md` §2.

---

## 1. Principles

1. **Cloud first, then local.** Every capability the CLI depends on (identity,
   schema, sync, leases) ships and is tested in `apps/api` before the CLI uses
   it.
2. **Safety ladder.** `manual` → `assisted` → `approval` → `auto`. Each rung
   ships only after the previous one has run in production for an agreed
   period. `auto` ships last, behind legal review (A-07) and a flag.
3. **One OpenSpec change per coherent capability** (repo rule **[VERIFIED]**
   root `CLAUDE.md`, `openspec/AGENTS.md`). Implementation starts only after
   the change is approved.
4. **Deploys, DNS, Cloudflare resources and data migrations need the owner's
   go-ahead** (**[VERIFIED]** root `CLAUDE.md` § Deploy). Every milestone
   that touches them has an explicit owner checkpoint.

---

## 2. Milestones

### M0 — Foundations

| | |
|---|---|
| **Scope** | Zedative change landed; shared contracts; CV engine extraction; user ids; jobs database; legacy migration dry run |
| **Deliverables** | ① `update-zedative-design-system` completed (tasks 2.x–5.x) — A-08. ② `packages/jobs-contracts`: Zod schemas for every 04/05 record and request, JSON Schema export (`z.toJSONSchema`, zod 4 **[VERIFIED]** catalog `zod ^4.6.5`), fingerprint test vectors (03 §4.2), `adapters.json`. ③ `packages/cv-engine`: `CVData` types, 4 `*-pdf.tsx` templates, `template-utils`, `formatCvMarkdown`; `apps/cv` and `apps/api` import from it (removes the duplicated type, **[VERIFIED]** `apps/api/src/types.ts:1-152`). ④ `DB` migration `0002_users_devices_oauth.sql` + lazy `users` creation in `resolveCaller`. ⑤ D1 `pilihpendidikan-jobs` created (owner), `migrations-jobs/0001_jobs_core.sql`. ⑥ Legacy migration script `apps/api/scripts/migrate-jobs-kv-to-d1.ts` (dry run by default, **[VERIFIED]** existing `scripts/` convention). |
| **Exit criteria** | `bun run check` and `bun run check-types` green; `apps/cv` "Download PDF" output unchanged (byte-compare of 4 templates × 3 fixtures); dry-run report for production `JOBS_KV` shows 100% mappable records; isolation and SQL-predicate tests exist (empty repo passes). |
| **Dependencies** | Owner approval for the D1 creation; Zedative change |
| **Risks** | Zedative change slips (mitigation: contracts, schema and api work proceed in parallel; only the UI waits). CV extraction breaks `apps/cv` (mitigation: render-diff test before and after). |

### M1 — Dashboard v1 and legacy facade

| | |
|---|---|
| **Scope** | `apps/jobs` board, application detail, manual tracking; `/api/v1` applications/events/interviews/offers; legacy `/api/jobs` and MCP `jobs_*` served from D1 |
| **Deliverables** | `apps/jobs` (port 4007) with sign-in (BFF, D-15), Board (DnD + keyboard), Application detail (Overview, Timeline, Interviews, Offers), Profile facts/answers, Settings; CORS/`returnTo` origin; legacy facade; executed migration (owner); hub `services.ts` entry `soon`. |
| **Exit criteria** | Legacy parity suite passes (every legacy REST call and MCP tool returns equivalent data before/after migration); the D-26 admin non-bypass test passes; Lighthouse accessibility ≥ 95 on Board; design compliance checklist (12 §14) passes; dogfood by the owner for ≥ 1 week. |
| **Dependencies** | M0 |
| **Risks** | MCP clients depend on the admin bypass (mitigation: release note; break-glass script). D1 `change_log` write amplification (measure; batch). |

### M2 — CLI skeleton, OAuth, devices, sync, discovery (official APIs)

| | |
|---|---|
| **Scope** | OAuth extensions (refresh rotation, RFC 7009 revocation, scopes, RFC 8252 any-port loopback, session-aware consent, first-party client `pilih-jobs-cli`); devices; change feed + outbox sync; `ScraplingJobEngine` with Greenhouse, Lever and Ashby adapters; discovery runs + batch upsert; Inbox and Sources screens; `/cli` page |
| **Deliverables** | `apps/jobs-cli` (uv project, Typer, keyring, SQLite outbox, Pydantic models generated from contracts); commands `login/logout/whoami`, `discover`, `list/show`, `sync`, `status`, `config`, `browser install`; `apps/jobs` Inbox, Sources, CLI & devices; packaging to PyPI test index. |
| **Exit criteria** | E2E scenarios S-01–S-08 pass on the CI OS matrix (macOS, Windows, Ubuntu); refresh reuse revokes the family; offline discovery syncs after reconnect with zero duplicates; the Scrapling policy guard test passes; A-04 and A-06 closed. |
| **Dependencies** | M1; owner decision A-06 |
| **Risks** | Windows keyring/Playwright quirks (CI matrix); Scrapling breaking changes (pin `scrapling==0.4.15`, contract tests on its public API we use). |

### M3 — CV variants, R2, rendering

| | |
|---|---|
| **Scope** | R2 bucket + files API; CV variant creation (initially **without AI**: copy plus template choice); `/render/cv/$cvvId` route; CLI headless render (`render_cv` task); CV approval flow; D-25 private CV visibility |
| **Deliverables** | `files` endpoints, `cv-variants` endpoints, CV tab, CLI `cv generate|download`, render tickets. |
| **Exit criteria** | A-02 render-equivalence test passes (headless CLI render vs browser render vs `apps/cv` Download); SHA-256 verified end to end; tailored variants are private (D-25). |
| **Dependencies** | M0 (`cv-engine`), M2 (CLI) |
| **Risks** | `@react-pdf` in headless Chromium memory/time (measure; 30 s timeout). |

### M4 — Scoring and AI proxy

| | |
|---|---|
| **Scope** | Queue `jobs-ai` + DLQ; deterministic scoring; Decisions API scoring; AI tailoring (Structured Outputs) with the fabrication validator; AI budget; AI consent setting |
| **Deliverables** | `AiProvider` interface (OpenAI implementation; Anthropic stub per brief); `/api/v1/scores:request`; tailoring in the queue consumer; the 07 rubric r1. |
| **Exit criteria** | A-01 contract test vs live `POST /v1/decisions` passes; tailoring validator rejects 100% of a 50-case fabrication corpus; per-user budget enforced; ZDR requested; cost per scored posting ≤ $0.001 measured. |
| **Dependencies** | M2, M3; owner decision A-05; `OPENAI_API_KEY` secret (owner) |
| **Risks** | Decisions API beta changes (wrap behind `AiProvider`; feature-flag fallback to deterministic-only). |

### M5 — Browser agent: assisted and approval modes, execution protocol

| | |
|---|---|
| **Scope** | Task protocol (claim/lease/heartbeat/events/result/release, 21); browser modes A/B/C (18); executor + observation + candidate-action enumeration; AI page classify / next action / field plan / verify; approvals (submit, answer); evidence; live run monitor; approval queue UI |
| **Deliverables** | CLI `apply`, `browser launch|connect|status|profiles|login`, `worker start|stop|status|enable|disable|pause-all|resume-all`, `logs`; web Automation (Approvals, Runs, monitor). Supported ATS application forms: Greenhouse, Lever, Ashby. |
| **Exit criteria** | E2E S-09–S-24 pass against the fixture ATS server; prompt-injection corpus: 0 off-allowlist navigations, 0 non-fact values; real-world pilot: ≥ 20 approval-mode applications by internal users with 100% correct evidence verdicts (manually audited); A-07 legal review **started**. |
| **Dependencies** | M3, M4 |
| **Risks** | ATS DOM changes (adapter form hints + AI fallback + pause); evidence false positives (two-signal rule, D-18). |

### M6 — Email applications and analytics

| | |
|---|---|
| **Scope** | Email drafts; `local_handoff` (.eml); `server_send` if A-03 holds; analytics rollups and the Stats screen |
| **Exit criteria** | S-25–S-27 pass; analytics totals equal a raw-event recomputation for 3 seeded users; the email rate limit is enforced. |
| **Dependencies** | M3 (attachments), M1 (events) |
| **Risks** | Email deliverability and abuse (approval per email, 10/day cap). |

### M7 — Controlled auto mode, more adapters, distribution

| | |
|---|---|
| **Scope** | `auto` rules (activation approval, limits, allowlists), the `JOBS_AUTO_MODE_ENABLED` flag (D-33); adapters SmartRecruiters, Workable, career pages, generic listings, custom URL, Workday (opt-in); Homebrew tap, Scoop bucket, winget manifest; update checks |
| **Exit criteria** | A-07 legal review **closed** with written approval; S-28–S-30 pass; auto mode beta with ≤ 20 users for 4 weeks with zero confirmed wrongful submissions; abuse caps verified in production. |
| **Dependencies** | M5, M6 |
| **Risks** | Platform complaints (adapter kill switch, 11 §14). |

### M8 — Optional optimizations

Each item has an adoption trigger; none is required for launch.

| Item | Adoption trigger |
|---|---|
| Per-user Durable Object WebSocket "doorbell" for CLI and dashboard (D-11) | Polling > 30% of requests, or users ask for sub-second updates |
| BYOK for OpenAI | AI cost > budget, or user demand |
| DPoP sender-constrained tokens (17 §11) | Security review asks for it after M7 |
| Description bodies to R2 (04 §4) | `JOBS_DB` > 6 GB |
| Migration to `@cloudflare/workers-oauth-provider` (D-09 alternative) | Maintenance cost of the hand-rolled authorization server |
| Cloudflare Workflows for CV tailoring | The tailoring pipeline grows > 3 durable steps |
| App-layer encryption of protected answers (11 §12) | Compliance requirement |

---

## 3. OpenSpec change plan

**[VERIFIED]** Changes live in `openspec/changes/<id>/` with `proposal.md`
(`## Why`, `## What Changes`, `## Impact`), `tasks.md`, optional `design.md`,
and `specs/<capability>/spec.md` deltas (`## ADDED|MODIFIED|REMOVED|RENAMED
Requirements`, `### Requirement:` with SHALL/MUST, ≥ 1 `#### Scenario:` each)
(`openspec/AGENTS.md`). A `design.md` is required for cross-cutting work, new
dependencies, data-model changes, and security or migration work.

**[VERIFIED]** The `openspec` CLI is **not installed** locally: it is neither
on `PATH` nor in `node_modules/.bin`. There is no `openspec/specs/` yet; every
capability so far exists only as change deltas. **[DECISION]** M0 adds
`openspec` as a root dev dependency (or documents `bunx openspec@<pinned>`) so
`openspec validate <id> --strict` can run in `bun run check`.

| Milestone | Change id | Capabilities (spec deltas) | `design.md` | Source docs |
|---|---|---|---|---|
| M0 | `jobs-add-contracts-and-schema` | `jobs-contracts` (new), `jobs-data` (new) | Yes (data model, new package) | 03, 04, 05 |
| M0 | `api-add-user-ids-and-jobs-db` | `api-backend` (MODIFIED: caller identity), `jobs-data` | Yes (migration, cross-DB) | 03 §2, 04, 14 |
| M0 | `cv-extract-cv-engine` | `cv-engine` (new), `cv-generator` (MODIFIED: imports) | Yes (new package, cross-app) | 08 |
| M1 | `jobs-add-dashboard` | `jobs-dashboard` (new), `jobs-tracker-api` (new), `api-backend` (MODIFIED: CORS, legacy jobs facade), `home-hub` (MODIFIED: services) | Yes (BFF, legacy migration) | 06, 10, 12, 05 |
| M2 | `api-extend-oauth-for-cli` | `api-auth` (MODIFIED: refresh, revocation, scopes, loopback, consent, devices) | Yes (security) | 17 |
| M2 | `jobs-add-cli` | `jobs-cli` (new), `jobs-discovery` (new), `jobs-sync` (new) | Yes (new runtime, Python toolchain) | 15, 16, 20, 22 |
| M3 | `jobs-add-cv-variants` | `jobs-cv-variants` (new), `cv-engine` (MODIFIED: private visibility D-25), `jobs-files` (new) | Yes (R2, security) | 08, 14 |
| M4 | `jobs-add-matching` | `jobs-matching` (new), `jobs-ai` (new) | Yes (new external provider, privacy) | 07, 11 §11, 14 |
| M5 | `jobs-add-browser-agent` | `jobs-automation` (new), `jobs-browser-agent` (new), `jobs-dashboard` (MODIFIED) | Yes (security, protocol) | 18, 19, 21 |
| M6 | `jobs-add-email-applications` | `jobs-email-applications` (new) | Yes if `server_send` | 09 |
| M6 | `jobs-add-analytics` | `jobs-analytics` (new), `jobs-dashboard` (MODIFIED) | No | 10 |
| M7 | `jobs-add-auto-apply` | `jobs-automation` (MODIFIED: auto mode), `jobs-discovery` (MODIFIED: adapters) | Yes (security, legal) | 19 §8, 15 |

Every change runs `openspec validate <id> --strict` before review. Conflicts
are checked against active changes (**[VERIFIED]** `update-zedative-design-system`
and `home-add-hub-landing-page` are active today).

---

## 4. Test strategy per component

| Component | Framework | Unit | Integration | Notes |
|---|---|---|---|---|
| `apps/api` jobs routes, repo, services | `bun test` (**[VERIFIED]** existing; `test/fakes.ts` uses **real bun:sqlite with real migrations** for D1 and an in-memory KV) | Repo functions, transition rules, fingerprint, conflict matrix, scope map | Route-level through `createApp(...)` (**[VERIFIED]** `src/app.ts` is testable without the DO); fakes extended with `JOBS_DB` (second sqlite), R2 (in-memory Map with `put/get/delete/head`), Queue (captured messages + manual `queue()` dispatch) | Generated route table → mandatory isolation case per route (11 §13) |
| `packages/jobs-contracts` | `bun test` | Schema round-trips; JSON Schema export snapshot; fingerprint vectors | Python side consumes the same vectors (pytest) | Contract drift fails both suites |
| `packages/cv-engine` | vitest | Template-utils, markdown | Render to buffer in Node for the 4 templates × fixtures → PDF text extraction snapshot | A-02 |
| `apps/jobs` | vitest (per-app, **[VERIFIED]** repo convention) | Hooks, merge logic, polling backoff, i18n keys parity EN/ID | Server functions against a stubbed `API` binding | |
| `apps/jobs` UI e2e | `agent-browser` (**[VERIFIED]** mandated by root `CLAUDE.md` § Browser testing) scripted flows + screenshots at 375/1280, light/Night Desk | — | Against `bun dev` (`apps/jobs` 4007 + `apps/api` 8788 with local D1) | Snapshot review of a11y tree (`agent-browser snapshot -i`) |
| `apps/jobs-cli` | pytest (+ `pytest-asyncio`), ruff, pyright | Adapters (recorded fixtures), normalization, fingerprint, outbox, backoff, redaction, policy guard, action validator | CLI ↔ `wrangler dev` on `:8788` with local D1 migrations applied (`bun run db:migrate:local`) | OS matrix in CI |
| Browser agent | pytest + Playwright Python against a **fixture ATS server** | Observation extraction, candidate enumeration | Full apply loops with a **fake AI provider** (deterministic, scripted answers) and a recorded-cassette mode against the real provider (nightly, budget-capped) | See §5 |
| Load / non-functional | k6 or a Bun script against `wrangler dev` and a staging Worker | — | §6 | |

### 4.1 Fixture ATS server

**[NEW]** `apps/jobs-cli/tests/fixtures/ats_server/` — a small Starlette app
(test-only dependency) serving deterministic pages:

- Greenhouse-, Lever- and Ashby-like application forms (multi-step, file
  inputs, custom questions, EEO sections, validation errors);
- confirmation pages and decoy confirmation pages (the text says "thank you"
  while the URL stays on the form with errors);
- a CAPTCHA placeholder and a "login required" wall;
- off-domain redirects;
- prompt-injection variants (hidden text, `aria-label` instructions, option
  labels with commands);
- slow pages and network failures.

It also serves Greenhouse/Lever/Ashby **JSON board API** responses recorded
from the real endpoints (pinned files) for discovery tests.

---

## 5. End-to-end scenarios (release-gating)

Notation: **W** = web (`apps/jobs`), **C** = CLI, **A** = API.

| # | Scenario | Expected result | Milestone |
|---|---|---|---|
| S-01 | Magic-link sign-in to W; the BFF cookie is set; `GET /board` returns empty | Board empty state; no bearer visible to JS (`document.cookie` lacks it) | M1 |
| S-02 | Legacy migration parity: seed 50 KV jobs → dry run → execute → compare `/api/jobs` and MCP `jobs_list/get` outputs | Identical content; statuses mapped 1:1; sections preserved; `legacy_job_id` lookups work | M1 |
| S-03 | DnD a card Saved → Ready → Applied on W; then try Applied → Preparing | Events recorded; the illegal move is rejected with an inline message | M1 |
| S-04 | `pilih-jobs login` (loopback, random port) → consent shows the device name → token stored in keychain → `whoami` | Grant + device created; `/cli` shows the device online within 10 s | M2 |
| S-05 | Refresh rotation: force access token expiry; CLI refreshes; replay the old refresh token | New pair issued; replay revokes the family; CLI must re-login | M2 |
| S-06 | Discover Greenhouse + Lever + Ashby (fixture boards) → batch upsert → Inbox shows new postings with provenance | Counts match the fixtures; fingerprints equal the golden vectors | M2 |
| S-07 | Run the same discovery twice, then once with 3 postings removed (×2 complete runs) | Second run: 0 new, all `unchanged`; removed postings `closed` after 2 complete runs | M2 |
| S-08 | Discovery offline: network down mid-run → outbox holds batches → reconnect → `sync` | Zero duplicates; run `completed`; idempotent replays return `Idempotent-Replayed: true` | M2 |
| S-09 | Create a CV variant (no AI) → CLI `render_cv` task headless → PDF in R2 → approve on W | SHA-256 matches; render-equivalence holds; variant private (D-25) | M3 |
| S-10 | AI tailoring with a fabrication-bait job ("10 years of Rust" while the CV has none) | Variant contains no new skill/employer/date; the validator report lists rejected edits | M4 |
| S-11 | Bulk score 300 postings | Queue processes them; cached on re-request; budget counter increments; DLQ empty | M4 |
| **S-12** | **Golden path (approval mode)**: login → device → discover → score → track → tailor → approve CV → start apply on W targeting the device → CLI claims → fills the fixture Greenhouse form → approval appears on W → approve → submit → verify → board shows Applied ✓ Verified | Every event in the timeline in order; evidence `verified` with two signals; `submit_intent` before submit | M5 |
| S-13 | Assisted mode: the agent fills, the user clicks Submit in the headed browser | Evidence captured after the user's click; status `submitted_verified` or `_unverified` per signals | M5 |
| S-14 | Two devices poll; one apply task | Exactly one claims; the other gets 204; `ux_tasks_live_apply` blocks a second live task | M5 |
| S-15 | Lease loss **before** `submit_intent` (kill the CLI mid-fill) | After 120 s: attempt `lease_expired`, task back to `queued`, retried by another device | M5 |
| S-16 | Lease loss **after** `submit_intent` (kill the CLI right after clicking submit) | Task `outcome_unknown`; **no** automatic retry; W asks "Did this go through?" | M5 |
| S-17 | Device revoked from W mid-run | The next heartbeat gets `401 invalid_token` (`reason: revoked_token`, 05 §1.3); the CLI stops the browser actions immediately; task `queued` or `outcome_unknown` per checkpoint | M5 |
| S-18 | Prompt-injection page set (≥ 30 variants) | No off-allowlist navigation, no upload outside staging, no non-fact value; outcome paused/failed with reason | M5 |
| S-19 | CAPTCHA/challenge page during apply | `paused(captcha_or_challenge)`; W prompt; no automated solving; resume after the human solves it in the headed browser | M5 |
| S-20 | Protected question (disability / ethnicity) with no stored answer; then with a stored `auto_use=approval` answer | First: pause with an answer approval; second: an approval is still required; never auto-answered | M5 |
| S-21 | Approval expires (24 h, time-travelled in test) | Approval `expired`, task `cancelled`, application stays `ready` | M5 |
| S-22 | Form changes between approval and submit (fixture mutates a field) | `payload_hash` mismatch → new approval requested; no submit | M5 |
| S-23 | Decoy confirmation (text says thanks, validation errors present) | Verdict `negative`; the agent reports `failed` with `validation_error` | M5 |
| S-24 | Offline submit, then conflict: the CLI finishes a submission while offline (result in the outbox); meanwhile the user moves the card to Withdrawn on W; the CLI reconnects | Result recorded as events; stage **not** overwritten (`applied_to_state=0`, `conflict_recorded`); submission status updated with evidence; W shows the conflict notice | M5 |
| S-25 | Email application, local hand-off: draft → approve → `.eml` opened → user confirms sent | Email status `handed_off` (final for `local_handoff`; `sent` is `server_send` only); evidence `email_sent` with verdict `unverified`; application `submitted_unverified` | M6 |
| S-26 | Email application, server send (if A-03 holds) | Delivered; `provider_message_id` stored; rate limit at 11th/day | M6 |
| S-27 | Analytics recomputation for seeded users | Summary endpoint equals a raw-event recomputation | M6 |
| S-28 | Auto rule activation → 3 matching jobs → auto submissions within limits; 4th exceeds `max_per_day` | 3 submitted; 4th stays `ready` with reason `limit_reached` | M7 |
| S-29 | Excluded sources: add a LinkedIn/Indeed source via the API and via the CLI | 422 `unsupported_source`; the CLI refuses before any request | M2 |
| S-30 | Workday opt-in tenant returns 403 | The source stops with `access_denied`; no retries with altered identity; run `partial` | M7 |
| **S-31** | **Cross-user isolation sweep**: users A and B with full data sets; B calls every `/api/v1` route and MCP tool with A's ids | 404/empty everywhere; zero leaks; also as an admin (D-26) | M1, re-run every milestone |
| S-32 | CLI below `min_cli_version` | 426 on every route except meta/auth; `pilih-jobs` prints the upgrade instructions | M2 |
| S-33 | Account deletion | Grants revoked, `JOBS_DB` rows and R2 objects gone; the CLI wipes local state on next call | M6 |

---

## 6. Non-functional tests

| Area | Target | Method |
|---|---|---|
| Sync batch throughput | `postings:batch` of 100 items ≤ 1.5 s p95 and ≤ 600 D1 rows written (indexes included) | Load script against a staging Worker with a seeded 200k-posting DB |
| D1 query budget per request | ≤ 50 queries per request on hot paths (the Free plan limit is 50 per invocation **[VERIFIED]** https://developers.cloudflare.com/d1/platform/limits/; Paid allows 1,000) | Test helper counts `prepare()` calls per route |
| Board latency | `GET /board` ≤ 300 ms p95 for 500 applications | Load script |
| Claim contention | 20 devices × 1 poll/s on one user, 100 tasks → no double claims, ≤ 200 ms p95 | Concurrency test against `wrangler dev` |
| Change feed | 10k changes → client catches up in ≤ 20 pages; `410 cursor_expired` → full resync works | Integration test |
| Cost guardrails | Per-user AI budget stops spending at the cap; queue retries do not double-charge (idempotent score keys) | `bun test` with a fake provider counting calls |
| CLI resources | Discovery of 3 API sources × 500 postings ≤ 60 s, ≤ 400 MB RSS (excluding the browser) | pytest benchmark marker |
| Agent bounds | Every attempt stops at ≤ 60 actions, ≤ 25 AI calls, ≤ 15 min | Fixture with an infinite multi-step form |

---

## 7. CI layout

- **Existing**: `bun run check` (biome → turbo lint → lint:typography → parity:typography → parity:twmerge → test → audit, **[VERIFIED]** root `package.json`). It gains `apps/jobs` in the lint roots, and `openspec validate --strict` for active changes.
- **Python leg** (A-06):
  - `uv sync --frozen`, `uv run ruff check`, `uv run pyright`, `uv run pytest -m "not e2e"`, `uv run pip-audit`;
  - wired as turbo tasks through `apps/jobs-cli/package.json`, so `bun run check` always runs them; a missing `uv` fails loudly through `scripts/require-uv.sh` (02 §4.2) instead of skipping the leg;
  - CI always has `uv`. **[VERIFIED (local check 2026-10-11)]** `uv` is installed on the owner's machine (`/opt/homebrew/bin/uv`).
- **E2E leg** (nightly + pre-release): spin up `apps/api` via `wrangler dev`, `apps/jobs` dev, and the fixture ATS server; run CLI e2e on macOS, Windows and Ubuntu runners; run the `agent-browser` UI flows.
- **Live-provider leg** (nightly, budget ≤ $1/night): Decisions/Responses contract tests (A-01).

---

## 8. Release gates

| Gate | Required before |
|---|---|
| G1 Isolation sweep S-31 green | Any production deploy of jobs routes |
| G2 Legacy parity S-02 green + owner approval of the migration execution | M1 production cutover |
| G3 OAuth security tests (17) + external review of the OAuth diff | M2 public CLI release |
| G4 Scrapling policy guard + D-17 enforcement tests | M2 public CLI release |
| G5 Prompt-injection corpus 0 violations; evidence audit 100% | M5 public release |
| G6 Privacy notice updated (AI processing, retention); ZDR requested; A-09 legal review | M4 public release |
| G7 A-07 legal review closed | Enabling `auto` for anyone outside the owner (M7) |
| G8 Cost dashboard + budgets live | M4 |

---

## 9. Rollout plan

1. **Feature flags** (`feature_flags` in `DB`, 11 §14; canonical keys in D-33): `JOBS_V1_ENABLED` (dashboard, discovery and the whole `/api/v1`), `JOBS_CLI_LOGIN_ENABLED`, `JOBS_AUTOMATION_ENABLED` (browser agent, assisted/approval modes), `JOBS_AUTO_MODE_ENABLED`, `JOBS_EMAIL_SERVER_SEND_ENABLED`, `AI_DISABLED` (scoring falls back to deterministic-only, tailoring and agent AI calls stop), `JOBS_LEGACY_BACKEND`. Per-adapter enablement lives in the adapter manifest (`packages/jobs-contracts/adapters.json`, 15 §14), not in flags. Flags are evaluated server-side; `apps/jobs` reads them via the `features` field of `GET /api/v1/meta`.
2. **Internal dogfood** (owner + ≤ 5 trusted users) at each milestone for ≥ 1 week with real job searches. Daily review of failed and `outcome_unknown` attempts.
3. **Beta cohort** (≤ 50 users) from M5: `approval` mode only, Greenhouse/Lever/Ashby only, a server cap of 10 submissions/user/day.
4. **General availability** of manual/assisted/approval after M6, with the hub flipped to `live` (12 §15).
5. **Auto mode** last (M7): allowlisted users only, then opt-in for all, with the kill switch tested in production.
6. **CLI distribution**: TestPyPI → PyPI (`pilih-jobs`) → Homebrew tap / Scoop / winget (22). `min_cli_version` is raised only with 14 days' notice in `/meta` (`recommended_cli_version` first).

---

## 10. Definition of done (per change)

- [ ] OpenSpec change approved, every `tasks.md` item done and ticked; `openspec validate <id> --strict` passes.
- [ ] `bun x ultracite fix && bun run check` and `bun run check-types` green; the Python leg green when the change touches the CLI.
- [ ] Tests: unit + integration for every new route/command; the isolation case for every new route; e2e scenarios for the milestone pass.
- [ ] Security: threat-model deltas reviewed against 11; no new logging of secrets/PII; scopes declared for every route.
- [ ] Docs: the relevant `job-tracker-spec/` document updated if behaviour diverged; `apps/api/CLAUDE.md` route table updated; `CLAUDE.md`/`AGENTS.md` updated for new apps/packages and ports (4007).
- [ ] UI: design compliance checklist (12 §14); `agent-browser` screenshots at 375/1280 in light and Night Desk; no console errors (`agent-browser errors`).
- [ ] Ops: migrations applied locally and dry-run against staging; owner sign-off for any remote resource, deploy or data migration.
