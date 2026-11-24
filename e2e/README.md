# e2e — full-stack scenarios of the Job Tracker

The release-gating scenarios of `job-tracker-spec/13` §5 that need more than
one component, run against real processes on this machine: `apps/api` under
`wrangler dev`, the `apps/jobs` dashboard under `vite dev`, the `pilih-jobs`
CLI (`apps/jobs-cli`) through `uv run`, the CLI's fixture ATS server, fixture
job-board APIs and a scripted Chromium playing the user. Nothing here touches a
remote Cloudflare resource, OpenAI or the internet.

What is not automated here, and why, is in [`HANDOFF.md`](./HANDOFF.md).

## Run

```sh
bun test e2e --timeout 900000              # everything (≈ 20 min)
bun test e2e/auth.test.ts --timeout 900000 # one file
bun test e2e --timeout 900000 -t S-12      # one scenario id
```

Inside Claude Code prefix `env -u CLAUDECODE` to see the passing lines. The
release gate runs the same command through
`.unlazy/jobs/checks/run-tests.mjs` (≥ 30 passing tests, every scenario id
passing).

Every test file works in its own scratch directory (`$TMPDIR/pilih-e2e-*`),
removed when the file ends; `E2E_KEEP=1` keeps it: wrangler, vite and CLI logs
(`logs/`), the local D1/KV/R2 state of every api instance, every CLI home and
the browser downloads. The migrated + seeded api state is cached between runs
in `$TMPDIR/pilih-e2e-api-template-<hash>` (the hash covers both migration
sets, `scripts/seed-local.ts` and `wrangler.jsonc`).

## Prerequisites

- Bun 1.4.2 and `bun install` at the repo root (wrangler, vite, the apps).
- uv, and the CLI environment: `uv sync --project apps/jobs-cli`.
- Chromium for Playwright (the user's browser and the CLI's browser):
  `uv run --project apps/jobs-cli playwright install chromium`.
- Free ports: **4007** (apps/jobs; the api only accepts the dashboard there),
  and for T8-03 **4003** (apps/cv) and **8788** (apps/cv calls the api there in
  dev). Stop `bun dev` / `bun run dev:api` first. Every other port is random.
- A desktop session (macOS, or Linux with `DISPLAY`): assisted mode (S-13)
  opens a headed Chromium window by design. Everything else is headless.

## Layout

