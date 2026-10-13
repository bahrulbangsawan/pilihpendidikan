"""Contracts shared with the TypeScript side (`packages/jobs-contracts`, D-20).

- `_generated/` — Pydantic v2 models generated from the JSON Schema (never hand-edited;
  regenerate with `bun run contracts`).
- `_generated/index.json` — route table, table → record and schema → group maps.
- `data/` — byte copies of the adapter manifest, the skills dictionary and the Public
  Suffix List.
- `ids`, `fingerprint`, `url`, `psl`, `stage` — Python ports that reproduce the shared
  golden vectors in `packages/jobs-contracts/test-vectors/`.
- `index` — route lookup and model access by schema name; `adapters` — the manifest.
"""

from pilih_jobs.contracts._generated import CONTRACTS_VERSION, SCHEMA_SHA256

__all__ = ["CONTRACTS_VERSION", "SCHEMA_SHA256"]
