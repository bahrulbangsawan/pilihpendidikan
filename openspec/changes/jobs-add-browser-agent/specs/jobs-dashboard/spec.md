## ADDED Requirements

### Requirement: Automation apply tab
The application detail Apply tab SHALL let the user choose the application
mode (saved with `PATCH` and `base_revision`), start a browser run on an online
device that accepts tasks and can `apply`, link to the live monitor of the
running task, and record a manual "I applied"; it SHALL never call device-bound,
`automation:execute` or `ai:invoke` routes from the browser. (Source: 12 §5,
§6; 05 §8; D-15)

#### Scenario: Start a run
- **WHEN** the user starts an approval-mode run targeted at their online MacBook
- **THEN** the BFF creates the task through `POST /api/v1/tasks` and the tab links to `/automation/runs/<tsk_id>`

### Requirement: Automation approval queue
`/automation` SHALL list pending approvals (submit, answer, CV variant, rule
activation) with the filled fields and their value sources, contact values
masked by default with a reveal toggle and protected values pre-masked; Approve
SHALL ask for confirmation and decide with the approval's `payload_hash` and an
idempotency key; failures SHALL read as hash mismatch ("the form changed"),
already decided, expired or gone; answer approvals SHALL require answers to
required questions and save to the answer bank only when ticked, never a
protected answer as `always`; J / K, Y and X SHALL navigate, approve and reject
(each asking first); the queue SHALL poll every 10 s and pending approvals SHALL
prefix the tab title with their count. (Source: 12 §6.1; 21 §6.3)

#### Scenario: Approve a submission
- **WHEN** the user presses Y on a submit approval and confirms
- **THEN** the decision is sent with the approval's `payload_hash` and the item leaves the queue

#### Scenario: Form changed
- **WHEN** the decision fails because the hash no longer matches
- **THEN** the UI says the form changed and the agent will ask again

### Requirement: Automation rules editor
The Rules screen SHALL list rules with a criteria and limits summary and an
enabled switch, and its editor SHALL send only changed fields with
`base_revision`; enabling an `auto` rule SHALL show a plain-language activation
summary (limits, sites, hours) and require typing the exact rule name before
the activation approval is decided. (Source: 12 §6.2; 19 §8.3)

#### Scenario: Turning on an auto rule
- **WHEN** the user enables an auto rule
- **THEN** a rule-activation approval is created and only typing the exact rule name confirms it

### Requirement: Automation runs table
The Runs tab SHALL list tasks with kind, application, device, state badge,
attempt, start and duration, filterable by state, and SHALL offer Retry on
`failed` and `outcome_unknown` rows; retrying `outcome_unknown` SHALL first ask
"Did this application go through?" and send `confirm_not_submitted` only when
the user answers Not submitted. (Source: 12 §6.3; 21 §8)

#### Scenario: Unknown outcome
- **WHEN** the user retries an `outcome_unknown` run and answers "Submitted"
- **THEN** no retry is sent and the submission is confirmed instead

### Requirement: Live run monitor
`/automation/runs/$tskId` SHALL show a stepper that follows the task's progress
stages, the executor status, action and AI counters and the last heartbeat age
("Device not responding" past 60 s, with the lease release time), one
intervention prompt per canonical `PauseReason` in English and Indonesian (the
flagged excerpt as plain text for `injection_suspected`), Resume and Cancel
(Cancel asks first), a step log showing values by source only, an outcome card
with Confirm / Not submitted for unverified results, and an `aria-live` region
announcing at most once per 5 s; it SHALL poll every 2 s while visible, 10 s
while hidden, and stop at a terminal state. (Source: 12 §6.3; 21 §6.1–§6.2;
11 §8)

#### Scenario: Login pause
- **WHEN** the task pauses with `login_required`
- **THEN** the monitor explains what to do on the named device and Resume sends a resume request delivered through the heartbeat

#### Scenario: Terminal state
- **WHEN** the task reaches `submitted`
- **THEN** every step shows done and polling stops
