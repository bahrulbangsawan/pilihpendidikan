"""`json_ld`: listing → same-site detail pages → schema.org `JobPosting` (15 §14.3)."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, cast

from pilih_jobs.adapters.jsonld import draft_from_jobposting, job_postings, jobposting_ref
from pilih_jobs.contracts._generated.cloud import JsonLdConfig
from pilih_jobs.discovery.normalize import PostingDraft
from pilih_jobs.discovery.schema_org import has_type
from pilih_jobs.discovery.types import FetchMode, HtmlPage

from pilih_scraper import fetching
from pilih_scraper.errors import ScrapeStop
from pilih_scraper.jsonpath import as_strings
from pilih_scraper.postings import JobDraft
from pilih_scraper.strategies.base import ScrapeJob
from pilih_scraper.strategies.paging import Paging


def from_jobposting(posting: Mapping[str, Any], page_url: str) -> JobDraft:
    draft: PostingDraft = draft_from_jobposting(posting, page_url=page_url)
    return JobDraft(
        title=draft.title,
        url=draft.canonical_url,
        apply_url=draft.apply_url,
        company=draft.company_name,
        company_url=draft.company_url,
        locations=list(draft.locations),
        structured_locations=list(draft.structured_locations),
        remote=draft.remote,
        employment_type=draft.employment_type,
        salary=draft.salary,
        salary_text=draft.salary_text,
        description_html=draft.description_html,
        posted_at=draft.posted_at,
        expires_at=draft.valid_through,
        department=draft.department,
        tags=as_strings(posting.get("skills")),
        benefits=as_strings(posting.get("jobBenefits")),
        external_id=jobposting_ref(posting),
        raw_metadata={"industry": as_strings(posting.get("industry")) or None},
    )


def _item_lists(value: Any, depth: int = 0) -> list[dict[str, Any]]:
    """Every `ItemList` in a JSON-LD tree (also under `mainEntity`, `hasPart`, …)."""
    if depth > 6:
        return []
    if isinstance(value, list):
        return [found for item in cast(list[Any], value) for found in _item_lists(item, depth + 1)]
    if not isinstance(value, dict):
        return []
    obj = cast(dict[str, Any], value)
    if has_type(obj, "ItemList"):
        return [obj]
    return [found for inner in obj.values() for found in _item_lists(inner, depth + 1)]


def item_list_entries(page: HtmlPage) -> list[dict[str, Any]]:
    """`ItemList` elements that are not JobPostings but carry a name and a URL."""
    out: list[dict[str, Any]] = []
    lists: list[dict[str, Any]] = []
    for top in page.json_ld():
        for found in _item_lists(top):
            if not any(found is seen for seen in lists):
                lists.append(found)
    for obj in lists:
        raw_elements = obj.get("itemListElement")
        elements = cast(list[Any], raw_elements) if isinstance(raw_elements, list) else []
        for element in elements:
            if not isinstance(element, dict):
                continue
            element_map = cast(dict[str, Any], element)
            inner = element_map.get("item")
            entry = cast(dict[str, Any], inner) if isinstance(inner, dict) else element_map
            if has_type(entry, "JobPosting"):
                continue
            if isinstance(entry.get("url"), str) and isinstance(entry.get("name"), str):
                out.append(entry)
    return out


def from_list_entry(entry: Mapping[str, Any], page_url: str) -> JobDraft:
    description = entry.get("description")
    return JobDraft(
        title=str(entry.get("name") or "").strip() or None,
        url=ScrapeJob.absolute(page_url, str(entry.get("url") or "")),
        description_text=description if isinstance(description, str) else None,
        posted_at=entry.get("datePosted") if isinstance(entry.get("datePosted"), str) else None,
    )


async def run_json_ld(job: ScrapeJob, config: dict[str, Any]) -> None:
    cfg = JsonLdConfig.model_validate(config)
    pattern = re.compile(cfg.detail_url_pattern) if cfg.detail_url_pattern else None
    link_css = fetching.split_pseudo(cfg.detail_link_selector)[0]
    paging = Paging(job, cfg.listing_url, FetchMode.STATIC_HTML, next_css=cfg.next_page)
    links: list[str] = []
    listing_items = 0
    delivered: set[str] = set()
    first_result = None
    async for url, result in paging.pages():
        first_result = first_result or (url, result)
        page = fetching.as_page(result)
        if page is None:
            continue
        if cfg.listing_jsonld:
            drafts = [from_jobposting(p, result.url) for p in job_postings(page.json_ld())]
            drafts += [from_list_entry(e, result.url) for e in item_list_entries(page)]
            for draft in drafts:
                if job.full():
                    break
                listing_items += 1
                job.ctx.stats.postings_found += 1
                if draft.url:
                    delivered.add(draft.url)
                job.builder.build(
                    draft,
                    method="json_ld",
                    fetch_mode=FetchMode.STATIC_HTML,
                    listing_url=result.url,
                )
        for link in page.links(link_css):
            if link in links or link in delivered or not job.same_site(link):
                continue
            if pattern is not None and not pattern.search(link):
                continue
            links.append(link)
    if not links and listing_items == 0:
        if first_result is not None:
            job.check_wall(first_result[0], first_result[1])
        raise ScrapeStop(
            "parse_error",
            f"Layout changed: {cfg.detail_link_selector!r} matched no job links on "
            f"{cfg.listing_url}.",
            url=cfg.listing_url,
        )
    seen = set(job.detail_seen())
    ordered = [u for u in links if u[:200] not in seen] + [u for u in links if u[:200] in seen]
    job.ctx.stats.postings_found += len(ordered)
    fetched: list[str] = []
    for link in ordered:
        if fetched and len(fetched) >= job.limits.max_details:
            break
        if job.ctx.out_of_time() or job.full():
            break
        result = await job.engine.fetch_detail(
            fetching.request(link, FetchMode.STATIC_HTML, purpose="detail"), source=job.ref
        )
        fetched.append(link)
        job.ctx.stats.details_fetched += 1
        page = fetching.as_page(result)
        postings = job_postings(page.json_ld()) if page is not None else []
        if not postings:
            job.ctx.stats.invalid += 1
            job.ctx.warn("missing_jsonld", "Detail pages without a JobPosting JSON-LD block")
            continue
        job.builder.build(
            from_jobposting(postings[0], result.url),
            method="json_ld",
            fetch_mode=FetchMode.STATIC_HTML,
            listing_url=cfg.listing_url,
            detail_url=result.url,
        )
    job.remember_details([u[:200] for u in fetched])
    details_complete = len(fetched) == len(ordered)
    if not details_complete:
        job.ctx.warn(
            "truncated",
            f"Read {len(fetched)} of {len(ordered)} detail pages (max_details / deadline)",
        )
    job.complete = paging.complete and details_complete and not job.full()
