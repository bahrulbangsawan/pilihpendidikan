"""`rss`: RSS 2.0 and Atom feeds of jobs (parsed with defusedxml; untrusted XML)."""

from __future__ import annotations

import re
from typing import Any, Final

from defusedxml import ElementTree as SafeET
from pilih_jobs.adapters.jsonld import job_postings
from pilih_jobs.contracts._generated.cloud import RssConfig
from pilih_jobs.discovery.normalize import employment_of
from pilih_jobs.discovery.types import FetchMode

from pilih_scraper import fetching
from pilih_scraper.errors import ScrapeStop
from pilih_scraper.postings import JobDraft, rfc2822_to_iso
from pilih_scraper.strategies.base import ScrapeJob
from pilih_scraper.strategies.jsonld import from_jobposting

_HTML_HEAD: Final = re.compile(r"^\s*(?:<!doctype html|<html)", re.IGNORECASE)
_EXPIRY_TAGS: Final = ("expires_at", "expires", "expiration", "valid_through", "validthrough")
MAX_FEED_ITEMS: Final = 1000

Element = Any


def field_name(configured: str) -> str:
    """`job_listing:company` / `dc:creator` / `region` → the element's local name."""
    return configured.rsplit(":", 1)[-1].strip().lower()


def local(tag: Any) -> str:
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def _children(node: Element, name: str) -> list[Element]:
    return [child for child in list(node) if local(child.tag) == name]


def _text(node: Element, *names: str) -> str | None:
    for name in names:
        for child in _children(node, name):
            value = "".join(child.itertext()).strip()
            if value:
                return value
    return None


def parse_feed(text: str) -> tuple[str, list[Element]]:
    """("rss" | "atom", items) or raises `ScrapeStop` (schema_invalid)."""
    if not text.strip():
        raise ScrapeStop("source_unavailable", "The feed is empty.")
    if _HTML_HEAD.match(text[:512]):
        raise ScrapeStop("schema_invalid", "Expected an RSS/Atom feed but received an HTML page.")
    try:
        root: Element = SafeET.fromstring(text.encode("utf-8"))
    except Exception as exc:
        raise ScrapeStop(
            "schema_invalid", f"Not a valid RSS/Atom feed ({type(exc).__name__})."
        ) from exc
    kind = local(root.tag)
    if kind == "feed":
        return "atom", _children(root, "entry")[:MAX_FEED_ITEMS]
    if kind in ("rss", "rdf"):
        channels = _children(root, "channel")
        scope = channels[0] if channels else root
        items = _children(scope, "item") or _children(root, "item")
        return "rss", items[:MAX_FEED_ITEMS]
    raise ScrapeStop("schema_invalid", f"Unexpected feed root element <{kind}>.")


def split_title(title: str, pattern: str, separator: str | None) -> tuple[str, str | None]:
    """(job title, company) from the item title per `title_pattern`."""
    if pattern == "company_title":
        sep = (separator or ":").strip() or ":"
        if sep in title:
            company, _, job = title.partition(sep)
            if company.strip() and job.strip():
                return job.strip(), company.strip()
        return title.strip(), None
    if pattern == "title_company":
        separators = [separator] if separator else [" at ", " - ", " | ", " — "]
        for sep in separators:
            if sep and sep in title:
                job, _, company = title.rpartition(sep)
                if job.strip() and company.strip():
                    return job.strip(), company.strip()
        return title.strip(), None
    return title.strip(), None


def _link(node: Element, kind: str) -> str | None:
    if kind == "atom":
        for link in _children(node, "link"):
            rel = (link.get("rel") or "alternate").lower()
            href = link.get("href")
            if href and rel == "alternate":
                return str(href).strip()
        return None
    return _text(node, "link")


def _employment_text(node: Element, cfg: RssConfig) -> str | None:
    """The configured type element, else the first type / category value that names an
    employment type (WP Job Manager boards swap `job_type` and `job_category`)."""
    configured = _text(node, field_name(cfg.type_field)) if cfg.type_field else None
    if configured and employment_of(configured) != "unknown":
        return configured
    for name in ("job_type", "type", "job_category", "category", "employment_type"):
        for child in _children(node, name):
            value = "".join(child.itertext()).strip() or str(child.get("term") or "").strip()
            if value and employment_of(value) != "unknown":
                return value
    return configured


