"""BrowserController: lifecycle of the automation browser (18 §3, §6.1).

- Mode A `managed` / Mode C `persistent`: `launch_persistent_context` on a CLI-owned
  profile under `browser-profiles/` (never a browser's default profile), honest UA, no
  stealth flags (D-16), `accept_downloads=False`, viewport 1366×900. Mode C additionally
  requires the named profile to exist (readiness check, 18 §3.3).
- Mode B `connected`: `connect_over_cdp(endpoint, is_local=True, no_defaults=True)` on a
  loopback endpoint only; a new page per task in `contexts[0]`; existing tabs are never
  touched and only our pages are closed. Guards are installed on our page, not on the
  user's context.
- `start` acquires the profile lock, launches or connects, and installs the guards:
  popup policy, the route guard for non-web top-level navigations, default timeouts
  (15 s actions / 45 s navigations). A disconnected browser marks every live session
  `crashed` (recovery is the agent's, 18 §9).
"""

from __future__ import annotations

import contextlib
import json
import locale
import os
import re
import time
from dataclasses import dataclass
from importlib.util import find_spec
from pathlib import Path
from typing import Any, Final, Literal, cast

import psutil
from playwright.async_api import Browser, BrowserContext, Playwright, ViewportSize, async_playwright
from playwright.async_api import Error as PlaywrightError

from pilih_jobs.browser.cdp import CdpVersion, fetch_cdp_version, validate_cdp_endpoint
from pilih_jobs.browser.errors import (
    BrowserCrashedError,
    BrowserError,
    BrowserNotInstalledError,
    CdpUnavailableError,
    HeadedUnavailableError,
    ProfileLockedError,
)
from pilih_jobs.browser.profiles import (
    ProfileLock,
    ProfileStore,
    check_profile_ready,
    check_profile_version,
    refuse_default_profile,
)
from pilih_jobs.browser.session import PageSession
from pilih_jobs.logging import get_logger, log_event
from pilih_jobs.policy.domains import DomainAllowlist

log = get_logger("browser.controller")

Mode = Literal["managed", "connected", "persistent"]
VIEWPORT: Final[ViewportSize] = {"width": 1366, "height": 900}
#: The only launch argument besides the test resolver rules: no stealth flags, ever.
BASE_ARGS: Final = ("--disable-features=Translate",)
_RESOLVER_RULE_RE: Final = re.compile(
    r"^(MAP [A-Za-z0-9*.-]+ (127\.0\.0\.1|localhost|\[::1\])(:\d+)?)"
    r"(\s*,\s*MAP [A-Za-z0-9*.-]+ (127\.0\.0\.1|localhost|\[::1\])(:\d+)?)*$"
)
MEMORY_LIMIT_BYTES: Final = int(2.5 * 1024**3)  # 18 §11


def bundled_chromium_version() -> str | None:
    """`browserVersion` of Chromium in Playwright's `browsers.json` (the installed build)."""
    spec = find_spec("playwright")
    if spec is None or spec.origin is None:
        return None
    manifest = Path(spec.origin).parent / "driver" / "package" / "browsers.json"
    try:
        data = cast(dict[str, Any], json.loads(manifest.read_text("utf-8")))
    except (OSError, ValueError):
        return None
    for browser in cast(list[dict[str, Any]], data.get("browsers") or []):
        if browser.get("name") == "chromium":
            version = browser.get("browserVersion")
            return str(version) if version else None
    return None


def system_locale() -> str | None:
    with contextlib.suppress(ValueError, TypeError):
        lang = locale.getlocale()[0]
        if lang and re.match(r"^[a-z]{2,3}(_[A-Za-z]{2,4})?$", lang):
            return lang.replace("_", "-")
    env = os.environ.get("LANG", "").split(".", 1)[0]
    if re.match(r"^[a-z]{2,3}(_[A-Z]{2})?$", env):
        return env.replace("_", "-")
    return None


def system_timezone() -> str | None:
    tz = os.environ.get("TZ", "").lstrip(":")
    if re.match(r"^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$", tz):
        return tz
    with contextlib.suppress(OSError):
        target = str(Path("/etc/localtime").readlink())
        if "zoneinfo/" in target:
            return target.split("zoneinfo/", 1)[1]
    return None


def validate_resolver_rules(rules: str) -> str:
    """Only loopback `MAP host 127.0.0.1` rules (fixture ATS harness) are accepted."""
    text = rules.strip()
    if not _RESOLVER_RULE_RE.match(text):
        raise BrowserError("host_resolver_rules may only map hosts to loopback (tests).")
    return text


