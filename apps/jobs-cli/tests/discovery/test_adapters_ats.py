"""Adapter contract tests for the ATS JSON APIs (15 §16), against recorded fixtures."""

from __future__ import annotations

import itertools
from typing import Any

import pytest
from werkzeug import Response

from pilih_jobs.adapters import lever as lever_module
from pilih_jobs.contracts.fingerprint import FingerprintInput, fingerprint
from pilih_jobs.contracts.index import model
from pilih_jobs.discovery.engine import ScraplingJobEngine
from pilih_jobs.discovery.types import TrackedPostingRef
from tests.discovery.support import Harness, Site, bodies, by_title, fixture_json, resolved


def _assert_contract(items: list[dict[str, Any]]) -> None:
    for item in items:
        name = "NormalizedPosting" if "title" in item else "UnchangedPostingItem"
        model(name).model_validate(item)


# ---------------------------------------------------------------- greenhouse
async def test_T15_ADAPTER_GREENHOUSE_board_normalized(
    ats: Site, engine: ScraplingJobEngine
) -> None:
    ats.json(
        "/v1/boards/acme/jobs", fixture_json("greenhouse/board.json"), headers={"ETag": 'W/"gh-1"'}
    )
    outcome = await Harness(engine).run(
        resolved("greenhouse", {"board_token": "acme"}, label="Acme (Greenhouse)")
    )
    assert outcome.stop is None
    assert outcome.complete
    items = by_title(outcome)
    assert set(items) == {
        "Senior Backend Engineer (Payments)",
        "Data Engineer",
        "Account Executive, Enterprise",
    }
    backend = items["Senior Backend Engineer (Payments)"]
    assert backend["source_kind"] == "greenhouse"
    assert backend["source_org"] == "acme"
    assert backend["source_job_ref"] == "4012345"
    assert backend["company_name"] == "Acme"
    assert backend["apply_url"] == "https://boards.greenhouse.io/acme/jobs/4012345"
    assert backend["apply_domain"] == "greenhouse.io"
    assert "company_domain" not in backend  # an ATS host is never the company's domain
    assert backend["locations"] == [
        {
            "raw": "Jakarta, Indonesia",
            "city": "Jakarta",
            "region": "DKI Jakarta",
            "country_code": "ID",
        }
    ]
    assert backend["department"] == "Engineering"
    assert backend["requirements"][0] == "5+ years building backend services in Go"
    assert "<" not in backend["description_text"]
    assert "payment APIs" in backend["description_text"]
    assert backend["extraction"]["method"] == "json_api"
    assert backend["extraction"]["confidence"] >= 0.95
    assert backend["fingerprint"] == fingerprint(
        FingerprintInput(
            source_kind="greenhouse", title="x", source_org="acme", source_job_ref="4012345"
        )
    )
    data = items["Data Engineer"]
    assert data["company_domain"] == "acme.com"  # absolute_url on the company's own site
    assert data["workplace_type"] == "remote"
    sales = items["Account Executive, Enterprise"]
    assert [loc["raw"] for loc in sales["locations"]] == ["Singapore", "Kuala Lumpur"]
    _assert_contract(bodies(outcome))
    assert outcome.source.cursor.listing_etag == 'W/"gh-1"'


async def test_T15_ADAPTER_GREENHOUSE_shape_change_is_schema_invalid(
    ats: Site, engine: ScraplingJobEngine
) -> None:
    ats.json("/v1/boards/acme/jobs", {"postings": []})
    outcome = await Harness(engine).run(resolved("greenhouse", {"board_token": "acme"}))
    assert outcome.stop is not None
    assert outcome.stop.error_class == "schema_invalid"
    assert not outcome.complete


async def test_T15_ADAPTER_GREENHOUSE_unknown_board_is_source_closed(
    ats: Site, engine: ScraplingJobEngine
) -> None:
    ats.status("/v1/boards/gone/jobs", 404)
    outcome = await Harness(engine).run(resolved("greenhouse", {"board_token": "gone"}))
    assert outcome.stop is not None
    assert outcome.stop.error_class == "source_closed"


