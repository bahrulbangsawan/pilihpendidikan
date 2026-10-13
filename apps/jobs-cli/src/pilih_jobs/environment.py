"""Facts about this machine: browsers, display, installer, disk (21 §3, 22 §4–§5, §11).

Nothing here imports Playwright or Scrapling: installed browsers are found on disk in
the Playwright browsers path, and package presence is checked with `find_spec`.
"""

from __future__ import annotations

import importlib.util
import os
import platform
import re
import shutil
import socket
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal

from pilih_jobs.version import device_platform, platform_label

Installer = Literal["uv", "pipx", "brew", "scoop", "pip"]

_BROWSER_DIR = re.compile(
    r"^(chromium|chromium_headless_shell|chrome|firefox|webkit|ffmpeg)-(\d+)$"
)
MAX_DEVICE_NAME: Final = 60


def playwright_browsers_path() -> Path:
    """`PLAYWRIGHT_BROWSERS_PATH` or the Playwright default per OS (22 §4)."""
    override = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if override and override != "0":
        return Path(override).expanduser()
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Caches" / "ms-playwright"
    if sys.platform.startswith("win"):
        local = os.environ.get("LOCALAPPDATA") or str(home / "AppData" / "Local")
        return Path(local) / "ms-playwright"
    return Path(os.environ.get("XDG_CACHE_HOME") or home / ".cache") / "ms-playwright"


@dataclass(frozen=True)
class InstalledBrowser:
    name: str
    revision: str
    path: Path


def installed_browsers(root: Path | None = None) -> list[InstalledBrowser]:
    base = root or playwright_browsers_path()
    if not base.is_dir():
        return []
    found: list[InstalledBrowser] = []
    for entry in sorted(base.iterdir()):
        match = _BROWSER_DIR.match(entry.name)
        if match and entry.is_dir():
            found.append(InstalledBrowser(match.group(1), match.group(2), entry))
    return found


_BRANDED: Final[dict[str, dict[str, tuple[str, ...]]]] = {
    "chrome": {
        "macos": ("/Applications/Google Chrome.app",),
        "windows": (
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ),
        "linux": ("google-chrome", "google-chrome-stable"),
    },
    "msedge": {
        "macos": ("/Applications/Microsoft Edge.app",),
        "windows": (
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ),
        "linux": ("microsoft-edge", "microsoft-edge-stable"),
    },
}


def branded_browser_available(channel: str) -> bool:
    candidates = _BRANDED.get(channel, {}).get(device_platform(), ())
    for candidate in candidates:
        if os.sep in candidate or candidate.startswith("/") or ":" in candidate:
            if Path(candidate).exists():
                return True
        elif shutil.which(candidate):
            return True
    return False


def chromium_available(channel: str = "chromium") -> bool:
    if channel in ("chrome", "msedge"):
        return branded_browser_available(channel)
    return any(b.name in ("chromium", "chromium_headless_shell") for b in installed_browsers())


def has_display() -> bool:
    """A headed browser can be shown (assisted mode, human hand-offs)."""
    if device_platform() in ("macos", "windows"):
        return True
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def package_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def device_capabilities(channel: str = "chromium") -> list[str]:
    """Worker capabilities of 21 §3: discover, apply, render_cv, headed_browser."""
    capabilities: list[str] = []
    if package_available("scrapling"):
        capabilities.append("discover")
    browser = package_available("playwright") and chromium_available(channel)
    if browser:
        capabilities.extend(["apply", "render_cv"])
    if browser and has_display():
        capabilities.append("headed_browser")
    return capabilities


def default_device_name() -> str:
    """`<hostname> (<OS>)`, at most 60 characters (17 §4.1)."""
    host = socket.gethostname().split(".")[0] or "device"
    suffix = f" ({platform_label()})"
    return host[: MAX_DEVICE_NAME - len(suffix)] + suffix


def detect_installer(prefix: str | None = None) -> Installer:
    """How pilih-jobs was installed, from the `sys.prefix` path pattern (22 §5)."""
    path = (prefix or sys.prefix).replace("\\", "/").lower()
    if "/uv/tools/" in path or "/.local/share/uv/tools" in path:
        return "uv"
    if "/pipx/venvs/" in path:
        return "pipx"
    if "/cellar/" in path or "/homebrew/" in path or "/linuxbrew/" in path:
        return "brew"
    if "/scoop/apps/" in path:
        return "scoop"
    return "pip"


UPGRADE_COMMANDS: Final[dict[Installer, list[str]]] = {
    "uv": ["uv", "tool", "upgrade", "pilih-jobs"],
    "pipx": ["pipx", "upgrade", "pilih-jobs"],
    "brew": ["brew", "upgrade", "pilih-jobs"],
    "scoop": ["scoop", "update", "pilih-jobs"],
    "pip": ["python", "-m", "pip", "install", "--upgrade", "pilih-jobs"],
}

UNINSTALL_COMMANDS: Final[dict[Installer, str]] = {
    "uv": "uv tool uninstall pilih-jobs",
    "pipx": "pipx uninstall pilih-jobs",
    "brew": "brew uninstall pilih-jobs",
    "scoop": "scoop uninstall pilih-jobs",
    "pip": "python -m pip uninstall pilih-jobs",
}


def free_bytes(path: Path) -> int | None:
    probe = path
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    try:
        return shutil.disk_usage(probe).free
    except OSError:
        return None


def is_64bit() -> bool:
    return sys.maxsize > 2**32


def machine() -> str:
    return platform.machine()
