"""Cross-process advisory file locks: `state.lock`, `auth.lock`, `worker.lock`.

POSIX uses `fcntl.flock`; Windows uses `msvcrt.locking` on the first byte. The OS
releases the lock when the process dies, so a crash never leaves a stale lock. A lock
object is also an in-process mutex (a second `acquire` from another thread waits).
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import threading
import time
from collections.abc import AsyncGenerator, Generator
from pathlib import Path
from types import TracebackType

from pilih_jobs.paths import ensure_private_dir

if os.name == "nt":  # pragma: no cover - exercised on the Windows CI runner
    import msvcrt

    def _try_lock(fd: int) -> bool:
        try:
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)  # type: ignore[attr-defined]
        except OSError:
            return False
        return True

    def _unlock(fd: int) -> None:
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)  # type: ignore[attr-defined]

else:
    import fcntl

    def _try_lock(fd: int) -> bool:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        return True

    def _unlock(fd: int) -> None:
        fcntl.flock(fd, fcntl.LOCK_UN)


class LockTimeoutError(TimeoutError):
    """The lock was not acquired within the timeout."""


class FileLock:
    """An exclusive advisory lock on `path` (created 0600 if missing)."""

    def __init__(self, path: Path, *, poll_interval: float = 0.05) -> None:
        self.path = path
        self.poll_interval = poll_interval
        self._fd: int | None = None
        self._thread_lock = threading.Lock()

    @property
    def held(self) -> bool:
        return self._fd is not None

    def _open(self) -> int:
        ensure_private_dir(self.path.parent)
        return os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)

    def try_acquire(self) -> bool:
        if not self._thread_lock.acquire(blocking=False):
            return False
        fd = self._open()
        if _try_lock(fd):
            self._fd = fd
            return True
        os.close(fd)
        self._thread_lock.release()
        return False

    def acquire(self, timeout: float | None = None) -> None:
        deadline = None if timeout is None else time.monotonic() + timeout
        while not self.try_acquire():
            if deadline is not None and time.monotonic() >= deadline:
                raise LockTimeoutError(f"timed out waiting for {self.path.name}")
            time.sleep(self.poll_interval)

    async def acquire_async(self, timeout: float | None = None) -> None:
        deadline = None if timeout is None else time.monotonic() + timeout
        while not self.try_acquire():
            if deadline is not None and time.monotonic() >= deadline:
                raise LockTimeoutError(f"timed out waiting for {self.path.name}")
            await asyncio.sleep(self.poll_interval)

    def release(self) -> None:
        fd, self._fd = self._fd, None
        if fd is None:
            return
        try:
            _unlock(fd)
        finally:
            os.close(fd)
            self._thread_lock.release()

    def write_owner(self, text: str) -> None:
        """Record who holds the lock (e.g. the worker PID) inside the lock file."""
        if self._fd is None:
            raise RuntimeError("lock not held")
        os.ftruncate(self._fd, 0)
        os.lseek(self._fd, 0, os.SEEK_SET)
        os.write(self._fd, text.encode("utf-8"))

    def is_locked_elsewhere(self) -> bool:
        """True when another process holds the lock (probes without keeping it)."""
        if self.held:
            return False
        if self.try_acquire():
            self.release()
            return False
        return True

    def __enter__(self) -> FileLock:
        self.acquire()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.release()

    @contextlib.contextmanager
    def hold(self, timeout: float | None = None) -> Generator[FileLock]:
        self.acquire(timeout)
        try:
            yield self
        finally:
            self.release()

    @contextlib.asynccontextmanager
    async def hold_async(self, timeout: float | None = None) -> AsyncGenerator[FileLock]:
        await self.acquire_async(timeout)
        try:
            yield self
        finally:
            self.release()
