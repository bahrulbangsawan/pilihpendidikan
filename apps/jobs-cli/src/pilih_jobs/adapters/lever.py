"""Lever Postings API (15 §14.3) — stable.

`GET https://api.lever.co/v0/postings/{site}?mode=json&skip=N&limit=100` (EU:
`api.eu.lever.co`), offset pagination (100 per page, ≤ 50 pages), optional filters
`location`, `commitment`, `team`, `department`. The listing carries the full description,
lists and salary range, so no detail fetch is needed; `check_open` GETs
`…/postings/{site}/{id}` (404 → closed).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from typing import Any, Final
from urllib.parse import quote, urlencode

from pydantic import BaseModel, ConfigDict

from pilih_jobs.adapters.base import (
    AdapterContext,
    AdapterItem,
    SourceAdapter,
    not_found_check,
    parse_model,
)
from pilih_jobs.adapters.endpoints import base_url
from pilih_jobs.discovery.errors import DiscoveryError
from pilih_jobs.discovery.htmltext import REQUIREMENTS_HEADING, requirements_from_html
from pilih_jobs.discovery.jsonutil import arr, number, obj, objs, strs, text
from pilih_jobs.discovery.normalize import PostingDraft
from pilih_jobs.discovery.types import (
    FetchMode,
    FetchRequest,
    ProgressEvent,
    RawPosting,
    StatusCheck,
    TrackedPostingRef,
)

PAGE_SIZE: Final = 100


class _Categories(BaseModel):
    model_config = ConfigDict(extra="allow")
    commitment: str | None = None
    department: str | None = None
    location: str | None = None
    team: str | None = None
    allLocations: list[str] = []  # noqa: N815 - API field name


class _ListEntry(BaseModel):
    model_config = ConfigDict(extra="allow")
    text: str = ""
    content: str = ""


class _Posting(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    text: str
    hostedUrl: str | None = None  # noqa: N815
    applyUrl: str | None = None  # noqa: N815
    createdAt: int | None = None  # noqa: N815
    categories: _Categories = _Categories()
    country: str | None = None
    workplaceType: str | None = None  # noqa: N815
    description: str | None = None
    descriptionPlain: str | None = None  # noqa: N815
    lists: list[_ListEntry] = []
    additional: str | None = None
    salaryRange: dict[str, Any] | None = None  # noqa: N815
    salaryDescriptionPlain: str | None = None  # noqa: N815


class LeverAdapter(SourceAdapter):
    id = "lever"

    def source_org(self, config: Mapping[str, Any]) -> str:
        return str(config["site"])

    def _api(self, config: Mapping[str, Any]) -> str:
        key = "lever_eu" if config.get("region") == "eu" else "lever"
        return f"{base_url(key)}/v0/postings/{quote(self.source_org(config), safe='')}"

    def page_url(self, config: Mapping[str, Any], skip: int) -> str:
        params: dict[str, str | int] = {"mode": "json", "skip": skip, "limit": PAGE_SIZE}
        filters = obj(config.get("filters"))
        for key in ("location", "commitment", "team", "department"):
            value = text(filters.get(key))
            if value:
                params[key] = value
        return f"{self._api(config)}?{urlencode(params)}"

    async def discover(
        self, ctx: AdapterContext, cfg: Mapping[str, Any]
    ) -> AsyncIterator[AdapterItem]:
        org = self.source_org(cfg)
        skip = 0
        page = 0
        cap = min(ctx.max_pages, self.max_pages())
        while True:
            page += 1
            url = self.page_url(cfg, skip)
            result = await ctx.engine.fetch_listing(
                FetchRequest(url, FetchMode.JSON_API), source=ctx.source, first_page=page == 1
            )
            payload: Any = result.json
            if not isinstance(payload, list):
                raise DiscoveryError("schema_invalid", "Lever: expected a JSON array of postings")
            postings = [parse_model(_Posting, item, what="Lever posting") for item in arr(payload)]
            yield ProgressEvent(
                "page",
                {
                    "page": page,
                    "items": len(postings),
                    "mode": "json_api",
                    "elapsed_ms": result.elapsed_ms,
                },
            )
            for posting in postings:
                yield RawPosting(
                    adapter_id=self.id,
                    source_org=org,
                    source_job_ref=posting.id,
                    data=posting.model_dump(mode="json"),
                    listing_url=url,
                    detail_url=f"{self._api(cfg)}/{quote(posting.id, safe='')}",
                    updated_at_ms=posting.createdAt,
                )
            if len(postings) < PAGE_SIZE:
                yield ProgressEvent("complete", {"complete": True})
                return
            if page >= cap or ctx.cancel.is_set():
                yield ProgressEvent("complete", {"complete": False, "reason": "max_pages"})
                return
            skip += PAGE_SIZE

    def to_normalized(self, raw: RawPosting) -> PostingDraft:
        posting = raw.data
        categories = obj(posting.get("categories"))
        locations = strs(categories.get("allLocations"))
        primary = text(categories.get("location"))
        if not locations and primary:
            locations = [primary]
        country = text(posting.get("country"))
        structured: list[dict[str, Any]] = (
            [{"raw": locations[0], "country_code": country}]
            if len(locations) == 1 and country
            else []
        )
        sections = [text(posting.get("description")) or ""]
        requirements: list[str] = []
        for entry in objs(posting.get("lists")):
            heading = text(entry.get("text")) or ""
            block = f"<h3>{heading}</h3><ul>{text(entry.get('content')) or ''}</ul>"
            sections.append(block)
            if REQUIREMENTS_HEADING.search(heading):
                requirements.extend(requirements_from_html(block))
        sections.append(text(posting.get("additional")) or "")
        salary_range = obj(posting.get("salaryRange"))
        salary: dict[str, Any] | None = None
        if salary_range:
            salary = {
                "min": number(salary_range.get("min")),
                "max": number(salary_range.get("max")),
                "currency": text(salary_range.get("currency")),
                "interval": text(salary_range.get("interval")),
                "raw": text(posting.get("salaryDescriptionPlain")),
            }
        hosted = text(posting.get("hostedUrl"))
        created = posting.get("createdAt")
        return PostingDraft(
            title=text(posting.get("text")),
            locations=[] if structured else locations,
            structured_locations=structured,
            workplace_type=text(posting.get("workplaceType")),
            employment_type=text(categories.get("commitment")),
            salary=salary,
            description_html="".join(sections) or None,
            description_text=text(posting.get("descriptionPlain")),
            requirements=requirements or None,
            apply_url=text(posting.get("applyUrl")) or hosted,
            canonical_url=hosted,
            posted_at=created if isinstance(created, int) else None,
            department=text(categories.get("department")) or text(categories.get("team")),
        )

    async def check_open(self, ctx: AdapterContext, posting: TrackedPostingRef) -> StatusCheck:
        if not posting.source_org or not posting.source_job_ref:
            return await super().check_open(ctx, posting)
        region = "eu" if "jobs.eu.lever.co" in (posting.apply_url or "") else "global"
        api = self._api({"site": posting.source_org, "region": region})
        url = f"{api}/{quote(posting.source_job_ref, safe='')}"
        try:
            result = await ctx.engine.fetch_detail(
                FetchRequest(url, FetchMode.JSON_API, purpose="detail"), source=ctx.source
            )
        except DiscoveryError as exc:
            return not_found_check(exc, "lever_404")
        return StatusCheck("open", http_status=result.status)
