"""Workday career sites (15 §14.3) — **opt-in**, best effort.

`POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` with
`{limit: 20, offset, searchText, appliedFacets}` (offset pagination, ≤ 50 pages), detail
`GET …/wday/cxs/{tenant}/{site}{externalPath}`. The endpoint is undocumented and often
bot-protected: one request at a time, ≥ 3 s apart (manifest), and the source stops on
`access_denied`, `challenge_detected` or `rate_limited` — never retried with another
identity or mode. The manager then disables the tenant (`config.disabled_reason`).
A tenant runs only as a configured source the user opted into (ToS note shown in web).
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator, Mapping
from typing import Any, Final
from urllib.parse import quote, urlsplit

from pydantic import BaseModel, ConfigDict

from pilih_jobs.adapters.base import (
    AdapterContext,
    AdapterItem,
    SourceAdapter,
    not_found_check,
    parse_model,
)
from pilih_jobs.adapters.endpoints import override_for
from pilih_jobs.discovery.errors import DiscoveryError, PolicyViolation
from pilih_jobs.discovery.jsonutil import obj, strs, text
from pilih_jobs.discovery.normalize import PostingDraft
from pilih_jobs.discovery.types import (
    FetchMode,
    FetchRequest,
    ProgressEvent,
    RawPosting,
    StatusCheck,
    TrackedPostingRef,
)

PAGE_SIZE: Final = 20
_REQ_ID = re.compile(r"_(?P<id>[A-Za-z]{0,6}-?\d[\w-]*)$")
#: `disabled_reason` written when a tenant is auto-disabled after its first denial.
DISABLED_REASONS: Final[dict[str, str]] = {
    "challenge_detected": "challenge",
    "access_denied": "access_denied",
    "rate_limited": "rate_limited",
}


class _Posting(BaseModel):
    model_config = ConfigDict(extra="allow")
    title: str
    externalPath: str  # noqa: N815 - API field names
    locationsText: str | None = None  # noqa: N815
    postedOn: str | None = None  # noqa: N815
    bulletFields: list[str] = []  # noqa: N815


class _Page(BaseModel):
    model_config = ConfigDict(extra="allow")
    total: int = 0
    jobPostings: list[_Posting]  # noqa: N815


class _Info(BaseModel):
    model_config = ConfigDict(extra="allow")
    title: str


class _Detail(BaseModel):
    model_config = ConfigDict(extra="allow")
    jobPostingInfo: _Info  # noqa: N815


def job_ref(external_path: str) -> str:
    """The stable requisition id at the end of the path (`…/Engineer_R12345` → R12345)."""
    last = external_path.rstrip("/").rsplit("/", 1)[-1]
    match = _REQ_ID.search(last)
    return match.group("id") if match else last


class WorkdayAdapter(SourceAdapter):
    id = "workday"

    def source_org(self, config: Mapping[str, Any]) -> str:
        return f"{config['tenant']}/{config['site']}"

    def validate_config(self, config: Mapping[str, Any]) -> dict[str, Any]:
        cfg = super().validate_config(config)
        if cfg.get("disabled_reason"):
            raise PolicyViolation(
                f"This Workday tenant was disabled after a {cfg['disabled_reason']} response; "
                "re-enable it in the web app (Sources) only if the site allows access.",
                details={"disabled_reason": cfg["disabled_reason"]},
            )
        return cfg

    def origin(self, config: Mapping[str, Any]) -> str:
        override = override_for("workday")
        if override:
            return override
        return f"https://{config['tenant']}.wd{int(config['wd_host_number'])}.myworkdayjobs.com"

    def _cxs(self, config: Mapping[str, Any]) -> str:
        tenant = quote(str(config["tenant"]), safe="")
        site = quote(str(config["site"]), safe="")
        return f"{self.origin(config)}/wday/cxs/{tenant}/{site}"

    async def discover(
        self, ctx: AdapterContext, cfg: Mapping[str, Any]
    ) -> AsyncIterator[AdapterItem]:
        url = f"{self._cxs(cfg)}/jobs"
        search = str(cfg.get("search_text") or ctx.keywords or "")
        org = self.source_org(cfg)
        offset = 0
        page = 0
        cap = min(ctx.max_pages, self.max_pages())
        while True:
            page += 1
            body: dict[str, Any] = {
                "appliedFacets": {},
                "limit": PAGE_SIZE,
                "offset": offset,
                "searchText": search,
            }
            result = await ctx.engine.fetch_listing(
                FetchRequest(
                    url,
                    FetchMode.JSON_API,
                    method="POST",
                    json_body=body,
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                ),
                source=ctx.source,
                first_page=page == 1,
            )
            listing = parse_model(_Page, result.json, what="Workday jobs")
            yield ProgressEvent(
                "page",
                {
                    "page": page,
                    "items": len(listing.jobPostings),
                    "mode": "json_api",
                    "elapsed_ms": result.elapsed_ms,
                },
            )
            for posting in listing.jobPostings:
                yield RawPosting(
                    adapter_id=self.id,
                    source_org=org,
                    source_job_ref=job_ref(posting.externalPath),
                    data={"listing": posting.model_dump(mode="json")},
                    listing_url=url,
                    detail_url=f"{self._cxs(cfg)}{posting.externalPath}",
                    needs_detail=True,
                )
            offset += len(listing.jobPostings)
            if not listing.jobPostings or offset >= listing.total:
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
        result = await ctx.engine.fetch_detail(
            FetchRequest(
                raw.detail_url,
                FetchMode.JSON_API,
                purpose="detail",
                headers={"Accept": "application/json"},
            ),
            source=ctx.source,
        )
        parse_model(_Detail, result.json, what="Workday job")
        raw.data = {**raw.data, "detail": result.json}
        raw.needs_detail = False
        return raw

    def to_normalized(self, raw: RawPosting) -> PostingDraft:
        listing = obj(raw.data.get("listing"))
        detail = obj(raw.data.get("detail"))
        info = obj(detail.get("jobPostingInfo"))
        organization = obj(detail.get("hiringOrganization"))
        locations = [
            loc
            for loc in [
                text(info.get("location")) or text(listing.get("locationsText")),
                *strs(info.get("additionalLocations")),
            ]
            if loc
        ]
        country = text(obj(info.get("country")).get("descriptor"))
        if country and len(locations) == 1 and country not in locations[0]:
            locations = [f"{locations[0]}, {country}"]
        external = text(info.get("externalUrl"))
        return PostingDraft(
            title=text(info.get("title")) or text(listing.get("title")),
            company_name=text(organization.get("name")),
            company_url=text(organization.get("url")),
            locations=locations,
            remote=True if info.get("remoteType") == "Remote" else None,
            employment_type=text(info.get("timeType")),
            description_html=text(info.get("jobDescription")),
            apply_url=external,
            canonical_url=external,
            posted_at=(
                text(info.get("startDate"))
                or text(info.get("postedOn"))
                or text(listing.get("postedOn"))
            ),
        )

    async def check_open(self, ctx: AdapterContext, posting: TrackedPostingRef) -> StatusCheck:
        config = posting.source_config
        url = posting.apply_url or posting.canonical_url
        if not config or not url:
            return StatusCheck("unknown")
        parts = urlsplit(url)
        site = str(config.get("site") or "")
        path = parts.path
        marker = f"/{site}"
        if not site or marker not in path:
            return StatusCheck("unknown")
        external = path.split(marker, 1)[1]
        try:
            result = await ctx.engine.fetch_detail(
                FetchRequest(
                    f"{self._cxs(config)}{external}",
                    FetchMode.JSON_API,
                    purpose="detail",
                    headers={"Accept": "application/json"},
                ),
                source=ctx.source,
            )
        except DiscoveryError as exc:
            return not_found_check(exc, "workday_404")
        if obj(obj(result.json).get("jobPostingInfo")).get("canApply") is False:
            return StatusCheck("closed", http_status=result.status, marker="workday_cannot_apply")
        return StatusCheck("open", http_status=result.status)
