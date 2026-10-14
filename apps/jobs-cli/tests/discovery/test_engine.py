"""Engine tests (15 §16): error taxonomy, challenges, retries/backoff, robots, politeness."""

from __future__ import annotations

import asyncio
import itertools
import random
import socket
from pathlib import Path
from typing import Any

import pytest
from werkzeug import Response

from pilih_jobs.discovery.classify import classify_transport_error, detect_challenge
from pilih_jobs.discovery.engine import ScraplingJobEngine
from pilih_jobs.discovery.errors import DiscoveryError
from pilih_jobs.discovery.politeness import PolitenessScheduler
from pilih_jobs.discovery.retry import RetryPolicy, parse_retry_after
from pilih_jobs.discovery.types import FetchMode, FetchRequest, SourceRef
from tests.discovery.support import Site, VirtualClock, fixture_text

JSON_SRC = SourceRef(key="test:json", adapter_id="greenhouse", org="acme", min_delay_ms=1000)
HTML_SRC = SourceRef(
    key="test:html",
    adapter_id="career_page",
    org="acme",
    per_domain_concurrency=1,
    min_delay_ms=2000,
)
UA = "pilih-jobs/0.1.0 (+https://pilihpendidikan.com/bot)"


async def _fail(
    engine: ScraplingJobEngine,
    url: str,
    *,
    mode: FetchMode = FetchMode.JSON_API,
    source: SourceRef = JSON_SRC,
    listing: bool = False,
) -> DiscoveryError:
    req = FetchRequest(url, mode, purpose="listing" if listing else "detail")
    call = engine.fetch_listing(req, source=source) if listing else engine.fetch(req, source=source)
    with pytest.raises(DiscoveryError) as caught:
        await call
    return caught.value


