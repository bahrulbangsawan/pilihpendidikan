"""SmartRecruiters Posting API (15 §14.3) — beta.

`GET https://api.smartrecruiters.com/v1/companies/{companyIdentifier}/postings?limit=100&offset=N`
(offset pagination), detail `…/postings/{id}` for the job ad sections. Keyless access is
best effort: 401/403 → `access_denied` and the source stops. `releasedDate` is the
watermark (older, already-seen postings skip the detail fetch).
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
from pilih_jobs.discovery.htmltext import requirements_from_html
from pilih_jobs.discovery.jsonutil import obj, objs, text
from pilih_jobs.discovery.normalize import PostingDraft, parse_iso_ms
from pilih_jobs.discovery.types import (
    FetchMode,
    FetchRequest,
    ProgressEvent,
    RawPosting,
    StatusCheck,
    TrackedPostingRef,
)

PAGE_SIZE: Final = 100
_SECTIONS: Final = (
    "companyDescription",
    "jobDescription",
    "qualifications",
    "additionalInformation",
)


class _Posting(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: str
    releasedDate: str | None = None  # noqa: N815 - API field names


class _Page(BaseModel):
    model_config = ConfigDict(extra="allow")
    offset: int = 0
    limit: int = PAGE_SIZE
    totalFound: int = 0  # noqa: N815
    content: list[_Posting]


class _Detail(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: str


class SmartRecruitersAdapter(SourceAdapter):
    id = "smartrecruiters"

    def source_org(self, config: Mapping[str, Any]) -> str:
        return str(config["company_identifier"])

    def _api(self, config: Mapping[str, Any]) -> str:
        company = quote(self.source_org(config), safe="")
        return f"{base_url('smartrecruiters')}/v1/companies/{company}/postings"

    async def discover(
        self, ctx: AdapterContext, cfg: Mapping[str, Any]
    ) -> AsyncIterator[AdapterItem]:
        org = self.source_org(cfg)
        offset = 0
        page = 0
        cap = min(ctx.max_pages, self.max_pages())
        while True:
            page += 1
            url = f"{self._api(cfg)}?{urlencode({'limit': PAGE_SIZE, 'offset': offset})}"
            result = await ctx.engine.fetch_listing(
                FetchRequest(url, FetchMode.JSON_API), source=ctx.source, first_page=page == 1
            )
            listing = parse_model(_Page, result.json, what="SmartRecruiters postings")
            raw_items = objs(obj(result.json).get("content"))
            yield ProgressEvent(
                "page",
                {
                    "page": page,
                    "items": len(listing.content),
                    "mode": "json_api",
                    "elapsed_ms": result.elapsed_ms,
                },
            )
            for posting, raw in zip(listing.content, raw_items, strict=False):
                yield RawPosting(
                    adapter_id=self.id,
                    source_org=org,
                    source_job_ref=posting.id,
                    data={"listing": raw},
                    listing_url=url,
                    detail_url=f"{self._api(cfg)}/{quote(posting.id, safe='')}",
                    updated_at_ms=parse_iso_ms(posting.releasedDate)
                    if posting.releasedDate
                    else None,
                    needs_detail=True,
                )
            offset += len(listing.content)
            if not listing.content or offset >= listing.totalFound:
                yield ProgressEvent("complete", {"complete": True})
                return
            if page >= cap or ctx.cancel.is_set():
                yield ProgressEvent("complete", {"complete": False, "reason": "max_pages"})
                return

    async def fetch_detail(
        self, ctx: AdapterContext, cfg: Mapping[str, Any], raw: RawPosting
    ) -> RawPosting:
        if raw.detail_url is None:
            return raw
        etag = ctx.cursor.detail_etag(raw.source_job_ref or "")
        result = await ctx.engine.fetch_detail(
            FetchRequest(raw.detail_url, FetchMode.JSON_API, purpose="detail", etag=etag),
            source=ctx.source,
        )
        ctx.cursor.set_detail_etag(raw.source_job_ref or "", result.header("etag"))
        if result.not_modified:
            raw.flags.append("detail_not_modified")
            return raw
        parse_model(_Detail, result.json, what="SmartRecruiters posting")
        raw.data = {**raw.data, "detail": result.json}
        raw.needs_detail = False
        return raw

    def to_normalized(self, raw: RawPosting) -> PostingDraft:
        source = {**obj(raw.data.get("listing")), **obj(raw.data.get("detail"))}
        location = obj(source.get("location"))
        parts = [text(location.get(k)) for k in ("city", "region", "country")]
        full = text(location.get("fullLocation")) or ", ".join(p for p in parts if p)
        country = text(location.get("country"))
        structured: list[dict[str, Any]] = (
            [
                {
                    "raw": full,
                    "city": text(location.get("city")),
                    "region": text(location.get("region")),
                    "country_code": country.upper() if country else None,
                }
            ]
            if full
            else []
        )
        workplace: str | None = None
        if location.get("remote") is True:
            workplace = "remote"
        elif location.get("hybrid") is True:
            workplace = "hybrid"
        elif location.get("remote") is False:
            workplace = "onsite"
        sections = obj(obj(source.get("jobAd")).get("sections"))
        html_parts: list[str] = []
        requirements: list[str] = []
        for key in _SECTIONS:
            section = obj(sections.get(key))
            body = text(section.get("text"))
            if not body:
                continue
            html_parts.append(f"<h3>{text(section.get('title')) or ''}</h3>{body}")
            if key == "qualifications":
                requirements = requirements_from_html(f"<h3>Qualifications</h3>{body}")
        posting_url = text(source.get("postingUrl"))
        return PostingDraft(
            title=text(source.get("name")),
            company_name=text(obj(source.get("company")).get("name")),
            structured_locations=structured,
            workplace_type=workplace,
            employment_type=text(obj(source.get("typeOfEmployment")).get("label")),
            description_html="".join(html_parts) or None,
            requirements=requirements or None,
            apply_url=text(source.get("applyUrl")) or posting_url,
            canonical_url=posting_url,
            posted_at=text(source.get("releasedDate")),
            department=text(obj(source.get("department")).get("label")),
            seniority=text(obj(source.get("experienceLevel")).get("label")),
        )

    async def check_open(self, ctx: AdapterContext, posting: TrackedPostingRef) -> StatusCheck:
        if not posting.source_org or not posting.source_job_ref:
            return await super().check_open(ctx, posting)
        api = self._api({"company_identifier": posting.source_org})
        url = f"{api}/{quote(posting.source_job_ref, safe='')}"
        try:
            result = await ctx.engine.fetch_detail(
                FetchRequest(url, FetchMode.JSON_API, purpose="detail"), source=ctx.source
            )
        except DiscoveryError as exc:
            return not_found_check(exc, "smartrecruiters_404")
        if obj(result.json).get("active") is False:
            return StatusCheck(
                "closed", http_status=result.status, marker="smartrecruiters_inactive"
            )
        return StatusCheck("open", http_status=result.status)
