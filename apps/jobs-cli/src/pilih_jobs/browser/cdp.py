"""Mode B — a browser the user launched with remote debugging on loopback (18 §3.2, D-23).

- `validate_cdp_endpoint`: the host must be `127.0.0.1`, `::1` or `localhost`; anything
  else is refused with `cdp_non_loopback`. http(s) and ws(s) schemes only, no userinfo.
- `fetch_cdp_version`: `GET /json/version` (`Browser`, `Protocol-Version`); Chromium majors
  older than `MIN_CDP_CHROMIUM_MAJOR` are refused.
- `launch_commands`: the exact command for the user's platform — printed, **never run**
  by the CLI, never with `--remote-allow-origins=*`, always a dedicated
  `--user-data-dir` under `browser-profiles/` (Chrome 136+ ignores remote debugging on
  the default data directory anyway).
- `SECURITY_WARNING` is shown at every `connect` (11 §4.7).
"""

from __future__ import annotations

import ipaddress
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Literal, cast
from urllib.parse import urlsplit, urlunsplit

import httpx

from pilih_jobs.browser.errors import (
    CdpNonLoopbackError,
    CdpUnavailableError,
    CdpVersionError,
)

DEFAULT_CDP_PORT: Final = 9222
#: Oldest Chromium major the bundled Playwright drives reliably over CDP.
MIN_CDP_CHROMIUM_MAJOR: Final = 120
#: 18 §3.2: warn when the debugging port is still open this long after the last task.
PORT_OPEN_WARNING_S: Final = 30 * 60
CONNECTED_PROFILE: Final = "connected-chrome"

SECURITY_WARNING: Final = (
    "Any program on this computer can control this Chrome window while remote debugging "
    "is on, including reading pages you are signed in to. Close it when you are done."
)

Browser = Literal["chrome", "msedge"]
Platform = Literal["darwin", "win32", "linux"]


def _is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def validate_cdp_endpoint(url: str) -> str:
    """Return the normalized endpoint (`http://127.0.0.1:9222`) or raise `cdp_non_loopback`."""
    text = url.strip()
    if "://" not in text:
        text = f"http://{text}"
    parts = urlsplit(text)
    host = (parts.hostname or "").lower()
    if parts.scheme not in ("http", "https", "ws", "wss"):
        raise CdpNonLoopbackError(
            f"Unsupported CDP endpoint scheme {parts.scheme!r}; use http://127.0.0.1:<port>."
        )
    if parts.username or parts.password:
        raise CdpNonLoopbackError("A CDP endpoint must not carry credentials.")
    allowed_hosts = ("127.0.0.1", "::1", "localhost")
    if host not in allowed_hosts or not _is_loopback(host):
        raise CdpNonLoopbackError(
            f"Refusing CDP endpoint on {host or '?'}: only 127.0.0.1, ::1 or localhost are "
            "allowed (18 §3.2).",
            details={"host": host},
        )
    try:
        port = parts.port
    except ValueError as exc:
        raise CdpNonLoopbackError("Invalid CDP port.") from exc
    netloc = f"[{host}]" if ":" in host else host
    if port is not None:
        netloc = f"{netloc}:{port}"
    path = parts.path.rstrip("/") if parts.scheme.startswith("ws") else ""
    return urlunsplit((parts.scheme, netloc, path, "", ""))


def http_base(endpoint: str) -> str:
    parts = urlsplit(endpoint)
    scheme = {"ws": "http", "wss": "https"}.get(parts.scheme, parts.scheme)
    return urlunsplit((scheme, parts.netloc, "", "", ""))


@dataclass(frozen=True)
class CdpVersion:
    browser: str
    protocol_version: str
    web_socket_debugger_url: str | None

    @property
    def product(self) -> str:
        return self.browser.split("/", 1)[0]

    @property
    def major(self) -> int | None:
        match = re.search(r"/(\d+)\.", self.browser)
        return int(match.group(1)) if match else None

    def to_json(self) -> dict[str, Any]:
        return {
            "browser": self.browser,
            "protocol_version": self.protocol_version,
            "major": self.major,
        }


def parse_cdp_version(data: dict[str, Any]) -> CdpVersion:
    browser = str(data.get("Browser") or "")
    if not browser:
        raise CdpUnavailableError("The endpoint did not answer like a Chromium DevTools server.")
    return CdpVersion(
        browser=browser,
        protocol_version=str(data.get("Protocol-Version") or ""),
        web_socket_debugger_url=cast(str | None, data.get("webSocketDebuggerUrl")),
    )


