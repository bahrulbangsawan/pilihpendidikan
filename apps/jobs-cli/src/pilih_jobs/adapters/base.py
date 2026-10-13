"""The source adapter interface (15 §14.2).

Adapters never perform raw HTTP: they call the engine through `AdapterContext.engine`,
so robots, politeness, retries and the policy guard cannot be skipped. `discover()`
yields `RawPosting`s and `ProgressEvent`s (`page`, `cursor`, `complete`, `not_modified`,
`warning`, `redirect`); `to_normalized()` maps one raw posting into a `PostingDraft`
that the shared normalizer (15 §10) finishes; `check_open()` implements the expiry
check of 15 §12.
"""

from __future__ import annotations

import asyncio
import re
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Callable, Mapping
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, ClassVar, Final, TypeVar, cast

from pydantic import BaseModel, ValidationError

from pilih_jobs.contracts import ids
from pilih_jobs.contracts.adapters import AdapterManifest, adapter_manifests
from pilih_jobs.discovery.cursor import CursorState
from pilih_jobs.discovery.errors import DiscoveryError
from pilih_jobs.discovery.normalize import PostingDraft
from pilih_jobs.discovery.types import (
    DiscoveryEngine,
    FetchMode,
    FetchRequest,
    ProgressEvent,
    RawPosting,
    SourceRef,
    StatusCheck,
    TrackedPostingRef,
)
from pilih_jobs.errors import ConfigError

#: Page text that marks a closed posting (15 §12), English and Indonesian.
CLOSED_TEXT: Final = re.compile(
    r"no longer accepting applications|"
    r"(?:this|the) (?:job|position|posting|role|vacancy|opening) (?:is |has been )?"
    r"(?:no longer (?:available|open|active)|closed|filled|expired)|"
    r"position has been filled|job (?:posting |listing )?has expired|"
    r"applications? (?:are |is |have )?(?:now )?closed|"
    r"lowongan (?:ini )?(?:sudah |telah )?(?:ditutup|berakhir|tidak tersedia)|"
    r"tidak lagi menerima lamaran",
    re.IGNORECASE,
)
DEFAULT_ADAPTIVE_MAX_PAGES: Final = 50

AdapterItem = RawPosting | ProgressEvent
ModelT = TypeVar("ModelT", bound=BaseModel)


@dataclass
class AdapterContext:
    engine: DiscoveryEngine
    run_id: str
    source: SourceRef
    cursor: CursorState
    cancel: asyncio.Event
    emit: Callable[[ProgressEvent], None]
    max_pages: int = DEFAULT_ADAPTIVE_MAX_PAGES
    keywords: str | None = None
    location: str | None = None
    crawl_dir: Path | None = None
    label: str | None = None
    #: Resolves another adapter by id (career_page → ATS redirect).
    adapter_for: Callable[[str], SourceAdapter] | None = None
    #: Cache shared by `check_open` calls of one run (e.g. an Ashby board listing).
    cache: dict[str, Any] = field(default_factory=lambda: {})

    def for_source(self, source: SourceRef) -> AdapterContext:
        return replace(self, source=source)


# ---------------------------------------------------------------- config validation
_TYPE_CHECKS: Final[dict[str, Callable[[Any], bool]]] = {
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "object": lambda v: isinstance(v, dict),
    "number": lambda v: isinstance(v, int | float) and not isinstance(v, bool),
}


def _check_value(path: str, value: Any, schema: Mapping[str, Any]) -> None:
    kind = schema.get("type")
    if isinstance(kind, str) and kind in _TYPE_CHECKS and not _TYPE_CHECKS[kind](value):
        raise ConfigError(f"{path} must be a {kind}")
    enum = schema.get("enum")
    if isinstance(enum, list) and value not in cast(list[Any], enum):
        raise ConfigError(f"{path} must be one of {enum}")
    if isinstance(value, str):
        max_length = schema.get("maxLength")
        min_length = schema.get("minLength")
        if isinstance(max_length, int) and len(value) > max_length:
            raise ConfigError(f"{path} is longer than {max_length} characters")
        if isinstance(min_length, int) and len(value) < min_length:
            raise ConfigError(f"{path} is shorter than {min_length} characters")
        pattern = schema.get("pattern")
        if isinstance(pattern, str) and re.search(pattern, value) is None:
            raise ConfigError(f"{path} has an invalid format")
    if isinstance(value, int) and not isinstance(value, bool):
        minimum, maximum = schema.get("minimum"), schema.get("maximum")
        if isinstance(minimum, int) and value < minimum:
            raise ConfigError(f"{path} must be ≥ {minimum}")
        if isinstance(maximum, int) and value > maximum:
            raise ConfigError(f"{path} must be ≤ {maximum}")
    if isinstance(value, dict):
        validate_object(path, cast(dict[str, Any], value), schema)


