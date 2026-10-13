"""The worker's `SyncLoop` (16 §7): flush the outbox every 10 s or right after an enqueue
(`kick()`), pull the change feed every 60 s, and count consecutive failures for the
backpressure rule (no claims after 3 failed syncs in a row)."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable

from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import ApiError, NetworkError
from pilih_jobs.contracts import ids
from pilih_jobs.errors import NotAuthenticatedError, PilihError, UpgradeRequiredError
from pilih_jobs.logging import get_logger, log_event
from pilih_jobs.paths import Paths
from pilih_jobs.storage.db import StateDB
from pilih_jobs.storage.locks import FileLock
from pilih_jobs.sync.engine import SyncEngine
from pilih_jobs.sync.flusher import FlushReport
from pilih_jobs.tasks.constants import SYNC_FLUSH_S, SYNC_PULL_S
from pilih_jobs.tasks.hooks import convert_dead_results, task_hooks
from pilih_jobs.tasks.lease import mono_ms

_log = get_logger("tasks.sync")


class SyncLoop:
    def __init__(
        self,
        db: StateDB,
        issuer: str,
        api: ApiClient,
        *,
        paths: Paths,
        state_lock: FileLock | None = None,
        flush_s: float = SYNC_FLUSH_S,
        pull_s: float = SYNC_PULL_S,
        monotonic: Callable[[], int] = mono_ms,
    ) -> None:
        self.db = db
        self.issuer = issuer
        self.engine = SyncEngine(
            db,
            issuer,
            api,
            state_lock=state_lock,
            hooks=task_hooks(db, issuer),
            upload_root=paths.data_dir,
        )
        self.flush_s = flush_s
        self.pull_s = pull_s
        self._mono = monotonic
        self._kicked = asyncio.Event()
        self.consecutive_failures = 0
        self.last_success_at: int | None = None
        self.last_pull_mono: int | None = None
        self.fatal: PilihError | None = None

    def kick(self) -> None:
        """Flush as soon as possible (called after every enqueue)."""
        self._kicked.set()

    async def flush_once(self) -> FlushReport | None:
        """Push the outbox once; updates the failure counter. Never raises network errors."""
        try:
            report = await self.engine.push()
        except (NetworkError, ApiError) as exc:
            self.consecutive_failures += 1
            log_event(_log, "sync_failed", "outbox flush failed", level=30, error=str(exc))
            return None
        if report.paused in ("auth", "upgrade"):
            message = report.pause_message or "sync paused"
            self.fatal = (
                UpgradeRequiredError(message, hint="pilih-jobs update")
                if report.paused == "upgrade"
                else NotAuthenticatedError(message)
            )
            self.consecutive_failures += 1
            return report
        if report.retried and not report.done:
            self.consecutive_failures += 1
        else:
            self.consecutive_failures = 0
            self.last_success_at = ids.now_ms()
        if report.dead:
            convert_dead_results(self.db, self.issuer)
        return report

    async def pull_once(self) -> bool:
        try:
            await self.engine.pull()
        except (NetworkError, ApiError) as exc:
            log_event(_log, "pull_failed", "change feed pull failed", level=30, error=str(exc))
            return False
        self.last_pull_mono = self._mono()
        return True

    def pull_due(self) -> bool:
        return self.last_pull_mono is None or (
            self._mono() - self.last_pull_mono >= self.pull_s * 1000
        )

    async def run(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            await self.flush_once()
            if self.fatal is not None:
                return
            if self.pull_due():
                await self.pull_once()
            self._kicked.clear()
            waiters = [
                asyncio.ensure_future(self._kicked.wait()),
                asyncio.ensure_future(stop.wait()),
            ]
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(
                    asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED), self.flush_s
                )
            for waiter in waiters:
                waiter.cancel()
        await self.flush_once()
