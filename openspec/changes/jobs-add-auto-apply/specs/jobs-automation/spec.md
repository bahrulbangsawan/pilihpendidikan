## MODIFIED Requirements

### Requirement: Application modes
Every application SHALL carry one application mode out of `manual`,
`assisted`, `approval` and `auto`, and apply tasks SHALL behave per mode: in
`assisted` the human clicks the final Submit, in `approval` the agent clicks it
only after an approved `submit` approval whose `payload_hash` matches the
current form, and in `auto` the agent clicks it without a per-application
approval only when the task is covered by an enabled `auto` rule with an
approved `rule_activation`, `JOBS_AUTO_MODE_ENABLED` is on, the rule's limits
are not exceeded and every per-application auto precondition holds; otherwise
an `auto` task SHALL be refused, converted to the approval flow or stopped.
(Source: 01 §4; 19 §8.1–§8.3; 21 §6.5)

#### Scenario: Assisted submit is the user's click
- **WHEN** an `assisted` attempt reaches the final submit control
- **THEN** the agent does not click it and does not call `submit-intent`
- **AND** after the user's click the CLI records a `submission_status_changed` event with `via = "assisted_user_click"` and runs verification

#### Scenario: Approval mode without an approval
- **WHEN** a device calls `POST …/submit-intent` for an `approval`-mode task without an approved submit approval
- **THEN** the response is `422 policy_violation` with `details.reason = "approval_required"`

#### Scenario: Auto submit within the rule
- **WHEN** an `auto` task covered by an activated rule reaches the submit gate with every precondition met
- **THEN** submit-intent cites the `rule_id`, succeeds and the agent clicks submit without a submit approval

### Requirement: Automation flags and the user kill switch
`JOBS_AUTOMATION_ENABLED` (D-33, dark by default) SHALL gate automation: while
off, claims answer `204`, tasks stay queued and rule evaluation creates no
tasks. `JOBS_AUTO_MODE_ENABLED` (dark by default) SHALL additionally gate auto
mode: while off, auto rules cannot be enabled, rule evaluation creates no auto
tasks, `auto` apply tasks are not claimed (approval ones still are) and an auto
submit-intent is refused. `user_settings.automation_paused` (set by
`pilih-jobs worker pause-all` or the dashboard "Pause all automation") SHALL
make the server refuse `apply` claims and submit-intents and return
`cancel_requested` for live pre-intent leases. (Source: 13 §9; 19 §8.3; D-33)

#### Scenario: Flag off
- **WHEN** `JOBS_AUTOMATION_ENABLED` is off and a device polls
- **THEN** the response is `204` and the queued task is untouched

#### Scenario: Auto mode flag off
- **WHEN** `JOBS_AUTO_MODE_ENABLED` is off while an auto task and an approval task are queued
- **THEN** the device claims only the approval task

#### Scenario: Pause all
- **WHEN** the user runs `pilih-jobs worker pause-all` while an auto attempt is filling a form
- **THEN** the next heartbeat returns `cancel_requested` and the attempt stops before submit-intent

## ADDED Requirements

### Requirement: Auto rule constraints
An `automation_rules` row with `mode = auto` SHALL be rejected with `422
policy_violation` listing each problem unless `criteria.min_score ≥ 70`, at
least one narrowing criterion (keywords, title patterns, companies or source
ids) is set, `allowed_domains` is a non-empty list of registrable domains, and
`limits.expires_at` is in the future and at most 30 days away; for every rule
`limits.max_per_day` SHALL default to 10 with a ceiling of 25 and
`limits.max_per_company_per_30d` SHALL default to 2 with a ceiling of 3.
(Source: 19 §8.3; 04 §2.3; D-35)

#### Scenario: Auto rule without domains
- **WHEN** a user saves an auto rule with `min_score` 80 and no allowed domains
- **THEN** the response is `422 policy_violation` naming `allowed_domains`

#### Scenario: Limit above the ceiling
- **WHEN** a rule sets `max_per_day` to 30
- **THEN** the rule is rejected because the ceiling is 25

### Requirement: Rule activation approval
Enabling an `auto` rule SHALL require `automation:manage` and
`JOBS_AUTO_MODE_ENABLED`, and SHALL create a `rule_activation` approval that
binds the rule's effective fields; the rule SHALL become active only when that
approval is approved (`activated_approval_id`). Editing a field the activation
binds SHALL void the activation (renaming keeps it), disabling an auto rule
SHALL never need the step-up scope, deleting a rule SHALL expire its pending
activation, and renewal after expiry SHALL need a new activation. MCP MUST NOT
decide `rule_activation` approvals, and `pilih-jobs rules enable` SHALL refuse
an auto rule with `mode_not_allowed` so activation happens in the web flow.
(Source: 19 §8.3; 05 §8, §14; 03 §8; D-29)

