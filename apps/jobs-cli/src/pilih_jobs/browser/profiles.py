"""Browser profiles: names by purpose, storage, locking and credential hygiene (18 §3.3–§4).

- Profiles live in `<data>/browser-profiles/<name>/` (0700). Metadata of user-prepared
  profiles (Mode C) is `<data>/profiles/<name>.json` — user-typed domain hints only,
  **never** read from the cookie store.
- Purposes never mix (18 §3.4): `discovery` is discovery-only; apply tasks use
  `apply-default` or `apply-<name>`; `render_cv` uses a fresh temporary context.
- Locking (18 §4.2): our own `<profile>/.pilih-jobs.lock` (`O_CREAT|O_EXCL`, JSON
  `{pid, hostname, started_at, task_id, boot_time}`, liveness via psutil). When Chromium's
  `SingletonLock` (POSIX symlink) / `lockfile` (Windows) exists while our lock is absent
  or stale, the profile is in use by a browser the user opened → `profile_locked`. The
  CLI never deletes `SingletonLock` on its own: `browser profiles unlock` does it after the
  user confirms, and only when no Chromium process has that `--user-data-dir`.
- The default data directory of Chrome / Edge / Chromium / Brave is refused as
  `user_data_dir` on every OS path style (18 §4.3 → `default_profile_refused`).
"""

from __future__ import annotations

import contextlib
import json
import ntpath
import os
import posixpath
import re
import shutil
import socket
import sys
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path, PurePath, PurePosixPath, PureWindowsPath
from typing import Any, Final, Literal, cast

import psutil

from pilih_jobs.browser.errors import (
    DefaultProfileRefusedError,
    ProfileLockedError,
    ProfileNewerThanBrowserError,
    ProfileNotFoundError,
    ProfilePurposeError,
)
from pilih_jobs.errors import UsageError
from pilih_jobs.paths import ensure_private_dir

LOCK_FILE: Final = ".pilih-jobs.lock"
#: Chromium's own process-singleton markers (POSIX symlinks / Windows file).
CHROMIUM_SINGLETONS: Final = ("SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile")
DISCOVERY_PROFILE: Final = "discovery"
APPLY_DEFAULT_PROFILE: Final = "apply-default"
RENDER_PROFILE: Final = "render"
_NAME_RE: Final = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

Purpose = Literal["apply", "discovery"]
OsStyle = Literal["darwin", "win32", "linux"]


# ------------------------------------------------------------------ names (18 §3.3–§3.4)
def validate_profile_name(name: str) -> str:
    text = name.strip().lower()
    if not _NAME_RE.match(text) or text in (".", ".."):
        raise UsageError(
            f"Invalid profile name {name!r}: use lowercase letters, digits, '-' or '_' (≤ 64)."
        )
    if text == RENDER_PROFILE:
        raise ProfilePurposeError("`render` is the ephemeral render_cv context, not a profile.")
    return text


def apply_profile_name(name: str | None) -> str:
    """The directory name of an apply profile: `apply-default` or `apply-<name>`."""
    if name is None or name.strip().lower() in ("", "default", APPLY_DEFAULT_PROFILE):
        return APPLY_DEFAULT_PROFILE
    text = validate_profile_name(name)
    if text == DISCOVERY_PROFILE:
        raise ProfilePurposeError("The discovery profile is never used for applications (18 §3.4).")
    return text if text.startswith("apply-") else f"apply-{text}"


def profile_purpose(dir_name: str) -> Purpose:
    return "discovery" if dir_name == DISCOVERY_PROFILE else "apply"


def select_apply_profile(
    *, task_payload: Mapping[str, Any] | None, rule: Mapping[str, Any] | None, default: str | None
) -> str:
    """18 §3.3: task payload `browser_profile` → rule `browser_profile` → configured default."""
    for source in (task_payload, rule):
        if source:
            value = source.get("browser_profile")
            if isinstance(value, str) and value.strip():
                return apply_profile_name(value)
    return apply_profile_name(default)