| Path | What |
|---|---|
| `harness/api.ts` | `ApiServer`: migrates both D1s and seeds the D-33 flags once into a template state, copies it per instance, boots `wrangler dev --port <random> --persist-to <tmp> --env-file` (`JOBS_AI_MODE=fake`, `JOBS_APP_ORIGIN=http://localhost:4007`, `--test-scheduled` for the lease cron), reads e-mails the local `EMAIL` binding printed, queries the local D1/R2 sqlite files read-only, restarts with other vars (S-32) |
| `harness/users.ts` | `signIn`: the real e-mail link flow (`/auth/request` → printed link → `POST /auth/verify`); the browser-session bearer is what the dashboard's BFF holds, so `user.api` calls `/api/v1` exactly like the dashboard |
| `harness/web.ts` + `support/jobs-vite.config.ts` | apps/jobs `vite dev` on :4007 with a generated Worker config and `.dev.vars` pointing `JOBS_API_FALLBACK_URL` at the e2e api (the developer's `.dev.vars` is never read) |
| `harness/cvapp.ts` | apps/cv `vite dev` on :4003, unchanged, plus a forwarder on :8788 to the e2e api |
| `harness/cli.ts` | `CliHome`: one isolated `PILIH_JOBS_HOME` per device, encrypted-file credential store, `uv run --project apps/jobs-cli --frozen pilih-jobs --json …`; `login()` runs `login --no-browser --port …` and approves the consent page in the browser |
| `harness/proxy.ts` | `ApiProxy`: each device talks to the api through its own recording proxy (`X-Forwarded-Host` makes the api publish the proxy as its issuer). It records every exchange (status, `Idempotent-Replayed`, bodies), goes offline (resets connections), drops answers after the api committed them, and runs hooks at exact protocol steps (kill the CLI at the claim ack, before `submit-intent`, …) |
| `harness/browser.ts` + `support/browser_driver.py` | the user's Chromium: Playwright from the CLI venv, driven over stdin/stdout JSON lines; a 1600 × 900 viewport so the board's Saved…Applied lanes fit beside the sidebar, and `drag` scrolls the target lane into view first |
| `harness/ats.ts` + `support/ats_fixture.py` | the CLI's fixture ATS server (`apps/jobs-cli/tests/fixtures/ats_server`) in a subprocess, plus e2e forms (`/e2e/<n>/…` without a file input, `/cv/<n>/…` with a required resume, `/human/…` for assisted mode, `/jobs/golden` with a JSON-LD posting), request holds and a control API |
| `harness/boards.ts` | the CLI's recorded Greenhouse / Lever / Ashby board responses on a local port (`PILIH_JOBS_ENV=test`, `PILIH_JOBS_TEST_BASE_URLS`); postings can be removed between runs |
| `harness/applicant.ts` | AI consent, profile facts, and a base CV created like an AI app does it (MCP `cv_create` + `PUT /api/cv/:id`) |
| `harness/lab.ts` | `Lab`: api + fixture ATS + browser + a prepared user, CLI devices, `pilih-jobs worker` processes with their NDJSON events, an auto-approver |
| `harness/procs.ts` | every child in its own process group; `kill9()` takes the CLI and its Chromium down together; everything is killed on exit |

## Scenarios

| File | Ids |
|---|---|
| `web.test.ts` | S-01, S-03 |
| `auth.test.ts` | S-04, T17-14, S-05 (rotation, reuse, grace), T17-15, S-32 |
| `discovery.test.ts` | S-06, S-07, S-08 |
| `cv.test.ts` | S-09, T8-03 |
| `apply.test.ts` | S-14, S-17, S-13, T21-13 |
| `leases.test.ts` | T21-14 (seven kill points), S-16, S-24, S-15 |
| `golden.test.ts` | S-12 |
| `account.test.ts` | S-25, S-33 |

### The dashboard after round 3 (automation removed)

The dashboard (`apps/jobs`) is now a manual tracker: board (kanban / list /
table, details sheet `?app=`), the full application page with its tabs,
stats, profile and settings. The inbox, approvals, runs / run monitor, rules,
sources, CLI & devices pages and the Apply tab are gone (their URLs show the
404 page). The api, the CLI and the scraper still serve and use every
automation route, so the scenarios keep covering them; where a step used a
removed screen, it now calls the same `/api/v1` route that screen called, as
the signed-in user (`lab.user.api`, or the dashboard's own session bearer
from `webSignIn`):

| Scenario | Was (removed UI) | Now |
|---|---|---|
| S-01 (`web.test.ts`) | — | also checks the new shell: the sidebar links only Board / Stats / Profile / Settings, the profile dropdown opens from the footer, `/approvals`, `/inbox`, `/cli` show "Page not found" |
| S-04 (`auth.test.ts`) | `/cli` page showed the device "Online" within 10 s | `GET /api/v1/devices` with the dashboard session lists the device `online` and `signed_in` within 10 s |
| T17-15 (`auth.test.ts`) | `/cli` row menu → Revoke → "Revoke device" | `POST /api/v1/devices/{id}/revoke` with the dashboard session (the device comes back `signed_in: false`); the CLI checks are unchanged |
| S-12 (`golden.test.ts`) | Apply tab "Start apply" on the device; approvals queue "Approve and submit"; the card's "Verified" badge | `POST /api/v1/tasks` (`startApply`, the application's mode, this device); `POST /api/v1/approvals/{id}/decide` (`decide`, with the payload hash); the card is in the Applied lane and the full page's Timeline tab reads "Submission: Submitted ✓." The CV approval on the CV tab is still done in the browser |
| S-16 (`leases.test.ts`) | "Review outcome" → "Did this application go through?" dialog | the `submission_status_changed → outcome_unknown` event exists, and the Timeline tab reads "Submission: Needs review." (the prompt itself was removed with the automation) |

Unchanged: S-03 (drag and drop on the kanban lanes), S-09 / S-12 CV approval
(CV tab → Approve → "Approve this CV?"), S-24 (Timeline tab "Conflict:"), and
every scenario that already used the api directly (S-06…S-08 read the inbox
through `GET /api/v1/inbox`, S-13 / S-14 / S-17 / T21-13 / T21-14 decide
approvals with `lab.autoApprove` / `decide`).

Product defects these scenarios found are filed in
`.unlazy/jobs/requests/leaf-5.1.md`; the tests stay as the spec states them.
