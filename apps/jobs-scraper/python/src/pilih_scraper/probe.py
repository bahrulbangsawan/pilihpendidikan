"""`POST /v1/probe`: what a site offers before it becomes a source (24 §7.3).

Robots first (a disallowed URL is never fetched), then the page: protection markers,
login / paywall, title and meta description, verified feeds (advertised
`rel=alternate` links plus a few conventional paths, recorded only when they parse
with at least one item), JSON-LD JobPostings, embedded JSON, job-like links and a text
excerpt. Nothing here guesses: every feed listed was fetched and parsed.
"""

from __future__ import annotations

import re
from typing import Any, Final
from urllib.parse import urljoin, urlsplit

from pilih_jobs.adapters.jsonld import job_postings
from pilih_jobs.contracts._generated.cloud import ProbeResponse
from pilih_jobs.discovery.errors import DiscoveryError, PolicyViolation
from pilih_jobs.discovery.types import FetchMode, FetchResult

from pilih_scraper import fetching, signals
from pilih_scraper.context import RunContext
from pilih_scraper.errors import ScrapeStop, error_dict, from_discovery
from pilih_scraper.scrape import versions
from pilih_scraper.strategies.rss import parse_feed

PROBE_DEADLINE_MS: Final = 90_000
EXCERPT_MAX: Final = 4096
CONVENTIONAL_FEEDS: Final = ("/feed", "/rss", "/jobs.rss", "/remote-jobs.rss", "/?feed=job_feed")
MAX_FEED_CHECKS: Final = 8
_EMBEDDED: Final = (
    ("__NEXT_DATA__", re.compile(r'id=["\']__NEXT_DATA__["\']')),
    ("__NUXT__", re.compile(r"window\.__NUXT__\s*=|__NUXT_DATA__")),
    ("__PRELOADED_STATE__", re.compile(r"window\.__PRELOADED_STATE__\s*=")),
    ("__INITIAL_STATE__", re.compile(r"window\.__INITIAL_STATE__\s*=")),
    ("__APOLLO_STATE__", re.compile(r"window\.__APOLLO_STATE__\s*=")),
)
_JOB_PATH: Final = re.compile(
    r"/(?:jobs?|careers?|vacanc\w*|lowongan|loker|positions?|openings?|remote-[a-z-]*jobs?)/[^/?#]{3,}",
    re.IGNORECASE,
)


def _feed_candidates(result: FetchResult) -> list[tuple[str, str]]:
    page = fetching.as_page(result)
    found: list[tuple[str, str]] = []
    if page is not None:
        for kind in ("rss", "atom"):
            for href in fetching.attr_values(
                page, f'link[rel="alternate"][type*="{kind}"]', "href"
            ):
                url = urljoin(result.url, href)
                if urlsplit(url).scheme in ("http", "https") and url not in (u for u, _ in found):
                    found.append((url, kind))
    origin = f"{urlsplit(result.url).scheme}://{urlsplit(result.url).netloc}"
    for path in CONVENTIONAL_FEEDS:
        url = origin + path
        if url not in (u for u, _ in found):
            found.append((url, "rss"))
    return found[:MAX_FEED_CHECKS]