# ------------------------------------------------------------------ default dirs (18 §4.3)
def _mac_defaults(home: str) -> list[str]:
    support = f"{home}/Library/Application Support"
    names = [
        "Google/Chrome",
        "Google/Chrome Beta",
        "Google/Chrome Dev",
        "Google/Chrome Canary",
        "Chromium",
        "Microsoft Edge",
        "Microsoft Edge Beta",
        "Microsoft Edge Dev",
        "Microsoft Edge Canary",
        "BraveSoftware/Brave-Browser",
        "BraveSoftware/Brave-Browser-Beta",
        "BraveSoftware/Brave-Browser-Nightly",
    ]
    return [f"{support}/{name}" for name in names]


def _windows_defaults(local_app_data: str) -> list[str]:
    names = [
        r"Google\Chrome\User Data",
        r"Google\Chrome Beta\User Data",
        r"Google\Chrome Dev\User Data",
        r"Google\Chrome SxS\User Data",
        r"Chromium\User Data",
        r"Microsoft\Edge\User Data",
        r"Microsoft\Edge Beta\User Data",
        r"Microsoft\Edge Dev\User Data",
        r"Microsoft\Edge SxS\User Data",
        r"BraveSoftware\Brave-Browser\User Data",
        r"BraveSoftware\Brave-Browser-Beta\User Data",
        r"BraveSoftware\Brave-Browser-Nightly\User Data",
    ]
    return [f"{local_app_data}\\{name}" for name in names]


def _linux_defaults(home: str, config_home: str) -> list[str]:
    names = [
        "google-chrome",
        "google-chrome-beta",
        "google-chrome-unstable",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
        "microsoft-edge-beta",
        "microsoft-edge-dev",
        "BraveSoftware/Brave-Browser",
        "BraveSoftware/Brave-Browser-Beta",
        "BraveSoftware/Brave-Browser-Nightly",
    ]
    out = [f"{config_home}/{name}" for name in names]
    out += [
        f"{home}/snap/chromium/common/chromium",
        f"{home}/.var/app/com.google.Chrome/config/google-chrome",
        f"{home}/.var/app/org.chromium.Chromium/config/chromium",
        f"{home}/.var/app/com.microsoft.Edge/config/microsoft-edge",
        f"{home}/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser",
    ]
    return out


def current_os_style() -> OsStyle:
    if sys.platform == "win32":
        return "win32"
    if sys.platform == "darwin":
        return "darwin"
    return "linux"


def default_browser_data_dirs(
    os_style: OsStyle | None = None,
    *,
    home: str | None = None,
    env: Mapping[str, str] | None = None,
) -> list[str]:
    """Known default user-data directories of Chrome / Edge / Chromium / Brave."""
    style = os_style or current_os_style()
    environ = os.environ if env is None else env
    if style == "win32":
        local = environ.get("LOCALAPPDATA") or (
            f"{home or environ.get('USERPROFILE') or 'C:/Users/Default'}\\AppData\\Local"
        )
        return _windows_defaults(local)
    home_dir = home or environ.get("HOME") or str(Path.home())
    if style == "darwin":
        return _mac_defaults(home_dir)
    config_home = environ.get("XDG_CONFIG_HOME") or f"{home_dir}/.config"
    return _linux_defaults(home_dir, config_home)


def _pure(path: str, style: OsStyle) -> PurePath:
    if style == "win32":
        return PureWindowsPath(ntpath.normpath(path.replace("/", "\\")))
    return PurePosixPath(posixpath.normpath(path))


def _key(path: PurePath, style: OsStyle) -> tuple[str, ...]:
    parts = path.parts
    if style == "win32":
        return tuple(part.casefold().rstrip("\\") for part in parts)
    if style == "darwin":  # APFS is case-insensitive by default
        return tuple(part.casefold() for part in parts)
    return tuple(parts)


