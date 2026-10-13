## ADDED Requirements

### Requirement: Single shared contracts package
The workspace SHALL provide `packages/jobs-contracts`
(`@pilihpendidikan/jobs-contracts`) as the only place where Job Tracker wire
and data contracts are authored, as Zod v4 schemas exported as TypeScript
source through subpaths, with `zod` as its only runtime dependency so the
Worker, the browser and Bun can import it. (Source: 05 intro; 16 §2; D-20)

#### Scenario: Consumers import, never redefine
- **WHEN** `apps/api` or `apps/jobs` needs an `/api/v1` request, response or record type
- **THEN** it imports the schema or type from `@pilihpendidikan/jobs-contracts` (or a subpath such as `/api/*`, `/enums`, `/stage`) instead of declaring its own

#### Scenario: Worker-safe import
- **WHEN** the api Worker bundles a contracts subpath
- **THEN** the bundle pulls in no dependency other than `zod`

### Requirement: Route contract table
The contracts package SHALL define every `/api/v1` route of 05 in
`API_ROUTE_SCHEMAS`, keyed by `"<METHOD> <exact 05 path>"`, with its path
parameters, query and body schemas, response schema, required scope (plus
any alternative or additional scope), idempotency requirement and whether a
device-bound token is required. (Source: 05 §1.2, §1.4, §3–§13; D-20)

#### Scenario: Route lookup
- **WHEN** the api router declares `fromContract("PATCH /api/v1/applications/{app_id}")`
- **THEN** it receives that route's scope, idempotency mode, device flag and body schema from the table, and a key that is not a 05 path is a type error

#### Scenario: Coverage
- **WHEN** the table is enumerated
- **THEN** it holds one entry for each of the 105 `/api/v1` routes and each entry names a scope (`none`/`any` only for the public and meta routes)

### Requirement: Error envelope and status table
The contracts package SHALL define the error envelope
`{error, message, details?, request_id}` and the mapping of every 05 §1.3
error code to its HTTP status (`API_ERROR_STATUS`), including
`invalid_token` reasons, `device_required`, `too_late`, `cursor_expired`,
`ai_budget_exhausted`, `mode_not_allowed` and `cli_upgrade_required` (426).
(Source: 05 §1.3)

#### Scenario: Status lookup
- **WHEN** a handler raises `revision_conflict`
- **THEN** the shared table maps it to HTTP 409 and the envelope schema accepts `details.current`

### Requirement: Committed JSON Schema with a drift check
The contracts package SHALL export every named schema to JSON Schema with
`z.toJSONSchema`, one file per schema group under `schema/*.json`, commit the
result, and provide a `check` script that regenerates into a temporary
directory and fails on any difference. (Source: 05 intro; 16 §2; D-20)

#### Scenario: Stale generated file
- **WHEN** a Zod schema changes and `bun run build` was not run
- **THEN** `bun run check` in `packages/jobs-contracts` exits non-zero naming the stale file

#### Scenario: Fresh tree
- **WHEN** the generated files match the sources
- **THEN** `bun run check` reports every generated file fresh

### Requirement: Python models generated from the contracts
The CLI SHALL obtain its request, response and record models as Pydantic v2
classes generated from `schema/*.json` (plus a route index), never written
by hand, and SHALL provide a check that fails when the generated models are
stale. (Source: 16 §2; 20 §3; D-20)

#### Scenario: Regeneration
- **WHEN** `bun run contracts` runs in `apps/jobs-cli`
- **THEN** `src/pilih_jobs/contracts/_generated/` is rewritten from the committed JSON Schema and `contracts:check` passes afterwards

#### Scenario: Hand edit
- **WHEN** a generated model file is edited by hand
- **THEN** `bun run contracts:check` fails

### Requirement: Posting fingerprint fp1
The contracts package SHALL compute posting fingerprints as `fp1:` plus the
SHA-256 hex of `src|<source_kind>|<normalize(source_org)>|<source_job_ref>`
for source kinds with a stable job id (greenhouse, lever, ashby,
smartrecruiters, workable, workday), and otherwise of
`gen|<registrable domain>|<normalize(title)>|<normalize(location)>|<canonical url>`,
where `normalize` is NFKC, lowercase, trim, whitespace collapse and
punctuation stripping that keeps `+ # . / -`. It SHALL also provide the
content hash (`sha256(normalize(title) + "\n" + normalize(description))`),
the dedupe group and the legacy fingerprint of migrated jobs.
(Source: 03 §4.2; 06 §12.2)

