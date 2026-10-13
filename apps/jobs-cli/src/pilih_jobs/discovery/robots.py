"""`RobotsGate`: robots.txt is always obeyed (15 §7.1), parsed with protego.

One parse per origin per run, matched against our honest User-Agent (`pilih-jobs/…`), so
both `User-agent: pilih-jobs` and `User-agent: *` groups apply. RFC 9309 semantics:

| robots.txt response                         | Decision                                   |
|---------------------------------------------|--------------------------------------------|
| 2xx                                         | the rules (plus `Crawl-delay`, `Sitemap`)  |
| 404 / 410 / other 4xx                       | allow all                                  |
| 401 / 403 / challenge                       | access denied → the source stops (15 §8)   |
| 5xx / network after retries / 429           | unreachable → complete disallow            |

A disallowed URL is skipped as `robots_disallowed`; adapters never fall back to another
path for the same content.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Final
from urllib.parse import urlsplit

from protego import Protego  # pyright: ignore[reportMissingTypeStubs]

from pilih_jobs.discovery.errors import DiscoveryError

ROBOTS_MAX_BYTES: Final = 512 * 1024
_ALLOW_ALL_CLASSES: Final = frozenset({"not_found", "source_closed", "unsupported_content"})
_PROPAGATE_CLASSES: Final = frozenset({"access_denied", "challenge_detected", "policy_blocked"})

RobotsFetcher = Callable[[str], Awaitable[tuple[int, str]]]


@dataclass(frozen=True)
class RobotsDecision:
    allowed: bool
    crawl_delay_s: float | None = None
    reason: str = "allowed"


@dataclass
class _OriginRules:
    status: str  # "rules" | "allow_all" | "unreachable"
    text: str = ""
    parser: Protego | None = None
    sitemaps: list[str] = field(default_factory=lambda: [])


def origin_of(url: str) -> str | None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return f"{parts.scheme}://{parts.netloc.lower()}"


def robots_url(url: str) -> str | None:
    origin = origin_of(url)
    return None if origin is None else f"{origin}/robots.txt"


class RobotsGate:
    def __init__(self, fetch_robots: RobotsFetcher, user_agent: str) -> None:
        self._fetch = fetch_robots
        self.user_agent = user_agent
        self._rules: dict[str, _OriginRules] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def _load(self, origin: str) -> _OriginRules:
        cached = self._rules.get(origin)
        if cached is not None:
            return cached
        lock = self._locks.setdefault(origin, asyncio.Lock())
        async with lock:
            cached = self._rules.get(origin)
            if cached is not None:
                return cached
            rules = await self._fetch_rules(origin)
            self._rules[origin] = rules
            return rules

    async def _fetch_rules(self, origin: str) -> _OriginRules:
        try:
            status, text = await self._fetch(f"{origin}/robots.txt")
        except DiscoveryError as exc:
            if exc.error_class in _PROPAGATE_CLASSES:
                raise
            if exc.error_class in _ALLOW_ALL_CLASSES:
                return _OriginRules("allow_all")
            return _OriginRules("unreachable")
        if not 200 <= status < 300:
            return _OriginRules("allow_all") if 400 <= status < 500 else _OriginRules("unreachable")
        body = text[:ROBOTS_MAX_BYTES]
        try:
            parser = Protego.parse(body)
        except Exception:  # noqa: BLE001 - an unparsable file is treated as no rules
            return _OriginRules("allow_all", text=body)
        sitemaps = [str(s) for s in parser.sitemaps]
        return _OriginRules("rules", text=body, parser=parser, sitemaps=sitemaps)

    async def check(self, url: str) -> RobotsDecision:
        """May `url` be fetched? Raises `DiscoveryError` when robots.txt itself is denied."""
        origin = origin_of(url)
        if origin is None:
            return RobotsDecision(False, reason="unsupported_scheme")
        if urlsplit(url).path == "/robots.txt":
            return RobotsDecision(True)
        rules = await self._load(origin)
        if rules.status == "allow_all":
            return RobotsDecision(True)
        if rules.status == "unreachable" or rules.parser is None:
            return RobotsDecision(False, reason="robots_unreachable")
        delay_raw = rules.parser.crawl_delay(self.user_agent)
        delay = float(delay_raw) if delay_raw is not None else None
        rate = rules.parser.request_rate(self.user_agent)
        if rate is not None and rate.requests > 0:
            per_request = float(rate.seconds) / float(rate.requests)
            delay = per_request if delay is None else max(delay, per_request)
        if not rules.parser.can_fetch(url, self.user_agent):
            return RobotsDecision(False, delay, reason="disallowed")
        return RobotsDecision(True, delay)

    async def sitemaps(self, url: str) -> list[str]:
        origin = origin_of(url)
        if origin is None:
            return []
        return list((await self._load(origin)).sitemaps)

    def cached(self, url: str) -> tuple[int, str] | None:
        """The robots.txt already fetched for `url`'s origin as (status, text), if any."""
        origin = origin_of(url)
        rules = self._rules.get(origin) if origin else None
        if rules is None:
            return None
        if rules.status == "rules":
            return 200, rules.text
        if rules.status == "allow_all":
            return 404, ""
        return 503, ""
