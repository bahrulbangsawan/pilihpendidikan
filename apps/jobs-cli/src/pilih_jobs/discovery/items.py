"""Validation (15 §10.2), provenance and confidence (§11), fingerprints (03 §4.2) and the
`postings:batch` item shapes (05 §4).

- Rejected (`schema_invalid` for JSON APIs, `parse_error` for pages): no title, no company,
  neither `apply_url` nor `canonical_url`; a non-http(s) URL, or `http:` outside the
  user-provided kinds; an excluded host (D-17, `policy_blocked`); `posted_at` later than
  now + 1 day; anything the generated contract model refuses.
- Flagged: `thin` (description < 50 characters, confidence ≤ 0.5), `http_url`.
- Confidence: JSON API 0.95–1.0, JSON-LD 0.9, primary CSS 0.8, page heuristics 0.7,
  adaptive relocation ≤ 0.6, thin ≤ 0.5, selector drift caps the source at 0.6.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Final, Literal
from urllib.parse import urlsplit

from pydantic import ValidationError

from pilih_jobs.contracts.adapters import excluded_source_for_host
from pilih_jobs.contracts.fingerprint import (
    FingerprintInput,
    content_hash,
    dedupe_group,
    fingerprint,
    fingerprint_key,
    primary_location,
)
from pilih_jobs.contracts.index import model
from pilih_jobs.discovery.errors import ErrorClass
from pilih_jobs.discovery.jsonutil import number, obj, strs
from pilih_jobs.discovery.normalize import NormalizedFields
from pilih_jobs.discovery.types import ExtractionMethod, ExtractionOutcome, FetchMode, RawPosting
from pilih_jobs.version import __version__, dependency_version

DAY_MS: Final = 86_400_000
THIN_DESCRIPTION_CHARS: Final = 50
USER_URL_KINDS: Final = frozenset({"custom_url", "career_page", "generic_listing"})
CONFIDENCE: Final[dict[str, float]] = {
    "json_api": 0.98,
    "json_ld": 0.9,
    "css": 0.8,
    "xpath": 0.8,
    "heuristic": 0.7,
    "adaptive": 0.6,
    "thin": 0.5,
    "drift": 0.6,
}
Visibility = Literal["public", "private"]


class ItemRejected(Exception):  # noqa: N818 - a rejection outcome, not a failure
    def __init__(self, error_class: ErrorClass, reasons: list[str]) -> None:
        super().__init__("; ".join(reasons))
        self.error_class: ErrorClass = error_class
        self.reasons = reasons


def engine_versions() -> dict[str, str]:
    out = {"pilih_jobs": __version__}
    for dist in ("scrapling", "playwright"):
        version = dependency_version(dist)
        if version:
            out[dist] = version
    return out


def _url_ok(url: str | None, *, allow_http: bool) -> str | None:
    """A problem description, or None when the URL is acceptable."""
    if url is None:
        return None
    scheme = urlsplit(url).scheme.lower()
    if scheme == "https":
        return None
    if scheme == "http":
        return None if allow_http else "http URLs are accepted only for user-provided pages"
    return f"unsupported URL scheme {scheme or '(none)'}"


def validate(
    fields: NormalizedFields, *, source_kind: str, method: ExtractionMethod, now_ms: int
) -> list[str]:
    """Raise `ItemRejected` (15 §10.2); returns validation flags (`thin`, `http_url`)."""
    error_class: ErrorClass = "schema_invalid" if method == "json_api" else "parse_error"
    reasons: list[str] = []
    flags: list[str] = []
    if not fields.title:
        reasons.append("title is missing")
    if not fields.company_name:
        reasons.append("company_name is missing")
    if not fields.apply_url and not fields.canonical_url:
        reasons.append("neither apply_url nor canonical_url is present")
    allow_http = source_kind in USER_URL_KINDS
    for name, url in (("apply_url", fields.apply_url), ("canonical_url", fields.canonical_url)):
        problem = _url_ok(url, allow_http=allow_http)
        if problem:
            reasons.append(f"{name}: {problem}")
        elif url and urlsplit(url).scheme.lower() == "http" and "http_url" not in flags:
            flags.append("http_url")
        excluded = excluded_source_for_host(url) if url else None
        if excluded is not None:
            raise ItemRejected("policy_blocked", [f"{name} is on {excluded.display_name} (D-17)"])
    if fields.posted_at is not None and fields.posted_at > now_ms + DAY_MS:
        reasons.append("posted_at is more than one day in the future")
    if reasons:
        raise ItemRejected(error_class, reasons)
    if len(fields.description_text) < THIN_DESCRIPTION_CHARS:
        flags.append("thin")
    return flags


def confidence_for(
    method: ExtractionMethod,
    *,
    relocated: bool,
    flags: list[str],
    fields: NormalizedFields,
) -> float:
    value = CONFIDENCE.get(method, CONFIDENCE["css"])
    if method == "json_api" and (fields.posted_at is None or not fields.locations):
        value = 0.95
    if "heuristic" in flags:
        value = min(value, CONFIDENCE["heuristic"])
    if relocated or method == "adaptive":
        value = min(value, CONFIDENCE["adaptive"])
    if "thin" in flags:
        value = min(value, CONFIDENCE["thin"])
    return round(value, 3)


@dataclass
class ItemContext:
    run_id: str
    device_id: str | None
    adapter_version: str
    application_support: str
    source_id: str | None
    visibility: Visibility
    observed_at: int


@dataclass
class PreparedItem:
    """A validated posting ready for upload (full or unchanged-only)."""

    fingerprint: str
    content_hash: str
    title: str
    body: dict[str, Any]
    relocated_fields: list[str] = field(default_factory=lambda: [])
    extraction: list[ExtractionOutcome] = field(default_factory=lambda: [], repr=False)
    source_job_ref: str | None = None

    @property
    def client_ref(self) -> str:
        return client_ref_for(self.fingerprint)

    def unchanged_body(self, observed_at: int) -> dict[str, Any]:
        return unchanged_item(self.fingerprint, self.content_hash, observed_at)

    def cap_confidence(self, cap: float) -> None:
        extraction = obj(self.body.get("extraction"))
        if not extraction:
            return
        current = number(extraction.get("confidence"))
        if current is not None and current > cap:
            extraction["confidence"] = cap
        flags = strs(extraction.get("flags"))
        if "selector_drift" not in flags:
            extraction["flags"] = [*flags, "selector_drift"]


def client_ref_for(fp: str) -> str:
    """The batch item's `client_ref`: the fingerprint's hex digest (64 chars, unique)."""
    return fp.removeprefix("fp1:")


def fingerprint_from_ref(client_ref: str) -> str:
    return f"fp1:{client_ref}"


def unchanged_item(
    fp: str,
    hash_: str,
    observed_at: int,
    *,
    status_hint: str | None = None,
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "client_ref": client_ref_for(fp),
        "fingerprint": fp,
        "content_hash": hash_,
        "observed_at": observed_at,
    }
    if status_hint is not None:
        item["status_hint"] = status_hint
        if evidence:
            item["status_evidence"] = evidence
    return item


def stable_fingerprint(kind: str, org: str | None, ref: str | None) -> str | None:
    """`src|` fingerprint computable from the listing alone (watermark shortcut)."""
    if not org or not ref:
        return None
    key_input = FingerprintInput(source_kind=kind, title="", source_org=org, source_job_ref=ref)
    if not fingerprint_key(key_input).startswith("src|"):
        return None
    return fingerprint(key_input)


def _drop_none(value: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in value.items() if v is not None}


def build_item(
    raw: RawPosting,
    fields: NormalizedFields,
    ctx: ItemContext,
    *,
    flags: list[str],
) -> PreparedItem:
    location = primary_location(fields.locations)
    fp = fingerprint(
        FingerprintInput(
            source_kind=raw.adapter_id,
            title=fields.title,
            source_org=raw.source_org,
            source_job_ref=raw.source_job_ref,
            company_domain=fields.company_domain,
            location_primary=location,
            apply_url=fields.apply_url,
            canonical_url=fields.canonical_url,
        )
    )
    hash_ = content_hash(fields.title, fields.description_text)
    all_flags = list(dict.fromkeys([*raw.flags, *fields.flags, *flags]))
    all_flags = [f for f in all_flags if f != "detail_not_modified"]
    relocated = list(raw.relocated_fields)
    method: ExtractionMethod = "adaptive" if relocated else raw.method
    extraction: dict[str, Any] = {
        "v": 1,
        "adapter": raw.adapter_id,
        "adapter_version": ctx.adapter_version,
        "engine": engine_versions(),
        "fetch_mode": FetchMode(raw.fetch_mode).value,
        "method": method,
        "source_urls": _drop_none({"listing": raw.listing_url, "detail": raw.detail_url}),
        "relocated_fields": relocated,
        "confidence": confidence_for(
            method, relocated=bool(relocated), flags=all_flags, fields=fields
        ),
        "flags": all_flags,
        "observed_at": ctx.observed_at,
        "run_id": ctx.run_id,
        "device_id": ctx.device_id,
    }
    body: dict[str, Any] = {
        "client_ref": client_ref_for(fp),
        "fingerprint": fp,
        "visibility": ctx.visibility,
        "source_kind": raw.adapter_id,
        "source_org": raw.source_org[:200] if raw.source_org else None,
        "source_job_ref": raw.source_job_ref[:200] if raw.source_job_ref else None,
        "source_id": ctx.source_id,
        "canonical_url": fields.canonical_url,
        "apply_url": fields.apply_url,
        "apply_domain": fields.apply_domain,
        "company_name": fields.company_name,
        "company_domain": fields.company_domain,
        "title": fields.title,
        "department": fields.department,
        "locations": fields.locations,
        "workplace_type": fields.workplace_type,
        "employment_type": fields.employment_type,
        "seniority": fields.seniority,
        "salary": fields.salary,
        "description_text": fields.description_text,
        "description_truncated": fields.description_truncated,
        "requirements": fields.requirements,
        "posted_at": fields.posted_at,
        "application_support": ctx.application_support,
        "content_hash": hash_,
        "dedupe_group": dedupe_group(
            title=fields.title, company_domain=fields.company_domain, location_primary=location
        ),
        "observed_at": ctx.observed_at,
        "extraction": _drop_none(extraction),
    }
    wire = _drop_none(body)
    try:
        model("NormalizedPosting").model_validate(wire)
    except ValidationError as exc:
        error_class: ErrorClass = "schema_invalid" if raw.method == "json_api" else "parse_error"
        problems = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:5]]
        raise ItemRejected(error_class, problems) from exc
    return PreparedItem(
        fingerprint=fp,
        content_hash=hash_,
        title=fields.title,
        body=wire,
        relocated_fields=relocated,
        extraction=list(raw.extraction),
        source_job_ref=raw.source_job_ref,
    )
