"""T16-CONTRACT: generated Pydantic models round-trip the contract examples (16 §15).

The same example payloads drive the TypeScript round-trip tests
(`packages/jobs-contracts/examples/*.json`).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.contracts import CONTRACTS_VERSION, SCHEMA_SHA256
from pilih_jobs.contracts import adapters as manifest
from pilih_jobs.contracts.index import model, record_model, route_for, routes, tables

CONTRACTS = Path(__file__).resolve().parents[4] / "packages" / "jobs-contracts"
API_EXAMPLES: dict[str, dict[str, Any]] = json.loads(
    (CONTRACTS / "examples" / "api.json").read_text()
)
RECORD_EXAMPLES: dict[str, Any] = json.loads((CONTRACTS / "examples" / "records.json").read_text())
DATA = Path(manifest.__file__).parent / "data"

ROUTE_PARTS = [
    (key, part)
    for key, parts in API_EXAMPLES.items()
    for part in parts
    if routes()[key].__dict__[part] is not None
]


@pytest.mark.parametrize(("key", "part"), ROUTE_PARTS, ids=[f"{k} {p}" for k, p in ROUTE_PARTS])
def test_T16_CONTRACT_api_example_round_trips(key: str, part: str) -> None:
    spec = routes()[key]
    name = getattr(spec, part)
    cls = model(name)
    value = API_EXAMPLES[key][part]
    first = cls.model_validate(value)
    dumped = first.model_dump(mode="json", by_alias=True, exclude_unset=True)
    second = cls.model_validate(json.loads(json.dumps(dumped)))
    assert second == first
    if part != "query":  # query values arrive as strings and are coerced
        assert dumped == value


@pytest.mark.parametrize("table", sorted(RECORD_EXAMPLES))
def test_T16_CONTRACT_record_example_round_trips(table: str) -> None:
    cls = record_model(table)
    value = RECORD_EXAMPLES[table]
    parsed = cls.model_validate(value)
    assert parsed.model_dump(mode="json", by_alias=True, exclude_unset=True) == value


def test_T16_CONTRACT_route_index_covers_every_api_route() -> None:
    index = routes()
    # The contract keys `API_ROUTE_SCHEMAS` by method + path and gives every route exactly
    # one example (`examples/api.json`, 105 routes today): the generated index must carry
    # the same set, so a contract change can never leave the CLI with a stale route table.
    assert set(index) == set(API_EXAMPLES)
    assert len(index) == len(API_EXAMPLES)
    for key, spec in index.items():
        assert key == f"{spec.method} {spec.path}"
        for name in (spec.query, spec.request, spec.response):
            if name is not None:
                model(name)  # importable
    assert set(tables()) == set(RECORD_EXAMPLES)


def test_T16_CONTRACT_route_matching_resolves_concrete_paths() -> None:
    spec = route_for("POST", "/api/v1/devices/dev_01JA6V8M3W8Z1T6Q4Y2B7K9C00/tasks:claim")
    assert spec is not None
    assert spec.idempotency == "required"
    assert spec.device
    spec = route_for(
        "POST", "/api/v1/discovery/runs/run_01JA6V8M3W8Z1T6Q4Y2B7K9C00/postings:batch?x=1"
    )
    assert spec is not None
    assert spec.operation
    assert route_for("GET", "/api/v1/nope") is None


def test_T16_CONTRACT_unknown_response_fields_are_ignored() -> None:
    """16 §12: the CLI ignores unknown response fields within a major version."""
    cls = model("GetMeResponse")
    value = {**API_EXAMPLES["GET /api/v1/me"]["response"], "future_field": {"x": 1}}
    parsed = cls.model_validate(value)
    assert "future_field" not in parsed.model_dump()


def test_T16_CONTRACT_strict_contract_objects_reject_unknown_fields() -> None:
    with pytest.raises(ValueError, match="extra"):
        model("EmptyObject").model_validate({"unexpected": True})


def test_T16_CONTRACT_version_and_schema_digest_are_current() -> None:
    package = json.loads((CONTRACTS / "package.json").read_text())
    assert package["version"] == CONTRACTS_VERSION
    digest = hashlib.sha256()
    for path in sorted((CONTRACTS / "schema").glob("*.json")):
        digest.update(path.name.encode() + b"\0" + path.read_bytes() + b"\0")
    assert digest.hexdigest() == SCHEMA_SHA256, "run `bun run contracts` in apps/jobs-cli"


@pytest.mark.parametrize("name", ["adapters.json", "skills-dictionary.json"])
def test_T16_CONTRACT_bundled_data_files_are_byte_copies(name: str) -> None:
    assert (DATA / name).read_bytes() == (CONTRACTS / name).read_bytes()


def test_T16_CONTRACT_adapter_manifest_and_exclusions() -> None:
    manifests = manifest.adapter_manifests()
    assert set(manifests) == {
        "greenhouse",
        "lever",
        "ashby",
        "smartrecruiters",
        "workable",
        "workday",
        "career_page",
        "generic_listing",
        "custom_url",
    }
    assert manifest.usable_adapter("greenhouse") is not None
    assert manifest.usable_adapter("greenhouse", cli_version="0.0.1") is None
    excluded = manifest.excluded_source_for_host("https://id.indeed.com/viewjob?jk=1")
    assert excluded is not None
    assert excluded.id == "indeed"
    linkedin = manifest.excluded_source_for_host("www.linkedin.com")
    assert linkedin is not None
    assert linkedin.id == "linkedin"
    assert manifest.excluded_source_for_host("https://boards.greenhouse.io/acme") is None
    assert manifest.adapter_for_ats_host("https://jobs.lever.co/acme/1") == "lever"
    assert manifest.adapter_for_ats_host("acme.wd5.myworkdayjobs.com") == "workday"
