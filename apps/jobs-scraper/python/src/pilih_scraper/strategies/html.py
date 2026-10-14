"""`html_selectors` and `browser`: CSS selectors with Scrapling adaptive relocation."""

from __future__ import annotations

import re
from typing import Any

from pilih_jobs.adapters.jsonld import job_postings
from pilih_jobs.contracts._generated.cloud import BrowserConfig, HtmlSelectorsConfig
from pilih_jobs.discovery.types import ExtractionOutcome, FetchMode, FieldSpec

from pilih_scraper import fetching
from pilih_scraper.errors import ScrapeStop
from pilih_scraper.postings import JobDraft
from pilih_scraper.strategies.base import ScrapeJob
from pilih_scraper.strategies.jsonld import from_jobposting
from pilih_scraper.strategies.paging import Paging

_TAG_SPLIT = re.compile(r"\s*[,;|•·]\s*")


def _fields(cfg: HtmlSelectorsConfig, adaptive: bool) -> list[FieldSpec]:
    specs = [
        fetching.field_spec("title", cfg.fields.title, required=True, adaptive=adaptive),
        fetching.field_spec("link", cfg.fields.link, required=True, adaptive=adaptive),
    ]
    optional = {
        "company": cfg.fields.company,
        "location": cfg.fields.location,
        "posted_at": cfg.fields.posted_at,
        "salary": cfg.fields.salary,
        "employment_type": cfg.fields.employment_type,
    }
    for name, css in optional.items():
        if css:
            specs.append(fetching.field_spec(name, css, required=False, adaptive=adaptive))
    if cfg.fields.tags:
        base = fetching.field_spec("tags", cfg.fields.tags, required=False, adaptive=adaptive)
        specs.append(FieldSpec("tags", css=base.css, attr=base.attr, many=True, adaptive=adaptive))
    return specs


def _text(values: dict[str, Any], name: str) -> str | None:
    value = values.get(name)
    if isinstance(value, list):
        value = next((v for v in value if isinstance(v, str) and v), None)  # pyright: ignore[reportUnknownVariableType]
    return value.strip() if isinstance(value, str) and value.strip() else None


def _tags(values: dict[str, Any]) -> list[str]:
    raw = values.get("tags")
    items: list[str] = [str(v) for v in raw] if isinstance(raw, list) else [str(raw)] if raw else []  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
    out: list[str] = []
    for item in items:
        out += [t for t in _TAG_SPLIT.split(item) if t]
    return out[:30]


async def _detail(job: ScrapeJob, draft: JobDraft, cfg: HtmlSelectorsConfig) -> JobDraft:
    if not draft.url:
        return draft
    result = await job.engine.fetch_detail(
        fetching.request(draft.url, FetchMode.STATIC_HTML, purpose="detail"), source=job.ref
    )
    job.ctx.stats.details_fetched += 1
    page = fetching.as_page(result)
    if page is None:
        return draft
    postings = job_postings(page.json_ld())
    if postings:
        detailed = from_jobposting(postings[0], result.url)
        detailed.company = detailed.company or draft.company
        detailed.locations = detailed.locations or draft.locations
        detailed.tags = draft.tags + detailed.tags
        detailed.relocated_fields = draft.relocated_fields
        return detailed
    detail = cfg.detail
    if detail is not None and detail.description_selector:
        draft.description_html = page.first_html(
            fetching.split_pseudo(detail.description_selector)[0]
        )
    if detail is not None and detail.company_selector and not draft.company:
        draft.company = page.first_text(fetching.split_pseudo(detail.company_selector)[0])
    return draft


async def run_html(job: ScrapeJob, config: dict[str, Any], *, browser: bool) -> None:
    cfg: HtmlSelectorsConfig
    wait_selector: str | None = None
    if browser:
        if not job.allow_browser:
            raise ScrapeStop(
                "invalid_config",
                "The browser strategy needs allow_browser on the source (opt-in, 15 §5).",
            )
        browser_cfg = BrowserConfig.model_validate(config)
        wait_selector = browser_cfg.wait_selector
        cfg = HtmlSelectorsConfig.model_validate(browser_cfg.model_dump(exclude={"wait_selector"}))
    else:
        cfg = HtmlSelectorsConfig.model_validate(config)
    mode = FetchMode.BROWSER if browser else FetchMode.STATIC_HTML
    adaptive = cfg.adaptive is not False
    specs = _fields(cfg, adaptive)
    paging = Paging(job, cfg.url, mode, next_css=cfg.next_page, wait_selector=wait_selector)
    details_done = 0
    first = True
    async for url, result in paging.pages():
        outcomes = fetching.extract_listing(
            job.engine, result, item_css=cfg.item, fields=specs, source=job.ref
        )
        if not outcomes and first:
            job.check_wall(url, result)
            raise ScrapeStop(
                "parse_error",
                f"Layout changed: the item selector {cfg.item!r} matched nothing on {result.url} "
                "(adaptive relocation found no similar element either).",
                url=result.url,
                http_status=result.status,
            )
        first = False
        job.ctx.stats.postings_found += len(outcomes)
        valid: list[ExtractionOutcome] = []
        for outcome in outcomes:
            if outcome.missing_required:
                job.ctx.stats.invalid += 1
                for name in outcome.missing_required:
                    job.ctx.warn("missing_field", f"Items without a {name} (dropped)", field=name)
                continue
            if job.full():
                break
            values = outcome.values
            draft = JobDraft(
                title=_text(values, "title"),
                url=ScrapeJob.absolute(result.url, _text(values, "link")),
                company=_text(values, "company"),
                locations=[loc] if (loc := _text(values, "location")) else [],
                posted_at=_text(values, "posted_at"),
                salary_text=_text(values, "salary"),
                employment_type=_text(values, "employment_type"),
                tags=_tags(values),
                relocated_fields=list(outcome.relocated_fields),
            )
            detail_on = cfg.detail is not None and cfg.detail.enabled
            if detail_on and details_done < job.limits.max_details and not job.ctx.out_of_time():
                draft = await _detail(job, draft, cfg)
                details_done += 1
            if job.builder.build(draft, method="css", fetch_mode=mode, listing_url=result.url):
                valid.append(outcome)
        relocated = sum(1 for o in outcomes if o.relocated_fields)
        if relocated:
            job.ctx.warn(
                "selector_drift",
                "Source layout changed: some fields were recovered by adaptive relocation "
                "(confidence capped at 0.6)",
                count=relocated,
            )
        fetching.confirm(job.engine, valid)
    job.complete = paging.complete and not job.full()
