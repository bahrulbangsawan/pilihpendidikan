"""`ApiLeaseChannel`: the `LeaseChannel` of PLAN C6 over the API client (21 §5–§6).

One channel per claimed lease. It owns:

- **heartbeats** — `run_heartbeats()` posts `…/lease/{l}/heartbeat` every 30 s (or the server's
  `heartbeat_interval_ms`) on its own HTTP client, never through the outbox; the response
  delivers `cancel_requested` / `resume_requested`, the server clock and the poll interval;
- **fencing** — `409 lease_lost`, `401` (revoked token, refresh refused) or `403
  device_revoked` on any lease-scoped call set `lost` at once; `watchdog()` compares the
  **monotonic** clock with the last successful heartbeat: 90 s → `stalled` (browser work
  pauses: AI, approval and file calls wait, `submit_intent` is refused), 110 s → `lost`.
  After `lost` the channel refuses every call: nothing is reported again under the lease;
- **events** — step events are written durably to the outbox as `lease_report` entries
  (≤ 50 per entry, flushed at least every 5 s by kicking the sync loop); `submit_intent`
  events are refused: the intent has its own synchronous route;
- **approvals** — `create_approval` / `poll_approval` on the lease routes;
- **submit intent** — a synchronous `POST …/submit-intent` that raises unless it got `200`;
  the acknowledged `submit_intent_at` is written to `local_tasks` before returning;
- **AI proxy** — `/api/v1/ai/*` with `lease_ref`; **files** — upload / verified download.

The heartbeat task never touches the browser; it only sets `asyncio.Event`s that the
executor checks between actions (21 §5.3).
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import mimetypes
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final, cast

from pilih_jobs.api.client import ApiClient, ApiResponse
from pilih_jobs.api.errors import (
    ApiAuthError,
    ApiConflictError,
    ApiPermissionError,
)
from pilih_jobs.clock import ClockSync
from pilih_jobs.contracts import ids
from pilih_jobs.cv.download import download_verified
from pilih_jobs.errors import NotAuthenticatedError, PilihError, UsageError
from pilih_jobs.logging import get_logger, log_event
from pilih_jobs.paths import Paths
from pilih_jobs.sync.outbox import PRIORITY_PROGRESS, Outbox
from pilih_jobs.tasks.constants import (
    EVENTS_BATCH_MAX,
    EVENTS_FLUSH_S,
    HEARTBEAT_INTERVAL_MS,
    HEARTBEAT_RETRY_MS,
    LEASE_MS,
    LOCAL_LOST_MS,
    LOCAL_PAUSE_MS,
    WATCHDOG_INTERVAL_S,
)
from pilih_jobs.tasks.errors import DryRunRefusedError, LeaseLostError, LeaseStalledError
from pilih_jobs.tasks.local import LocalTaskStore

_log = get_logger("tasks.lease")

EVENT_TYPES: Final = frozenset({"started", "progress", "paused", "resumed", "log"})
FILE_UPLOAD_MAX_BYTES: Final = 26_214_400
DEFAULT_PROGRESS: Final[dict[str, Any]] = {"stage": "claimed", "step": 0, "message": "Claimed"}
Emit = Callable[[str, dict[str, Any]], None]


def mono_ms() -> int:
    return time.monotonic_ns() // 1_000_000


def _noop_emit(_kind: str, _fields: dict[str, Any]) -> None:
    return None


def _noop() -> None:
    return None


@dataclass
class LeaseGrant:
    """A claimed lease: `200 {task, lease, context}` of `tasks:claim` (21 §5.1)."""

    task: dict[str, Any]
    lease_id: str
    expires_at: int
    heartbeat_interval_ms: int
    context: dict[str, Any]
    attempt_id: str | None = None
    server_time: int | None = None
    poll_interval_ms: int | None = None
    claimed_mono_ms: int = field(default_factory=mono_ms)

    @property
    def task_id(self) -> str:
        return str(self.task["id"])

    @property
    def kind(self) -> str:
        return str(self.task.get("kind") or self.context.get("kind") or "apply")

    @property
    def application_id(self) -> str | None:
        value = self.task.get("application_id")
        return value if isinstance(value, str) else None

    @classmethod
    def from_claim(cls, data: dict[str, Any], *, server_time: int | None = None) -> LeaseGrant:
        lease = cast(dict[str, Any], data["lease"])
        extra = data.get("attempt_id") or lease.get("attempt_id")
        return cls(
            task=cast(dict[str, Any], data["task"]),
            lease_id=str(lease["lease_id"]),
            expires_at=int(lease["expires_at"]),
            heartbeat_interval_ms=int(lease.get("heartbeat_interval_ms") or HEARTBEAT_INTERVAL_MS),
            context=cast(dict[str, Any], data.get("context") or {}),
            attempt_id=extra if isinstance(extra, str) else None,
            server_time=server_time,
            poll_interval_ms=cast(int | None, data.get("poll_interval_ms")),
        )


def lease_path(task_id: str, lease_id: str, suffix: str) -> str:
    return f"/api/v1/tasks/{task_id}/lease/{lease_id}/{suffix}"


def is_fencing_error(exc: BaseException) -> str | None:
    """The reason when `exc` means the lease is gone (21 §5.3, §10), else None.

    A refresh race answered `503 temporarily_unavailable` is retryable, never a sign-out.
    """
    if (
        getattr(exc, "error", None) == "temporarily_unavailable"
        or getattr(exc, "code", None) == "temporarily_unavailable"
    ):
        return None
    if isinstance(exc, ApiConflictError) and exc.error == "lease_lost":
        return "lease_lost"
    if isinstance(exc, ApiAuthError):
        return exc.reason or "invalid_token"
    if isinstance(exc, ApiPermissionError) and exc.error == "device_revoked":
        return "device_revoked"
    if isinstance(exc, NotAuthenticatedError):
        return "revoked_token"
    return None


def content_type_for(path: Path) -> str:
    suffix = path.suffix.lower()
    known = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gz": "application/gzip",
        ".jsonl": "application/x-ndjson",
        ".json": "application/json",
        ".txt": "text/plain",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }
    if suffix in known:
        return known[suffix]
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def _with_alias(record: dict[str, Any], key: str) -> dict[str, Any]:
    """The record itself, also reachable under `key` (`{…, "approval": {…}}`)."""
    return {**record, key: record}


class ApiLeaseChannel:
    """The `LeaseChannel` implementation (see the module docstring)."""

    def __init__(
        self,
        *,
        api: ApiClient,
        outbox: Outbox,
        store: LocalTaskStore,
        grant: LeaseGrant,
        clock: ClockSync | None = None,
        heartbeat_api: ApiClient | None = None,
        paths: Paths | None = None,
        monotonic: Callable[[], int] = mono_ms,
        now_ms: Callable[[], int] | None = None,
        kick: Callable[[], None] = _noop,
        emit: Emit = _noop_emit,
        on_poll_interval: Callable[[int], None] | None = None,
        dry_run: bool = False,
    ) -> None:
        self.api = api
        self.heartbeat_api = heartbeat_api or api
        self.outbox = outbox
        self.store = store
        self.grant = grant
        self.clock = clock
        self.paths = paths
        self._mono = monotonic
        self._now = now_ms or (clock.now_ms if clock is not None else ids.now_ms)
        self._kick = kick
        self._emit = emit
        self._on_poll_interval = on_poll_interval
        self.dry_run = dry_run
        self.lost = asyncio.Event()
        self.cancel_requested = asyncio.Event()
        self.resume_requested = asyncio.Event()
        #: Set while no heartbeat succeeded for 90 s; cleared by the next success.
        self.stalled = asyncio.Event()
        self.healthy = asyncio.Event()
        self.healthy.set()
        self.closed = asyncio.Event()
        self.lost_reason: str | None = None
        #: True when the cancellation came from the server (heartbeat), not a local Ctrl+C.
        self.server_cancel = False
        self.task_id = grant.task_id
        self.lease_id = grant.lease_id
        self.attempt_id = grant.attempt_id
        self.heartbeat_interval_ms = grant.heartbeat_interval_ms
        self.progress: dict[str, Any] = dict(DEFAULT_PROGRESS)
        self.local_state = "claimed"
        self.submit_intent_at: int | None = None
        self.form_hash: str | None = None
        self.approval_id: str | None = None
        self.heartbeats_ok = 0
        self.heartbeats_failed = 0
        self.last_heartbeat_at: int | None = None
        self.lease_expires_at = grant.expires_at
        self.last_ok_mono = grant.claimed_mono_ms
        self._deadline_mono = self._compute_deadline(grant.expires_at, grant.server_time)
        self._event_seq = 0
        self._pending_events = 0
        self._flush_timer: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------ deadlines
    def _compute_deadline(self, expires_at: int, server_time: int | None) -> int:
        """Monotonic deadline of the lease: `now + (expires_at - server_time) - 10 s` (20 §9)."""
        base = server_time if server_time is not None else self._now()
        remaining = min(expires_at - base, LEASE_MS) - (LEASE_MS - LOCAL_LOST_MS)
        return self._mono() + max(0, remaining)

    def since_last_ok_ms(self) -> int:
        return self._mono() - self.last_ok_mono

    def check_deadline(self) -> str:
        """Apply the 90 s pause / 110 s lost rules; returns `ok`, `stalled` or `lost`."""
        if self.lost.is_set():
            return "lost"
        silent = self.since_last_ok_ms()
        if silent >= LOCAL_LOST_MS or self._mono() >= self._deadline_mono:
            self.mark_lost("local_deadline")
            return "lost"
        if silent >= LOCAL_PAUSE_MS:
            if not self.stalled.is_set():
                self.stalled.set()
                self.healthy.clear()
                self._emit(
                    "warning",
                    {
                        "message": "No successful heartbeat for 90 s: pausing browser actions.",
                        "task_id": self.task_id,
                    },
                )
            return "stalled"
        return "ok"

    def mark_lost(self, reason: str) -> None:
        """Fence: stop everything under this lease (21 §5.3 rule 2)."""
        if self.lost.is_set():
            return
        self.lost_reason = reason
        self.lost.set()
        self.stalled.set()
        self.healthy.set()  # wake waiters; they re-check `lost` and raise
        current = self.store.get(self.task_id)
        if current is not None and current.local_state not in ("done", "sync_pending"):
            self.store.update(self.task_id, local_state="orphaned", lost_reason=reason)
        killed = self._kill_pending_events()
        log_event(
            _log,
            "lease_lost",
            "lease lost; the executor stops",
            level=30,
            task_id=self.task_id,
            reason=reason,
            events_dropped=killed,
        )
        self._emit("warning", {"message": f"Lease lost ({reason}); stopping.", "reason": reason})

    def _kill_pending_events(self) -> int:
        """Never report again under a lost lease: queued step events become dead."""
        with self.outbox.db.transaction() as conn:
            cursor = conn.execute(
                "UPDATE outbox SET state = 'dead', last_error = 'lease lost before delivery' "
                "WHERE issuer = ? AND ordering_key = ? AND path = ? "
                "AND state IN ('pending','conflict')",
                (
                    self.outbox.issuer,
                    self.ordering_key,
                    lease_path(self.task_id, self.lease_id, "events"),
                ),
            )
            return cursor.rowcount

    @property
    def ordering_key(self) -> str:
        return f"lease:{self.lease_id}"

    def _ensure_live(self) -> None:
        if self.lost.is_set():
            raise LeaseLostError(
                f"The lease of {self.task_id} is lost ({self.lost_reason}); not reporting.",
                details={"task_id": self.task_id, "reason": self.lost_reason},
            )

    async def wait_healthy(self) -> None:
        """Block while the lease is stalled (90 s rule); raise once it is lost."""
        self._ensure_live()
        self.check_deadline()
        while self.stalled.is_set() and not self.lost.is_set():
            await self.healthy.wait()
            if self.stalled.is_set() and not self.lost.is_set():
                self.healthy.clear()
        self._ensure_live()

    def fence(self, exc: BaseException) -> None:
        reason = is_fencing_error(exc)
        if reason is not None:
            self.mark_lost(reason)
            raise LeaseLostError(
                f"The lease of {self.task_id} was lost ({reason}).",
                details={"task_id": self.task_id, "reason": reason},
            ) from exc

    # ------------------------------------------------------------------ local state
    def set_local_state(self, state: str, **checkpoint: Any) -> None:
        self.local_state = state
        self.store.update(self.task_id, local_state=state, **checkpoint)

    # ------------------------------------------------------------------ heartbeats
    async def heartbeat_once(self) -> bool:
        """One lease heartbeat; True on success. Fencing errors set `lost`."""
        if self.lost.is_set():
            return False
        body = {
            "progress": self.progress,
            "local_state": self.local_state if self.local_state != "done" else None,
        }
        started = self._mono()
        try:
            response = await self.heartbeat_api.request(
                "POST",
                lease_path(self.task_id, self.lease_id, "heartbeat"),
                json_body=body,
                idempotency_key=f"hb:{self.lease_id}:{ids.new_ulid()}",
            )
        except PilihError as exc:  # incl. 503 temporarily_unavailable on refresh: retryable
            reason = is_fencing_error(exc)
            if reason is not None:
                self.mark_lost(reason)
            else:
                self.heartbeats_failed += 1
                log_event(
                    _log,
                    "heartbeat_failed",
                    "lease heartbeat failed",
                    level=30,
                    task_id=self.task_id,
                    error=str(exc),
                )
            return False
        self._accept_heartbeat(response, rtt_ms=self._mono() - started)
        return True

    def _accept_heartbeat(self, response: ApiResponse, *, rtt_ms: int) -> None:
        data = cast(dict[str, Any], response.data or {})
        server_time = data.get("server_time")
        if isinstance(server_time, int) and self.clock is not None:
            self.clock.observe(server_time, rtt_ms=max(0, rtt_ms))
        expires = data.get("lease_expires_at")
        if isinstance(expires, int):
            self.lease_expires_at = expires
            self._deadline_mono = self._compute_deadline(
                expires, server_time if isinstance(server_time, int) else None
            )
        self.last_ok_mono = self._mono()
        self.last_heartbeat_at = self._now()
        self.heartbeats_ok += 1
        if self.stalled.is_set():
            self.stalled.clear()
            self.healthy.set()
            self._emit("log", {"message": "Heartbeat restored; resuming.", "task_id": self.task_id})
        if data.get("cancel_requested") and not self.server_cancel:
            self.server_cancel = True
            self.cancel_requested.set()
            self._emit("warning", {"message": "Cancellation requested.", "task_id": self.task_id})
        if data.get("resume_requested") and not self.resume_requested.is_set():
            self.resume_requested.set()
        interval = data.get("poll_interval_ms")
        if isinstance(interval, int) and self._on_poll_interval is not None:
            self._on_poll_interval(interval)

    async def _sleep_or_stop(self, seconds: float) -> None:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self.closed.wait(), timeout=max(0.0, seconds))

    async def run_heartbeats(self) -> None:
        """Heartbeat until the lease is lost or the channel is closed."""
        while not self.lost.is_set() and not self.closed.is_set():
            ok = await self.heartbeat_once()
            delay_ms = self.heartbeat_interval_ms if ok else HEARTBEAT_RETRY_MS
            await self._sleep_or_stop(delay_ms / 1000)

    async def watchdog(self, interval_s: float = WATCHDOG_INTERVAL_S) -> None:
        while not self.lost.is_set() and not self.closed.is_set():
            self.check_deadline()
            await self._sleep_or_stop(interval_s)

    # ------------------------------------------------------------------ events
    def _prepare_event(self, item: dict[str, Any]) -> dict[str, Any]:
        kind = item.get("type")
        if kind == "submit_intent":
            raise UsageError(
                "submit_intent is never sent through the batched events route (21 §6.5); "
                "call submit_intent()."
            )
        if kind not in EVENT_TYPES:
            raise UsageError(f"unknown lease event type {kind!r}")
        self._event_seq += 1
        event = dict(item)
        event.setdefault("idempotency_key", f"ev:{self.lease_id}:{ids.new_ulid()}")
        event.setdefault("occurred_at", self._now())
        if kind == "log":
            event["message"] = str(event.get("message", ""))[:1000]
            event.setdefault("level", "info")
        if kind == "paused":
            event["message"] = str(event.get("message", ""))[:300]
            if not event["message"]:
                event.pop("message")
        return event

    def _apply_event_locally(self, event: dict[str, Any]) -> dict[str, Any]:
        kind = event["type"]
        updates: dict[str, Any] = {}
        if kind == "progress":
            progress = cast(dict[str, Any], event.get("progress") or {})
            self.progress = {
                "stage": progress.get("stage", "claimed"),
                "step": int(progress.get("step", 0)),
                "message": str(progress.get("message", ""))[:300],
                **({"percent": progress["percent"]} if "percent" in progress else {}),
            }
            event["progress"] = self.progress
            updates["step"] = self.progress["step"]
        elif kind == "paused":
            self.local_state = "paused"
            updates["pause_reason"] = event.get("pause_reason")
        elif kind in ("resumed", "started") and self.local_state in ("claimed", "paused"):
            self.local_state = "running"
        return updates

    async def events(self, items: list[dict[str, Any]]) -> None:
        """Queue step events (≤ 50 per request, flushed at least every 5 s) as lease reports."""
        self._ensure_live()
        prepared: list[dict[str, Any]] = []
        updates: dict[str, Any] = {}
        for item in items:
            if item.get("type") == "approval_requested":
                # Dedicated route (21 §6.3): create_approval() records it; never batched.
                self._emit("approval_requested", {k: v for k, v in item.items() if k != "type"})
                continue
            event = self._prepare_event(item)
            updates.update(self._apply_event_locally(event))
            prepared.append(event)
        if not prepared:
            return
        path = lease_path(self.task_id, self.lease_id, "events")
        with self.outbox.db.transaction():
            for start in range(0, len(prepared), EVENTS_BATCH_MAX):
                chunk = prepared[start : start + EVENTS_BATCH_MAX]
                self.outbox.enqueue(
                    "POST",
                    path,
                    {"events": chunk},
                    ordering_key=self.ordering_key,
                    kind="lease_report",
                    priority=PRIORITY_PROGRESS,
                    idempotency_key=f"evb:{self.lease_id}:{ids.new_ulid()}",
                )
            self.store.update(self.task_id, local_state=self.local_state, **updates)
        for event in prepared:
            self._emit(_event_output_type(event), _event_fields(event))
        self._pending_events += len(prepared)
        if self._pending_events >= EVENTS_BATCH_MAX:
            self._flush_events_now()
        elif self._flush_timer is None or self._flush_timer.done():
            self._flush_timer = asyncio.get_running_loop().create_task(self._flush_later())

    def _flush_events_now(self) -> None:
        self._pending_events = 0
        self._kick()

    async def _flush_later(self) -> None:
        await self._sleep_or_stop(EVENTS_FLUSH_S)
        if self._pending_events:
            self._flush_events_now()

    # ------------------------------------------------------------------ approvals
    async def create_approval(
        self, kind: str, payload: dict[str, Any], payload_hash: str
    ) -> dict[str, Any]:
        await self.wait_healthy()
        try:
            data = await self.api.post(
                lease_path(self.task_id, self.lease_id, "approvals"),
                {"kind": kind, "payload": payload, "payload_hash": payload_hash},
                idempotency_key=f"apr:{self.lease_id}:{kind}:{payload_hash}"[:128],
            )
        except PilihError as exc:
            self.fence(exc)
            raise
        approval = cast(dict[str, Any], cast(dict[str, Any], data)["approval"])
        self.approval_id = str(approval["id"])
        self.set_local_state(
            "awaiting_approval", approval_id=self.approval_id, approval_requested_at=self._now()
        )
        self._emit(
            "approval_requested",
            {"approval_id": self.approval_id, "kind": kind, "task_id": self.task_id},
        )
        return _with_alias(approval, "approval")

    async def poll_approval(self, approval_id: str) -> dict[str, Any]:
        await self.wait_healthy()
        try:
            data = await self.api.get(
                lease_path(self.task_id, self.lease_id, f"approvals/{approval_id}")
            )
        except PilihError as exc:
            self.fence(exc)
            raise
        approval = cast(dict[str, Any], cast(dict[str, Any], data)["approval"])
        state = approval.get("state")
        if state != "pending" and self.local_state == "awaiting_approval":
            self.set_local_state("running", approval_state=state)
            self._emit("approval_decided", {"approval_id": approval_id, "state": state})
        return _with_alias(approval, "approval")

    # ------------------------------------------------------------------ submit intent
    async def submit_intent(
        self, form_hash: str, approval_id: str | None = None, rule_id: str | None = None
    ) -> dict[str, Any]:
        """Synchronous `POST …/submit-intent` (D-28): never queued, raises unless `200`."""
        self._ensure_live()
        if self.dry_run:
            raise DryRunRefusedError("Dry run: submit_intent is never sent; nothing is submitted.")
        if self.check_deadline() != "ok":
            self._ensure_live()
            raise LeaseStalledError(
                "No successful heartbeat for 90 s: refusing submit_intent (nothing submitted)."
            )
        body: dict[str, Any] = {"form_hash": form_hash}
        if approval_id:
            body["approval_id"] = approval_id
        if rule_id:
            body["rule_id"] = rule_id
        try:
            response = await self.api.request(
                "POST",
                lease_path(self.task_id, self.lease_id, "submit-intent"),
                json_body=body,
                idempotency_key=f"intent:{self.lease_id}:{form_hash}"[:128],
            )
        except PilihError as exc:
            self.fence(exc)
            raise
        if response.status != 200:
            raise PilihError(
                f"submit-intent answered {response.status}, not 200; not submitting.",
                code="submit_intent_refused",
            )
        data = cast(dict[str, Any], response.data or {})
        at = data.get("submit_intent_at")
        if not isinstance(at, int):
            raise PilihError("submit-intent response lacks submit_intent_at; not submitting.")
        # Durable before the click: the second Ctrl+C and crash recovery read it (16 §6).
        self.submit_intent_at = at
        self.form_hash = form_hash
        self.set_local_state(
            "submit_intent",
            submit_intent_at=at,
            form_hash=form_hash,
            approval_id=approval_id,
            rule_id=rule_id,
        )
        self._emit("submit_intent", {"task_id": self.task_id, "submit_intent_at": at})
        return data

    # ------------------------------------------------------------------ AI proxy
    @staticmethod
    def ai_path(endpoint: str) -> str:
        name = endpoint.strip().strip("/")
        for prefix in ("api/v1/ai/", "ai/"):
            name = name.removeprefix(prefix)
        if not name or "/" in name:
            raise UsageError(f"unknown AI endpoint {endpoint!r}")
        return f"/api/v1/ai/{name}"

    async def ai(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
        await self.wait_healthy()
        payload = {**body, "lease_ref": {"task_id": self.task_id, "lease_id": self.lease_id}}
        try:
            data = await self.api.post(self.ai_path(endpoint), payload)
        except PilihError as exc:
            self.fence(exc)
            raise
        return cast(dict[str, Any], data)

    # ------------------------------------------------------------------ files
    async def upload_file(self, kind: str, path: Path, links: dict[str, Any]) -> dict[str, Any]:
        await self.wait_healthy()
        return await upload_file(self.api, kind, path, links, fence=self.fence)

    async def download_file(self, file_id: str, dest: Path, sha256: str) -> Path:
        await self.wait_healthy()
        target = _download_target(dest, file_id)
        try:
            result = await download_verified(self.api, file_id, target, sha256, paths=self.paths)
        except PilihError as exc:
            self.fence(exc)
            raise
        return result.path

    # ------------------------------------------------------------------ release
    async def release(self, reason: str) -> bool:
        """Give the task back before `submit_intent` (21 §6.2, §6.4); True when released."""
        if self.lost.is_set() or self.submit_intent_at is not None:
            return False
        try:
            await self.api.post(
                lease_path(self.task_id, self.lease_id, "release"),
                {"reason": reason},
                idempotency_key=f"release:{self.lease_id}",
            )
        except PilihError as exc:  # incl. 503 temporarily_unavailable on refresh: retryable
            if is_fencing_error(exc) is not None:
                self.mark_lost(is_fencing_error(exc) or "lease_lost")
            log_event(_log, "release_failed", "release failed", level=30, error=str(exc))
            return False
        self.set_local_state("done", released=reason)
        self._emit("log", {"message": f"Lease released ({reason}).", "task_id": self.task_id})
        return True

    async def close(self) -> None:
        self.closed.set()
        if self._flush_timer is not None and not self._flush_timer.done():
            self._flush_timer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._flush_timer
        if self._pending_events:
            self._flush_events_now()


async def upload_file(
    api: ApiClient,
    kind: str,
    path: Path,
    links: dict[str, Any],
    *,
    fence: Callable[[BaseException], None] | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """`POST /api/v1/files` (multipart `meta` + `file`) with the SHA-256 the server re-checks."""
    data = await asyncio.to_thread(path.read_bytes)
    if not data:
        raise UsageError(f"{path.name} is empty; nothing to upload.")
    if len(data) > FILE_UPLOAD_MAX_BYTES:
        raise UsageError(f"{path.name} is larger than 25 MB.")
    content_type = content_type_for(path)
    meta = {
        "kind": kind,
        "sha256": hashlib.sha256(data).hexdigest(),
        "content_type": content_type,
        "size_bytes": len(data),
        "original_name": path.name[:255],
        "links": {k: v for k, v in links.items() if v is not None},
    }
    files = {
        "meta": (None, json.dumps(meta, separators=(",", ":")).encode(), "application/json"),
        "file": (path.name, data, content_type),
    }
    try:
        response = await api.request(
            "POST", "/api/v1/files", files=files, idempotency_key=idempotency_key
        )
    except PilihError as exc:
        if fence is not None:
            fence(exc)
        raise
    record = cast(dict[str, Any], cast(dict[str, Any], response.data)["file"])
    return _with_alias(record, "file")


def _download_target(dest: Path, file_id: str) -> Path:
    """`dest` is a file path, or a directory that receives `<file_id>`."""
    return dest / file_id if dest.is_dir() else dest


def _event_output_type(event: dict[str, Any]) -> str:
    kind = str(event.get("type"))
    return {"progress": "step", "started": "step", "resumed": "step"}.get(kind, kind)


def _event_fields(event: dict[str, Any]) -> dict[str, Any]:
    fields = {k: v for k, v in event.items() if k not in ("type", "idempotency_key")}
    progress = cast(dict[str, Any] | None, fields.pop("progress", None))
    if progress:
        fields.update(progress)
    if event.get("type") in ("started", "resumed"):
        fields.setdefault("message", str(event.get("type")))
    return fields


Sleeper = Callable[[float], Awaitable[None]]
