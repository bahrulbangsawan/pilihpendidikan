"""Job drafts → `CloudPostingItem` (24 §3), through the CLI's normalizer (15 §10).

Each strategy fills a `JobDraft`; `PostingBuilder.build()` applies the source
defaults, runs `pilih_jobs.discovery.normalize` / `items.validate` / `items.build_item`
(so fingerprint, content hash and `dedupe_group` are byte-identical to the contracts'
TypeScript and the server's recomputation), then sets the cloud provenance, the
extras and the data-quality warnings.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, replace
from typing import Any, Final, Literal, cast

from pilih_jobs.contracts._generated.cloud import CloudPostingItem
from pilih_jobs.discovery.items import ItemContext, ItemRejected, build_item, validate
from pilih_jobs.discovery.normalize import (
    PostingDraft,
    normalize,
    parse_iso_ms,
    parse_posted_at,
)
from pilih_jobs.discovery.types import ExtractionMethod, FetchMode, RawPosting
from pydantic import ValidationError

from pilih_scraper import __version__, signals
from pilih_scraper.context import RunContext

CloudMethod = Literal["json_api", "rss", "json_ld", "embedded_json", "css", "adaptive", "ai"]
RAW_METADATA_MAX_BYTES: Final = 8 * 1024
BASE_CONFIDENCE: Final[dict[str, float]] = {
    "json_api": 0.95,
    "rss": 0.85,
    "json_ld": 0.9,
    "embedded_json": 0.85,
    "css": 0.8,
    "adaptive": 0.6,
    "ai": 0.7,
}
THIN_CAP: Final = 0.5
LOW_CONFIDENCE: Final = 0.6
#: The CLI's ExtractionMethod for each cloud method (only picks the validation error
#: class); the cloud method is written into the provenance afterwards.
_CLI_METHOD: Final[dict[str, ExtractionMethod]] = {
    "json_api": "json_api",
    "rss": "css",
    "json_ld": "json_ld",
    "embedded_json": "json_api",
    "css": "css",
    "adaptive": "adaptive",
    "ai": "css",
}


@dataclass
class JobDraft:
    """One posting as a strategy read it (strings as found; the builder normalizes)."""

    title: str | None
    url: str | None
    company: str | None = None
    apply_url: str | None = None
    company_url: str | None = None
    locations: list[str] = field(default_factory=lambda: [])
    structured_locations: list[dict[str, Any]] = field(default_factory=lambda: [])
    workplace_type: str | None = None
    remote: bool | None = None
    employment_type: str | None = None
    salary: dict[str, Any] | None = None
    salary_text: str | None = None
    description_html: str | None = None
    description_text: str | None = None
    requirements: list[str] | None = None
    posted_at: str | int | float | None = None
    expires_at: str | int | float | None = None
    department: str | None = None
    seniority: str | None = None
    tags: list[str] = field(default_factory=lambda: [])
    benefits: list[str] = field(default_factory=lambda: [])
    external_id: str | None = None
    raw_metadata: dict[str, Any] = field(default_factory=lambda: {})
    relocated_fields: list[str] = field(default_factory=lambda: [])
    #: Set by a strategy that already knows the posting is closed / expired.
    closed: bool = False


@dataclass(frozen=True)
class SourceInfo:
    id: str
    slug: str
    canonical_domain: str
    strategy: str
    defaults: dict[str, Any]
    attribution: str | None = None


def _clip_metadata(meta: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in meta.items():
        if value in (None, "", [], {}):
            continue
        out[key[:60]] = value
        if len(json.dumps(out, ensure_ascii=False, default=str)) > RAW_METADATA_MAX_BYTES:
            out.pop(key[:60])
            break
    return json.loads(json.dumps(out, ensure_ascii=False, default=str))


def _expiry_ms(value: str | int | float | None, observed_at: int) -> int | None:
    if value is None:
        return None
    if isinstance(value, str):
        iso = parse_iso_ms(value)
        if iso is not None:
            return iso
        from email.utils import parsedate_to_datetime

        try:
            return int(parsedate_to_datetime(value).timestamp() * 1000)
        except (TypeError, ValueError, IndexError):
            return None
    ms, _relative = parse_posted_at(value, observed_at=observed_at)
    return ms


_WORLDWIDE: Final = re.compile(
    r"^(?:anywhere(?:\s+in\s+the\s+world)?|worldwide|global(?:ly)?|work from anywhere)$",
    re.IGNORECASE,
)
_ONLY_SUFFIX: Final = re.compile(r"\s*(?:\(|-|–)?\s*only\s*\)?\s*$", re.IGNORECASE)


def clean_location(value: str) -> str:
    """Board phrasing → what the normalizer reads: "Anywhere in the World" → "Anywhere",
    "USA Only" → "USA"."""
    text = " ".join(value.split())
    if _WORLDWIDE.match(text):
        return "Anywhere"
    return _ONLY_SUFFIX.sub("", text) or text


_LOOSE_FORMATS: Final = (
    "%d %b %Y",
    "%d %B %Y",
    "%b %d, %Y",
    "%B %d, %Y",
    "%b %d %Y",
    "%d/%m/%Y",
    "%d-%m-%Y",
)
_YEARLESS_FORMATS: Final = ("%d %b", "%d %B", "%b %d", "%B %d")
DAY_MS: Final = 86_400_000


def loose_date(text: str | None, observed_at: int) -> str | None:
    """ISO date for listing-style dates ("13 Oct", "Oct 13, 2026"); a year-less date in
    the future is last year's."""
    if not text:
        return None
    from datetime import UTC, datetime

    value = " ".join(text.replace(".", " ").split())
    for fmt in _LOOSE_FORMATS:
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=UTC).date().isoformat()
        except ValueError:
            continue
    now = datetime.fromtimestamp(observed_at / 1000, tz=UTC)
    for fmt in _YEARLESS_FORMATS:
        try:
            parsed = datetime.strptime(f"{value} {now.year}", f"{fmt} %Y").replace(tzinfo=UTC)
        except ValueError:
            continue
        if parsed.timestamp() * 1000 > observed_at + DAY_MS:
            parsed = parsed.replace(year=now.year - 1)
        return parsed.date().isoformat()
    return None


