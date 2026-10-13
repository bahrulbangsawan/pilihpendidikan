## ADDED Requirements

### Requirement: Prefixed ULID identifiers
Every new Job Tracker record SHALL be identified by `<prefix>_<26-character
Crockford ULID>` with the 03 §1 prefixes (`usr_ grt_ dev_ pst_ ujb_ app_ evt_
ivw_ ofr_ scr_ src_ run_ rul_ tsk_ att_ lse_ rft_ sal_ apr_ evd_ fil_ cvv_
fct_ ans_ eml_`, plus CLI-local `obs_`), and a client-generated id MUST be
refused unless it carries the prefix of the expected entity and its ULID time
is within ±24 h of the server clock. (Source: 03 §1; D-03)

#### Scenario: Valid client id
- **WHEN** the CLI creates a discovery run offline with id `run_<ULID of now − 2 h>`
- **THEN** `isIdWithinClockSkew` accepts it

#### Scenario: Clock skew
- **WHEN** a client-generated id carries a ULID time 25 h in the future
- **THEN** it is rejected

### Requirement: Record schemas for every table
The contracts package SHALL define a row schema for every table of both
databases (`users`, OAuth and device tables in `DB`; every `JOBS_DB` table of
04 §2) in `TABLE_RECORDS`, with epoch-millisecond timestamps, JSON columns
typed by their shapes and enum columns limited to the 04 `CHECK` lists.
(Source: 04 §1, §2)

#### Scenario: CHECK list parity
- **WHEN** an `applications` record with `stage = "archived"` is parsed
- **THEN** it is rejected because `archived` is not in the stage list

#### Scenario: Every table covered
- **WHEN** the record registry is compared with the tables of 04
- **THEN** every table has a schema and every column is present

### Requirement: Application stage machine
The contracts SHALL encode the nine stages (`saved`, `preparing`, `ready`,
`applied`, `interviewing`, `offer`, `accepted`, `rejected`, `withdrawn`) and
the 03 §5.1 transition graph per actor in `canTransition(from, to, actor)`:
users may take any allowed transition (including reopen to `saved` from
`rejected`/`withdrawn`); automation may only move `saved/preparing/ready →
applied` and `saved/preparing → ready`; the system only `saved → preparing`
and `preparing → ready`. (Source: 03 §5.1; 06 §2)

#### Scenario: Illegal user move
- **WHEN** `canTransition("applied", "preparing", "user")` is evaluated
- **THEN** it returns false

#### Scenario: Automation boundary
- **WHEN** `canTransition("applied", "interviewing", "automation")` is evaluated
- **THEN** it returns false, while the same move by a user returns true

### Requirement: Submission status machine
The contracts SHALL encode the submission statuses (`not_started`,
`in_progress`, `submitted_verified`, `submitted_unverified`, `failed`,
`outcome_unknown`) and SHALL let automation and system writes move them only
forward (`not_started < in_progress < {failed, outcome_unknown,
submitted_unverified} < submitted_verified`, plus the retry edge `failed →
in_progress`), while explicit user, MCP and legacy-migration decisions MAY set
any value. (Source: 03 §5.2; 20 §6.2; D-18)

#### Scenario: Automation cannot downgrade
- **WHEN** automation reports `in_progress` for an application already `submitted_verified`
- **THEN** `canChangeSubmissionStatus` returns false

#### Scenario: User confirmation
- **WHEN** the user confirms an `outcome_unknown` application as submitted
- **THEN** `canChangeSubmissionStatus("outcome_unknown", "submitted_verified", "user")` returns true

### Requirement: Automation task machine and pause reasons
The contracts SHALL encode the task states (`queued`, `claimed`, `running`,
`paused`, `awaiting_approval`, `submitted`, `succeeded`, `failed`,
`cancelled`, `outcome_unknown`, `expired`) and their per-actor transitions,
including `outcome_unknown → submitted` on late evidence and `outcome_unknown
→ failed` on a user denial and never `outcome_unknown → queued`, and SHALL
define exactly the 21 canonical `PauseReason` values. (Source: 03 §7.2;
21 §12; D-19)

#### Scenario: No silent retry after submit intent
- **WHEN** the task table is asked whether `outcome_unknown → queued` is allowed
- **THEN** it is not

#### Scenario: Pause reason list
- **WHEN** a `paused` task carries `pause_reason = "captcha"`
- **THEN** the record schema rejects it; `captcha_or_challenge` is accepted

### Requirement: Approval kinds, states and expiry
The contracts SHALL define approval kinds `submit`, `answer`, `cv_variant`
and `rule_activation`, the states `pending → approved | rejected | expired`
with no other transitions, a `payload_hash` on every approval, and default
lifetimes of 24 h for `submit` and `answer` and 7 days for `cv_variant` and
`rule_activation`. (Source: 03 §8)

#### Scenario: Decided approvals are final
- **WHEN** an `approved` approval is asked to move to `rejected`
- **THEN** `canApprovalTransition` returns false

### Requirement: Canonical applicant facts and answer sensitivity
The contracts SHALL define the canonical applicant fact keys (`contact.*`,
`links.*`, `work_auth.<country>`, `education[<id>]`, `experience[<id>]`,
`profile.primary_cv_id`, `prefs.*`), fact sources (`user_entered`,
`cv_import`, `verified_document`), answer kinds, the sensitivity classes
`none`, `personal`, `protected` and the `auto_use` values `never`,
`approval`, `always`, and new keys MUST be added only in `src/facts.ts`.
(Source: 03 §9)

#### Scenario: Unknown fact key
- **WHEN** a fact with key `contact.nickname` is validated
- **THEN** it is rejected as not canonical

### Requirement: Event types and actors
The contracts SHALL define the application event types of 03 §6 (including
`note_deleted`, `submit_intent`, `conflict_recorded` and `legacy_imported`)
with their payload shapes and the actor kinds `user`, `automation`,
`system`, `mcp` and `legacy_migration`. (Source: 03 §6)

#### Scenario: Unknown event type
- **WHEN** an event row with `type = "deleted"` is parsed
- **THEN** it is rejected
