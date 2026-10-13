"""Outbox hooks of the task protocol and the late-evidence fallback (20 §6.3 A, §11).

- A delivered task **result** (`…/lease/{l}/result`) closes the local task (`done`).
- A result answered `409 lease_lost` is dead under that lease. When it carries evidence of
  a submission (the server acknowledged `submit_intent` before the lease was lost), the
  evidence is re-sent through `POST /api/v1/tasks/{t}/attempts/{a}/late-evidence`; the
  server records it as an append-only fact. Without evidence the local task is `orphaned`
  (the server derives `outcome_unknown` itself, D-19).
- `convert_dead_results()` repairs the same situation for results that died while another
  process (e.g. `pilih-jobs sync`) flushed the outbox without these hooks.
"""

from __future__ import annotations

import re
from typing import Any, Final, cast

from pilih_jobs.api.client import ApiResponse
from pilih_jobs.api.errors import ApiError
from pilih_jobs.contracts import ids
from pilih_jobs.logging import get_logger, log_event
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.flusher import FlushHooks
from pilih_jobs.sync.outbox import PRIORITY_EVIDENCE, Batch, Outbox, OutboxEntry
from pilih_jobs.tasks.local import LocalTaskStore

_log = get_logger("tasks.hooks")

RESULT_PATH: Final = re.compile(r"^/api/v1/tasks/([^/]+)/lease/([^/]+)/result$")
LATE_PATH: Final = re.compile(r"^/api/v1/tasks/([^/]+)/attempts/([^/]+)/late-evidence$")
LATE_OUTCOMES: Final = ("submitted", "outcome_unknown", "failed")


def late_evidence_key(attempt_id: str) -> str:
    return f"late:{attempt_id}"


def enqueue_late_evidence(
    outbox: Outbox,
    store: LocalTaskStore,
    *,
    task_id: str,
    attempt_id: str,
    evidence: dict[str, Any],
    outcome: str | None = None,
    log_file_id: str | None = None,
) -> OutboxEntry:
    """Queue `POST …/attempts/{a}/late-evidence` (idempotent per attempt)."""
    body: dict[str, Any] = {"evidence": evidence}
    if outcome in LATE_OUTCOMES:
        body["outcome"] = outcome
    if log_file_id:
        body["log_file_id"] = log_file_id
    with outbox.db.transaction():
        entry = outbox.enqueue(
            "POST",
            f"/api/v1/tasks/{task_id}/attempts/{attempt_id}/late-evidence",
            body,
            ordering_key=f"task:{task_id}",
            kind="append",
            priority=PRIORITY_EVIDENCE,
            idempotency_key=late_evidence_key(attempt_id),
        )
        store.update(task_id, local_state="orphaned", late_evidence=entry.idempotency_key)
    log_event(
        _log,
        "late_evidence_queued",
        "lease lost after submit_intent: evidence queued for the late-evidence path",
        task_id=task_id,
        attempt_id=attempt_id,
    )
    return entry


def handle_dead_result(
    outbox: Outbox, store: LocalTaskStore, entry: OutboxEntry, error: ApiError | None
) -> OutboxEntry | None:
    """A result that cannot be delivered: late evidence when it carries evidence."""
    match = RESULT_PATH.match(entry.path)
    if match is None:
        return None
    task_id = match.group(1)
    local = store.get(task_id)
    lease_lost = error is not None and error.error == "lease_lost"
    body = cast(dict[str, Any], entry.json() or {})
    evidence = body.get("evidence")
    attempt_id = local.attempt_id if local is not None else None
    if lease_lost and isinstance(evidence, dict) and attempt_id:
        return enqueue_late_evidence(
            outbox,
            store,
            task_id=task_id,
            attempt_id=attempt_id,
            evidence=cast(dict[str, Any], evidence),
            outcome=cast(str | None, body.get("outcome")),
            log_file_id=cast(str | None, body.get("log_file_id")),
        )
    if local is not None:
        store.update(
            task_id,
            local_state="orphaned",
            result_error=(error.error if error is not None else "undeliverable"),
        )
    return None


def install_task_hooks(hooks: FlushHooks, db: StateDB, issuer: str) -> FlushHooks:
    """Register the task hooks on a `FlushHooks` (the worker, `apply`, `sync`)."""
    store = LocalTaskStore(db)
    outbox = Outbox(db, issuer)

    def result_done(batch: Batch, response: ApiResponse) -> None:
        match = RESULT_PATH.match(batch.path)
        if match is None:
            return
        data = cast(dict[str, Any], response.data or {})
        task = cast(dict[str, Any], data.get("task") or {})
        store.update(
            match.group(1),
            local_state="done",
            server_state=task.get("state"),
            conflict_recorded=bool(data.get("conflict_recorded")),
            synced_at=ids.now_ms(),
        )

    def result_dead(entry: OutboxEntry, error: ApiError | None) -> None:
        handle_dead_result(outbox, store, entry, error)

    def late_done(batch: Batch, _response: ApiResponse) -> None:
        match = LATE_PATH.match(batch.path)
        if match is not None:
            store.update(match.group(1), local_state="done", late_evidence_delivered=True)

    def late_dead(entry: OutboxEntry, error: ApiError | None) -> None:
        match = LATE_PATH.match(entry.path)
        if match is not None:
            store.update(
                match.group(1),
                local_state="orphaned",
                late_evidence_error=error.error if error is not None else "undeliverable",
            )

    hooks.on_success(RESULT_PATH.pattern, result_done)
    hooks.on_dead(RESULT_PATH.pattern, result_dead)
    hooks.on_success(LATE_PATH.pattern, late_done)
    hooks.on_dead(LATE_PATH.pattern, late_dead)
    return hooks


def task_hooks(db: StateDB, issuer: str) -> FlushHooks:
    """Task hooks plus discovery's (postings:batch outcomes update the seen cache, 15 §11)."""
    from pilih_jobs.discovery.sync import register_flush_hooks

    hooks = install_task_hooks(FlushHooks(), db, issuer)
    return register_flush_hooks(hooks, db, issuer)


def convert_dead_results(db: StateDB, issuer: str) -> int:
    """Late evidence for results that died (`lease_lost`) without the hooks; returns count."""
    outbox = Outbox(db, issuer)
    store = LocalTaskStore(db)
    converted = 0
    for entry in outbox.entries(["dead"]):
        if RESULT_PATH.match(entry.path) is None or entry.last_status != 409:
            continue
        if "lease_lost" not in (entry.last_error or ""):
            continue
        task_id = cast(re.Match[str], RESULT_PATH.match(entry.path)).group(1)
        local = store.get(task_id)
        if local is None or local.checkpoint.get("late_evidence"):
            continue
        fake = ApiError(status=409, error="lease_lost", message="lease lost")
        if handle_dead_result(outbox, store, entry, fake) is not None:
            converted += 1
    return converted