def is_default_profile_path(
    path: str | os.PathLike[str],
    *,
    os_style: OsStyle | None = None,
    home: str | None = None,
    env: Mapping[str, str] | None = None,
) -> bool:
    """True when `path` is (or lies inside) a browser's default user-data directory."""
    style = os_style or current_os_style()
    raw = os.fspath(path)
    if style == current_os_style():
        with contextlib.suppress(OSError):
            raw = os.path.realpath(raw)
    candidate = _key(_pure(raw, style), style)
    for default in default_browser_data_dirs(style, home=home, env=env):
        default_key = _key(_pure(default, style), style)
        if candidate[: len(default_key)] == default_key:
            return True
    return False


def refuse_default_profile(path: str | os.PathLike[str]) -> None:
    if is_default_profile_path(path):
        raise DefaultProfileRefusedError(
            "Refusing to automate a browser's default profile "
            f"({os.fspath(path)}): pilih-jobs only uses its own profiles under "
            "browser-profiles/ (18 §4.3).",
        )


# ------------------------------------------------------------------ locking (18 §4.2)
@dataclass(frozen=True)
class LockInfo:
    pid: int
    hostname: str
    started_at: int
    task_id: str | None
    boot_time: float | None

    def to_json(self) -> dict[str, Any]:
        return {
            "pid": self.pid,
            "hostname": self.hostname,
            "started_at": self.started_at,
            "task_id": self.task_id,
            "boot_time": self.boot_time,
        }


def _boot_time() -> float | None:
    try:
        return float(psutil.boot_time())
    except (OSError, RuntimeError):
        return None