@dataclass
class BrowserHealth:
    connected: bool
    mode: str | None
    profile: str | None
    version: str | None
    pages: int
    rss_bytes: int | None

    @property
    def memory_exceeded(self) -> bool:
        return self.rss_bytes is not None and self.rss_bytes > MEMORY_LIMIT_BYTES

    def to_json(self) -> dict[str, Any]:
        return {
            "connected": self.connected,
            "mode": self.mode,
            "profile": self.profile,
            "version": self.version,
            "pages": self.pages,
            "rss_mb": round(self.rss_bytes / 1024**2) if self.rss_bytes else None,
        }


class BrowserController:
    def __init__(
        self,
        *,
        data_dir: Path,
        task_id: str | None = None,
        host_resolver_rules: str | None = None,
    ) -> None:
        self.store = ProfileStore(data_dir)
        self.task_id = task_id
        self.host_resolver_rules = (
            validate_resolver_rules(host_resolver_rules) if host_resolver_rules else None
        )
        self.mode: Mode | None = None
        self.profile: str | None = None
        self.channel: str | None = None
        self.headless = True
        self.cdp_endpoint: str | None = None
        self.cdp_version: CdpVersion | None = None
        self._pw: Playwright | None = None
        self._context: BrowserContext | None = None
        self._browser: Browser | None = None
        self._lock: ProfileLock | None = None
        self._sessions: list[PageSession] = []
        self._stopping = False
        self.disconnected = False

    # ------------------------------------------------------------------ lifecycle
    async def start(
        self,
        mode: Mode,
        profile: str | None,
        channel: str | None,
        headless: bool,
        cdp_url: str | None,
    ) -> None:
        if self._context is not None:
            raise BrowserError("The browser is already started.")
        self.mode, self.profile, self.channel, self.headless = mode, profile, channel, headless
        self.disconnected = False
        try:
            if mode == "connected":
                await self._connect(cdp_url)
            else:
                await self._launch_profile(mode, profile or "apply-default", channel, headless)
        except BaseException:
            await self._teardown()
            raise
        log_event(log, "browser_started", mode=mode, profile=profile, headless=headless)

    async def _ensure_playwright(self) -> Playwright:
        if self._pw is None:
            self._pw = await async_playwright().start()
        return self._pw

    async def _launch_profile(
        self, mode: Mode, profile: str, channel: str | None, headless: bool
    ) -> None:
        path = self.store.dir_for(profile)
        refuse_default_profile(path)
        bundled = bundled_chromium_version() if channel in (None, "chromium") else None
        if mode == "persistent":
            check_profile_ready(path, name=profile, browser_version=bundled, must_exist=True)
        else:
            self.store.ensure(profile)
            check_profile_version(path, bundled, name=profile)
        if self._lock is None:
            self._lock = ProfileLock(path, name=profile, task_id=self.task_id)
            self._lock.acquire()
        await self._launch(path, channel, headless)

    async def _launch(self, path: Path, channel: str | None, headless: bool) -> None:
        pw = await self._ensure_playwright()
        args: list[str] = list(BASE_ARGS)
        if self.host_resolver_rules:
            args.append(f"--host-resolver-rules={self.host_resolver_rules}")
        kwargs: dict[str, Any] = {
            "headless": headless,
            "viewport": VIEWPORT,
            "accept_downloads": False,
            "args": args,
        }
        if channel and channel != "chromium":
            kwargs["channel"] = channel
        lang = system_locale()
        if lang:
            kwargs["locale"] = lang
        tz = system_timezone()
        if tz:
            kwargs["timezone_id"] = tz
        try:
            context = await pw.chromium.launch_persistent_context(str(path), **kwargs)
        except PlaywrightError as exc:
            raise self._launch_error(exc) from exc
        context.on("close", lambda _ctx: self._on_disconnect())
        self._context = context
        self.headless = headless

    def _launch_error(self, exc: PlaywrightError) -> BrowserError:
        text = str(exc)
        if "Executable doesn't exist" in text or (
            "browserType.launch" in text and "install" in text
        ):
            return BrowserNotInstalledError(
                "The automation browser is not installed.", hint="pilih-jobs browser install"
            )
        if "DISPLAY" in text or "X server" in text or "headed" in text.lower():
            return HeadedUnavailableError("A headed browser needs a display on this machine.")
        if "ProcessSingleton" in text or "profile appears to be in use" in text:
            return ProfileLockedError(
                f"Close the browser window using profile {self.profile}, then retry."
            )
        return BrowserCrashedError(f"The browser failed to start: {text.splitlines()[0][:200]}")

    async def _connect(self, cdp_url: str | None) -> None:
        endpoint = validate_cdp_endpoint(cdp_url or "")
        self.cdp_endpoint = endpoint
        self.cdp_version = await fetch_cdp_version(endpoint)
        pw = await self._ensure_playwright()
        try:
            browser = await pw.chromium.connect_over_cdp(endpoint, is_local=True, no_defaults=True)
        except PlaywrightError as exc:
            raise CdpUnavailableError(f"Could not attach to {endpoint}.") from exc
        browser.on("disconnected", lambda _b: self._on_disconnect())
        if not browser.contexts:
            raise CdpUnavailableError("The connected browser has no default context.")
        self._browser = browser
        self._context = browser.contexts[0]

    def _on_disconnect(self) -> None:
        if self._stopping:
            return
        self.disconnected = True
        for session in self._sessions:
            session.mark_crashed()
        log_event(log, "browser_disconnected")

    # ------------------------------------------------------------------ sessions
    @property
    def context(self) -> BrowserContext:
        if self._context is None:
            raise BrowserError("The browser is not started.")
        return self._context

    @property
    def version(self) -> str | None:
        if self.cdp_version is not None:
            return self.cdp_version.browser
        with contextlib.suppress(PlaywrightError, AttributeError):
            browser = self.context.browser
            if browser is not None:
                return browser.version
        return None

    async def new_session(
        self, task_id: str, allowlist: DomainAllowlist, apply_url: str
    ) -> PageSession:
        context = self.context
        page_level = self.mode == "connected"
        page = None
        if not page_level:
            blank = [p for p in context.pages if p.url == "about:blank"]
            page = blank[0] if blank and not self._sessions else None
        if page is None:
            try:
                page = await context.new_page()
            except PlaywrightError as exc:
                raise BrowserCrashedError("Could not open a page.") from exc
        session = PageSession(
            page=page,
            context=context,
            allowlist=allowlist,
            apply_url=apply_url,
            task_id=task_id,
            page_level_guards=page_level,
        )
        if not page_level:
            await context.route("**/*", session.route_guard)
        self._sessions.append(session)
        return session

    async def health(self) -> BrowserHealth:
        pages = 0
        connected = self._context is not None and not self.disconnected
        with contextlib.suppress(PlaywrightError, BrowserError):
            pages = len(self.context.pages) if connected else 0
        return BrowserHealth(
            connected=connected,
            mode=self.mode,
            profile=self.profile,
            version=self.version if connected else None,
            pages=pages,
            rss_bytes=self._browser_rss() if connected and self.mode != "connected" else None,
        )

    def _browser_rss(self) -> int | None:
        """Best-effort RSS of the browser processes using our profile (18 §11)."""
        if self.profile is None:
            return None
        target = str(self.store.root / self.profile)
        total = 0
        found = False
        for proc in psutil.process_iter(["cmdline", "memory_info"]):
            try:
                cmdline = cast(list[str] | None, proc.info.get("cmdline")) or []
                if not any(arg == f"--user-data-dir={target}" for arg in cmdline):
                    continue
                memory = proc.info.get("memory_info")
                if memory is not None:
                    total += int(memory.rss)
                    found = True
            except (psutil.Error, OSError):
                continue
        return total if found else None

    async def relaunch(self, *, headless: bool | None = None) -> None:
        """Relaunch the same profile (crash recovery / headed switch); the lock is kept."""
        if self.mode == "connected":
            raise BrowserCrashedError("A connected browser cannot be relaunched by pilih-jobs.")
        profile = self.profile or "apply-default"
        await self._close_context()
        self.disconnected = False
        self._sessions = []
        path = self.store.dir_for(profile)
        await self._launch(path, self.channel, self.headless if headless is None else headless)
        log_event(log, "browser_relaunched", profile=profile, headless=self.headless)

    async def _close_context(self) -> None:
        self._stopping = True
        try:
            for session in self._sessions:
                await session.close()
            if self.mode == "connected":
                if self._browser is not None:
                    with contextlib.suppress(PlaywrightError):
                        await self._browser.close()  # disconnects; the user's browser stays
            elif self._context is not None:
                with contextlib.suppress(PlaywrightError):
                    await self._context.close()
        finally:
            self._context = None
            self._browser = None
            self._stopping = False

    async def _teardown(self) -> None:
        await self._close_context()
        if self._pw is not None:
            with contextlib.suppress(PlaywrightError):
                await self._pw.stop()
            self._pw = None
        if self._lock is not None:
            self._lock.release()
            self._lock = None

    async def stop(self, reason: str) -> None:
        """Close only the pages and contexts we created, release the profile lock."""
        started = time.monotonic()
        await self._teardown()
        log_event(
            log, "browser_stopped", reason=reason, ms=int((time.monotonic() - started) * 1000)
        )
