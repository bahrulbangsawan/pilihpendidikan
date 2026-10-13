"""Spider-backed crawling for `generic_listing` (15 §4 `crawl`, §14.3).

A Scrapling `SitemapSpider` (which is a `Spider` with sitemap seeding) walks one site:

- `allowed_domains = {host}`; listing links (the `listing_url_pattern`, or `rel=next`)
  and detail links (`detail_url_pattern`) are followed, ≤ `max_pages` listing pages and
  ≤ 2,000 detail pages; the site's sitemaps (robots.txt `Sitemap:`) seed detail URLs;
- spider settings follow 15 §7.1 (`robots_txt_obey = True`, per-domain concurrency 1,
  `download_delay` ≥ 2 s, AutoThrottle with a 60 s cap); every request still goes through
  the engine pipeline via a bridge session — honest identity, our RobotsGate with the
  pilih-jobs UA, politeness, the wrapper's retries and error taxonomy — so a 403 or a
  challenge stops the crawl instead of being retried by the spider;
- checkpoints (`crawldir`, pickle) live only under `<data>/crawls/<src_id>/` and are
  loaded only when that trusted directory holds a marker written by the same CLI major
  version for the same start URL; anything else is deleted unread.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import TYPE_CHECKING, Any, Final, cast
from urllib.parse import urlsplit

from pilih_jobs.discovery.engine import _scrapling
from pilih_jobs.discovery.errors import SOURCE_FATAL, DiscoveryError, PolicyViolation
from pilih_jobs.discovery.jsonutil import obj
from pilih_jobs.discovery.types import (
    CrawlConfig,
    CrawlEvent,
    FetchMode,
    FetchRequest,
    FetchResult,
    SourceRef,
)
from pilih_jobs.paths import ensure_private_dir
from pilih_jobs.version import __version__, parse_semver

if TYPE_CHECKING:
    from pilih_jobs.discovery.engine.engine import ScraplingJobEngine

CHECKPOINT_FILE: Final = "checkpoint.pkl"
MARKER_FILE: Final = "pilih-checkpoint.json"
CHECKPOINT_INTERVAL_S: Final = 300.0
SPIDER_NAME: Final = "pilih-jobs-listing"
_SITEMAP_PATH = re.compile(r"(?:sitemap[^/]*\.xml(?:\.gz)?|\.xml(?:\.gz)?)$", re.IGNORECASE)


def cli_major() -> str:
    """The compatibility line of checkpoints: `MAJOR` (or `0.MINOR` before 1.0)."""
    parsed = parse_semver(__version__)
    if parsed is None:
        return __version__
    major, minor, _patch, _pre = parsed
    return f"0.{minor}" if major == 0 else str(major)


# ---------------------------------------------------------------- checkpoint directory
def _owned_by_user(path: Path) -> bool:
    if os.name != "posix":
        return True
    try:
        stat = path.lstat()
    except OSError:
        return False
    return stat.st_uid == os.getuid() and not stat.st_mode & 0o022


def _remove_checkpoint(directory: Path) -> None:
    for name in (CHECKPOINT_FILE, f"{Path(CHECKPOINT_FILE).stem}.tmp", MARKER_FILE):
        with contextlib.suppress(OSError):
            (directory / name).unlink()


def prepare_crawl_dir(root: Path, crawl_dir: Path, *, start_url: str) -> tuple[Path, bool]:
    """Validate `<data>/crawls/<src_id>/`; returns (dir, resuming from a trusted checkpoint)."""
    root_resolved = ensure_private_dir(root).resolve()
    if crawl_dir.is_symlink():
        raise DiscoveryError("policy_blocked", "the crawl directory is a symlink; refusing it")
    resolved = crawl_dir.resolve()
    if resolved.parent != root_resolved:
        raise DiscoveryError(
            "policy_blocked", "spider checkpoints live only under <data>/crawls/<source id>/"
        )
    ensure_private_dir(resolved)
    checkpoint = resolved / CHECKPOINT_FILE
    marker = resolved / MARKER_FILE
    trusted = False
    if checkpoint.exists():
        try:
            meta = obj(json.loads(marker.read_text("utf-8"))) if marker.is_file() else {}
        except (OSError, json.JSONDecodeError):
            meta = {}
        trusted = (
            not checkpoint.is_symlink()
            and checkpoint.is_file()
            and _owned_by_user(checkpoint)
            and _owned_by_user(resolved)
            and meta.get("cli_major") == cli_major()
            and meta.get("start_url") == start_url
        )
        if not trusted:
            _remove_checkpoint(resolved)
    marker.write_text(
        json.dumps(
            {"cli_major": cli_major(), "cli_version": __version__, "start_url": start_url},
            separators=(",", ":"),
        ),
        "utf-8",
    )
    return resolved, trusted


# ---------------------------------------------------------------- crawl state
@dataclass
class _CrawlState:
    listing_pages: int = 0
    listing_scheduled: int = 1
    details_scheduled: int = 0
    details: int = 0
    truncated: bool = False
    fatal: DiscoveryError | None = None
    errors: list[DiscoveryError] = field(default_factory=lambda: [])
    cancelled: bool = False


def _safe_spider_kwargs(url: str, kwargs: Mapping[str, Any]) -> dict[str, str]:
    """Only same-site referers survive; stealth / browser options are refused (15 §13)."""
    allowed = {"headers", "extra_headers", "google_search", "method"}
    for key, value in kwargs.items():
        if key not in allowed:
            raise PolicyViolation(f"spider request option {key!r} is not on the allow-list")
        if key == "google_search" and value is not False:
            raise PolicyViolation("google_search must be False (no fake referer, D-16)")
        if key == "method" and value != "GET":
            raise PolicyViolation("the crawler only issues GET requests")
    headers: dict[str, str] = {}
    raw_headers = kwargs.get("headers")
    if isinstance(raw_headers, Mapping):
        for key, value in cast(Mapping[str, Any], raw_headers).items():
            if key.lower() == "referer":
                referer = str(value)
                if urlsplit(referer).hostname == urlsplit(url).hostname:
                    headers["Referer"] = referer
    return headers


class _BridgeSession:
    """A spider session that sends every request through the engine pipeline."""

    def __init__(
        self,
        engine: ScraplingJobEngine,
        source: SourceRef,
        detail_pattern: re.Pattern[str],
        mode: FetchMode,
    ) -> None:
        self._engine = engine
        self._source = source
        self._detail = detail_pattern
        self._mode = mode
        self._is_alive = False

    async def __aenter__(self) -> _BridgeSession:
        self._is_alive = True
        return self

    async def __aexit__(self, *_exc: object) -> None:
        self._is_alive = False

    async def fetch(self, url: str, **kwargs: Any) -> Any:
        headers = _safe_spider_kwargs(url, kwargs)
        path = urlsplit(url).path
        if path == "/robots.txt":
            await self._engine.robots.check(url)  # loads (or refuses) robots.txt once
            status, text = self._engine.robots.cached(url) or (404, "")
            return self._engine.api.response(
                url=url,
                content=text.encode("utf-8"),
                status=status,
                reason="",
                cookies={},
                headers={},
                request_headers={},
            )
        if _SITEMAP_PATH.search(path):
            purpose = "sitemap"
        elif self._detail.search(url):
            purpose = "detail"
        else:
            purpose = "listing"
        mode = FetchMode.STATIC_HTML if purpose == "sitemap" else self._mode
        request = FetchRequest(url, mode, headers=headers, purpose=purpose)
        result = await self._engine.fetch(request, source=self._source)
        page = result.page
        native = getattr(page, "native", None)
        if native is None:
            raise DiscoveryError("unsupported_content", f"no page for {url}", url=url)
        return native


@cache
def _spider_class(spider_base: Any) -> Any:
    """The spider class, built on Scrapling's `SitemapSpider` (loaded at runtime)."""

    class JobListingSpider(spider_base):
        name = SPIDER_NAME
        robots_txt_obey = True
        concurrent_requests = 4
        concurrent_requests_per_domain = 1
        download_delay = 2.0
        autothrottle_enabled = True
        autothrottle_max_delay = 60.0
        max_blocked_retries = 0  # the engine pipeline owns retries (15 §7.2)
        development_mode = False
        logging_level = logging.WARNING

        def __init__(
            self,
            *,
            engine: ScraplingJobEngine,
            config: CrawlConfig,
            source: SourceRef,
            state: _CrawlState,
            sitemaps: list[str],
            crawldir: Path | None,
        ) -> None:
            host = (urlsplit(config.start_url).hostname or "").lower()
            self._pj_engine = engine
            self._pj_config = config
            self._pj_source = source
            self._pj_state = state
            self._pj_host = host
            self._pj_detail = re.compile(config.detail_url_pattern)
            self._pj_listing = (
                re.compile(config.listing_url_pattern) if config.listing_url_pattern else None
            )
            self.start_urls = [config.start_url]
            # Scrapling compares the request netloc (host[:port]) with allowed_domains.
            self.allowed_domains = {host, urlsplit(config.start_url).netloc.lower()}
            self.sitemap_urls = list(sitemaps)
            self.download_delay = max(2.0, source.min_delay_ms / 1000.0)
            super().__init__(  # pyright: ignore[reportUnknownMemberType]
                crawldir=crawldir, interval=CHECKPOINT_INTERVAL_S
            )
            _scrapling.quiet_logger(self.logger)

        def configure_sessions(self, manager: Any) -> None:
            manager.add(
                "pilih",
                _BridgeSession(
                    self._pj_engine, self._pj_source, self._pj_detail, self._pj_config.mode
                ),
                default=True,
            )

        def rules(self) -> list[Any]:
            api = self._pj_engine.api
            extractor = api.link_extractor(
                allow=self._pj_detail.pattern, allow_domains=self._pj_host
            )
            return [api.crawl_rule(extractor, callback=self.parse_detail)]

        async def start_requests(self) -> AsyncIterator[Any]:
            api = self._pj_engine.api
            for url in self.sitemap_urls:
                yield api.request(url, sid="pilih", callback=self._parse_sitemap)
            yield api.request(self._pj_config.start_url, sid="pilih", callback=self.parse)

        async def _parse_sitemap(self, response: Any) -> AsyncIterator[Any]:
            state = self._pj_state
            parent: Any = super()
            async for result in parent._parse_sitemap(response):
                if getattr(result, "callback", None) == self.parse_detail:
                    if state.details_scheduled >= self._pj_config.max_details:
                        state.truncated = True
                        continue
                    state.details_scheduled += 1
                yield result

        def _follow_candidates(self, response: Any) -> tuple[list[str], set[str]]:
            """Same-site links of a listing page, and its `rel=next` targets."""
            api = self._pj_engine.api
            extractor = api.link_extractor(allow_domains=self._pj_host)
            links = [str(u) for u in extractor.extract(response)]
            nexts: set[str] = set()
            for css in ('link[rel="next"]::attr(href)', 'a[rel~="next"]::attr(href)'):
                nexts.update(str(response.urljoin(str(v))) for v in response.css(css).getall())
            return list(dict.fromkeys([*links, *sorted(nexts)])), nexts

        async def parse(self, response: Any) -> AsyncIterator[Any]:
            state = self._pj_state
            state.listing_pages += 1
            yield {"kind": "listing", "url": str(response.url), "native": response}
            candidates, nexts = self._follow_candidates(response)
            for url in candidates:
                if self._pj_detail.search(url):
                    if state.details_scheduled >= self._pj_config.max_details:
                        state.truncated = True
                        continue
                    state.details_scheduled += 1
                    yield response.follow(url, callback=self.parse_detail)
                    continue
                listing = (
                    self._pj_listing.search(url) is not None
                    if self._pj_listing is not None
                    else url in nexts
                )
                if not listing or urlsplit(url).hostname != self._pj_host:
                    continue
                if state.listing_scheduled >= self._pj_config.max_pages:
                    state.truncated = True
                    continue
                state.listing_scheduled += 1
                yield response.follow(url, callback=self.parse)

        async def parse_detail(self, response: Any) -> AsyncIterator[Any]:
            self._pj_state.details += 1
            yield {"kind": "detail", "url": str(response.url), "native": response}

        async def is_blocked(self, response: Any) -> bool:
            return False  # the bridge already classified and retried (15 §8)

        async def on_error(self, request: Any, error: Exception) -> None:
            state = self._pj_state
            if isinstance(error, DiscoveryError):
                fatal = (
                    error.error_class in SOURCE_FATAL
                    or error.error_class in self._pj_source.stop_on
                )
                if fatal and state.fatal is None:
                    state.fatal = error
                    with contextlib.suppress(RuntimeError):
                        self.pause()
                elif not fatal:
                    state.errors.append(error)
                return
            if isinstance(error, PolicyViolation):
                state.fatal = DiscoveryError("policy_blocked", error.message)
                with contextlib.suppress(RuntimeError):
                    self.pause()
                return
            state.errors.append(DiscoveryError("parse_error", f"{type(error).__name__}"))

    return JobListingSpider


