"""T15-UNIT: normalizers, validators, fingerprints and item shapes (15 §10, §11, 03 §4.2)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.contracts.fingerprint import content_hash, dedupe_group
from pilih_jobs.contracts.index import model
from pilih_jobs.discovery.cursor import DETAIL_ETAGS_MAX, CursorState
from pilih_jobs.discovery.htmltext import (
    html_to_text,
    requirements_from_html,
    requirements_from_text,
)
from pilih_jobs.discovery.items import (
    ItemContext,
    ItemRejected,
    build_item,
    client_ref_for,
    confidence_for,
    unchanged_item,
    validate,
)
from pilih_jobs.discovery.normalize import (
    PostingDraft,
    employment_of,
    normalize,
    parse_location,
    parse_posted_at,
    parse_salary_text,
    split_locations,
)
from pilih_jobs.discovery.types import RawPosting

NOW = 1_791_770_000_000
DAY = 86_400_000
VECTORS = Path(__file__).resolve().parents[4] / "packages" / "jobs-contracts" / "test-vectors"
CTX = ItemContext(
    run_id="run_01JA6V8M3W8Z1T6Q4Y2B7K9C00",
    device_id=None,
    adapter_version="1.0.0",
    application_support="unknown",
    source_id=None,
    visibility="public",
    observed_at=NOW,
)


def test_T15_UNIT_html_to_text() -> None:
    html = (
        "<div><h2>About</h2><p>We build <b>payments</b>.<br>Join us</p>"
        "<ul><li>Go</li><li>SQL</li></ul>"
        "<script>alert(1)</script><style>p{}</style></div>"
    )
    assert html_to_text(html) == "About\nWe build payments.\nJoin us\n- Go\n- SQL"


@pytest.mark.parametrize(
    ("markup", "expected"),
    [
        (
            "<h3>Requirements</h3><ul><li>Go</li><li>SQL</li></ul><h3>Perks</h3><ul><li>Lunch</li></ul>",
            ["Go", "SQL"],
        ),
        ("<p><strong>Qualifications</strong></p><ul><li>BSc</li></ul>", ["BSc"]),
        ("<h4>Kualifikasi</h4><ol><li>S1</li><li>Jujur</li></ol>", ["S1", "Jujur"]),
        ("<p>Persyaratan:</p><ul><li>KTP</li></ul>", ["KTP"]),
        ("<h3>What you'll need</h3><ul><li>Curiosity</li></ul>", ["Curiosity"]),
        ("<h3>About</h3><ul><li>Not a requirement</li></ul>", []),
    ],
)
def test_T15_UNIT_requirements_under_heading(markup: str, expected: list[str]) -> None:
    assert requirements_from_html(markup) == expected


def test_T15_UNIT_requirements_from_plain_text_and_caps() -> None:
    assert requirements_from_text("Intro\nRequirements:\n- A\n* B\n2. C\nBenefits:\n- D") == [
        "A",
        "B",
        "C",
    ]
    many = (
        "<h3>Requirements</h3><ul>"
        + "".join(f"<li>{'x' * 600}{i}</li>" for i in range(60))
        + "</ul>"
    )
    items = requirements_from_html(many)
    assert len(items) == 50
    assert all(len(i) == 500 for i in items)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Jakarta, Indonesia", {"city": "Jakarta", "region": "DKI Jakarta", "country_code": "ID"}),
        ("Bandung, Jawa Barat", {"city": "Bandung", "region": "Jawa Barat", "country_code": "ID"}),
        (
            "San Francisco, CA",
            {"city": "San Francisco", "region": "California", "country_code": "US"},
        ),
        ("Boise, ID", {"city": "Boise", "region": "Idaho", "country_code": "US"}),
        ("London, UK", {"city": "London", "country_code": "GB"}),
        ("Remote (Indonesia)", {"country_code": "ID"}),
        ("Singapore", {"country_code": "SG"}),
        ("Berlin, Germany", {"city": "Berlin", "country_code": "DE"}),
    ],
)
def test_T15_UNIT_location_parsing(raw: str, expected: dict[str, str]) -> None:
    entry, _ = parse_location(raw)
    assert entry == {"raw": raw, **expected}


def test_T15_UNIT_location_splitting_and_remote() -> None:
    assert split_locations("Jakarta / Singapore; Remote | Bandung or Surabaya") == [
        "Jakarta",
        "Singapore",
        "Remote",
        "Bandung",
        "Surabaya",
    ]
    fields = normalize(PostingDraft(title="X", locations=["Remote - Worldwide"]), observed_at=NOW)
    assert fields.workplace_type == "remote"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("$120k–150k", {"min": 120000.0, "max": 150000.0, "currency": "USD"}),
        (
            "IDR 15.000.000 - 20.000.000 / bulan",
            {"min": 15e6, "max": 20e6, "currency": "IDR", "period": "month"},
        ),
        (
            "Rp 10 juta - 15 juta per bulan",
            {"min": 10e6, "max": 15e6, "currency": "IDR", "period": "month"},
        ),
        (
            "€50,000 - €60,000 a year",
            {"min": 50000.0, "max": 60000.0, "currency": "EUR", "period": "year"},
        ),
        (
            "SGD 6,000 - 8,000 monthly",
            {"min": 6000.0, "max": 8000.0, "currency": "SGD", "period": "month"},
        ),
        ("Up to $150k", {"max": 150000.0, "currency": "USD"}),
        ("Competitive", {}),
        ("10.000.000 - 12.000.000", {}),
    ],
)
def test_T15_UNIT_salary_from_text(text: str, expected: dict[str, Any]) -> None:
    assert parse_salary_text(text) == {**expected, "raw": text}


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("FullTime", "full_time"),
        ("full-time", "full_time"),
        ("Permanent", "full_time"),
        ("Penuh Waktu", "full_time"),
        ("Part-time", "part_time"),
        ("Contract", "contract"),
        ("Freelance", "contract"),
        ("Temporary", "temporary"),
        ("Internship", "internship"),
        ("Magang", "internship"),
        ("Volunteer", "volunteer"),
        ("Other", "unknown"),
    ],
)
def test_T15_UNIT_employment_vocabulary(value: str, expected: str) -> None:
    assert employment_of(value) == expected


@pytest.mark.parametrize(
    ("api", "title", "locations", "expected"),
    [
        ("OnSite", "Engineer", [], "onsite"),
        ("Hybrid", "Engineer", [], "hybrid"),
        (None, "Engineer (Hybrid)", [], "hybrid"),
        (None, "Engineer", ["Remote"], "remote"),
        (None, "Engineer", ["Jakarta"], "unknown"),
    ],
)
def test_T15_UNIT_workplace_mapping(
    api: str | None, title: str, locations: list[str], expected: str
) -> None:
    fields = normalize(
        PostingDraft(title=title, workplace_type=api, locations=locations), observed_at=NOW
    )
    assert fields.workplace_type == expected


@pytest.mark.parametrize(
    ("value", "expected", "relative"),
    [
        ("2026-10-01T10:00:00-04:00", 1790863200000, False),
        ("2026-10-03", 1790985600000, False),
        (1790500000000, 1790500000000, False),
        (1790500000, 1790500000000, False),
        ("Posted 3 Days Ago", NOW - 3 * DAY, True),
        ("Posted 30+ Days Ago", NOW - 30 * DAY, True),
        ("Posted Today", NOW, True),
        ("Posted Yesterday", NOW - DAY, True),
        ("2 minggu yang lalu", NOW - 14 * DAY, True),
        ("whenever", None, False),
    ],
)
def test_T15_UNIT_posted_at(value: Any, expected: int | None, relative: bool) -> None:
    assert parse_posted_at(value, observed_at=NOW) == (expected, relative)


def test_T15_UNIT_title_description_and_urls() -> None:
    fields = normalize(
        PostingDraft(
            title="  <b>Senior&nbsp;Engineer</b>  " + "x" * 400,
            company_name="Acme",
            description_html="<p>" + "é" * 40000 + "</p>",
            apply_url="/apply/1?utm_source=x&b=2&a=1",
            company_url="https://www.acme.co.id/about",
        ),
        observed_at=NOW,
        page_url="https://careers.acme.co.id/jobs/1",
    )
    assert fields.title.startswith("Senior Engineer")
    assert len(fields.title) == 300
    assert fields.description_truncated
    assert len(fields.description_text.encode()) <= 64 * 1024
    assert fields.apply_url == "https://careers.acme.co.id/apply/1?a=1&b=2"
    assert fields.apply_domain == "acme.co.id"
    assert fields.company_domain == "acme.co.id"


def _fields(**kw: Any) -> Any:
    draft = PostingDraft(
        **{
            "title": "Data Engineer",
            "company_name": "Acme",
            "description_text": "A sufficiently long description of the role for validation.",
            "apply_url": "https://acme.com/jobs/1",
            **kw,
        }
    )
    return normalize(draft, observed_at=NOW)


@pytest.mark.parametrize(
    ("change", "kind", "error"),
    [
        ({"title": ""}, "career_page", "parse_error"),
        ({"company_name": ""}, "greenhouse", "schema_invalid"),
        ({"apply_url": None}, "career_page", "parse_error"),
        ({"apply_url": "javascript:alert(1)"}, "career_page", "parse_error"),
        ({"apply_url": "http://acme.com/jobs/1"}, "greenhouse", "schema_invalid"),
        ({"posted_at": NOW + 3 * DAY}, "career_page", "parse_error"),
        ({"apply_url": "https://www.linkedin.com/jobs/view/1"}, "career_page", "policy_blocked"),
    ],
)
def test_T15_UNIT_validator_rejections(change: dict[str, Any], kind: str, error: str) -> None:
    method = "json_api" if kind == "greenhouse" else "json_ld"
    with pytest.raises(ItemRejected) as caught:
        validate(_fields(**change), source_kind=kind, method=method, now_ms=NOW)
    assert caught.value.error_class == error


def test_T15_UNIT_validator_flags_thin_and_http() -> None:
    flags = validate(
        _fields(description_text="short", apply_url="http://acme.com/j"),
        source_kind="custom_url",
        method="css",
        now_ms=NOW,
    )
    assert flags == ["http_url", "thin"]
    assert confidence_for("css", relocated=False, flags=flags, fields=_fields()) == 0.5


def test_T15_UNIT_confidence_ladder() -> None:
    fields = _fields(locations=["Jakarta"], posted_at="2026-10-01")
    assert confidence_for("json_api", relocated=False, flags=[], fields=fields) == 0.98
    assert confidence_for("json_api", relocated=False, flags=[], fields=_fields()) == 0.95
    assert confidence_for("json_ld", relocated=False, flags=[], fields=fields) == 0.9
    assert confidence_for("css", relocated=False, flags=[], fields=fields) == 0.8
    assert confidence_for("css", relocated=False, flags=["heuristic"], fields=fields) == 0.7
    assert confidence_for("css", relocated=True, flags=[], fields=fields) == 0.6


def _vector_cases() -> list[dict[str, Any]]:
    data = json.loads((VECTORS / "fingerprint.json").read_text("utf-8"))
    cases = []
    for case in data["cases"]:
        inp = case["input"]
        if inp["source_kind"] in ("manual", "email") or not inp["title"].strip():
            continue
        cases.append(case)
    return cases


@pytest.mark.parametrize("case", _vector_cases(), ids=lambda c: c["name"][:50])
def test_T15_UNIT_pipeline_reproduces_golden_fingerprints(case: dict[str, Any]) -> None:
    """Draft → normalize → build_item gives the server's fingerprint (20 §7 step 6)."""
    inp = case["input"]
    location = inp.get("location_primary")
    draft = PostingDraft(
        title=inp["title"],
        company_name="Acme",
        company_url=inp.get("company_domain"),
        structured_locations=[{"raw": location}] if location else [],
        apply_url=inp.get("apply_url"),
        canonical_url=inp.get("canonical_url"),
        description_text="A sufficiently long description so the item is not thin at all.",
    )
    fields = normalize(draft, observed_at=NOW)
    raw = RawPosting(
        adapter_id=inp["source_kind"],
        source_org=inp.get("source_org"),
        source_job_ref=inp.get("source_job_ref"),
        data={},
    )
    item = build_item(raw, fields, CTX, flags=[])
    assert item.fingerprint == case["fingerprint"]
    assert item.body["content_hash"] == content_hash(fields.title, fields.description_text)
    assert item.client_ref == client_ref_for(item.fingerprint)
    assert len(item.client_ref) == 64


