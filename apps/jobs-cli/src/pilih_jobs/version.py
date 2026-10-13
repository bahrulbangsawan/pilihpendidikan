"""Version, release channel, platform and the HTTP identity of the CLI (05 §1.7, 22 §7).

`__version__` is the single source of the CLI version; `pyproject.toml` carries the same
value (a unit test keeps them equal). Dependency versions are read from package metadata
so this module never imports Playwright or Scrapling.
"""

from __future__ import annotations

import platform
import re
import sys
from importlib import metadata
from typing import Final, Literal

__version__: Final = "0.1.0"

APP_NAME: Final = "pilih-jobs"
DIST_NAME: Final = "pilih-jobs"

DevicePlatform = Literal["macos", "windows", "linux"]

_SEMVER = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$"
)


def channel() -> Literal["stable", "beta"]:
    """`beta` for pre-release versions (`0.2.0-beta.1`), else `stable` (22 §7)."""
    match = _SEMVER.match(__version__)
    return "beta" if match is not None and match.group(4) else "stable"


def dependency_version(dist: str) -> str | None:
    """Installed version of a distribution, without importing it."""
    try:
        return metadata.version(dist)
    except metadata.PackageNotFoundError:
        return None


def python_version() -> str:
    return ".".join(str(part) for part in sys.version_info[:3])


def device_platform() -> DevicePlatform:
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("win"):
        return "windows"
    return "linux"


def platform_label() -> str:
    """Human platform name used in the default device name: macOS, Windows, Linux."""
    return {"macos": "macOS", "windows": "Windows", "linux": "Linux"}[device_platform()]


def arch() -> str:
    machine = platform.machine().lower()
    return {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64"}.get(machine, machine or "unknown")


def user_agent() -> str:
    """`pilih-jobs/<semver> (<os>; <arch>) python/<ver> playwright/<ver> scrapling/<ver>`."""
    parts = [
        f"{APP_NAME}/{__version__} ({device_platform()}; {arch()})",
        f"python/{python_version()}",
        f"playwright/{dependency_version('playwright') or 'none'}",
        f"scrapling/{dependency_version('scrapling') or 'none'}",
    ]
    if channel() == "beta":
        parts.append("channel/beta")
    return " ".join(parts)


def client_header() -> str:
    """Value of `X-Pilih-Client` (05 §1.7)."""
    return f"cli/{__version__}"


def parse_semver(value: str) -> tuple[int, int, int, tuple[str, ...]] | None:
    match = _SEMVER.match(value.strip())
    if match is None:
        return None
    pre = tuple(match.group(4).split(".")) if match.group(4) else ()
    return int(match.group(1)), int(match.group(2)), int(match.group(3)), pre


def _pre_key(pre: tuple[str, ...]) -> tuple[tuple[int, int | str], ...]:
    # SemVer §11: numeric identifiers sort numerically and before alphanumeric ones.
    return tuple((0, int(p)) if p.isdigit() else (1, p) for p in pre)


def compare_versions(left: str, right: str) -> int:
    """-1, 0 or 1 comparing two SemVer strings; unparseable versions sort lowest."""
    a, b = parse_semver(left), parse_semver(right)
    if a is None or b is None:
        return (a is not None) - (b is not None)
    if a[:3] != b[:3]:
        return -1 if a[:3] < b[:3] else 1
    if a[3] == b[3]:
        return 0
    if not a[3]:
        return 1  # a release outranks its pre-releases
    if not b[3]:
        return -1
    ka, kb = _pre_key(a[3]), _pre_key(b[3])
    return -1 if ka < kb else (1 if ka > kb else 0)


def is_below(version: str, minimum: str) -> bool:
    return compare_versions(version, minimum) < 0
