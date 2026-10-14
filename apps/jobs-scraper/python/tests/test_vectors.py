"""Fingerprint parity with the shared golden vectors (byte-identical to the TypeScript)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pilih_jobs.contracts.fingerprint import FingerprintInput, fingerprint, fingerprint_key

VECTORS = Path(__file__).resolve().parents[4] / "packages" / "jobs-contracts" / "test-vectors"
CASES: list[dict[str, Any]] = json.loads((VECTORS / "fingerprint.json").read_text("utf-8"))["cases"]
FIELDS = (
    "source_kind",
    "title",
    "source_org",
    "source_job_ref",
    "company_domain",
    "location_primary",
    "apply_url",
    "canonical_url",
)


@pytest.mark.parametrize("case", CASES, ids=[str(c["name"]) for c in CASES])
def test_fingerprint_vectors(case: dict[str, Any]) -> None:
    data = case["input"]
    posting = FingerprintInput(**{k: data[k] for k in FIELDS if k in data})
    assert fingerprint_key(posting) == case["key"]
    assert fingerprint(posting) == case["fingerprint"]
