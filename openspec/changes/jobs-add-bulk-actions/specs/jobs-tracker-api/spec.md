## ADDED Requirements

### Requirement: Inbox restore
`POST /api/v1/inbox:bulk` SHALL accept the action `restore`, which moves the
caller's `dismissed` user_jobs to `seen` in one guarded batch with a
`change_log` row per changed job, answers other states `ok` with their
unchanged `inbox_state`, and answers ids the caller does not own
`not_found`. (Source: 05 §4)

#### Scenario: Restore a dismissed job
- **WHEN** a user restores a dismissed job, a tracked job and a foreign id
- **THEN** the results are `ok/seen`, `ok/tracked` and `not_found`, and only the dismissed job changed
