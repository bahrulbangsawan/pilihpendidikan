"""`POST /v1/preflight` (24 §4.4): may the scraper Worker render this URL?

Runs the same gates as a fetch — D-17 exclusions, the SSRF guard and the robots
gate for the honest UA — without fetching the page, and returns the host's
robots.txt so the Worker blocks the render's own robots-disallowed requests.
"""

from __future__ import annotations

from typing import Any

from pilih_jobs.discovery.engine.policy import honest_user_agent
from pilih_jobs.discovery.errors import DiscoveryError

from pilih_scraper import fetching
from pilih_scraper.errors import error_dict

ROBOTS_MAX_CHARS = 524_288


async def preflight(body: dict[str, Any], factory: fetching.EngineFactory) -> dict[str, Any]:
    url = str(body["url"])
    engine = factory.make(allow_browser=False)
    answer: dict[str, Any] = {
        "v": 1,
        "allowed": False,
        "user_agent": honest_user_agent(),
        "robots_txt": None,
        "crawl_delay_s": None,
        "error": None,
    }
    try:
        decision, robots = await engine.preflight(url)
        answer["allowed"] = decision.allowed
        answer["crawl_delay_s"] = decision.crawl_delay_s
        answer["robots_txt"] = robots[:ROBOTS_MAX_CHARS] if robots else None
        if not decision.allowed:
            answer["error"] = error_dict(
                "robots_disallowed", f"robots.txt disallows {url} ({decision.reason})", url=url
            )
    except DiscoveryError as exc:
        answer["error"] = error_dict(
            exc.error_class, exc.detail, http_status=exc.http_status, url=exc.url or url
        )
    finally:
        await engine.aclose()
    return answer
