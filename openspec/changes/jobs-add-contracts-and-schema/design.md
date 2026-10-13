## Context

The Job Tracker spans a Cloudflare Worker (`apps/api`), a TanStack Start
dashboard (`apps/jobs`) and a Python 3.12 CLI (`apps/jobs-cli`, D-07). All
three exchange the same records over `/api/v1` and the CLI's outbox, and the
CLI recomputes posting fingerprints offline that the server must reproduce
exactly (03 §4.2, 20 §7). Hand-maintained parallel types are a known drift
risk in this repository (`CVData`, 08 §1).

## Goals / Non-Goals

- Goals: one authored definition (Zod) of every 04 table, 05 route, enum,
  state machine and wire message; a JSON Schema export the Python side can
  generate models from; byte-identical fingerprint, URL and domain results in
  TypeScript and Python; a check that fails when generated files drift.
- Non-Goals: no runtime behaviour (routes, persistence, UI) — those are the
  later changes; no build step for TypeScript consumers; no OpenAPI document.

## Decisions

- Decision: Zod v4 is the source of truth and JSON Schema is derived with
  `z.toJSONSchema`, committed under `schema/*.json` (D-20). Exported schemas
  avoid `transform`, `preprocess`, `.default()` and `.trim()` so they stay
  representable; refinements are allowed and dropped from JSON Schema.
- Decision: plain `z.object` stays open in JSON Schema (an older CLI ignores
  new fields); `z.strictObject` only where a spec demands closed objects
  (e.g. the tailoring patch of 08 §4.3, which is sent to Structured Outputs).
- Decision: TypeScript source exports (`exports` → `./src/*.ts`) with
  subpaths (`./enums`, `./ids`, `./records`, `./api`, `./stage`,
  `./fingerprint`, `./facts`, `./queue`, `./agent`, `./scoring`,
  `./cv-tailoring`, `./email`, `./adapters`, …) so the Worker bundles only
  what it imports.
- Decision: route contracts are keyed by the exact 05 path
  (`"PATCH /api/v1/applications/{app_id}"`) and carry the scope,
  alternative/extra scope, idempotency and device requirements, so the api
  router (`fromContract`) and the web BFF cannot drift from 05.
- Decision: golden vectors (`test-vectors/*.json`) are written from
  hand-made expectations (`scripts/vector-cases.ts`), never copied from the
  implementation, and the CLI reads them in place.
- Decision: the Public Suffix List is vendored (`psl/public_suffix_list.dat`)
  and read by both implementations, so registrable domains never depend on
  the network.
- Alternatives considered: hand-written Python types (drift, rejected by
  D-20); OpenAPI generation from route handlers (handlers live in a
  hand-written router, so there is nothing to introspect).

## Divergences from the spec text (code is authoritative)

- 03 §8 gives expiries only for `submit`/`answer` (24 h) and `cv_variant`
  (7 d); the contracts also give `rule_activation` 7 days
  (`APPROVAL_EXPIRY_MS`).
- The submission machine is encoded as a rank order
  (`not_started < in_progress < {failed, outcome_unknown,
  submitted_unverified} < submitted_verified`, plus the retry edge
  `failed → in_progress`) for the forward-only rule of 20 §6.2; explicit
  user, MCP and legacy-migration decisions may set any value.
- The skills dictionary ships 181 terms (07 §3 F1 asked for ≥ 150).

## Risks / Trade-offs

- A contract change ripples into three consumers → `bun run check` in the
  package regenerates into a temp dir and fails on any difference; the CLI
  regenerates its models with `bun run contracts` and checks them with
  `contracts:check`.
- JSON Schema loses refinements → the server always re-validates with Zod;
  the CLI models are a convenience, not the authority.
- PSL staleness → refreshing is a documented manual step (download, keep the
  header, `bun run build`).

## Migration Plan

Additive: a new workspace package. Consumers adopt it in later changes.
Rollback is deleting the package before any consumer imports it.

## Open Questions

- A-06 (Python + `uv` as a second toolchain) is an owner decision; the
  Pydantic generation assumes it.
