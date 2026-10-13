"""The outbox flusher (20 §5.3, §5.5).

One flusher per data dir at a time: it holds `<data>/state.lock`; a second process that
cannot take the lock only enqueues (20 §12 F4). Per round it sends the eligible heads
(lease reports first), at most `concurrency` requests in flight, each with the entry's
(or batch's) stable `Idempotency-Key`, and classifies the outcome:

| Response                                   | Action                                         |
|--------------------------------------------|------------------------------------------------|
| 2xx (incl. an idempotent replay)           | `done` (all children of a batch together)      |
| network error, timeout, 5xx, 503           | `pending`, full-jitter backoff                 |
| 429                                        | `pending`, `max(Retry-After, backoff)`         |
| 401 after the one refresh / invalid_grant  | stop flushing, entries stay `pending` (*)      |
| 409 revision_conflict                      | resolver (default `conflict`, blocks its key)  |
| 409 idempotency_mismatch / lease_lost / …  | `dead`                                         |
| 400 / 403 / 404 / 410 / 413 / 422          | `dead` with the server message                 |
| 426                                        | stop flushing, entries kept                    |

(*) re-sent after the next login as the same user (20 §5.3). Only a deleted account
(`401` with `details.revoked_reason = "account_deleted"`) has its local data wiped by
`auth.session`, the outbox included (11 §10 step 6).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final, Literal, cast

from pilih_jobs.api.client import ApiClient, ApiResponse
from pilih_jobs.api.errors import (
    ApiAuthError,
    ApiConflictError,
    ApiError,
    ApiUnavailableError,
    NetworkError,
)
from pilih_jobs.contracts import ids
from pilih_jobs.errors import NotAuthenticatedError, UpgradeRequiredError
from pilih_jobs.logging import get_logger, log_event
from pilih_jobs.storage.locks import FileLock
from pilih_jobs.sync.backoff import retry_delay_ms
from pilih_jobs.sync.outbox import Batch, Outbox, OutboxEntry

DEFAULT_CONCURRENCY: Final = 4
_log = get_logger("sync.flusher")

Resolution = Literal["conflict", "dead", "keep_server"]
PauseReason = Literal["locked", "auth", "upgrade"]

SuccessHook = Callable[[Batch, ApiResponse], None]
DeadHook = Callable[[OutboxEntry, ApiError | None], None]
ConflictResolver = Callable[[OutboxEntry, ApiConflictError], Resolution]

_SOURCE_PATCH = re.compile(r"^/api/v1/sources/[^/]+$")


def keep_server_cursor(entry: OutboxEntry, error: ApiConflictError) -> Resolution:
    """`job_sources.cursor_state` on 409: keep the server value (20 §6.2)."""
    body = entry.json()
    if isinstance(body, dict) and set(cast(dict[str, Any], body)) <= {
        "base_revision",
        "cursor_state",
    }:
        return "keep_server"
    return "conflict"


class UploadError(Exception):
    """A queued upload cannot be sent (missing/changed/escaping staged file)."""


@dataclass
class FlushHooks:
    """Extension points for producers (discovery, tasks): handlers keyed by a path regex
    (`re.search` semantics, so anchor with `^…$` when needed)."""

    success: list[tuple[re.Pattern[str], SuccessHook]] = field(default_factory=lambda: [])
    dead: list[tuple[re.Pattern[str], DeadHook]] = field(default_factory=lambda: [])
    resolvers: list[tuple[str, re.Pattern[str], ConflictResolver]] = field(
        default_factory=lambda: [("PATCH", _SOURCE_PATCH, keep_server_cursor)]
    )

    def on_success(self, path_regex: str, hook: SuccessHook) -> None:
        self.success.append((re.compile(path_regex), hook))

    def on_dead(self, path_regex: str, hook: DeadHook) -> None:
        self.dead.append((re.compile(path_regex), hook))

    def resolve_conflicts(self, method: str, path_regex: str, resolver: ConflictResolver) -> None:
        self.resolvers.insert(0, (method.upper(), re.compile(path_regex), resolver))

    def resolution(self, entry: OutboxEntry, error: ApiConflictError) -> Resolution:
        for method, pattern, resolver in self.resolvers:
            if entry.method == method and pattern.search(entry.path):
                return resolver(entry, error)
        return "conflict"


@dataclass
class FlushReport:
    sent: int = 0
    done: int = 0
    retried: int = 0
    conflicts: int = 0
    dead: int = 0
    replayed: int = 0
    paused: PauseReason | None = None
    pause_message: str | None = None
    errors: list[str] = field(default_factory=lambda: [])

    def as_dict(self) -> dict[str, Any]:
        return {
            "sent": self.sent,
            "done": self.done,
            "retried": self.retried,
            "conflicts": self.conflicts,
            "dead": self.dead,
            "replayed": self.replayed,
            "paused": self.paused,
        }


@dataclass
class _Outcome:
    batch: Batch
    response: ApiResponse | None = None
    error: BaseException | None = None


def _error_text(error: BaseException) -> str:
    if isinstance(error, ApiError):
        return f"{error.error}: {error.message}"
    return f"{type(error).__name__}: {error}"


class OutboxFlusher:
    def __init__(
        self,
        outbox: Outbox,
        api: ApiClient,
        *,
        state_lock: FileLock | None = None,
        concurrency: int = DEFAULT_CONCURRENCY,
        hooks: FlushHooks | None = None,
        rng: Callable[[], float] | None = None,
        now: Callable[[], int] = ids.now_ms,
        upload_root: Path | None = None,
    ) -> None:
        self.outbox = outbox
        self.api = api
        self.state_lock = state_lock
        self.concurrency = max(1, concurrency)
        self.hooks = hooks or FlushHooks()
        self._rng = rng
        self._now = now
        self.upload_root = upload_root.resolve() if upload_root is not None else None

    def _delay(self, attempts: int, retry_after: float | None) -> int:
        if self._rng is None:
            return retry_delay_ms(attempts, retry_after_s=retry_after)
        return retry_delay_ms(attempts, retry_after_s=retry_after, rng=self._rng)

    async def flush(self, *, max_rounds: int = 10_000) -> FlushReport:
        report = FlushReport()
        if self.state_lock is not None and not self.state_lock.try_acquire():
            report.paused = "locked"
            report.pause_message = "another pilih-jobs process is flushing the outbox"
            return report
        try:
            self.outbox.recover_inflight()
            report.dead += self.outbox.expire_old()
            report.dead += self.outbox.kill_orphans()
            for _ in range(max_rounds):
                heads = self.outbox.ready(limit=self.concurrency * 4)
                if not heads:
                    break
                leases = [h for h in heads if h.kind == "lease_report"]
                phase = (leases or heads)[: self.concurrency]
                batches = [self.outbox.batch_for(head) for head in phase]
                for batch in batches:
                    self.outbox.mark_inflight(batch.ids)
                outcomes = await asyncio.gather(*(self._send(b) for b in batches))
                for outcome in outcomes:
                    self._apply(outcome, report)
                if report.paused is not None:
                    break
                report.dead += self.outbox.kill_orphans()
        finally:
            if self.state_lock is not None and self.state_lock.held:
                self.state_lock.release()
        return report

    def _multipart(self, entry: OutboxEntry) -> dict[str, Any]:
        """The `files=` argument of an upload entry; raises UploadError when unusable."""
        body: Any = entry.json()
        raw_manifest: Any = (
            cast(dict[str, Any], body).get("multipart") if isinstance(body, dict) else None
        )
        if not isinstance(raw_manifest, dict):
            raise UploadError("upload entry without a multipart manifest")
        manifest = cast(dict[str, Any], raw_manifest)
        file_info = cast(dict[str, Any], manifest.get("file") or {})
        if self.upload_root is None:
            raise UploadError("no upload root configured for staged files")
        raw = Path(str(file_info.get("path", "")))
        if raw.is_symlink():
            raise UploadError("staged file is a symlink")
        resolved = raw.resolve()
        if not resolved.is_relative_to(self.upload_root) or not resolved.is_file():
            raise UploadError("staged file is missing or outside the data directory")
        data = resolved.read_bytes()
        expected = file_info.get("sha256")
        if isinstance(expected, str) and hashlib.sha256(data).hexdigest() != expected:
            raise UploadError("staged file changed since it was queued (sha256 mismatch)")
        meta = json.dumps(manifest.get("meta") or {}, separators=(",", ":"))
        return {
            "meta": (None, meta.encode("utf-8"), "application/json"),
            "file": (
                str(file_info.get("filename") or resolved.name),
                data,
                str(file_info.get("content_type") or "application/octet-stream"),
            ),
        }

    async def _send(self, batch: Batch) -> _Outcome:
        headers = {"Content-Type": "application/json"} if batch.body is not None else None
        try:
            if batch.head.kind == "upload":
                files = self._multipart(batch.head)
                response = await self.api.request(
                    batch.method,
                    batch.path,
                    files=files,
                    idempotency_key=batch.idempotency_key,
                )
            else:
                response = await self.api.request(
                    batch.method,
                    batch.path,
                    content=batch.body,
                    headers=headers,
                    idempotency_key=batch.idempotency_key,
                )
        except UploadError as exc:
            return _Outcome(batch, error=exc)
        except (ApiError, NetworkError, NotAuthenticatedError, UpgradeRequiredError) as exc:
            return _Outcome(batch, error=exc)
        except Exception as exc:  # noqa: BLE001 - any other failure is retried with backoff
            return _Outcome(batch, error=exc)
        return _Outcome(batch, response=response)

    def _apply(self, outcome: _Outcome, report: FlushReport) -> None:
        batch, entry_ids = outcome.batch, outcome.batch.ids
        report.sent += 1
        if outcome.response is not None:
            self.outbox.mark_done(entry_ids, outcome.response.status)
            report.done += len(entry_ids)
            report.replayed += int(outcome.response.replayed)
            for pattern, hook in self.hooks.success:
                if pattern.search(batch.path):
                    hook(batch, outcome.response)
            return
        error = outcome.error
        if error is None:  # pragma: no cover - an outcome has a response or an error
            raise RuntimeError("outbox outcome without response or error")
        attempts = batch.head.attempts + 1
        if isinstance(error, UpgradeRequiredError):
            self.outbox.mark_pending_now(entry_ids)
            report.paused, report.pause_message = "upgrade", error.message
        elif isinstance(error, ApiAuthError | NotAuthenticatedError):
            self.outbox.mark_pending_now(entry_ids)
            report.paused, report.pause_message = "auth", error.message
        elif isinstance(error, NetworkError | ApiUnavailableError):
            retry_after = error.retry_after if isinstance(error, ApiUnavailableError) else None
            self.outbox.mark_retry(
                entry_ids,
                status=error.status if isinstance(error, ApiError) else None,
                error=_error_text(error),
                next_attempt_at=self._now() + self._delay(attempts, retry_after),
            )
            report.retried += len(entry_ids)
        elif isinstance(error, UploadError):
            self._kill(batch, None, f"upload refused: {error}", report)
        elif isinstance(error, ApiConflictError) and error.error == "revision_conflict":
            self._conflict(batch, error, report)
        elif isinstance(error, ApiError):
            message = _error_text(error)
            if error.error == "idempotency_mismatch":
                message = (
                    "bug: the idempotency key was reused with a different body "
                    f"(request {error.request_id or '-'}): {error.message}"
                )
            self._kill(batch, error, message, report)
        else:
            self.outbox.mark_retry(
                entry_ids,
                status=None,
                error=_error_text(error),
                next_attempt_at=self._now() + self._delay(attempts, None),
            )
            report.retried += len(entry_ids)
            report.errors.append(_error_text(error))
        log_event(
            _log,
            "outbox_failure",
            f"{batch.method} {batch.path} failed",
            level=30,
            error=_error_text(error),
            entries=len(entry_ids),
        )

    def _kill(
        self, batch: Batch, error: ApiError | None, message: str, report: FlushReport
    ) -> None:
        self.outbox.mark_dead(
            batch.ids, status=error.status if error is not None else None, error=message
        )
        report.dead += len(batch.ids)
        for entry in batch.entries:
            for pattern, hook in self.hooks.dead:
                if pattern.search(entry.path):
                    hook(entry, error)

    def _conflict(self, batch: Batch, error: ApiConflictError, report: FlushReport) -> None:
        current = error.current or {}
        revision = current.get("revision")
        detail = json.dumps(
            {
                "code": error.error,
                "message": error.message,
                "current_revision": revision if isinstance(revision, int) else None,
            },
            separators=(",", ":"),
        )
        resolution = self.hooks.resolution(batch.head, error)
        if resolution == "keep_server":
            self._kill(
                batch, error, f"superseded: the server value was kept (20 §6.2) {detail}", report
            )
        elif resolution == "dead":
            self._kill(batch, error, detail, report)
        else:
            self.outbox.mark_conflict(batch.ids, status=error.status, error=detail)
            report.conflicts += len(batch.ids)


def conflict_revision(entry: OutboxEntry) -> int | None:
    """The server revision recorded with a conflict (for `sync --retry` re-basing)."""
    if not entry.last_error:
        return None
    text = entry.last_error
    start = text.find("{")
    if start == -1:
        return None
    try:
        data = json.loads(text[start:])
    except json.JSONDecodeError:
        return None
    if isinstance(data, dict):
        value = cast(dict[str, Any], data).get("current_revision")
        return value if isinstance(value, int) else None
    return None
