"""The outbox: durable, ordered, idempotent pending writes (20 §5).

Lifecycle::

    enqueue (pending) → inflight → done
                              ├─→ pending   (retryable; next_attempt_at = backoff)
                              ├─→ conflict  (409 revision_conflict; resolved per 20 §6)
                              └─→ dead      (non-retryable 4xx, age > 7 d, quarantine)

Ordering (20 §5.2): entries with the same `ordering_key` go strictly in `id` order — an
entry is eligible only when no earlier entry of its key is `pending`, `inflight` or
`conflict`. `depends_on` orders across keys (a run's batches wait for the run create).
Lease reports (`kind='lease_report'`) are flushed before everything else, then higher
`priority`, then age.

Due time: `next_attempt_at` is a backoff for retried entries (`attempts > 0`) and is
honoured exactly. A never-attempted entry is due when queued, but its timestamp comes from
the corrected clock, which can step back by up to about a second when a response's `Date`
header moves the offset (20 §9); `ready()` therefore treats such entries as due within
`CLOCK_STEP_TOLERANCE_MS`, so an entry queued just before a flush (e.g. a batch that
`depends_on` the run create sent in the same flush) goes out in the same pass.

Coalescing (20 §5.4): consecutive queued entries of the same batchable endpoint and key
merge into one request; its idempotency key is `sha256(sorted child keys)`, so a retry of
the same children re-derives the same key, and the children reach `done` together.

Producers enqueue inside `StateDB.transaction()` together with their checkpoint /
local_tasks updates (20 §3 durability rule).
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Any, Final, Literal, cast

from pilih_jobs.contracts import ids
from pilih_jobs.logging import redact_text
from pilih_jobs.storage.db import StateDB

OutboxKind = Literal["append", "conditional", "upload", "lease_report"]
OutboxState = Literal["pending", "inflight", "done", "conflict", "dead"]

KINDS: Final = ("append", "conditional", "upload", "lease_report")
#: Flush order across ordering keys (higher first): results/evidence > progress > discovery.
PRIORITY_RESULT: Final = 100
PRIORITY_EVIDENCE: Final = 90
PRIORITY_PROGRESS: Final = 50
PRIORITY_DEFAULT: Final = 10
PRIORITY_DISCOVERY: Final = 0
#: Entries older than this become dead: the server's idempotency keys live 7 days (04 §2.7).
MAX_AGE_MS: Final = 7 * 24 * 3600 * 1000
#: `status` warns about entries pending longer than this (20 §12 F6).
WARN_AGE_MS: Final = 24 * 3600 * 1000
OPEN_STATES: Final = ("pending", "inflight", "conflict")
#: How far the corrected clock may step back (1 s `Date` resolution + margin) without
#: delaying never-attempted entries; retries keep their exact backoff.
CLOCK_STEP_TOLERANCE_MS: Final = 2_000


@dataclass(frozen=True)
class OutboxEntry:
    id: int
    idempotency_key: str
    issuer: str
    ordering_key: str
    method: str
    path: str
    body: bytes | None
    body_sha256: str
    kind: OutboxKind
    priority: int
    depends_on: str | None
    created_at: int
    attempts: int
    next_attempt_at: int
    last_status: int | None
    last_error: str | None
    state: OutboxState

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> OutboxEntry:
        body = row["body"]
        return cls(
            id=int(row["id"]),
            idempotency_key=str(row["idempotency_key"]),
            issuer=str(row["issuer"]),
            ordering_key=str(row["ordering_key"]),
            method=str(row["method"]),
            path=str(row["path"]),
            body=bytes(body) if body is not None else None,
            body_sha256=str(row["body_sha256"]),
            kind=cast(OutboxKind, row["kind"]),
            priority=int(row["priority"]),
            depends_on=cast(str | None, row["depends_on"]),
            created_at=int(row["created_at"]),
            attempts=int(row["attempts"]),
            next_attempt_at=int(row["next_attempt_at"]),
            last_status=cast(int | None, row["last_status"]),
            last_error=cast(str | None, row["last_error"]),
            state=cast(OutboxState, row["state"]),
        )

    def json(self) -> Any:
        return None if self.body is None else json.loads(self.body.decode("utf-8"))

    def summary(self) -> dict[str, Any]:
        """Status view without the body (bodies never leave the machine in bundles)."""
        return {
            "id": self.id,
            "idempotency_key": self.idempotency_key,
            "ordering_key": self.ordering_key,
            "method": self.method,
            "path": self.path,
            "kind": self.kind,
            "priority": self.priority,
            "depends_on": self.depends_on,
            "created_at": self.created_at,
            "attempts": self.attempts,
            "next_attempt_at": self.next_attempt_at,
            "last_status": self.last_status,
            "last_error": self.last_error,
            "state": self.state,
        }


def encode_body(body: Any) -> bytes | None:
    if body is None:
        return None
    if isinstance(body, bytes):
        return body
    return json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def body_digest(body: bytes | None) -> str:
    return hashlib.sha256(body or b"").hexdigest()


def upload_manifest(
    *,
    meta: dict[str, Any],
    path: str,
    content_type: str,
    sha256: str,
    filename: str | None = None,
) -> dict[str, Any]:
    """Body of a `kind='upload'` entry (20 §3): a multipart manifest pointing to a staged file.

    The flusher sends `meta` as the JSON part and the file as the `file` part after checking
    that the path lies inside the upload root, is a regular file (no symlink) and still has
    the recorded SHA-256.
    """
    return {
        "multipart": {
            "meta": meta,
            "file": {
                "path": path,
                "filename": filename or path.replace("\\", "/").rsplit("/", 1)[-1],
                "content_type": content_type,
                "sha256": sha256,
            },
        }
    }


# ------------------------------------------------------------------ coalescing
@dataclass(frozen=True)
class Coalescer:
    """A batchable endpoint: children's `list_field` arrays are concatenated."""

    name: str
    pattern: re.Pattern[str]
    list_field: str
    max_items: int
    max_bytes: int | None = None
    same_fields: tuple[str, ...] = ()
    dedupe: bool = False

    def matches(self, method: str, path: str) -> bool:
        return method == "POST" and self.pattern.match(path) is not None

    def compatible(self, first: dict[str, Any], other: dict[str, Any]) -> bool:
        return all(first.get(name) == other.get(name) for name in self.same_fields)

    def merge(self, bodies: Sequence[dict[str, Any]]) -> dict[str, Any]:
        merged = {k: v for k, v in bodies[0].items() if k != self.list_field}
        items: list[Any] = []
        seen: set[str] = set()
        for body in bodies:
            for item in cast(list[Any], body.get(self.list_field) or []):
                marker = json.dumps(item, sort_keys=True)
                if self.dedupe and marker in seen:
                    continue
                seen.add(marker)
                items.append(item)
        merged[self.list_field] = items
        return merged


