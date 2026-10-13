# Change: Add the Job Tracker shared contracts and data model

## Why

The Job Tracker is built by three runtimes — the `apps/api` Worker, the
`apps/jobs` dashboard (TypeScript) and the `pilih-jobs` CLI (Python). The
repository already shows what happens without one definition: `CVData` was
hand-copied into `apps/api` and drifted (`job-tracker-spec/00` §3, C-06).
Every record, request, response, enum, state machine and the posting
fingerprint must therefore be authored once and consumed everywhere
(D-20), before any Job Tracker code is written (13 §2, milestone M0).

## What Changes

- New package `packages/jobs-contracts` (`@pilihpendidikan/jobs-contracts`):
  Zod v4 schemas with TypeScript source exports and no build step for
  TypeScript, dependency-free apart from `zod` so Workers, browsers and Bun
  can import it.
- The canonical vocabulary of 03: prefixed ULID ids (`usr_ … sal_`), every
  enum and `CHECK` list of 04, the application stage machine, the submission
  status machine, the automation task machine, approvals, the 21 canonical
  pause reasons and the canonical applicant fact keys.
- Row schemas for every table of both databases (`TABLE_RECORDS`) and a
  schema for every `/api/v1` route of 05 (`API_ROUTE_SCHEMAS`, keyed by the
  exact 05 path, carrying scope, idempotency and device requirements), plus
  the error envelope and the error-code → HTTP status table.
- The `fp1` posting fingerprint, canonical URL and registrable-domain rules
  (vendored Public Suffix List), content hash and dedupe group.
- Queue (`JobsAiMessage`), agent, scoring, CV tailoring and email contracts;
  the adapter manifest `adapters.json` (9 adapters + excluded LinkedIn and
  Indeed, D-17) and the data files (skills dictionary, title families, email
  templates, CLI install commands).
- Committed JSON Schema (`schema/*.json`) generated with `z.toJSONSchema`,
  a drift check, golden test vectors shared byte-for-byte with the CLI, and
  Pydantic v2 models generated for the CLI from the JSON Schema.

Implemented in the working tree (uncommitted, undeployed). Nothing in this
change touches a remote resource.

## Impact

- Affected specs: `jobs-contracts` (new), `jobs-data` (new; the record and
  state-machine half — the database half is `api-add-user-ids-and-jobs-db`).
- Affected code: `packages/jobs-contracts/**`;
  `apps/jobs-cli/src/pilih_jobs/contracts/_generated/**` and
  `apps/jobs-cli/scripts/gen_contracts.py` (generated consumers);
  consumers in `apps/api/src/jobs/**` and `apps/jobs/src/**`.
- Sources: `job-tracker-spec/03` (§1 ids, §4.2 fingerprint, §5 stages and
  submission, §7 tasks and pause reasons, §8 approvals, §9 facts), `04` (every
  table and CHECK list), `05` (§1.2 scopes, §1.3 errors, every route), `07`
  (scoring contracts), `08` §4.3/§4.5 (tailoring patch and diff), `09` §5.1
  (email templates), `14` §6 (queue messages), `15` §14 (adapter manifest),
  `16`/`20` (Pydantic consumption), `22` §12 (install commands); decisions
  D-03, D-17, D-20, D-21; roadmap 13 §2 M0 deliverable ②.
