## ADDED Requirements

### Requirement: Application modes
Every application SHALL carry one application mode out of `manual`,
`assisted`, `approval` and `auto`, and apply tasks SHALL behave per mode: in
`assisted` the human clicks the final Submit, in `approval` the agent clicks it
only after an approved `submit` approval whose `payload_hash` matches the
current form, and `auto` SHALL be refused unless the controlled auto-apply
rules are met. (Source: 01 §4; 19 §8.1; 21 §6.5)

#### Scenario: Assisted submit is the user's click
- **WHEN** an `assisted` attempt reaches the final submit control
- **THEN** the agent does not click it and does not call `submit-intent`
- **AND** after the user's click the CLI records a `submission_status_changed` event with `via = "assisted_user_click"` and runs verification

#### Scenario: Approval mode without an approval
- **WHEN** a device calls `POST …/submit-intent` for an `approval`-mode task without an approved submit approval
- **THEN** the response is `422 policy_violation` with `details.reason = "approval_required"`

### Requirement: Task creation and scope rule
`POST /api/v1/tasks` SHALL create `apply`, `discover` or `render_cv` tasks only
for applications the caller owns, SHALL require `automation:manage`, and SHALL
accept the base `automation:execute` scope only for `assisted` / `approval`
apply tasks targeted at the calling device; personal and read tokens MUST NOT
create tasks, and MCP MUST NOT create tasks in v1. (Source: 05 §8; 21 §4; D-29)

#### Scenario: CLI creates a task for itself
- **WHEN** a CLI token with `automation:execute` but without `automation:manage` creates an `approval` apply task with `target_device_id` equal to its own device
- **THEN** the task is created in state `queued`

#### Scenario: CLI targets another device
- **WHEN** the same token creates a task targeted at another device or with mode `auto`
- **THEN** the response is `403 insufficient_scope`

#### Scenario: No eligible device
- **WHEN** no non-revoked device with `accepts_tasks` and the required capabilities exists and `queue_without_device` is not set
- **THEN** the response is `422 policy_violation`

### Requirement: One live apply task per application
The server SHALL allow at most one live `apply` task per application
(`ux_tasks_live_apply`) and SHALL store the `Idempotency-Key` on the task
(unique per user); a second create SHALL answer `409 duplicate` with the
existing task id. (Source: 21 §4, §9; 04 §2.6)

#### Scenario: Second apply task
- **WHEN** an application already has a `queued` apply task and another one is created with a different idempotency key
- **THEN** the response is `409 duplicate` and no second task exists

### Requirement: Worker eligibility and atomic claim
`POST /api/v1/devices/{dev_id}/tasks:claim` SHALL lazily reap the caller's
expired leases, then claim at most one task with one conditional
`UPDATE … RETURNING`, only when the token has `automation:execute` and the
path device, the device is not revoked and `accepts_tasks = 1`, the CLI
version passes the gate, the task's `required_capabilities` are a subset of the
claimed capabilities, `target_device_id` is NULL or this device and
`not_before ≤ now < expires_at`; it SHALL answer `200 {task, lease, context}`
or `204`. A device SHALL hold at most one live `apply` lease, one `discover`
and one `render_cv`. (Source: 21 §3, §5.1; D-11)

#### Scenario: Two devices race for one task
- **WHEN** two devices of the same user poll at the same time for one queued apply task
- **THEN** exactly one receives `200` with a lease and the other receives `204`

#### Scenario: Capabilities missing
- **WHEN** a task requires `headed_browser` and the device claims without it
- **THEN** the device receives `204` and the task stays `queued`

#### Scenario: Another user's task
- **WHEN** a device of user B claims while only user A has queued tasks
- **THEN** user B receives `204`

### Requirement: Claim context bundle
A successful claim SHALL, in the same batch, create the `automation_attempts`
row and append `automation_task_claimed` with `change_log`, and SHALL return a
lease `{lease_id, expires_at, heartbeat_interval_ms: 30000}` valid for 120 s
plus a context: for `apply` the application, posting, CV variant file id and
SHA-256, mode, rule limits, allowed domains and resumable approvals; for
`discover` the source ids; for `render_cv` the variant id and a render ticket.
(Source: 21 §5.1, §5.4)

#### Scenario: Apply context
- **WHEN** a device claims an approval-mode apply task
- **THEN** the context names the CV file and its SHA-256 and the allowed domains derived from the posting's apply domain and the adapter's ATS hosts