COALESCERS: Final = (
    Coalescer(
        "postings_batch",
        re.compile(r"^/api/v1/discovery/runs/[^/]+/postings:batch$"),
        "items",
        max_items=100,
        max_bytes=1_048_576,
    ),
    Coalescer(
        "lease_events",
        re.compile(r"^/api/v1/tasks/[^/]+/lease/[^/]+/events$"),
        "events",
        max_items=50,
    ),
    Coalescer(
        "inbox_bulk",
        re.compile(r"^/api/v1/inbox:bulk$"),
        "user_job_ids",
        max_items=200,
        same_fields=("action",),
        dedupe=True,
    ),
)


def coalescer_for(method: str, path: str) -> Coalescer | None:
    for coalescer in COALESCERS:
        if coalescer.matches(method, path):
            return coalescer
    return None


def batch_key(child_keys: Iterable[str]) -> str:
    """Deterministic key of a coalesced batch: sha256 of the sorted child keys (20 §5.4)."""
    joined = "\n".join(sorted(child_keys))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Batch:
    """One request to send: a single entry or several coalesced children."""

    entries: tuple[OutboxEntry, ...]
    method: str
    path: str
    body: bytes | None
    idempotency_key: str

    @property
    def head(self) -> OutboxEntry:
        return self.entries[0]

    @property
    def ids(self) -> list[int]:
        return [e.id for e in self.entries]

    @property
    def coalesced(self) -> bool:
        return len(self.entries) > 1


