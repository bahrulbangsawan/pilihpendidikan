"""`ScraplingJobEngine` (15 §4): the only network access of discovery.

Every request goes through the same pipeline:

1. target checks — http(s) only; D-17 excluded hosts refused (`policy_blocked`);
   BROWSER mode only when the user enabled browser discovery for the source (§5);
2. `RobotsGate` (robots.txt is always obeyed; `Crawl-delay` raises the delay);
3. `PolitenessScheduler` slot (global 4, per domain ≤ 2 JSON / 1 HTML, ≥ 1 s / ≥ 2 s);
4. one Scrapling call with honest identity — `FetcherSession(impersonate=None,
   stealthy_headers=False, follow_redirects="safe", retries=0)` with the pilih-jobs UA,
   or `AsyncDynamicSession(google_search=False, useragent=<UA>, block_ads=False)`;
5. classification (15 §8) and the wrapper-owned `RetryPolicy`; `access_denied` and
   `challenge_detected` are never retried and never escalate to another mode (§5).

Scrapling objects stay inside this package; callers get `FetchResult`s whose `page` is an
`HtmlPage`.
"""

from __future__ import annotations

import asyncio
import json
import random
import shutil
import tempfile
from collections.abc import AsyncIterator, Iterable, Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Final, cast
from urllib.parse import urlsplit

from pilih_jobs.contracts.adapters import excluded_source_for_host
from pilih_jobs.contracts.psl import ascii_host, registrable_domain
from pilih_jobs.discovery.classify import classify_response, classify_transport_error
from pilih_jobs.discovery.clock import EngineClock, default_engine_clock
from pilih_jobs.discovery.engine import _scrapling, adaptive, policy
from pilih_jobs.discovery.engine.page import ScraplingPage
from pilih_jobs.discovery.errors import DiscoveryError
from pilih_jobs.discovery.politeness import PolitenessScheduler
from pilih_jobs.discovery.retry import RetryPolicy
from pilih_jobs.discovery.robots import RobotsGate
from pilih_jobs.discovery.schema_org import has_type
from pilih_jobs.discovery.types import (
    CrawlConfig,
    CrawlEvent,
    ExtractionOutcome,
    ExtractionSpec,
    FetchMode,
    FetchPurpose,
    FetchRequest,
    FetchResult,
    NextPage,
    SourceRef,
)
from pilih_jobs.logging import get_logger, log_event
from pilih_jobs.paths import ensure_private_dir

_log = get_logger("discovery.engine")

#: Bodies larger than this are parsed off the event loop (15 §4 "Async model").
PARSE_IN_THREAD_BYTES: Final = 2 * 1024 * 1024
#: 15 §8: five consecutive 5xx stop the source (`source_unavailable`).
MAX_CONSECUTIVE_5XX: Final = 5
CLASSIFY_SAMPLE_BYTES: Final = 256 * 1024
DEFAULT_TIMEOUT_S: Final = 30.0
CONFIDENCE_JSON_LD: Final = 0.9


@dataclass(frozen=True)
class RequestRecord:
    """One Scrapling call (diagnostics; tests assert identity and attempt counts)."""

    method: str
    url: str
    mode: str
    attempt: int
    status: int | None
    error_class: str | None
    headers: Mapping[str, str]


@dataclass
class _Raw:
    url: str
    status: int
    headers: dict[str, str]
    body: bytes
    encoding: str
    native: Any
    elapsed_ms: int
    attempt: int


def _domain_of(url: str) -> str:
    host = ascii_host(urlsplit(url).hostname or "") or ""
    return registrable_domain(host) or host


def _decode(body: bytes, encoding: str, limit: int | None = None) -> str:
    data = body if limit is None else body[:limit]
    try:
        return data.decode(encoding or "utf-8", errors="replace")
    except LookupError:
        return data.decode("utf-8", errors="replace")


