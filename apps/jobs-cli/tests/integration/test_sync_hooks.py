"""TCLI-SYNC-HOOKS: `pilih-jobs sync` flushes with the task and discovery hooks.

- a task result that dies with `409 lease_lost` becomes late evidence in the same pass
  (20 §6.3 A, 21 §5.3) instead of waiting for the next worker / `apply` start;
- `postings:batch` outcomes update `seen_postings` (15 §11, 20 §7 step 3).
"""

from __future__ import annotations

import asyncio
import copy
from collections.abc import Callable

from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.contracts import ids
from pilih_jobs.contracts.fingerprint import FingerprintInput, fingerprint, primary_location
from pilih_jobs.discovery.seen import LocalSeenCache
from pilih_jobs.discovery.sync import run_outcomes
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.outbox import PRIORITY_DISCOVERY, PRIORITY_RESULT, Outbox
from pilih_jobs.tasks.hooks import late_evidence_key
from pilih_jobs.tasks.lease import LeaseGrant, lease_path
from pilih_jobs.tasks.local import LocalTaskStore
from tests.discovery.fake_discovery import FakeDiscovery
from tests.support.fake_api import FakeApi, example
from tests.support.helpers import CliResult
from tests.tasks.fakes import CloudFake
from tests.tasks.fixtures import EVIDENCE, claim_grant

Cli = Callable[..., CliResult]


def _claim(runtime: Runtime, account: AccountMeta) -> LeaseGrant:
    async def claim() -> LeaseGrant:
        async with runtime.api_client(allow_personal_token=False) as api:
            return await claim_grant(api, account)

    return asyncio.run(claim())


def test_TCLI_SYNC_HOOKS_a_result_refused_with_lease_lost_becomes_late_evidence(
    runtime: Runtime, account: AccountMeta, cloud: CloudFake, cli: Cli
) -> None:
    app = cloud.add_application()
    cloud.queue_task(app_id=app["id"])
    grant = _claim(runtime, account)
    attempt_id = grant.attempt_id
    assert attempt_id is not None
    store = LocalTaskStore(runtime.db)
    store.upsert(
        grant.task_id,
        kind="apply",
        local_state="sync_pending",
        lease_id=grant.lease_id,
        attempt_id=attempt_id,
        checkpoint={"application_id": app["id"], "submit_intent_at": cloud.now()},
    )
    outbox = Outbox(runtime.db, runtime.issuer)
    with runtime.db.transaction():
        result = outbox.enqueue(
            "POST",
            lease_path(grant.task_id, grant.lease_id, "result"),
            {"outcome": "submitted", "evidence": EVIDENCE},
            ordering_key=f"lease:{grant.lease_id}",
            kind="lease_report",
            priority=PRIORITY_RESULT,
            idempotency_key=f"result:{grant.lease_id}",
        )
        store.update(grant.task_id, result_key=result.idempotency_key)
    # The lease expired (reaper) while the result was still queued on this machine.
    cloud.lose(grant.task_id)

    synced = cli("--json", "sync")

    assert synced.code == 0, synced.stdout + synced.stderr
    assert synced.json["data"]["dead"] == 1
    dead = outbox.get(result.id)
    assert dead is not None
    assert dead.state == "dead"
    assert dead.last_status == 409
    assert cloud.results == []  # nothing recorded under the lost lease
    # The same `sync` pass converted it and delivered the late evidence (20 §6.3 A).
    assert len(cloud.late) == 1
    late = cloud.late[0]
    assert late["task_id"] == grant.task_id
    assert late["attempt_id"] == attempt_id
    assert late["outcome"] == "submitted"
    assert late["evidence"] == EVIDENCE
    delivered = outbox.get(late_evidence_key(attempt_id))
    assert delivered is not None
    assert delivered.state == "done"
    local = store.get(grant.task_id)
    assert local is not None
    assert local.local_state == "done"
    assert local.checkpoint.get("late_evidence_delivered") is True
    assert synced.json["data"]["outbox_depth"] == 0


def _batch_item(run_id: str, device_id: str) -> dict[str, object]:
    item = copy.deepcopy(
        example("POST /api/v1/discovery/runs/{run_id}/postings:batch", "request")["items"][0]
    )
    item["source_job_ref"] = "4019999"
    item["canonical_url"] = "https://boards.greenhouse.io/acme/jobs/4019999"
    item["apply_url"] = "https://job-boards.greenhouse.io/acme/jobs/4019999"
    item["fingerprint"] = fingerprint(
        FingerprintInput(
            source_kind=item["source_kind"],
            title=item["title"],
            source_org=item.get("source_org"),
            source_job_ref=item.get("source_job_ref"),
            company_domain=item.get("company_domain"),
            location_primary=primary_location(item.get("locations")),
            apply_url=item.get("apply_url"),
            canonical_url=item.get("canonical_url"),
        )
    )
    item["extraction"].update(run_id=run_id, device_id=device_id)
    return item


def test_TCLI_SYNC_HOOKS_postings_batch_outcomes_update_the_seen_cache(
    runtime: Runtime, signed_in: AccountMeta, fake_api: FakeApi, user_id: str, cli: Cli
) -> None:
    backend = FakeDiscovery(fake_api, user_id)
    run_id = ids.new_id("run")
    device_id = str(signed_in.device_id)
    create = example("POST /api/v1/discovery/runs", "request")
    create.update(id=run_id, device_id=device_id, started_at=fake_api.now())
    full = _batch_item(run_id, device_id)
    stale_fp = "fp1:" + "a" * 64  # unchanged-only, but the server does not know it
    stale = {"client_ref": "2", "fingerprint": stale_fp, "content_hash": "b" * 64}
    stale["observed_at"] = fake_api.now()
    cache = LocalSeenCache(runtime.db, runtime.issuer)
    cache.record([(stale_fp, "b" * 64, None)], uploaded_at=fake_api.now())
    outbox = Outbox(runtime.db, runtime.issuer)
    create_key = f"run:{run_id}:create"
    with runtime.db.transaction():
        outbox.enqueue(
            "POST",
            "/api/v1/discovery/runs",
            create,
            ordering_key=f"run:{run_id}",
            priority=PRIORITY_DISCOVERY,
            idempotency_key=create_key,
        )
        outbox.enqueue(
            "POST",
            f"/api/v1/discovery/runs/{run_id}/postings:batch",
            {"items": [full, stale]},
            ordering_key=f"run:{run_id}",
            priority=PRIORITY_DISCOVERY,
            depends_on=create_key,
            idempotency_key=f"run:{run_id}:batch:1",
        )

    synced = cli("--json", "sync")

    assert synced.code == 0, synced.stdout + synced.stderr
    assert synced.json["data"]["pushed"] == 2
    assert len(backend.batches) == 1
    assert run_outcomes(runtime.db, run_id) == {"new": 1, "invalid": 1}
    accepted = cache.get(str(full["fingerprint"]))
    assert accepted is not None
    assert accepted.content_hash == full["content_hash"]
    assert accepted.posting_id is not None
    assert accepted.posting_id.startswith("pst_")
    assert cache.get(stale_fp) is None  # forgotten: the next run sends it in full