def build_batch(entries: Sequence[OutboxEntry]) -> Batch:
    head = entries[0]
    if len(entries) == 1:
        return Batch((head,), head.method, head.path, head.body, head.idempotency_key)
    coalescer = coalescer_for(head.method, head.path)
    if coalescer is None:
        raise ValueError("entries are not batchable")
    bodies = [cast(dict[str, Any], e.json()) for e in entries]
    body = encode_body(coalescer.merge(bodies))
    return Batch(
        tuple(entries),
        head.method,
        head.path,
        body,
        batch_key(e.idempotency_key for e in entries),
    )


# ------------------------------------------------------------------ store
class Outbox:
    """Outbox operations for one issuer (API account)."""

    def __init__(self, db: StateDB, issuer: str, *, now: Callable[[], int] = ids.now_ms) -> None:
        self.db = db
        self.issuer = issuer
        self._now = now

    # ---------------------------------------------------------------- enqueue
    def enqueue(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        ordering_key: str,
        kind: OutboxKind = "append",
        priority: int = PRIORITY_DEFAULT,
        depends_on: str | None = None,
        idempotency_key: str | None = None,
    ) -> OutboxEntry:
        """Queue a write. Call inside `db.transaction()` with the matching checkpoint update.

        Re-enqueueing the same idempotency key with the same body is a no-op that returns
        the existing entry; a different body is a bug and raises ValueError.
        """
        if kind not in KINDS:
            raise ValueError(f"unknown outbox kind {kind!r}")
        method = method.upper()
        if method not in ("POST", "PUT", "PATCH", "DELETE"):
            raise ValueError("the outbox only carries writes")
        if not path.startswith("/api/v1/"):
            raise ValueError("outbox paths are /api/v1 routes")
        key = idempotency_key or ids.new_ulid()
        if len(key) > 128:
            raise ValueError("idempotency keys are at most 128 characters")
        encoded = encode_body(body)
        digest = body_digest(encoded)
        now = self._now()
        with self.db.transaction() as conn:
            existing = conn.execute(
                "SELECT * FROM outbox WHERE idempotency_key = ?", (key,)
            ).fetchone()
            if existing is not None:
                entry = OutboxEntry.from_row(existing)
                if entry.body_sha256 != digest or entry.path != path:
                    raise ValueError(f"idempotency key {key} reused with a different request")
                return entry
            cursor = conn.execute(
                "INSERT INTO outbox(idempotency_key, issuer, ordering_key, method, path, body, "
                "body_sha256, kind, priority, depends_on, created_at, next_attempt_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    key,
                    self.issuer,
                    ordering_key,
                    method,
                    path,
                    encoded,
                    digest,
                    kind,
                    priority,
                    depends_on,
                    now,
                    now,
                ),
            )
            row = conn.execute("SELECT * FROM outbox WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return OutboxEntry.from_row(row)

    # ---------------------------------------------------------------- queries
    def get(self, ident: int | str) -> OutboxEntry | None:
        column = "id" if isinstance(ident, int) else "idempotency_key"
        row = self.db.query_one(
            f"SELECT * FROM outbox WHERE issuer = ? AND {column} = ?",  # noqa: S608 - fixed column names
            (self.issuer, ident),
        )
        return None if row is None else OutboxEntry.from_row(row)

    def entries(self, states: Sequence[OutboxState] | None = None) -> list[OutboxEntry]:
        if states:
            marks = ",".join("?" for _ in states)
            rows = self.db.query(
                f"SELECT * FROM outbox WHERE issuer = ? AND state IN ({marks}) ORDER BY id",  # noqa: S608
                (self.issuer, *states),
            )
        else:
            rows = self.db.query(
                "SELECT * FROM outbox WHERE issuer = ? ORDER BY id", (self.issuer,)
            )
        return [OutboxEntry.from_row(r) for r in rows]

    def counts(self) -> dict[str, int]:
        rows = self.db.query(
            "SELECT state, COUNT(*) AS n FROM outbox WHERE issuer = ? GROUP BY state",
            (self.issuer,),
        )
        out: dict[str, int] = dict.fromkeys(("pending", "inflight", "done", "conflict", "dead"), 0)
        for row in rows:
            out[str(row["state"])] = int(row["n"])
        return out

    def depth(self) -> int:
        """Unsynced writes: pending + inflight + conflict."""
        counts = self.counts()
        return counts["pending"] + counts["inflight"] + counts["conflict"]

    def stale_count(self, older_than_ms: int = WARN_AGE_MS) -> int:
        row = self.db.query_one(
            "SELECT COUNT(*) AS n FROM outbox WHERE issuer = ? AND state IN ('pending','inflight',"
            "'conflict') AND created_at < ?",
            (self.issuer, self._now() - older_than_ms),
        )
        return 0 if row is None else int(row["n"])

    def ready(self, *, limit: int = 100, now: int | None = None) -> list[OutboxEntry]:
        """Eligible heads, lease reports first, then priority, then age (20 §5.2).

        Retried entries wait for their backoff (`next_attempt_at <= now`); entries never
        attempted are due within `CLOCK_STEP_TOLERANCE_MS` of their queue time.
        """
        rows = self.db.query(
            """
            SELECT o.* FROM outbox o
            WHERE o.issuer = :issuer AND o.state = 'pending'
              AND (o.next_attempt_at <= :now
                   OR (o.attempts = 0 AND o.next_attempt_at <= :now + :tolerance))
              AND NOT EXISTS (
                SELECT 1 FROM outbox p
                WHERE p.issuer = o.issuer AND p.ordering_key = o.ordering_key AND p.id < o.id
                  AND p.state IN ('pending', 'inflight', 'conflict'))
              AND (o.depends_on IS NULL OR NOT EXISTS (
                SELECT 1 FROM outbox d
                WHERE d.idempotency_key = o.depends_on AND d.state <> 'done'))
            ORDER BY (o.kind = 'lease_report') DESC, o.priority DESC, o.id ASC
            LIMIT :limit
            """,
            {
                "issuer": self.issuer,
                "now": self._now() if now is None else now,
                "tolerance": CLOCK_STEP_TOLERANCE_MS,
                "limit": limit,
            },
        )
        return [OutboxEntry.from_row(r) for r in rows]

    def batch_for(self, head: OutboxEntry) -> Batch:
        """`head` plus the consecutive queued entries it can be coalesced with (20 §5.4)."""
        coalescer = coalescer_for(head.method, head.path)
        if coalescer is None:
            return build_batch([head])
        rows = self.db.query(
            "SELECT * FROM outbox WHERE issuer = ? AND ordering_key = ? AND id > ? ORDER BY id",
            (self.issuer, head.ordering_key, head.id),
        )
        first = cast(dict[str, Any], head.json())
        chosen = [head]
        items = len(cast(list[Any], first.get(coalescer.list_field) or []))
        size = len(head.body or b"")
        for row in rows:
            entry = OutboxEntry.from_row(row)
            if (
                entry.state != "pending"
                or entry.method != head.method
                or entry.path != head.path
                or entry.kind != head.kind
                or entry.depends_on != head.depends_on
            ):
                break
            body = cast(dict[str, Any], entry.json())
            count = len(cast(list[Any], body.get(coalescer.list_field) or []))
            if not coalescer.compatible(first, body) or items + count > coalescer.max_items:
                break
            if (
                coalescer.max_bytes is not None
                and size + len(entry.body or b"") > coalescer.max_bytes
            ):
                break
            chosen.append(entry)
            items += count
            size += len(entry.body or b"")
        return build_batch(chosen)

    # ---------------------------------------------------------------- transitions
    def _update(self, entry_ids: Sequence[int], sql: str, params: Sequence[Any]) -> None:
        if not entry_ids:
            return
        marks = ",".join("?" for _ in entry_ids)
        with self.db.transaction() as conn:
            conn.execute(
                f"UPDATE outbox SET {sql} WHERE issuer = ? AND id IN ({marks})",  # noqa: S608
                (*params, self.issuer, *entry_ids),
            )

    def mark_inflight(self, entry_ids: Sequence[int]) -> None:
        self._update(entry_ids, "state = 'inflight', attempts = attempts + 1", ())

    def mark_done(self, entry_ids: Sequence[int], status: int) -> None:
        self._update(entry_ids, "state = 'done', last_status = ?, last_error = NULL", (status,))

    def mark_retry(
        self, entry_ids: Sequence[int], *, status: int | None, error: str, next_attempt_at: int
    ) -> None:
        self._update(
            entry_ids,
            "state = 'pending', last_status = ?, last_error = ?, next_attempt_at = ?",
            (status, redact_text(error)[:2000], next_attempt_at),
        )

    def mark_pending_now(self, entry_ids: Sequence[int], *, attempts_back: bool = True) -> None:
        """Back to pending without consuming an attempt (auth pause, 426 pause)."""
        delta = "attempts = MAX(attempts - 1, 0), " if attempts_back else ""
        self._update(entry_ids, f"{delta}state = 'pending'", ())

    def mark_conflict(self, entry_ids: Sequence[int], *, status: int, error: str) -> None:
        self._update(
            entry_ids,
            "state = 'conflict', last_status = ?, last_error = ?",
            (status, redact_text(error)[:2000]),
        )

    def mark_dead(self, entry_ids: Sequence[int], *, status: int | None, error: str) -> None:
        self._update(
            entry_ids,
            "state = 'dead', last_status = ?, last_error = ?",
            (status, redact_text(error)[:2000]),
        )

    def recover_inflight(self) -> int:
        """After a crash: `inflight` entries go back to `pending` (replays are idempotent)."""
        with self.db.transaction() as conn:
            cursor = conn.execute(
                "UPDATE outbox SET state = 'pending' WHERE issuer = ? AND state = 'inflight'",
                (self.issuer,),
            )
            return cursor.rowcount

    def expire_old(self, *, now: int | None = None) -> int:
        """Entries not done after 7 days become dead (20 §5.3 max age)."""
        cutoff = (self._now() if now is None else now) - MAX_AGE_MS
        with self.db.transaction() as conn:
            cursor = conn.execute(
                "UPDATE outbox SET state = 'dead', last_error = 'expired: not delivered within 7 "
                "days (server idempotency window)' WHERE issuer = ? AND state IN ('pending',"
                "'inflight','conflict') AND created_at < ?",
                (self.issuer, cutoff),
            )
            return cursor.rowcount

    def kill_orphans(self) -> int:
        """Entries whose `depends_on` entry is dead can never be delivered."""
        killed = 0
        while True:
            with self.db.transaction() as conn:
                cursor = conn.execute(
                    "UPDATE outbox SET state = 'dead', last_error = 'dependency failed: ' || "
                    "depends_on WHERE issuer = ? AND state IN ('pending','conflict') AND "
                    "depends_on IN (SELECT idempotency_key FROM outbox WHERE state = 'dead')",
                    (self.issuer,),
                )
            if cursor.rowcount == 0:
                return killed
            killed += cursor.rowcount

    def quarantine(self, previous_user_id: str) -> int:
        """A different user signed in: never replay these writes under the wrong identity."""
        with self.db.transaction() as conn:
            cursor = conn.execute(
                "UPDATE outbox SET state = 'dead', last_error = ? WHERE issuer = ? AND state IN "
                "('pending','inflight','conflict')",
                (f"quarantined: belongs to {previous_user_id}", self.issuer),
            )
            return cursor.rowcount

    def rebase(self, ident: int | str, body: Any) -> OutboxEntry:
        """`sync --retry`: same position, fresh idempotency key, new (re-based) body."""
        entry = self.get(ident)
        if entry is None:
            raise KeyError(ident)
        encoded = encode_body(body)
        now = self._now()
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE outbox SET idempotency_key = ?, body = ?, body_sha256 = ?, attempts = 0, "
                "created_at = ?, next_attempt_at = ?, last_error = NULL, last_status = NULL, "
                "state = 'pending' WHERE id = ?",
                (ids.new_ulid(), encoded, body_digest(encoded), now, now, entry.id),
            )
        refreshed = self.get(entry.id)
        if refreshed is None:  # pragma: no cover - same transaction, cannot vanish
            raise KeyError(ident)
        return refreshed

    def discard(self, ident: int | str) -> bool:
        entry = self.get(ident)
        if entry is None:
            return False
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM outbox WHERE id = ?", (entry.id,))
        return True

    def discard_open(self) -> int:
        """`logout --discard-outbox`: drop every unsynced write of this issuer."""
        with self.db.transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM outbox WHERE issuer = ? "
                "AND state IN ('pending','inflight','conflict')",
                (self.issuer,),
            )
            return cursor.rowcount

    def purge_done(self, *, older_than_ms: int = MAX_AGE_MS) -> int:
        with self.db.transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM outbox WHERE issuer = ? AND state = 'done' AND created_at < ?",
                (self.issuer, self._now() - older_than_ms),
            )
            return cursor.rowcount