#### Scenario: Enable an auto rule from the CLI
- **WHEN** the user runs `pilih-jobs rules enable <auto rule id>`
- **THEN** the CLI exits with code 9 and error `mode_not_allowed` and the rule stays disabled

#### Scenario: Enable without step-up
- **WHEN** a CLI token without `automation:manage` tries to enable an auto rule
- **THEN** the response is `403 insufficient_scope`

#### Scenario: Activation approved
- **WHEN** the user approves the rule's `rule_activation` approval in the web queue after typing the rule name
- **THEN** the rule is enabled with `activated_approval_id` set

#### Scenario: Edit voids the activation
- **WHEN** the user raises `max_per_day` on an active auto rule
- **THEN** the rule stops being effective until a new activation is approved

### Requirement: Auto task creation and coverage
An `auto` apply task SHALL be created only with `automation:manage` (even when
targeted at the caller's device) or by the rule engine, and only when an enabled
auto rule with an approved activation covers the application: the posting's
`apply_domain` is in the rule's allowed domains, the posting's adapter has
`application_support = browser_supported` and `automation.auto_ok = true` in the
adapter manifest (career-page, generic, custom-URL and Workday postings are
never auto), and the rule's limits are not reached. (Source: 21 §4; 19 §8.3;
15 §14; D-29)

#### Scenario: Workday posting
- **WHEN** an auto rule matches a posting from the `workday` adapter
- **THEN** no auto task is created because the adapter is not `auto_ok`

### Requirement: Auto submission limits
Auto submissions SHALL be counted from `submit_intent` events: per rule at most
`max_per_day` in 24 h, per company (registrable domain, else normalized name) at
most `max_per_company_per_30d` in 30 days, and at most 40 per user per day
across all rules and modes, and the rule's `active_hours` in the user's
timezone; the limits SHALL be checked when the rule engine creates a task, at
claim time and again at submit-intent, where an exceeded limit answers `422
policy_violation` with `reason = limit_reached` and the application stays
`ready`. (Source: 19 §8.3, §10; 21 §6.5; D-35)

#### Scenario: Fourth job exceeds the daily limit
- **WHEN** an auto rule with `max_per_day` 3 matches 4 ready jobs in one day
- **THEN** 3 are submitted and the 4th stays `ready` with reason `limit_reached`

### Requirement: Auto per-application preconditions
Before an auto submit the CLI SHALL require an active rule, an `auto_ok`
adapter, only `fact`, `answer` with `auto_use = always`, `option`, `cv_file` or
`cover_letter_file` value sources, no generated text, no protected answer, no
pause in this attempt, no `injection_suspected`, a page-kind confidence of at
least 0.85, a matched adapter form recognizer and an allowlisted domain, and
the application SHALL have an approved CV variant (or the rule's CV policy
allows the base CV as-is); any failure SHALL convert the task to the approval
flow when a human is reachable on a headed device, else stop with
`auto_precondition_failed`. (Source: 19 §8.2–§8.3, §6.3)

#### Scenario: Generated text required
- **WHEN** an auto attempt meets a required motivation field that only generated text could fill
- **THEN** the attempt stops and the application is set back to `approval` mode

### Requirement: Auto mode stops instead of pausing
In `auto` mode the agent SHALL stop (not pause) on missing information for a
required field (`missing_information`, application set back to mode
`approval`), protected questions, challenges, logins, account creation or OTP,
external redirects (`domain_not_allowed`), low confidence, repeated validation
errors, `injection_suspected` and an exhausted budget (`budget_exceeded`); it
SHALL skip optional fields that need a human, SHALL refuse connected browser
mode (`mode_not_allowed`), and SHALL run headless only when the adapter manifest
has `headless_ok: true`. (Source: 19 §8.1, §4.2, §6.5; 18 §3.2, §5, §7.4)

#### Scenario: Off-domain redirect in auto mode
- **WHEN** an auto attempt is redirected to a domain outside the allowlist
- **THEN** the attempt stops with `domain_not_allowed` and nothing is submitted

#### Scenario: Auto in connected mode
- **WHEN** an auto task is claimed by a worker configured for connected (CDP) mode
- **THEN** the attempt fails with `mode_not_allowed` before any action
