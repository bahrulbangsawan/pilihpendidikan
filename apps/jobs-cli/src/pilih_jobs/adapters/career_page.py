"""Careers pages (15 §14.3) — stable.

1. A URL on a known ATS host is redirected to that ATS adapter (`boards.greenhouse.io/acme`
   → `greenhouse{board_token: acme}`); so is a page whose only job content is a link or
   embed of such a board.
2. **JSON-LD first:** `<script type="application/ld+json">` `JobPosting`s (also inside
   `@graph` / `ItemList`).
3. Otherwise the configured `item_css` + `fields` selectors, with Scrapling adaptive
   relocation (15 §6).
4. Static HTML without the data and `allow_browser` enabled (per source and globally) →
   one BROWSER fetch of the page; else `unsupported_content` (no silent escalation, and
   never after a 403/challenge).

Pagination follows `rel=next` or the configured `next_css` on the same host (≤ 50 pages).
Items without a description get one detail fetch of their URL (JSON-LD, then the page's
main content).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Mapping
from dataclasses import asdict
from typing import Any, Final, cast
from urllib.parse import urlsplit

from pilih_jobs.adapters.ats_links import AtsTarget, ats_target
from pilih_jobs.adapters.base import AdapterContext, AdapterItem, SourceAdapter
from pilih_jobs.adapters.jsonld import (
    draft_from_jobposting,
    draft_from_page,
    job_postings,
    jobposting_ref,
)
from pilih_jobs.discovery.errors import DiscoveryError, PolicyViolation
from pilih_jobs.discovery.jsonutil import obj
from pilih_jobs.discovery.normalize import PostingDraft
from pilih_jobs.discovery.types import (
    ExtractionSpec,
    FetchMode,
    FetchRequest,
    FetchResult,
    FieldSpec,
    ProgressEvent,
    RawPosting,
)

DEFAULT_TITLE_CSS: Final = "h2, h3, h4, a"
_URL_FIELDS: Final = frozenset({"url", "apply_url", "link"})
_HTML_FIELDS: Final = frozenset({"description", "description_html"})


def extraction_spec(adapter_id: str, cfg: Mapping[str, Any]) -> ExtractionSpec | None:
    fields = obj(cfg.get("fields"))
    item_css = cfg.get("item_css")
    if not item_css and not fields:
        return None
    specs: list[FieldSpec] = []
    for name, css in fields.items():
        if not isinstance(css, str) or not css:
            continue
        if name in _URL_FIELDS:
            specs.append(FieldSpec("url", css=css, attr="href"))
        elif name in _HTML_FIELDS:
            specs.append(FieldSpec("description", css=css, html=True))
        else:
            specs.append(FieldSpec(name, css=css, required=name == "title"))
    names = {s.name for s in specs}
    if "title" not in names:
        specs.insert(0, FieldSpec("title", css=DEFAULT_TITLE_CSS, required=True))
    if "url" not in names:
        specs.append(FieldSpec("url", css="a", attr="href"))
    return ExtractionSpec(
        identifier_prefix=adapter_id,
        item_css=item_css if isinstance(item_css, str) and item_css else None,
        fields=tuple(specs),
        prefer_json_ld=True,
    )


def draft_from_fields(values: Mapping[str, Any]) -> PostingDraft:
    def text(key: str) -> str | None:
        value = values.get(key)
        return value if isinstance(value, str) and value else None

    location = text("location")
    return PostingDraft(
        title=text("title"),
        company_name=text("company"),
        locations=[location] if location else [],
        employment_type=text("employment") or text("employment_type"),
        salary_text=text("salary"),
        description_html=text("description"),
        apply_url=text("url"),
        canonical_url=text("url"),
        posted_at=text("posted") or text("posted_at"),
        department=text("department"),
    )


def merge_drafts(primary: PostingDraft, fallback: PostingDraft) -> PostingDraft:
    """Fill the empty fields of `primary` from `fallback`."""
    merged = asdict(primary)
    for key, value in asdict(fallback).items():
        if merged.get(key) in (None, "", [], {}):
            merged[key] = value
    return PostingDraft(**merged)


class CareerPageAdapter(SourceAdapter):
    id = "career_page"

    def source_org(self, config: Mapping[str, Any]) -> str:
        return (urlsplit(str(config["url"])).hostname or "").lower()

    # ------------------------------------------------------------------ redirect
    async def _redirect(
        self, ctx: AdapterContext, target: AtsTarget, via: str
    ) -> AsyncIterator[AdapterItem]:
        if target.opt_in_required or ctx.adapter_for is None:
            raise PolicyViolation(
                "This careers page is a Workday site; Workday tenants are opt-in. Add the "
                "tenant as a Workday source in the web app instead.",
                details={"url": via},
            )
        adapter = ctx.adapter_for(target.adapter_id)
        cfg = adapter.validate_config(target.config)
        source = adapter.source_ref(
            cfg, source_id=ctx.source.source_id, key=f"{ctx.source.key}→{target.adapter_id}"
        )
        yield ProgressEvent(
            "redirect",
            {
                "adapter": target.adapter_id,
                "source_org": adapter.source_org(cfg),
                "url": via,
                "source_ref": source,
                "config": cfg,
            },
        )
        async for item in adapter.discover(ctx.for_source(source), cfg):
            yield item

    # ------------------------------------------------------------------ discovery
    def _next_page(
        self, cfg: Mapping[str, Any], host: str, mode: FetchMode
    ) -> Callable[[FetchResult], FetchRequest | None]:
        seen: set[str] = set()
        next_css = cfg.get("next_css")

        def follow(result: FetchResult) -> FetchRequest | None:
            page = result.page
            if page is None:
                return None
            seen.add(result.url)
            if isinstance(next_css, str) and next_css:
                links = page.links(next_css)
                target = links[0] if links else None
            else:
                target = page.rel_next()
            if not target or target in seen or (urlsplit(target).hostname or "").lower() != host:
                return None
            return FetchRequest(target, mode)

        return follow

    def _items(
        self, ctx: AdapterContext, cfg: Mapping[str, Any], result: FetchResult
    ) -> list[RawPosting]:
        page = result.page
        if page is None:
            return []
        org = self.source_org(cfg)
        out: list[RawPosting] = []
        for posting in job_postings(page.json_ld()):
            url = posting.get("url") if isinstance(posting.get("url"), str) else None
            out.append(
                RawPosting(
                    adapter_id=self.id,
                    source_org=org,
                    source_job_ref=jobposting_ref(posting),
                    data={"json_ld": posting, "page_url": page.url},
                    listing_url=result.url,
                    detail_url=url if url and url != page.url else None,
                    fetch_mode=result.fetch_mode,
                    method="json_ld",
                    needs_detail=not posting.get("description") and bool(url and url != page.url),
                )
            )
        if out:
            return out
        spec = extraction_spec(self.id, cfg)
        if spec is None:
            return []
        for outcome in ctx.engine.extract_items(result, spec, source=ctx.source):
            values = outcome.values
            url = values.get("url") if isinstance(values.get("url"), str) else None
            out.append(
                RawPosting(
                    adapter_id=self.id,
                    source_org=org,
                    source_job_ref=None,
                    data={
                        "fields": values,
                        "page_url": page.url,
                        "missing_required": list(outcome.missing_required),
                    },
                    listing_url=result.url,
                    detail_url=url,
                    fetch_mode=result.fetch_mode,
                    method=outcome.method,
                    relocated_fields=list(outcome.relocated_fields),
                    needs_detail=not values.get("description") and bool(url),
                    extraction=[outcome],
                )
            )
        return out

    def _board_link(self, result: FetchResult) -> AtsTarget | None:
        page = result.page
        if page is None:
            return None
        candidates = page.links()
        for selector in ("iframe", "script"):
            for attr in ("src", "data-src"):
                value = page.first_attr(f"{selector}[{attr}]", attr)
                if value:
                    candidates.append(value)
        for link in candidates:
            target = ats_target(link)
            if target is not None and not target.opt_in_required:
                return target
        return None

    async def discover(
        self, ctx: AdapterContext, cfg: Mapping[str, Any]
    ) -> AsyncIterator[AdapterItem]:
        url = str(cfg["url"])
        direct = ats_target(url)
        if direct is not None:
            async for item in self._redirect(ctx, direct, url):
                yield item
            return
        host = self.source_org(cfg)
        conditional = "etag" in self.incremental
        first = FetchRequest(
            url,
            FetchMode.STATIC_HTML,
            etag=ctx.cursor.listing_etag if conditional else None,
            last_modified=ctx.cursor.listing_last_modified if conditional else None,
        )
        mode = FetchMode.STATIC_HTML
        cap = min(ctx.max_pages, self.max_pages())
        number = 0
        async for result in ctx.engine.iter_listing_pages(
            first, source=ctx.source, next_page=self._next_page(cfg, host, mode), max_pages=cap
        ):
            number += 1
            if result.not_modified:
                yield ProgressEvent("not_modified", {"url": url})
                yield ProgressEvent("complete", {"complete": True})
                return
            items = self._items(ctx, cfg, result)
            if number == 1 and not items:
                board = self._board_link(result)
                if board is not None:
                    async for item in self._redirect(ctx, board, url):
                        yield item
                    return
                if cfg.get("allow_browser") is True and ctx.engine.browser_enabled(ctx.source):
                    async for item in self._browser_pass(ctx, cfg, url):
                        yield item
                    return
                raise DiscoveryError(
                    "unsupported_content",
                    "no JobPosting JSON-LD, no matching selectors and no ATS board link on "
                    "the careers page (configure item_css/fields, or enable browser "
                    "discovery for client-rendered pages)",
                    url=url,
                )
            if number == 1:
                yield ProgressEvent(
                    "cursor",
                    {
                        "etag": result.header("etag"),
                        "last_modified": result.header("last-modified"),
                    },
                )
            yield ProgressEvent(
                "page",
                {
                    "page": number,
                    "items": len(items),
                    "mode": result.fetch_mode.value,
                    "elapsed_ms": result.elapsed_ms,
                },
            )
            for item in items:
                yield item
            if ctx.cancel.is_set():
                yield ProgressEvent("complete", {"complete": False, "reason": "cancelled"})
                return
        truncated = ctx.engine.listing_truncated(ctx.source)
        yield ProgressEvent("complete", {"complete": not truncated})

    async def _browser_pass(
        self, ctx: AdapterContext, cfg: Mapping[str, Any], url: str
    ) -> AsyncIterator[AdapterItem]:
        result = await ctx.engine.fetch_listing(
            FetchRequest(url, FetchMode.BROWSER, wait_selector=cfg.get("item_css") or None),
            source=ctx.source,
        )
        items = self._items(ctx, cfg, result)
        if not items:
            raise DiscoveryError(
                "unsupported_content", "no postings found on the rendered page", url=url
            )
        yield ProgressEvent(
            "page",
            {"page": 1, "items": len(items), "mode": "browser", "elapsed_ms": result.elapsed_ms},
        )
        for item in items:
            yield item
        yield ProgressEvent("complete", {"complete": True})

    async def fetch_detail(
        self, ctx: AdapterContext, cfg: Mapping[str, Any], raw: RawPosting
    ) -> RawPosting:
        if not raw.detail_url:
            return raw
        result = await ctx.engine.fetch_detail(
            FetchRequest(raw.detail_url, FetchMode.STATIC_HTML, purpose="detail"), source=ctx.source
        )
        if result.page is None:
            return raw
        draft, method = draft_from_page(result.page)
        raw.data = {**raw.data, "detail": asdict(draft), "detail_method": method}
        raw.needs_detail = False
        return raw

    def to_normalized(self, raw: RawPosting) -> PostingDraft:
        data = raw.data
        page_url = data.get("page_url")
        if isinstance(data.get("json_ld"), dict):
            draft = draft_from_jobposting(cast(dict[str, Any], data["json_ld"]), page_url=None)
            if not draft.apply_url and isinstance(page_url, str):
                draft.apply_url = page_url
                draft.canonical_url = page_url
        else:
            draft = draft_from_fields(cast(Mapping[str, Any], data.get("fields") or {}))
        detail = data.get("detail")
        if isinstance(detail, dict):
            draft = merge_drafts(draft, PostingDraft(**cast(dict[str, Any], detail)))
        return draft
