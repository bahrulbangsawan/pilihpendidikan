## ADDED Requirements

### Requirement: Adapter enablement from the manifest
The CLI and the server SHALL take adapter availability only from
`packages/jobs-contracts/adapters.json`: each adapter's `status` (`stable`,
`beta`, `opt_in`, `excluded`), `min_cli_version` (an older CLI hides the
adapter), restrictions (`requires_opt_in`, `stop_on`), rate limits and
automation flags (`headless_ok`, `auto_ok`, `ats_hosts`, confirmation
patterns); a new exclusion or a disabled adapter SHALL take effect on the
server immediately and in the CLI on the next `meta` refresh, without a feature
flag. (Source: 15 §14.1, §14.4; 13 §9)

#### Scenario: Adapter newer than the CLI
- **WHEN** an adapter's `min_cli_version` is above the installed CLI's version
- **THEN** the CLI does not offer or run that adapter

### Requirement: SmartRecruiters adapter
The `smartrecruiters` adapter (beta) SHALL discover a company's postings with
the keyless Posting API using offset pagination of 100 and per-posting details,
and SHALL stop the source with `access_denied` on the first 401 or 403 without
retrying. (Source: 15 §14.3)

#### Scenario: Keyless access denied
- **WHEN** the Posting API answers 403 for a company identifier
- **THEN** the source stops with `access_denied` and the run is `partial`

### Requirement: Workable adapter
The `workable` adapter (beta) SHALL read the account's widget endpoint
(single response, details when needed) and SHALL stop the source with
`schema_invalid` when the undocumented response shape drifts. (Source: 15
§14.3)

#### Scenario: Shape drift
- **WHEN** the widget response no longer has the expected job list
- **THEN** the source stops with `schema_invalid` and no postings are emitted from it

### Requirement: Workday adapter is opt-in and best-effort
The `workday` adapter SHALL run only for a tenant the user explicitly opted in
(with the terms note shown), with one concurrent request and at least 3 s
between requests, offset pagination over the `cxs` jobs endpoint, and SHALL
stop on `access_denied`, `challenge_detected` or `rate_limited` without
retrying, changing identity or using any forbidden fetcher, disabling the tenant
on the first denial (`disabled_reason`). Workday postings SHALL have
`application_support = unknown` and are never auto-applied. (Source: 15 §14.3;
D-16; D-17; C-11)

#### Scenario: Tenant answers 403
- **WHEN** an opted-in Workday tenant answers 403
- **THEN** the source stops with `access_denied`, the tenant is disabled, no request is retried with altered identity, and the run is `partial`

#### Scenario: Not opted in
- **WHEN** a Workday source has not been opted in
- **THEN** the adapter refuses to fetch

### Requirement: Career page adapter
The `career_page` adapter SHALL fetch a configured careers URL as static HTML,
parse `JobPosting` JSON-LD first, then the configured CSS and adaptive
selectors, follow `rel=next` or `next_css` up to 50 pages, hand a link to a known
ATS host to that ATS adapter without fetching the page, never follow Workday
links, and report a page without data as `unsupported_content` without
escalating to a browser unless `allow_browser` is set. (Source: 15 §14.3, §5)

#### Scenario: Careers page links to Greenhouse
- **WHEN** a configured careers URL points at `boards.greenhouse.io/acme`
- **THEN** discovery runs through the `greenhouse` adapter for that board

### Requirement: Generic listing adapter
The `generic_listing` adapter (beta) SHALL crawl one site from `start_url`
restricted to its host, with listing and detail URL patterns, at most
`max_pages` (≤ 50) pages, the sitemap when present, and checkpoints only under
`<data>/crawls/<src_id>/`, loading a checkpoint only from that directory and
only when the same CLI major version wrote it; hitting the page cap SHALL mark
the source incomplete, and an access denial SHALL stop the crawl. (Source: 15
§14.3, §9)

#### Scenario: Checkpoint outside the crawl directory
- **WHEN** a checkpoint file is found outside `<data>/crawls/<src_id>/` or from another major version
- **THEN** it is not loaded and the crawl starts fresh

### Requirement: Custom URL adapter
The `custom_url` adapter SHALL fetch a single job URL (`pilih-jobs discover
--url` or a manual add), extract JSON-LD, then OpenGraph, then page heuristics,
store the posting as private when `private` is set or when fetched through the
user's logged-in Mode C browser, and refuse LinkedIn and Indeed hosts before any
request. (Source: 15 §14.3–§14.4; 03 §4.1; D-17)

#### Scenario: LinkedIn URL
- **WHEN** the user runs `pilih-jobs discover --url https://www.linkedin.com/jobs/view/1`
- **THEN** the CLI refuses before any request
