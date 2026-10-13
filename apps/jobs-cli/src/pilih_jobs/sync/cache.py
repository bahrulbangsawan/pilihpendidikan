"""Entity cache (20 §3 `entity_cache`, §4.1).

Changes are applied keeping the **higher** revision: an out-of-order or duplicated
change with a lower revision is ignored, a tombstone (`op = delete`) marks the row
deleted. Nothing in the cache is authoritative; `sync --force` rebuilds it.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from typing import Any, Final, cast

from pilih_jobs.storage.db import StateDB, now_ms

#: Snapshot collection (05 §11) → cache entity (`change_log.entity`).
SNAPSHOT_ENTITY: Final[dict[str, str]] = {
    "applications": "application",
    "user_jobs": "user_job",
    "postings": "posting",
    "interviews": "interview",
    "offers": "offer",
    "tasks": "task",
    "approvals": "approval",
    "rules": "rule",
    "sources": "source",
    "facts": "fact",
    "answers": "answer",
    "cv_variants": "cv_variant",
    "settings": "settings",
}


def apply_change(
    conn: sqlite3.Connection,
    *,
    issuer: str,
    entity: str,
    entity_id: str,
    revision: int,
    op: str,
    data: Any,
    fetched_at: int,
) -> bool:
    """Apply one change inside the caller's transaction; True when the cache changed."""
    row = conn.execute(
        "SELECT revision, deleted, data FROM entity_cache WHERE issuer = ? AND entity = ? AND "
        "entity_id = ?",
        (issuer, entity, entity_id),
    ).fetchone()
    deleting = op == "delete"
    if row is not None:
        current = int(row["revision"])
        if revision < current:
            return False
        if revision == current and not (deleting and not row["deleted"]):
            return False
    if deleting:
        previous = str(row["data"]) if row is not None else "{}"
        payload, deleted = previous, 1
    else:
        payload, deleted = json.dumps(data if data is not None else {}, separators=(",", ":")), 0
    conn.execute(
        "INSERT INTO entity_cache(issuer, entity, entity_id, revision, data, deleted, fetched_at) "
        "VALUES(?,?,?,?,?,?,?) ON CONFLICT(issuer, entity, entity_id) DO UPDATE SET "
        "revision = excluded.revision, data = excluded.data, deleted = excluded.deleted, "
        "fetched_at = excluded.fetched_at",
        (issuer, entity, entity_id, revision, payload, deleted, fetched_at),
    )
    return True


def entity_id_of(entity: str, data: dict[str, Any]) -> str:
    if entity == "settings":
        return str(data.get("user_id") or "settings")
    return str(data["id"])


def revision_of(data: dict[str, Any]) -> int:
    value = data.get("revision")
    return int(value) if isinstance(value, int) else 0


class EntityCache:
    def __init__(self, db: StateDB, issuer: str) -> None:
        self.db = db
        self.issuer = issuer

    def put(self, entity: str, data: dict[str, Any], *, revision: int | None = None) -> bool:
        """Read-through store of an API representation (keeps the higher revision)."""
        with self.db.transaction() as conn:
            return apply_change(
                conn,
                issuer=self.issuer,
                entity=entity,
                entity_id=entity_id_of(entity, data),
                revision=revision_of(data) if revision is None else revision,
                op="upsert",
                data=data,
                fetched_at=now_ms(),
            )

    def get(
        self, entity: str, entity_id: str, *, include_deleted: bool = False
    ) -> dict[str, Any] | None:
        row = self.db.query_one(
            "SELECT data, deleted FROM entity_cache WHERE issuer = ? AND entity = ? "
            "AND entity_id = ?",
            (self.issuer, entity, entity_id),
        )
        if row is None or (row["deleted"] and not include_deleted):
            return None
        return cast(dict[str, Any], json.loads(str(row["data"])))

    def revision(self, entity: str, entity_id: str) -> int | None:
        row = self.db.query_one(
            "SELECT revision FROM entity_cache WHERE issuer = ? AND entity = ? AND entity_id = ?",
            (self.issuer, entity, entity_id),
        )
        return None if row is None else int(row["revision"])

    def list(
        self, entity: str, where: Callable[[dict[str, Any]], bool] | None = None
    ) -> list[dict[str, Any]]:
        rows = self.db.query(
            "SELECT data FROM entity_cache WHERE issuer = ? AND entity = ? AND deleted = 0 "
            "ORDER BY entity_id",
            (self.issuer, entity),
        )
        items = [cast(dict[str, Any], json.loads(str(r["data"]))) for r in rows]
        return [item for item in items if where is None or where(item)]

    def count(self, entity: str, where: Callable[[dict[str, Any]], bool] | None = None) -> int:
        return len(self.list(entity, where))

    def clear(self) -> int:
        with self.db.transaction() as conn:
            return conn.execute(
                "DELETE FROM entity_cache WHERE issuer = ?", (self.issuer,)
            ).rowcount
