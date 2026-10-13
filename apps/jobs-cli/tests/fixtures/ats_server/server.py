"""The Starlette app, its recorded state and a uvicorn runner on a random loopback port."""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
import socket
import threading
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psutil
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, Response
from starlette.routing import Route

APPLY_HOST = "jobs.acme-ats.test"
PARTNER_HOST = "forms.partner-ats.test"
EVIL_HOST = "evil-redirect.test"
OTHER_HOST = "widgets.other-origin.test"
CAPTCHA_HOST = "challenges.cloudflare.com"
HOST_RESOLVER_RULES = "MAP *.test 127.0.0.1, MAP challenges.cloudflare.com 127.0.0.1"


@dataclass
class Hit:
    method: str
    host: str
    path: str
    query: str
    form: dict[str, list[str]]
    files: dict[str, str]
    at: float


@dataclass
class FixtureState:
    hits: list[Hit] = field(default_factory=list)
    flags: dict[str, Any] = field(default_factory=dict)
    counters: dict[str, int] = field(default_factory=dict)
    kill_profile_dir: Path | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    def reset(self) -> None:
        with self.lock:
            self.hits.clear()
            self.flags.clear()
            self.counters.clear()
            self.kill_profile_dir = None

    def bump(self, key: str) -> int:
        with self.lock:
            self.counters[key] = self.counters.get(key, 0) + 1
            return self.counters[key]

    def posts(self, path_prefix: str = "") -> list[Hit]:
        return [h for h in self.hits if h.method == "POST" and h.path.startswith(path_prefix)]

    def hits_on(self, host: str) -> list[Hit]:
        return [h for h in self.hits if h.host == host]

    def kill_browser(self) -> int:
        """SIGKILL every browser process using the test profile (scenarios 13/14)."""
        target = self.kill_profile_dir
        if target is None:
            return 0
        real = os.path.realpath(target)
        killed = 0
        for proc in psutil.process_iter(["pid", "cmdline"]):
            try:
                cmdline = proc.info.get("cmdline") or []
            except (psutil.Error, OSError):
                continue
            if any(
                arg == f"--user-data-dir={real}" or arg == f"--user-data-dir={target}"
                for arg in cmdline
            ):
                with contextlib.suppress(psutil.Error, OSError):
                    os.kill(proc.info["pid"], signal.SIGKILL)
                    killed += 1
        return killed


@dataclass
class PageCtx:
    request: Request
    state: FixtureState
    port: int
    host: str
    form: dict[str, list[str]]

    def origin(self, host: str = APPLY_HOST) -> str:
        return f"http://{host}:{self.port}"

    def value(self, name: str) -> str:
        values = self.form.get(name) or []
        return values[0] if values else ""


Handler = Callable[[PageCtx], Awaitable[Response]]


def html(body: str, *, title: str = "Apply", status: int = 200, head: str = "") -> HTMLResponse:
    page = (
        "<!doctype html><html lang=en><head><meta charset=utf-8>"
        f"<title>{title}</title>{head}"
        "<style>body{font-family:sans-serif;margin:24px} .field{margin:10px 0}"
        " label{display:block} .error{color:#b00}</style></head>"
        f"<body>{body}</body></html>"
    )
    return HTMLResponse(page, status_code=status)


def build_app(
    state: FixtureState, handlers: dict[str, Handler], port_ref: dict[str, int]
) -> Starlette:
    async def endpoint(request: Request) -> Response:
        host = (request.headers.get("host") or "").split(":")[0]
        form: dict[str, list[str]] = {}
        files: dict[str, str] = {}
        if request.method == "POST":
            content_type = request.headers.get("content-type", "")
            if (
                "multipart/form-data" in content_type
                or "application/x-www-form-urlencoded" in content_type
            ):
                data = await request.form()
                for key, value in data.multi_items():
                    if hasattr(value, "filename"):
                        files[key] = str(getattr(value, "filename", "") or "")
                        form.setdefault(key, []).append(str(getattr(value, "filename", "") or ""))
                    else:
                        form.setdefault(key, []).append(str(value))
            else:
                body = (await request.body()).decode("utf-8", "replace")
                form["_body"] = [body]
        hit = Hit(
            method=request.method,
            host=host,
            path=request.url.path,
            query=request.url.query,
            form=form,
            files=files,
            at=time.monotonic(),
        )
        with state.lock:
            state.hits.append(hit)
        key = request.url.path
        handler = handlers.get(f"{host}{key}") or handlers.get(key)
        if handler is None:
            if host == "evil-redirect.test":
                return html(
                    "<h1>Totally unrelated site</h1><p>Nothing to see.</p>", title="Elsewhere"
                )
            return html("<h1>Not found</h1>", status=404, title="Not found")
        ctx = PageCtx(request=request, state=state, port=port_ref["port"], host=host, form=form)
        return await handler(ctx)

    return Starlette(routes=[Route("/{path:path}", endpoint, methods=["GET", "POST"])])


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class FixtureServer:
    """Runs the fixture app with uvicorn in a background thread (its own event loop)."""

    def __init__(self, handlers: dict[str, Handler]) -> None:
        self.state = FixtureState()
        self.port = _free_port()
        self._port_ref = {"port": self.port}
        self.app = build_app(self.state, handlers, self._port_ref)
        config = uvicorn.Config(
            self.app, host="127.0.0.1", port=self.port, log_level="warning", lifespan="off"
        )
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._run, name="fixture-ats", daemon=True)

    def _run(self) -> None:
        asyncio.run(self._server.serve())

    def start(self) -> FixtureServer:
        self._thread.start()
        deadline = time.monotonic() + 10
        while not self._server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("fixture ATS server did not start")
            time.sleep(0.02)
        return self

    def stop(self) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=10)

    def url(self, path: str, host: str = APPLY_HOST) -> str:
        return f"http://{host}:{self.port}{path}"
