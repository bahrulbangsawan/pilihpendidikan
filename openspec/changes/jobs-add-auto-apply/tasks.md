Evidence legend: "gate" = the leaf ledger gate in `.unlazy/jobs/gates/` is
ticked and `.unlazy/jobs/status.log` records the leaf VERIFIED. Nothing below
was deployed, and `JOBS_AUTO_MODE_ENABLED` was not turned on anywhere outside
the test suites.

## 1. Auto rules and limits (`apps/api`, leaf 2.7, gate VERIFIED)

- [x] 1.1 Auto rule constraints (min_score ≥ 70, narrowing criterion, allowed domains, expiry ≤ 30 d) and D-35 defaults / ceilings — `apps/api/src/jobs/services/automation/policy.ts` (`autoRuleProblems`), `packages/jobs-contracts/src/records.ts` (`RULE_LIMIT_DEFAULTS`) (TA-RULES)
- [x] 1.2 Rule activation approval: `automation:manage` + `JOBS_AUTO_MODE_ENABLED`, edit voids, rename keeps, disable without step-up, delete expires the pending activation — `services/automation/{rules,approvals}.ts` (TA-RULES)
- [x] 1.3 Auto task creation and coverage (manifest `auto_ok`, allowed domains, limits) — `services/automation/{tasks,policy}.ts` (TA-TASK-SCOPE)
- [x] 1.4 Limits counted from `submit_intent` events at evaluation, claim and submit-intent; global 40/day — `repo/automation/limits.ts`, `services/automation/{claim,intent}.ts` (T21-04, S-28)
- [x] 1.5 `JOBS_AUTO_MODE_ENABLED` gating of rule evaluation, claims and intents; `automation_paused` kill switch — `queue/handlers/evaluate-rules.ts`, `services/automation/{claim,intent}.ts` (TA-FLAGS)

## 2. Auto policy in the CLI (`apps/jobs-cli`, leaves 4.3 / 4.4, gates VERIFIED)

- [x] 2.1 Auto per-application preconditions and stop-instead-of-pause table — `src/pilih_jobs/agent/policy.py` (`auto_precondition_failures`) (T19-POLICY)
- [x] 2.2 Connected mode refuses auto (`mode_not_allowed`); headless only with `headless_ok` — `src/pilih_jobs/browser/{controller,errors,headless}.py` (T18-mode)
- [x] 2.3 `worker pause-all` / `resume-all` toggle `automation_paused` — `src/pilih_jobs/cli/worker.py`
- [x] 2.4 Dashboard auto-rule editor and activation confirmation — `apps/jobs/src/components/automation/{rule-editor,rules-page}.tsx` (TW-RULES)

## 3. Additional discovery adapters (`apps/jobs-cli`, leaf 4.2, gate VERIFIED)

- [x] 3.1 Adapter manifest with status, `min_cli_version`, restrictions, rate limits and automation flags; CLI hides adapters above its version — `packages/jobs-contracts/adapters.json`, `apps/jobs-cli/src/pilih_jobs/contracts/adapters.py` (TC-ADAPTERS)
- [x] 3.2 `smartrecruiters`, `workable` — `src/pilih_jobs/adapters/{smartrecruiters,workable}.py` (T15-ADAPTER-SMARTRECRUITERS, T15-ADAPTER-WORKABLE)
- [x] 3.3 `workday` opt-in, one request at a time, stop and disable on denial — `src/pilih_jobs/adapters/workday.py`, `tests/discovery/test_sync.py` (T15-ADAPTER-WORKDAY, S-30)
- [x] 3.4 `career_page` JSON-LD first with ATS redirect, `generic_listing` Spider with trusted checkpoints, `custom_url` with private postings and excluded hosts — `src/pilih_jobs/adapters/{career_page,jsonld,ats_links,generic_listing,custom_url}.py` (T15-ADAPTER-CAREER-PAGE, T15-ADAPTER-GENERIC-LISTING, T15-ADAPTER-CUSTOM-URL, S-29)

## 4. Owner handoffs

- [x] 4.1 Handoff recorded (NOT executed — owner action): close the A-07 legal review with written approval (release gate G7) before auto mode is enabled for anyone other than the owner. No review has taken place.
- [x] 4.2 Handoff recorded (NOT executed — owner action): turn on `JOBS_AUTO_MODE_ENABLED` in production `DB.feature_flags`; it was not changed.
- [x] 4.3 Handoff recorded (NOT executed — owner action): auto-mode beta with ≤ 20 users for 4 weeks with zero confirmed wrongful submissions, and verification of the abuse caps and the kill switch in production (13 §2 M7).
- [x] 4.4 Handoff recorded (NOT executed — owner action): re-check the Workers prices used for the volume estimate (A-10).
- [x] 4.5 Handoff recorded (NOT executed — owner action / leaf 5.3): Homebrew tap, Scoop bucket and winget manifest publication listed under M7; nothing was published.
