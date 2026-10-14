"""The HTTP service (Starlette): `/healthz`, `/v1/scrape`, `/v1/probe`, `/v1/directory`,
`/v1/preflight`.

Requests are validated with the generated contract models (400 otherwise); a
source-level failure is a 200 with `error` set (24 §3). Bodies are capped at 4 MB.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, Final

from pilih_jobs.contracts._generated.cloud import (
    DirectoryRequest,
    PreflightRequest,
    ProbeRequest,
    ScrapeRequest,
)
from pydantic import BaseModel, ValidationError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from pilih_scraper import fetching
from pilih_scraper.directory import directory
from pilih_scraper.netguard import NetGuard
from pilih_scraper.preflight import preflight
from pilih_scraper.probe import probe
from pilih_scraper.scrape import scrape, versions

MAX_BODY_BYTES: Final = 4 * 1024 * 1024
#: Concurrent jobs per container process (memory bound; the queue runs ≤ 4).
MAX_CONCURRENT: Final = 4
DATA_DIR_ENV: Final = "PILIH_SCRAPER_DATA_DIR"

Handler = Callable[[dict[str, Any], fetching.EngineFactory], Awaitable[dict[str, Any]]]


def default_factory() -> fetching.EngineFactory:
    configured = os.environ.get(DATA_DIR_ENV)
    data_dir = Path(configured) if configured else Path(tempfile.gettempdir()) / "pilih-scraper"
    return fetching.EngineFactory(data_dir=data_dir, guard=NetGuard())


def _invalid(
    message: str, issues: list[dict[str, Any]] | None = None, status: int = 400
) -> Response:
    body: dict[str, Any] = {"error": "invalid_request", "message": message}
    if issues:
        body["issues"] = issues[:20]
    return JSONResponse(body, status_code=status)


async def _read_json(request: Request) -> Any | Response:
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return _invalid("Body larger than 4 MB", status=413)
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            return _invalid("Body larger than 4 MB", status=413)
        chunks.append(chunk)
    try:
        return json.loads(b"".join(chunks) or b"null")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _invalid("Body is not JSON")


def create_app(factory: fetching.EngineFactory | None = None) -> Starlette:
    engines = factory or default_factory()
    gate = asyncio.Semaphore(MAX_CONCURRENT)

    def endpoint(
        model: type[BaseModel], handler: Handler
    ) -> Callable[[Request], Awaitable[Response]]:
        async def run(request: Request) -> Response:
            body = await _read_json(request)
            if isinstance(body, Response):
                return body
            try:
                model.model_validate(body)
            except ValidationError as exc:
                issues = [
                    {"path": ".".join(str(p) for p in e["loc"]), "message": e["msg"]}
                    for e in exc.errors()
                ]
                return _invalid("Request does not match the scraper protocol", issues)
            async with gate:
                result = await handler(body, engines)
            return JSONResponse(result)

        return run

    async def healthz(_request: Request) -> Response:
        return JSONResponse({"ok": True, "engine": versions()})

    return Starlette(
        routes=[
            Route("/healthz", healthz, methods=["GET"]),
            Route("/v1/scrape", endpoint(ScrapeRequest, scrape), methods=["POST"]),
            Route("/v1/probe", endpoint(ProbeRequest, probe), methods=["POST"]),
            Route("/v1/directory", endpoint(DirectoryRequest, directory), methods=["POST"]),
            Route("/v1/preflight", endpoint(PreflightRequest, preflight), methods=["POST"]),
        ]
    )
