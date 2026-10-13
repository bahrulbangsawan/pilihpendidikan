"""TWK-RECOVERY: crash recovery from `local_tasks` (16 §7, 21 §8, 20 §6.3 A)."""

from __future__ import annotations

from typing import Any

from pilih_jobs.api.client import ApiClient
from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.outbox import PRIORITY_RESULT, Outbox
from pilih_jobs.tasks.hooks import convert_dead_results
from pilih_jobs.tasks.lease import LeaseGrant
from pilih_jobs.tasks.local import LocalTaskStore
from pilih_jobs.tasks.locks import acquire_app_lock
from pilih_jobs.tasks.recovery import recover
from tests.tasks.fakes import CloudFake
from tests.tasks.fixtures import EVIDENCE, claim_grant, flush


async def _claimed(
    runtime: Runtime,
    cloud: CloudFake,
    api: ApiClient,
    account: AccountMeta,
    state: str,
    **checkpoint: object,
) -> tuple[LeaseGrant, dict[str, Any]]:
    app = cloud.add_application()
    cloud.queue_task(app_id=app["id"])
    grant = await claim_grant(api, account)
    store = LocalTaskStore(runtime.db)
    store.upsert(
        grant.task_id,
        kind="apply",
        local_state=state,
        lease_id=grant.lease_id,
        attempt_id=grant.attempt_id or cloud.attempts[grant.task_id][-1]["id"],
        checkpoint={
            "application_id": app["id"],
            "application_revision": app["revision"],
            **checkpoint,
        },
    )
    return grant, app


async def test_TWK_RECOVERY_releases_a_task_that_died_before_the_intent(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant, _ = await _claimed(runtime, cloud, api, account, "running")
    report = await recover(runtime.db, runtime.issuer, api, paths=runtime.paths)
    assert report.released == [grant.task_id]
    assert cloud.releases == [{"task_id": grant.task_id, "reason": "shutdown"}]
    assert LocalTaskStore(runtime.db).get(grant.task_id).local_state == "done"  # type: ignore[union-attr]


async def test_TWK_RECOVERY_a_crash_after_the_intent_is_reported_outcome_unknown(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant, app = await _claimed(runtime, cloud, api, account, "submit_intent", submit_intent_at=123)
    cloud.tasks[grant.task_id]["submit_intent_at"] = 123
    report = await recover(runtime.db, runtime.issuer, api, paths=runtime.paths)
    assert report.outcome_unknown == [grant.task_id]
    assert cloud.releases == []
    entry = Outbox(runtime.db, runtime.issuer).get(f"result:{grant.lease_id}")
    assert entry is not None
    assert entry.kind == "lease_report"
    assert entry.priority == PRIORITY_RESULT
    assert entry.json() == {
        "outcome": "outcome_unknown",
        "reason": "crash_recovery",
        "application_update": {
            "base_revision": app["revision"],
            "submission_status": "outcome_unknown",
        },
    }
    await flush(runtime, api)
    assert cloud.results[-1]["outcome"] == "outcome_unknown"
    assert LocalTaskStore(runtime.db).get(grant.task_id).local_state == "done"  # type: ignore[union-attr]


async def test_TWK_RECOVERY_sync_pending_results_are_closed_once_delivered(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant, _ = await _claimed(runtime, cloud, api, account, "sync_pending")
    outbox = Outbox(runtime.db, runtime.issuer)
    entry = outbox.enqueue(
        "POST",
        f"/api/v1/tasks/{grant.task_id}/lease/{grant.lease_id}/result",
        {"outcome": "cancelled", "reason": "cancel_requested"},
        ordering_key=f"lease:{grant.lease_id}",
        kind="lease_report",
        idempotency_key=f"result:{grant.lease_id}",
    )
    LocalTaskStore(runtime.db).update(grant.task_id, result_key=entry.idempotency_key)
    first = await recover(runtime.db, runtime.issuer, api)
    assert first.pending == [grant.task_id]
    await flush(runtime, api)
    second = await recover(runtime.db, runtime.issuer, api)
    assert grant.task_id not in second.pending
    assert LocalTaskStore(runtime.db).get(grant.task_id).local_state == "done"  # type: ignore[union-attr]


async def test_TWK_RECOVERY_dead_results_with_evidence_become_late_evidence(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant, _ = await _claimed(runtime, cloud, api, account, "sync_pending", submit_intent_at=1)
    outbox = Outbox(runtime.db, runtime.issuer)
    entry = outbox.enqueue(
        "POST",
        f"/api/v1/tasks/{grant.task_id}/lease/{grant.lease_id}/result",
        {"outcome": "submitted", "evidence": EVIDENCE},
        ordering_key=f"lease:{grant.lease_id}",
        kind="lease_report",
        idempotency_key=f"result:{grant.lease_id}",
    )
    # Delivered by a plain `pilih-jobs sync` (no task hooks) after the lease expired.
    outbox.mark_dead([entry.id], status=409, error="lease_lost: the lease is not held")
    assert convert_dead_results(runtime.db, runtime.issuer) == 1
    assert convert_dead_results(runtime.db, runtime.issuer) == 0  # idempotent
    await flush(runtime, api)
    attempt_id = LocalTaskStore(runtime.db).get(grant.task_id).attempt_id  # type: ignore[union-attr]
    assert cloud.late[-1]["attempt_id"] == attempt_id
    assert cloud.late[-1]["outcome"] == "submitted"


async def test_TWK_RECOVERY_keeps_user_paused_attempts_for_resume(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant, _ = await _claimed(runtime, cloud, api, account, "paused", pause_reason="user_requested")
    report = await recover(runtime.db, runtime.issuer, api)
    assert report.kept_paused == [grant.task_id]
    assert cloud.releases == []


async def test_TWK_RECOVERY_skips_applications_driven_by_another_process(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant, app = await _claimed(runtime, cloud, api, account, "running")
    held = acquire_app_lock(runtime.paths, app["id"])
    try:
        report = await recover(runtime.db, runtime.issuer, api, paths=runtime.paths)
    finally:
        held.release()
    assert grant.task_id not in report.released
    assert cloud.releases == []
    assert LocalTaskStore(runtime.db).get(grant.task_id).local_state == "running"  # type: ignore[union-attr]


async def test_TWK_RECOVERY_a_lease_already_gone_is_orphaned(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant, _ = await _claimed(runtime, cloud, api, account, "claimed")
    cloud.lose(grant.task_id)
    report = await recover(runtime.db, runtime.issuer, api)
    assert report.orphaned == [grant.task_id]
    assert LocalTaskStore(runtime.db).get(grant.task_id).local_state == "orphaned"  # type: ignore[union-attr]


async def test_TWK_RECOVERY_offline_leaves_tasks_for_the_next_start(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant, _ = await _claimed(runtime, cloud, api, account, "running")
    cloud.fake.offline = True
    report = await recover(runtime.db, runtime.issuer, api)
    cloud.fake.offline = False
    assert report.pending == [grant.task_id]
    assert LocalTaskStore(runtime.db).get(grant.task_id).local_state == "running"  # type: ignore[union-attr]
