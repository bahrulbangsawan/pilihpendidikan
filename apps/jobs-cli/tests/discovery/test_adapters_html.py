"""Adapter contract tests for careers pages, generic listings and single URLs (15 §14.3)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import anyio
import pytest

from pilih_jobs.contracts.index import model
from pilih_jobs.discovery.engine import ScraplingJobEngine
from pilih_jobs.discovery.engine.crawler import CHECKPOINT_FILE, MARKER_FILE, prepare_crawl_dir
from pilih_jobs.discovery.errors import DiscoveryError, ExcludedSourceError
from pilih_jobs.discovery.types import TrackedPostingRef
from tests.discovery.support import (
    Harness,
    Site,
    VirtualClock,
    bodies,
    by_title,
    fixture_json,
    fixture_text,
    make_engine,
    resolved,
)

CSS_FIELDS = {
    "title": ".opening-link",
    "url": ".opening-link",
    "location": ".opening-location",
    "department": ".opening-dept",
}


def _contract(items: list[dict[str, Any]]) -> None:
    for item in items:
        model("NormalizedPosting").model_validate(item)


@pytest.fixture
def fast_spider(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """The spider's own `download_delay` sleeps are recorded instead of waited for."""
    recorded: list[float] = []
    real = anyio.sleep

    async def sleep(delay: float = 0, *args: Any, **kwargs: Any) -> None:
        if delay >= 0.5:
            recorded.append(delay)
            await real(0)
        else:
            await real(delay)

    monkeypatch.setattr(anyio, "sleep", sleep)
    return recorded