### Requirement: Lease heartbeat and server fencing
`POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/heartbeat` SHALL extend the
lease to `now + 120 s` only when the task belongs to the caller, the lease id
and lease device match, the lease is unexpired and the state is live; it SHALL
move `claimed` to `running`, return `{lease_expires_at, cancel_requested,
resume_requested, poll_interval_ms, server_time}` and append `change_log` only
when the state or the progress stage changes. Any other lease-scoped call with
a stale lease SHALL answer `409 lease_lost`, and the fence SHALL be re-checked
inside the write batch. (Source: 21 §5.2–§5.3, §11)

#### Scenario: Stale lease
- **WHEN** a device heartbeats with a lease id the reaper already expired
- **THEN** the response is `409 lease_lost` and nothing is written

#### Scenario: Another user's lease route
- **WHEN** user B calls any lease route with user A's task and lease ids
- **THEN** the response is `404`

### Requirement: Progress events and pauses
`POST …/lease/{lease_id}/events` SHALL accept batches of at most 50 events
(`started`, `progress`, `log`, `paused`, `resumed`), set `paused` with exactly
one canonical `PauseReason`, append deduplicated `application_events`, and
SHALL never accept `submit_intent` through this route. `POST
/api/v1/tasks/{tsk_id}/resume` SHALL be allowed only for paused tasks and
deliver the resume flag to the device once through the heartbeat. (Source: 21
§6.1–§6.2; 03 §7.2)

#### Scenario: Login wall pause
- **WHEN** the device reports `paused` with `login_required`
- **THEN** the task state is `paused`, `pause_reason = login_required`, and the dashboard can request a resume that reaches the device on its next heartbeat

### Requirement: Approvals bound to a payload hash
A leased apply task SHALL create `submit` and `answer` approvals through
`POST …/lease/{lease_id}/approvals` with a `payload_hash`, moving the task to
`awaiting_approval`; `POST /api/v1/approvals/{apr_id}/decide` SHALL require
`automation:manage` and the matching `payload_hash`, the first decision SHALL
win (a later one gets `409` with the decided state), an expired approval SHALL
answer `410 approval_expired`, and a rejection SHALL ask the device to stop
(or cancel a released wait) while the application stays `ready` with
`submission_status = not_started`. Approvals expire after 24 h. (Source: 21
§6.3; 05 §8; 03 §8)

#### Scenario: Concurrent decisions
- **WHEN** the web and the CLI decide the same pending approval at the same time
- **THEN** exactly one decision is recorded and the other caller receives `409`

#### Scenario: Form changed after approval
- **WHEN** a decision is sent with a `payload_hash` that differs from the approval's
- **THEN** the decision is refused and the agent must request a new approval before submitting

#### Scenario: Approval expires
- **WHEN** a pending submit approval reaches its 24 h expiry
- **THEN** the approval becomes `expired`, the task is cancelled and the application stays `ready`

### Requirement: Answer approvals and the answer bank
An `answer` approval SHALL carry the question, options and any suggestion with
its source; its response SHALL be used for this application only and saved to
`screening_answers` only when the user ticks "save", and a `protected` answer
MUST NOT be saved with `auto_use = always`. (Source: 21 §6.3; 19 §6.5; 03 §9)

#### Scenario: Protected answer saved
- **WHEN** the user answers an EEO question, ticks "save" and picks `always`
- **THEN** the stored answer has `auto_use = approval`, never `always`

### Requirement: Release and awaiting-approval waits
`POST …/lease/{lease_id}/release` SHALL be refused with `409 too_late` after
`submit_intent`; with `reason = awaiting_approval` it SHALL clear the lease and
keep the task `awaiting_approval`, and a later approval SHALL re-queue it with
`payload.resume_from_approval`; with `reason = needs_headed` it SHALL re-queue
the task with `headed_browser` added to its required capabilities; on the last
attempt it SHALL fail the task instead of re-queueing. (Source: 21 §6.2, §6.4)

#### Scenario: Headless worker needs a human
- **WHEN** a headless worker releases a paused task with `needs_headed`
- **THEN** the task is `queued` with `headed_browser` required and only a device with a display can claim it

### Requirement: Submit intent checkpoint
`POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/submit-intent` SHALL be
synchronous, never queued, and SHALL succeed only when the lease is valid, the
task is not cancelled, the application is owned, not `withdrawn`, `rejected`
or `accepted` and not already `submitted_*`, the mode's approval or rule
precondition holds, no other task holds the intent, and fewer than 40
submit-intents were recorded for the user in the last 24 h; on success it SHALL
set `submit_intent_at`, set the application's `submission_status` to
`in_progress` and append `submit_intent`. The CLI MUST click the final submit
only after a `200`. (Source: 21 §6.5; 19 §8.2; D-28; D-35)