async def test_T15_ADAPTER_GREENHOUSE_check_open(ats: Site, engine: ScraplingJobEngine) -> None:
    import asyncio

    from pilih_jobs.adapters import get_adapter
    from pilih_jobs.adapters.base import AdapterContext
    from pilih_jobs.discovery.cursor import CursorState

    ats.json("/v1/boards/acme/jobs/1", {"id": 1})
    ats.status(
        "/v1/boards/acme/jobs/2", 404, body='{"status":404}', content_type="application/json"
    )
    adapter = get_adapter("greenhouse")
    cfg = {"board_token": "acme"}
    ctx = AdapterContext(
        engine, "run", adapter.source_ref(cfg), CursorState(), asyncio.Event(), lambda _e: None
    )

    def ref(job: str) -> TrackedPostingRef:
        return TrackedPostingRef(
            "pst_x", "fp1:" + "0" * 64, "0" * 64, "greenhouse", "acme", job, None, None
        )

    assert (await adapter.check_open(ctx, ref("1"))).status == "open"
    closed = await adapter.check_open(ctx, ref("2"))
    assert closed.status == "closed"
    assert closed.http_status == 404
    assert closed.marker == "greenhouse_job_gone"


def _ctx(engine: ScraplingJobEngine, adapter_id: str, cfg: dict[str, Any]) -> Any:
    import asyncio

    from pilih_jobs.adapters import get_adapter
    from pilih_jobs.adapters.base import AdapterContext
    from pilih_jobs.discovery.cursor import CursorState

    adapter = get_adapter(adapter_id)
    return adapter, AdapterContext(
        engine, "run", adapter.source_ref(cfg), CursorState(), asyncio.Event(), lambda _e: None
    )


def _ref(kind: str, org: str, job: str, **kw: Any) -> TrackedPostingRef:
    return TrackedPostingRef(
        "pst_x",
        "fp1:" + "0" * 64,
        "0" * 64,
        kind,
        org,
        job,
        kw.get("apply"),
        kw.get("canonical"),
        source_config=kw.get("config"),
    )


# ---------------------------------------------------------------- lever
async def test_T15_ADAPTER_LEVER_offset_pagination_and_fields(
    ats: Site, engine: ScraplingJobEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lever_module, "PAGE_SIZE", 2)
    ats.json(
        "/v0/postings/acme",
        fixture_json("lever/page1.json"),
        query_string="mode=json&skip=0&limit=2",
    )
    ats.json(
        "/v0/postings/acme",
        fixture_json("lever/page2.json"),
        query_string="mode=json&skip=2&limit=2",
    )
    outcome = await Harness(engine).run(resolved("lever", {"site": "acme"}, label="Acme"))
    assert outcome.stop is None
    assert outcome.complete
    assert outcome.stats.pages == 2
    items = by_title(outcome)
    assert set(items) == {"Frontend Engineer", "Product Designer", "Engineering Intern"}
    fe = items["Frontend Engineer"]
    assert fe["salary"] == {
        "min": 25000000.0,
        "max": 35000000.0,
        "currency": "IDR",
        "period": "month",
        "raw": "Base salary range for Jakarta.",
    }
    assert fe["workplace_type"] == "hybrid"
    assert fe["employment_type"] == "full_time"
    assert fe["locations"][0]["country_code"] == "ID"
    assert fe["requirements"] == [
        "3+ years of professional experience",
        "Comfortable with TypeScript and React",
    ]
    assert fe["apply_url"].endswith("/apply")
    assert fe["canonical_url"].startswith("https://jobs.lever.co/acme/")
    assert fe["posted_at"] == 1790500000000 + 86400000
    intern = items["Engineering Intern"]
    assert intern["employment_type"] == "internship"
    assert intern["workplace_type"] == "remote"
    _assert_contract(bodies(outcome))


async def test_T15_ADAPTER_LEVER_filters_and_eu_region(
    ats: Site, engine: ScraplingJobEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lever_module, "PAGE_SIZE", 2)
    ats.json(
        "/v0/postings/acme", [], query_string="mode=json&skip=0&limit=2&location=Jakarta&team=Web"
    )
    source = resolved(
        "lever", {"site": "acme", "region": "eu", "filters": {"location": "Jakarta", "team": "Web"}}
    )
    outcome = await Harness(engine).run(source)
    assert outcome.stop is None
    assert outcome.complete
    assert outcome.stats.found == 0


