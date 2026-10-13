"""Local locks (16 §7, 21 §9): one worker per device, one driver per application.

- `<data>/worker.lock` — held by the running worker for its lifetime; the owner record
  (`{pid, started_at, ipc}`) is written into the lock file so `worker status/stop` and an
  interactive `apply` can find it. The OS drops the lock when the process dies.
- `<data>/locks/app_<id>.lock` — taken by whoever drives an application in a browser (the
  worker or an interactive `apply`), so two processes never act on the same application.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from pilih_jobs.contracts import ids
from pilih_jobs.paths import Paths, _safe_component  # pyright: ignore[reportPrivateUsage]
from pilih_jobs.storage.locks import FileLock
from pilih_jobs.tasks.errors import AlreadyRunningError


def locks_dir(paths: Paths) -> Path:
    return paths.data_dir / "locks"


def app_lock_path(paths: Paths, application_id: str) -> Path:
    return locks_dir(paths) / f"app_{_safe_component(application_id, 'application id')}.lock"


def acquire_app_lock(paths: Paths, application_id: str) -> FileLock:
    """Take the application lock or raise `AlreadyRunningError` (21 §16 test 12)."""
    lock = FileLock(app_lock_path(paths, application_id))
    if not lock.try_acquire():
        raise AlreadyRunningError(
            f"An apply for {application_id} is already running on this machine.",
            details={"application_id": application_id},
            hint="wait for it to finish, or stop it with Ctrl+C in its terminal",
        )
    lock.write_owner(json.dumps({"pid": os.getpid(), "at": ids.now_ms()}))
    return lock


@dataclass(frozen=True)
class WorkerInfo:
    pid: int | None
    started_at: int | None
    ipc: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {"pid": self.pid, "started_at": self.started_at, "ipc": self.ipc}


def worker_lock(paths: Paths) -> FileLock:
    return FileLock(paths.worker_lock)


def acquire_worker_lock(paths: Paths, owner: dict[str, Any]) -> FileLock:
    lock = worker_lock(paths)
    if not lock.try_acquire():
        info = read_worker_info(paths)
        pid = info.pid if info is not None else None
        raise AlreadyRunningError(
            "A worker is already running on this device" + (f" (pid {pid})." if pid else "."),
            details={"pid": pid},
            hint="pilih-jobs worker status",
        )
    lock.write_owner(json.dumps(owner, separators=(",", ":")))
    return lock


def read_worker_info(paths: Paths) -> WorkerInfo | None:
    """The owner record in `worker.lock` (may be stale when no worker holds the lock)."""
    try:
        text = paths.worker_lock.read_text("utf-8")
    except OSError:
        return None
    try:
        data: Any = json.loads(text) if text.strip() else {}
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    record = cast(dict[str, Any], data)
    pid = record.get("pid")
    started = record.get("started_at")
    ipc = record.get("ipc")
    return WorkerInfo(
        pid=pid if isinstance(pid, int) else None,
        started_at=started if isinstance(started, int) else None,
        ipc=cast(dict[str, Any], ipc) if isinstance(ipc, dict) else {},
    )


def worker_running(paths: Paths) -> WorkerInfo | None:
    """The running worker's owner record, or None when no process holds `worker.lock`."""
    if not paths.worker_lock.exists():
        return None
    if not worker_lock(paths).is_locked_elsewhere():
        return None
    return read_worker_info(paths) or WorkerInfo(None, None, {})