#### Scenario: Already submitted
- **WHEN** submit-intent is requested for an application whose status is `submitted_verified`
- **THEN** the request is refused and `submit_intent_at` stays unset

#### Scenario: Withdrawn meanwhile
- **WHEN** the user moved the card to `withdrawn` before the intent
- **THEN** the request is refused and the device does not click submit

#### Scenario: Single-use approval
- **WHEN** a second submit-intent cites an approval that already backed one intent
- **THEN** the request is refused (`approval_used`)

### Requirement: Result recording and precedence
`POST …/lease/{lease_id}/result` SHALL close the attempt and clear the lease;
`submitted` SHALL require evidence and set `submission_status` to
`submitted_verified` or `submitted_unverified` by verdict, moving the stage
`ready → applied` only when legal and no user stage change happened after the
task was created (otherwise the stage stays and `conflict_recorded` is
appended); submission status SHALL only move forward for automation;
`failed` SHALL set `failed` only after an intent with negative evidence; and
`outcome_unknown` SHALL set the application's status to `outcome_unknown`.
(Source: 21 §6.6; 20 §6.2; D-18)

#### Scenario: Verified submission
- **WHEN** a device reports `submitted` with `verified` evidence
- **THEN** the task is `submitted`, the application is `applied` with `submitted_verified`, and a `submission_evidence` row exists

#### Scenario: User moved the card during the run
- **WHEN** the user moved the card to `withdrawn` after the task was created and the device reports `submitted`
- **THEN** the evidence and submission status are recorded but the stage stays `withdrawn` with a `conflict_recorded` event

### Requirement: Lease expiry reaper
A cron every 5 minutes and every claim (for the caller's user) SHALL reap
expired leases fenced on the old `lease_id`: after `submit_intent` the task
becomes `outcome_unknown` and is never re-queued; `awaiting_approval` keeps its
state without a lease; otherwise a task with attempts left returns to `queued`
with `not_before = now + 2^attempts min` and the attempt outcome
`lease_expired`; else it fails with `lease_expired`. Queued tasks past
`expires_at` (72 h) SHALL become `expired`, and pending approvals past expiry
SHALL become `expired`. A heartbeat that lands between the reaper's read and
write SHALL win. (Source: 21 §7.1; D-19)

#### Scenario: Lease lost before the intent
- **WHEN** the CLI is killed mid-fill and 120 s pass
- **THEN** the attempt ends `lease_expired` and the task is `queued` again for another device

#### Scenario: Lease lost after the intent
- **WHEN** the CLI is killed right after submit-intent succeeded
- **THEN** the task becomes `outcome_unknown`, the application's status `outcome_unknown`, and no retry happens automatically

### Requirement: Device revocation effects on tasks
Revoking a device SHALL in one batch move its post-intent leases to
`outcome_unknown`, clear the lease of `awaiting_approval` tasks while keeping
the approval, re-queue the rest with `target_device_id = NULL`, and cancel
queued tasks pinned to it; the revoked CLI SHALL receive `401 invalid_token`
with `reason = revoked_token` and treat it as `lease_lost`. (Source: 21 §10;
D-10)

#### Scenario: Revoked mid-run
- **WHEN** the user revokes a device that holds a pre-intent lease
- **THEN** the task is `queued` without a target device, and the device's next heartbeat gets `401` and stops all browser actions

### Requirement: Cancel, retry and late evidence
`POST /api/v1/tasks/{tsk_id}/cancel` SHALL cancel a queued task at once, flag a
running one (`202`, delivered by heartbeat) and answer `409 too_late` past
`submit_intent`. `POST /api/v1/tasks/{tsk_id}/retry` SHALL be allowed from
`failed`, and from `outcome_unknown` only with `confirm_not_submitted: true`
(recorded as an event), creating a new task with `retry_of` and leaving the old
task terminal. `POST /api/v1/tasks/{tsk_id}/attempts/{att_id}/late-evidence`
SHALL be append-only, refused while the lease is still valid, and accepted only
from the device that held that attempt's lease. (Source: 21 §8, §12; 20 §6.3;
05 §8)

#### Scenario: Retry an unknown outcome
- **WHEN** the user retries an `outcome_unknown` task without `confirm_not_submitted`
- **THEN** the request is refused and no task is created

#### Scenario: Late evidence after a lost lease
- **WHEN** the device that lost its lease after the intent later uploads its verified evidence
- **THEN** the evidence is recorded and the task moves from `outcome_unknown` to `submitted` without overwriting a newer user stage

