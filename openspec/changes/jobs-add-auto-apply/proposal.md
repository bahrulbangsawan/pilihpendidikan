# Change: Add controlled auto-apply and the remaining source adapters

## Why

Once assisted and approval modes have run in production, some users want the
agent to submit applications that clearly match their criteria without a
per-application click. `job-tracker-spec/13` §2 (M7) puts this last on the
safety ladder: `auto` mode is gated by an explicit, time-limited rule
activation, hard abuse caps (D-35), a kill switch, a feature flag
(`JOBS_AUTO_MODE_ENABLED`, D-33) and a legal review (A-07, gate G7). The same
milestone adds the discovery adapters beyond Greenhouse, Lever and Ashby.

## What Changes

- `auto` application mode (19 §8.3): rules with `mode = auto` need
  `min_score ≥ 70`, a narrowing criterion, a non-empty `allowed_domains` list
  and an expiry ≤ 30 days; enabling one needs `automation:manage`, the flag and
  an approved `rule_activation` approval; edits void the activation.
- Abuse caps (D-35): `max_per_day` default 10 (ceiling 25),
  `max_per_company_per_30d` default 2 (ceiling 3), a global 40 submissions per
  user per day, `active_hours`; counted from `submit_intent` events and
  enforced at rule evaluation, claim and submit-intent.
- Auto preconditions in the CLI policy engine and server submit-intent; auto
  stops instead of pausing; only `auto_ok` adapters (Greenhouse, Lever, Ashby);
  no connected browser; headless only with `headless_ok`.
- `JOBS_AUTO_MODE_ENABLED` flag and the "pause all" kill switch
  (`pilih-jobs worker pause-all`, dashboard toggle).
- Discovery adapters `smartrecruiters`, `workable`, `workday` (opt-in per
  tenant), `career_page` (JSON-LD first), `generic_listing` (Spider with
  checkpoints) and `custom_url`; adapter enablement through the manifest.
- Distribution items of M7 (Homebrew tap, Scoop bucket, winget manifest) are
  out of scope here; they belong to `jobs-add-cli` / leaf 5.3 packaging.

## Impact

- Affected specs: `jobs-automation` (MODIFIED: application modes, flags and
  kill switch; ADDED: auto rules, activation, coverage, limits,
  preconditions, stop policy), `jobs-discovery` (ADDED: adapter enablement and
  six adapters on top of `jobs-add-cli`).
- Affected code: `apps/api/src/jobs/services/automation/{policy,rules,tasks,claim,intent,rule-engine}.ts`,
  `apps/api/src/jobs/repo/automation/{rules,limits}.ts`,
  `apps/api/src/jobs/queue/handlers/evaluate-rules.ts`;
  `apps/jobs-cli/src/pilih_jobs/agent/policy.py`, `browser/controller.py`;
  `apps/jobs-cli/src/pilih_jobs/adapters/{smartrecruiters,workable,workday,career_page,generic_listing,custom_url,jsonld,ats_links}.py`;
  `apps/jobs/src/components/automation/rule-editor.tsx`, `rules-page.tsx`;
  `packages/jobs-contracts/adapters.json`, `src/records.ts`
  (`RULE_LIMIT_DEFAULTS`).
- Sources: `job-tracker-spec/19-AI-APPLICATION-AGENT.md` §8, §10,
  `15-SCRAPLING-ENGINE-WRAPPER.md` §14, `21` §4, §6.5, `04` §2.3, `05` §8,
  `11` (abuse), `12` §6.2, `13` §2 (M7), §5 (S-28, S-29, S-30), §8 (G7);
  decisions D-16, D-17, D-29, D-33, D-35; assumptions A-07, A-10; conflict
  C-11.
- Depends on `jobs-add-browser-agent` (base `jobs-automation`) and
  `jobs-add-cli` (base `jobs-discovery`).
- Status: implemented in the working tree; **not committed, not deployed**.
  `JOBS_AUTO_MODE_ENABLED` stays dark; the A-07 legal review has not been
  done and auto mode must not be enabled for anyone outside the owner until it
  is closed (gate G7).