async def probe(body: dict[str, Any], factory: fetching.EngineFactory) -> dict[str, Any]:
    url = str(body["url"])
    ctx = RunContext(run_id=None, deadline_ms=PROBE_DEADLINE_MS)
    host = (urlsplit(url).hostname or "").lower()
    engine = factory.make(allow_browser=False)
    ref = fetching.source_ref(
        key=f"probe:{host}", org=host, min_delay_ms=1000, allow_browser=False, source_id=None
    )
    response: dict[str, Any] = {
        "v": 1,
        "url": url[:2048],
        "final_url": None,
        "http_status": None,
        "reachable": False,
        "robots": {"fetched": False, "allowed": None, "crawl_delay_s": None},
        "protection": None,
        "auth_wall": False,
        "title": None,
        "meta_description": None,
        "feeds": [],
        "jsonld_job_postings": 0,
        "embedded_json": [],
        "job_link_count": 0,
        "text_excerpt": "",
        "error": None,
    }
    try:
        decision = await engine.robots.check(url)
        response["robots"] = {
            "fetched": engine.robots.cached(url) is not None,
            "allowed": decision.allowed,
            "crawl_delay_s": decision.crawl_delay_s,
        }
        if not decision.allowed:
            response["error"] = error_dict(
                "robots_disallowed",
                f"robots.txt of {host} disallows {urlsplit(url).path or '/'} ({decision.reason}).",
                url=url,
            )
            ctx.add_log(
                "warn", "robots_disallowed", "Not fetched: robots.txt disallows it", url=url
            )
        else:
            result = await engine.fetch_listing(
                fetching.request(url, FetchMode.STATIC_HTML), source=ref
            )
            await _analyse(response, ctx, engine, ref, url, result)
    except DiscoveryError as exc:
        response["error"] = from_discovery(exc)
        response["reachable"] = exc.http_status is not None
        response["http_status"] = exc.http_status
        if exc.error_class == "challenge_detected":
            response["protection"] = exc.marker or "challenge"
        ctx.add_log(
            "warn",
            "probe_error",
            str(response["error"]["message"]),
            url=exc.url,
            http_status=exc.http_status,
        )
    except PolicyViolation as exc:
        response["error"] = error_dict("policy_blocked", f"Refused by the discovery policy: {exc}")
    except ScrapeStop as stop:
        response["error"] = error_dict(stop.error_class, stop.message, url=stop.url)
    finally:
        await engine.aclose()
    response["log"] = ctx.final_log()
    response["engine"] = versions()
    ProbeResponse.model_validate(response)
    return response


async def _analyse(
    response: dict[str, Any],
    ctx: RunContext,
    engine: Any,
    ref: Any,
    url: str,
    result: FetchResult,
) -> None:
    response.update(final_url=result.url[:2048], http_status=result.status, reachable=True)
    ctx.add_log(
        "info",
        "page_fetched",
        f"{result.body_size} bytes",
        url=result.url,
        http_status=result.status,
        ms=result.elapsed_ms,
    )
    page = fetching.as_page(result)
    raw = fetching.raw_text(result)
    if page is not None:
        text = page.visible_text()
        response["title"] = (page.title() or "")[:300] or None
        description = page.meta_content("description", "og:description")
        response["meta_description"] = description[:500] if description else None
        response["text_excerpt"] = text[:EXCERPT_MAX]
        response["jsonld_job_postings"] = len(job_postings(page.json_ld()))
        links = page.links()
        site = (urlsplit(result.url).hostname or "").lower()
        response["job_link_count"] = sum(
            1
            for link in links
            if (urlsplit(link).hostname or "").lower() == site
            and _JOB_PATH.search(urlsplit(link).path)
        )
        password = fetching.count(page, 'input[type="password"]') > 0
        response["auth_wall"] = bool(
            signals.login_redirect(url, result.url)
            or (password and len(text) < 4500)
            or signals.paywall_text(text)
        )
    response["embedded_json"] = [name for name, pattern in _EMBEDDED if pattern.search(raw)]
    feeds: list[dict[str, Any]] = []
    for feed_url, _kind in _feed_candidates(result):
        if ctx.out_of_time(10_000):
            break
        try:
            feed_result = await engine.fetch(
                fetching.request(feed_url, FetchMode.STATIC_HTML, purpose="detail"), source=ref
            )
            kind, entries = parse_feed(fetching.raw_text(feed_result))
        except (DiscoveryError, ScrapeStop) as exc:
            ctx.add_log(
                "info", "feed_rejected", f"No usable feed ({exc.error_class})", url=feed_url
            )
            continue
        if not entries:
            continue
        titles: list[str] = []
        for entry in entries[:5]:
            title = next(
                (
                    "".join(c.itertext()).strip()
                    for c in list(entry)
                    if str(c.tag).rsplit("}", 1)[-1] == "title"
                ),
                "",
            )
            if title:
                titles.append(title[:300])
        feeds.append(
            {
                "type": kind,
                "url": feed_result.url[:2048],
                "items": len(entries),
                "sample_titles": titles,
            }
        )
        ctx.add_log(
            "info", "feed_verified", f"{kind} feed with {len(entries)} items", url=feed_result.url
        )
    response["feeds"] = feeds[:10]
