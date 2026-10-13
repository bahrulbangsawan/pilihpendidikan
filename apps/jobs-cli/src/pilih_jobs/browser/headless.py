"""Headless rendering helpers (PLAN C6, C8; 08 §6, 18 §3.4).

`render_cv_page(url)` opens the `apps/jobs` render route (`/render/cv/<cvv_id>?ticket=…`)
in headless Chromium with an **ephemeral** profile (`launch_persistent_context("")` makes
a fresh temporary directory, 18 §3.4 `render`), waits for `window.__PILIH_RENDER__` and
returns it: `{"status": "done", "file_id": …, "sha256": …}` or
`{"status": "error", "message": …}`. Failures of the page itself come back as an error
status (`error_class = "render_failed"`); downloads and popups are blocked, and only
http(s) URLs are opened. The render ticket in the URL is never logged.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any, Final, cast
from urllib.parse import urlsplit

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

from pilih_jobs.browser.controller import BASE_ARGS, VIEWPORT, validate_resolver_rules
from pilih_jobs.logging import get_logger, log_event

log = get_logger("browser.headless")

_READY_JS: Final = (
    "() => { const r = window.__PILIH_RENDER__; "
    "return !!(r && (r.status === 'done' || r.status === 'error')); }"
)
_RESULT_JS: Final = "() => window.__PILIH_RENDER__"


def _error(message: str) -> dict[str, Any]:
    return {"status": "error", "message": message, "error_class": "render_failed"}


def _normalize(result: object) -> dict[str, Any]:
    if not isinstance(result, dict):
        return _error("The render page returned no result.")
    data = cast(dict[str, Any], result)
    status = data.get("status")
    if status == "done":
        file_id, sha256 = data.get("file_id"), data.get("sha256")
        if not isinstance(file_id, str) or not isinstance(sha256, str):
            return _error("The render page finished without a file id and hash.")
        return {"status": "done", "file_id": file_id, "sha256": sha256.lower()}
    message = data.get("message")
    return _error(str(message)[:300] if message else "The render page reported an error.")


async def render_cv_page(
    url: str, *, timeout_s: float = 60, host_resolver_rules: str | None = None
) -> dict[str, Any]:
    """Render a CV variant page headlessly and return `window.__PILIH_RENDER__`."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return _error("The render URL must be an http(s) URL.")
    args: list[str] = list(BASE_ARGS)
    if host_resolver_rules:
        args.append(f"--host-resolver-rules={validate_resolver_rules(host_resolver_rules)}")
    timeout_ms = max(1_000, int(timeout_s * 1000))
    async with async_playwright() as pw:
        try:
            context = await pw.chromium.launch_persistent_context(
                "", headless=True, viewport=VIEWPORT, accept_downloads=False, args=args
            )
        except PlaywrightError as exc:
            return _error(f"The headless browser failed to start: {str(exc).splitlines()[0][:200]}")
        try:
            page = context.pages[0] if context.pages else await context.new_page()

            pending: set[asyncio.Future[Any]] = set()

            def _later(coro: Any) -> None:
                task = asyncio.ensure_future(coro)
                pending.add(task)
                task.add_done_callback(pending.discard)

            page.on("popup", lambda popup: _later(popup.close()))
            page.on("download", lambda download: _later(download.cancel()))
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                await page.wait_for_function(_READY_JS, timeout=timeout_ms)
                result = await page.evaluate(_RESULT_JS)
            except PlaywrightTimeoutError:
                log_event(log, "render_timeout", host=parts.hostname)
                return _error("The CV render timed out.")
            except PlaywrightError as exc:
                return _error(f"The CV render page failed: {str(exc).splitlines()[0][:200]}")
            outcome = _normalize(result)
            log_event(log, "render_finished", status=outcome["status"], host=parts.hostname)
            return outcome
        finally:
            with contextlib.suppress(PlaywrightError):
                await context.close()
