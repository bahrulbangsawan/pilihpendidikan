"""`POST /v1/directory`: the outbound links of a directory page (24 §7)."""

from __future__ import annotations

from typing import Any, Final
from urllib.parse import urldefrag, urljoin, urlsplit

from pilih_jobs.contracts._generated.cloud import DirectoryConfig, DirectoryResponse
from pilih_jobs.contracts.psl import registrable_domain
from pilih_jobs.discovery.errors import DiscoveryError, PolicyViolation
from pilih_jobs.discovery.types import FetchMode

from pilih_scraper import fetching
from pilih_scraper.context import RunContext
from pilih_scraper.errors import error_dict, from_discovery
from pilih_scraper.scrape import versions

DIRECTORY_DEADLINE_MS: Final = 60_000
MAX_ENTRIES: Final = 500


def _domain(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower().rstrip(".")
    return registrable_domain(host) or host


async def directory(body: dict[str, Any], factory: fetching.EngineFactory) -> dict[str, Any]:
    cfg = DirectoryConfig.model_validate(body["directory"])
    ctx = RunContext(run_id=None, deadline_ms=DIRECTORY_DEADLINE_MS)
    engine = factory.make(allow_browser=False)
    host = _domain(cfg.url)
    ref = fetching.source_ref(
        key=f"directory:{host}", org=host, min_delay_ms=1000, allow_browser=False, source_id=None
    )
    response: dict[str, Any] = {
        "v": 1,
        "final_url": None,
        "http_status": None,
        "entries": [],
        "error": None,
    }
    try:
        result = await engine.fetch_listing(
            fetching.request(cfg.url, FetchMode.STATIC_HTML), source=ref
        )
        response.update(final_url=result.url[:2048], http_status=result.status)
        ctx.add_log(
            "info",
            "page_fetched",
            f"{result.body_size} bytes",
            url=result.url,
            http_status=result.status,
            ms=result.elapsed_ms,
        )
        page = fetching.as_page(result)
        raw_entries = (
            fetching.link_entries(
                page,
                cfg.link_selector,
                name_selector=cfg.name_selector,
                description_selector=cfg.description_selector,
                anchor_attr=cfg.anchor_attr,
            )
            if page is not None
            else []
        )
        entries: list[dict[str, Any]] = []
        seen: set[str] = set()
        internal = 0
        for raw in raw_entries:
            href = raw["href"] or ""
            url = urldefrag(urljoin(result.url, href))[0]
            if urlsplit(url).scheme not in ("http", "https") or len(url) < 10:
                continue
            if _domain(url) == host:
                internal += 1
                continue
            if url in seen:
                continue
            seen.add(url)
            name = (raw["name"] or urlsplit(url).hostname or url)[:200]
            entries.append(
                {
                    "name": name,
                    "url": url[:2048],
                    "description": (raw["description"] or None) and str(raw["description"])[:500],
                    "anchor": (raw["anchor"] or None) and str(raw["anchor"])[:200],
                }
            )
            if len(entries) >= MAX_ENTRIES:
                break
        response["entries"] = entries
        ctx.add_log(
            "info",
            "directory_parsed",
            f"{len(entries)} outbound entries ({internal} internal links skipped)",
            url=result.url,
        )
        if not entries:
            response["error"] = error_dict(
                "parse_error",
                f"Layout changed: {cfg.link_selector!r} matched no outbound links on {result.url}.",
                url=result.url,
            )
    except DiscoveryError as exc:
        response["error"] = from_discovery(exc)
        response["http_status"] = exc.http_status
    except PolicyViolation as exc:
        response["error"] = error_dict("policy_blocked", f"Refused by the discovery policy: {exc}")
    finally:
        await engine.aclose()
    response["log"] = ctx.final_log()
    response["engine"] = versions()
    DirectoryResponse.model_validate(response)
    return response
