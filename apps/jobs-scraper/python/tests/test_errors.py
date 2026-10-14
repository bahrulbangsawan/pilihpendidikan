"""Failure classification (24 §6, 15 §8): every stop maps to an actionable error class."""

from __future__ import annotations

from typing import Any

import pytest

from pilih_scraper.fetching import EngineFactory
from pilih_scraper.signals import login_redirect, paywall_text
from tests.support import Site, VirtualClock, run, scrape_body

FEED = {"title_pattern": "company_title"}
CHALLENGE = (
    "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>"
    "<script src='/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1'></script></body></html>"
)


async def _rss(site: Site, factory: EngineFactory) -> dict[str, Any]:
    return await run(factory, scrape_body("rss", {**FEED, "url": site.url("/feed")}))


@pytest.mark.parametrize(
    ("status", "headers", "error_class"),
    [
        (401, {"WWW-Authenticate": 'Basic realm="members"'}, "auth_required"),
        (403, {}, "access_denied"),
        (407, {}, "access_denied"),
        (404, {}, "source_closed"),
    ],
)
async def test_http_denials(
    site: Site, factory: EngineFactory, status: int, headers: dict[str, str], error_class: str
) -> None:
    site.raw("/feed", "nope", status, **headers)
    response = await _rss(site, factory)
    assert response["outcome"] == "failed"
    assert response["error"]["error_class"] == error_class
    assert response["error"]["http_status"] == status
    assert site.hits("/feed") == 1  # denials are never retried


async def test_rate_limited_with_long_retry_after_stops_at_once(
    site: Site, factory: EngineFactory
) -> None:
    site.raw("/feed", "slow down", 429, **{"Retry-After": "600"})
    response = await _rss(site, factory)
    assert response["error"]["error_class"] == "rate_limited"
    assert response["error"]["retry_after_s"] == 600
    assert "600" in response["error"]["message"]
    assert site.hits("/feed") == 1


async def test_rate_limited_with_short_retry_after_is_retried(
    site: Site, factory: EngineFactory, clock: VirtualClock
) -> None:
    site.raw("/feed", "slow down", 429, **{"Retry-After": "5"})
    response = await _rss(site, factory)
    assert response["error"]["error_class"] == "rate_limited"
    assert site.hits("/feed") == 3  # bounded: three attempts
    assert any(wait >= 5 for wait in clock.sleeps)


async def test_server_errors_are_retried_with_backoff(
    site: Site, factory: EngineFactory, clock: VirtualClock
) -> None:
    site.raw("/feed", "boom", 502)
    response = await _rss(site, factory)
    assert response["error"]["error_class"] == "http_5xx"
    assert site.hits("/feed") == 3
    assert "retried" in response["error"]["message"]


async def test_cloudflare_challenge_is_blocked_not_solved(
    site: Site, factory: EngineFactory
) -> None:
    site.html("/feed", CHALLENGE, status=403)
    response = await _rss(site, factory)
    assert response["error"]["error_class"] == "challenge_detected"
    assert "never solved" in response["error"]["message"]
    assert site.hits("/feed") == 1


async def test_empty_body(site: Site, factory: EngineFactory) -> None:
    site.raw("/feed", "", 200, **{"Content-Type": "application/rss+xml"})
    response = await _rss(site, factory)
    assert response["error"]["error_class"] == "source_unavailable"
    assert "empty body" in response["error"]["message"]


async def test_html_where_a_feed_was_expected(site: Site, factory: EngineFactory) -> None:
    site.html("/feed", "<!doctype html><html><body><h1>Jobs</h1></body></html>")
    response = await _rss(site, factory)
    assert response["error"]["error_class"] == "schema_invalid"
    assert "HTML page" in response["error"]["message"]


async def test_xml_entity_expansion_is_refused(site: Site, factory: EngineFactory) -> None:
    bomb = (
        '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">'
        '<!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><rss version="2.0"><channel>'
        "<item><title>&lol2;</title></item></channel></rss>"
    )
    site.xml("/feed", bomb)
    response = await _rss(site, factory)
    assert response["error"]["error_class"] == "schema_invalid"


async def test_login_wall_page_is_auth_required(site: Site, factory: EngineFactory) -> None:
    site.html(
        "/jobs",
        "<html><body><h1>Sign in</h1><form><input name='email'>"
        "<input type='password' name='password'><button>Log in</button></form></body></html>",
    )
    config = {
        "url": site.url("/jobs"),
        "item": ".job-card",
        "fields": {"title": ".title", "link": "a::attr(href)"},
        "adaptive": False,
    }
    response = await run(factory, scrape_body("html_selectors", config))
    assert response["error"]["error_class"] == "auth_required"
    assert "never fetched" in response["error"]["message"]


async def test_paywall_page_is_auth_required(site: Site, factory: EngineFactory) -> None:
    site.html(
        "/jobs",
        "<html><body><h1>Remote jobs</h1><p>Become a member to view the full job listings and "
        "apply. Plans start at $9.95.</p></body></html>",
    )
    config = {"listing_url": site.url("/jobs"), "detail_link_selector": "a.job"}
    response = await run(factory, scrape_body("json_ld", config))
    assert response["error"]["error_class"] == "auth_required"


def test_login_redirect_and_paywall_detection() -> None:
    assert login_redirect("https://b.example/jobs", "https://b.example/users/sign_in?next=/jobs")
    assert login_redirect("https://b.example/jobs", "https://b.example/pricing")
    assert not login_redirect("https://b.example/jobs", "https://b.example/jobs?page=1")
    assert not login_redirect("https://b.example/login", "https://b.example/login/sso")
    assert paywall_text("Log in to see all remote jobs and salaries.")
    assert not paywall_text("Our team logs in to many systems every day.")


async def test_robots_disallow(site: Site, factory: EngineFactory) -> None:
    site.server.clear_all_handlers()
    site.robots("User-agent: *\nDisallow: /feed\n")
    site.xml("/feed", "<rss/>")
    response = await _rss(site, factory)
    assert response["error"]["error_class"] == "robots_disallowed"
    assert response["stats"]["robots_skipped"] == 1
    assert site.hits("/feed") == 0


async def test_honest_user_agent(site: Site, factory: EngineFactory) -> None:
    site.xml("/feed", "<rss version='2.0'><channel></channel></rss>")
    await _rss(site, factory)
    agents = {request.headers.get("User-Agent") for request, _ in site.server.log}
    assert agents == {"pilih-jobs/0.1.0 (+https://pilihpendidikan.com/bot)"}
