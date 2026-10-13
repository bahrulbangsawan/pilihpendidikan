"""schema.org `JobPosting` (JSON-LD) → `PostingDraft`, and page heuristics.

Used by `career_page`, `generic_listing` and `custom_url` (JSON-LD first, 15 §14.3):
`title`, `datePosted`, `validThrough`, `employmentType`, `hiringOrganization`,
`jobLocation` / `jobLocationType`, `baseSalary`, `description`, `identifier`, `url`.
When a page has no JobPosting, `draft_from_page()` falls back to OpenGraph and then to
heuristics (the largest `<h1>` for the title, the main content block for the text).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any, cast

from pilih_jobs.discovery.normalize import PostingDraft, as_list, clean, parse_iso_ms
from pilih_jobs.discovery.schema_org import has_type
from pilih_jobs.discovery.types import HtmlPage

MAIN_CONTENT_CSS = (
    "main",
    "article",
    '[role="main"]',
    "#job-description",
    ".job-description",
    "#content",
    ".content",
)


def job_postings(objects: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [o for o in objects if has_type(o, "JobPosting")]


def _text(value: Any) -> str | None:
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, Mapping):
        mapping = cast(Mapping[str, Any], value)
        for key in ("name", "@value", "value"):
            inner = mapping.get(key)
            if isinstance(inner, str) and inner.strip():
                return inner.strip()
    if isinstance(value, int | float) and not isinstance(value, bool):
        return str(value)
    return None


def _address_location(place: Mapping[str, Any]) -> dict[str, Any] | None:
    address_raw = place.get("address", place)
    if isinstance(address_raw, str):
        return {"raw": clean(address_raw, 300)} if address_raw.strip() else None
    if not isinstance(address_raw, Mapping):
        return None
    address = cast(Mapping[str, Any], address_raw)
    city = _text(address.get("addressLocality"))
    region = _text(address.get("addressRegion"))
    country = _text(address.get("addressCountry"))
    parts = [p for p in (city, region, country) if p]
    name = _text(place.get("name"))
    raw = ", ".join(parts) or name
    if not raw:
        return None
    entry: dict[str, Any] = {"raw": clean(raw, 300)}
    if city:
        entry["city"] = city
    if region:
        entry["region"] = region
    if country:
        entry["country"] = country
    return entry


def valid_through_ms(posting: Mapping[str, Any]) -> int | None:
    value = posting.get("validThrough")
    return parse_iso_ms(value) if isinstance(value, str) else None


def _salary(posting: Mapping[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    base = posting.get("baseSalary") or posting.get("estimatedSalary")
    if isinstance(base, list) and base:
        base = cast(list[Any], base)[0]
    if isinstance(base, str):
        return None, base
    if not isinstance(base, Mapping):
        return None, None
    salary_map = cast(Mapping[str, Any], base)
    value = salary_map.get("value")
    out: dict[str, Any] = {}
    currency = salary_map.get("currency")
    if isinstance(currency, str):
        out["currency"] = currency
    if isinstance(value, Mapping):
        value_map = cast(Mapping[str, Any], value)
        for source_key, target in (("minValue", "min"), ("maxValue", "max")):
            number = value_map.get(source_key)
            if isinstance(number, int | float) and not isinstance(number, bool):
                out[target] = number
        single = value_map.get("value")
        if isinstance(single, int | float) and not isinstance(single, bool) and "min" not in out:
            out["min"] = single
            out["max"] = single
        unit = value_map.get("unitText")
        if isinstance(unit, str):
            out["period"] = unit
    elif isinstance(value, int | float) and not isinstance(value, bool):
        out["min"] = value
        out["max"] = value
    return (out or None), None


def draft_from_jobposting(posting: Mapping[str, Any], *, page_url: str | None) -> PostingDraft:
    org = posting.get("hiringOrganization")
    company: str | None = None
    company_url: str | None = None
    if isinstance(org, Mapping):
        org_map = cast(Mapping[str, Any], org)
        company = _text(org_map.get("name"))
        for key in ("sameAs", "url"):
            candidate = org_map.get(key)
            if isinstance(candidate, list) and candidate:
                candidate = cast(list[Any], candidate)[0]
            if isinstance(candidate, str) and candidate.startswith(("http://", "https://")):
                company_url = candidate
                break
    elif isinstance(org, str):
        company = org.strip() or None
    structured: list[dict[str, Any]] = []
    for place in as_list(posting.get("jobLocation")):
        if isinstance(place, Mapping):
            entry = _address_location(cast(Mapping[str, Any], place))
            if entry is not None:
                structured.append(entry)
    remote = any(
        isinstance(t, str) and t.upper() == "TELECOMMUTE"
        for t in as_list(posting.get("jobLocationType"))
    )
    locations: list[str] = []
    if remote:
        requirements = [_text(r) for r in as_list(posting.get("applicantLocationRequirements"))]
        names = [r for r in requirements if r]
        locations.append(f"Remote ({', '.join(names)})" if names else "Remote")
    employment = next(
        (e for e in (_text(v) for v in as_list(posting.get("employmentType"))) if e), None
    )
    salary, salary_text = _salary(posting)
    url = _text(posting.get("url"))
    description = posting.get("description")
    return PostingDraft(
        title=_text(posting.get("title")) or _text(posting.get("name")),
        company_name=company,
        company_url=company_url,
        locations=locations,
        structured_locations=structured,
        remote=True if remote else None,
        employment_type=employment,
        salary=salary,
        salary_text=salary_text,
        description_html=description if isinstance(description, str) else None,
        apply_url=url or page_url,
        canonical_url=page_url or url,
        posted_at=_text(posting.get("datePosted")),
        department=_text(posting.get("occupationalCategory")),
        valid_through=_text(posting.get("validThrough")),
    )


def jobposting_ref(posting: Mapping[str, Any]) -> str | None:
    identifier = posting.get("identifier")
    if isinstance(identifier, Mapping):
        return _text(cast(Mapping[str, Any], identifier).get("value"))
    return _text(identifier)


def draft_from_page(page: HtmlPage) -> tuple[PostingDraft, str]:
    """JSON-LD → OpenGraph → heuristics; returns the draft and the method used."""
    postings = job_postings(page.json_ld())
    if postings:
        return draft_from_jobposting(postings[0], page_url=page.url), "json_ld"
    og_title = page.meta_content("og:title", "twitter:title")
    og_description = page.meta_content("og:description", "description", "twitter:description")
    site = page.meta_content("og:site_name", "application-name")
    h1_texts = page.texts("h1")
    title = max(h1_texts, key=len) if h1_texts else og_title or page.title()
    body_html: str | None = None
    for css in MAIN_CONTENT_CSS:
        body_html = page.first_html(css)
        if body_html:
            break
    draft = PostingDraft(
        title=title,
        company_name=site,
        description_html=body_html,
        description_text=None if body_html else og_description,
        apply_url=page.url,
        canonical_url=page.url,
    )
    return draft, "css"