def read_lock(profile_dir: Path) -> LockInfo | None:
    try:
        data = json.loads((profile_dir / LOCK_FILE).read_text("utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    obj = cast(dict[str, Any], data)
    try:
        return LockInfo(
            pid=int(obj.get("pid") or 0),
            hostname=str(obj.get("hostname") or ""),
            started_at=int(obj.get("started_at") or 0),
            task_id=cast(str | None, obj.get("task_id")),
            boot_time=float(obj["boot_time"]) if obj.get("boot_time") is not None else None,
        )
    except (TypeError, ValueError):
        return None


def lock_is_stale(info: LockInfo | None) -> bool:
    """A lock is stale when its pid is gone (same host) or the machine rebooted since."""
    if info is None:
        return True
    if info.hostname and info.hostname != socket.gethostname():
        return False  # another machine (shared drive): never second-guess it
    current_boot = _boot_time()
    rebooted = (
        info.boot_time is not None
        and current_boot is not None
        and abs(current_boot - info.boot_time) > 2.0
    )
    if rebooted:
        return True
    return info.pid <= 0 or not psutil.pid_exists(info.pid)


def chromium_singleton_present(profile_dir: Path) -> bool:
    """Chromium's `SingletonLock` (POSIX symlink) or `lockfile` (Windows) is present."""
    return any(os.path.lexists(profile_dir / name) for name in ("SingletonLock", "lockfile"))


def _singleton_owner(profile_dir: Path) -> tuple[str, int] | None:
    """`(hostname, pid)` of a POSIX SingletonLock symlink (`host-pid`), if readable."""
    try:
        target = str((profile_dir / "SingletonLock").readlink())
    except OSError:
        return None
    host, _, pid = target.rpartition("-")
    try:
        return host, int(pid)
    except ValueError:
        return None


@dataclass
class LockState:
    our_lock: LockInfo | None
    our_lock_stale: bool
    chromium_singleton: bool
    singleton_owner: tuple[str, int] | None = None

    @property
    def locked(self) -> bool:
        if self.our_lock is not None and not self.our_lock_stale:
            return True
        return self.chromium_singleton

    def to_json(self) -> dict[str, Any]:
        return {
            "locked": self.locked,
            "pilih_jobs_lock": self.our_lock.to_json() if self.our_lock else None,
            "pilih_jobs_lock_stale": self.our_lock_stale if self.our_lock else None,
            "chromium_singleton": self.chromium_singleton,
        }


def inspect_lock(profile_dir: Path) -> LockState:
    info = read_lock(profile_dir)
    return LockState(
        our_lock=info,
        our_lock_stale=lock_is_stale(info) if info else False,
        chromium_singleton=chromium_singleton_present(profile_dir),
        singleton_owner=_singleton_owner(profile_dir),
    )


class ProfileLock:
    """`<profile>/.pilih-jobs.lock`, created with O_CREAT|O_EXCL (msvcrt lock on Windows)."""

    def __init__(self, profile_dir: Path, *, name: str | None = None, task_id: str | None = None):
        self.profile_dir = profile_dir
        self.name = name or profile_dir.name
        self.task_id = task_id
        self._fd: int | None = None
        self._info: LockInfo | None = None

    @property
    def path(self) -> Path:
        return self.profile_dir / LOCK_FILE

    @property
    def held(self) -> bool:
        return self._fd is not None

    def _locked_error(self, message: str, **details: Any) -> ProfileLockedError:
        return ProfileLockedError(
            message,
            details={"profile": self.name, **details},
            hint=f"pilih-jobs browser profiles unlock {self.name}",
        )

    def acquire(self) -> None:
        if self.held:
            return
        ensure_private_dir(self.profile_dir)
        for _attempt in range(2):
            existing = read_lock(self.profile_dir) if self.path.exists() else None
            ours_absent_or_stale = existing is None or lock_is_stale(existing)
            if ours_absent_or_stale and chromium_singleton_present(self.profile_dir):
                raise self._locked_error(
                    f"Close the browser window using profile {self.name}, then retry.",
                    reason="chromium_singleton",
                )
            if existing is not None and not lock_is_stale(existing):
                raise self._locked_error(
                    f"Profile {self.name} is in use by pilih-jobs (pid {existing.pid}"
                    + (f", task {existing.task_id}" if existing.task_id else "")
                    + ").",
                    reason="pilih_jobs_lock",
                    pid=existing.pid,
                )
            if existing is not None or self.path.exists():
                with contextlib.suppress(FileNotFoundError):
                    self.path.unlink()  # our own stale lock (never Chromium's)
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                continue
            info = LockInfo(
                pid=os.getpid(),
                hostname=socket.gethostname(),
                started_at=int(time.time() * 1000),
                task_id=self.task_id,
                boot_time=_boot_time(),
            )
            os.write(fd, json.dumps(info.to_json()).encode("utf-8"))
            os.fsync(fd)
            if os.name == "nt":  # pragma: no cover - exercised on the Windows CI runner
                import msvcrt

                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)  # type: ignore[attr-defined]
            self._fd = fd
            self._info = info
            return
        raise self._locked_error(f"Profile {self.name} is locked.", reason="race")

    def release(self) -> None:
        fd, self._fd = self._fd, None
        if fd is None:
            return
        with contextlib.suppress(OSError):
            os.close(fd)
        current = read_lock(self.profile_dir)
        if current is not None and self._info is not None and current.pid == self._info.pid:
            with contextlib.suppress(FileNotFoundError):
                self.path.unlink()
        self._info = None

    def __enter__(self) -> ProfileLock:
        self.acquire()
        return self

    def __exit__(self, *exc: object) -> None:
        self.release()


def chromium_processes_using(profile_dir: Path) -> list[int]:
    """PIDs of browser processes whose command line names this `--user-data-dir`."""
    target = os.path.realpath(profile_dir)
    pids: list[int] = []
    for proc in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmdline = cast(list[str] | None, proc.info.get("cmdline")) or []
        except (psutil.Error, OSError):
            continue
        for arg in cmdline:
            if not arg.startswith("--user-data-dir="):
                continue
            value = arg.split("=", 1)[1].strip('"')
            with contextlib.suppress(OSError):
                if value and os.path.realpath(value) == target:
                    pids.append(int(cast(int, proc.info.get("pid"))))
    return pids


def unlock_profile(profile_dir: Path, *, name: str) -> list[str]:
    """Remove stale Chromium singleton files and our stale lock (after user confirmation).

    Refuses while any process has this `--user-data-dir` on its command line, or while a
    live pilih-jobs process holds the lock (18 §4.2 step 3).
    """
    if not profile_dir.is_dir():
        raise ProfileNotFoundError(f"No profile named {name}.")
    pids = chromium_processes_using(profile_dir)
    if pids:
        raise ProfileLockedError(
            f"A browser process (pid {', '.join(map(str, pids))}) still uses profile {name}; "
            "close it first.",
            details={"profile": name, "pids": pids},
        )
    info = read_lock(profile_dir)
    if info is not None and not lock_is_stale(info):
        raise ProfileLockedError(
            f"pilih-jobs (pid {info.pid}) is using profile {name}.",
            details={"profile": name, "pid": info.pid},
        )
    removed: list[str] = []
    for marker in (*CHROMIUM_SINGLETONS, LOCK_FILE):
        path = profile_dir / marker
        if os.path.lexists(path):
            with contextlib.suppress(FileNotFoundError):
                path.unlink()
                removed.append(marker)
    return removed


# ------------------------------------------------------------------ readiness (18 §3.3)
def _major(version: str | None) -> int | None:
    if not version:
        return None
    match = re.match(r"\s*(\d+)", version)
    return int(match.group(1)) if match else None


def profile_last_version(profile_dir: Path) -> str | None:
    """`Last Version` at the profile root (written by headed Chromium)."""
    try:
        return (profile_dir / "Last Version").read_text("utf-8").strip() or None
    except OSError:
        return None


def check_profile_version(profile_dir: Path, browser_version: str | None, *, name: str) -> None:
    """Refuse a profile last written by a newer Chromium major (a downgrade corrupts it)."""
    last, current = _major(profile_last_version(profile_dir)), _major(browser_version)
    if last is not None and current is not None and last > current:
        raise ProfileNewerThanBrowserError(
            f"Profile {name} was last opened by Chromium {last}, newer than the installed "
            f"{current}; update the browser (`pilih-jobs browser install`) before using it.",
            details={"profile": name, "profile_major": last, "browser_major": current},
        )


def check_profile_ready(
    profile_dir: Path, *, name: str, browser_version: str | None, must_exist: bool
) -> None:
    """Mode C readiness: the directory exists, is not locked, and is not too new."""
    if must_exist and not profile_dir.is_dir():
        raise ProfileNotFoundError(
            f"Profile {name} does not exist; prepare it with `pilih-jobs browser login {name}`.",
            details={"profile": name},
        )
    state = inspect_lock(profile_dir)
    if state.locked:
        raise ProfileLockedError(
            f"Close the browser window using profile {name}, then retry.",
            details={"profile": name, **state.to_json()},
            hint=f"pilih-jobs browser profiles unlock {name}",
        )
    check_profile_version(profile_dir, browser_version, name=name)


# ------------------------------------------------------------------ store
@dataclass
class ProfileMeta:
    name: str
    created_at: int
    purpose: Purpose
    domains_hint: list[str] = field(default_factory=lambda: [])
    channel: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "created_at": self.created_at,
            "purpose": self.purpose,
            "domains_hint": list(self.domains_hint),
            "channel": self.channel,
        }


