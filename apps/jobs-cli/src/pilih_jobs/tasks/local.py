"""Local task bookkeeping in `state.db` (20 §3 `local_tasks`, `runs`; 21 §5).

`local_tasks` holds one row per task this device executes: the lease and attempt ids, the
CLI-local state (`claimed → running → paused / awaiting_approval → submit_intent →
sync_pending → done`, or `orphaned` after a lost lease) and a JSON checkpoint (application,
mode, `submit_intent_at`, `form_hash`, the outbox key of the result). Producers update it in
the **same** transaction as the outbox entry it describes (20 §3 durability rule).

`runs` indexes the last 50 discovery runs and the last 50 apply attempts for `logs`.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Final, cast

from pilih_jobs.contracts import ids
from pilih_jobs.storage.db import StateDB

LOCAL_STATES: Final = (
    "claimed",
    "running",
    "paused",
    "awaiting_approval",
    "submit_intent",
    "sync_pending",
    "done",
    "orphaned",
)
#: Rows kept in `runs` per kind (20 §3: "last 50 of each").
RUNS_KEPT: Final = 50


@dataclass
class LocalTask:
    task_id: str
    lease_id: str | None
    attempt_id: str | None
    kind: str
    local_state: str
    checkpoint: dict[str, Any] = field(default_factory=lambda: {})
    updated_at: int = 0

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> LocalTask:
        try:
            checkpoint = json.loads(str(row["checkpoint"] or "{}"))
        except json.JSONDecodeError:
            checkpoint = {}
        return cls(
            task_id=str(row["task_id"]),
            lease_id=cast(str | None, row["lease_id"]),
            attempt_id=cast(str | None, row["attempt_id"]),
            kind=str(row["kind"]),
            local_state=str(row["local_state"]),
            checkpoint=cast(dict[str, Any], checkpoint) if isinstance(checkpoint, dict) else {},
            updated_at=int(row["updated_at"]),
        )

    @property
    def application_id(self) -> str | None:
        value = self.checkpoint.get("application_id")
        return value if isinstance(value, str) else None

    @property
    def submit_intent_at(self) -> int | None:
        value = self.checkpoint.get("submit_intent_at")
        return value if isinstance(value, int) else None

    def as_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "lease_id": self.lease_id,
            "attempt_id": self.attempt_id,
            "kind": self.kind,
            "local_state": self.local_state,
            "checkpoint": self.checkpoint,
            "updated_at": self.updated_at,
        }


class LocalTaskStore:
    def __init__(self, db: StateDB, *, now: Callable[[], int] = ids.now_ms) -> None:
        self.db = db
        self._now = now

    # ------------------------------------------------------------------ reads
    def get(self, task_id: str) -> LocalTask | None:
        row = self.db.query_one("SELECT * FROM local_tasks WHERE task_id = ?", (task_id,))
        return None if row is None else LocalTask.from_row(row)

    def by_lease(self, lease_id: str) -> LocalTask | None:
        row = self.db.query_one("SELECT * FROM local_tasks WHERE lease_id = ?", (lease_id,))
        return None if row is None else LocalTask.from_row(row)

    def all(self) -> list[LocalTask]:
        rows = self.db.query("SELECT * FROM local_tasks ORDER BY updated_at")
        return [LocalTask.from_row(r) for r in rows]

    def open(self) -> list[LocalTask]:
        """Rows that are not finished (`done` / `orphaned`)."""
        rows = self.db.query(
            "SELECT * FROM local_tasks WHERE local_state NOT IN ('done','orphaned') "
            "ORDER BY updated_at"
        )
        return [LocalTask.from_row(r) for r in rows]

    def for_application(self, application_id: str) -> list[LocalTask]:
        return [t for t in self.all() if t.application_id == application_id]

    def counts(self) -> dict[str, int]:
        rows = self.db.query(
            "SELECT local_state, COUNT(*) AS n FROM local_tasks GROUP BY local_state"
        )
        out: dict[str, int] = dict.fromkeys(LOCAL_STATES, 0)
        for row in rows:
            out[str(row["local_state"])] = int(row["n"])
        return out

    def active_lease_ids(self) -> list[str]:
        rows = self.db.query(
            "SELECT lease_id FROM local_tasks WHERE lease_id IS NOT NULL AND local_state IN "
            "('claimed','running','paused','awaiting_approval','submit_intent','sync_pending')"
        )
        return [str(r["lease_id"]) for r in rows]

    # ------------------------------------------------------------------ writes
    def upsert(
        self,
        task_id: str,
        *,
        kind: str,
        local_state: str,
        lease_id: str | None = None,
        attempt_id: str | None = None,
        checkpoint: Mapping[str, Any] | None = None,
    ) -> LocalTask:
        if local_state not in LOCAL_STATES:
            raise ValueError(f"unknown local task state {local_state!r}")
        with self.db.transaction() as conn:
            row = conn.execute("SELECT * FROM local_tasks WHERE task_id = ?", (task_id,)).fetchone()
            merged: dict[str, Any] = {}
            if row is not None:
                merged.update(LocalTask.from_row(row).checkpoint)
            merged.update(checkpoint or {})
            conn.execute(
                "INSERT INTO local_tasks(task_id, lease_id, attempt_id, kind, local_state, "
                "checkpoint, updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET "
                "lease_id = excluded.lease_id, attempt_id = excluded.attempt_id, "
                "kind = excluded.kind, local_state = excluded.local_state, "
                "checkpoint = excluded.checkpoint, updated_at = excluded.updated_at",
                (
                    task_id,
                    lease_id,
                    attempt_id,
                    kind,
                    local_state,
                    json.dumps(merged, separators=(",", ":"), sort_keys=True),
                    self._now(),
                ),
            )
        found = self.get(task_id)
        if found is None:  # pragma: no cover - written in the same transaction
            raise RuntimeError("local task vanished")
        return found

    def update(
        self,
        task_id: str,
        *,
        local_state: str | None = None,
        lease_id: str | None = None,
        attempt_id: str | None = None,
        **checkpoint: Any,
    ) -> LocalTask | None:
        """Change the state and/or merge checkpoint keys (joins an outer transaction)."""
        if local_state is not None and local_state not in LOCAL_STATES:
            raise ValueError(f"unknown local task state {local_state!r}")
        with self.db.transaction() as conn:
            row = conn.execute("SELECT * FROM local_tasks WHERE task_id = ?", (task_id,)).fetchone()
            if row is None:
                return None
            current = LocalTask.from_row(row)
            merged = {**current.checkpoint, **checkpoint}
            conn.execute(
                "UPDATE local_tasks SET local_state = ?, lease_id = ?, attempt_id = ?, "
                "checkpoint = ?, updated_at = ? WHERE task_id = ?",
                (
                    local_state or current.local_state,
                    lease_id if lease_id is not None else current.lease_id,
                    attempt_id if attempt_id is not None else current.attempt_id,
                    json.dumps(merged, separators=(",", ":"), sort_keys=True),
                    self._now(),
                    task_id,
                ),
            )
        return self.get(task_id)

    def purge_closed(self, *, older_than_ms: int = 7 * 24 * 3600 * 1000) -> int:
        with self.db.transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM local_tasks WHERE local_state IN ('done','orphaned') "
                "AND updated_at < ?",
                (self._now() - older_than_ms,),
            )
            return cursor.rowcount


# ---------------------------------------------------------------------- runs index
def record_run_start(
    db: StateDB, run_id: str, kind: str, *, log_path: str | None = None, now: int | None = None
) -> None:
    """Index a discovery run (`run_…`) or an apply attempt (`att_…`) for `logs`."""
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO runs(id, kind, started_at, status, log_path) VALUES(?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET log_path = COALESCE(excluded.log_path, runs.log_path)",
            (run_id, kind, now if now is not None else ids.now_ms(), "running", log_path),
        )
        conn.execute(
            "DELETE FROM runs WHERE kind = ? AND id NOT IN (SELECT id FROM runs WHERE kind = ? "
            "ORDER BY started_at DESC LIMIT ?)",
            (kind, kind, RUNS_KEPT),
        )


def record_run_end(
    db: StateDB, run_id: str, status: str, *, log_path: str | None = None, now: int | None = None
) -> None:
    db.execute(
        "UPDATE runs SET finished_at = ?, status = ?, log_path = COALESCE(?, log_path) "
        "WHERE id = ?",
        (now if now is not None else ids.now_ms(), status, log_path, run_id),
    )


def recent_runs(db: StateDB, *, kind: str | None = None, limit: int = 10) -> list[dict[str, Any]]:
    if kind is None:
        rows = db.query("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?", (limit,))
    else:
        rows = db.query(
            "SELECT * FROM runs WHERE kind = ? ORDER BY started_at DESC LIMIT ?", (kind, limit)
        )
    return [{k: r[k] for k in r.keys()} for r in rows]  # noqa: SIM118 - sqlite3.Row


def find_run(db: StateDB, run_id: str) -> dict[str, Any] | None:
    row = db.query_one("SELECT * FROM runs WHERE id = ?", (run_id,))
    return None if row is None else {k: row[k] for k in row.keys()}  # noqa: SIM118
