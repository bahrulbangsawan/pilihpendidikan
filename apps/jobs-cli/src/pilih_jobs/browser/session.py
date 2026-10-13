"""PageSession: one page per task with its tab, dialog, download and navigation policies.

- **Navigation guard** (18 §7.4): every main-frame navigation is checked against the task's
  `DomainAllowlist`. Off-allowlist pages may load only to be observed: `actions_enabled`
  turns False and the executor refuses every action until the loop pauses or stops.
  Requests to `file:`, `chrome:`, `javascript:`, `data:` … top-level navigations are aborted
  by the route guard.
- **Popups** (18 §7.5): a page opened by ours on an allowlisted domain is adopted as the
  active page (the old one is closed after the new one loaded); otherwise it is closed at
  once (`popup_blocked`). Pages the user opened (no opener) are never touched — in Mode B
  they are the user's own tabs.
- **Dialogs**: `beforeunload` is accepted only during our own planned navigation; `alert`
  is dismissed and recorded; `confirm` / `prompt` are dismissed and request a pause.
- **Downloads** are cancelled and logged (18 §7.6).
- **Crash / close** (18 §9): `crash` or a disconnected browser marks the session crashed;
  closing our tab or window without us asking is a user cancel.

The only navigation this module performs is `open_apply_url()` — the posting's
`apply_url` from D1, fixed when the session is created. There is no way to navigate
anywhere else from the agent (19 §7).
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Final

from playwright.async_api import (
    BrowserContext,
    Dialog,
    Download,
    Frame,
    Page,
    Request,
    Response,
    Route,
)
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from pilih_jobs.browser.errors import (
    BrowserCrashedError,
    NavigationBlockedError,
    NavigationTimeoutError,
    NetworkOfflineError,
    PageClosedError,
)
from pilih_jobs.logging import get_logger, log_event
from pilih_jobs.policy.domains import BLOCKED_SCHEMES, DomainAllowlist, NavDecision, url_scheme

log = get_logger("browser.session")

ACTION_TIMEOUT_MS: Final = 15_000
NAVIGATION_TIMEOUT_MS: Final = 45_000
_OFFLINE_MARKERS: Final = (
    "ERR_INTERNET_DISCONNECTED",
    "ERR_NETWORK_CHANGED",
    "ERR_NETWORK_IO_SUSPENDED",
)
_UNREACHABLE_MARKERS: Final = (
    "ERR_NAME_NOT_RESOLVED",
    "ERR_CONNECTION_REFUSED",
    "ERR_CONNECTION_RESET",
    "ERR_ADDRESS_UNREACHABLE",
    "ERR_CONNECTION_TIMED_OUT",
    "ERR_TIMED_OUT",
)


@dataclass
class NetworkRecord:
    """Status + method + URL path of a POST/XHR response — bodies are never kept (18 §10)."""

    status: int
    method: str
    path: str
    host: str
    at: float


@dataclass
class SessionEvents:
    popups_blocked: int = 0
    popups_adopted: int = 0
    downloads_blocked: int = 0
    dialogs: list[dict[str, str]] = field(default_factory=lambda: [])
    blocked_navigations: list[str] = field(default_factory=lambda: [])


def _origin(url: str) -> str:
    head, sep, rest = url.partition("://")
    if not sep:
        return ""
    return f"{head}://{rest.split('/', 1)[0]}"


class PageSession:
    """Owns the task's active page; created by `BrowserController.new_session`."""

    def __init__(
        self,
        *,
        page: Page,
        context: BrowserContext,
        allowlist: DomainAllowlist,
        apply_url: str,
        task_id: str,
        page_level_guards: bool,
    ) -> None:
        self.page = page
        self.context = context
        self.allowlist = allowlist
        self.apply_url = apply_url
        self.task_id = task_id
        self.page_level_guards = page_level_guards
        self.events = SessionEvents()
        self.crashed = False
        self.closed_by_user = False
        self.main_status: int | None = None
        self.main_failure: str | None = None
        self.last_nav: NavDecision | None = None
        self.pending_dialog: str | None = None
        self.messages: list[str] = []
        self.planned_navigation = False
        self.network: deque[NetworkRecord] = deque(maxlen=60)
        self.last_activity = time.monotonic()
        # Observer state: refs are per page-session, monotonic, never reused (18 §6.2).
        self.ref_counter = 0
        self.issued_refs: set[str] = set()
        self.frame_index: dict[int, int] = {}
        self._next_frame_index = 1
        self._closing = False
        self._own_pages: set[int] = {id(page)}
        self._tasks: set[asyncio.Task[Any]] = set()
        self._bind(page)

    # ------------------------------------------------------------------ wiring
    def _spawn(self, coro: Any) -> None:
        task: asyncio.Task[Any] = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _bind(self, page: Page) -> None:
        page.set_default_timeout(ACTION_TIMEOUT_MS)
        page.set_default_navigation_timeout(NAVIGATION_TIMEOUT_MS)
        page.on("popup", lambda popup: self._spawn(self._on_popup(page, popup)))
        page.on("dialog", lambda dialog: self._spawn(self._on_dialog(dialog)))
        page.on("download", lambda download: self._spawn(self._on_download(download)))
        page.on("crash", lambda _page: self._on_crash())
        page.on("close", lambda closed: self._on_close(closed))
        page.on("framenavigated", lambda frame: self._on_navigated(page, frame))
        page.on("response", lambda response: self._on_response(page, response))
        page.on("requestfailed", lambda request: self._on_request_failed(page, request))
        if self.page_level_guards:
            self._spawn(page.route("**/*", self.route_guard))

    def frame_number(self, frame: Frame) -> int:
        """Stable per-session index of a child frame (ref prefix `fr<n>:`)."""
        key = id(frame)
        if key not in self.frame_index:
            self.frame_index[key] = self._next_frame_index
            self._next_frame_index += 1
        return self.frame_index[key]

    # ------------------------------------------------------------------ guards
    async def route_guard(self, route: Route) -> None:
        request = route.request
        try:
            is_nav = request.is_navigation_request()
        except PlaywrightError:
            is_nav = False
        scheme = url_scheme(request.url)
        if is_nav and (scheme in BLOCKED_SCHEMES or scheme not in ("http", "https", "about")):
            self.events.blocked_navigations.append(scheme)
            log_event(log, "navigation_blocked", scheme=scheme)
            with contextlib.suppress(PlaywrightError):
                await route.abort("blockedbyclient")
            return
        with contextlib.suppress(PlaywrightError):
            await route.fallback()

    def _on_navigated(self, page: Page, frame: Frame) -> None:
        if page is not self.page or frame.parent_frame is not None:
            return
        self.last_activity = time.monotonic()
        decision = self.allowlist.check_navigation(frame.url)
        self.last_nav = decision
        if decision.reason is not None and decision.reason != "off_allowlist":
            log_event(log, "navigation_guard", reason=decision.reason, domain=decision.domain)

    def check_current(self) -> NavDecision:
        decision = self.allowlist.check_navigation(self.page.url)
        self.last_nav = decision
        return decision

    @property
    def actions_enabled(self) -> bool:
        return self.check_current().actions_enabled

    async def _on_popup(self, opener: Page, popup: Page) -> None:
        if opener is not self.page:
            return
        with contextlib.suppress(PlaywrightError, PlaywrightTimeoutError):
            await popup.wait_for_load_state("domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
        decision = self.allowlist.check_navigation(popup.url)
        if decision.allowed and decision.actions_enabled:
            old = self.page
            self._own_pages.add(id(popup))
            self.page = popup
            self._bind(popup)
            self.events.popups_adopted += 1
            log_event(log, "popup_adopted", domain=decision.domain)
            self._closing = True
            try:
                with contextlib.suppress(PlaywrightError):
                    await old.close()
            finally:
                self._closing = False
            return
        self.events.popups_blocked += 1
        log_event(log, "popup_blocked", domain=decision.domain, reason=decision.reason)
        with contextlib.suppress(PlaywrightError):
            await popup.close()

    async def _on_dialog(self, dialog: Dialog) -> None:
        kind = dialog.type
        message = dialog.message[:300]
        self.events.dialogs.append({"type": kind, "message": message})
        with contextlib.suppress(PlaywrightError):
            if kind == "beforeunload" and self.planned_navigation:
                await dialog.accept()
                return
            await dialog.dismiss()
        if kind == "alert":
            self.messages.append(message)
        elif kind in ("confirm", "prompt"):
            self.pending_dialog = message or kind

    async def _on_download(self, download: Download) -> None:
        self.events.downloads_blocked += 1
        log_event(log, "download_blocked")
        with contextlib.suppress(PlaywrightError):
            await download.cancel()

    def _on_crash(self) -> None:
        self.crashed = True
        log_event(log, "page_crashed")

    def _on_close(self, page: Page) -> None:
        if page is self.page and not self._closing:
            self.closed_by_user = True
            log_event(log, "page_closed_by_user")

    def _on_response(self, page: Page, response: Response) -> None:
        if page is not self.page:
            return
        self.last_activity = time.monotonic()
        request = response.request
        try:
            frame = request.frame
            main = frame.parent_frame is None
        except PlaywrightError:
            main = False
        try:
            if request.is_navigation_request() and main:
                self.main_status = response.status
                self.main_failure = None
        except PlaywrightError:
            return
        if request.method in ("POST", "PUT", "PATCH"):
            url = response.url
            host_path = url.split("://", 1)[-1]
            host, _, path = host_path.partition("/")
            self.network.append(
                NetworkRecord(
                    status=response.status,
                    method=request.method,
                    path="/" + path.split("?", 1)[0].split("#", 1)[0],
                    host=host.split("@")[-1].split(":")[0],
                    at=time.monotonic(),
                )
            )

    def _on_request_failed(self, page: Page, request: Request) -> None:
        if page is not self.page:
            return
        try:
            if request.is_navigation_request() and request.frame.parent_frame is None:
                self.main_failure = request.failure or "failed"
        except PlaywrightError:
            return

    # ------------------------------------------------------------------ state
    def raise_if_broken(self) -> None:
        if self.crashed:
            raise BrowserCrashedError("The browser crashed or disconnected.")
        if self.closed_by_user:
            raise PageClosedError("The application tab was closed.")

    def mark_crashed(self) -> None:
        self.crashed = True

    @property
    def url(self) -> str:
        try:
            return self.page.url
        except PlaywrightError:
            return ""

    @property
    def origin(self) -> str:
        return _origin(self.url)

    def mutation_count_script(self) -> str:
        return "() => window.__pjMutations || 0"

    # ------------------------------------------------------------------ navigation
    async def open_apply_url(self) -> int | None:
        """The single navigation the executor performs itself: the posting's apply_url."""
        decision = self.allowlist.check_navigation(self.apply_url)
        if not decision.allowed or decision.reason in ("blocked_scheme", "invalid_url"):
            raise NavigationBlockedError(
                "The posting's apply URL is not an http(s) URL.",
                details={"reason": decision.reason},
            )
        self.planned_navigation = True
        try:
            response = await self.page.goto(
                self.apply_url, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS
            )
        except PlaywrightTimeoutError as exc:
            raise NavigationTimeoutError("Opening the application page timed out.") from exc
        except PlaywrightError as exc:
            raise self.translate_navigation_error(exc) from exc
        finally:
            self.planned_navigation = False
        self.main_status = response.status if response is not None else self.main_status
        await self.settle()
        return self.main_status

    def translate_navigation_error(self, exc: PlaywrightError) -> Exception:
        text = str(exc)
        if any(marker in text for marker in _OFFLINE_MARKERS):
            return NetworkOfflineError("The network is offline.")
        if any(marker in text for marker in _UNREACHABLE_MARKERS):
            return NavigationTimeoutError("The application site could not be reached.")
        if "Target page, context or browser has been closed" in text or "crash" in text.lower():
            if self.closed_by_user:
                return PageClosedError("The application tab was closed.")
            return BrowserCrashedError("The browser closed during navigation.")
        return NavigationTimeoutError(f"Navigation failed: {text.splitlines()[0][:200]}")

    async def settle(self, timeout_ms: int = 5_000) -> None:
        """Best-effort wait for the page to be ready after a navigation or action."""
        with contextlib.suppress(PlaywrightError, PlaywrightTimeoutError):
            await self.page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
        with contextlib.suppress(PlaywrightError, PlaywrightTimeoutError):
            await self.page.wait_for_load_state("networkidle", timeout=min(timeout_ms, 1_500))

    async def bring_to_front(self) -> None:
        with contextlib.suppress(PlaywrightError):
            await self.page.bring_to_front()

    def post_responses_since(self, since: float) -> list[NetworkRecord]:
        return [record for record in self.network if record.at >= since]

    async def close(self) -> None:
        """Close the pages this session opened (never the user's tabs)."""
        self._closing = True
        with contextlib.suppress(PlaywrightError):
            if not self.page.is_closed():
                await self.page.close()
        for task in list(self._tasks):
            task.cancel()
