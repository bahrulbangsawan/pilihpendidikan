"""Pages rendered by the scraper Worker (Cloudflare Browser Rendering, 24 §4.4)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from starlette.testclient import TestClient

from pilih_scraper.app import create_app
from pilih_scraper.fetching import EngineFactory
from tests.support import Site, VirtualClock, make_factory, run, scrape_body

RENDERED = """<html><head><title>Remote Jobs</title></head><body><ul>
<li class="result-item"><div class="flex flex-col truncate">
  <h2 href="/company/acme/remote-job/backend-engineer">Backend Engineer</h2>
  <p class="text-dc-gold-700">Acme Remote</p>
  <span>Full Time</span><span>$4k - $6k per month</span><span><span>Worldwide</span></span>
</div></li>
<li class="result-item"><div class="flex flex-col truncate">
  <h2 href="/company/globex/remote-job/support-lead">Support Lead</h2>
  <p class="text-dc-gold-700">Globex</p>
  <span>Part Time</span><span>$2k per month</span><span><span>Latin America</span></span>
</div></li>
</ul></body></html>"""

CONFIG: dict[str, Any] = {
    "url": "",
    "renderer": "browser_rendering",
    "item": "li.result-item",
    "fields": {
        "title": "h2::text",
        "link": "h2::attr(href)",
        "company": "p::text",
        "location": "div.truncate > span:nth-of-type(3) span::text",
    },
    "wait_selector": "li.result-item",
    "detail": {"enabled": True},
    "defaults": {"workplace_type": "remote"},
}


def _detail(title: str, company: str) -> str:
    posting = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": title,
        "hiringOrganization": {"@type": "Organization", "name": company},
        "datePosted": "2026-10-10",
        "validThrough": "2026-12-01",
        "employmentType": "FULL_TIME",
        "jobLocationType": "TELECOMMUTE",
        "description": f"<p>{title} at {company}. " + "Build things remotely. " * 20 + "</p>",
    }
    return (
        "<html><head><script type='application/ld+json'>"
        + json.dumps(posting)
        + "</script></head><body>job</body></html>"
    )


def _body(site: Site, html: str = RENDERED, status: int = 200) -> dict[str, Any]:
    url = site.url("/remote-jobs")
    body = scrape_body("browser", {**CONFIG, "url": url}, allow_browser=True)
    body["prefetched"] = {
        "url": url,
        "final_url": url,
        "status": status,
        "html": html,
        "renderer": "browser_rendering",
        "blocked_requests": 7,
    }
    return body


async def test_T24_RENDERED_listing_is_extracted_and_details_fetched(
    tmp_path: Path, site: Site
) -> None:
    factory = make_factory(tmp_path, site, VirtualClock())
    site.html(
        "/company/acme/remote-job/backend-engineer", _detail("Backend Engineer", "Acme Remote")
    )
    site.html("/company/globex/remote-job/support-lead", _detail("Support Lead", "Globex"))
    response = await run(factory, _body(site))
    assert response["error"] is None, response["error"]
    titles = sorted(str(i["title"]) for i in response["items"])
    assert titles == ["Backend Engineer", "Support Lead"]
    first = next(i for i in response["items"] if i["title"] == "Backend Engineer")
    assert first["company_name"] == "Acme Remote"
    assert first["extraction"]["fetch_mode"] == "browser"
    assert first["extras"]["expires_at"] is not None  # validThrough from the detail page
    # The listing itself was never fetched here; only robots.txt and the details.
    assert site.hits("/remote-jobs") == 0
    assert response["stats"]["details_fetched"] == 2
    # A rendered listing shows only the newest jobs: absences must not count.
    assert response["complete"] is False
    assert any(line["event"] == "page_rendered" for line in response["log"])


async def test_T24_RENDERED_a_rendered_challenge_is_refused(tmp_path: Path, site: Site) -> None:
    factory = make_factory(tmp_path, site, VirtualClock())
    challenge = (
        "<html><head><title>Just a moment...</title></head>"
        "<body><div id='cf-chl-widget'>/cdn-cgi/challenge-platform/</div></body></html>"
    )
    response = await run(factory, _body(site, challenge, status=403))
    assert response["items"] == []
    assert response["error"]["error_class"] in {"challenge_detected", "access_denied"}


async def test_T24_RENDERED_robots_still_applies(tmp_path: Path, site: Site) -> None:
    factory = make_factory(tmp_path, site, VirtualClock())
    site.server.clear_all_handlers()
    site.robots("User-agent: *\nDisallow: /remote-jobs\n")
    response = await run(factory, _body(site))
    assert response["items"] == []
    assert response["error"]["error_class"] == "robots_disallowed"


def test_T24_PREFLIGHT_returns_robots_and_refuses_private_hosts(
    factory: EngineFactory, site: Site
) -> None:
    site.server.clear_all_handlers()
    site.robots("User-agent: *\nDisallow: /api/\n")
    client = TestClient(create_app(factory))
    ok = client.post("/v1/preflight", json={"v": 1, "url": site.url("/remote-jobs")}).json()
    assert ok["allowed"] is True
    assert "Disallow: /api/" in ok["robots_txt"]
    assert ok["user_agent"].startswith("pilih-jobs/")
    blocked = client.post("/v1/preflight", json={"v": 1, "url": site.url("/api/jobs")}).json()
    assert blocked["allowed"] is False
    assert blocked["error"]["error_class"] == "robots_disallowed"
    private = client.post(
        "/v1/preflight", json={"v": 1, "url": "http://169.254.169.254/latest/meta-data"}
    ).json()
    assert private["allowed"] is False
    assert private["error"]["error_class"] == "policy_blocked"
