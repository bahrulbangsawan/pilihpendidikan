# Change: Add the browser agent and the automation execution protocol (assisted and approval modes)

## Why

Tracking applications is only half of the Job Tracker: users want the local
CLI to fill and submit application forms for them, while every submission
stays under their control and is never double-sent or inferred. The spec
(milestone M5 of `job-tracker-spec/13` §2) defines a remote-to-local task
protocol with leases (21), a Playwright browser executor on the user's own
machine (18), and an AI agent that only chooses among actions the executor
enumerated and only types values that come from the user's verified facts
(19). This change records that capability for the `assisted` and `approval`
modes; `auto` mode is the separate `jobs-add-auto-apply` change.

## What Changes

- **Task protocol in `apps/api`** (`/api/v1/tasks*`, `/devices/{dev_id}/tasks:claim`,
  `…/lease/{lease_id}/{heartbeat,events,approvals,submit-intent,result,release}`,
  `/tasks/{tsk_id}/{cancel,retry,resume}`, `/tasks/{tsk_id}/attempts/{att_id}/late-evidence`,
  `/approvals*`, `/rules*`): task creation with the D-29 scope rule, atomic
  D1 claims (D-11), 120 s leases fenced by `lease_id`, a synchronous
  `submit-intent` checkpoint (D-28), result precedence (20 §6.2), approvals
  bound to a `payload_hash`, release, retry, resume, cancel, late evidence,
  and the `*/5` reaper cron with lazy per-user reaping (D-19).
- **Rules** (`automation_rules`) in `approval` / `assisted` mode as plain CRUD,
  and the `evaluate_rules` queue consumer that turns ready scores into tasks
  (07 §10).
- **AI proxy routes** `POST /api/v1/ai/{page-classify,next-action,field-plan,verify-submission}`
  (05 §9, 19 §4–§9): device-bound `ai:invoke`, a live lease reference,
  server-side fact injection with minimization, the 19 §6.4 validator, budgets
  (D-34), `AI_DISABLED` and AI consent gates. The CLI never holds a key (D-12).
- **CLI worker** (`apps/jobs-cli/src/pilih_jobs/tasks/`, `cli/worker.py`,
  `cli/apply.py`, `cli/approvals.py`, `cli/rules.py`): one worker per device
  (D-31), server-guided adaptive polling, the `LeaseChannel` with 30 s
  heartbeats and the 90 s / 110 s local deadlines, approvals, synchronous
  submit-intent, crash recovery, service files, and `pilih-jobs apply`.
- **Browser and agent** (`apps/jobs-cli/src/pilih_jobs/{browser,agent,policy}/`,
  `cli/browser.py`): modes A / B / C (D-22, D-23, D-32), profile locks, the
  page observer, the closed action executor, the navigation guard, upload
  staging, challenge pauses, evidence capture, the agent loop with
  deterministic-first candidates (D-13), the autonomy policy, the submit gate,
  verification (19 §9.1) and per-attempt budgets; plus the fixture ATS server
  with the prompt-injection corpus (13 §4.1).
- **Dashboard** (`apps/jobs`): the Apply tab, the Automation screens
  (approval queue, rules editor, runs table, live run monitor; 12 §6).

## Impact

- Affected specs: `jobs-automation` (new), `jobs-browser-agent` (new),
  `jobs-dashboard` (ADDED requirements on top of `jobs-add-dashboard`).
- Affected code: `apps/api/src/jobs/{routes,services,repo}/automation/**`,
  `apps/api/src/jobs/{routes,services,repo}/ai-proxy/**`,
  `apps/api/src/jobs/cron/handlers/leases.ts`,
  `apps/api/src/jobs/queue/handlers/evaluate-rules.ts`,
  `apps/api/src/jobs/repo/core/leases.ts`, `apps/api/src/tools/jobs-approvals.ts`;
  `apps/jobs-cli/src/pilih_jobs/{tasks,browser,agent,policy}/**`,
  `apps/jobs-cli/src/pilih_jobs/cli/{apply,worker,browser,approvals,rules,logs}.py`,
  `apps/jobs-cli/tests/{tasks,browser,agent,commands}/**`,
  `apps/jobs-cli/tests/fixtures/ats_server/**`;
  `apps/jobs/src/components/automation/**`,
  `apps/jobs/src/components/application/apply-tab.tsx`,
  `apps/jobs/src/routes/automation*.tsx`; contracts in
  `packages/jobs-contracts/src/{agent,stage}.ts` and `src/api/automation.ts`
  (owned by `jobs-add-contracts-and-schema`).
- Sources: `job-tracker-spec/18-BROWSER-AUTOMATION.md`,
  `19-AI-APPLICATION-AGENT.md`, `21-AUTOMATION-EXECUTION-PROTOCOL.md`,
  `05-API-SPECIFICATION.md` §8–§9, `03-DOMAIN-MODEL.md` §5–§8,
  `11-SECURITY-PRIVACY-AND-ISOLATION.md`, `12-UI-UX-SPECIFICATION.md` §6,
  `16-LOCAL-CLI-ARCHITECTURE.md` §3/§6/§7, `20` §6; decisions D-11, D-12,
  D-13, D-18, D-19, D-22, D-23, D-28, D-29, D-31, D-32, D-33, D-34, D-35;
  assumptions A-01, A-07.
- Status: implemented in the working tree; **not committed, not deployed**.
  No flag has been turned on in production, no real-ATS pilot has run, and
  the A-07 legal review has not started (owner actions, see `tasks.md`).
