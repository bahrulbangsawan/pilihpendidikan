"""A scripted Chromium for the e2e suite: the *user's* browser.

Runs Playwright (from the `apps/jobs-cli` virtualenv) and executes one JSON command per
stdin line, answering one JSON line per command on stdout:

    {"id": 1, "cmd": "goto", "url": "http://localhost:4007/"}
    {"id": 1, "ok": true, "result": {"url": "...", "status": 200}}

The TypeScript side (`e2e/harness/browser.ts`) drives it. It is never the automation
browser of the CLI: it plays the human (signs in, approves consent, drags cards).
"""

from __future__ import annotations

import json
import re
import sys
import time
import traceback
from pathlib import Path
from typing import Any

from playwright.sync_api import Page, sync_playwright


def _arg(name: str, default: str | None = None) -> str | None:
    if name in sys.argv:
        index = sys.argv.index(name)
        if index + 1 < len(sys.argv):
            return sys.argv[index + 1]
    return default


def emit(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def main() -> None:
    headless = "--headed" not in sys.argv
    downloads = Path(_arg("--downloads") or ".").resolve()
    downloads.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless)
        context = browser.new_context(
            accept_downloads=True, viewport={"width": 1280, "height": 900}
        )
        page = context.new_page()
        console: list[str] = []
        page.on("console", lambda msg: console.append(f"{msg.type}: {msg.text}"))
        page.on("pageerror", lambda err: console.append(f"pageerror: {err}"))
        trace_page(page)
        emit({"ready": True})
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            request: dict[str, Any] = json.loads(line)
            note(f"cmd {json.dumps(request)[:300]}")
            ident = request.get("id")
            try:
                result = handle(page, context, request, downloads, console)
                emit({"id": ident, "ok": True, "result": result})
            except Exception as exc:  # noqa: BLE001 - every failure goes back to the test
                emit(
                    {
                        "id": ident,
                        "ok": False,
                        "error": f"{type(exc).__name__}: {exc}",
                        "trace": traceback.format_exc()[-2000:],
                        "url": safe_url(page),
                    }
                )
            if request.get("cmd") == "close":
                break
        context.close()
        browser.close()


def note(message: str) -> None:
    """A diagnostic line on stderr (the browser's log file), never on the protocol."""
    sys.stderr.write(f"[{time.time():.3f}] {message}\n")
    sys.stderr.flush()


def trace_page(page: Page) -> None:
    """Logs navigations, failed requests and console errors, for post-mortems."""
    page.on(
        "framenavigated",
        lambda frame: note(f"navigated {frame.url}") if frame == page.main_frame else None,
    )
    page.on("requestfailed", lambda r: note(f"requestfailed {r.method} {r.url} {r.failure}"))
    page.on(
        "console",
        lambda msg: (
            note(f"console {msg.type}: {msg.text[:300]}")
            if msg.type in ("error", "warning")
            else None
        ),
    )
    page.on("pageerror", lambda err: note(f"pageerror {err}"))


def safe_url(page: Page) -> str:
    try:
        return page.url
    except Exception:  # noqa: BLE001
        return ""


def handle(
    page: Page, context: Any, req: dict[str, Any], downloads: Path, console: list[str]
) -> Any:
    cmd = req["cmd"]
    timeout = float(req.get("timeout", 30_000))
    if cmd == "goto":
        response = page.goto(req["url"], wait_until=req.get("wait_until", "load"), timeout=timeout)
        return {"url": page.url, "status": response.status if response else None}
    if cmd == "url":
        return page.url
    if cmd == "content":
        return page.content()
    if cmd == "text":
        selector = req.get("selector", "body")
        return page.locator(selector).first.inner_text(timeout=timeout)
    if cmd == "count":
        return page.locator(req["selector"]).count()
    if cmd == "click":
        page.locator(req["selector"]).first.click(timeout=timeout)
        return None
    if cmd == "fill":
        page.locator(req["selector"]).first.fill(req["value"], timeout=timeout)
        return None
    if cmd == "press":
        if req.get("selector"):
            page.locator(req["selector"]).first.press(req["key"], timeout=timeout)
        else:
            page.keyboard.press(req["key"])
        return None
    if cmd == "focus":
        page.locator(req["selector"]).first.focus(timeout=timeout)
        return None
    if cmd == "wait_for":
        page.locator(req["selector"]).first.wait_for(
            state=req.get("state", "visible"), timeout=timeout
        )
        return None
    if cmd == "wait_for_url":
        page.wait_for_url(re.compile(req["pattern"]), timeout=timeout)
        return page.url
    if cmd == "wait_for_function":
        handle_ = page.wait_for_function(req["js"], timeout=timeout)
        return handle_.json_value()
    if cmd == "eval":
        return page.evaluate(req["js"])
    if cmd == "cookies":
        return context.cookies()
    if cmd == "add_cookies":
        context.add_cookies(req["cookies"])
        return None
    if cmd == "clear_cookies":
        context.clear_cookies()
        return None
    if cmd == "drag":
        return drag(page, req["source"], req["target"], timeout, float(req.get("y", 0.5)))
    if cmd == "download":
        with page.expect_download(timeout=timeout) as info:
            if req.get("press"):
                page.keyboard.press(req["press"])
            else:
                page.locator(req["selector"]).first.click(timeout=timeout)
        download = info.value
        target = downloads / (req.get("name") or download.suggested_filename)
        download.save_as(str(target))
        return {"path": str(target), "suggested": download.suggested_filename}
    if cmd == "screenshot":
        page.screenshot(path=req["path"], full_page=True)
        return req["path"]
    if cmd == "console":
        out = list(console)
        if req.get("clear"):
            console.clear()
        return out
    if cmd == "close":
        return None
    raise ValueError(f"unknown command {cmd!r}")


def drag(
    page: Page, source: str, target: str, timeout: float, y_fraction: float = 0.5
) -> dict[str, Any]:
    """A pointer drag with intermediate moves (dnd-kit needs real pointer events).

    The drop point is the target's horizontal centre at `y_fraction` of its height.
    """
    src = page.locator(source).first
    dst = page.locator(target).first
    src.scroll_into_view_if_needed(timeout=timeout)
    a = src.bounding_box(timeout=timeout)
    b = dst.bounding_box(timeout=timeout)
    if a is None or b is None:
        raise RuntimeError("drag: element has no box")
    ax, ay = a["x"] + a["width"] / 2, a["y"] + a["height"] / 2
    bx, by = b["x"] + b["width"] / 2, b["y"] + b["height"] * y_fraction
    page.mouse.move(ax, ay)
    page.mouse.down()
    page.mouse.move(ax + 8, ay + 8, steps=4)
    page.mouse.move(bx, by, steps=25)
    page.wait_for_timeout(150)
    page.mouse.move(bx + 2, by + 2, steps=3)
    page.mouse.up()
    return {"from": [ax, ay], "to": [bx, by]}


if __name__ == "__main__":
    main()