def validate_object(path: str, value: Mapping[str, Any], schema: Mapping[str, Any]) -> None:
    """A JSON Schema subset (the manifests' `config_schema` vocabulary)."""
    properties = cast(Mapping[str, Any], schema.get("properties") or {})
    for key in cast(list[str], schema.get("required") or []):
        if key not in value:
            raise ConfigError(f"{path}.{key} is required")
    extra = schema.get("additionalProperties", True)
    for key, item in value.items():
        child = properties.get(key)
        if child is not None:
            _check_value(f"{path}.{key}", item, cast(Mapping[str, Any], child))
        elif extra is False:
            raise ConfigError(f"{path}.{key} is not a known option")
        elif isinstance(extra, dict):
            _check_value(f"{path}.{key}", item, cast(Mapping[str, Any], extra))


def parse_model(model: type[ModelT], data: Any, *, what: str) -> ModelT:
    """Validate an API payload; a shape mismatch is `schema_invalid` (15 §8)."""
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise DiscoveryError(
            "schema_invalid",
            f"{what}: unexpected response shape ({exc.error_count()} problem(s)); "
            "the adapter may need an update",
        ) from exc


# ---------------------------------------------------------------- the adapter base
class SourceAdapter(ABC):
    id: ClassVar[str]

    def __init__(self) -> None:
        self.manifest: AdapterManifest = adapter_manifests()[self.id]

    @property
    def version(self) -> str:
        return str(self.manifest.version)

    @property
    def application_support(self) -> str:
        return str(self.manifest.capabilities.application_support)

    @property
    def incremental(self) -> frozenset[str]:
        return frozenset(str(i) for i in self.manifest.capabilities.incremental)

    def config_schema(self) -> Mapping[str, Any]:
        return cast(Mapping[str, Any], self.manifest.config_schema)

    def validate_config(self, config: Mapping[str, Any]) -> dict[str, Any]:
        """Validate against the manifest's `config_schema` (the server does the same)."""
        validate_object("config", config, self.config_schema())
        return dict(config)

    @abstractmethod
    def source_org(self, config: Mapping[str, Any]) -> str:
        """`source_org` of the postings (board token, site, host…)."""

    def source_ref(
        self,
        config: Mapping[str, Any],
        *,
        source_id: str | None = None,
        key: str | None = None,
        allow_browser: bool = False,
    ) -> SourceRef:
        limits = self.manifest.rate_limits
        org = self.source_org(config)
        return SourceRef(
            key=key or f"{self.id}:{org}",
            adapter_id=self.id,
            org=org,
            source_id=source_id,
            stop_on=frozenset(str(s) for s in self.manifest.restrictions.stop_on),
            per_domain_concurrency=int(limits.per_domain_concurrency),
            min_delay_ms=int(limits.min_delay_ms),
            allow_browser=allow_browser,
        )

    def max_pages(self) -> int:
        return int(self.manifest.rate_limits.max_pages)

    @abstractmethod
    def discover(self, ctx: AdapterContext, cfg: Mapping[str, Any]) -> AsyncIterator[AdapterItem]:
        """Enumerate the source's postings."""

    async def fetch_detail(
        self, ctx: AdapterContext, cfg: Mapping[str, Any], raw: RawPosting
    ) -> RawPosting:
        """Complete a listing entry (no-op when the listing is complete)."""
        return raw

    @abstractmethod
    def to_normalized(self, raw: RawPosting) -> PostingDraft:
        """Map the adapter's format into a `PostingDraft` (finished by the normalizer)."""

    async def check_open(self, ctx: AdapterContext, posting: TrackedPostingRef) -> StatusCheck:
        """Default: GET the posting page; 404/410 or a closed marker → closed."""
        url = posting.canonical_url or posting.apply_url
        if not url:
            return StatusCheck("unknown")
        return await check_page_open(ctx, url)


async def check_page_open(ctx: AdapterContext, url: str) -> StatusCheck:
    """15 §12 for HTML pages: 404/410, JSON-LD `validThrough` in the past, closed text."""
    from pilih_jobs.adapters.jsonld import job_postings, valid_through_ms

    try:
        result = await ctx.engine.fetch_detail(
            FetchRequest(url, FetchMode.STATIC_HTML, purpose="detail"), source=ctx.source
        )
    except DiscoveryError as exc:
        if exc.error_class in ("not_found", "source_closed"):
            return StatusCheck(
                "closed", http_status=exc.http_status, marker=f"http_{exc.http_status}"
            )
        return StatusCheck("unknown", http_status=exc.http_status)
    page = result.page
    if page is None:
        return StatusCheck("unknown", http_status=result.status)
    now = ctx_now()
    for posting in job_postings(page.json_ld()):
        until = valid_through_ms(posting)
        if until is not None and until < now:
            return StatusCheck("closed", http_status=result.status, marker="valid_through_past")
    match = CLOSED_TEXT.search(page.visible_text())
    if match is not None:
        return StatusCheck("closed", http_status=result.status, marker=match.group(0)[:200].lower())
    return StatusCheck("open", http_status=result.status)


def ctx_now() -> int:
    return ids.now_ms()


def not_found_check(exc: DiscoveryError, marker: str) -> StatusCheck:
    if exc.error_class in ("not_found", "source_closed"):
        return StatusCheck("closed", http_status=exc.http_status, marker=marker)
    return StatusCheck("unknown", http_status=exc.http_status)
