"""Golden vectors shared with the TypeScript contracts (`packages/jobs-contracts/test-vectors`).

The Python ports must reproduce every vector byte for byte; the server recomputes
fingerprints and marks a mismatch `invalid` (20 §7). The vectors are read directly from
the repository, never copied.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.contracts import fingerprint as fp
from pilih_jobs.contracts import ids, psl, stage

VECTORS = Path(__file__).resolve().parents[4] / "packages" / "jobs-contracts" / "test-vectors"


def load(name: str) -> dict[str, Any]:
    return json.loads((VECTORS / name).read_text("utf-8"))


FINGERPRINT = load("fingerprint.json")
CANONICAL = load("canonical-url.json")
DOMAINS = load("registrable-domain.json")
STAGES = load("stage-transitions.json")
IDS = load("ids.json")

_INPUT_FIELDS = (
    "source_kind",
    "title",
    "source_org",
    "source_job_ref",
    "company_domain",
    "location_primary",
    "apply_url",
    "canonical_url",
)


def _fp_input(raw: dict[str, Any]) -> fp.FingerprintInput:
    return fp.FingerprintInput(**{k: raw.get(k) for k in _INPUT_FIELDS if k in raw})


@pytest.mark.parametrize("case", FINGERPRINT["cases"], ids=lambda c: c["name"])
def test_TCLI_FP_fingerprint_vector(case: dict[str, Any]) -> None:
    posting = _fp_input(case["input"])
    assert fp.fingerprint_key(posting) == case["key"]
    assert fp.fingerprint(posting) == case["fingerprint"]


@pytest.mark.parametrize("case", FINGERPRINT["normalize_text"], ids=lambda c: repr(c["input"])[:40])
def test_TCLI_FP_normalize_text_vector(case: dict[str, Any]) -> None:
    assert fp.normalize_text(case["input"]) == case["output"]


@pytest.mark.parametrize("case", FINGERPRINT["content_hash"], ids=lambda c: c["title"][:30])
def test_TCLI_FP_content_hash_vector(case: dict[str, Any]) -> None:
    assert fp.content_hash(case["title"], case["description"]) == case["content_hash"]


@pytest.mark.parametrize("case", FINGERPRINT["dedupe_group"], ids=lambda c: str(c["key"])[:40])
def test_TCLI_FP_dedupe_group_vector(case: dict[str, Any]) -> None:
    assert fp.dedupe_group_key(**case["input"]) == case["key"]
    assert fp.dedupe_group(**case["input"]) == case["dedupe_group"]


@pytest.mark.parametrize("case", FINGERPRINT["legacy"], ids=lambda c: c["legacy_id"])
def test_TCLI_FP_legacy_fingerprint_vector(case: dict[str, Any]) -> None:
    assert fp.legacy_fingerprint_key(case["user_id"], case["legacy_id"]) == case["key"]
    assert fp.legacy_fingerprint(case["user_id"], case["legacy_id"]) == case["fingerprint"]


def test_TCLI_FP_vectors_match_the_bundled_psl_version() -> None:
    assert FINGERPRINT["psl_version"] == psl.load_psl().version == DOMAINS["psl_version"]


@pytest.mark.parametrize("case", CANONICAL["cases"], ids=lambda c: c["name"])
def test_TCLI_URL_canonical_url_vector(case: dict[str, Any]) -> None:
    assert fp.canonical_url(case["input"]) == case["output"]


@pytest.mark.parametrize(
    "case", DOMAINS["cases"], ids=lambda c: f"{c['input'] or '<empty>'}-{c['include_private']}"
)
def test_TCLI_PSL_registrable_domain_vector(case: dict[str, Any]) -> None:
    private = case["include_private"]
    assert (
        psl.registrable_domain(case["input"], include_private=private) == case["registrable_domain"]
    )
    assert psl.public_suffix(case["input"], include_private=private) == case["public_suffix"]


def test_TCLI_PSL_compiled_rules_equal_the_typescript_build() -> None:
    """The Python compilation of the vendored list equals `src/psl-data.ts` rule for rule."""
    source = (VECTORS.parent / "src" / "psl-data.ts").read_text("utf-8")
    icann = re.search(r'PSL_ICANN_RULES =\s*"([^"]*)"', source)
    private = re.search(r'PSL_PRIVATE_RULES =\s*"([^"]*)"', source)
    version = re.search(r'PSL_VERSION = "([^"]*)"', source)
    assert icann
    assert private
    assert version
    compiled = psl.load_psl()
    assert compiled.version == version.group(1)
    assert list(compiled.icann) == icann.group(1).split(" ")
    assert list(compiled.private) == private.group(1).split(" ")


def test_TCLI_PSL_bundled_list_is_a_byte_copy_of_the_vendored_list() -> None:
    bundled = Path(psl.__file__).parent / "data" / "public_suffix_list.dat"
    assert bundled.read_bytes() == (VECTORS.parent / "psl" / "public_suffix_list.dat").read_bytes()


@pytest.mark.parametrize("actor", STAGES["actors"])
def test_TCLI_STAGE_transition_matrix(actor: str) -> None:
    cases = [c for c in STAGES["cases"] if c["actor"] == actor]
    assert len(cases) == 81
    wrong = [
        c for c in cases if stage.can_transition(c["from"], c["to"], c["actor"]) != c["allowed"]
    ]
    assert wrong == []


def test_TCLI_STAGE_matrix_covers_every_combination() -> None:
    assert len(STAGES["cases"]) == len(stage.STAGES) ** 2 * len(stage.STAGE_ACTORS)
    assert {c["actor"] for c in STAGES["cases"]} == set(stage.STAGE_ACTORS)


def test_TCLI_STAGE_submission_status_forward_order() -> None:
    assert stage.is_forward_submission("not_started", "in_progress")
    assert stage.is_forward_submission("outcome_unknown", "submitted_verified")
    assert stage.is_forward_submission("failed", "in_progress")  # explicit retry edge
    assert not stage.is_forward_submission("submitted_verified", "outcome_unknown")
    assert not stage.is_forward_submission("failed", "outcome_unknown")  # equal rank
    assert stage.can_change_submission_status("submitted_verified", "failed", "user")
    assert not stage.can_change_submission_status("submitted_verified", "failed", "automation")


_STATUSES = (
    "not_started",
    "in_progress",
    "failed",
    "outcome_unknown",
    "submitted_unverified",
    "submitted_verified",
)
# Hand-written (03 §5.2, 20 §6.2, leaf-5.1 #5): every automation/system move allowed.
_FORWARD = {
    ("not_started", "in_progress"),
    ("not_started", "failed"),
    ("not_started", "outcome_unknown"),
    ("not_started", "submitted_unverified"),
    ("not_started", "submitted_verified"),
    ("in_progress", "failed"),
    ("in_progress", "outcome_unknown"),
    ("in_progress", "submitted_unverified"),
    ("in_progress", "submitted_verified"),
    ("failed", "in_progress"),  # retry edge
    ("failed", "submitted_verified"),
    ("outcome_unknown", "submitted_unverified"),  # evidence edge (S-24)
    ("outcome_unknown", "submitted_verified"),
    ("submitted_unverified", "submitted_verified"),
}
_TS_EXCEPTIONS = re.compile(r"SUBMISSION_FORWARD_EXCEPTIONS\b[^=]*=\s*\[(.*?)\];", re.S)
_TS_PAIR = re.compile(r'\[\s*"([a-z_]+)"\s*,\s*"([a-z_]+)"\s*,?\s*\]')


def test_TFIX_EVIDENCE_EDGE_outcome_unknown_to_submitted_unverified_is_forward() -> None:
    # Late evidence / an automation result with an unverified verdict resolves "unknown".
    assert stage.is_forward_submission("outcome_unknown", "submitted_unverified")
    assert stage.can_change_submission_status("outcome_unknown", "submitted_unverified", "system")
    assert stage.can_change_submission_status(
        "outcome_unknown", "submitted_unverified", "automation"
    )
    # The reverse stays refused: a lease expiring after an unconfirmed submission.
    assert not stage.is_forward_submission("submitted_unverified", "outcome_unknown")
    assert not stage.can_change_submission_status(
        "submitted_unverified", "outcome_unknown", "system"
    )
    # Other equal-rank moves are still not forward.
    assert not stage.is_forward_submission("failed", "submitted_unverified")
    assert not stage.is_forward_submission("submitted_unverified", "failed")
    assert not stage.is_forward_submission("outcome_unknown", "failed")
    # User decisions stay final in both directions.
    assert stage.can_change_submission_status("submitted_unverified", "outcome_unknown", "user")


def test_TFIX_EVIDENCE_EDGE_whole_submission_matrix() -> None:
    for source in _STATUSES:
        for target in _STATUSES:
            expected = (source, target) in _FORWARD
            assert stage.is_forward_submission(source, target) is expected, (source, target)
            assert stage.can_change_submission_status(source, target, "automation") is expected
            assert stage.can_change_submission_status(source, target, "user") is (source != target)


def test_TFIX_EVIDENCE_EDGE_exceptions_mirror_stage_ts() -> None:
    """The Python exception list is exactly `SUBMISSION_FORWARD_EXCEPTIONS` of `stage.ts`."""
    source = (VECTORS.parent / "src" / "stage.ts").read_text("utf-8")
    block = _TS_EXCEPTIONS.search(source)
    assert block is not None, "SUBMISSION_FORWARD_EXCEPTIONS not found in stage.ts"
    pairs = set(_TS_PAIR.findall(block.group(1)))
    assert pairs == set(stage.SUBMISSION_FORWARD_EXCEPTIONS)
    assert ("outcome_unknown", "submitted_unverified") in pairs


def test_TCLI_STAGE_task_and_approval_machines() -> None:
    assert stage.can_task_transition("queued", "claimed", "device")
    assert not stage.can_task_transition("queued", "claimed", "user")
    assert stage.can_task_transition("outcome_unknown", "submitted", "system")
    assert not stage.can_task_transition("submitted", "queued")
    assert stage.can_approval_transition("pending", "approved")
    assert not stage.can_approval_transition("approved", "rejected")


@pytest.mark.parametrize("case", IDS["ulid_time"], ids=lambda c: str(c["ms"]))
def test_TCLI_IDS_ulid_time_vector(case: dict[str, Any]) -> None:
    assert ids.encode_ulid_time(case["ms"]) == case["time"]
    assert ids.decode_ulid_time(case["time"] + "0" * 16) == case["ms"]


@pytest.mark.parametrize("case", IDS["validity"], ids=lambda c: c["value"])
def test_TCLI_IDS_validity_vector(case: dict[str, Any]) -> None:
    assert ids.is_id(case["prefix"], case["value"]) is case["valid"]


def test_TCLI_IDS_new_ids_round_trip_and_respect_the_clock() -> None:
    assert IDS["alphabet"] == ids.CROCKFORD_ALPHABET
    assert IDS["max_clock_skew_ms"] == ids.ID_MAX_CLOCK_SKEW_MS
    stamp = 1_791_770_000_000
    value = ids.new_id("evt", stamp)
    assert ids.is_id("evt", value)
    assert ids.id_timestamp(value) == stamp
    assert ids.is_id_within_clock_skew(value, stamp + ids.ID_MAX_CLOCK_SKEW_MS)
    assert not ids.is_id_within_clock_skew(value, stamp + ids.ID_MAX_CLOCK_SKEW_MS + 1)
    assert len({ids.new_id("run") for _ in range(200)}) == 200
    with pytest.raises(ValueError, match="Unknown id prefix"):
        ids.new_id("zzz")


def test_TCLI_IDS_prefix_list_matches_the_typescript_contract() -> None:
    source = (VECTORS.parent / "src" / "ids.ts").read_text("utf-8")
    block = source[source.index("export const ID_PREFIXES") : source.index("] as const;")]
    assert tuple(re.findall(r'"([a-z]{3}_)"', block)) == ids.ID_PREFIXES
