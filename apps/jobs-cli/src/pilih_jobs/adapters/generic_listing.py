"""Generic job listings (15 §14.3) — beta.

A Scrapling spider (`engine.crawl`) walks one site from `start_url`: listing pages
matching `listing_url_pattern` (or `rel=next`), detail pages matching
`detail_url_pattern`, the site's sitemap when robots.txt lists one; ≤ `max_pages` (≤ 50)
listing pages. Each detail page is read JSON-LD first, then OpenGraph and page
heuristics. Checkpoints live under `<data>/crawls/<src_id>/` for configured sources only.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator, Mapping
from dataclasses import asdict
from typing import Any, cast
from urllib.parse import urlsplit

from pilih_jobs.adapters.base import AdapterContext, AdapterItem, SourceAdapter
from pilih_jobs.adapters.jsonld import draft_from_page, job_postings, jobposting_ref
from pilih_jobs.discovery.errors import SOURCE_FATAL
from pilih_jobs.discovery.normalize import PostingDraft
from pilih_jobs.discovery.types import CrawlConfig, FetchMode, ProgressEvent, RawPosting
from pilih_jobs.errors import ConfigError


class GenericListingAdapter(SourceAdapter):
    id = "generic_listing"

    def source_org(self, config: Mapping[str, Any]) -> str:
        return (urlsplit(str(config["start_url"])).hostname or "").lower()

    def validate_config(self, config: Mapping[str, Any]) -> dict[str, Any]:
        cfg = super().validate_config(config)
        for key in ("detail_url_pattern", "listing_url_pattern"):
            pattern = cfg.get(key)
            if isinstance(pattern, str) and pattern:
                try:
                    re.compile(pattern)
                except re.error as exc:
                    raise ConfigError(
                        f"config.{key} is not a valid regular expression: {exc}"
                    ) from exc
        return cfg

    async def discover(
        self, ctx: AdapterContext, cfg: Mapping[str, Any]
    ) -> AsyncIterator[AdapterItem]:
        browser = cfg.get("allow_browser") is True and ctx.engine.browser_enabled(ctx.source)
        config = CrawlConfig(
            start_url=str(cfg["start_url"]),
            detail_url_pattern=str(cfg["detail_url_pattern"]),
            listing_url_pattern=cast(str | None, cfg.get("listing_url_pattern")) or None,
            max_pages=max(1, min(int(cfg["max_pages"]), ctx.max_pages, self.max_pages())),
            crawl_dir=ctx.crawl_dir,
            cancel=ctx.cancel,
            mode=FetchMode.BROWSER if browser else FetchMode.STATIC_HTML,
        )
        org = self.source_org(cfg)
        listing_pages = 0
        async for event in ctx.engine.crawl(config, source=ctx.source):
            if event.kind == "listing":
                listing_pages += 1
                yield ProgressEvent(
                    "page",
                    {"page": listing_pages, "items": 0, "mode": config.mode.value, "elapsed_ms": 0},
                )
            elif (
                event.kind == "detail"
                and event.result is not None
                and event.result.page is not None
            ):
                page = event.result.page
                draft, method = draft_from_page(page)
                postings = job_postings(page.json_ld())
                yield RawPosting(
                    adapter_id=self.id,
                    source_org=org,
                    source_job_ref=jobposting_ref(postings[0]) if postings else None,
                    data={"draft": asdict(draft)},
                    listing_url=config.start_url,
                    detail_url=event.url,
                    fetch_mode=config.mode,
                    method="json_ld" if method == "json_ld" else "css",
                    flags=[] if method == "json_ld" else ["heuristic"],
                )
            elif event.kind == "error" and event.error is not None:
                error = event.error
                if error.error_class in SOURCE_FATAL or error.error_class in ctx.source.stop_on:
                    raise error
                yield ProgressEvent("warning", error.as_dict())
            elif event.kind == "finished":
                stats = dict(event.stats)
                yield ProgressEvent("complete", {**stats, "complete": bool(stats.get("complete"))})

    def to_normalized(self, raw: RawPosting) -> PostingDraft:
        return PostingDraft(**cast(dict[str, Any], raw.data.get("draft") or {}))
