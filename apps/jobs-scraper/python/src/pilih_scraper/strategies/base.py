"""What every strategy gets: the engine, the source, limits, the builder and outputs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Final, cast
from urllib.parse import urljoin, urlsplit

from pilih_jobs.contracts.psl import registrable_domain
from pilih_jobs.discovery.engine import ScraplingJobEngine
from pilih_jobs.discovery.types import FetchResult, SourceRef

from pilih_scraper import fetching, signals
from pilih_scraper.context import RunContext
from pilih_scraper.errors import ScrapeStop
from pilih_scraper.postings import PostingBuilder

AI_TEXT_MAX: Final = 8192
AI_CANDIDATES_MAX: Final = 5
NEAR_EMPTY_TEXT: Final = 1500
DETAIL_SEEN_MAX: Final = 500


@dataclass
class Limits:
    min_delay_ms: int
    max_pages: int
    max_items: int
    max_details: int


@dataclass
class ScrapeJob:
    engine: ScraplingJobEngine
    ref: SourceRef
    ctx: RunContext
    builder: PostingBuilder
    limits: Limits
    canonical_domain: str
    cursor_in: dict[str, Any]
    allow_browser: bool
    ai_fallback: bool
    cursor_out: dict[str, Any] = field(default_factory=lambda: {})
    complete: bool = False
    ai_candidates: list[dict[str, Any]] = field(default_factory=lambda: [])
    #: HTML pages read this run (url, title, text) for the AI fallback.
    pages_seen: list[tuple[str, str | None, str]] = field(default_factory=lambda: [])

    # ------------------------------------------------------------------ helpers
    def full(self) -> bool:
        return len(self.builder.items) >= self.limits.max_items

    def same_site(self, url: str) -> bool:
        host = (urlsplit(url).hostname or "").lower().rstrip(".")
        domain = registrable_domain(host) or host
        return domain == self.canonical_domain

    @staticmethod
    def absolute(base: str, href: str | None) -> str | None:
        if not href:
            return None
        url = urljoin(base, href.strip())
        return url if urlsplit(url).scheme in ("http", "https") else None

    def note_page(self, result: FetchResult) -> None:
        self.ctx.stats.pages += 1
        self.ctx.stats.fetch_mode = result.fetch_mode.value
        self.ctx.add_log(
            "info",
            "page_fetched",
            f"Fetched page {self.ctx.stats.pages} ({result.body_size} bytes)",
            url=result.url,
            http_status=result.status,
            ms=result.elapsed_ms,
        )
        if result.body_size == 0:
            raise ScrapeStop(
                "source_unavailable",
                f"{urlsplit(result.url).hostname} answered with an empty body "
                f"(HTTP {result.status}).",
                url=result.url,
                http_status=result.status,
            )
        page = fetching.as_page(result)
        if page is not None and result.json is None:
            self.pages_seen.append((result.url, page.title(), page.visible_text()))

    def check_wall(self, requested_url: str, result: FetchResult) -> None:
        """Called when a page yielded no postings: a login / paywall is `auth_required`."""
        if signals.login_redirect(requested_url, result.url):
            raise ScrapeStop(
                "auth_required",
                f"{urlsplit(requested_url).hostname} redirected to a sign-in page "
                f"({urlsplit(result.url).path}). Listings behind a login are never fetched.",
                url=result.url,
                http_status=result.status,
            )
        page = fetching.as_page(result)
        if page is None:
            return
        text = page.visible_text()
        password = fetching.count(page, 'input[type="password"]') > 0
        if (password and len(text) < NEAR_EMPTY_TEXT * 3) or signals.paywall_text(text):
            raise ScrapeStop(
                "auth_required",
                f"{urlsplit(result.url).hostname} shows a sign-in / membership wall instead of "
                "listings. Listings behind an account are never fetched.",
                url=result.url,
                http_status=result.status,
            )

    def add_ai_candidates(self, reason: str) -> None:
        for url, title, text in self.pages_seen:
            if len(self.ai_candidates) >= AI_CANDIDATES_MAX:
                return
            if any(c["url"] == url for c in self.ai_candidates):
                continue
            self.ai_candidates.append(
                {
                    "url": url[:2048],
                    "reason": reason,
                    "title": title[:300] if title else None,
                    "text": text[:AI_TEXT_MAX],
                }
            )

    def detail_seen(self) -> list[str]:
        raw = self.cursor_in.get("detail_seen")
        items = cast(list[Any], raw) if isinstance(raw, list) else []
        return [r for r in items if isinstance(r, str)]

    def remember_details(self, refs: list[str]) -> None:
        seen = self.detail_seen()
        merged = [r for r in seen if r not in refs] + refs
        self.cursor_out["detail_seen"] = [r[:200] for r in merged[-DETAIL_SEEN_MAX:]]
