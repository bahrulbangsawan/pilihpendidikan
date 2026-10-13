"""Ashby public Job Posting API (15 §14.3) — stable.

`GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true`;
single response with `descriptionHtml`/`descriptionPlain` (no detail fetch). Postings with
`isListed=false` are skipped; `publishedAt` is the watermark. `check_open` re-reads the
board once per run: absent or unlisted → closed.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from typing import Any, cast
from urllib.parse import quote

from pydantic import BaseModel, ConfigDict

from pilih_jobs.adapters.base import AdapterContext, AdapterItem, SourceAdapter, parse_model
from pilih_jobs.adapters.endpoints import base_url
from pilih_jobs.discovery.errors import DiscoveryError
from pilih_jobs.discovery.jsonutil import number, obj, objs, text
from pilih_jobs.discovery.normalize import PostingDraft, parse_iso_ms
from pilih_jobs.discovery.types import (
    FetchMode,
    FetchRequest,
    FetchResult,
    ProgressEvent,
    RawPosting,
    StatusCheck,
    TrackedPostingRef,
)


class _Job(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    title: str
    isListed: bool = True  # noqa: N815 - API field names
    jobUrl: str | None = None  # noqa: N815
    applyUrl: str | None = None  # noqa: N815
    publishedAt: str | None = None  # noqa: N815


class _Board(BaseModel):
    model_config = ConfigDict(extra="allow")
    jobs: list[_Job]


class AshbyAdapter(SourceAdapter):
    id = "ashby"

    def source_org(self, config: Mapping[str, Any]) -> str:
        return str(config["job_board_name"])

    def listing_url(self, config: Mapping[str, Any]) -> str:
        name = quote(self.source_org(config), safe="")
        return f"{base_url('ashby')}/posting-api/job-board/{name}?includeCompensation=true"

    async def _board(
        self, ctx: AdapterContext, config: Mapping[str, Any]
    ) -> tuple[list[tuple[_Job, dict[str, Any]]], FetchResult]:
        url = self.listing_url(config)
        result = await ctx.engine.fetch_listing(
            FetchRequest(url, FetchMode.JSON_API), source=ctx.source
        )
        board = parse_model(_Board, result.json, what="Ashby job board")
        raw_jobs = objs(obj(result.json).get("jobs"))
        return list(zip(board.jobs, raw_jobs, strict=True)), result

    async def discover(
        self, ctx: AdapterContext, cfg: Mapping[str, Any]
    ) -> AsyncIterator[AdapterItem]:
        url = self.listing_url(cfg)
        jobs, result = await self._board(ctx, cfg)
        listed = [(model, raw) for model, raw in jobs if model.isListed]
        yield ProgressEvent(
            "page",
            {"page": 1, "items": len(listed), "mode": "json_api", "elapsed_ms": result.elapsed_ms},
        )
        org = self.source_org(cfg)
        for model, raw in listed:
            yield RawPosting(
                adapter_id=self.id,
                source_org=org,
                source_job_ref=model.id,
                data=raw,
                listing_url=url,
                detail_url=model.jobUrl,
                updated_at_ms=parse_iso_ms(model.publishedAt) if model.publishedAt else None,
            )
        yield ProgressEvent("complete", {"complete": True})

    def to_normalized(self, raw: RawPosting) -> PostingDraft:
        job = raw.data
        locations: list[str] = []
        structured: list[dict[str, Any]] = []
        address = obj(obj(job.get("address")).get("postalAddress"))
        primary = text(job.get("location"))
        if primary and address:
            structured.append(
                {
                    "raw": primary,
                    "city": text(address.get("addressLocality")),
                    "region": text(address.get("addressRegion")),
                    "country": text(address.get("addressCountry")),
                }
            )
        elif primary:
            locations.append(primary)
        for secondary in objs(job.get("secondaryLocations")):
            name = text(secondary.get("location"))
            if name:
                locations.append(name)
        salary: dict[str, Any] | None = None
        compensation = obj(job.get("compensation"))
        summary = text(compensation.get("compensationTierSummary"))
        for component in objs(compensation.get("summaryComponents")):
            if component.get("compensationType") == "Salary":
                salary = {
                    "min": number(component.get("minValue")),
                    "max": number(component.get("maxValue")),
                    "currency": text(component.get("currencyCode")),
                    "interval": text(component.get("interval")),
                    "raw": summary,
                }
                break
        salary_text = None
        if salary is None:
            salary_text = summary or text(compensation.get("scrapeableCompensationSalarySummary"))
        return PostingDraft(
            title=text(job.get("title")),
            locations=locations,
            structured_locations=structured,
            workplace_type=text(job.get("workplaceType")),
            remote=True if job.get("isRemote") is True else None,
            employment_type=text(job.get("employmentType")),
            salary=salary,
            salary_text=salary_text,
            description_html=text(job.get("descriptionHtml")),
            description_text=text(job.get("descriptionPlain")),
            apply_url=text(job.get("applyUrl")) or text(job.get("jobUrl")),
            canonical_url=text(job.get("jobUrl")),
            posted_at=text(job.get("publishedAt")),
            department=text(job.get("department")) or text(job.get("team")),
        )

    async def check_open(self, ctx: AdapterContext, posting: TrackedPostingRef) -> StatusCheck:
        if not posting.source_org or not posting.source_job_ref:
            return await super().check_open(ctx, posting)
        key = f"ashby:{posting.source_org}"
        cached = ctx.cache.get(key)
        if cached is None:
            try:
                jobs, _ = await self._board(ctx, {"job_board_name": posting.source_org})
            except DiscoveryError as exc:
                if exc.error_class == "source_closed":
                    return StatusCheck(
                        "closed", http_status=exc.http_status, marker="ashby_board_gone"
                    )
                return StatusCheck("unknown", http_status=exc.http_status)
            cached = {model.id: raw for model, raw in jobs}
            ctx.cache[key] = cached
        board = cast(dict[str, dict[str, Any]], cached)
        job = board.get(posting.source_job_ref)
        if job is None:
            return StatusCheck("closed", http_status=200, marker="ashby_absent")
        if job.get("isListed") is False:
            return StatusCheck("closed", http_status=200, marker="ashby_unlisted")
        return StatusCheck("open", http_status=200)
