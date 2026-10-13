## ADDED Requirements

### Requirement: Bulk actions on every list
Every dashboard list of user records (board, inbox, approvals, rules, runs,
sources, devices, saved answers, interviews, offers) SHALL offer row
selection with a select-all checkbox and a bulk toolbar. A bulk action SHALL
send one request per row (at most four in flight) with that row's
`base_revision` and its own `Idempotency-Key`, SHALL continue after a row
fails, and SHALL report one summary with per-row results (done, skipped,
changed elsewhere, failed). Destructive bulk actions MUST be confirmed
first. Rows leaving the list MUST leave the selection. (Source: 06 §9, 12)

#### Scenario: Mixed results
- **WHEN** a user deletes three selected rules and one changed elsewhere
- **THEN** two are deleted, one is reported as changed elsewhere, and the summary links the per-row results

### Requirement: Guards hold in bulk
A bulk action MUST NOT bypass a single-row guard: submission, `answer` and
`rule_activation` approvals are never approved in bulk, `auto` rules are
never enabled in bulk, `outcome_unknown` runs are never retried in bulk,
cards with a live task are never purged in bulk, and protected answers are
never set to `auto_use: always`. Such rows are skipped with a reason.

#### Scenario: Submission approval in a bulk approve
- **WHEN** a user bulk-approves a selection that contains a submission approval
- **THEN** that approval is skipped with "review it on its own" and stays pending