class ProfileStore:
    """`<data>/browser-profiles/<dir>/` + `<data>/profiles/<dir>.json` (18 §3.3, §4.1)."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir

    @property
    def root(self) -> Path:
        return self.data_dir / "browser-profiles"

    @property
    def meta_root(self) -> Path:
        return self.data_dir / "profiles"

    def dir_for(self, dir_name: str) -> Path:
        path = self.root / validate_profile_name(dir_name)
        refuse_default_profile(path)
        return path

    def meta_path(self, dir_name: str) -> Path:
        return self.meta_root / f"{validate_profile_name(dir_name)}.json"

    def resolve(self, name: str) -> str:
        """User-facing name → directory name (`discovery` stays, others become apply-*)."""
        text = validate_profile_name(name)
        if text == DISCOVERY_PROFILE:
            return text
        return apply_profile_name(text)

    def read_meta(self, dir_name: str) -> ProfileMeta | None:
        try:
            data = cast(dict[str, Any], json.loads(self.meta_path(dir_name).read_text("utf-8")))
        except (OSError, ValueError):
            return None
        hints = cast(list[Any], data.get("domains_hint") or [])
        purpose = "discovery" if data.get("purpose") == "discovery" else "apply"
        return ProfileMeta(
            name=str(data.get("name") or dir_name),
            created_at=int(data.get("created_at") or 0),
            purpose=purpose,
            domains_hint=[str(h) for h in hints],
            channel=cast(str | None, data.get("channel")),
        )

    def write_meta(self, dir_name: str, meta: ProfileMeta) -> Path:
        ensure_private_dir(self.meta_root)
        path = self.meta_path(dir_name)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(meta.to_json(), indent=2) + "\n", encoding="utf-8")
        if os.name == "posix":
            tmp.chmod(0o600)
        tmp.replace(path)
        return path

    def create(
        self,
        name: str,
        *,
        domains_hint: Iterable[str] = (),
        channel: str | None = None,
    ) -> tuple[str, ProfileMeta]:
        dir_name = self.resolve(name)
        path = self.dir_for(dir_name)
        ensure_private_dir(self.root)
        ensure_private_dir(path)
        existing = self.read_meta(dir_name)
        meta = ProfileMeta(
            name=name.strip().lower(),
            created_at=existing.created_at if existing else int(time.time() * 1000),
            purpose=profile_purpose(dir_name),
            domains_hint=sorted({d.strip().lower() for d in domains_hint if d.strip()})
            or (existing.domains_hint if existing else []),
            channel=channel if channel is not None else (existing.channel if existing else None),
        )
        self.write_meta(dir_name, meta)
        return dir_name, meta

    def ensure(self, dir_name: str) -> Path:
        path = self.dir_for(dir_name)
        ensure_private_dir(self.root)
        return ensure_private_dir(path)

    def list(self) -> list[dict[str, Any]]:
        names: set[str] = set()
        if self.root.is_dir():
            names |= {p.name for p in self.root.iterdir() if p.is_dir() and _NAME_RE.match(p.name)}
        if self.meta_root.is_dir():
            names |= {p.stem for p in self.meta_root.glob("*.json") if _NAME_RE.match(p.stem)}
        out: list[dict[str, Any]] = []
        for dir_name in sorted(names):
            path = self.root / dir_name
            meta = self.read_meta(dir_name)
            out.append(
                {
                    "profile": dir_name,
                    "name": meta.name if meta else dir_name,
                    "purpose": meta.purpose if meta else profile_purpose(dir_name),
                    "exists": path.is_dir(),
                    "domains_hint": meta.domains_hint if meta else [],
                    "channel": meta.channel if meta else None,
                    "created_at": meta.created_at if meta else None,
                    "last_version": profile_last_version(path),
                    **(inspect_lock(path).to_json() if path.is_dir() else {"locked": False}),
                }
            )
        return out

    def delete(self, name: str) -> bool:
        dir_name = self.resolve(name)
        path = self.root / dir_name
        if path.is_dir():
            state = inspect_lock(path)
            if state.locked:
                raise ProfileLockedError(
                    f"Profile {dir_name} is in use; close its browser first.",
                    details={"profile": dir_name, **state.to_json()},
                )
        existed = path.is_dir() or self.meta_path(dir_name).exists()
        if path.is_dir():
            shutil.rmtree(path)
        with contextlib.suppress(FileNotFoundError):
            self.meta_path(dir_name).unlink()
        return existed

    def reset(self, name: str) -> bool:
        """Wipe a profile's browser data, keeping its metadata (`profiles reset discovery`)."""
        dir_name = self.resolve(name)
        path = self.root / dir_name
        if not path.is_dir():
            return False
        state = inspect_lock(path)
        if state.locked:
            raise ProfileLockedError(
                f"Profile {dir_name} is in use; close its browser first.",
                details={"profile": dir_name, **state.to_json()},
            )
        shutil.rmtree(path)
        ensure_private_dir(path)
        return True