async def run_crawl(
    engine: ScraplingJobEngine, config: CrawlConfig, *, source: SourceRef
) -> AsyncIterator[CrawlEvent]:
    state = _CrawlState()
    crawldir: Path | None = None
    resuming = False
    if config.crawl_dir is not None:
        crawldir, resuming = prepare_crawl_dir(
            engine.crawl_root, config.crawl_dir, start_url=config.start_url
        )
    sitemaps: list[str] = []
    try:
        engine._check_target(config.start_url)  # pyright: ignore[reportPrivateUsage]
        if config.use_sitemap:
            sitemaps = [
                s
                for s in await engine.robots.sitemaps(config.start_url)
                if urlsplit(s).hostname == urlsplit(config.start_url).hostname
            ]
    except DiscoveryError as exc:
        yield CrawlEvent("error", url=config.start_url, error=exc)
        yield CrawlEvent("finished", stats=_stats(state, resuming=resuming, paused=False))
        return
    spider_cls = _spider_class(engine.api.sitemap_spider)
    spider = spider_cls(
        engine=engine,
        config=config,
        source=source,
        state=state,
        sitemaps=sitemaps,
        crawldir=crawldir,
    )

    async def watch_cancel() -> None:
        if config.cancel is None:
            return
        await config.cancel.wait()
        state.cancelled = True
        with contextlib.suppress(RuntimeError):
            spider.pause()

    watcher = asyncio.create_task(watch_cancel())
    try:
        async for item in spider.stream():
            entry = cast(dict[str, Any], item)
            page = engine.page_from_native(entry["native"])
            result = _result_from(page, entry)
            kind = "detail" if entry.get("kind") == "detail" else "listing"
            yield CrawlEvent(kind, url=str(entry["url"]), result=result)
    finally:
        watcher.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await watcher
    for error in state.errors:
        yield CrawlEvent("error", url=error.url or "", error=error)
    if state.fatal is not None:
        if crawldir is not None:
            _remove_checkpoint(crawldir)
        yield CrawlEvent("error", url=state.fatal.url or "", error=state.fatal)
    paused = crawldir is not None and (crawldir / CHECKPOINT_FILE).exists()
    if crawldir is not None and not paused:
        _remove_checkpoint(crawldir)
    yield CrawlEvent("finished", stats=_stats(state, resuming=resuming, paused=paused))


def _result_from(page: Any, entry: Mapping[str, Any]) -> FetchResult:
    native = entry["native"]
    headers = {str(k).lower(): str(v) for k, v in dict(native.headers or {}).items()}
    return FetchResult(
        url=str(native.url),
        status=int(native.status),
        headers=headers,
        not_modified=False,
        json=None,
        page=page,
        elapsed_ms=0,
        fetch_mode=FetchMode.STATIC_HTML,
        attempt=1,
        body_size=len(native.body or b""),
    )


def _stats(state: _CrawlState, *, resuming: bool, paused: bool) -> dict[str, Any]:
    complete = (
        state.fatal is None and not state.truncated and not state.cancelled and not paused
    ) and not resuming
    return {
        "listing_pages": state.listing_pages,
        "details": state.details,
        "truncated": state.truncated,
        "resumed": resuming,
        "paused": paused,
        "cancelled": state.cancelled,
        "complete": complete,
        "fatal": state.fatal.error_class if state.fatal else None,
    }