def rfc2822_to_iso(value: str | None) -> str | None:
    """`Tue, 13 Oct 2026 14:46:05 +0000` → ISO 8601 (feeds); ISO input passes through."""
    if not value:
        return None
    text = value.strip()
    if parse_iso_ms(text) is not None:
        return text
    from email.utils import parsedate_to_datetime

    try:
        return parsedate_to_datetime(text).isoformat()
    except (TypeError, ValueError, IndexError):
        return None


class PostingBuilder:
    """Builds and de-duplicates the items of one scrape."""

    def __init__(self, source: SourceInfo, ctx: RunContext, *, observed_at: int) -> None:
        self.source = source
        self.ctx = ctx
        self.observed_at = observed_at
        self.items: list[dict[str, Any]] = []
        self._seen: set[str] = set()
        self._confidences: list[float] = []

    def _apply_defaults(self, draft: JobDraft) -> JobDraft:
        defaults = self.source.defaults
        changes: dict[str, Any] = {}
        cleaned = [clean_location(loc) for loc in draft.locations]
        if cleaned != draft.locations:
            changes["locations"] = [loc for loc in cleaned if loc]
        if not draft.company and defaults.get("company"):
            changes["company"] = str(defaults["company"])
        if not draft.locations and not draft.structured_locations and defaults.get("location"):
            changes["locations"] = [str(defaults["location"])]
        return replace(draft, **changes) if changes else draft

    def build(
        self,
        draft: JobDraft,
        *,
        method: CloudMethod,
        fetch_mode: FetchMode,
        listing_url: str | None,
        detail_url: str | None = None,
        base_confidence: float | None = None,
    ) -> dict[str, Any] | None:
        """The wire item, or None (invalid → counted and warned; duplicate → counted)."""
        draft = self._apply_defaults(draft)
        defaults = self.source.defaults
        if (
            isinstance(draft.posted_at, str)
            and parse_posted_at(draft.posted_at, observed_at=self.observed_at)[0] is None
        ):
            draft = replace(draft, posted_at=loose_date(draft.posted_at, self.observed_at))
        posting = PostingDraft(
            title=draft.title,
            company_name=draft.company,
            company_url=draft.company_url,
            locations=list(draft.locations),
            structured_locations=list(draft.structured_locations),
            workplace_type=draft.workplace_type,
            remote=draft.remote,
            employment_type=draft.employment_type,
            salary=draft.salary,
            salary_text=draft.salary_text,
            description_html=draft.description_html,
            description_text=draft.description_text,
            requirements=draft.requirements,
            apply_url=draft.apply_url or draft.url,
            canonical_url=draft.url or draft.apply_url,
            posted_at=draft.posted_at,
            department=draft.department,
            seniority=draft.seniority,
        )
        fields = normalize(posting, observed_at=self.observed_at)
        if fields.company_domain == self.source.canonical_domain:
            # The board's own domain is never the employer's (cross-board dedupe).
            fields = replace(fields, company_domain=None)
        if fields.workplace_type == "unknown" and defaults.get("workplace_type"):
            fields = replace(fields, workplace_type=defaults["workplace_type"])
        if fields.employment_type == "unknown" and defaults.get("employment_type"):
            fields = replace(fields, employment_type=defaults["employment_type"])
        cli_method = _CLI_METHOD[method]
        try:
            flags = validate(
                fields, source_kind="generic_listing", method=cli_method, now_ms=self.observed_at
            )
            raw = RawPosting(
                adapter_id="generic_listing",
                source_org=self.source.canonical_domain,
                source_job_ref=(draft.external_id or None),
                data={},
                listing_url=listing_url,
                detail_url=detail_url,
                fetch_mode=fetch_mode,
                method=cli_method,
                relocated_fields=list(draft.relocated_fields),
            )
            item_ctx = ItemContext(
                run_id=cast(str, None),
                device_id=None,
                adapter_version=__version__,
                application_support="unknown",
                source_id=None,
                visibility="public",
                observed_at=self.observed_at,
            )
            prepared = build_item(raw, fields, item_ctx, flags=flags)
        except ItemRejected as exc:
            self.ctx.stats.invalid += 1
            self.ctx.warn(
                "invalid_item",
                f"Postings rejected by validation, e.g. {'; '.join(exc.reasons)[:300]}",
            )
            return None
        if prepared.fingerprint in self._seen:
            self.ctx.stats.duplicates += 1
            return None
        body = prepared.body
        self._finish(body, draft, fields.description_text, method, base_confidence, flags)
        try:
            CloudPostingItem.model_validate(body)
        except ValidationError as exc:
            self.ctx.stats.invalid += 1
            first = exc.errors()[0]
            where = ".".join(str(p) for p in first["loc"])
            self.ctx.warn("invalid_item", f"Posting failed the contract at {where}: {first['msg']}")
            return None
        self._seen.add(prepared.fingerprint)
        self.items.append(body)
        return body

    def _finish(
        self,
        body: dict[str, Any],
        draft: JobDraft,
        description: str,
        method: CloudMethod,
        base_confidence: float | None,
        flags: list[str],
    ) -> None:
        extraction = cast(dict[str, Any], body["extraction"])
        all_flags = [str(f) for f in cast(list[Any], extraction.get("flags") or [])]
        relocated = bool(draft.relocated_fields)
        effective: CloudMethod = "adaptive" if relocated and method == "css" else method
        confidence = base_confidence if base_confidence is not None else BASE_CONFIDENCE[effective]
        if relocated:
            confidence = min(confidence, BASE_CONFIDENCE["adaptive"])
            self.ctx.stats.relocated += 1
        if "thin" in flags:
            confidence = min(confidence, THIN_CAP)
            self.ctx.warn(
                "thin_description",
                "Postings with a description under 50 characters (confidence ≤ 0.5)",
                field="description_text",
            )
        reasons = signals.suspicious_reasons(draft.title, description)
        if reasons:
            all_flags += [f"suspicious:{r}" for r in reasons if f"suspicious:{r}" not in all_flags]
            self.ctx.warn(
                "suspicious",
                f"Postings flagged as possibly fraudulent ({', '.join(reasons)})",
            )
        extraction["method"] = effective
        extraction["confidence"] = round(confidence, 3)
        extraction["flags"] = all_flags
        extraction["cloud"] = {
            "source_id": self.source.id,
            "strategy": self.source.strategy,
            "run_id": self.ctx.run_id,
            "scraper": __version__,
        }
        self._confidences.append(confidence)
        if confidence < LOW_CONFIDENCE:
            self.ctx.warn("low_confidence", "Postings extracted with confidence below 0.6")
        if not body.get("locations"):
            self.ctx.warn("missing_field", "Postings without a location", field="location")
        if body.get("posted_at") is None:
            self.ctx.warn("missing_field", "Postings without a posting date", field="posted_at")
        if body.get("description_truncated"):
            self.ctx.warn("truncated", "Descriptions clipped at 64 KB", field="description_text")
        if body.get("workplace_type") in (None, "unknown"):
            self.ctx.warn(
                "missing_field",
                "Postings without a remote / hybrid / onsite type",
                field="workplace_type",
            )
        detail = signals.employment_detail(
            draft.employment_type, f"{draft.title or ''} {description}"
        )
        if detail == "freelance":
            body["employment_type"] = "contract"
        extras: dict[str, Any] = {
            "skills": signals.skills_of(draft.tags, str(body.get("title") or ""), description),
            "benefits": [b[:300] for b in draft.benefits[:50]],
            "expires_at": _expiry_ms(draft.expires_at, self.observed_at),
            "employment_detail": detail,
            "application_method": signals.application_method(
                cast(str | None, body.get("apply_url")) or draft.apply_url,
                description,
                self.source.canonical_domain,
            ),
            "auth_required": signals.login_to_apply(description)
            or signals.needs_platform_account(
                cast(str | None, body.get("apply_url")) or draft.apply_url or draft.url
            ),
            "raw_metadata": _clip_metadata(
                {
                    **draft.raw_metadata,
                    "tags": draft.tags[:30] or None,
                    "attribution": self.source.attribution,
                }
            ),
        }
        body["extras"] = {k: v for k, v in extras.items() if v is not None}
        expires = extras["expires_at"]
        if draft.closed or (isinstance(expires, int) and expires < self.observed_at):
            body["status_hint"] = "closed"
            body["status_evidence"] = {"http_status": None, "marker": "valid_through_passed"}

    def confidence_avg(self) -> float | None:
        if not self._confidences:
            return None
        return round(sum(self._confidences) / len(self._confidences), 3)