# ---------------------------------------------------------------- career_page
async def test_T15_ADAPTER_CAREER_PAGE_json_ld_first(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.html("/karir", fixture_text("career_page/jsonld_listing.html"), headers={"ETag": '"cp-1"'})
    outcome = await Harness(engine).run(resolved("career_page", {"url": site.url("/karir")}))
    assert outcome.stop is None
    assert outcome.complete
    items = by_title(outcome)
    finance = items["Staf Keuangan"]
    assert finance["company_name"] == "Acme Indonesia"
    assert finance["company_domain"] == "acme.co.id"
    assert finance["salary"] == {
        "min": 8000000.0,
        "max": 10000000.0,
        "currency": "IDR",
        "period": "month",
    }
    assert finance["locations"][0]["region"] == "Jawa Timur"
    assert finance["locations"][0]["country_code"] == "ID"
    assert finance["requirements"] == ["S1 Akuntansi", "Menguasai Excel"]
    assert finance["source_job_ref"] == "FIN-201"
    assert finance["apply_url"] == site.url("/careers/jobs/201")
    assert finance["extraction"]["method"] == "json_ld"
    assert finance["extraction"]["confidence"] == 0.9
    assert "http_url" in finance["extraction"]["flags"]
    assert items["Customer Service Officer"]["employment_type"] == "part_time"
    assert outcome.source.cursor.listing_etag == '"cp-1"'
    _contract(bodies(outcome))


async def test_T15_ADAPTER_CAREER_PAGE_selectors_pagination_and_details(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.html("/careers", fixture_text("career_page/css_listing_p1.html"), query_string="")
    site.html("/careers", fixture_text("career_page/css_listing_p2.html"), query_string="page=2")
    for job in (101, 102, 103):
        site.html(f"/careers/jobs/{job}", fixture_text(f"career_page/job_{job}.html"))
    source = resolved(
        "career_page",
        {"url": site.url("/careers"), "item_css": "li.opening", "fields": CSS_FIELDS},
        label="Acme",
    )
    outcome = await Harness(engine).run(source)
    assert outcome.stop is None
    assert outcome.complete
    assert outcome.stats.pages == 2
    items = by_title(outcome)
    assert set(items) == {"Finance Staff", "Warehouse Supervisor", "IT Support Specialist"}
    finance = items["Finance Staff"]
    assert finance["requirements"] == [
        "Bachelor in Accounting",
        "2 years of experience",
    ]  # detail JSON-LD
    assert finance["department"] == "Finance"
    warehouse = items["Warehouse Supervisor"]
    assert warehouse["extraction"]["method"] == "css"
    assert warehouse["extraction"]["confidence"] == 0.8
    assert "stock accuracy" in warehouse["description_text"]
    assert warehouse["locations"][0]["region"] == "Jawa Barat"
    assert warehouse["company_name"] == "Acme"
    assert outcome.stats.detail_fetches == 3
    _contract(bodies(outcome))


async def test_T15_ADAPTER_CAREER_PAGE_redirects_ats_board_link(
    ats: Site, engine: ScraplingJobEngine
) -> None:
    ats.html("/join", fixture_text("career_page/ats_link.html"))
    ats.json("/v1/boards/acme/jobs", fixture_json("greenhouse/board.json"))
    outcome = await Harness(engine).run(resolved("career_page", {"url": ats.url("/join")}))
    assert outcome.stop is None
    assert outcome.complete
    assert outcome.kind == "greenhouse"
    assert outcome.org == "acme"
    assert {b["source_kind"] for b in bodies(outcome)} == {"greenhouse"}
    assert len(bodies(outcome)) == 3


async def test_T15_ADAPTER_CAREER_PAGE_ats_url_redirects_without_fetching_the_page(
    ats: Site, engine: ScraplingJobEngine
) -> None:
    ats.json("/v1/boards/acme/jobs", fixture_json("greenhouse/board.json"))
    outcome = await Harness(engine).run(
        resolved("career_page", {"url": "https://boards.greenhouse.io/acme"})
    )
    assert outcome.kind == "greenhouse"
    assert len(bodies(outcome)) == 3


async def test_T15_ADAPTER_CAREER_PAGE_workday_link_is_not_followed(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.html("/careers", fixture_text("career_page/workday_link.html"))
    outcome = await Harness(engine).run(resolved("career_page", {"url": site.url("/careers")}))
    assert outcome.stop is not None
    assert outcome.stop.error_class == "unsupported_content"


async def test_T15_ADAPTER_CAREER_PAGE_no_data_is_unsupported_without_escalation(
    tmp_path: Path, site: Site, vclock: VirtualClock
) -> None:
    site.html("/careers", fixture_text("career_page/empty.html"))
    engine = make_engine(tmp_path, vclock)  # browser discovery disabled globally
    try:
        outcome = await Harness(engine).run(
            resolved(
                "career_page",
                {"url": site.url("/careers"), "allow_browser": True},
                allow_browser=True,
            )
        )
    finally:
        await engine.aclose()
    assert outcome.stop is not None
    assert outcome.stop.error_class == "unsupported_content"
    assert {r.mode for r in engine.requests} == {
        "json_api",
        "static_html",
    }  # robots + page; no browser


# ---------------------------------------------------------------- generic_listing
def _clinic(site: Site, *, sitemap: bool = False) -> None:
    robots = "User-agent: *\nAllow: /\n"
    if sitemap:
        robots += f"Sitemap: {site.url('/sitemap.xml')}\n"
    site.server.clear_all_handlers()
    site.robots(robots)
    site.html("/openings", fixture_text("generic_listing/index.html"), query_string="")
    site.html("/openings", fixture_text("generic_listing/page2.html"), query_string="page=2")
    for job in "abcd":
        site.html(f"/jobs/{job}", fixture_text(f"generic_listing/job_{job}.html"))
    if sitemap:
        xml = (
            '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            f"<url><loc>{site.url('/jobs/a')}</loc></url><url><loc>{site.url('/jobs/d')}</loc></url>"
            f"<url><loc>{site.url('/about')}</loc></url></urlset>"
        )
        site.handle(
            "/sitemap.xml",
            lambda _r: __import__("werkzeug").Response(xml, content_type="application/xml"),
        )


GL_CFG = {"detail_url_pattern": r"/jobs/[a-z]+$", "max_pages": 10}


async def test_T15_ADAPTER_GENERIC_LISTING_spider_follows_listing_and_details(
    site: Site, engine: ScraplingJobEngine, fast_spider: list[float]
) -> None:
    _clinic(site)
    source = resolved(
        "generic_listing", {"start_url": site.url("/openings"), **GL_CFG}, label="Klinik Sehat"
    )
    outcome = await Harness(engine).run(source)
    assert outcome.stop is None, outcome.stop
    items = by_title(outcome)
    assert set(items) == {"Perawat (Nurse)", "Apoteker", "Dokter Umum"}
    assert outcome.stats.pages == 2
    assert outcome.complete
    assert items["Perawat (Nurse)"]["company_name"] == "Klinik Sehat"
    assert items["Perawat (Nurse)"]["company_domain"] == "kliniksehat.co.id"
    apoteker = items["Apoteker"]
    assert apoteker["requirements"] == ["STRA aktif", "Pengalaman 1 tahun"]
    assert apoteker["extraction"]["confidence"] <= 0.7
    assert "heuristic" in apoteker["extraction"]["flags"]
    assert not any("partner.example.org" in b.get("apply_url", "") for b in bodies(outcome))
    assert fast_spider
    assert min(fast_spider) >= 2.0
    _contract(bodies(outcome))


async def test_T15_ADAPTER_GENERIC_LISTING_uses_sitemap(
    site: Site, engine: ScraplingJobEngine, fast_spider: list[float]
) -> None:
    _clinic(site, sitemap=True)
    outcome = await Harness(engine).run(
        resolved("generic_listing", {"start_url": site.url("/openings"), **GL_CFG})
    )
    assert "Bidan" in by_title(outcome)  # only listed in the sitemap


async def test_T15_ADAPTER_GENERIC_LISTING_page_cap_marks_incomplete(
    site: Site, engine: ScraplingJobEngine, fast_spider: list[float]
) -> None:
    _clinic(site)
    cfg = {
        "start_url": site.url("/openings"),
        "detail_url_pattern": r"/jobs/[a-z]+$",
        "max_pages": 1,
    }
    outcome = await Harness(engine).run(resolved("generic_listing", cfg))
    assert "Dokter Umum" not in by_title(outcome)
    assert not outcome.complete


async def test_T15_ADAPTER_GENERIC_LISTING_access_denied_stops_crawl(
    site: Site, engine: ScraplingJobEngine, fast_spider: list[float]
) -> None:
    site.robots("User-agent: *\nAllow: /\n")
    site.html("/openings", fixture_text("generic_listing/index.html"))
    site.status("/jobs/a", 403)
    site.status("/jobs/b", 403)
    outcome = await Harness(engine).run(
        resolved("generic_listing", {"start_url": site.url("/openings"), **GL_CFG})
    )
    assert outcome.stop is not None
    assert outcome.stop.error_class == "access_denied"
    assert not outcome.complete


async def test_T15_ADAPTER_GENERIC_LISTING_checkpoints_only_trusted(tmp_path: Path) -> None:
    root = tmp_path / "data" / "crawls"
    crawl = root / "src_01JA6V8M3W8Z1T6Q4Y2B7K9C00"
    crawl.mkdir(parents=True)
    (crawl / CHECKPOINT_FILE).write_bytes(b"not a pickle we wrote")
    _directory, resuming = prepare_crawl_dir(root, crawl, start_url="https://x.test/jobs")
    assert not resuming
    assert not (crawl / CHECKPOINT_FILE).exists()
    (crawl / CHECKPOINT_FILE).write_bytes(b"checkpoint")
    _, resuming = prepare_crawl_dir(root, crawl, start_url="https://x.test/jobs")
    assert resuming  # same CLI major, same start URL
    marker = __import__("json").loads((crawl / MARKER_FILE).read_text())
    marker["cli_major"] = "99"
    (crawl / MARKER_FILE).write_text(__import__("json").dumps(marker))
    _, resuming = prepare_crawl_dir(root, crawl, start_url="https://x.test/jobs")
    assert not resuming
    assert not (crawl / CHECKPOINT_FILE).exists()
    with pytest.raises(DiscoveryError):
        prepare_crawl_dir(root, tmp_path / "elsewhere", start_url="https://x.test/jobs")
    link = root / "src_01JA6V8M3W8Z1T6Q4Y2B7K9C01"
    link.symlink_to(tmp_path)
    with pytest.raises(DiscoveryError):
        prepare_crawl_dir(root, link, start_url="https://x.test/jobs")


async def test_T15_ADAPTER_GENERIC_LISTING_writes_checkpoints_in_crawl_dir(
    tmp_path: Path, site: Site, engine: ScraplingJobEngine, fast_spider: list[float]
) -> None:
    _clinic(site)
    crawl = engine.crawl_root / "src_01JA6V8M3W8Z1T6Q4Y2B7K9C00"
    harness = Harness(engine, crawl_dir=crawl)
    outcome = await harness.run(
        resolved(
            "generic_listing",
            {"start_url": site.url("/openings"), **GL_CFG},
            source_id="src_01JA6V8M3W8Z1T6Q4Y2B7K9C00",
        )
    )
    assert len(bodies(outcome)) == 3
    assert outcome.complete
    assert crawl.is_dir()
    assert not (crawl / CHECKPOINT_FILE).exists()


# ---------------------------------------------------------------- custom_url
async def test_T15_ADAPTER_CUSTOM_URL_json_ld(site: Site, engine: ScraplingJobEngine) -> None:
    site.html("/jobs/backend", fixture_text("custom_url/jsonld_job.html"))
    outcome = await Harness(engine).run(resolved("custom_url", {"url": site.url("/jobs/backend")}))
    (item,) = bodies(outcome)
    assert item["title"] == "Backend Engineer"
    assert item["company_name"] == "Hijau Tech"
    assert item["company_domain"] == "hijau.tech"
    assert item["workplace_type"] == "remote"
    assert item["salary"]["currency"] == "USD"
    assert item["salary"]["period"] == "month"
    assert item["requirements"] == ["3+ years of Python", "Ownership mindset"]
    assert item["locations"][0]["country_code"] == "ID"
    _contract([item])


async def test_T15_ADAPTER_CUSTOM_URL_heuristics_and_private(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.html("/barista", fixture_text("custom_url/heuristic_job.html"))
    source = resolved(
        "custom_url", {"url": site.url("/barista"), "private": True}, visibility="private"
    )
    outcome = await Harness(engine).run(source)
    (item,) = bodies(outcome)
    assert item["title"] == "Barista"
    assert item["company_name"] == "Kopi Kenangan"
    assert item["visibility"] == "private"
    assert item["requirements"] == ["Ramah", "Bisa bekerja shift"]
    assert "heuristic" in item["extraction"]["flags"]
    assert item["extraction"]["confidence"] <= 0.7


def test_T15_ADAPTER_CUSTOM_URL_refuses_excluded_hosts() -> None:
    from pilih_jobs.adapters import get_adapter

    adapter = get_adapter("custom_url")
    for url in ("https://www.linkedin.com/jobs/view/123", "https://id.indeed.com/viewjob?jk=1"):
        with pytest.raises(ExcludedSourceError):
            adapter.validate_config({"url": url})


async def test_T15_ADAPTER_CAREER_PAGE_check_open_markers(
    site: Site, engine: ScraplingJobEngine
) -> None:
    import asyncio

    from pilih_jobs.adapters import get_adapter
    from pilih_jobs.adapters.base import AdapterContext
    from pilih_jobs.discovery.cursor import CursorState

    site.html("/c/closed", fixture_text("career_page/closed_job.html"))
    site.html("/c/expired", fixture_text("career_page/expired_job.html"))
    site.html("/c/open", fixture_text("career_page/open_job.html"))
    adapter = get_adapter("career_page")
    cfg = {"url": site.url("/c")}
    ctx = AdapterContext(
        engine, "run", adapter.source_ref(cfg), CursorState(), asyncio.Event(), lambda _e: None
    )

    async def check(path: str) -> Any:
        return await adapter.check_open(
            ctx,
            TrackedPostingRef(
                "pst_x",
                "fp1:" + "0" * 64,
                "0" * 64,
                "career_page",
                None,
                None,
                None,
                site.url(path),
            ),
        )

    closed = await check("/c/closed")
    assert closed.status == "closed"
    assert "no longer accepting applications" in (closed.marker or "")
    assert (await check("/c/expired")).marker == "valid_through_past"
    assert (await check("/c/open")).status == "open"
    gone = await check("/c/missing")
    assert gone.status == "closed"
    assert gone.http_status == 404
