"""TCLI-STATEDB: state.db is exactly the 20 §3 schema, WAL, migrations, locks, durability."""

from __future__ import annotations

import multiprocessing
import os
import re
import sqlite3
import stat
from pathlib import Path

import pytest

from pilih_jobs.storage.db import LATEST_VERSION, StateDB, StateDbError, load_migrations
from pilih_jobs.storage.locks import FileLock, LockTimeoutError
from pilih_jobs.sync.outbox import Outbox

SPEC = (
    Path(__file__).resolve().parents[4] / "job-tracker-spec" / "20-LOCAL-CLOUD-SYNCHRONIZATION.md"
)


def _spec_sql() -> str:
    text = SPEC.read_text("utf-8")
    start = text.index("```sql", text.index("## 3. CLI local database"))
    return text[start + len("```sql") : text.index("```", start + 6)]


def _schema(conn: sqlite3.Connection) -> dict[str, list[tuple[str, str, int, object, int]]]:
    tables = [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    ]
    return {
        t: [tuple(row[1:]) for row in conn.execute(f"PRAGMA table_info({t})")]
        for t in sorted(tables)
    }


def _indexes(conn: sqlite3.Connection) -> set[tuple[str, str, tuple[str, ...]]]:
    out = set()
    for name, table in conn.execute(
        "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name LIKE 'ix_%'"
    ):
        cols = tuple(r[2] for r in conn.execute(f"PRAGMA index_info({name})"))
        out.add((name, table, cols))
    return out


def test_TCLI_STATEDB_schema_matches_spec_exactly(tmp_path: Path) -> None:
    reference = sqlite3.connect(":memory:")
    reference.executescript(_spec_sql())
    db = StateDB(tmp_path / "state.db")
    assert _schema(db.conn) == _schema(reference)
    assert _indexes(db.conn) == _indexes(reference)
    assert set(db.tables()) == {
        "account",
        "outbox",
        "entity_cache",
        "sync_state",
        "seen_postings",
        "checkpoints",
        "local_tasks",
        "runs",
        "kv",
    }


def test_TCLI_STATEDB_pragmas_and_permissions(tmp_path: Path) -> None:
    db = StateDB(tmp_path / "data" / "state.db")
    assert db.query_one("PRAGMA journal_mode")[0] == "wal"
    assert db.query_one("PRAGMA foreign_keys")[0] == 1
    assert db.query_one("PRAGMA synchronous")[0] == 1  # NORMAL
    assert db.query_one("PRAGMA busy_timeout")[0] == 5000
    assert db.user_version == LATEST_VERSION == len(load_migrations())
    if os.name == "posix":
        assert stat.S_IMODE(db.path.stat().st_mode) == 0o600
        assert stat.S_IMODE(db.path.parent.stat().st_mode) == 0o700


def test_TCLI_STATEDB_migrations_are_forward_only_and_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "state.db"
    StateDB(path).close()
    again = StateDB(path)
    assert again.user_version == LATEST_VERSION
    again.conn.execute(f"PRAGMA user_version={LATEST_VERSION + 1}")
    again.close()
    with pytest.raises(StateDbError, match="newer than this CLI"):
        StateDB(path)
    for migration in load_migrations():
        assert re.match(r"^\d{3}_[a-z0-9_]+\.sql$", migration.name)


def test_TCLI_STATEDB_check_constraints(tmp_path: Path) -> None:
    db = StateDB(tmp_path / "state.db")
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "INSERT INTO outbox(idempotency_key, issuer, ordering_key, method, path, body_sha256, "
            "kind, created_at, next_attempt_at, state) "
            "VALUES('k','i','o','POST','/api/v1/x','h','append',0,0,'bogus')"
        )
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "INSERT INTO local_tasks(task_id, kind, local_state, updated_at) "
            "VALUES('t','apply','weird',0)"
        )


def test_TCLI_STATEDB_outbox_and_checkpoint_share_one_transaction(tmp_path: Path) -> None:
    db = StateDB(tmp_path / "state.db")
    outbox = Outbox(db, "https://api.test")

    def crash_inside_transaction() -> None:
        with db.transaction() as conn:
            outbox.enqueue("POST", "/api/v1/discovery/runs", {"x": 1}, ordering_key="run:run_1")
            conn.execute(
                "INSERT INTO checkpoints(key, kind, data, updated_at) "
                "VALUES('run:run_1','run','{}',0)"
            )
            raise RuntimeError("crash before commit")

    with pytest.raises(RuntimeError, match="crash before commit"):
        crash_inside_transaction()
    assert outbox.entries() == []
    assert db.query("SELECT * FROM checkpoints") == []
    with db.transaction() as conn:
        outbox.enqueue("POST", "/api/v1/discovery/runs", {"x": 1}, ordering_key="run:run_1")
        conn.execute(
            "INSERT INTO checkpoints(key, kind, data, updated_at) VALUES('run:run_1','run','{}',0)"
        )
    assert len(outbox.entries()) == 1
    assert len(db.query("SELECT * FROM checkpoints")) == 1


def test_TCLI_STATEDB_kv_cache_with_age(tmp_path: Path) -> None:
    db = StateDB(tmp_path / "state.db")
    db.kv_put_cached("meta", {"min": "0.1.0"}, now=1_000)
    assert db.cached("meta", 500, now=1_400) == {"min": "0.1.0"}
    assert db.cached("meta", 500, now=1_600) is None
    db.kv_set_json("x", [1, 2])
    assert db.kv_get_json("x") == [1, 2]
    db.kv_delete("x")
    assert db.kv_get("x") is None


def _hold_lock(path: str, ready: object, release: object) -> None:
    lock = FileLock(Path(path))
    lock.acquire()
    ready.set()  # type: ignore[attr-defined]
    release.wait(10)  # type: ignore[attr-defined]
    lock.release()


def test_TCLI_STATEDB_state_lock_excludes_a_second_process(tmp_path: Path) -> None:
    path = tmp_path / "state.lock"
    ctx = multiprocessing.get_context("spawn")
    ready, release = ctx.Event(), ctx.Event()
    child = ctx.Process(target=_hold_lock, args=(str(path), ready, release))
    child.start()
    try:
        assert ready.wait(20)
        lock = FileLock(path)
        assert lock.is_locked_elsewhere()
        assert not lock.try_acquire()
        with pytest.raises(LockTimeoutError):
            lock.acquire(timeout=0.2)
    finally:
        release.set()
        child.join(20)
    lock = FileLock(path)
    assert lock.try_acquire()
    lock.release()


def test_TCLI_STATEDB_lock_is_reentrant_safe_within_a_process(tmp_path: Path) -> None:
    first, second = FileLock(tmp_path / "a.lock"), FileLock(tmp_path / "a.lock")
    with first.hold():
        assert not second.try_acquire()
        first.write_owner("pid=1")
    assert second.try_acquire()
    second.release()
