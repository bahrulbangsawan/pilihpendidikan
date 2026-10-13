"""A single job URL (15 §14.3) — `discover --url`, or a manual add in the web app.

JSON-LD → OpenGraph → page heuristics (the largest `<h1>` for the title, the main content
block for the description). LinkedIn / Indeed URLs are refused before any request
(D-17); with `private=true` the posting is stored as `visibility = private` (03 §4.1).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from dataclasses import asdict
from typing import Any, cast
from urllib.parse import urlsplit

from pilih_jobs.adapters.base import AdapterContext, AdapterItem, SourceAdapter
from pilih_jobs.adapters.jsonld import draft_from_page, job_postings, jobposting_ref
from pilih_jobs.contracts.adapters import excluded_source_for_host
from pilih_jobs.discovery.errors import DiscoveryError, ExcludedSourceError
from pilih_jobs.discovery.normalize import PostingDraft
from pilih_jobs.discovery.types import FetchMode, FetchRequest, ProgressEvent, RawPosting


class CustomUrlAdapter(SourceAdapter):
    id = "custom_url"

    def source_org(self, config: Mapping[str, Any]) -> str:
        return (urlsplit(str(config["url"])).hostname or "").lower()

    def validate_config(self, config: Mapping[str, Any]) -> dict[str, Any]:
        url = config.get("url")
        if isinstance(url, str):
            excluded = excluded_source_for_host(url)
            if excluded is not None:
                raise ExcludedSourceError(
                    f"{excluded.display_name} is excluded from discovery (D-17): {excluded.reason}",
                    details={"source": str(excluded.id), "url": url},
                    hint="Track the job manually by title and company instead.",
                )
        return super().validate_config(config)

    async def discover(
        self, ctx: AdapterContext, cfg: Mapping[str, Any]
    ) -> AsyncIterator[AdapterItem]:
        url = str(cfg["url"])
        conditional = "etag" in self.incremental
        result = await ctx.engine.fetch_listing(
            FetchRequest(
                url,
                FetchMode.STATIC_HTML,
                etag=ctx.cursor.listing_etag if conditional else None,
                last_modified=ctx.cursor.listing_last_modified if conditional else None,
            ),
            source=ctx.source,
        )
        if result.not_modified:
            yield ProgressEvent("not_modified", {"url": url})
            yield ProgressEvent("complete", {"complete": True})
            return
        if result.page is None:
            raise DiscoveryError(
                "unsupported_content", "the URL did not return an HTML page", url=url
            )
        draft, method = draft_from_page(result.page)
        postings = job_postings(result.page.json_ld())
        yield ProgressEvent(
            "page",
            {
                "page": 1,
                "items": 1,
                "mode": result.fetch_mode.value,
                "elapsed_ms": result.elapsed_ms,
            },
        )
        yield RawPosting(
            adapter_id=self.id,
            source_org=self.source_org(cfg),
            source_job_ref=jobposting_ref(postings[0]) if postings else None,
            data={"draft": asdict(draft)},
            listing_url=url,
            detail_url=result.url,
            fetch_mode=result.fetch_mode,
            method="json_ld" if method == "json_ld" else "css",
            flags=[] if method == "json_ld" else ["heuristic"],
        )
        yield ProgressEvent(
            "cursor",
            {"etag": result.header("etag"), "last_modified": result.header("last-modified")},
        )
        yield ProgressEvent("complete", {"complete": True})

    def to_normalized(self, raw: RawPosting) -> PostingDraft:
        return PostingDraft(**cast(dict[str, Any], raw.data.get("draft") or {}))
