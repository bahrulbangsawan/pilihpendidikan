"""TWK-LEASE: `ApiLeaseChannel` — the `LeaseChannel` of PLAN C6 (21 §5–§6)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from pilih_jobs.agent.types import LeaseChannel
from pilih_jobs.api.client import ApiClient
from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.errors import UsageError
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.outbox import Outbox
from pilih_jobs.tasks.errors import (
    ArtifactIntegrityError,
    DryRunRefusedError,
    LeaseLostError,
    LeaseStalledError,
)
from pilih_jobs.tasks.lease import ApiLeaseChannel, LeaseGrant
from pilih_jobs.tasks.local import LocalTaskStore
from tests.support.fake_api import FakeApi
from tests.tasks.fakes import CloudFake, sha
from tests.tasks.fixtures import FORM_HASH, FakeClock, claim_grant, flush, make_channel


async def _granted(cloud: CloudFake, api: ApiClient, account: AccountMeta) -> LeaseGrant:
    app = cloud.add_application()
    cloud.queue_task(app_id=app["id"], target=account.device_id)
    return await claim_grant(api, account)


def _entries(runtime: Runtime) -> list[dict[str, object]]:
    return [e.summary() | {"body": e.json()} for e in Outbox(runtime.db, runtime.issuer).entries()]


async def test_TWK_LEASE_channel_satisfies_the_protocol(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    channel = make_channel(runtime, api, await _granted(cloud, api, account))
    assert isinstance(channel.lost, asyncio.Event)
    assert isinstance(channel.cancel_requested, asyncio.Event)
    assert isinstance(channel.resume_requested, asyncio.Event)
    proto: LeaseChannel = channel  # static check: ApiLeaseChannel is a LeaseChannel
    for name in ("events", "create_approval", "poll_approval", "submit_intent", "ai"):
        assert callable(getattr(proto, name))


async def test_TWK_LEASE_events_go_through_the_outbox_as_lease_reports_in_batches_of_50(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    kicks: list[int] = []
    channel = make_channel(
        runtime, api, await _granted(cloud, api, account), kick=lambda: kicks.append(1)
    )
    items = [
        {"type": "progress", "progress": {"stage": "filling", "step": i, "message": f"s{i}"}}
        for i in range(120)
    ]
    await channel.events(items)
    entries = _entries(runtime)
    assert [len(e["body"]["events"]) for e in entries] == [50, 50, 20]  # type: ignore[index]
    assert {e["kind"] for e in entries} == {"lease_report"}
    assert {e["ordering_key"] for e in entries} == {f"lease:{channel.lease_id}"}
    assert kicks, "≥ 50 queued events flush at once"
    assert LocalTaskStore(runtime.db).get(channel.task_id).checkpoint["step"] == 119  # type: ignore[union-attr]
    report = await flush(runtime, api)
    assert report.done == 3
    assert len(cloud.lease_events) == 120
    assert all(e["idempotency_key"].startswith("ev:") for e in cloud.lease_events)


async def test_TWK_LEASE_events_flush_within_5_seconds(
    runtime: Runtime,
    api: ApiClient,
    account: AccountMeta,
    cloud: CloudFake,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("pilih_jobs.tasks.lease.EVENTS_FLUSH_S", 0.05)
    kicks: list[int] = []
    channel = make_channel(
        runtime, api, await _granted(cloud, api, account), kick=lambda: kicks.append(1)
    )
    await channel.events([{"type": "log", "level": "info", "message": "hello"}])
    assert not kicks
    await asyncio.sleep(0.2)
    assert kicks == [1]
    await channel.close()


async def test_TWK_LEASE_submit_intent_events_are_refused_never_queued(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    channel = make_channel(runtime, api, await _granted(cloud, api, account))
    with pytest.raises(UsageError):
        await channel.events([{"type": "submit_intent", "form_hash": FORM_HASH}])
    assert not any("submit-intent" in str(e["path"]) for e in _entries(runtime))
    assert not any(
        e["body"] and "submit_intent" in json.dumps(e["body"]) for e in _entries(runtime)
    )


async def test_TWK_LEASE_submit_intent_is_synchronous_and_recorded_before_returning(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    channel = make_channel(runtime, api, await _granted(cloud, api, account))
    data = await channel.submit_intent(FORM_HASH)
    assert isinstance(data["submit_intent_at"], int)
    assert cloud.intents
    assert cloud.intents[0]["form_hash"] == FORM_HASH
    local = LocalTaskStore(runtime.db).get(channel.task_id)
    assert local is not None
    assert local.local_state == "submit_intent"
    assert local.submit_intent_at == data["submit_intent_at"]
    assert _entries(runtime) == []  # never through the outbox


async def test_TWK_LEASE_submit_intent_with_network_down_raises_and_queues_nothing(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake, fake_api: FakeApi
) -> None:
    channel = make_channel(runtime, api, await _granted(cloud, api, account))
    fake_api.offline = True
    with pytest.raises(Exception) as caught:  # noqa: PT011 - NetworkError
        await channel.submit_intent(FORM_HASH)
    assert caught.value.__class__.__name__ == "NetworkError"
    fake_api.offline = False
    assert cloud.intents == []
    assert _entries(runtime) == []
    assert channel.submit_intent_at is None


async def test_TWK_LEASE_submit_intent_refused_when_stalled_or_dry_run(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    clock = FakeClock()
    channel = make_channel(runtime, api, await _granted(cloud, api, account), monotonic=clock)
    channel.last_ok_mono = clock.now
    clock.advance(95_000)
    with pytest.raises(LeaseStalledError):
        await channel.submit_intent(FORM_HASH)
    dry = make_channel(runtime, api, await _granted(cloud, api, account), dry_run=True)
    with pytest.raises(DryRunRefusedError):
        await dry.submit_intent(FORM_HASH)
    assert cloud.intents == []


async def test_TWK_LEASE_approvals_create_and_poll_follow_local_state(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant = await _granted(cloud, api, account)
    channel = make_channel(runtime, api, grant)
    approval = await channel.create_approval(
        "submit",
        {
            "type": "browser_submit",
            "form_hash": FORM_HASH,
            "url": "https://example.com/apply",
            "posting_id": grant.context["posting"]["id"],
            "fields": [],
            "attachments": [],
        },
        FORM_HASH,
    )
    assert approval["state"] == "pending"
    assert approval["approval"]["id"] == approval["id"]
    assert LocalTaskStore(runtime.db).get(grant.task_id).local_state == "awaiting_approval"  # type: ignore[union-attr]
    cloud.approve_on_poll = "approved"
    polled = await channel.poll_approval(approval["id"])
    assert polled["state"] == "approved"
    assert LocalTaskStore(runtime.db).get(grant.task_id).local_state == "running"  # type: ignore[union-attr]


async def test_TWK_LEASE_ai_calls_carry_the_lease_ref(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant = await _granted(cloud, api, account)
    channel = make_channel(runtime, api, grant)
    body = {"observation": {}, "context": {}}
    with pytest.raises(Exception):  # noqa: B017, PT011 - the contract rejects the empty body
        await channel.ai("field-plan", body)
    assert ApiLeaseChannel.ai_path("/api/v1/ai/verify-submission") == "/api/v1/ai/verify-submission"
    assert ApiLeaseChannel.ai_path("ai/next-action") == "/api/v1/ai/next-action"
    with pytest.raises(UsageError):
        ApiLeaseChannel.ai_path("../files")
    seen: list[dict[str, object]] = []

    async def capture(path: str, payload: dict[str, object]) -> dict[str, object]:
        seen.append({"path": path, **payload})
        return {"ok": True}

    channel.api.post = capture  # type: ignore[method-assign,assignment]
    await channel.ai("page-classify", {"x": 1})
    assert seen[0]["lease_ref"] == {"task_id": grant.task_id, "lease_id": grant.lease_id}
    assert seen[0]["path"] == "/api/v1/ai/page-classify"


async def test_TWK_LEASE_upload_and_verified_download(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake, tmp_path: Path
) -> None:
    grant = await _granted(cloud, api, account)
    channel = make_channel(runtime, api, grant)
    shot = tmp_path / "evidence.png"
    shot.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 64)
    uploaded = await channel.upload_file(
        "evidence_screenshot", shot, {"attempt_id": grant.attempt_id}
    )
    assert uploaded["sha256"] == sha(shot.read_bytes())
    assert uploaded["kind"] == "evidence_screenshot"
    view = cloud.add_file()
    target = await channel.download_file(view["id"], tmp_path / "cv.pdf", view["sha256"])
    assert target.read_bytes().startswith(b"%PDF")
    cloud.content_override[view["id"]] = b"%PDF tampered"
    with pytest.raises(ArtifactIntegrityError):
        await channel.download_file(view["id"], tmp_path / "bad.pdf", view["sha256"])
    assert not (tmp_path / "bad.pdf").exists()


async def test_TWK_LEASE_409_lease_lost_fences_every_later_call(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant = await _granted(cloud, api, account)
    channel = make_channel(runtime, api, grant)
    await channel.events([{"type": "log", "level": "info", "message": "queued before loss"}])
    cloud.lose(grant.task_id)
    with pytest.raises(LeaseLostError):
        await channel.submit_intent(FORM_HASH)
    assert channel.lost.is_set()
    assert channel.lost_reason == "lease_lost"
    assert LocalTaskStore(runtime.db).get(grant.task_id).local_state == "orphaned"  # type: ignore[union-attr]
    # queued step events are never reported under the lost lease
    assert [e["state"] for e in _entries(runtime)] == ["dead"]
    for call in (
        channel.events([{"type": "log", "level": "info", "message": "x"}]),
        channel.poll_approval("apr_01JA6V8M3W8Z1T6Q4Y2B7K9C00"),
    ):
        with pytest.raises(LeaseLostError):
            await call
    assert await channel.release("shutdown") is False


async def test_TWK_LEASE_401_revoked_token_is_a_lost_lease(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake, fake_api: FakeApi
) -> None:
    grant = await _granted(cloud, api, account)
    channel = make_channel(runtime, api, grant)
    for grant_id, fake_grant in fake_api.grants.items():
        if fake_grant.device_id == account.device_id:
            fake_api.revoke_grant(grant_id, "device_revoked")
    with pytest.raises(LeaseLostError):
        await channel.submit_intent(FORM_HASH)
    assert channel.lost.is_set()
    assert channel.lost_reason in ("revoked_token", "invalid_token")
    assert cloud.intents == []


async def test_TWK_LEASE_release_only_before_submit_intent(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant = await _granted(cloud, api, account)
    channel = make_channel(runtime, api, grant)
    assert await channel.release("needs_headed") is True
    assert cloud.releases[-1]["reason"] == "needs_headed"
    assert cloud.tasks[grant.task_id]["state"] == "queued"
    assert cloud.tasks[grant.task_id]["not_before"] > cloud.now()  # re-queued with a backoff
    second = make_channel(runtime, api, await _granted(cloud, api, account))
    await second.submit_intent(FORM_HASH)
    assert await second.release("shutdown") is False  # never after the intent
    assert len(cloud.releases) == 1
