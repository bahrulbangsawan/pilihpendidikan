"""Change-feed pull and snapshots (20 §4).

`pull()` reads `GET /api/v1/changes?cursor=<sync_state.cursor>&limit=500` until
`has_more` is false. Each page is applied to `entity_cache` and the cursor advanced in
**one** local transaction (the acknowledged checkpoint). `410 cursor_expired` triggers
`snapshot()` automatically: `GET /api/v1/snapshot` replaces the cached entities and stores
the snapshot's cursor, then pulling resumes from it; cached data is never trusted across
a 410.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Final, cast

from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import ApiNotFoundError
from pilih_jobs.contracts import ids
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.cache import SNAPSHOT_ENTITY, apply_change, entity_id_of, revision_of

PAGE_LIMIT: Final = 500
MAX_PAGES: Final = 10_000


@dataclass
class PullReport:
    pulled: int = 0
    applied: int = 0
    pages: int = 0
    cursor: int = 0
    snapshot: bool = False


class ChangeFeedPuller:
    def __init__(
        self, db: StateDB, issuer: str, api: ApiClient, *, now: Callable[[], int] = ids.now_ms
    ) -> None:
        self.db = db
        self.issuer = issuer
        self.api = api
        self._now = now
        self.db.execute("INSERT OR IGNORE INTO sync_state(issuer) VALUES(?)", (issuer,))

    def cursor(self) -> int:
        row = self.db.query_one("SELECT cursor FROM sync_state WHERE issuer = ?", (self.issuer,))
        return 0 if row is None else int(row["cursor"])

    def state(self) -> dict[str, Any]:
        row = self.db.query_one("SELECT * FROM sync_state WHERE issuer = ?", (self.issuer,))
        return {} if row is None else {k: row[k] for k in row.keys()}  # noqa: SIM118 - sqlite3.Row

    def reset(self) -> None:
        self.db.execute("UPDATE sync_state SET cursor = 0 WHERE issuer = ?", (self.issuer,))

    def apply_page(self, changes: Sequence[dict[str, Any]], next_cursor: int) -> int:
        """Apply one page and advance the cursor atomically; returns rows changed."""
        applied = 0
        fetched_at = self._now()
        with self.db.transaction() as conn:
            for change in changes:
                applied += int(
                    apply_change(
                        conn,
                        issuer=self.issuer,
                        entity=str(change["entity"]),
                        entity_id=str(change["entity_id"]),
                        revision=int(change["revision"]),
                        op=str(change["op"]),
                        data=change.get("data"),
                        fetched_at=fetched_at,
                    )
                )
            conn.execute(
                "UPDATE sync_state SET cursor = MAX(cursor, ?), last_pull_at = ? WHERE issuer = ?",
                (next_cursor, fetched_at, self.issuer),
            )
        return applied

    async def pull(self, *, entities: Sequence[str] | None = None) -> PullReport:
        report = PullReport(cursor=self.cursor())
        for _ in range(MAX_PAGES):
            params: dict[str, Any] = {"cursor": report.cursor, "limit": PAGE_LIMIT}
            if entities:
                params["entities"] = ",".join(entities)
            try:
                page = cast(dict[str, Any], await self.api.get("/api/v1/changes", params))
            except ApiNotFoundError as exc:
                if exc.error != "cursor_expired" or report.snapshot:
                    raise
                report.cursor = await self.snapshot()
                report.snapshot = True
                continue
            changes = cast(list[dict[str, Any]], page.get("changes") or [])
            next_cursor = int(page.get("next_cursor", report.cursor))
            report.applied += self.apply_page(changes, next_cursor)
            report.pulled += len(changes)
            report.pages += 1
            report.cursor = max(report.cursor, next_cursor)
            if not page.get("has_more"):
                break
        return report

    async def snapshot(self, collections: Sequence[str] | None = None) -> int:
        """Replace the cached entities with a full snapshot; returns its cursor."""
        params = {"entities": ",".join(collections)} if collections else None
        body = cast(dict[str, Any], await self.api.get("/api/v1/snapshot", params))
        cursor = int(body["cursor"])
        fetched_at = self._now()
        present = [name for name in SNAPSHOT_ENTITY if name in body]
        with self.db.transaction() as conn:
            for collection in present:
                entity = SNAPSHOT_ENTITY[collection]
                conn.execute(
                    "DELETE FROM entity_cache WHERE issuer = ? AND entity = ?",
                    (self.issuer, entity),
                )
                value = body[collection]
                rows = cast(list[dict[str, Any]], value if isinstance(value, list) else [value])
                for row in rows:
                    if not isinstance(row, dict):  # pyright: ignore[reportUnnecessaryIsInstance]
                        continue
                    apply_change(
                        conn,
                        issuer=self.issuer,
                        entity=entity,
                        entity_id=entity_id_of(entity, row),
                        revision=revision_of(row),
                        op="upsert",
                        data=row,
                        fetched_at=fetched_at,
                    )
            conn.execute(
                "UPDATE sync_state SET cursor = ?, last_full_sync_at = ?, last_pull_at = ? "
                "WHERE issuer = ?",
                (cursor, fetched_at, fetched_at, self.issuer),
            )
        return cursor
