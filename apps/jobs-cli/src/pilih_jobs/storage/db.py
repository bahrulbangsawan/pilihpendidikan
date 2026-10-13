"""`state.db` access (20 §3): WAL, forward-only migrations, transactions and the kv cache.

Connection settings: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`,
`busy_timeout=5000`. The schema version lives in `PRAGMA user_version`; migrations are
`storage/migrations/NNN_<name>.sql`, shipped in the wheel and applied in order inside one
transaction each. A database newer than this CLI is refused (no silent downgrade).

Durability rule (20 §3): an outbox insert and its `checkpoints` / `local_tasks` update go
in one `transaction()`.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import sqlite3
import threading
import time
from collections.abc import Generator, Mapping, Sequence
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any, Final, cast

from pilih_jobs.errors import PilihError
from pilih_jobs.paths import ensure_private_dir

_MIGRATION_NAME = re.compile(r"^(\d{3})_[a-z0-9_]+\.sql$")
BUSY_TIMEOUT_MS: Final = 5000


def now_ms() -> int:
    return time.time_ns() // 1_000_000


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    sql: str


def load_migrations() -> list[Migration]:
    root = resources.files("pilih_jobs.storage").joinpath("migrations")
    found: list[Migration] = []
    for entry in root.iterdir():
        match = _MIGRATION_NAME.match(entry.name)
        if match is None:
            continue
        found.append(Migration(int(match.group(1)), entry.name, entry.read_text("utf-8")))
    found.sort(key=lambda m: m.version)
    for expected, migration in enumerate(found, start=1):
        if migration.version != expected:
            raise RuntimeError(f"migration numbering gap at {migration.name}")
    return found


LATEST_VERSION: Final = len(load_migrations())


class StateDbError(PilihError):
    default_code = "state_db_error"


class StateDB:
    """One `sqlite3` connection to `state.db`, safe to share between threads (serialized)."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        if str(path) != ":memory:":
            ensure_private_dir(self.path.parent)
        self._lock = threading.RLock()
        self._depth = 0
        try:
            self.conn = sqlite3.connect(
                str(path),
                isolation_level=None,  # explicit BEGIN/COMMIT only
                check_same_thread=False,
                timeout=BUSY_TIMEOUT_MS / 1000,
            )
        except sqlite3.Error as exc:
            raise StateDbError(f"Cannot open {path}: {exc}") from exc
        self.conn.row_factory = sqlite3.Row
        if str(path) != ":memory:" and os.name == "posix":
            with contextlib.suppress(OSError):
                self.path.chmod(0o600)
        self._configure()
        self.migrate()

    # ------------------------------------------------------------------ setup
    def _configure(self) -> None:
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")

    @property
    def user_version(self) -> int:
        return int(self.conn.execute("PRAGMA user_version").fetchone()[0])

    def migrate(self) -> int:
        """Apply pending migrations; returns the resulting schema version."""
        with self._lock:
            current = self.user_version
            if current > LATEST_VERSION:
                raise StateDbError(
                    f"state.db schema version {current} is newer than this CLI supports "
                    f"({LATEST_VERSION}). Upgrade pilih-jobs.",
                    hint="pilih-jobs update",
                )
            for migration in load_migrations()[current:]:
                script = (
                    f"BEGIN IMMEDIATE;\n{migration.sql}\n;"
                    f"PRAGMA user_version={migration.version};\nCOMMIT;"
                )
                try:
                    self.conn.executescript(script)
                except BaseException:
                    if self.conn.in_transaction:
                        self.conn.execute("ROLLBACK")
                    raise
            return self.user_version

    def close(self) -> None:
        with self._lock:
            self.conn.close()

    # ------------------------------------------------------------------ access
    @contextlib.contextmanager
    def transaction(self) -> Generator[sqlite3.Connection]:
        """`BEGIN IMMEDIATE … COMMIT` (nested calls join the outer transaction)."""
        with self._lock:
            if self._depth > 0:
                self._depth += 1
                try:
                    yield self.conn
                finally:
                    self._depth -= 1
                return
            self.conn.execute("BEGIN IMMEDIATE")
            self._depth = 1
            try:
                yield self.conn
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            else:
                self.conn.execute("COMMIT")
            finally:
                self._depth = 0

    def execute(self, sql: str, params: Sequence[Any] | Mapping[str, Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            return self.conn.execute(sql, params)

    def query(self, sql: str, params: Sequence[Any] | Mapping[str, Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self.conn.execute(sql, params).fetchall())

    def query_one(
        self, sql: str, params: Sequence[Any] | Mapping[str, Any] = ()
    ) -> sqlite3.Row | None:
        with self._lock:
            return cast(sqlite3.Row | None, self.conn.execute(sql, params).fetchone())

    def tables(self) -> list[str]:
        rows = self.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        return [str(r["name"]) for r in rows if not str(r["name"]).startswith("sqlite_")]

    # ------------------------------------------------------------------ kv
    def kv_get(self, key: str) -> str | None:
        row = self.query_one("SELECT value FROM kv WHERE key = ?", (key,))
        return None if row is None else str(row["value"])

    def kv_set(self, key: str, value: str) -> None:
        self.execute(
            "INSERT INTO kv(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    def kv_delete(self, key: str) -> None:
        self.execute("DELETE FROM kv WHERE key = ?", (key,))

    def kv_get_json(self, key: str) -> Any:
        raw = self.kv_get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    def kv_set_json(self, key: str, value: Any) -> None:
        self.kv_set(key, json.dumps(value, separators=(",", ":"), sort_keys=True))

    def cached(self, key: str, max_age_ms: int, *, now: int | None = None) -> Any:
        """A kv JSON value stored with `kv_put_cached`, if younger than `max_age_ms`."""
        entry = self.kv_get_json(key)
        if not isinstance(entry, dict):
            return None
        record = cast(dict[str, Any], entry)
        stored_at = record.get("stored_at")
        if not isinstance(stored_at, int) or (now or now_ms()) - stored_at > max_age_ms:
            return None
        return record.get("value")

    def kv_put_cached(self, key: str, value: Any, *, now: int | None = None) -> None:
        self.kv_set_json(key, {"stored_at": now or now_ms(), "value": value})

    # ------------------------------------------------------------------ account
    def account(self, issuer: str) -> sqlite3.Row | None:
        return self.query_one("SELECT * FROM account WHERE issuer = ?", (issuer,))

    def upsert_account(self, issuer: str, user_id: str, device_id: str | None) -> None:
        self.execute(
            "INSERT INTO account(issuer, user_id, device_id) VALUES(?, ?, ?) "
            "ON CONFLICT(issuer) DO UPDATE SET user_id = excluded.user_id, "
            "device_id = excluded.device_id",
            (issuer, user_id, device_id),
        )


def open_state_db(path: Path) -> StateDB:
    return StateDB(path)