#### Scenario: Stable source id
- **WHEN** a Greenhouse posting with org `Acme` and job ref `123` is fingerprinted
- **THEN** the key is `src|greenhouse|acme|123` and the fingerprint starts with `fp1:`

#### Scenario: Language names survive normalization
- **WHEN** a generic posting title contains `C++` or `C#`
- **THEN** normalization keeps the `+` and `#` characters

### Requirement: Canonical URL and registrable domain
The contracts package SHALL canonicalize URLs by lowercasing scheme and host,
dropping the default port and the fragment, dropping `utm_*`, `gh_src`,
`lever-source`, `ref`, `source`, `fbclid` and `gclid` query parameters and
sorting the rest, and SHALL compute registrable domains from a vendored copy
of the Public Suffix List. (Source: 03 §4.2)

#### Scenario: Tracking parameters
- **WHEN** `https://Jobs.Example.com:443/a?utm_source=x&b=2&a=1#top` is canonicalized
- **THEN** the result is `https://jobs.example.com/a?a=1&b=2`

#### Scenario: Multi-part public suffix
- **WHEN** the registrable domain of `careers.acme.co.id` is computed
- **THEN** it is `acme.co.id`

### Requirement: Golden test vectors shared with the CLI
The contracts package SHALL ship golden vectors for fingerprints, canonical
URLs, registrable domains, ids and every stage transition (from × to ×
actor) under `test-vectors/`, written from hand-made expectations, and both
the TypeScript tests and the CLI's Python tests SHALL read the same files and
require identical results. (Source: 03 §4.2; 13 §4; D-20)

#### Scenario: Cross-language parity
- **WHEN** the CLI fingerprint port computes every case of `test-vectors/fingerprint.json`
- **THEN** each result equals the expected value byte for byte, as the TypeScript implementation does

### Requirement: Adapter manifest with excluded sources
The contracts package SHALL publish `adapters.json` listing the nine source
adapters (greenhouse, lever, ashby, smartrecruiters, workable, workday,
career_page, generic_listing, custom_url) with their configuration JSON
Schema, automation flags and confirmation patterns, and `excluded` entries
for LinkedIn and Indeed with their hosts and evidence URLs. (Source: 15 §14;
D-17)

#### Scenario: Excluded host lookup
- **WHEN** a consumer checks a `linkedin.com` or `lnkd.in` URL against the manifest
- **THEN** it resolves to the `excluded` entry `linkedin`

### Requirement: Queue, agent, scoring, tailoring and email contracts
The contracts package SHALL define the `jobs-ai` queue message union
discriminated by `type` (`score_postings`, `tailor_cv`, `evaluate_rules`,
`purge_user`, `rollup_user`, `rebuild_analytics`, `export_user`), the agent
observation, candidate-action, field-plan and AI-proxy request/response
shapes with `lease_ref`, the scoring profile and components, the strict
`CvTailoringPatch` schema and diff shape, and the bilingual email templates
with their render function. (Source: 14 §6; 19 §3–§7; 07 §4.3; 08 §4.3,
§4.5; 09 §5.1)

#### Scenario: Unknown queue message
- **WHEN** a message with an unknown `type` is parsed with the queue schema
- **THEN** parsing fails

#### Scenario: Closed tailoring patch
- **WHEN** a tailoring patch carries a property the schema does not define
- **THEN** the strict schema rejects it

### Requirement: Data files
The contracts package SHALL ship the skills dictionary with synonyms (at
least 150 terms), the title families with seniority words, the email
templates in English and Indonesian, and the CLI install and login commands
shown on the dashboard's `/cli` page. (Source: 07 §3 F1–F2; 09 §5.1; 22 §12)

#### Scenario: Dictionary size
- **WHEN** `skills-dictionary.json` is loaded
- **THEN** it contains at least 150 skills with their synonyms
