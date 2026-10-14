"""Test helpers: a virtual clock, a local site on pytest-httpserver, request builders."""

from __future__ import annotations

import asyncio
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pilih_jobs.contracts._generated.cloud import ScrapeRequest
from pytest_httpserver import HTTPServer
from werkzeug import Request, Response

from pilih_scraper.fetching import EngineFactory
from pilih_scraper.netguard import NetGuard
from pilih_scraper.scrape import scrape

FIXTURES = Path(__file__).parent / "fixtures"
SOURCE_ID = "csr_01JA6V8M3W8Z1T6Q4Y2B7K9C00"
RUN_ID = "crn_01JA6V8M3W8Z1T6Q4Y2B7K9C00"


class VirtualClock:
    """Monotonic seconds that advance only when the engine sleeps (no real waiting)."""

    def __init__(self) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []
        self.wall_ms = 1_791_770_000_000

    def monotonic(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        if seconds > 0:
            self.sleeps.append(seconds)
            self.now += seconds
        await asyncio.sleep(0)

    def now_ms(self) -> int:
        return self.wall_ms + int((self.now - 1000.0) * 1000)


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text("utf-8")


@dataclass
class Site:
    server: HTTPServer

    def __post_init__(self) -> None:
        self.server.no_handler_status_code = 404
        self.robots("User-agent: *\nAllow: /\n")

    def url(self, path: str) -> str:
        return self.server.url_for(path)

    @property
    def allowed_hosts(self) -> frozenset[str]:
        port = self.server.port
        return frozenset({f"localhost:{port}", f"127.0.0.1:{port}"})

    def robots(self, text: str) -> None:
        self.server.expect_request("/robots.txt").respond_with_data(text, content_type="text/plain")

    def reset(self) -> None:
        self.server.clear_all_handlers()
        self.robots("User-agent: *\nAllow: /\n")

    def html(self, path: str, body: str, status: int = 200, **headers: str) -> None:
        self.server.expect_request(path).respond_with_data(
            body, status=status, content_type="text/html; charset=utf-8", headers=headers
        )

    def xml(self, path: str, body: str) -> None:
        self.server.expect_request(path).respond_with_data(
            body, content_type="application/rss+xml; charset=utf-8"
        )

    def json(self, path: str, data: Any, status: int = 200, **headers: str) -> None:
        self.server.expect_request(path).respond_with_data(
            json.dumps(data), status=status, content_type="application/json", headers=headers
        )

    def raw(self, path: str, body: str, status: int, **headers: str) -> None:
        self.server.expect_request(path).respond_with_handler(
            lambda _r: Response(body, status=status, headers=headers)
        )

    def handler(self, path: str, fn: Any) -> None:
        def wrapped(request: Request) -> Response:
            return fn(request)

        self.server.expect_request(path).respond_with_handler(wrapped)

    def hits(self, path: str) -> int:
        return sum(1 for request, _ in self.server.log if request.path == path)


def make_factory(tmp: Path, site: Site, clock: VirtualClock | None = None) -> EngineFactory:
    return EngineFactory(
        data_dir=tmp / "data",
        guard=NetGuard(allowed_hosts=site.allowed_hosts),
        clock=clock or VirtualClock(),
        rng=random.Random(7),
    )


def scrape_body(
    strategy: str,
    config: dict[str, Any],
    *,
    rate: dict[str, Any] | None = None,
    cursor: dict[str, Any] | None = None,
    allow_browser: bool = False,
    ai_fallback: bool = False,
    domain: str = "localhost",
    deadline_ms: int = 120_000,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "v": 1,
        "run_id": RUN_ID,
        "source": {
            "id": SOURCE_ID,
            "slug": domain,
            "name": "Fixture board",
            "homepage_url": "https://example.org",
            "listing_url": None,
            "canonical_domain": domain,
            "strategy": strategy,
            "strategy_config": config,
            "rate_limit": rate or {},
            "allow_browser": allow_browser,
        },
        "cursor_state": cursor or {},
        "deadline_ms": deadline_ms,
        "ai_fallback": ai_fallback,
    }
    ScrapeRequest.model_validate(body)
    return body


async def run(factory: EngineFactory, body: dict[str, Any]) -> dict[str, Any]:
    return await scrape(body, factory)


def titles(response: dict[str, Any]) -> list[str]:
    return [str(item["title"]) for item in response["items"]]


def warning_codes(response: dict[str, Any]) -> set[str]:
    return {str(w["code"]) for w in response["warnings"]}
