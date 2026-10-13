## ADDED Requirements

### Requirement: Multi-id commands
`move`, `archive`, `rm`, `edit`, `follow-up`, `inbox track|dismiss|seen|restore`,
`rules enable|disable`, `devices revoke`, `approvals decide` and
`tasks cancel|retry` SHALL accept several ids, deduplicate them in order,
validate their prefixes before any request, process every id even when one
fails, and report per-id results; with one id the output keeps its earlier
shape. Bulk `approvals decide --approve` MUST skip submission, `answer` and
`rule_activation` approvals. `rm --purge` confirms once for the whole set.
(Source: 16 §3.3)

#### Scenario: Archive several applications
- **WHEN** a user runs `pilih-jobs archive app_a app_b app_missing --json`
- **THEN** the result lists `ok`, `ok`, `not_found` and the exit code is non-zero

### Requirement: Copyable ids
Human list output SHALL print ids untruncated, and list commands SHALL accept
`--ids` to print only ids, one per line, for piping into multi-id commands.

#### Scenario: Pipe inbox ids
- **WHEN** a user runs `pilih-jobs inbox dismiss $(pilih-jobs inbox list --ids)`
- **THEN** every listed job is dismissed with per-id results
