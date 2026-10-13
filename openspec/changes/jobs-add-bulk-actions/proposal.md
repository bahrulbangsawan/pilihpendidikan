# Change: Bulk actions on every Job Tracker list

## Why

Only two Job Tracker lists could act on many rows at once: the inbox
(`inbox:bulk`) and the board (client-side bulk bar, 06 §9). Every other list
(approvals, rules, runs, sources, devices, saved answers, interviews,
offers) needed one click per row, a dismissed inbox job could never come
back, and the CLI took exactly one id per command, so cleaning up after a
discovery run or a batch of applications meant dozens of commands.

## What Changes

- `POST /api/v1/inbox:bulk` gains the action `restore` (dismissed → seen;
  other states answer `ok` with their unchanged state; foreign ids
  `not_found`). Contracts regenerated (`InboxBulkAction`), CLI models
  regenerated.
- Dashboard (`apps/jobs`): one shared selection model and bulk chrome
  (`useSelection`, `useBulkRun`, `BulkToolbar`, `SelectAllCheckbox`,
  `RowCheckbox`, `BulkConfirmDialog`, `BulkRunResultsDialog`). Bulk runs stay
  client-side per 06 §9: one request per row through `runBulk` (four in
  flight, the row's own `base_revision` and `Idempotency-Key`), one summary
  toast, per-row results. New bulk actions on the board (delete
  permanently), inbox (restore), approvals (approve / reject), rules
  (enable / disable / delete), runs (cancel / retry), sources (enable /
  disable / run now / delete), devices (revoke, accept tasks), answers
  (delete, reuse setting), interviews and offers (delete). Destructive
  actions confirm first.
- Guards never bypassed in bulk: submission approvals, `answer` and
  `rule_activation` approvals, `auto` rule activation, `outcome_unknown`
  retries, purges of cards with a live task, and `auto_use: always` on
  protected answers are skipped with a reason instead.
- CLI (`apps/jobs-cli`): `move`, `archive`, `rm`, `edit`, `follow-up`,
  `rules enable|disable`, `devices revoke`, `approvals decide` take several
  ids with per-id results; new `inbox seen|restore` and `tasks
  list|cancel|retry`; list tables fit the terminal and never cut ids;
  list commands accept `--ids` (and `inbox list` / `list` accept `--all`);
  one argument may hold several whitespace-separated ids (zsh `$(…)`).

## Impact

- Affected specs: `jobs-tracker-api`, `jobs-dashboard`, `jobs-cli`
- Affected code: `packages/jobs-contracts/src/enums.ts`,
  `apps/api/src/jobs/services/discovery/inbox.ts`, `apps/jobs/src/**`,
  `apps/jobs-cli/src/pilih_jobs/cli/**`, `job-tracker-spec/05`, `16`
- No new routes, tables, flags or migrations.