class ScraplingJobEngine:
    def __init__(
        self,
        *,
        data_dir: Path,
        cache_dir: Path,
        clock: EngineClock | None = None,
        rng: random.Random | None = None,
        allow_browser: bool = False,
        retry: RetryPolicy | None = None,
        headless: bool = True,
    ) -> None:
        policy.install_guard()
        self.api = _scrapling.load()
        self.user_agent = policy.honest_user_agent()
        self.clock: EngineClock = clock or default_engine_clock()
        self.rng = rng or random.Random()  # noqa: S311 - jitter, not security
        self.retry = retry or RetryPolicy()
        self.scheduler = PolitenessScheduler(self.clock, self.rng)
        self.robots = RobotsGate(self._fetch_robots, self.user_agent)
        self.adaptive = adaptive.AdaptiveStore(
            data_dir / "scrapling" / "adaptive.db", self.api.sqlite_storage
        )
        self.crawl_root = data_dir / "crawls"
        self._browser_root = cache_dir / "discovery-browser"
        self._allow_browser = allow_browser
        self._headless = headless
        self._http: dict[str, tuple[Any, Any]] = {}
        self._http_lock = asyncio.Lock()
        self._browser: tuple[Any, Any, Path] | None = None
        self._browser_lock = asyncio.Lock()
        self._consecutive_5xx: dict[str, int] = {}
        self._truncated: set[str] = set()
        self.requests: list[RequestRecord] = []

    # ------------------------------------------------------------------ capabilities
    def browser_enabled(self, source: SourceRef) -> bool:
        """BROWSER mode is opt-in per source *and* globally (`discovery.allow_browser`)."""
        return self._allow_browser and source.allow_browser

    def listing_truncated(self, source: SourceRef) -> bool:
        return source.key in self._truncated

    # ------------------------------------------------------------------ fetch
    def _check_target(self, url: str) -> None:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise DiscoveryError(
                "policy_blocked", f"only http(s) URLs are fetched: {url[:200]}", url=url
            )
        excluded = excluded_source_for_host(url)
        if excluded is not None:
            raise DiscoveryError(
                "policy_blocked",
                f"{excluded.display_name} is excluded from discovery (D-17)",
                url=url,
            )

    async def fetch(self, req: FetchRequest, *, source: SourceRef) -> FetchResult:
        return await self._fetch(req, source=source, first_page=False)

    async def fetch_listing(
        self, req: FetchRequest, *, source: SourceRef, first_page: bool = True
    ) -> FetchResult:
        return await self._fetch(req, source=source, first_page=first_page)

    async def fetch_detail(self, req: FetchRequest, *, source: SourceRef) -> FetchResult:
        detail = req if req.purpose == "detail" else _replace_purpose(req, "detail")
        return await self._fetch(detail, source=source, first_page=False)

    async def _fetch(
        self, req: FetchRequest, *, source: SourceRef, first_page: bool
    ) -> FetchResult:
        self._check_target(req.url)
        if req.mode is FetchMode.BROWSER and not self.browser_enabled(source):
            raise DiscoveryError(
                "unsupported_content",
                "browser discovery is not enabled for this source (15 §5)",
                url=req.url,
            )
        crawl_delay: float | None = None
        if req.purpose != "robots":
            decision = await self.robots.check(req.url)
            if not decision.allowed:
                raise DiscoveryError(
                    "robots_disallowed",
                    f"robots.txt disallows {req.url} ({decision.reason})",
                    url=req.url,
                )
            crawl_delay = decision.crawl_delay_s
        raw = await self._request(
            req, source=source, first_page=first_page, crawl_delay=crawl_delay
        )
        return await self._result(req, raw)

    async def _fetch_robots(self, url: str) -> tuple[int, str]:
        host = urlsplit(url).hostname or url
        source = SourceRef(key=f"robots:{host}", adapter_id="robots", org=host)
        req = FetchRequest(url, FetchMode.JSON_API, purpose="robots", timeout_s=20.0)
        raw = await self._request(req, source=source, first_page=False, crawl_delay=None)
        return raw.status, _decode(raw.body, raw.encoding, limit=512 * 1024)

    async def _request(
        self,
        req: FetchRequest,
        *,
        source: SourceRef,
        first_page: bool,
        crawl_delay: float | None,
    ) -> _Raw:
        domain = _domain_of(req.url)
        html = req.mode is not FetchMode.JSON_API
        min_delay = max(source.min_delay_ms / 1000.0, crawl_delay or 0.0)
        attempt = 1
        while True:
            error: DiscoveryError | None
            raw: _Raw | None = None
            try:
                async with self.scheduler.slot(
                    domain,
                    html=html,
                    concurrency=source.per_domain_concurrency,
                    min_delay_s=min_delay,
                ):
                    raw = await self._send(req, attempt)
                error = classify_response(
                    raw.status,
                    raw.headers,
                    _decode(raw.body, raw.encoding, limit=CLASSIFY_SAMPLE_BYTES),
                    url=raw.url or req.url,
                    purpose=req.purpose,
                    first_listing_page=first_page and req.purpose == "listing",
                    now_s=self.clock.now_ms() / 1000.0,
                )
            except DiscoveryError as exc:
                error = exc
            self._record(req, attempt, raw, error)
            if error is None:
                if raw is None:  # pragma: no cover - a response always comes with no error
                    raise DiscoveryError("network", "no response", url=req.url)
                self._consecutive_5xx.pop(source.key, None)
                return raw
            self._count_failure(source, error)
            if error.error_class in source.stop_on or not error.retryable:
                raise error
            decision = self.retry.decide(error, attempt, self.rng)
            if decision.stop_source:
                raise DiscoveryError(
                    "rate_limited",
                    "Retry-After exceeds 15 minutes; the source stops for this run",
                    http_status=error.http_status,
                    url=error.url,
                    retry_after_s=error.retry_after_s,
                    retryable=False,
                )
            if not decision.retry:
                raise error
            log_event(
                _log,
                "discovery_retry",
                f"retrying {req.url}",
                level=20,
                error_class=error.error_class,
                attempt=attempt,
                wait_s=round(decision.wait_s, 2),
            )
            await self.clock.sleep(decision.wait_s)
            attempt += 1

    def _count_failure(self, source: SourceRef, error: DiscoveryError) -> None:
        if error.error_class != "http_5xx":
            return
        count = self._consecutive_5xx.get(source.key, 0) + 1
        self._consecutive_5xx[source.key] = count
        if count >= MAX_CONSECUTIVE_5XX:
            raise DiscoveryError(
                "source_unavailable",
                f"{count} consecutive server errors; the source stops for this run",
                http_status=error.http_status,
                url=error.url,
                retryable=False,
            )

    def _record(
        self, req: FetchRequest, attempt: int, raw: _Raw | None, error: DiscoveryError | None
    ) -> None:
        native = raw.native if raw is not None else None
        sent: Mapping[str, str] = {}
        if native is not None:
            sent = cast(Mapping[str, str], getattr(native, "request_headers", None) or {})
        self.requests.append(
            RequestRecord(
                method=req.method,
                url=req.url,
                mode=req.mode.value,
                attempt=attempt,
                status=raw.status if raw is not None else error.http_status if error else None,
                error_class=error.error_class if error is not None else None,
                headers=dict(sent),
            )
        )

    async def _send(self, req: FetchRequest, attempt: int) -> _Raw:
        started = self.clock.monotonic()
        try:
            if req.mode is FetchMode.BROWSER:
                native = await self._send_browser(req)
            else:
                native = await self._send_http(req)
        except DiscoveryError:
            raise
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            code = getattr(exc, "code", None)
            raise classify_transport_error(
                code if isinstance(code, int) else None, str(exc), url=req.url
            ) from exc
        elapsed = int((self.clock.monotonic() - started) * 1000)
        headers = {str(k).lower(): str(v) for k, v in dict(native.headers or {}).items()}
        body = cast(bytes, native.body or b"")
        return _Raw(
            url=str(native.url or req.url),
            status=int(native.status),
            headers=headers,
            body=body,
            encoding=str(getattr(native, "encoding", None) or "utf-8"),
            native=native,
            elapsed_ms=elapsed,
            attempt=attempt,
        )

    async def _http_client(self, domain: str) -> Any:
        async with self._http_lock:
            existing = self._http.get(domain)
            if existing is not None:
                return existing[1]
            kwargs = policy.check_kwargs(
                "http_session",
                {
                    "impersonate": None,
                    "stealthy_headers": False,
                    "follow_redirects": "safe",
                    "retries": 0,
                    "verify": True,
                    "timeout": DEFAULT_TIMEOUT_S,
                    "headers": {"User-Agent": self.user_agent},
                },
            )
            manager = self.api.fetcher_session(**kwargs)
            client = await manager.__aenter__()
            self._http[domain] = (manager, client)
            return client

    async def _send_http(self, req: FetchRequest) -> Any:
        client = await self._http_client(_domain_of(req.url))
        headers: dict[str, str] = {"User-Agent": self.user_agent, **dict(req.headers)}
        if req.etag:
            headers["If-None-Match"] = req.etag
        if req.last_modified:
            headers["If-Modified-Since"] = req.last_modified
        call: dict[str, Any] = {
            "headers": headers,
            "timeout": req.timeout_s,
            "impersonate": None,
            "stealthy_headers": False,
        }
        if req.method == "POST":
            call["json"] = dict(req.json_body or {})
        kwargs = policy.check_kwargs("http_request", call)
        if req.method == "POST":
            return await client.post(req.url, **kwargs)
        return await client.get(req.url, **kwargs)

    async def _browser_session(self) -> Any:
        async with self._browser_lock:
            if self._browser is not None:
                return self._browser[1]
            ensure_private_dir(self._browser_root)
            profile = Path(tempfile.mkdtemp(prefix="run-", dir=self._browser_root))
            kwargs = policy.check_kwargs(
                "browser_session",
                {
                    "google_search": False,
                    "block_ads": False,
                    "retries": 1,
                    "headless": self._headless,
                    "disable_resources": True,
                    "useragent": self.user_agent,
                    "user_data_dir": str(profile),
                    "max_pages": 1,
                    "timeout": DEFAULT_TIMEOUT_S * 1000,
                },
            )
            manager = self.api.dynamic_session(**kwargs)
            session = await manager.__aenter__()
            self._browser = (manager, session, profile)
            return session

    async def _send_browser(self, req: FetchRequest) -> Any:
        session = await self._browser_session()
        call: dict[str, Any] = {
            "google_search": False,
            "timeout": req.timeout_s * 1000,
            "network_idle": True,
            "disable_resources": True,
        }
        if req.wait_selector:
            call["wait_selector"] = req.wait_selector
        kwargs = policy.check_kwargs("browser_fetch", call)
        return await session.fetch(req.url, **kwargs)

    async def _result(self, req: FetchRequest, raw: _Raw) -> FetchResult:
        excluded = excluded_source_for_host(raw.url)
        if excluded is not None:
            raise DiscoveryError(
                "policy_blocked",
                f"redirected to {excluded.display_name}, which is excluded (D-17)",
                url=raw.url,
            )
        common: dict[str, Any] = {
            "url": raw.url,
            "status": raw.status,
            "headers": raw.headers,
            "elapsed_ms": raw.elapsed_ms,
            "fetch_mode": req.mode,
            "attempt": raw.attempt,
            "body_size": len(raw.body),
        }
        if raw.status == 304:
            return FetchResult(not_modified=True, json=None, page=None, **common)
        if req.mode is FetchMode.JSON_API and req.purpose != "robots":
            data = await self._parse_json(raw)
            return FetchResult(not_modified=False, json=data, page=None, **common)
        if req.purpose == "robots":
            return FetchResult(not_modified=False, json=None, page=None, **common)
        page = await self._parse_page(raw)
        return FetchResult(not_modified=False, json=None, page=page, **common)

    async def _parse_json(self, raw: _Raw) -> Any:
        text = _decode(raw.body, raw.encoding)
        try:
            if len(raw.body) > PARSE_IN_THREAD_BYTES:
                return await asyncio.to_thread(json.loads, text)
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise DiscoveryError(
                "schema_invalid",
                f"expected JSON from {raw.url}",
                http_status=raw.status,
                url=raw.url,
            ) from exc

    def _build_page(self, raw: _Raw) -> ScraplingPage:
        selector = self.api.selector(
            content=raw.body or b"<html/>",
            url=raw.url,
            encoding=raw.encoding,
            **self.adaptive.selector_kwargs(raw.url),
        )
        return ScraplingPage(selector, raw.url, native=raw.native)

    async def _parse_page(self, raw: _Raw) -> ScraplingPage:
        if len(raw.body) > PARSE_IN_THREAD_BYTES:
            return await asyncio.to_thread(self._build_page, raw)
        return self._build_page(raw)

    def page_from_native(self, native: Any) -> ScraplingPage:
        """An adaptive page over a Scrapling response the spider received."""
        raw = _Raw(
            url=str(native.url),
            status=int(native.status),
            headers={},
            body=cast(bytes, native.body or b""),
            encoding=str(getattr(native, "encoding", None) or "utf-8"),
            native=native,
            elapsed_ms=0,
            attempt=1,
        )
        return self._build_page(raw)

    # ------------------------------------------------------------------ pagination
    async def iter_listing_pages(
        self,
        first: FetchRequest,
        *,
        source: SourceRef,
        next_page: NextPage,
        max_pages: int = 50,
    ) -> AsyncIterator[FetchResult]:
        """Follow `next_page` up to `max_pages` (≤ 50); records a truncated listing."""
        self._truncated.discard(source.key)
        request: FetchRequest | None = first
        cap = max(1, min(max_pages, 50))
        number = 0
        while request is not None:
            number += 1
            result = await self.fetch_listing(request, source=source, first_page=number == 1)
            yield result
            following = next_page(result)
            if following is not None and number >= cap:
                self._truncated.add(source.key)
                return
            request = following

    def mark_truncated(self, source: SourceRef) -> None:
        self._truncated.add(source.key)

    # ------------------------------------------------------------------ extraction
    def _page(self, result: FetchResult) -> ScraplingPage:
        page = result.page
        if not isinstance(page, ScraplingPage):
            raise DiscoveryError("unsupported_content", "no HTML page to extract from")
        return page

    def extract(
        self, result: FetchResult, spec: ExtractionSpec, *, source: SourceRef
    ) -> ExtractionOutcome:
        """One posting from a detail page: JSON-LD JobPosting first, then the selectors."""
        page = self._page(result)
        if spec.prefer_json_ld:
            postings = [o for o in page.json_ld() if has_type(o, "JobPosting")]
            if postings:
                return ExtractionOutcome(
                    values={"json_ld": postings[0]},
                    method="json_ld",
                    confidence=CONFIDENCE_JSON_LD,
                )
        return adaptive.extract_scope(
            page, page.selector, spec, org=source.org, adaptive_enabled=True
        )

    def extract_items(
        self, result: FetchResult, spec: ExtractionSpec, *, source: SourceRef
    ) -> list[ExtractionOutcome]:
        """Postings of a listing page: JSON-LD JobPostings first, then item containers."""
        page = self._page(result)
        if spec.prefer_json_ld:
            postings = [o for o in page.json_ld() if has_type(o, "JobPosting")]
            if postings:
                return [
                    ExtractionOutcome(
                        values={"json_ld": posting}, method="json_ld", confidence=CONFIDENCE_JSON_LD
                    )
                    for posting in postings
                ]
        scopes, container, relocated = adaptive.item_scopes(
            page, spec, org=source.org, adaptive_enabled=True
        )
        outcomes: list[ExtractionOutcome] = []
        container_ident = adaptive.identifier(
            spec.identifier_prefix, source.org, adaptive.ITEM_FIELD
        )
        for scope in scopes:
            outcome = adaptive.extract_scope(
                page, scope, spec, org=source.org, adaptive_enabled=True
            )
            if relocated:
                outcome.relocated_fields.insert(0, adaptive.ITEM_FIELD)
                outcome.method = "adaptive"
                outcome.confidence = min(outcome.confidence, adaptive.CONFIDENCE_ADAPTIVE)
            elif container is not None:
                outcome.pending_saves.append((container, container_ident))
            outcomes.append(outcome)
        return outcomes

    def confirm_adaptive(self, outcomes: Iterable[ExtractionOutcome]) -> None:
        adaptive.confirm(outcomes)

    def reset_adaptive(self, prefix: str) -> int:
        return self.adaptive.reset(prefix)

    # ------------------------------------------------------------------ crawling
    def crawl(self, config: CrawlConfig, *, source: SourceRef) -> AsyncIterator[CrawlEvent]:
        from pilih_jobs.discovery.engine.crawler import run_crawl

        return run_crawl(self, config, source=source)

    # ------------------------------------------------------------------ lifecycle
    async def aclose(self) -> None:
        sessions = list(self._http.values())
        self._http.clear()
        for manager, _client in sessions:
            try:
                await manager.__aexit__(None, None, None)
            except Exception as exc:  # noqa: BLE001 - closing is best effort
                _log.debug("closing an HTTP session failed: %s", type(exc).__name__)
        browser, self._browser = self._browser, None
        if browser is not None:
            manager, _session, profile = browser
            try:
                await manager.__aexit__(None, None, None)
            except Exception as exc:  # noqa: BLE001 - closing is best effort
                _log.debug("closing the browser failed: %s", type(exc).__name__)
            shutil.rmtree(profile, ignore_errors=True)


def _replace_purpose(req: FetchRequest, purpose: FetchPurpose) -> FetchRequest:
    return replace(req, purpose=purpose)