def draft_from_entry(node: Element, kind: str, cfg: RssConfig, base: str) -> JobDraft:
    raw_title = _text(node, "title") or ""
    title, company = split_title(raw_title, cfg.title_pattern, cfg.separator)
    if cfg.company_field:
        company = _text(node, field_name(cfg.company_field)) or company
    author = _text(node, "creator", "author")
    if kind == "atom":
        for author_node in _children(node, "author"):
            author = _text(author_node, "name") or author
    company = company or (
        author if cfg.title_pattern == "title" and not cfg.company_field else None
    )
    location = _text(node, field_name(cfg.location_field)) if cfg.location_field else None
    job_type = _employment_text(node, cfg)
    categories = [
        "".join(c.itertext()).strip() or str(c.get("term") or "").strip()
        for c in _children(node, "category")
    ]
    skills_text = _text(node, "skills", "tags")
    tags = [c for c in categories if c]
    if skills_text:
        tags += [s.strip() for s in re.split(r"[,;|]", skills_text) if s.strip()]
    link = ScrapeJob.absolute(base, _link(node, kind))
    guid = _text(node, "guid", "id")
    description = _text(node, "encoded", "content", "description", "summary")
    posted = _text(node, "pubdate", "published", "date", "updated")
    expiry = next((v for v in (_text(node, t) for t in _EXPIRY_TAGS) if v), None)
    extra: dict[str, Any] = {}
    for name in ("country", "state", "region", "category"):
        value = _text(node, name)
        if value and name != field_name(cfg.location_field or ""):
            extra[name] = value[:300]
    return JobDraft(
        title=title or None,
        url=link,
        company=company,
        locations=[location] if location else [],
        employment_type=job_type,
        description_html=description,
        posted_at=rfc2822_to_iso(posted) if posted else None,
        expires_at=expiry,
        tags=tags,
        external_id=(guid or "")[:200] or None,
        raw_metadata=extra,
    )


async def run_rss(job: ScrapeJob, config: dict[str, Any]) -> None:
    cfg = RssConfig.model_validate(config)
    result = await job.engine.fetch_listing(
        fetching.request(cfg.url, FetchMode.STATIC_HTML), source=job.ref
    )
    job.note_page(result)
    try:
        kind, entries = parse_feed(fetching.raw_text(result))
    except ScrapeStop as stop:
        stop.url = stop.url or result.url
        stop.http_status = stop.http_status or result.status
        raise
    job.ctx.stats.postings_found += len(entries)
    job.ctx.add_log(
        "info", "feed_parsed", f"{kind.upper()} feed with {len(entries)} items", url=result.url
    )
    details = 0
    fetched: list[str] = []
    for entry in entries:
        if job.full():
            job.ctx.warn(
                "truncated", "More postings than max_items; the rest waits for the next run"
            )
            return
        draft = draft_from_entry(entry, kind, cfg, result.url)
        detail_url: str | None = None
        if cfg.fetch_details and draft.url and job.same_site(draft.url):
            if details < job.limits.max_details and not job.ctx.out_of_time():
                draft = await _fill_from_detail(job, draft)
                detail_url = draft.url
                details += 1
                fetched.append((draft.url or "")[:200])
            else:
                job.ctx.warn(
                    "details_capped",
                    "Feed items built without their detail page (max_details / deadline)",
                )
        job.builder.build(
            draft,
            method="rss",
            fetch_mode=FetchMode.STATIC_HTML,
            listing_url=result.url,
            detail_url=detail_url,
        )
    if fetched:
        job.remember_details(fetched)
    job.complete = True


async def _fill_from_detail(job: ScrapeJob, draft: JobDraft) -> JobDraft:
    """Missing fields from the item page's JSON-LD JobPosting (`fetch_details`)."""
    url = draft.url or ""
    result = await job.engine.fetch_detail(
        fetching.request(url, FetchMode.STATIC_HTML, purpose="detail"), source=job.ref
    )
    job.ctx.stats.details_fetched += 1
    page = fetching.as_page(result)
    postings = job_postings(page.json_ld()) if page is not None else []
    if not postings:
        job.ctx.warn("missing_jsonld", "Feed item pages without a JobPosting JSON-LD block")
        return draft
    found = from_jobposting(postings[0], result.url)
    draft.company = draft.company or found.company
    draft.company_url = draft.company_url or found.company_url
    if not draft.description_html and not draft.description_text:
        draft.description_html = found.description_html
    draft.posted_at = draft.posted_at or found.posted_at
    draft.expires_at = draft.expires_at or found.expires_at
    draft.employment_type = draft.employment_type or found.employment_type
    if not draft.locations and not draft.structured_locations:
        draft.locations = found.locations
        draft.structured_locations = found.structured_locations
        draft.remote = found.remote
    draft.salary = draft.salary or found.salary
    draft.salary_text = draft.salary_text or found.salary_text
    draft.tags = draft.tags + [t for t in found.tags if t not in draft.tags]
    draft.benefits = draft.benefits or found.benefits
    return draft
