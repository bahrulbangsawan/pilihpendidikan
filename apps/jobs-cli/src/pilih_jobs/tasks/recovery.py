"""Crash recovery from `local_tasks` (16 §7, 21 §8, 20 §6.3 A).

On start the worker (and an interactive `apply`) walks every unfinished local task:

- `sync_pending`: the result is in the outbox: done when delivered, late evidence when it
  died with `lease_lost`;
- `submit_intent` without a recorded result: queue an `outcome_unknown` result (D-19; never
  re-run); the server derives the same on lease expiry;
- `claimed` / `running` / `awaiting_approval` before the intent: the executor died; release
  the lease (`shutdown`) so the task is re-queued;
- `paused` by the user (`apply` Ctrl+C): left for `apply --resume`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import ApiError
from pilih_jobs.errors import PilihError
from pilih_jobs.logging import get_logger, log_event
from pilih_jobs.paths import Paths
from pilih_jobs.storage.db import StateDB
from pilih_jobs.storage.locks import FileLock
from pilih_jobs.sync.outbox import PRIORITY_RESULT, Outbox
from pilih_jobs.tasks.hooks import convert_dead_results
from pilih_jobs.tasks.lease import is_fencing_error, lease_path
from pilih_jobs.tasks.local import LocalTask, LocalTaskStore
from pilih_jobs.tasks.locks import app_lock_path

_log = get_logger("tasks.recovery")


@dataclass
class RecoveryReport:
    released: list[str] = field(default_factory=lambda: [])
    outcome_unknown: list[str] = field(default_factory=lambda: [])
    pending: list[str] = field(default_factory=lambda: [])
    delivered: list[str] = field(default_factory=lambda: [])
    orphaned: list[str] = field(default_factory=lambda: [])
    kept_paused: list[str] = field(default_factory=lambda: [])
    late_evidence: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "released": self.released,
            "outcome_unknown": self.outcome_unknown,
            "pending": self.pending,
            "delivered": self.delivered,
            "orphaned": self.orphaned,
            "kept_paused": self.kept_paused,
            "late_evidence": self.late_evidence,
        }


async def release_lease(api: ApiClient, task_id: str, lease_id: str, reason: str) -> str:
    """Release a lease without a channel: `released`, `gone` (fenced) or `failed`."""
    try:
        await api.post(
            lease_path(task_id, lease_id, "release"),
            {"reason": reason},
            idempotency_key=f"release:{lease_id}",
        )
    except PilihError as exc:
        if is_fencing_error(exc) is not None:
            return "gone"
        if isinstance(exc, ApiError) and exc.error in ("too_late", "not_found"):
            return "gone"
        log_event(_log, "release_failed", "release failed", level=30, error=str(exc))
        return "failed"
    return "released"


def queue_outcome_unknown(
    db: StateDB, issuer: str, store: LocalTaskStore, task: LocalTask, *, reason: str
) -> bool:
    """A result `outcome_unknown` for a task that crashed after `submit_intent` (D-19)."""
    if not task.lease_id:
        return False
    body: dict[str, Any] = {"outcome": "outcome_unknown", "reason": reason[:60]}
    revision = task.checkpoint.get("application_revision")
    if task.kind == "apply" and isinstance(revision, int):
        body["application_update"] = {
            "base_revision": revision,
            "submission_status": "outcome_unknown",
        }
    outbox = Outbox(db, issuer)
    with db.transaction():
        entry = outbox.enqueue(
            "POST",
            lease_path(task.task_id, task.lease_id, "result"),
            body,
            ordering_key=f"lease:{task.lease_id}",
            kind="lease_report",
            priority=PRIORITY_RESULT,
            idempotency_key=f"result:{task.lease_id}",
        )
        store.update(
            task.task_id,
            local_state="sync_pending",
            result_key=entry.idempotency_key,
            outcome="outcome_unknown",
        )
    return True


def _driven_elsewhere(paths: Paths | None, task: LocalTask) -> bool:
    """True when another live process holds the task's application lock (21 §9)."""
    if paths is None or task.kind != "apply" or not task.application_id:
        return False
    try:
        return FileLock(app_lock_path(paths, task.application_id)).is_locked_elsewhere()
    except ValueError:
        return False


async def recover(
    db: StateDB,
    issuer: str,
    api: ApiClient | None,
    *,
    keep_user_paused: bool = True,
    only_application: str | None = None,
    paths: Paths | None = None,
) -> RecoveryReport:
    """Resolve every unfinished local task left by a previous process.

    Tasks whose application lock is held by another live process (an interactive `apply`
    in another terminal) are skipped: they are not abandoned, they are running.
    """
    report = RecoveryReport()
    store = LocalTaskStore(db)
    outbox = Outbox(db, issuer)
    report.late_evidence = convert_dead_results(db, issuer)
    for task in store.open():
        if only_application is not None and task.application_id != only_application:
            continue
        if _driven_elsewhere(paths, task):
            continue
        result_key = task.checkpoint.get("result_key")
        if task.local_state == "sync_pending" or isinstance(result_key, str):
            entry = outbox.get(str(result_key)) if isinstance(result_key, str) else None
            if entry is None or entry.state == "done":
                store.update(task.task_id, local_state="done")
                report.delivered.append(task.task_id)
            elif entry.state == "dead":
                store.update(task.task_id, local_state="orphaned")
                report.orphaned.append(task.task_id)
            else:
                report.pending.append(task.task_id)
            continue
        if task.submit_intent_at is not None or task.local_state == "submit_intent":
            if queue_outcome_unknown(db, issuer, store, task, reason="crash_recovery"):
                report.outcome_unknown.append(task.task_id)
            continue
        if not task.lease_id:
            store.update(task.task_id, local_state="orphaned")
            report.orphaned.append(task.task_id)
            continue
        user_paused = task.checkpoint.get("pause_reason") == "user_requested"
        if task.local_state == "paused" and user_paused and keep_user_paused:
            report.kept_paused.append(task.task_id)
            continue
        if api is None:
            report.pending.append(task.task_id)
            continue
        outcome = await release_lease(api, task.task_id, task.lease_id, "shutdown")
        if outcome == "released":
            store.update(task.task_id, local_state="done", released="shutdown")
            report.released.append(task.task_id)
        elif outcome == "gone":
            store.update(task.task_id, local_state="orphaned", lost_reason="lease_lost")
            report.orphaned.append(task.task_id)
        else:
            report.pending.append(task.task_id)
    store.purge_closed()
    if any(report.as_dict().values()):
        log_event(_log, "recovered", "local tasks recovered", **report.as_dict())
    return report