async def test_T15_ADAPTER_LEVER_page_cap_is_incomplete(
    ats: Site, engine: ScraplingJobEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lever_module, "PAGE_SIZE", 2)
    ats.json(
        "/v0/postings/acme",
        fixture_json("lever/page1.json"),
        query_string="mode=json&skip=0&limit=2",
    )
    outcome = await Harness(engine).run(resolved("lever", {"site": "acme"}), max_pages=1)
    assert outcome.stats.found == 2
    assert not outcome.complete


async def test_T15_ADAPTER_LEVER_check_open_404(ats: Site, engine: ScraplingJobEngine) -> None:
    ats.status("/v0/postings/acme/gone", 404)
    ats.json("/v0/postings/acme/live", {"id": "live"})
    adapter, ctx = _ctx(engine, "lever", {"site": "acme"})
    assert (await adapter.check_open(ctx, _ref("lever", "acme", "gone"))).marker == "lever_404"
    assert (await adapter.check_open(ctx, _ref("lever", "acme", "live"))).status == "open"


# ---------------------------------------------------------------- ashby
async def test_T15_ADAPTER_ASHBY_skips_unlisted_and_maps_compensation(
    ats: Site, engine: ScraplingJobEngine
) -> None:
    ats.json("/posting-api/job-board/ramp-id", fixture_json("ashby/board.json"))
    outcome = await Harness(engine).run(
        resolved("ashby", {"job_board_name": "ramp-id"}, label="Ramp")
    )
    items = by_title(outcome)
    assert set(items) == {"Product Manager, Expenses", "Staff Software Engineer"}
    pm = items["Product Manager, Expenses"]
    assert pm["salary"]["min"] == 40000000.0
    assert pm["salary"]["currency"] == "IDR"
    assert pm["salary"]["period"] == "month"
    assert pm["workplace_type"] == "hybrid"
    assert pm["employment_type"] == "full_time"
    assert pm["locations"][0] == {
        "raw": "Jakarta",
        "city": "Jakarta Selatan",
        "region": "DKI Jakarta",
        "country_code": "ID",
    }
    assert pm["requirements"] == ["Product sense", "4+ years of experience"]
    assert pm["company_name"] == "Ramp"
    from pilih_jobs.discovery.normalize import parse_iso_ms

    assert outcome.watermark == parse_iso_ms("2026-10-02T08:00:00.000+00:00")  # max publishedAt
    _assert_contract(bodies(outcome))


async def test_T15_ADAPTER_ASHBY_check_open_unlisted_and_absent(
    ats: Site, engine: ScraplingJobEngine
) -> None:
    ats.json("/posting-api/job-board/ramp-id", fixture_json("ashby/board.json"))
    adapter, ctx = _ctx(engine, "ashby", {"job_board_name": "ramp-id"})
    listed = await adapter.check_open(
        ctx, _ref("ashby", "ramp-id", "a1b2c3d4-0000-4000-8000-000000000001")
    )
    unlisted = await adapter.check_open(
        ctx, _ref("ashby", "ramp-id", "a1b2c3d4-0000-4000-8000-000000000003")
    )
    absent = await adapter.check_open(ctx, _ref("ashby", "ramp-id", "nope"))
    assert listed.status == "open"
    assert (unlisted.status, unlisted.marker) == ("closed", "ashby_unlisted")
    assert (absent.status, absent.marker) == ("closed", "ashby_absent")
    assert len(ats.hits("/posting-api/")) == 1  # one board read per run


# ---------------------------------------------------------------- smartrecruiters
def _sr(ats: Site) -> None:
    ats.json(
        "/v1/companies/BoschGroup/postings",
        fixture_json("smartrecruiters/page1.json"),
        query_string="limit=100&offset=0",
    )
    ats.json(
        "/v1/companies/BoschGroup/postings",
        fixture_json("smartrecruiters/page2.json"),
        query_string="limit=100&offset=2",
    )
    for pid in ("743999912345678", "743999912345679", "743999912345680"):
        ats.json(
            f"/v1/companies/BoschGroup/postings/{pid}",
            fixture_json(f"smartrecruiters/detail_{pid}.json"),
            headers={"ETag": f'"sr-{pid}"'},
        )


