# packages/jobs-contracts — Job Tracker shared contracts (@pilihpendidikan/jobs-contracts)

The single source of the Job Tracker wire and data contracts (D-20): Zod schemas
for every table of `job-tracker-spec/04` and every `/api/v1` route of `05`, the
state machines, the `fp1` fingerprint, queue/agent/scoring/tailoring/email
contracts, the adapter manifest and the data files. `apps/api`, `apps/jobs` and
the Python CLI (`apps/jobs-cli`, via the generated JSON Schema) all consume it.
No build step for TypeScript: `exports` point at `src/*.ts`.

## Commands (run in this directory)

- `bun run build` — regenerate every derived file (`src/psl-data.ts`, `src/email-templates-data.ts`, `schema/*.json`, `adapters.json` `config_schema`, `test-vectors/*.json`, `examples/*.json`), Biome-formatted
- `bun run check` — regenerate into a temp dir and fail on any difference with the committed files
- `bun run test` — `bun test` (use `env -u CLAUDECODE bun test` inside Claude Code to see passing lines)
- `bun run typecheck` — `tsc --noEmit`; `bun run lint` — `biome check .`
- From the repo root: `bun run contracts:check` runs this package's `check` and then `contracts:check` in `apps/jobs-cli` (the generated Pydantic models and data copies); it is part of `bun run check` and of the CLI release (`.github/workflows/release-cli.yml`)

## Layout

| Path | What |
|---|---|
| `src/enums.ts` | Every enum / CHECK list (tuple + `XSchema` + type), `API_ERROR_STATUS`, `PAUSE_REASONS` |
| `src/ids.ts` | `newId`, `isId`, `idTimestamp`, `isIdWithinClockSkew` (±24 h), `ID_PREFIXES`, per-prefix id schemas |
| `src/common.ts` | Timestamps (epoch ms), error envelope, `paginated()`, binary marker |
| `src/records.ts` | `TABLE_RECORDS` (row schema per table, both databases) and the JSON-column shapes |
| `src/api/<area>.ts` | One module per 05 section; `src/api/routes.ts` merges them into `API_ROUTE_SCHEMAS` keyed `"METHOD /api/v1/…"` (exact 05 path) |
| `src/stage.ts` | Stage machine + `canTransition`, submission order, task table (21 §12), approvals |
| `src/fingerprint.ts` | `normalizeText`, `canonicalUrl`, `registrableDomain` (vendored PSL), `fingerprint`, `contentHash`, `dedupeGroup`, `legacyFingerprint` (WebCrypto) |
| `src/agent.ts`, `queue.ts`, `scoring.ts`, `cv-tailoring.ts`, `facts.ts`, `email.ts`, `adapters.ts`, `data.ts` | 19, 14 §6, 07, 08, 03 §9, 09, 15 §14, data files |
| `src/registry.ts`, `src/schema-export.ts` | Named-schema registry and the JSON Schema export |
| `psl/public_suffix_list.dat` | Vendored Public Suffix List (also read by the CLI) |
| `test-vectors/` | Golden vectors shared with the CLI (byte-identical results required) |
| `scripts/generate.ts`, `scripts/vector-cases.ts` | Generator and the hand-written vector expectations |

## Rules

- Change a contract here first, then `bun run build`, then `bun run contracts` in `apps/jobs-cli`, and commit every regenerated file; `bun run check` here and the root `bun run contracts:check` must stay green. A contract change the CLI cannot parse needs a `JOBS_MIN_CLI_VERSION` plan (22 §7).
- Schemas that should appear in `schema/*.json` are created with `defineSchema(group, Name, schema)`. Names are contract: never rename one without updating every consumer.
- Keep exported schemas JSON-Schema-representable: no `transform`, `preprocess`, `.default()` or `.trim()`; refinements are fine (they are dropped from JSON Schema).
- Plain `z.object` stays open in JSON Schema (old CLIs ignore new fields); use `z.strictObject` only where the spec demands closed objects.
- Fingerprint and URL rules are mirrored in Python. Any behaviour change needs new hand-written expectations in `scripts/vector-cases.ts` (never copied from the implementation) and a matching CLI change.
- Updating the PSL: replace `psl/public_suffix_list.dat` with a fresh download from https://publicsuffix.org/list/public_suffix_list.dat (keep its header), then `bun run build`.
- Contracts must stay dependency-free (only `zod`) so Workers, browsers and Bun can import them.