### Requirement: Retry policy
Retryable error classes (`network_offline`, `upstream_unavailable`,
`browser_crashed`, pre-intent `lease_expired`; `timeout`, `page_changed` and
`selector_not_found` once) SHALL re-queue with exponential backoff up to
`max_attempts = 3`; human-required, policy and form-rejection classes SHALL NOT
retry automatically; and no error after `submit_intent` SHALL ever be retried
automatically. (Source: 21 §8; 19 §8.4)

#### Scenario: Retryable failure
- **WHEN** a pre-intent attempt fails with `network_offline` on attempt 1
- **THEN** the task is `queued` with a `not_before` backoff

### Requirement: Automation flags and the user kill switch
`JOBS_AUTOMATION_ENABLED` (D-33, dark by default) SHALL gate automation: while
off, claims answer `204`, tasks stay queued and rule evaluation creates no
tasks. `user_settings.automation_paused` (set by `pilih-jobs worker pause-all`
or the dashboard) SHALL make the server refuse `apply` claims and return
`cancel_requested` for live pre-intent leases. (Source: 13 §9; 19 §8.3; D-33)

#### Scenario: Flag off
- **WHEN** `JOBS_AUTOMATION_ENABLED` is off and a device polls
- **THEN** the response is `204` and the queued task is untouched

### Requirement: Approval-mode rules and rule evaluation
`/api/v1/rules` SHALL offer CRUD of `automation_rules` with `jobs:write` for
non-auto modes, with revisions; the `evaluate_rules` queue consumer SHALL create
a task for a tracked posting only from a ready score of the current profile
version and rubric, SHALL exclude postings with blocking gates, defer on queued
scores, re-queue scoring for stale profile versions, enforce the rule's limits
and allowed domains, and use the idempotency key `rule:<rule_id>:<posting_id>`.
A rule that tailors the CV SHALL request a CV variant first and its task SHALL
wait for the approved CV. (Source: 07 §10; 05 §8; 04 §2.3)

#### Scenario: Stale score
- **WHEN** a rule is evaluated for a posting whose score has an older `profile_version`
- **THEN** no task is created and scoring is re-queued

### Requirement: CLI worker
`pilih-jobs worker start|stop|status|enable|disable|pause-all|resume-all`
SHALL run at most one worker per device (lock file plus local IPC), poll at
5 s while active, 30 s otherwise and 60 s after an idle hour with ±20 % jitter
and never below 2 s (obeying the server's `poll_interval_ms`), back off when the
outbox is congested, and recover unfinished local tasks after a crash; `worker
start --detach` SHALL install a launchd, systemd `--user` or Task Scheduler
service. (Source: 16 §3, §7; 21 §1.1; D-31)

#### Scenario: Second worker
- **WHEN** a worker is running and the user starts another one on the same device
- **THEN** the second start refuses with a clear message instead of polling

### Requirement: CLI lease channel and local deadlines
The CLI `LeaseChannel` SHALL heartbeat every 30 s on its own asyncio task, pause
all browser actions after 90 s without a successful heartbeat and treat the
lease as lost at 110 s on a monotonic clock; on `409 lease_lost` or `401
revoked_token` it SHALL stop acting in the browser at once, mark the local task
`orphaned` and never report under that lease again; events SHALL be batched
(≤ 50 or every 5 s); submit-intent SHALL be a direct call, never the outbox.
(Source: 21 §5.3–§5.4, §6.1; 16 §13)

#### Scenario: Network drops for two minutes
- **WHEN** heartbeats fail for 110 s during a fill
- **THEN** the executor stops before its next action and does not submit

### Requirement: Local apply command
`pilih-jobs apply <app>` SHALL create a task targeted at the calling device and
claim it immediately, support `--matched`, `--resume`, `--dry-run` and
`--approve` (the last needs the step-up `automation:manage` scope), hold a
per-application lock so two local processes never drive the same application,
and on the first Ctrl+C finish the current action and release the lease (or,
after the intent, print that a submission may be in flight). (Source: 16 §3.3,
§6; 21 §4, §9; D-29)

#### Scenario: Approve without step-up
- **WHEN** a user without `automation:manage` runs `pilih-jobs apply <app> --approve`
- **THEN** the CLI refuses and explains how to run `pilih-jobs login --scope automation:manage`

### Requirement: Approvals and rules from the CLI
`pilih-jobs approvals` SHALL list pending approvals and decide them with the
approval's `payload_hash` only under `automation:manage`, and `pilih-jobs rules`
SHALL list and edit rules through the same API rules. (Source: 16 §3.3; 21
§6.3; D-29)

#### Scenario: Decide from the CLI
- **WHEN** a step-up user approves a pending submit approval from the CLI
- **THEN** the decision is sent with the approval's `payload_hash` and the waiting worker proceeds to submit-intent
