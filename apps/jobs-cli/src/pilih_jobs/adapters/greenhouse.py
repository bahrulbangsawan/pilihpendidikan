"""Greenhouse Job Board API (15 §14.3) — stable.

`GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true`
("authentication is not required for any GET endpoints"); single response, conditional
GET with the listing ETag, `updated_at` as watermark. `content` is entity-escaped HTML.
The detail endpoint (`…/jobs/{id}?questions=true&pay_transparency=true`) is not needed
for discovery; `check_open` uses `…/jobs/{id}` (404 → the job left the board).
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
from pilih_jobs.discovery.jsonutil import number, obj, objs, text
from pilih_jobs.discovery.normalize import PostingDraft, parse_iso_ms
from pilih_jobs.discovery.types import (
    FetchMode,
    FetchRequest,
    ProgressEvent,
    RawPosting,
    StatusCheck,
    TrackedPostingRef,
)


class _Named(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str | None = None


class _Job(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: int | str
    title: str
    absolute_url: str | None = None
    updated_at: str | None = None
    first_published: str | None = None
    company_name: str | None = None
    content: str | None = None
    location: _Named | None = None
    departments: list[_Named] = []
    offices: list[dict[str, Any]] = []
    pay_input_ranges: list[dict[str, Any]] = []


class _Board(BaseModel):
    model_config = ConfigDict(extra="allow")
    jobs: list[_Job]


class GreenhouseAdapter(SourceAdapter):
    id = "greenhouse"

    def source_org(self, config: Mapping[str, Any]) -> str:
        return str(config["board_token"])

    def _base(self, config: Mapping[str, Any]) -> str:
        return f"{base_url('greenhouse')}/v1/boards/{quote(self.source_org(config), safe='')}"

    def listing_url(self, config: Mapping[str, Any]) -> str:
        return f"{self._base(config)}/jobs?content=true"

    def detail_url(self, config: Mapping[str, Any], job_id: str) -> str:
        return f"{self._base(config)}/jobs/{quote(job_id, safe='')}"

    async def discover(
        self, ctx: AdapterContext, cfg: Mapping[str, Any]
    ) -> AsyncIterator[AdapterItem]:
        url = self.listing_url(cfg)
        conditional = "etag" in self.incremental
        result = await ctx.engine.fetch_listing(
            FetchRequest(
                url,
                FetchMode.JSON_API,
                etag=ctx.cursor.listing_etag if conditional else None,
                last_modified=ctx.cursor.listing_last_modified if conditional else None,
            ),
            source=ctx.source,
        )
        if result.not_modified:
            yield ProgressEvent("not_modified", {"url": url})
            yield ProgressEvent("complete", {"complete": True})
            return
        board = parse_model(_Board, result.json, what="Greenhouse board")
        yield ProgressEvent(
            "page",
            {
                "page": 1,
                "items": len(board.jobs),
                "mode": "json_api",
                "elapsed_ms": result.elapsed_ms,
            },
        )
        org = self.source_org(cfg)
        for job in board.jobs:
            job_id = str(job.id)
            yield RawPosting(
                adapter_id=self.id,
                source_org=org,
                source_job_ref=job_id,
                data=job.model_dump(mode="json"),
                listing_url=url,
                detail_url=self.detail_url(cfg, job_id),
                updated_at_ms=parse_iso_ms(job.updated_at) if job.updated_at else None,
            )
        yield ProgressEvent(
            "cursor",
            {"etag": result.header("etag"), "last_modified": result.header("last-modified")},
        )
        yield ProgressEvent("complete", {"complete": True})

    def to_normalized(self, raw: RawPosting) -> PostingDraft:
        job = raw.data
        location = text(obj(job.get("location")).get("name"))
        departments = [d for d in (text(x.get("name")) for x in objs(job.get("departments"))) if d]
        salary: dict[str, Any] | None = None
        for pay in objs(job.get("pay_input_ranges")):
            low, high = number(pay.get("min_cents")), number(pay.get("max_cents"))
            if low is not None and high is not None:
                salary = {
                    "min": low / 100,
                    "max": high / 100,
                    "currency": text(pay.get("currency_type")),
                    "period": "year",
                    "raw": text(pay.get("title")),
                }
                break
        url = text(job.get("absolute_url"))
        return PostingDraft(
            title=text(job.get("title")),
            company_name=text(job.get("company_name")),
            locations=[location] if location else [],
            description_html=text(job.get("content")),
            apply_url=url,
            canonical_url=url,
            posted_at=text(job.get("first_published")) or text(job.get("updated_at")),
            department=departments[0] if departments else None,
            salary=salary,
        )

    async def check_open(self, ctx: AdapterContext, posting: TrackedPostingRef) -> StatusCheck:
        if not posting.source_org or not posting.source_job_ref:
            return await super().check_open(ctx, posting)
        url = self.detail_url({"board_token": posting.source_org}, posting.source_job_ref)
        try:
            result = await ctx.engine.fetch_detail(
                FetchRequest(url, FetchMode.JSON_API, purpose="detail"), source=ctx.source
            )
        except DiscoveryError as exc:
            return not_found_check(exc, "greenhouse_job_gone")
        return StatusCheck("open", http_status=result.status)