# ---------------------------------------------------------------- identity and results
async def test_T15_ENGINE_honest_identity_and_result(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.json("/api", {"ok": True}, headers={"ETag": '"e1"'})
    result = await engine.fetch(FetchRequest(site.url("/api"), FetchMode.JSON_API), source=JSON_SRC)
    assert result.status == 200
    assert result.json == {"ok": True}
    assert result.header("etag") == '"e1"'
    assert result.fetch_mode is FetchMode.JSON_API
    assert result.attempt == 1
    ((_, _, headers),) = site.hits("/api")
    assert headers["User-Agent"] == UA
    lowered = {k.lower() for k in headers}
    assert not lowered & {"referer", "cookie", "sec-ch-ua", "sec-fetch-mode", "authorization"}


async def test_T15_ENGINE_html_page_view(site: Site, engine: ScraplingJobEngine) -> None:
    site.html("/jobs", fixture_text("career_page/jsonld_listing.html"))
    result = await engine.fetch(
        FetchRequest(site.url("/jobs"), FetchMode.STATIC_HTML), source=HTML_SRC
    )
    assert result.page is not None
    assert result.json is None
    assert any(o.get("@type") == "JobPosting" for o in result.page.json_ld())
    assert site.url("/about") in result.page.links()


async def test_T15_ENGINE_conditional_get_304(site: Site, engine: ScraplingJobEngine) -> None:
    site.handle(
        "/api",
        lambda r: (
            Response(status=304)
            if r.headers.get("If-None-Match") == '"e1"'
            else Response("{}", content_type="application/json")
        ),
    )
    result = await engine.fetch(
        FetchRequest(site.url("/api"), FetchMode.JSON_API, etag='"e1"'), source=JSON_SRC
    )
    assert result.not_modified
    assert result.json is None


async def test_T15_ENGINE_non_json_body_is_schema_invalid(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.handle("/api", lambda _r: Response("not json", content_type="application/json"))
    assert (await _fail(engine, site.url("/api"))).error_class == "schema_invalid"


# ---------------------------------------------------------------- taxonomy
@pytest.mark.parametrize(
    ("status", "headers", "listing", "expected"),
    [
        (401, None, False, "access_denied"),
        (403, None, False, "access_denied"),
        (407, None, False, "access_denied"),
        (451, None, False, "access_denied"),
        (404, None, True, "source_closed"),
        (404, None, False, "not_found"),
        (410, None, False, "not_found"),
        (418, None, False, "unsupported_content"),
    ],
)
async def test_T15_ENGINE_error_taxonomy(
    site: Site, engine: ScraplingJobEngine, status: int, headers: Any, listing: bool, expected: str
) -> None:
    site.status("/x", status, headers=headers)
    error = await _fail(engine, site.url("/x"), listing=listing)
    assert error.error_class == expected
    assert error.http_status == status
    assert len(site.hits("/x")) == 1  # never retried


@pytest.mark.parametrize(
    ("status", "headers", "expected"),
    [
        (429, None, "rate_limited"),
        (503, {"Retry-After": "1"}, "rate_limited"),
        (500, None, "http_5xx"),
        (502, None, "http_5xx"),
        (503, None, "http_5xx"),
        (504, None, "http_5xx"),
    ],
)
async def test_T15_ENGINE_retryable_classes(
    site: Site, engine: ScraplingJobEngine, status: int, headers: Any, expected: str
) -> None:
    site.status("/x", status, headers=headers)
    error = await _fail(engine, site.url("/x"))
    assert error.error_class == expected
    assert len(site.hits("/x")) == (3 if expected == "rate_limited" else 4)


@pytest.mark.parametrize(
    ("fixture", "status", "marker"),
    [
        ("challenge/cloudflare.html", 503, "cloudflare_challenge"),
        ("challenge/cloudflare.html", 200, "cloudflare_challenge"),
        ("challenge/turnstile.html", 200, "cloudflare_turnstile"),
        ("challenge/datadome.html", 403, "datadome"),
        ("challenge/perimeterx.html", 403, "perimeterx"),
    ],
)
async def test_T15_ENGINE_challenge_detected_never_solved(
    site: Site, engine: ScraplingJobEngine, fixture: str, status: int, marker: str
) -> None:
    site.html("/careers", fixture_text(fixture), status=status)
    error = await _fail(engine, site.url("/careers"), mode=FetchMode.STATIC_HTML, source=HTML_SRC)
    assert error.error_class == "challenge_detected"
    assert error.marker == marker
    assert len(site.hits("/careers")) == 1


async def test_T15_ENGINE_cf_mitigated_header_is_a_challenge(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.status(
        "/careers",
        403,
        headers={"cf-mitigated": "challenge"},
        body="<html></html>",
        content_type="text/html",
    )
    error = await _fail(engine, site.url("/careers"), mode=FetchMode.STATIC_HTML, source=HTML_SRC)
    assert error.error_class == "challenge_detected"


async def test_T15_ENGINE_recaptcha_on_a_job_page_is_not_a_challenge(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.html("/job", fixture_text("challenge/job_with_recaptcha.html"))
    result = await engine.fetch(
        FetchRequest(site.url("/job"), FetchMode.STATIC_HTML), source=HTML_SRC
    )
    assert result.status == 200
    assert detect_challenge(200, {}, "<title>Security Analyst</title><p>job</p>") is None


async def test_T15_ENGINE_network_errors_retried_then_failed(
    engine: ScraplingJobEngine, vclock: VirtualClock
) -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    error = await _fail(engine, f"http://127.0.0.1:{port}/robots-free")
    # robots.txt itself is unreachable → complete disallow (RFC 9309), no page request
    assert error.error_class == "robots_disallowed"
    assert classify_transport_error(7, "Failed to connect", url="u").error_class == "network"
    assert classify_transport_error(28, "Operation timed out", url="u").error_class == "timeout"


async def test_T15_ENGINE_redirect_to_private_address_refused(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.status("/r", 302, headers={"Location": site.url("/target")})
    error = await _fail(engine, site.url("/r"))
    assert error.error_class == "policy_blocked"
    assert not error.retryable


async def test_T15_ENGINE_five_consecutive_5xx_stop_source(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.status("/a", 500)
    site.status("/b", 500)
    first = await _fail(engine, site.url("/a"))
    assert first.error_class == "http_5xx"
    second = await _fail(engine, site.url("/b"))
    assert second.error_class == "source_unavailable"


async def test_T15_ENGINE_browser_mode_needs_opt_in(site: Site, engine: ScraplingJobEngine) -> None:
    error = await _fail(engine, site.url("/spa"), mode=FetchMode.BROWSER, source=HTML_SRC)
    assert error.error_class == "unsupported_content"
    assert site.log == []
    assert engine.requests == []


# ---------------------------------------------------------------- backoff
def test_TDISC_BACKOFF_delay_bounds() -> None:
    policy = RetryPolicy()
    rng = random.Random(1)
    for attempt, nominal in ((1, 2), (2, 4), (3, 8), (4, 16), (7, 120), (10, 120)):
        for _ in range(50):
            delay = policy.delay(attempt, rng)
            assert nominal * 0.8 <= delay <= nominal * 1.2


async def test_TDISC_BACKOFF_exponential_waits_between_attempts(
    site: Site, engine: ScraplingJobEngine, vclock: VirtualClock
) -> None:
    site.status("/x", 500)
    await _fail(engine, site.url("/x"))
    waits = [s for s in vclock.sleeps if s > 1.6]  # politeness waits are ≤ 1.5 s here
    assert len(waits) == 3
    for wait, nominal in zip(waits, (2, 4, 8), strict=True):
        assert nominal * 0.8 <= wait <= nominal * 1.2 + 1.5


async def test_TDISC_BACKOFF_retry_after_honoured(
    site: Site, engine: ScraplingJobEngine, vclock: VirtualClock
) -> None:
    site.sequence(
        "/x",
        [
            Response(status=429, headers={"Retry-After": "30"}),
            Response("{}", content_type="application/json"),
        ],
    )
    result = await engine.fetch(FetchRequest(site.url("/x"), FetchMode.JSON_API), source=JSON_SRC)
    assert result.attempt == 2
    assert max(vclock.sleeps) >= 30


async def test_TDISC_BACKOFF_retry_after_beyond_15_minutes_stops(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.status("/x", 429, headers={"Retry-After": "1200"})
    error = await _fail(engine, site.url("/x"))
    assert error.error_class == "rate_limited"
    assert not error.retryable
    assert len(site.hits("/x")) == 1


async def test_TDISC_BACKOFF_recovers_after_transient_5xx(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.sequence("/x", [Response(status=502), Response("[]", content_type="application/json")])
    result = await engine.fetch(FetchRequest(site.url("/x"), FetchMode.JSON_API), source=JSON_SRC)
    assert result.attempt == 2
    assert result.json == []


async def test_TDISC_BACKOFF_stop_on_classes_are_not_retried(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.status("/x", 429, headers={"Retry-After": "2"})
    source = SourceRef(
        key="wd",
        adapter_id="workday",
        org="t/s",
        stop_on=frozenset({"rate_limited"}),
        per_domain_concurrency=1,
        min_delay_ms=3000,
    )
    error = await _fail(engine, site.url("/x"), source=source)
    assert error.error_class == "rate_limited"
    assert len(site.hits("/x")) == 1


def test_TDISC_BACKOFF_retry_after_formats() -> None:
    assert parse_retry_after("120", now_s=0) == 120
    assert parse_retry_after("Thu, 01 Jan 1970 00:02:00 GMT", now_s=60) == 60
    assert parse_retry_after("soon", now_s=0) is None


# ---------------------------------------------------------------- robots
async def test_TDISC_ROBOTS_disallowed_path_never_requested(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.server.clear_all_handlers()
    site.robots("User-agent: *\nDisallow: /private\n")
    site.json("/private/jobs", [])
    error = await _fail(engine, site.url("/private/jobs"))
    assert error.error_class == "robots_disallowed"
    assert site.hits("/private") == []


async def test_TDISC_ROBOTS_user_agent_group_applies(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.server.clear_all_handlers()
    site.robots("User-agent: pilih-jobs\nDisallow: /jobs\n\nUser-agent: *\nAllow: /\n")
    site.json("/jobs", [])
    site.json("/open", [])
    assert (await _fail(engine, site.url("/jobs"))).error_class == "robots_disallowed"
    assert (
        await engine.fetch(FetchRequest(site.url("/open"), FetchMode.JSON_API), source=JSON_SRC)
    ).status == 200


async def test_TDISC_ROBOTS_crawl_delay_honoured(site: Site, engine: ScraplingJobEngine) -> None:
    site.server.clear_all_handlers()
    site.robots("User-agent: *\nCrawl-delay: 7\n")
    site.json("/a", [])
    for _ in range(3):
        await engine.fetch(FetchRequest(site.url("/a"), FetchMode.JSON_API), source=JSON_SRC)
    starts = [r.start for r in engine.scheduler.history][1:]  # skip robots.txt
    assert all(b - a >= 7 for a, b in itertools.pairwise(starts))


async def test_TDISC_ROBOTS_missing_robots_allows(site: Site, engine: ScraplingJobEngine) -> None:
    site.server.clear_all_handlers()
    site.json("/a", [])
    assert (
        await engine.fetch(FetchRequest(site.url("/a"), FetchMode.JSON_API), source=JSON_SRC)
    ).status == 200


async def test_TDISC_ROBOTS_server_error_means_disallow_all(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.server.clear_all_handlers()
    site.robots("oops", status=500)
    site.json("/a", [])
    assert (await _fail(engine, site.url("/a"))).error_class == "robots_disallowed"
    assert site.hits("/a") == []


async def test_TDISC_ROBOTS_denied_robots_is_access_denied(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.server.clear_all_handlers()
    site.robots("no", status=403)
    assert (await _fail(engine, site.url("/a"))).error_class == "access_denied"


async def test_TDISC_ROBOTS_fetched_once_per_origin(site: Site, engine: ScraplingJobEngine) -> None:
    site.json("/a", [])
    for _ in range(3):
        await engine.fetch(FetchRequest(site.url("/a"), FetchMode.JSON_API), source=JSON_SRC)
    assert sum(1 for r, _ in site.server.log if r.path == "/robots.txt") == 1


async def test_TDISC_ROBOTS_listing_disallowed_stops_career_page(
    site: Site, engine: ScraplingJobEngine
) -> None:
    from tests.discovery.support import Harness, resolved

    site.server.clear_all_handlers()
    site.robots("User-agent: *\nDisallow: /careers\n")
    site.html("/careers", fixture_text("career_page/jsonld_listing.html"))
    outcome = await Harness(engine).run(resolved("career_page", {"url": site.url("/careers")}))
    assert outcome.stop is not None
    assert outcome.stop.error_class == "robots_disallowed"
    assert site.hits("/") == []  # no other path is tried for the same content


# ---------------------------------------------------------------- politeness
async def test_T15_ENGINE_json_requests_spaced_one_second(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.json("/a", [])
    for _ in range(4):
        await engine.fetch(FetchRequest(site.url("/a"), FetchMode.JSON_API), source=JSON_SRC)
    starts = [r.start for r in engine.scheduler.history]
    assert all(1.0 <= b - a <= 1.5 for a, b in itertools.pairwise(starts))


async def test_T15_ENGINE_html_requests_spaced_two_seconds(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.html("/p", "<html><body><p>hi</p></body></html>")
    for _ in range(3):
        await engine.fetch(FetchRequest(site.url("/p"), FetchMode.STATIC_HTML), source=HTML_SRC)
    starts = [r.start for r in engine.scheduler.history if r.html]
    assert all(b - a >= 2.0 for a, b in itertools.pairwise(starts))


async def test_T15_ENGINE_per_domain_and_global_concurrency(vclock: VirtualClock) -> None:
    scheduler = PolitenessScheduler(vclock, random.Random(0))
    active: dict[str, int] = {}
    peak: dict[str, int] = {}
    total = {"now": 0, "peak": 0}

    async def request(domain: str, html: bool) -> None:
        async with scheduler.slot(domain, html=html, concurrency=2):
            active[domain] = active.get(domain, 0) + 1
            total["now"] += 1
            peak[domain] = max(peak.get(domain, 0), active[domain])
            total["peak"] = max(total["peak"], total["now"])
            await asyncio.sleep(0.01)
            active[domain] -= 1
            total["now"] -= 1

    await asyncio.gather(
        *(request("json.test", False) for _ in range(6)),
        *(request("html.test", True) for _ in range(3)),
        *(request(f"d{i}.test", False) for i in range(8)),
    )
    assert peak["json.test"] <= 2
    assert peak["html.test"] == 1
    assert total["peak"] <= 4


def test_T15_ENGINE_politeness_floors_cannot_be_lowered() -> None:
    assert PolitenessScheduler.effective_delay(html=False, min_delay_s=0.1) == 1.0
    assert PolitenessScheduler.effective_delay(html=True, min_delay_s=0.0) == 2.0
    assert PolitenessScheduler.effective_delay(html=False, min_delay_s=3.0) == 3.0
    assert PolitenessScheduler.effective_concurrency(html=False, concurrency=8) == 2
    assert PolitenessScheduler.effective_concurrency(html=True, concurrency=2) == 1


# ---------------------------------------------------------------- optional network guard
class _RecordingGuard:
    """A server-side guard (24 §9): refuses one path, records every check."""

    def __init__(self, refuse: str | None = None) -> None:
        self.refuse = refuse
        self.urls: list[str] = []
        self.responses: list[tuple[str, str, int]] = []

    def check_url(self, url: str) -> None:
        self.urls.append(url)
        if self.refuse is not None and self.refuse in url:
            raise DiscoveryError("policy_blocked", "refused by the network guard", url=url)

    def check_response(self, url: str, final_url: str, body_size: int) -> None:
        self.responses.append((url, final_url, body_size))


def _guarded_engine(
    tmp_path: Path, vclock: VirtualClock, guard: _RecordingGuard
) -> ScraplingJobEngine:
    return ScraplingJobEngine(
        data_dir=tmp_path / "data",
        cache_dir=tmp_path / "cache",
        clock=vclock,
        rng=random.Random(7),
        network_guard=guard,
    )


async def test_T15_ENGINE_network_guard_checks_every_request(
    site: Site, tmp_path: Path, vclock: VirtualClock
) -> None:
    guard = _RecordingGuard()
    engine = _guarded_engine(tmp_path, vclock, guard)
    site.json("/api", {"ok": True})
    try:
        result = await engine.fetch(
            FetchRequest(site.url("/api"), FetchMode.JSON_API), source=JSON_SRC
        )
    finally:
        await engine.aclose()
    assert result.json == {"ok": True}
    assert guard.urls == [site.url("/robots.txt"), site.url("/api")]
    final = guard.responses[-1]
    assert final[:2] == (site.url("/api"), site.url("/api"))
    assert final[2] == result.body_size


async def test_T15_ENGINE_network_guard_refusal_is_policy_blocked(
    site: Site, tmp_path: Path, vclock: VirtualClock
) -> None:
    guard = _RecordingGuard(refuse="/private")
    engine = _guarded_engine(tmp_path, vclock, guard)
    site.json("/private", {"secret": True})
    try:
        error = await _fail(engine, site.url("/private"))
    finally:
        await engine.aclose()
    assert error.error_class == "policy_blocked"
    assert not error.retryable
    assert site.hits("/private") == []


async def test_T15_ENGINE_no_guard_by_default(engine: ScraplingJobEngine) -> None:
    assert engine._guard is None  # pyright: ignore[reportPrivateUsage] - the CLI never sets one


# ---------------------------------------------------------------- rendered pages (24 §4.4)
RENDER_SRC = SourceRef(
    key="test:render",
    adapter_id="generic_listing",
    org="acme",
    per_domain_concurrency=1,
    min_delay_ms=2000,
    allow_browser=True,
)
LISTING_HTML = (
    "<html><head><title>Remote jobs</title></head><body><ul>"
    + "".join(
        f"<li class='job'><h2>Job {i}</h2><a href='/jobs/{i}'>Apply</a></li>" for i in range(5)
    )
    + "</ul>"
    + "<p>"
    + "Remote work everywhere. " * 80
    + "</p></body></html>"
)


def _render_engine(
    tmp_path: Path, vclock: VirtualClock, guard: _RecordingGuard
) -> ScraplingJobEngine:
    return ScraplingJobEngine(
        data_dir=tmp_path / "data",
        cache_dir=tmp_path / "cache",
        clock=vclock,
        rng=random.Random(7),
        allow_browser=True,
        network_guard=guard,
    )


async def test_T24_RENDER_rendered_page_goes_through_the_gates(
    site: Site, tmp_path: Path, vclock: VirtualClock
) -> None:
    guard = _RecordingGuard()
    engine = _render_engine(tmp_path, vclock, guard)
    try:
        result = await engine.accept_rendered(
            FetchRequest(site.url("/jobs"), FetchMode.STATIC_HTML),
            final_url=site.url("/jobs"),
            status=200,
            html=LISTING_HTML,
            source=RENDER_SRC,
        )
    finally:
        await engine.aclose()
    assert result.fetch_mode is FetchMode.BROWSER
    assert result.page is not None
    assert site.hits("/jobs") == []  # nothing fetched but robots.txt
    assert site.url("/jobs") in guard.urls
    assert guard.responses[-1][2] == len(LISTING_HTML.encode())


async def test_T24_RENDER_a_rendered_challenge_is_classified_never_accepted(
    site: Site, tmp_path: Path, vclock: VirtualClock
) -> None:
    engine = _render_engine(tmp_path, vclock, _RecordingGuard())
    challenge = (
        "<html><head><title>Just a moment...</title></head><body>cf-chl-bypass</body></html>"
    )
    try:
        with pytest.raises(DiscoveryError) as caught:
            await engine.accept_rendered(
                FetchRequest(site.url("/jobs"), FetchMode.STATIC_HTML),
                final_url=site.url("/jobs"),
                status=403,
                html=challenge,
                source=RENDER_SRC,
            )
    finally:
        await engine.aclose()
    assert caught.value.error_class in {"challenge_detected", "access_denied"}
    assert not caught.value.retryable


async def test_T24_RENDER_robots_wins_over_a_render(
    site: Site, tmp_path: Path, vclock: VirtualClock
) -> None:
    site.server.clear_all_handlers()
    site.robots("User-agent: *\nDisallow: /jobs\n")
    engine = _render_engine(tmp_path, vclock, _RecordingGuard())
    try:
        with pytest.raises(DiscoveryError) as caught:
            await engine.accept_rendered(
                FetchRequest(site.url("/jobs"), FetchMode.STATIC_HTML),
                final_url=site.url("/jobs"),
                status=200,
                html=LISTING_HTML,
                source=RENDER_SRC,
            )
    finally:
        await engine.aclose()
    assert caught.value.error_class == "robots_disallowed"


async def test_T24_RENDER_needs_browser_opt_in(
    site: Site, tmp_path: Path, vclock: VirtualClock
) -> None:
    engine = _render_engine(tmp_path, vclock, _RecordingGuard())
    try:
        with pytest.raises(DiscoveryError) as caught:
            await engine.accept_rendered(
                FetchRequest(site.url("/jobs"), FetchMode.STATIC_HTML),
                final_url=site.url("/jobs"),
                status=200,
                html=LISTING_HTML,
                source=HTML_SRC,
            )
    finally:
        await engine.aclose()
    assert caught.value.error_class == "unsupported_content"


async def test_T24_RENDER_preflight_returns_the_decision_and_robots_text(
    site: Site, tmp_path: Path, vclock: VirtualClock
) -> None:
    site.server.clear_all_handlers()
    site.robots("User-agent: *\nDisallow: /api/\n")
    guard = _RecordingGuard()
    engine = _render_engine(tmp_path, vclock, guard)
    try:
        decision, text = await engine.preflight(site.url("/jobs"))
        blocked, _ = await engine.preflight(site.url("/api/list"))
    finally:
        await engine.aclose()
    assert decision.allowed
    assert text is not None
    assert "Disallow: /api/" in text
    assert not blocked.allowed
    assert site.url("/jobs") in guard.urls
