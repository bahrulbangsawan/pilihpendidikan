"""`SyncEngine`: push (outbox flush) then pull (change feed) — `pilih-jobs sync` (16 §3.3).

The worker loop (leaf 4.4) calls `sync()` every 10 s / after enqueue and pulls every
60 s; commands that read cloud state call `pull()` first (20 §4.1).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pilih_jobs.api.client import ApiClient
from pilih_jobs.contracts import ids
from pilih_jobs.storage.db import StateDB
from pilih_jobs.storage.locks import FileLock
from pilih_jobs.sync.flusher import FlushHooks, FlushReport, OutboxFlusher
from pilih_jobs.sync.identity import bind_account, credential_user_id
from pilih_jobs.sync.outbox import Outbox
from pilih_jobs.sync.puller import ChangeFeedPuller, PullReport


@dataclass
class SyncReport:
    push: FlushReport = field(default_factory=FlushReport)
    pull: PullReport | None = None
    outbox_depth: int = 0
    cursor: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "pushed": self.push.done,
            "pulled": self.pull.pulled if self.pull else 0,
            "conflicts": self.push.conflicts,
            "dead": self.push.dead,
            "outbox_depth": self.outbox_depth,
            "cursor": self.cursor,
            "snapshot": bool(self.pull and self.pull.snapshot),
            "paused": self.push.paused,
        }


class SyncEngine:
    def __init__(
        self,
        db: StateDB,
        issuer: str,
        api: ApiClient,
        *,
        state_lock: FileLock | None = None,
        hooks: FlushHooks | None = None,
        check_identity: bool = True,
        upload_root: Path | None = None,
    ) -> None:
        self.db = db
        self.issuer = issuer
        self.api = api
        self.outbox = Outbox(db, issuer)
        self.flusher = OutboxFlusher(
            self.outbox, api, state_lock=state_lock, hooks=hooks, upload_root=upload_root
        )
        self.puller = ChangeFeedPuller(db, issuer, api)
        self._identity_ok = not check_identity

    async def ensure_identity(self) -> None:
        """Refuse to sync another user's local data (16 §14, 20 §12 F5)."""
        if self._identity_ok:
            return
        bind_account(self.db, self.issuer, await credential_user_id(self.api))
        self._identity_ok = True

    async def push(self) -> FlushReport:
        await self.ensure_identity()
        report = await self.flusher.flush()
        if report.done:
            self.db.execute(
                "UPDATE sync_state SET last_push_at = ? WHERE issuer = ?",
                (ids.now_ms(), self.issuer),
            )
        return report

    async def pull(self) -> PullReport:
        await self.ensure_identity()
        return await self.puller.pull()

    async def sync(
        self, *, push: bool = True, pull: bool = True, force: bool = False
    ) -> SyncReport:
        report = SyncReport()
        await self.ensure_identity()
        if push:
            report.push = await self.push()
        if pull and report.push.paused not in ("auth", "upgrade"):
            if force:
                await self.puller.snapshot()
            report.pull = await self.puller.pull()
        report.outbox_depth = self.outbox.depth()
        report.cursor = self.puller.cursor()
        return report

    def status(self) -> dict[str, Any]:
        return sync_status(self.db, self.issuer)


def sync_status(db: StateDB, issuer: str) -> dict[str, Any]:
    """`sync --status`: outbox counts, dead letters/conflicts and the cursor (works offline)."""
    outbox = Outbox(db, issuer)
    db.execute("INSERT OR IGNORE INTO sync_state(issuer) VALUES(?)", (issuer,))
    row = db.query_one("SELECT * FROM sync_state WHERE issuer = ?", (issuer,))
    state: dict[str, Any] = {} if row is None else {k: row[k] for k in row.keys()}  # noqa: SIM118
    return {
        "outbox": outbox.counts(),
        "outbox_depth": outbox.depth(),
        "stale_24h": outbox.stale_count(),
        "problems": [e.summary() for e in outbox.entries(["dead", "conflict"])],
        "cursor": int(state.get("cursor") or 0),
        "last_pull_at": state.get("last_pull_at"),
        "last_push_at": state.get("last_push_at"),
        "last_full_sync_at": state.get("last_full_sync_at"),
    }
