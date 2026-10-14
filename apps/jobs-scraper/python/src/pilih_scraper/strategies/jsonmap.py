"""`json_api` and `embedded_json`: items at a JSON path, fields by dotted paths."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any, cast

from pilih_jobs.contracts._generated.cloud import (
    EmbeddedJsonConfig,
    JsonApiConfig,
    JsonFieldMap,
)
from pilih_jobs.discovery.types import FetchMode

from pilih_scraper import fetching
from pilih_scraper.errors import ScrapeStop
from pilih_scraper.jsonpath import as_strings, as_text, get_path
from pilih_scraper.postings import CloudMethod, JobDraft, rfc2822_to_iso
from pilih_scraper.strategies.base import ScrapeJob

DEFAULT_SCRIPT = "script#__NEXT_DATA__"
_MAX_LITERAL = 4 * 1024 * 1024


def balanced_object(text: str, start: int) -> str | None:
    """The `{…}` literal starting at `start` (string- and escape-aware), or None."""
    if start >= len(text) or text[start] != "{":
        return None
    depth = 0
    quote: str | None = None
    escaped = False
    end = min(len(text), start + _MAX_LITERAL)
    for index in range(start, end):
        char = text[index]
        if quote is not None:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in ('"', "'", "`"):
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def global_assignment(scripts: list[str], name: str, *, url: str) -> Any:
    """Parse `window.<name> = {…}` as JSON (never executed); None when absent."""
    pattern = re.compile(
        r"(?:window|globalThis|self)\s*(?:\.\s*"
        + re.escape(name)
        + r"|\[\s*['\"]"
        + re.escape(name)
        + r"['\"]\s*\])\s*=\s*"
    )
    for script in scripts:
        match = pattern.search(script)
        if match is None:
            continue
        start = match.end()
        while start < len(script) and script[start].isspace():
            start += 1
        literal = balanced_object(script, start)
        if literal is None:
            raise ScrapeStop(
                "parse_error",
                f"window.{name} on {url} is not a complete object literal.",
                url=url,
            )
        try:
            return json.loads(literal)
        except json.JSONDecodeError as exc:
            raise ScrapeStop(
                "parse_error",
                f"window.{name} on {url} is a JavaScript literal that is not valid JSON "
                "(it is never executed).",
                url=url,
            ) from exc
    return None


def _date(value: Any, date_format: str | None) -> str | int | float | None:
    if value is None or isinstance(value, bool):
        return None
    if date_format == "epoch_s" and isinstance(value, int | float | str):
        try:
            return float(value) * 1000
        except ValueError:
            return None
    if date_format == "epoch_ms" and isinstance(value, int | float | str):
        try:
            return float(value)
        except ValueError:
            return None
    if isinstance(value, int | float):
        return value
    text = as_text(value)
    if text is None:
        return None
    if date_format == "rfc2822":
        return rfc2822_to_iso(text)
    return rfc2822_to_iso(text) or text


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return float(value) if value >= 0 else None
    text = as_text(value)
    if text is None:
        return None
    try:
        number = float(text.replace(",", ""))
    except ValueError:
        return None
    return number if number >= 0 else None


def draft_from_item(
    item: Mapping[str, Any], fields: JsonFieldMap, *, base_url: str, date_format: str | None
) -> JobDraft:
    def text(path: str | None) -> str | None:
        return as_text(get_path(item, path))

    salary: dict[str, Any] = {}
    low, high = (
        _number(get_path(item, fields.salary_min)),
        _number(get_path(item, fields.salary_max)),
    )
    if low is not None and low > 0:
        salary["min"] = low
    if high is not None and high > 0:
        salary["max"] = high
    currency = text(fields.salary_currency)
    if salary and currency and len(currency) == 3:
        salary["currency"] = currency.upper()
    location = text(fields.location)
    category = get_path(item, fields.category)
    url = ScrapeJob.absolute(base_url, text(fields.url))
    apply = ScrapeJob.absolute(base_url, text(fields.apply_url))
    return JobDraft(
        title=text(fields.title),
        url=url,
        apply_url=apply,
        company=text(fields.company),
        company_url=ScrapeJob.absolute(base_url, text(fields.company_url)),
        locations=[location] if location else [],
        employment_type=text(fields.employment_type),
        salary=salary or None,
        salary_text=text(fields.salary_text),
        description_html=text(fields.description_html),
        description_text=text(fields.description_text),
        posted_at=_date(get_path(item, fields.posted_at), date_format),
        expires_at=_date(get_path(item, fields.expires_at), date_format),
        tags=as_strings(get_path(item, fields.tags)),
        external_id=text(fields.external_id),
        raw_metadata={"category": as_strings(category) or None},
    )


def _items(data: Any, items_path: str, url: str) -> list[Any]:
    items = get_path(data, items_path)
    if not isinstance(items, list):
        raise ScrapeStop(
            "schema_invalid",
            f"Unexpected structure: items_path {items_path!r} is not a list in the response "
            f"of {url}. The API may have changed.",
            url=url,
        )
    return cast(list[Any], items)


def _build_all(
    job: ScrapeJob,
    items: list[Any],
    fields: JsonFieldMap,
    *,
    skip: int,
    base_url: str,
    date_format: str | None,
    method: CloudMethod,
    fetch_mode: FetchMode,
) -> None:
    usable = [cast(Mapping[str, Any], i) for i in items[skip:] if isinstance(i, Mapping)]
    job.ctx.stats.postings_found += len(usable)
    for raw in usable:
        if job.full():
            job.ctx.warn(
                "truncated", "More postings than max_items; the rest waits for the next run"
            )
            return
        draft = draft_from_item(raw, fields, base_url=base_url, date_format=date_format)
        job.builder.build(draft, method=method, fetch_mode=fetch_mode, listing_url=base_url)
    job.complete = True


async def run_json_api(job: ScrapeJob, config: dict[str, Any]) -> None:
    cfg = JsonApiConfig.model_validate(config)
    result = await job.engine.fetch_listing(
        fetching.request(cfg.url, FetchMode.JSON_API), source=job.ref
    )
    job.note_page(result)
    items = _items(result.json, cfg.items_path, result.url)
    _build_all(
        job,
        items,
        cfg.fields,
        skip=cfg.skip_items or 0,
        base_url=result.url,
        date_format=cfg.date_format,
        method="json_api",
        fetch_mode=FetchMode.JSON_API,
    )


async def run_embedded_json(job: ScrapeJob, config: dict[str, Any]) -> None:
    cfg = EmbeddedJsonConfig.model_validate(config)
    result = await job.engine.fetch_listing(
        fetching.request(cfg.url, FetchMode.STATIC_HTML), source=job.ref
    )
    job.note_page(result)
    page = fetching.as_page(result)
    if cfg.global_name:
        scripts = fetching.script_texts(page, cfg.script_selector or "script") if page else []
        data = global_assignment(scripts, cfg.global_name, url=result.url)
        if data is None:
            job.check_wall(cfg.url, result)
            raise ScrapeStop(
                "parse_error",
                f"Layout changed: no inline script assigns window.{cfg.global_name} on "
                f"{result.url}.",
                url=result.url,
            )
    else:
        selector = cfg.script_selector or DEFAULT_SCRIPT
        scripts = fetching.script_texts(page, selector) if page else []
        if not scripts:
            job.check_wall(cfg.url, result)
            raise ScrapeStop(
                "parse_error",
                f"Layout changed: no script matched {selector!r} on {result.url}.",
                url=result.url,
            )
        try:
            data = json.loads(scripts[0])
        except json.JSONDecodeError as exc:
            raise ScrapeStop(
                "schema_invalid",
                f"The embedded script on {result.url} is not JSON.",
                url=result.url,
            ) from exc
    _build_all(
        job,
        _items(data, cfg.items_path, result.url),
        cfg.fields,
        skip=0,
        base_url=cfg.url_base or result.url,
        date_format=cfg.date_format,
        method="embedded_json",
        fetch_mode=FetchMode.STATIC_HTML,
    )
