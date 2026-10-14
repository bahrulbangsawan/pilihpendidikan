"""Every strategy against local fixtures (no network): items, provenance, extras, cursor."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pilih_jobs.contracts.fingerprint import (
    FingerprintInput,
    content_hash,
    fingerprint,
    primary_location,
)

from pilih_scraper.fetching import EngineFactory
from tests.support import (
    Site,
    VirtualClock,
    fixture_text,
    make_factory,
    run,
    scrape_body,
    titles,
    warning_codes,
)

RSS_CONFIG: dict[str, Any] = {
    "title_pattern": "company_title",
    "location_field": "region",
    "type_field": "type",
    "defaults": {"workplace_type": "remote"},
}


def _by_title(response: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(item["title"]): item for item in response["items"]}


# ---------------------------------------------------------------- rss
async def test_rss_company_title_feed(site: Site, factory: EngineFactory) -> None:
    site.xml("/remote-jobs.rss", fixture_text("wwr.rss"))
    body = scrape_body("rss", {**RSS_CONFIG, "url": site.url("/remote-jobs.rss")})
    response = await run(factory, body)
    assert response["outcome"] == "ok"
    assert response["complete"] is True
    assert response["error"] is None
    assert response["stats"]["postings_found"] == 3
    assert response["stats"]["invalid"] == 1  # no separator → no company → rejected
    items = _by_title(response)
    backend = items["Senior Backend Engineer"]
    assert backend["company_name"] == "Acme Corp"
    assert backend["source_kind"] == "generic_listing"
    assert backend["source_org"] == "localhost"
    assert backend["visibility"] == "public"
    assert backend["workplace_type"] == "remote"
    assert backend["employment_type"] == "full_time"
    assert backend["locations"] == [{"raw": "Anywhere"}]
    assert backend["extraction"]["method"] == "rss"
    assert backend["extraction"]["confidence"] == 0.85
    assert backend["extraction"]["cloud"]["source_id"].startswith("csr_")
    # the anti-fraud disclaimer is not a fraud signal
    assert not [f for f in backend["extraction"]["flags"] if f.startswith("suspicious")]
    extras = backend["extras"]
    assert extras["expires_at"] == 1794494765000
    assert extras["employment_detail"] == "full_time"
    assert {"Go", "PostgreSQL", "Kubernetes"} <= set(extras["skills"])
    assert extras["raw_metadata"]["country"] == "Indonesia"
    copywriter = items["Freelance Copywriter"]
    assert copywriter["employment_type"] == "contract"
    assert copywriter["extras"]["employment_detail"] == "freelance"
    assert copywriter["locations"][0]["country_code"] == "US"
    flags = copywriter["extraction"]["flags"]
    assert "suspicious:upfront_fee" in flags
    assert "suspicious:messaging_contact" in flags
    assert {"suspicious", "invalid_item"} <= warning_codes(response)


async def test_rss_fingerprint_matches_the_contract(site: Site, factory: EngineFactory) -> None:
    site.xml("/remote-jobs.rss", fixture_text("wwr.rss"))
    response = await run(
        factory, scrape_body("rss", {**RSS_CONFIG, "url": site.url("/remote-jobs.rss")})
    )
    for item in response["items"]:
        expected = fingerprint(
            FingerprintInput(
                source_kind="generic_listing",
                title=item["title"],
                source_org=item.get("source_org"),
                source_job_ref=item.get("source_job_ref"),
                company_domain=item.get("company_domain"),
                location_primary=primary_location(item["locations"]),
                apply_url=item.get("apply_url"),
                canonical_url=item.get("canonical_url"),
            )
        )
        assert item["fingerprint"] == expected
        assert item["content_hash"] == content_hash(item["title"], item["description_text"])
        assert item["client_ref"] == expected.removeprefix("fp1:")


async def test_atom_feed(site: Site, factory: EngineFactory) -> None:
    site.xml("/jobs.atom", fixture_text("jobs.atom"))
    config = {"url": site.url("/jobs.atom"), "title_pattern": "title_company"}
    response = await run(factory, scrape_body("rss", config))
    assert titles(response) == ["Data Analyst"]
    item = response["items"][0]
    assert item["company_name"] == "Initech"
    assert item["canonical_url"] == "https://example.org/jobs/data-analyst"
    assert item["employment_type"] == "part_time"
    assert item["source_job_ref"] == "tag:example.org,2026:job-77"


async def test_rss_namespaced_fields_and_employment_fallback(
    site: Site, factory: EngineFactory
) -> None:
    site.xml("/feed/job_feed/", fixture_text("job_feed.rss"))
    config = {
        "url": site.url("/feed/job_feed/"),
        "title_pattern": "title",
        "company_field": "job_listing:company",
        "location_field": "job_listing:location",
        "type_field": "job_listing:job_type",
    }
    response = await run(factory, scrape_body("rss", config))
    (item,) = response["items"]
    assert item["company_name"] == "ShyftCo"
    assert item["locations"][0]["country_code"] == "US"
    # job_type says "Support"; the contract type is in job_category
    assert item["employment_type"] == "contract"


async def test_rss_fetch_details_fills_company(site: Site, factory: EngineFactory) -> None:
    detail = site.url("/jobs/job/editor/")
    feed = f"""<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>Content Editor</title><link>{detail}</link>
      <description>Edit long-form articles for a blogging community, fully remote.</description>
    </item></channel></rss>"""
    site.xml("/jobs/rss", feed)
    posting = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Content Editor",
        "hiringOrganization": {"@type": "Organization", "name": "Blog Media"},
        "datePosted": "2026-10-10",
        "validThrough": "2026-11-10T00:00:00Z",
        "employmentType": "PART_TIME",
        "jobLocationType": "TELECOMMUTE",
    }
    site.html(
        "/jobs/job/editor/",
        f'<html><body><script type="application/ld+json">{json.dumps(posting)}</script>'
        "<h1>Content Editor</h1></body></html>",
    )
    config = {"url": site.url("/jobs/rss"), "title_pattern": "title", "fetch_details": True}
    response = await run(factory, scrape_body("rss", config, rate={"max_details": 5}))
    (item,) = response["items"]
    assert item["company_name"] == "Blog Media"
    assert item["employment_type"] == "part_time"
    assert item["extras"]["expires_at"] is not None
    assert item["extraction"]["source_urls"]["detail"] == detail
    assert response["stats"]["details_fetched"] == 1
    assert response["cursor_state"]["detail_seen"] == [detail]


# ---------------------------------------------------------------- json api
REMOTEOK_ITEMS: list[dict[str, Any]] = [
    {"legal": "Please link back to us when you use this API."},
    {
        "id": "1137498",
        "position": "Senior Sales Executive",
        "company": "SimSpace",
        "url": "https://remoteok.example/remote-jobs/1137498",
        "apply_url": "https://simspace.example/careers/1137498",
        "location": "",
        "date": "2026-10-11T08:00:04+00:00",
        "description": "<p>Sell cyber range software to enterprise customers across the US.</p>",
        "salary_min": 90000,
        "salary_max": 120000,
        "tags": ["sales", "saas", "cybersecurity"],
    },
]
REMOTEOK_FIELDS: dict[str, str] = {
    "title": "position",
    "company": "company",
    "url": "url",
    "apply_url": "apply_url",
    "location": "location",
    "posted_at": "date",
    "description_html": "description",
    "salary_min": "salary_min",
    "salary_max": "salary_max",
    "tags": "tags",
    "external_id": "id",
}


async def test_json_api_skips_the_leading_legal_item(site: Site, factory: EngineFactory) -> None:
    site.json("/api", REMOTEOK_ITEMS)
    config = {
        "url": site.url("/api"),
        "items_path": "",
        "skip_items": 1,
        "fields": REMOTEOK_FIELDS,
        "defaults": {"workplace_type": "remote"},
        "attribution": "Fixture board",
    }
    response = await run(factory, scrape_body("json_api", config))
    assert response["complete"] is True
    (item,) = response["items"]
    assert item["title"] == "Senior Sales Executive"
    assert item["source_job_ref"] == "1137498"
    assert item["salary"]["min"] == 90000
    assert item["salary"]["max"] == 120000
    assert item["extraction"]["method"] == "json_api"
    assert item["extraction"]["confidence"] == 0.95
    assert item["extras"]["application_method"] == "external_url"
    assert item["extras"]["raw_metadata"]["attribution"] == "Fixture board"
    assert "Cybersecurity" in item["extras"]["skills"]
    assert ("missing_field", "location") in {
        (w["code"], w.get("field")) for w in response["warnings"]
    }


async def test_json_api_unexpected_structure(site: Site, factory: EngineFactory) -> None:
    site.json("/api", {"jobs": {"not": "a list"}})
    config = {"url": site.url("/api"), "items_path": "jobs", "fields": REMOTEOK_FIELDS}
    response = await run(factory, scrape_body("json_api", config))
    assert response["outcome"] == "failed"
    assert response["error"]["error_class"] == "schema_invalid"
    assert "items_path" in response["error"]["message"]


async def test_max_items_truncates_and_marks_incomplete(site: Site, factory: EngineFactory) -> None:
    jobs = [
        {
            **REMOTEOK_ITEMS[1],
            "id": str(n),
            "position": f"Engineer {n}",
            "url": f"https://remoteok.example/remote-jobs/{n}",
        }
        for n in range(5)
    ]
    site.json("/api", jobs)
    config = {"url": site.url("/api"), "items_path": "", "fields": REMOTEOK_FIELDS}
    response = await run(factory, scrape_body("json_api", config, rate={"max_items": 2}))
    assert len(response["items"]) == 2
    assert response["complete"] is False
    assert "truncated" in warning_codes(response)


# ---------------------------------------------------------------- json-ld
def _posting(title: str, company: str = "Acme") -> dict[str, Any]:
    return {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": title,
        "hiringOrganization": {
            "@type": "Organization",
            "name": company,
            "sameAs": "https://acme.example",
        },
        "datePosted": "2026-10-10T00:00:00Z",
        "validThrough": "2020-01-01T00:00:00Z"
        if title == "Expired Role"
        else "2026-12-01T00:00:00Z",
        "employmentType": "FULL_TIME",
        "jobLocationType": "TELECOMMUTE",
        "description": f"<p>{title} at {company}: build software used across Indonesia every day.</p>",
        "identifier": {"@type": "PropertyValue", "value": title.lower().replace(" ", "-")},
        "skills": "Python, SQL",
        "jobBenefits": "Remote budget",
    }


def _ld_page(postings: list[dict[str, Any]], body: str = "") -> str:
    blocks = "".join(
        f'<script type="application/ld+json">{json.dumps(p)}</script>' for p in postings
    )
    return f"<html><head>{blocks}</head><body>{body}</body></html>"


async def test_json_ld_listing_to_details(site: Site, factory: EngineFactory) -> None:
    links = "".join(
        f'<a class="job-link" href="/jobs/{slug}">{slug}</a>' for slug in ("a", "b", "c")
    )
    site.html("/jobs", f"<html><body><main>{links}<a href='/about'>About</a></main></body></html>")
    site.html("/jobs/a", _ld_page([_posting("Backend Engineer")]))
    site.html("/jobs/b", _ld_page([_posting("Expired Role")]))
    site.html("/jobs/c", "<html><body><h1>No structured data</h1></body></html>")
    config = {"listing_url": site.url("/jobs"), "detail_link_selector": "a.job-link::attr(href)"}
    response = await run(factory, scrape_body("json_ld", config, rate={"max_details": 10}))
    assert response["complete"] is True
    items = _by_title(response)
    assert set(items) == {"Backend Engineer", "Expired Role"}
    backend = items["Backend Engineer"]
    assert backend["company_name"] == "Acme"
    assert backend["company_domain"] == "acme.example"
    assert backend["source_job_ref"] == "backend-engineer"
    assert backend["extraction"]["method"] == "json_ld"
    assert backend["extras"]["benefits"] == ["Remote budget"]
    expired = items["Expired Role"]
    assert expired["status_hint"] == "closed"
    assert "missing_jsonld" in warning_codes(response)
    assert len(response["cursor_state"]["detail_seen"]) == 3


async def test_json_ld_details_capped_is_incomplete(site: Site, factory: EngineFactory) -> None:
    links = "".join(f'<a class="job-link" href="/jobs/{n}">{n}</a>' for n in range(3))
    site.html("/jobs", f"<html><body>{links}</body></html>")
    for n in range(3):
        site.html(f"/jobs/{n}", _ld_page([_posting(f"Role {n}")]))
    config = {"listing_url": site.url("/jobs"), "detail_link_selector": "a.job-link"}
    first = await run(factory, scrape_body("json_ld", config, rate={"max_details": 2}))
    assert len(first["items"]) == 2
    assert first["complete"] is False
    second = await run(
        factory,
        scrape_body("json_ld", config, rate={"max_details": 2}, cursor=first["cursor_state"]),
    )
    # unseen details first: the third role is read on the next run
    assert "Role 2" in titles(second)


async def test_json_ld_item_list_under_main_entity(site: Site, factory: EngineFactory) -> None:
    collection = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "mainEntity": {
            "@type": "ItemList",
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": 1,
                    "name": "AI Music Producer",
                    "url": site.url("/jobs/upwork/210979/ai-music-producer"),
                    "description": "Client location: United States · Budget USD 250 fixed price",
                },
                {
                    "@type": "ListItem",
                    "position": 2,
                    "name": "Senior Backend Engineer",
                    "url": site.url("/jobs/seek/95220951/senior-backend-engineer"),
                    "description": "Build APIs for a marketplace in Jakarta.",
                },
            ],
        },
    }
    articles = (
        '<article class="public-job"><h2><a href="/jobs/upwork/210979/ai-music-producer">A</a></h2></article>'
        '<article class="public-job"><h2><a href="/jobs/seek/95220951/senior-backend-engineer">B</a></h2></article>'
    )
    site.html("/jobs", _ld_page([collection], articles))
    config = {
        "listing_url": site.url("/jobs"),
        "listing_jsonld": True,
        "detail_link_selector": "article.public-job h2 a",
        "defaults": {"company": "Undisclosed client", "workplace_type": "remote"},
    }
    response = await run(factory, scrape_body("json_ld", config))
    assert titles(response) == ["AI Music Producer", "Senior Backend Engineer"]
    assert response["stats"]["details_fetched"] == 0  # every link came from the ItemList
    for item in response["items"]:
        assert item["company_name"] == "Undisclosed client"
        assert item["extras"]["application_method"] == "platform_account"
        assert item["extras"]["auth_required"] is True


# ---------------------------------------------------------------- embedded json
async def test_embedded_next_data(site: Site, factory: EngineFactory) -> None:
    data = {
        "props": {
            "pageProps": {
                "jobs": [
                    {
                        "id": 7,
                        "title": "Growth Marketer",
                        "company": {"name": "Hooli"},
                        "slug": "/jobs/7",
                        "posted": "13 Oct",
                        "location": "Indonesia",
                    },
                ]
            }
        }
    }
    site.html(
        "/",
        f'<html><body><script id="__NEXT_DATA__" type="application/json">{json.dumps(data)}</script></body></html>',
    )
    config = {
        "url": site.url("/"),
        "items_path": "props.pageProps.jobs",
        "fields": {
            "title": "title",
            "url": "slug",
            "company": "company.name",
            "posted_at": "posted",
            "location": "location",
            "external_id": "id",
        },
    }
    response = await run(factory, scrape_body("embedded_json", config))
    (item,) = response["items"]
    assert item["company_name"] == "Hooli"
    assert item["canonical_url"] == site.url("/jobs/7")
    assert item["posted_at"] is not None  # "13 Oct" → this year (or last year)
    assert item["extraction"]["method"] == "embedded_json"
    assert item["locations"][0]["country_code"] == "ID"


async def test_embedded_global_assignment(site: Site, factory: EngineFactory) -> None:
    state = {
        "jobsState": {
            "entity": {
                "all": [
                    {
                        "id": 28060,
                        "title": "Sales Development Representative",
                        "company_name": "Huntress",
                        "job_type": "permanent",
                        "href": "remote-sales-jobs/sdr-huntress",
                    },
                ]
            }
        },
        "note": 'a } brace and "quotes" in a string',
    }
    script = f"window.__PRELOADED_STATE__ = {json.dumps(state)};\nwindow.other = 1;"
    site.html("/remote-jobs", f"<html><body><script>{script}</script></body></html>")
    config = {
        "url": site.url("/remote-jobs"),
        "global_name": "__PRELOADED_STATE__",
        "items_path": "jobsState.entity.all",
        "url_base": "https://justremote.example/",
        "fields": {
            "title": "title",
            "company": "company_name",
            "url": "href",
            "employment_type": "job_type",
            "external_id": "id",
        },
    }
    response = await run(factory, scrape_body("embedded_json", config))
    (item,) = response["items"]
    assert item["company_name"] == "Huntress"
    assert item["canonical_url"] == "https://justremote.example/remote-sales-jobs/sdr-huntress"
    assert item["employment_type"] == "full_time"


async def test_embedded_global_that_is_not_json(site: Site, factory: EngineFactory) -> None:
    site.html(
        "/remote-jobs",
        "<html><body><script>window.__PRELOADED_STATE__ = {jobs: [], fn: function(){}};</script></body></html>",
    )
    config = {
        "url": site.url("/remote-jobs"),
        "global_name": "__PRELOADED_STATE__",
        "items_path": "jobs",
        "fields": {"title": "title", "url": "href"},
    }
    response = await run(factory, scrape_body("embedded_json", config))
    assert response["error"]["error_class"] == "parse_error"
    assert "never executed" in response["error"]["message"]


# ---------------------------------------------------------------- html selectors + adaptive
HTML_CONFIG: dict[str, Any] = {
    "item": ".job-card",
    "fields": {
        "title": ".job-title",
        "link": ".job-link::attr(href)",
        "location": ".job-location",
    },
    "defaults": {"company": "Acme"},
}


async def test_html_selectors_then_adaptive_relocation(tmp_path: Path, site: Site) -> None:
    factory = make_factory(tmp_path, site, VirtualClock())
    site.html("/careers", fixture_text("listing_v1.html"))
    config = {**HTML_CONFIG, "url": site.url("/careers")}
    first = await run(factory, scrape_body("html_selectors", config))
    assert len(first["items"]) == 5
    assert {i["extraction"]["method"] for i in first["items"]} == {"css"}
    assert first["stats"]["relocated"] == 0
    # The board renames every class: Scrapling relocates the saved elements.
    site.reset()
    site.html("/careers", fixture_text("listing_v2.html"))
    second = await run(factory, scrape_body("html_selectors", config))
    items = _by_title(second)
    assert "Senior Backend Engineer" in items
    backend = items["Senior Backend Engineer"]
    assert backend["extraction"]["method"] == "adaptive"
    assert backend["extraction"]["confidence"] <= 0.6
    assert backend["canonical_url"].endswith("/jobs/1")
    assert second["stats"]["relocated"] >= 1
    assert "selector_drift" in warning_codes(second)


async def test_html_selector_matching_nothing_is_a_layout_change(
    site: Site, factory: EngineFactory
) -> None:
    site.html("/careers", "<html><body><main><p>We are redesigning.</p></main></body></html>")
    config = {**HTML_CONFIG, "url": site.url("/careers"), "adaptive": False}
    response = await run(factory, scrape_body("html_selectors", config, ai_fallback=True))
    assert response["error"]["error_class"] == "parse_error"
    assert "Layout changed" in response["error"]["message"]
    (candidate,) = response["ai_candidates"]
    assert candidate["reason"] == "no_items"
    assert "redesigning" in candidate["text"]


async def test_html_detail_page_json_ld(site: Site, factory: EngineFactory) -> None:
    site.html(
        "/jobs",
        '<div class="job-listings-item"><a class="job-details-link" href="/jobs/1"><h3>Backend Engineer</h3></a>'
        '<a class="job-info-link-item" href="/companies/acme">Acme</a><div class="job-posted-date">2 days ago</div></div>',
    )
    site.html("/jobs/1", _ld_page([_posting("Backend Engineer")]))
    config = {
        "url": site.url("/jobs"),
        "item": "div.job-listings-item",
        "fields": {
            "title": "a.job-details-link h3",
            "link": "a.job-details-link::attr(href)",
            "company": "a.job-info-link-item[href^='/companies/']",
            "posted_at": "div.job-posted-date",
        },
        "detail": {"enabled": True},
    }
    response = await run(factory, scrape_body("html_selectors", config))
    (item,) = response["items"]
    assert item["company_name"] == "Acme"
    assert len(item["description_text"]) > 50
    assert response["stats"]["details_fetched"] == 1


async def test_checkpoint_resume(site: Site, factory: EngineFactory) -> None:
    for page, following in ((1, 2), (2, 3), (3, None)):
        next_link = (
            f'<a rel="next" class="next" href="/jobs?page={following}">Next</a>'
            if following
            else ""
        )
        site.server.expect_request("/jobs", query_string=f"page={page}").respond_with_data(
            f'<div class="job-card"><h3 class="job-title">Role {page}</h3>'
            f'<a class="job-link" href="/jobs/{page}">Open</a></div>{next_link}',
            content_type="text/html",
        )
    config = {**HTML_CONFIG, "url": site.url("/jobs") + "?page=1", "next_page": "a.next"}
    first = await run(factory, scrape_body("html_selectors", config, rate={"max_pages": 1}))
    assert titles(first) == ["Role 1"]
    assert first["complete"] is False
    assert first["cursor_state"]["resume_url"].endswith("/jobs?page=2")
    second = await run(
        factory,
        scrape_body("html_selectors", config, rate={"max_pages": 5}, cursor=first["cursor_state"]),
    )
    assert titles(second) == ["Role 2", "Role 3"]
    assert second["complete"] is False  # a resumed run never counts absences
    assert "resume_url" not in second["cursor_state"]
    full = await run(factory, scrape_body("html_selectors", config, rate={"max_pages": 5}))
    assert titles(full) == ["Role 1", "Role 2", "Role 3"]
    assert full["complete"] is True
    assert "last_complete_at" in full["cursor_state"]


# ---------------------------------------------------------------- ai / config
async def test_ai_strategy_returns_page_text(site: Site, factory: EngineFactory) -> None:
    site.html(
        "/board",
        "<html><title>Board</title><body><p>Hiring: Senior Designer at Foo, remote.</p></body></html>",
    )
    response = await run(factory, scrape_body("ai", {"url": site.url("/board")}))
    assert response["items"] == []
    assert response["complete"] is False
    (candidate,) = response["ai_candidates"]
    assert candidate["reason"] == "strategy_ai"
    assert "Senior Designer" in candidate["text"]


async def test_invalid_config_and_strategy_none(site: Site, factory: EngineFactory) -> None:
    bad = await run(factory, scrape_body("rss", {"url": site.url("/feed")}))
    assert bad["error"]["error_class"] == "invalid_config"
    assert "title_pattern" in bad["error"]["message"]
    none = await run(factory, scrape_body("none", {}))
    assert none["error"]["error_class"] == "invalid_config"


async def test_browser_strategy_needs_allow_browser(site: Site, factory: EngineFactory) -> None:
    config = {**HTML_CONFIG, "url": site.url("/spa")}
    response = await run(factory, scrape_body("browser", config, allow_browser=False))
    assert response["error"]["error_class"] == "invalid_config"
    assert site.hits("/spa") == 0
