Evidence legend: "gate" = the leaf ledger gate in `.unlazy/jobs/gates/` is
ticked and `.unlazy/jobs/status.log` records the leaf VERIFIED. Test ids name
passing tests in the cited suite. Nothing below was deployed, and no
production flag was changed.

## 1. Task protocol (`apps/api`, leaf 2.7, gate VERIFIED)

- [x] 1.1 Task create / list / detail with the D-29 scope rule and one live apply task per application — `apps/api/src/jobs/services/automation/tasks.ts`, `repo/automation/tasks.ts`, `routes/automation/index.ts` (TA-TASK-SCOPE, `tasks.test.ts`)
- [x] 1.2 Atomic claim with lazy reaping, eligibility, capability subset, per-kind lease cap and context bundle — `services/automation/{claim,context}.ts`, `repo/automation/claim.ts` (T21-01, T21-02, T21-09, S-14, TA-CAPS, TA-CLAIM)
- [x] 1.3 Heartbeat, events, pauses, resume; lease fence re-checked inside the write batch — `services/automation/lease.ts`, `repo/automation/lease.ts`, `repo/automation/fences.test.ts` (T21-03, T11-LEASE, TA-RESUME)
- [x] 1.4 Approvals bound to `payload_hash`, first decision wins, 24 h expiry, answer bank rules, MCP export — `services/automation/approvals.ts`, `apps/api/src/tools/jobs-approvals.ts` (TA-APPROVALS, S-21)
- [x] 1.5 Synchronous submit-intent (D-28) with approval, state, auto-rule and global 40/day checks — `services/automation/intent.ts` (T21-04, S-22)
- [x] 1.6 Result with 20 §6.2 precedence and forward-only submission status; release incl. `awaiting_approval` and `needs_headed` — `services/automation/{result,evidence}.ts`, `repo/core/application-state.ts` (T21-06, TA-RELEASE)
- [x] 1.7 Reaper: `*/5 * * * *` cron (`apps/api/wrangler.jsonc`) and lazy per-user reaping; D-19 outcome rules; queued and approval expiry — `cron/handlers/leases.ts`, `services/automation/reaper.ts`, `repo/core/leases.ts` (T21-05, S-15, S-16)
- [x] 1.8 Device revocation effects on leases and pinned tasks — `repo/core/leases.ts`, `jobs/services/devices` (T21-07)
- [x] 1.9 Cancel, retry (`confirm_not_submitted`, `retry_of`), late evidence — `services/automation/{tasks,late-evidence}.ts` (T21-08, TA-RETRY, TA-LATE-EVIDENCE)
- [x] 1.10 `JOBS_AUTOMATION_ENABLED` gating and `automation_paused` refusal — `services/automation/claim.ts`, `intent.ts` (TA-FLAGS)
- [x] 1.11 Rules CRUD for non-auto modes and the `evaluate_rules` consumer (07 §10) — `services/automation/{rules,rule-engine}.ts`, `queue/handlers/evaluate-rules.ts` (TA-RULES, T7-10)
- [x] 1.12 Every automation route declared with its scope and covered by the S-31 isolation sweep — `src/jobs/isolation-sweep.test.ts` (leaf 2.11 gate VERIFIED)

## 2. AI proxy (`apps/api`, leaf 2.5, gate VERIFIED)

- [x] 2.1 `page-classify`, `next-action`, `field-plan`, `verify-submission` routes with lease_ref, consent, `AI_DISABLED`, budget and usage accounting — `apps/api/src/jobs/routes/ai-proxy/index.ts`, `services/ai-proxy/{call,operations}.ts` (TAI-LEASE-REF, TAI-BUDGET, TAI-DISABLED, TAI-CLASSIFY, TAI-NEXT, TAI-VERIFY)
- [x] 2.2 Server-side fact injection with minimization, question matching and the 19 §6.4 validator — `services/ai-proxy/{facts,questions,validator}.ts` (TAI-FIELDPLAN, TAI-QUESTIONS, TAI-PII, TAI-STORE-FALSE)

## 3. CLI worker and commands (`apps/jobs-cli`, leaf 4.4, gate VERIFIED)

- [x] 3.1 Worker loop, adaptive polling, backpressure, lock + IPC, crash recovery, service files — `src/pilih_jobs/tasks/{worker,poll,ipc,locks,recovery,service,scheduler}.py`, `cli/worker.py` (TWK-POLL, TWK-IPC, TWK-RECOVERY, TWK-SERVICE, T16-SIGNALS)
- [x] 3.2 `LeaseChannel`: 30 s heartbeats, 90 s / 110 s local deadlines, events batching, approvals, synchronous submit-intent, late evidence, `401 revoked_token` = lease lost — `src/pilih_jobs/tasks/lease.py` (TWK-LEASE, TWK-HEARTBEAT, T21-10, T21-12)
- [x] 3.3 `pilih-jobs apply` (`--matched`, `--approve`, `--resume`, `--dry-run`), per-application lock, SIGINT semantics — `src/pilih_jobs/tasks/apply.py`, `cli/apply.py` (TWK-APPLY)
- [x] 3.4 `approvals` and `rules` commands — `cli/approvals.py`, `cli/rules.py`, `tests/commands/test_inbox_approvals.py` (TCMD-APPROVALS)