def check_cdp_version(version: CdpVersion) -> None:
    major = version.major
    if major is None or major < MIN_CDP_CHROMIUM_MAJOR:
        raise CdpVersionError(
            f"{version.browser or 'This browser'} is too old for pilih-jobs: Chromium "
            f"{MIN_CDP_CHROMIUM_MAJOR}+ is required.",
            details=version.to_json(),
        )


async def fetch_cdp_version(endpoint: str, *, timeout_s: float = 5.0) -> CdpVersion:
    """`GET /json/version` on a validated loopback endpoint."""
    url = f"{http_base(validate_cdp_endpoint(endpoint))}/json/version"
    try:
        async with httpx.AsyncClient(timeout=timeout_s, trust_env=False) as client:
            response = await client.get(url)
    except httpx.HTTPError as exc:
        raise CdpUnavailableError(
            f"No browser answered on {http_base(endpoint)}; start it with the command from "
            "`pilih-jobs browser launch --mode connected`.",
        ) from exc
    if response.status_code != 200:
        raise CdpUnavailableError(f"{url} answered HTTP {response.status_code}.")
    try:
        payload = response.json()
    except ValueError as exc:
        raise CdpUnavailableError("The DevTools endpoint returned invalid JSON.") from exc
    if not isinstance(payload, dict):
        raise CdpUnavailableError("The DevTools endpoint returned an unexpected payload.")
    version = parse_cdp_version(cast(dict[str, Any], payload))
    check_cdp_version(version)
    return version


async def cdp_port_open(endpoint: str, *, timeout_s: float = 1.0) -> bool:
    try:
        await fetch_cdp_version(endpoint, timeout_s=timeout_s)
    except (CdpUnavailableError, CdpVersionError, CdpNonLoopbackError):
        return False
    return True


def port_open_too_long(last_task_at_s: float | None, *, now_s: float | None = None) -> bool:
    """18 §3.2: warn when the port is still open 30 minutes after the last task."""
    if last_task_at_s is None:
        return False
    return (now_s if now_s is not None else time.time()) - last_task_at_s >= PORT_OPEN_WARNING_S


_EXECUTABLES: Final[dict[Platform, dict[Browser, str]]] = {
    "darwin": {
        "chrome": '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"',
        "msedge": '"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"',
    },
    "win32": {
        "chrome": r'"C:\Program Files\Google\Chrome\Application\chrome.exe"',
        "msedge": r'"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"',
    },
    "linux": {"chrome": "google-chrome", "msedge": "microsoft-edge"},
}

_PROFILE_DIRS: Final[dict[Platform, str]] = {
    "darwin": '"$HOME/Library/Application Support/pilih-jobs/browser-profiles/{name}"',
    "win32": r'"%LOCALAPPDATA%\pilih-jobs\browser-profiles\{name}"',
    "linux": '"$HOME/.local/share/pilih-jobs/browser-profiles/{name}"',
}


def launch_command(
    platform: Platform,
    *,
    browser: Browser = "chrome",
    port: int = DEFAULT_CDP_PORT,
    user_data_dir: Path | None = None,
) -> str:
    """The Mode B launch command for one platform (printed, never executed)."""
    if not 1024 <= port <= 65535:
        raise ValueError("CDP port must be between 1024 and 65535")
    name = CONNECTED_PROFILE if browser == "chrome" else "connected-edge"
    profile = (
        f'"{user_data_dir}"'
        if user_data_dir is not None
        else _PROFILE_DIRS[platform].format(name=name)
    )
    continuation = " ^\n    " if platform == "win32" else " \\\n    "
    parts = [
        _EXECUTABLES[platform][browser],
        f"--remote-debugging-port={port} --remote-debugging-address=127.0.0.1",
        f"--user-data-dir={profile}",
    ]
    return continuation.join(parts)


def launch_commands(
    *,
    browser: Browser = "chrome",
    port: int = DEFAULT_CDP_PORT,
    user_data_dir: Path | None = None,
    current_platform: Platform | None = None,
) -> dict[str, str]:
    """Commands for every platform; `user_data_dir` (the real data dir) only for this one."""
    out: dict[str, str] = {}
    for platform in ("darwin", "win32", "linux"):
        out[platform] = launch_command(
            platform,
            browser=browser,
            port=port,
            user_data_dir=user_data_dir if platform == current_platform else None,
        )
    return out