async def test_T15_ADAPTER_SMARTRECRUITERS_offset_pagination_with_details(
    ats: Site, engine: ScraplingJobEngine
) -> None:
    _sr(ats)
    outcome = await Harness(engine).run(
        resolved("smartrecruiters", {"company_identifier": "BoschGroup"})
    )
    assert outcome.stop is None
    assert outcome.complete
    assert outcome.stats.pages == 2
    assert outcome.stats.detail_fetches == 3
    items = by_title(outcome)
    embedded = items["Embedded Software Engineer"]
    assert embedded["company_name"] == "Bosch Group"
    assert embedded["locations"][0]["country_code"] == "ID"
    assert embedded["locations"][0]["city"] == "Bandung"
    assert embedded["seniority"] == "Mid-Senior Level"
    assert embedded["workplace_type"] == "onsite"
    assert embedded["requirements"][1] == "Solid C/C++ knowledge"
    assert embedded["apply_url"].endswith("?oga=true")
    assert items["Working Student Data Analytics"]["employment_type"] == "internship"
    assert outcome.source.cursor.detail_etag("743999912345678") == '"sr-743999912345678"'
    _assert_contract(bodies(outcome))


async def test_T15_ADAPTER_SMARTRECRUITERS_keyless_denied_stops(
    ats: Site, engine: ScraplingJobEngine
) -> None:
    ats.status(
        "/v1/companies/Private/postings",
        401,
        body='{"message":"api key required"}',
        content_type="application/json",
    )
    outcome = await Harness(engine).run(
        resolved("smartrecruiters", {"company_identifier": "Private"})
    )
    assert outcome.stop is not None
    assert outcome.stop.error_class == "access_denied"
    assert len(ats.hits("/v1/companies/Private")) == 1  # never retried


# ---------------------------------------------------------------- workable
def _workable(ats: Site) -> None:
    ats.json("/api/v1/widget/accounts/tokopedia", fixture_json("workable/account.json"))
    for code in ("A1B2C3D4E5", "F6G7H8I9J0"):
        ats.json(
            f"/api/v1/widget/accounts/tokopedia/jobs/{code}",
            fixture_json(f"workable/job_{code}.json"),
        )


async def test_T15_ADAPTER_WORKABLE_widget_and_details(
    ats: Site, engine: ScraplingJobEngine
) -> None:
    _workable(ats)
    outcome = await Harness(engine).run(resolved("workable", {"subdomain": "tokopedia"}))
    items = by_title(outcome)
    android = items["Android Developer"]
    assert android["company_name"] == "Tokopedia"
    assert android["workplace_type"] == "onsite"
    assert android["requirements"] == [
        "2+ years of relevant experience",
        "Excellent communication in Bahasa Indonesia and English",
    ]
    from pilih_jobs.discovery.normalize import parse_iso_ms

    assert android["posted_at"] == parse_iso_ms("2026-10-03")
    csm = items["Customer Success Manager"]
    assert csm["employment_type"] == "contract"
    assert csm["workplace_type"] == "remote"
    _assert_contract(bodies(outcome))


async def test_T15_ADAPTER_WORKABLE_shape_drift_stops_source(
    ats: Site, engine: ScraplingJobEngine
) -> None:
    ats.json("/api/v1/widget/accounts/tokopedia", {"name": "Tokopedia", "positions": []})
    outcome = await Harness(engine).run(resolved("workable", {"subdomain": "tokopedia"}))
    assert outcome.stop is not None
    assert outcome.stop.error_class == "schema_invalid"


# ---------------------------------------------------------------- workday
WD_CFG = {"tenant": "nvidia", "wd_host_number": 5, "site": "NVIDIAExternalCareerSite"}