## 4. Browser and agent (`apps/jobs-cli`, leaf 4.3, gate VERIFIED 2026-10-12T16:31Z)

- [x] 4.1 Browser modes A / B / C, CDP loopback validation, profile locks and default-profile refusal, headless/headed policy — `src/pilih_jobs/browser/{controller,modes,cdp,profiles,headless,session}.py`, `cli/browser.py` (T18-U, T18-mode, T18-F16)
- [x] 4.2 Page observer (`browser/js/extract_form.v1.js`), closed executor, navigation guard, popups/dialogs/downloads, cookie banners, upload staging — `browser/{observer,executor,actions,staging}.py`, `policy/domains.py` (T18-exec, T18-F01…F12, T11-TRAVERSAL, T11-COOKIE)
- [x] 4.3 Challenge detection and pauses, checkpoints, interruption recovery, evidence recorder — `browser/{challenge,checkpoint,evidence}.py` (T18-F06, T18-F07, T18-F14, T18-F17, S-19, S-23)
- [x] 4.4 Agent loop, candidates, plan validator, policy engine, submit gate, verification, budgets, step log — `src/pilih_jobs/agent/{loop,candidates,validate,policy,submit,verify,budget,steplog,injection}.py` (T19-CANDIDATES, T19-VALIDATOR, T19-POLICY, T19-SUBMIT, T19-VERIFY, T19-BUDGET, T21-11)
- [x] 4.5 Fixture ATS server and the ≥ 30-page prompt-injection corpus — `tests/fixtures/ats_server/{server,pages,injection,app_handlers}.py`, `tests/browser/test_injection_corpus.py` (T11-INJECTION, T11-PROTECTED, S-18, S-20, S-22)
- [x] 4.6 Re-check during this change (2026-10-13): `uv run pytest tests/agent tests/browser -m "not browser"` → 177 passed; with Chromium (`-m browser`) → 176 passed, 1 failed: `test_T18_F13_browser_killed_before_submit_relaunches_once` (assert 1 == 2, twice in a row, while other suites ran concurrently on the machine). The leaf 4.3 gate G1 passed earlier. Re-run in isolation on the same day (`-m browser -k T18_F13`, no concurrent suites): 1 passed. The failure is load-sensitive (timing under concurrent suites), not a functional regression; recorded for the driver / owner to watch, no code changed here (outside `openspec/**`).

## 5. Dashboard (`apps/jobs`, leaf 3.2, gate VERIFIED)

- [x] 5.1 Apply tab — `apps/jobs/src/components/application/apply-tab.tsx`
- [x] 5.2 Approval queue — `components/automation/{approvals-page,approval-bodies,decide-dialog}.tsx` (TW-APPROVAL)
- [x] 5.3 Rules editor with activation summary — `components/automation/{rules-page,rule-editor}.tsx` (TW-RULES)
- [x] 5.4 Runs table with retry / confirm dialogs and live run monitor — `components/automation/{runs-page,run-dialogs,run-monitor-page,monitor-parts}.tsx`, `src/routes/automation*.tsx` (TW-MONITOR)

## 6. Owner handoffs

- [x] 6.1 Handoff recorded (NOT executed — owner action): turn `JOBS_AUTOMATION_ENABLED` on in the production `DB.feature_flags` after deploying `apps/api`; it is dark in every migration and was not changed.
- [x] 6.2 Handoff recorded (NOT executed — owner action): deploy `apps/api`, `apps/jobs` and publish the CLI (see `DEPLOY.md`); no deploy or publish happened in this change.
- [x] 6.3 Handoff recorded (NOT executed — owner action): start the A-07 legal review of user-directed browser automation on Greenhouse, Lever and Ashby forms (must start in M5).
- [x] 6.4 Handoff recorded (NOT executed — owner action): real-world pilot of ≥ 20 approval-mode applications by internal users with manually audited evidence verdicts, and the ≤ 50-user beta cohort (13 §9).
- [x] 6.5 Handoff recorded (NOT executed — owner action): recorded real-ATS smoke tests (18 §13.3) and the nightly live-provider leg against the OpenAI Decisions / Responses APIs (A-01); no live provider call was made.
- [x] 6.6 Handoff recorded (NOT executed here — e2e suite / owner): the full-stack scenarios are automated in `e2e/` — S-12 in `golden.test.ts`, S-13, S-14, S-17 and T21-13 in `apply.test.ts`, S-15, S-16, S-24 and T21-14 (seven kill points) in `leases.test.ts` (`bun run e2e`; nightly `.github/workflows/e2e.yml`) — and the macOS / Windows / Ubuntu matrix with headless agent fixture tests is `.github/workflows/cli-matrix.yml`. None of them is claimed as passing in this record: the e2e suite's gate and the first CI runs report the results.
