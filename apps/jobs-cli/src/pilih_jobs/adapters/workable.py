"""Workable widget endpoint (15 §14.3) — beta.

`GET https://apply.workable.com/api/v1/widget/accounts/{subdomain}` (single response;
undocumented, so a shape mismatch is `schema_invalid` and stops the source), detail
`…/accounts/{subdomain}/jobs/{shortcode}` for the description/requirements/benefits.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from typing import Any
from urllib.parse import quote

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
from pilih_jobs.discovery.normalize import PostingDraft
from pilih_jobs.discovery.types import (
    FetchMode,
    FetchRequest,
    ProgressEvent,
    RawPosting,
    StatusCheck,
    TrackedPostingRef,
)


class _Job(BaseModel):
    model_config = ConfigDict(extra="allow")
    title: str
    shortcode: str


class _Account(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str | None = None
    jobs: list[_Job]


class _Detail(BaseModel):
    model_config = ConfigDict(extra="allow")
    shortcode: str
    title: str


class WorkableAdapter(SourceAdapter):
    id = "workable"

    def source_org(self, config: Mapping[str, Any]) -> str:
        return str(config["subdomain"])

    def _account_url(self, config: Mapping[str, Any]) -> str:
        sub = quote(self.source_org(config), safe="")
        return f"{base_url('workable')}/api/v1/widget/accounts/{sub}"

    def detail_url(self, config: Mapping[str, Any], shortcode: str) -> str:
        return f"{self._account_url(config)}/jobs/{quote(shortcode, safe='')}"

    async def discover(
        self, ctx: AdapterContext, cfg: Mapping[str, Any]
    ) -> AsyncIterator[AdapterItem]:
        url = self._account_url(cfg)
        result = await ctx.engine.fetch_listing(
            FetchRequest(url, FetchMode.JSON_API), source=ctx.source
        )
        account = parse_model(_Account, result.json, what="Workable account")
        raw_jobs = objs(obj(result.json).get("jobs"))
        yield ProgressEvent(
            "page",
            {
                "page": 1,
                "items": len(account.jobs),
                "mode": "json_api",
                "elapsed_ms": result.elapsed_ms,
            },
        )
        org = self.source_org(cfg)
        for job, raw in zip(account.jobs, raw_jobs, strict=False):
            yield RawPosting(
                adapter_id=self.id,
                source_org=org,
                source_job_ref=job.shortcode,
                data={"listing": raw, "account": account.name},
                listing_url=url,
                detail_url=self.detail_url(cfg, job.shortcode),
                needs_detail=True,
            )
        yield ProgressEvent("complete", {"complete": True})

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
        parse_model(_Detail, result.json, what="Workable job")
        raw.data = {**raw.data, "detail": result.json}
        raw.needs_detail = False
        return raw

    def to_normalized(self, raw: RawPosting) -> PostingDraft:
        job = {**obj(raw.data.get("listing")), **obj(raw.data.get("detail"))}
        structured: list[dict[str, Any]] = []
        for location in objs(job.get("locations")):
            if location.get("hidden") is True:
                continue
            parts = [text(location.get(k)) for k in ("city", "region", "country")]
            label = ", ".join(p for p in parts if p)
            if label:
                structured.append(
                    {
                        "raw": label,
                        "city": text(location.get("city")),
                        "region": text(location.get("region")),
                        "country_code": text(location.get("countryCode")),
                    }
                )
        if not structured:
            parts = [text(job.get(k)) for k in ("city", "state", "country")]
            label = ", ".join(p for p in parts if p)
            if label:
                structured.append(
                    {
                        "raw": label,
                        "city": text(job.get("city")),
                        "country": text(job.get("country")),
                    }
                )
        sections: list[str] = []
        requirements: list[str] = []
        for key, heading in (
            ("description", ""),
            ("requirements", "Requirements"),
            ("benefits", "Benefits"),
        ):
            body = text(job.get(key))
            if not body:
                continue
            sections.append(f"<h3>{heading}</h3>{body}" if heading else body)
            if key == "requirements":
                requirements = requirements_from_html(f"<h3>Requirements</h3>{body}")
        workplace = text(job.get("workplace"))
        if workplace is None and job.get("telecommuting") is True:
            workplace = "remote"
        return PostingDraft(
            title=text(job.get("title")),
            company_name=text(raw.data.get("account")),
            structured_locations=structured,
            workplace_type=workplace,
            employment_type=text(job.get("employment_type")),
            description_html="".join(sections) or None,
            requirements=requirements or None,
            apply_url=text(job.get("application_url")) or text(job.get("url")),
            canonical_url=text(job.get("url")) or text(job.get("shortlink")),
            posted_at=text(job.get("published_on")) or text(job.get("created_at")),
            department=text(job.get("department")),
        )

    async def check_open(self, ctx: AdapterContext, posting: TrackedPostingRef) -> StatusCheck:
        if not posting.source_org or not posting.source_job_ref:
            return await super().check_open(ctx, posting)
        url = self.detail_url({"subdomain": posting.source_org}, posting.source_job_ref)
        try:
            result = await ctx.engine.fetch_detail(
                FetchRequest(url, FetchMode.JSON_API, purpose="detail"), source=ctx.source
            )
        except DiscoveryError as exc:
            return not_found_check(exc, "workable_404")
        if (text(obj(result.json).get("state")) or "").lower() in ("closed", "archived"):
            return StatusCheck("closed", http_status=result.status, marker="workable_closed")
        return StatusCheck("open", http_status=result.status)
