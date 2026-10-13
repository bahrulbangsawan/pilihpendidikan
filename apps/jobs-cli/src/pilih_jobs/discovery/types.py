"""Engine and adapter data types (15 §4, §14.2).

These types are free of Scrapling: adapters, the manager and the tests import them
without loading the engine. `FetchResult.page` is an `HtmlPage` (a protocol implemented
inside `discovery.engine`), so a Scrapling `Selector` never escapes the engine package as
a type in a public API.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, Literal, Protocol

from pilih_jobs.discovery.errors import DiscoveryError

ExtractionMethod = Literal["json_api", "json_ld", "css", "xpath", "adaptive"]
FetchPurpose = Literal["listing", "detail", "robots", "sitemap"]
PostingStatus = Literal["open", "closed", "unknown"]


class FetchMode(StrEnum):
    JSON_API = "json_api"  # FetcherSession → JSON
    STATIC_HTML = "static_html"  # FetcherSession → Selector
    BROWSER = "browser"  # AsyncDynamicSession → Selector


@dataclass(frozen=True)
class FetchRequest:
    url: str
    mode: FetchMode
    method: Literal["GET", "POST"] = "GET"
    json_body: Mapping[str, Any] | None = None  # Workday cxs only
    headers: Mapping[str, str] = field(default_factory=lambda: {})
    etag: str | None = None  # conditional GET (incremental, 15 §9)
    last_modified: str | None = None
    wait_selector: str | None = None  # BROWSER only
    timeout_s: float = 30.0
    purpose: FetchPurpose = "listing"


class HtmlPage(Protocol):
    """Read-only view of a parsed HTML page (implemented by the engine)."""

    @property
    def url(self) -> str: ...

    def json_ld(self) -> list[dict[str, Any]]: ...

    def meta_content(self, *names: str) -> str | None: ...

    def links(self, css: str | None = None) -> list[str]: ...

    def first_text(self, css: str) -> str | None: ...

    def texts(self, css: str) -> list[str]: ...

    def first_attr(self, css: str, attr: str) -> str | None: ...

    def first_html(self, css: str) -> str | None: ...

    def visible_text(self) -> str: ...

    def title(self) -> str | None: ...

    def rel_next(self) -> str | None: ...


@dataclass(frozen=True)
class FetchResult:
    url: str  # final URL after redirects
    status: int
    headers: Mapping[str, str]
    not_modified: bool  # 304
    json: Any | None
    page: HtmlPage | None
    elapsed_ms: int
    fetch_mode: FetchMode
    attempt: int
    body_size: int = 0

    def header(self, name: str) -> str | None:
        wanted = name.lower()
        for key, value in self.headers.items():
            if key.lower() == wanted:
                return value
        return None


@dataclass(frozen=True)
class FieldSpec:
    name: str  # "title", "location", "description_html", "apply_url", …
    css: str | None = None
    xpath: str | None = None
    attr: str | None = None  # e.g. "href"
    many: bool = False
    required: bool = False
    adaptive: bool = True  # Scrapling adaptive relocation on a miss
    html: bool = False  # take the element's inner HTML instead of its text


@dataclass(frozen=True)
class ExtractionSpec:
    identifier_prefix: str  # "<adapter_id>" (15 §6)
    item_css: str | None  # listing container (list pages)
    fields: tuple[FieldSpec, ...]
    prefer_json_ld: bool = True  # schema.org JobPosting first (career_page, generic)


@dataclass
class ExtractionOutcome:
    values: dict[str, Any]
    method: ExtractionMethod
    relocated_fields: list[str] = field(default_factory=lambda: [])
    missing_required: list[str] = field(default_factory=lambda: [])
    confidence: float = 0.8
    #: Elements found by their primary selector, saved to the adaptive store only after
    #: the item passed validation (15 §6 save policy). Opaque to non-engine code.
    pending_saves: list[tuple[Any, str]] = field(default_factory=lambda: [], repr=False)


@dataclass(frozen=True)
class SourceRef:
    """The source a request is made for (politeness, stop rules, adaptive identifiers)."""

    key: str  # "greenhouse:acme" (progress events)
    adapter_id: str
    org: str  # source_org or host (adaptive identifiers, 15 §6)
    source_id: str | None = None
    stop_on: frozenset[str] = frozenset()
    per_domain_concurrency: int = 2
    min_delay_ms: int = 1000
    allow_browser: bool = False


@dataclass(frozen=True)
class CrawlConfig:
    start_url: str
    detail_url_pattern: str
    listing_url_pattern: str | None = None
    max_pages: int = 50
    max_details: int = 2000
    crawl_dir: Path | None = None  # `<data>/crawls/<src_id>/` (checkpoints), None = none
    use_sitemap: bool = True
    cancel: asyncio.Event | None = None
    mode: FetchMode = FetchMode.STATIC_HTML  # BROWSER only when opted in (15 §5)


@dataclass
class CrawlEvent:
    kind: Literal["listing", "detail", "error", "finished"]
    url: str = ""
    result: FetchResult | None = None
    error: DiscoveryError | None = None
    stats: dict[str, Any] = field(default_factory=lambda: {})


@dataclass
class RawPosting:
    """One posting as an adapter found it, before normalization (15 §14.2)."""

    adapter_id: str
    source_org: str | None
    source_job_ref: str | None
    data: dict[str, Any]
    listing_url: str | None = None
    detail_url: str | None = None
    fetch_mode: FetchMode = FetchMode.JSON_API
    method: ExtractionMethod = "json_api"
    relocated_fields: list[str] = field(default_factory=lambda: [])
    flags: list[str] = field(default_factory=lambda: [])
    updated_at_ms: int | None = None  # watermark field (15 §9)
    needs_detail: bool = False
    extraction: list[ExtractionOutcome] = field(default_factory=lambda: [], repr=False)


ProgressKind = Literal["page", "cursor", "complete", "not_modified", "warning", "redirect"]


@dataclass
class ProgressEvent:
    kind: ProgressKind
    data: dict[str, Any] = field(default_factory=lambda: {})


@dataclass(frozen=True)
class TrackedPostingRef:
    """A tracked, still-open posting to re-check (15 §12)."""

    posting_id: str
    fingerprint: str
    content_hash: str
    source_kind: str
    source_org: str | None
    source_job_ref: str | None
    apply_url: str | None
    canonical_url: str | None
    title: str = ""
    source_config: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class StatusCheck:
    status: PostingStatus
    http_status: int | None = None
    marker: str | None = None


NextPage = Callable[[FetchResult], FetchRequest | None]


class DiscoveryEngine(Protocol):
    """What adapters may call: the ONLY network access (15 §3)."""

    async def fetch(self, req: FetchRequest, *, source: SourceRef) -> FetchResult: ...

    async def fetch_listing(
        self, req: FetchRequest, *, source: SourceRef, first_page: bool = True
    ) -> FetchResult: ...

    async def fetch_detail(self, req: FetchRequest, *, source: SourceRef) -> FetchResult: ...

    def iter_listing_pages(
        self,
        first: FetchRequest,
        *,
        source: SourceRef,
        next_page: NextPage,
        max_pages: int = 50,
    ) -> AsyncIterator[FetchResult]: ...

    def extract(
        self, result: FetchResult, spec: ExtractionSpec, *, source: SourceRef
    ) -> ExtractionOutcome: ...

    def extract_items(
        self, result: FetchResult, spec: ExtractionSpec, *, source: SourceRef
    ) -> list[ExtractionOutcome]: ...

    def confirm_adaptive(self, outcomes: Iterable[ExtractionOutcome]) -> None: ...

    def crawl(self, config: CrawlConfig, *, source: SourceRef) -> AsyncIterator[CrawlEvent]: ...

    def listing_truncated(self, source: SourceRef) -> bool: ...

    def browser_enabled(self, source: SourceRef) -> bool: ...

    async def aclose(self) -> None: ...