def _workday(ats: Site) -> None:
    base = "/wday/cxs/nvidia/NVIDIAExternalCareerSite"
    pages = [fixture_json("workday/jobs_page1.json"), fixture_json("workday/jobs_page2.json")]

    def jobs(request: Any) -> Response:
        offset = (request.get_json() or {}).get("offset", 0)
        return Response(
            __import__("json").dumps(pages[0] if offset == 0 else pages[1]),
            content_type="application/json",
        )

    ats.handle(f"{base}/jobs", jobs, method="POST")
    for req, path in (
        ("JR1987654", "/job/Jakarta/Systems-Software-Engineer_JR1987654"),
        ("JR1987655", "/job/Jakarta/Solutions-Architect_JR1987655"),
        ("JR1987656", "/job/Singapore/Deep-Learning-Engineer_JR1987656"),
    ):
        ats.json(f"{base}{path}", fixture_json(f"workday/detail_{req}.json"))


async def test_T15_ADAPTER_WORKDAY_post_pagination_details_and_relative_dates(
    ats: Site, engine: ScraplingJobEngine, vclock: Any
) -> None:
    _workday(ats)
    observed = 1_791_770_000_000
    outcome = await Harness(engine).run(
        resolved("workday", WD_CFG, source_id="src_01JA6V8M3W8Z1T6Q4Y2B7K9C01"),
        now_ms=lambda: observed,
    )
    assert outcome.stop is None
    assert outcome.complete
    assert outcome.stats.pages == 2
    items = by_title(outcome)
    sse = items["Systems Software Engineer"]
    assert sse["source_job_ref"] == "JR1987654"
    assert sse["source_org"] == "nvidia/NVIDIAExternalCareerSite"
    assert sse["posted_at"] == observed - 3 * 86_400_000
    assert "posted_at_relative" in sse["extraction"]["flags"]
    assert sse["company_name"] == "NVIDIA"
    assert sse["locations"][0]["country_code"] == "ID"
    assert sse["requirements"] == ["BS or MS in Computer Science", "Strong C++ and Linux skills"]
    assert items["Solutions Architect"]["posted_at"] == observed - 86_400_000
    # one request at a time with ≥ 3 s between request starts (manifest min_delay_ms)
    starts = [r.start for r in engine.scheduler.history if not r.html]
    gaps = [b - a for a, b in itertools.pairwise(starts)]
    assert gaps
    assert min(gaps) >= 3.0
    posts = [h for h in ats.log if h[0] == "POST"]
    assert {h[2].get("Content-Type") for h in posts} == {"application/json"}
    _assert_contract(bodies(outcome))


async def test_T15_ADAPTER_WORKDAY_requires_opt_in(ats: Site) -> None:
    from pilih_jobs.adapters import get_adapter
    from pilih_jobs.discovery.errors import PolicyViolation
    from pilih_jobs.discovery.sources import adhoc_config

    with pytest.raises(PolicyViolation):
        adhoc_config("workday", "nvidia", private=False)
    with pytest.raises(PolicyViolation, match="disabled"):
        get_adapter("workday").validate_config({**WD_CFG, "disabled_reason": "access_denied"})
    assert ats.log == []


async def test_T15_ADAPTER_WORKDAY_rate_limit_stops_without_retry(
    ats: Site, engine: ScraplingJobEngine
) -> None:
    ats.status(
        "/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs",
        429,
        headers={"Retry-After": "5"},
        method="POST",
    )
    outcome = await Harness(engine).run(resolved("workday", WD_CFG))
    assert outcome.stop is not None
    assert outcome.stop.error_class == "rate_limited"
    assert len([h for h in ats.log if h[0] == "POST"]) == 1


async def test_T15_ADAPTER_WORKDAY_check_open(ats: Site, engine: ScraplingJobEngine) -> None:
    _workday(ats)
    adapter, ctx = _ctx(engine, "workday", WD_CFG)
    live = _ref(
        "workday",
        "nvidia/NVIDIAExternalCareerSite",
        "JR1987654",
        config=WD_CFG,
        apply="https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Jakarta/Systems-Software-Engineer_JR1987654",
    )
    gone = _ref(
        "workday",
        "nvidia/NVIDIAExternalCareerSite",
        "JR1",
        config=WD_CFG,
        apply="https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Jakarta/Old_JR1",
    )
    assert (await adapter.check_open(ctx, live)).status == "open"
    assert (await adapter.check_open(ctx, gone)).marker == "workday_404"
