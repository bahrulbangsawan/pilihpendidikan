"""Local state layout (16 §8).

Directories come from `platformdirs` (`appname="pilih-jobs"`, `appauthor=False`):

- Config: macOS `~/Library/Application Support/pilih-jobs`, Windows `%APPDATA%\\pilih-jobs`,
  Linux `~/.config/pilih-jobs`;
- Data: macOS `~/Library/Application Support/pilih-jobs`, Windows
  `%LOCALAPPDATA%\\pilih-jobs`, Linux `~/.local/share/pilih-jobs`;
- Cache: macOS `~/Library/Caches/pilih-jobs`, Windows `%LOCALAPPDATA%\\pilih-jobs\\Cache`,
  Linux `~/.cache/pilih-jobs`;
- Logs: macOS `~/Library/Logs/pilih-jobs`, Windows `%LOCALAPPDATA%\\pilih-jobs\\Logs`,
  Linux `~/.local/state/pilih-jobs/log`.

`PILIH_JOBS_HOME=<dir>` relocates everything under one directory (`config/`, `data/`,
`cache/`, `logs/`, `run/`) — used by tests, containers and portable installs.
Directories are created with mode 0700 on POSIX; on Windows the per-user profile
directories already restrict access to the user.
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import platformdirs

APP_DIR_NAME: Final = "pilih-jobs"
HOME_ENV: Final = "PILIH_JOBS_HOME"
CONFIG_ENV: Final = "PILIH_JOBS_CONFIG"

_SAFE_COMPONENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")


def _safe_component(value: str, what: str) -> str:
    """Refuse ids/names that could escape their directory (`..`, separators)."""
    if not _SAFE_COMPONENT.match(value) or value in {".", ".."}:
        raise ValueError(f"unsafe {what}: {value!r}")
    return value


@dataclass(frozen=True)
class Paths:
    config_dir: Path
    data_dir: Path
    cache_dir: Path
    log_dir: Path
    runtime_dir: Path
    config_file: Path

    # ---------------------------------------------------------------- files
    @property
    def state_db(self) -> Path:
        return self.data_dir / "state.db"

    @property
    def state_lock(self) -> Path:
        """Serializes the outbox flusher across processes (20 §3)."""
        return self.data_dir / "state.lock"

    @property
    def auth_lock(self) -> Path:
        """Serializes token refreshes across processes (17 §7.3)."""
        return self.data_dir / "auth.lock"

    @property
    def worker_lock(self) -> Path:
        """One worker per device (16 §7)."""
        return self.data_dir / "worker.lock"

    @property
    def worker_socket(self) -> Path:
        """Local IPC endpoint of the worker (16 §7)."""
        return self.runtime_dir / "worker.sock"

    @property
    def credentials_meta(self) -> Path:
        """Non-secret account metadata (17 §12); mode 0600."""
        return self.config_dir / "credentials.json"

    @property
    def credentials_encrypted(self) -> Path:
        """Opt-in AES-GCM credential file (16 §11, 17 §12)."""
        return self.data_dir / "credentials.enc"

    @property
    def log_file(self) -> Path:
        return self.log_dir / "pilih-jobs.log"

    @property
    def telemetry_file(self) -> Path:
        return self.data_dir / "telemetry.json"

    # ---------------------------------------------------------------- dirs
    @property
    def runs_dir(self) -> Path:
        return self.data_dir / "runs"

    @property
    def browser_profiles_dir(self) -> Path:
        return self.data_dir / "browser-profiles"

    @property
    def scrapling_dir(self) -> Path:
        return self.data_dir / "scrapling"

    @property
    def crawls_dir(self) -> Path:
        return self.data_dir / "crawls"

    def run_dir(self, run_or_attempt_id: str) -> Path:
        """`<data>/runs/<run_…|att_…>/` (step log, screenshots, staging)."""
        return self.runs_dir / _safe_component(run_or_attempt_id, "run id")

    def staging_dir(self, attempt_id: str) -> Path:
        """`<data>/runs/<att_…>/staging/` — CV/cover-letter staging (11 §4.6)."""
        return self.run_dir(attempt_id) / "staging"

    def browser_profile_dir(self, name: str) -> Path:
        return self.browser_profiles_dir / _safe_component(name, "profile name")

    def crawl_dir(self, source_id: str) -> Path:
        return self.crawls_dir / _safe_component(source_id, "source id")

    def ensure(self) -> Paths:
        """Create the base directories (0700 on POSIX). Returns self."""
        for directory in (self.config_dir, self.data_dir, self.cache_dir, self.log_dir):
            ensure_private_dir(directory)
        return self


def ensure_private_dir(path: Path) -> Path:
    """`mkdir -p` with mode 0700; tightens an existing directory we own."""
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == "posix":
        try:
            if path.stat().st_uid == os.getuid():
                path.chmod(0o700)
        except OSError:
            pass
    return path


def resolve_paths(config_file: Path | str | None = None) -> Paths:
    """Paths for this process: `PILIH_JOBS_HOME` > platformdirs; `--config` wins for the file."""
    explicit = config_file or os.environ.get(CONFIG_ENV) or None
    home = os.environ.get(HOME_ENV)
    if home:
        base = Path(home).expanduser().resolve()
        paths = Paths(
            config_dir=base / "config",
            data_dir=base / "data",
            cache_dir=base / "cache",
            log_dir=base / "logs",
            runtime_dir=base / "run",
            config_file=base / "config" / "config.toml",
        )
    else:
        dirs = platformdirs.PlatformDirs(APP_DIR_NAME, appauthor=False, roaming=False)
        config_dir = Path(platformdirs.user_config_dir(APP_DIR_NAME, appauthor=False, roaming=True))
        runtime = Path(dirs.user_runtime_dir)
        if sys.platform == "win32":  # named pipes do not live on disk; keep a stable dir
            runtime = Path(dirs.user_data_dir) / "run"
        paths = Paths(
            config_dir=config_dir,
            data_dir=Path(dirs.user_data_dir),
            cache_dir=Path(dirs.user_cache_dir),
            log_dir=Path(dirs.user_log_dir),
            runtime_dir=runtime,
            config_file=config_dir / "config.toml",
        )
    if explicit:
        paths = Paths(
            config_dir=paths.config_dir,
            data_dir=paths.data_dir,
            cache_dir=paths.cache_dir,
            log_dir=paths.log_dir,
            runtime_dir=paths.runtime_dir,
            config_file=Path(explicit).expanduser().resolve(),
        )
    return paths