def test_T15_UNIT_dedupe_group_and_unchanged_item_shape() -> None:
    fields = _fields(company_url="https://acme.com", locations=["Jakarta"])
    item = build_item(RawPosting("career_page", "acme.com", None, {}), fields, CTX, flags=[])
    assert item.body["dedupe_group"] == dedupe_group(
        title="Data Engineer", company_domain="acme.com", location_primary="Jakarta"
    )
    unchanged = item.unchanged_body(NOW)
    model("UnchangedPostingItem").model_validate(unchanged)
    assert set(unchanged) == {"client_ref", "fingerprint", "content_hash", "observed_at"}
    closed = unchanged_item(
        item.fingerprint,
        item.content_hash,
        NOW,
        status_hint="closed",
        evidence={"http_status": 404},
    )
    model("UnchangedPostingItem").model_validate(closed)


def test_T15_UNIT_cursor_state_roundtrip_and_lru() -> None:
    state = CursorState(
        {
            "v": 1,
            "listing": {"etag": 'W/"a"', "last_modified": None},
            "watermark_updated_at": 5,
            "detail_etags": {"x": "1"},
            "future_key": True,
        }
    )
    for i in range(DETAIL_ETAGS_MAX + 10):
        state.set_detail_etag(f"ref-{i}", f'"{i}"')
    assert len(state.detail_etags) == DETAIL_ETAGS_MAX
    assert "x" not in state.detail_etags
    state.advance_watermark(3)
    assert state.watermark == 5
    data = state.to_dict()
    assert data["future_key"] is True
    assert data["listing"]["etag"] == 'W/"a"'
    model("CursorState").model_validate(data)
