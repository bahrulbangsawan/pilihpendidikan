## 1. Package

- [x] 1.1 `packages/jobs-contracts` workspace package (`@pilihpendidikan/jobs-contracts`), TypeScript source exports with subpaths, `zod` as the only dependency (`package.json`, `CLAUDE.md`)
- [x] 1.2 Scripts: `build` (regenerates every derived file), `check` (drift check into a temp dir), `test`, `typecheck`, `lint` (`scripts/generate.ts`)

## 2. Vocabulary and records (`jobs-data`)

- [x] 2.1 Prefixed ULID ids with the ±24 h clock-skew check (`src/ids.ts`; TC-IDS, `test-vectors/ids.json`)
- [x] 2.2 Every enum and CHECK list, `PAUSE_REASONS` (21 values), `API_ERROR_STATUS` (`src/enums.ts`)
- [x] 2.3 Row schemas for every table of both databases, JSON-column shapes (`src/records.ts`; TC-ROUNDTRIP)
- [x] 2.4 Stage, submission, task and approval machines (`src/stage.ts`; TC-STAGE, T6-01, `test-vectors/stage-transitions.json`)
- [x] 2.5 Canonical fact keys and sensitivity classes (`src/facts.ts`)

## 3. Wire contracts (`jobs-contracts`)

- [x] 3.1 One module per 05 section under `src/api/`, merged into `API_ROUTE_SCHEMAS` (105 routes) with scope, idempotency and device flags (`src/api/routes.ts`)
- [x] 3.2 Error envelope and pagination helpers (`src/common.ts`)
- [x] 3.3 Queue, agent, scoring, CV tailoring and email contracts (`src/queue.ts`, `src/agent.ts`, `src/scoring.ts`, `src/cv-tailoring.ts`, `src/email.ts`; TC-QUEUE, TC-AGENT, TC-TAILOR-SCHEMA, T9-10)
- [x] 3.4 Data files: `adapters.json` (9 adapters + excluded linkedin/indeed; TC-ADAPTERS), `skills-dictionary.json` (181 terms), `title-families.json`, `email-templates/{en,id}.txt`, `cli-commands.json`

## 4. Fingerprint and URL rules

- [x] 4.1 `normalizeText`, `canonicalUrl`, `registrableDomain` over the vendored PSL (`psl/public_suffix_list.dat`), `fingerprint`, `contentHash`, `dedupeGroup`, `legacyFingerprint` (`src/fingerprint.ts`; TC-FP, TC-URL, TC-PSL)
- [x] 4.2 Golden vectors from hand-written expectations (`scripts/vector-cases.ts` → `test-vectors/*.json`)

## 5. JSON Schema and Python models

- [x] 5.1 `z.toJSONSchema` export of every named schema to `schema/*.json`, committed (`src/registry.ts`, `src/schema-export.ts`; TC-JSONSCHEMA); `bun run check` reports the 22 generated files fresh
- [x] 5.2 CLI Pydantic v2 models generated from the JSON Schema with `bun run contracts` / `contracts:check` (`apps/jobs-cli/scripts/gen_contracts.py` → `apps/jobs-cli/src/pilih_jobs/contracts/_generated/`)
- [x] 5.3 CLI ports of ids, fingerprint, canonical URL, PSL and the stage machine pass the shared vectors (`apps/jobs-cli/src/pilih_jobs/contracts/`; TCLI-FP, TCLI-URL, TCLI-PSL, TCLI-STAGE, TCLI-IDS — leaf-4.1 gate G1 verified)

## 6. Verification

- [x] 6.1 `bun test` in `packages/jobs-contracts`: 400 pass, 0 fail (leaf-1.1 gate G1 verified; re-run for this record)
- [x] 6.2 `bun run check` in `packages/jobs-contracts`: generated files fresh
- [x] 6.3 Handoff recorded (NOT executed — owner/leaf-5.3 action): wiring `contracts:check` into the root `bun run check` chain belongs to leaf-5.3 (root `package.json`); it was not part of this change
