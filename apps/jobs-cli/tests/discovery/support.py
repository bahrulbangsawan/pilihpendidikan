"""Helpers for the discovery tests: a virtual clock, a local site, a run harness."""

from __future__ import annotations

import asyncio
import json
import random
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pytest_httpserver import HTTPServer
from werkzeug import Request, Response

from pilih_jobs.adapters import get_adapter
from pilih_jobs.discovery.cursor import CursorState
from pilih_jobs.discovery.engine import ScraplingJobEngine
from pilih_jobs.discovery.runner import RunnerSettings, SourceOutcome, SourceRunner
from pilih_jobs.discovery.seen import LocalSeenCache, RunDeduper
from pilih_jobs.discovery.sources import ResolvedSource
from pilih_jobs.storage.db import StateDB

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "discovery"
ISSUER = "https://api.test"
RUN_ID = "run_01JA6V8M3W8Z1T6Q4Y2B7K9C00"
DEVICE_ID = "dev_01JA6V8M3W8Z1T6Q4Y2B7K9C00"


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text("utf-8")


def fixture_json(name: str) -> Any:
    return json.loads(fixture_text(name))


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


@dataclass
class Site:
    """A local website / API on pytest-httpserver (robots.txt allows all by default)."""

    server: HTTPServer
    robots_text: str | None = "User-agent: *\nAllow: /\n"
    log: list[tuple[str, str, dict[str, str]]] = field(default_factory=lambda: [])

    def __post_init__(self) -> None:
        self.server.no_handler_status_code = 404
        if self.robots_text is not None:
            self.robots(self.robots_text)

    @property
    def base(self) -> str:
        return self.server.url_for("").rstrip("/")

    @property
    def host(self) -> str:
        return f"127.0.0.1:{self.server.port}"

    def url(self, path: str) -> str:
        return self.server.url_for(path)

    def robots(self, text: str, status: int = 200) -> None:
        self.server.expect_request("/robots.txt").respond_with_data(
            text, status=status, content_type="text/plain"
        )

    def _record(self, handler: Callable[[Request], Response]) -> Callable[[Request], Response]:
        def wrapped(request: Request) -> Response:
            self.log.append((request.method, request.full_path.rstrip("?"), dict(request.headers)))
            return handler(request)

        return wrapped

    def handle(
        self, path: str, handler: Callable[[Request], Response], method: str = "GET", **kw: Any
    ) -> None:
        self.server.expect_request(path, method=method, **kw).respond_with_handler(
            self._record(handler)
        )

    def json(
        self,
        path: str,
        data: Any,
        *,
        status: int = 200,
        headers: dict[str, str] | None = None,
        method: str = "GET",
        **kw: Any,
    ) -> None:
        body = json.dumps(data)
        self.handle(
            path,
            lambda _r: Response(
                body, status=status, headers=headers, content_type="application/json"
            ),
            method=method,
            **kw,
        )

    def html(
        self,
        path: str,
        body: str,
        *,
        status: int = 200,
        headers: dict[str, str] | None = None,
        **kw: Any,
    ) -> None:
        self.handle(
            path,
            lambda _r: Response(
                body, status=status, headers=headers, content_type="text/html; charset=utf-8"
            ),
            **kw,
        )

    def status(
        self,
        path: str,
        status: int,
        *,
        headers: dict[str, str] | None = None,
        body: str = "",
        content_type: str = "text/plain",
        method: str = "GET",
    ) -> None:
        self.handle(
            path,
            lambda _r: Response(body, status=status, headers=headers, content_type=content_type),
            method=method,
        )

    def sequence(self, path: str, responses: list[Response], method: str = "GET") -> None:
        queue = list(responses)

        def respond(_r: Request) -> Response:
            return queue.pop(0) if len(queue) > 1 else queue[0]

        self.handle(path, respond, method=method)

    def hits(self, path_prefix: str) -> list[tuple[str, str, dict[str, str]]]:
        return [entry for entry in self.log if entry[1].startswith(path_prefix)]

    def all_requests(self) -> list[str]:
        return [str(r.full_path).rstrip("?") for r, _ in self.server.log]


def make_engine(
    tmp: Path, clock: VirtualClock, *, allow_browser: bool = False
) -> ScraplingJobEngine:
    return ScraplingJobEngine(
        data_dir=tmp / "data",
        cache_dir=tmp / "cache",
        clock=clock,
        rng=random.Random(7),
        allow_browser=allow_browser,
    )


def resolved(
    adapter_id: str,
    config: dict[str, Any],
    *,
    source_id: str | None = None,
    label: str | None = None,
    cursor: dict[str, Any] | None = None,
    visibility: str = "public",
    allow_browser: bool = False,
) -> ResolvedSource:
    adapter = get_adapter(adapter_id)
    cfg = adapter.validate_config(config)
    org = adapter.source_org(cfg)
    return ResolvedSource(
        adapter=adapter,
        config=cfg,
        label=label or f"{adapter_id}:{org}",
        ref=adapter.source_ref(cfg, source_id=source_id, allow_browser=allow_browser),
        source_id=source_id,
        revision=3 if source_id else None,
        visibility=visibility,  # type: ignore[arg-type]
        cursor=CursorState(cursor),
        adhoc=source_id is None,
        company_hint=label or org.title(),
    )


@dataclass
class Harness:
    engine: ScraplingJobEngine
    db: StateDB | None = None
    events: list[dict[str, Any]] = field(default_factory=lambda: [])
    deduper: RunDeduper = field(default_factory=RunDeduper)
    crawl_dir: Path | None = None

    async def run(
        self,
        source: ResolvedSource,
        *,
        keywords: str | None = None,
        location: str | None = None,
        max_pages: int = 50,
        cancel: asyncio.Event | None = None,
        now_ms: Callable[[], int] | None = None,
    ) -> SourceOutcome:
        outcome = SourceOutcome(source=source)
        runner = SourceRunner(
            source,
            engine=self.engine,
            settings=RunnerSettings(
                run_id=RUN_ID,
                device_id=DEVICE_ID,
                max_pages=max_pages,
                keywords=keywords,
                location=location,
                crawl_dir=self.crawl_dir,
            ),
            seen=LocalSeenCache(self.db, ISSUER),
            deduper=self.deduper,
            db=self.db,
            cancel=cancel or asyncio.Event(),
            emit=self.events.append,
            now_ms=now_ms or (lambda: 1_791_770_000_000),
            outcome=outcome,
        )
        return await runner.run()


def bodies(outcome: SourceOutcome) -> list[dict[str, Any]]:
    from pilih_jobs.discovery.items import PreparedItem

    return [i.body if isinstance(i, PreparedItem) else i for i in outcome.items]


def by_title(outcome: SourceOutcome) -> dict[str, dict[str, Any]]:
    return {b["title"]: b for b in bodies(outcome) if "title" in b}
