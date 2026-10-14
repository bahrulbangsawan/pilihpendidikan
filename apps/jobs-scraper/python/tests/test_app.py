"""The HTTP service (Starlette TestClient): validation, limits, and every endpoint."""

from __future__ import annotations

import json
from pathlib import Path

from pilih_jobs.contracts._generated.cloud import (
    DirectoryResponse,
    ProbeResponse,
    ScrapeResponse,
)
from starlette.testclient import TestClient

from pilih_scraper.app import MAX_BODY_BYTES, create_app
from pilih_scraper.fetching import EngineFactory
from tests.support import Site, fixture_text, scrape_body


def _client(factory: EngineFactory) -> TestClient:
    return TestClient(create_app(factory))


def test_healthz(factory: EngineFactory) -> None:
    response = _client(factory).get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["engine"]["scrapling"] == "0.4.15"


def test_invalid_requests(factory: EngineFactory) -> None:
    client = _client(factory)
    missing = client.post("/v1/scrape", json={"v": 1})
    assert missing.status_code == 400
    assert missing.json()["error"] == "invalid_request"
    assert {i["path"] for i in missing.json()["issues"]} >= {"run_id", "source"}
    not_json = client.post(
        "/v1/probe", content=b"{nope", headers={"content-type": "application/json"}
    )
    assert not_json.status_code == 400
    wrong_version = client.post("/v1/probe", json={"v": 2, "url": "https://jobs.example"})
    assert wrong_version.status_code == 400
    assert client.get("/v1/scrape").status_code == 405
    assert client.post("/v1/other", json={}).status_code == 404


def test_oversized_body(factory: EngineFactory) -> None:
    big = b'{"v": 1, "pad": "' + b"x" * (MAX_BODY_BYTES + 10) + b'"}'
    response = _client(factory).post(
        "/v1/scrape", content=big, headers={"content-type": "application/json"}
    )
    assert response.status_code == 413


def test_scrape_endpoint(site: Site, factory: EngineFactory) -> None:
    site.xml("/remote-jobs.rss", fixture_text("wwr.rss"))
    body = scrape_body(
        "rss",
        {
            "url": site.url("/remote-jobs.rss"),
            "title_pattern": "company_title",
            "location_field": "region",
        },
    )
    response = _client(factory).post("/v1/scrape", json=body)
    assert response.status_code == 200
    parsed = ScrapeResponse.model_validate(response.json())
    assert len(parsed.items) == 2
    assert parsed.outcome == "ok"
    assert parsed.engine.scraper == "0.1.0"
    events = [entry.event for entry in parsed.log]
    assert events[0] == "scrape_started"
    assert "page_fetched" in events
    assert events[-1] == "scrape_finished"


def test_source_failure_is_a_200_with_error(site: Site, factory: EngineFactory) -> None:
    site.raw("/feed", "denied", 403)
    body = scrape_body("rss", {"url": site.url("/feed"), "title_pattern": "title"})
    response = _client(factory).post("/v1/scrape", json=body)
    assert response.status_code == 200
    assert response.json()["error"]["error_class"] == "access_denied"


def test_probe_endpoint(site: Site, factory: EngineFactory) -> None:
    posting = {"@context": "https://schema.org", "@type": "JobPosting", "title": "Editor"}
    site.html(
        "/",
        "<html><head><title>Remote Board</title>"
        '<meta name="description" content="Remote jobs in Indonesia">'
        f'<link rel="alternate" type="application/rss+xml" href="{site.url("/jobs.xml")}">'
        f'<script type="application/ld+json">{json.dumps(posting)}</script>'
        "<script>window.__PRELOADED_STATE__ = {}</script></head><body>"
        '<a href="/jobs/editor-123">Editor</a><a href="/jobs/designer-456">Designer</a>'
        '<a href="/about">About</a></body></html>',
    )
    site.xml(
        "/jobs.xml",
        '<rss version="2.0"><channel><item><title>Editor</title><link>https://x.example/1</link></item></channel></rss>',
    )
    response = _client(factory).post("/v1/probe", json={"v": 1, "url": site.url("/")})
    assert response.status_code == 200
    probe = ProbeResponse.model_validate(response.json())
    assert probe.reachable is True
    assert probe.robots.allowed is True
    assert probe.title is not None
    assert probe.title.root == "Remote Board"
    assert probe.jsonld_job_postings == 1
    assert [e.root for e in probe.embedded_json] == ["__PRELOADED_STATE__"]
    assert probe.job_link_count == 2
    assert [(f.type, f.items) for f in probe.feeds] == [("rss", 1)]
    assert probe.auth_wall is False
    assert probe.error is None


def test_probe_respects_robots(site: Site, factory: EngineFactory) -> None:
    site.server.clear_all_handlers()
    site.robots("User-agent: *\nDisallow: /\n")
    site.html("/", "<html></html>")
    response = _client(factory).post("/v1/probe", json={"v": 1, "url": site.url("/")})
    body = response.json()
    assert body["robots"]["allowed"] is False
    assert body["error"]["error_class"] == "robots_disallowed"
    assert site.hits("/") == 0


def test_probe_detects_a_challenge(site: Site, factory: EngineFactory) -> None:
    site.html(
        "/",
        "<html><head><title>Just a moment...</title></head><body>"
        "<script src='/cdn-cgi/challenge-platform/x'></script></body></html>",
        status=403,
    )
    body = _client(factory).post("/v1/probe", json={"v": 1, "url": site.url("/")}).json()
    assert body["protection"] == "cloudflare_challenge"
    assert body["error"]["error_class"] == "challenge_detected"
    assert body["reachable"] is True


def test_directory_endpoint(site: Site, factory: EngineFactory, tmp_path: Path) -> None:
    site.html(
        "/tools",
        '<ul id="resources-remote-jobs-list">'
        '<li><a data-chat-anchor="recommendations-wwr" href="https://weworkremotely.com">'
        '<span class="n">We Work Remotely</span><span class="d">Remote-only board.</span></a></li>'
        '<li><a data-chat-anchor="recommendations-wwr-2" href="https://weworkremotely.com#top">'
        '<span class="n">Duplicate</span></a></li>'
        '<li><a data-chat-anchor="internal" href="/tools?category=design"><span class="n">Design</span></a></li>'
        '<li><a data-chat-anchor="recommendations-wfh" href="https://www.workfromhome.id">'
        '<span class="n">Work From Home ID</span></a></li>'
        "</ul>",
    )
    request = {
        "v": 1,
        "directory": {
            "url": site.url("/tools"),
            "link_selector": "#resources-remote-jobs-list a[href]",
            "name_selector": "span.n",
            "description_selector": "span.d",
            "anchor_attr": "data-chat-anchor",
        },
    }
    response = _client(factory).post("/v1/directory", json=request)
    assert response.status_code == 200
    parsed = DirectoryResponse.model_validate(response.json())
    assert [(e.name, e.url) for e in parsed.entries] == [
        ("We Work Remotely", "https://weworkremotely.com"),
        ("Work From Home ID", "https://www.workfromhome.id"),
    ]
    first = parsed.entries[0]
    assert first.description is not None
    assert first.description.root == "Remote-only board."
    assert first.anchor is not None
    assert first.anchor.root == "recommendations-wwr"
    assert parsed.error is None
