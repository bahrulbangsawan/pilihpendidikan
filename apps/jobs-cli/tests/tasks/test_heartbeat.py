"""TWK-HEARTBEAT and T21-10: lease heartbeats, the 90 s / 110 s local deadlines on a
monotonic clock, and an executor that stops between actions once the lease is lost."""

from __future__ import annotations

import ast
import asyncio
from pathlib import Path

from pilih_jobs.api.client import ApiClient
from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.outbox import Outbox
from pilih_jobs.tasks.lease import LeaseGrant
from pilih_jobs.tasks.local import LocalTaskStore
from tests.support.fake_api import FakeApi
from tests.tasks.fakes import CloudFake
from tests.tasks.fixtures import FakeClock, claim_grant, make_channel

TASKS_DIR = Path(__file__).resolve().parents[2] / "src" / "pilih_jobs" / "tasks"


async def _granted(cloud: CloudFake, api: ApiClient, account: AccountMeta) -> LeaseGrant:
    app = cloud.add_application()
    cloud.queue_task(app_id=app["id"], target=account.device_id)
    return await claim_grant(api, account)


async def test_T21_10_lease_is_lost_at_110_s_without_heartbeat_on_a_monotonic_clock(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    clock = FakeClock()
    grant = await _granted(cloud, api, account)
    grant.claimed_mono_ms = clock.now
    # The server time at grant (the CLI reads its corrected clock when the claim arrives,
    # a few ms after the server granted): pin it so the 90 s / 110 s marks are exact.
    grant.server_time = grant.expires_at - cloud.lease_ms
    channel = make_channel(runtime, api, grant, monotonic=clock)
    assert channel.check_deadline() == "ok"
    clock.advance(89_999)
    assert channel.check_deadline() == "ok"
    clock.advance(1)
    assert channel.check_deadline() == "stalled"
    assert channel.stalled.is_set()
    assert not channel.lost.is_set()
    clock.advance(19_999)
    assert channel.check_deadline() == "stalled"
    clock.advance(1)  # 110 s
    assert channel.check_deadline() == "lost"
    assert channel.lost.is_set()
    assert channel.lost_reason == "local_deadline"
    assert LocalTaskStore(runtime.db).get(grant.task_id).local_state == "orphaned"  # type: ignore[union-attr]


async def test_T21_10_wall_clock_jumps_cannot_extend_the_lease(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    clock = FakeClock()
    grant = await _granted(cloud, api, account)
    grant.claimed_mono_ms = clock.now
    # The corrected wall clock jumps two hours back: only the monotonic clock counts.
    channel = make_channel(runtime, api, grant, monotonic=clock, now_ms=lambda: 0)
    clock.advance(110_000)
    assert channel.check_deadline() == "lost"


async def test_T21_10_a_successful_heartbeat_clears_the_90_s_pause(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    clock = FakeClock()
    grant = await _granted(cloud, api, account)
    grant.claimed_mono_ms = clock.now
    channel = make_channel(runtime, api, grant, monotonic=clock)
    clock.advance(95_000)
    assert channel.check_deadline() == "stalled"
    assert not channel.healthy.is_set()
    assert await channel.heartbeat_once() is True
    assert not channel.stalled.is_set()
    assert channel.healthy.is_set()
    clock.advance(100_000)
    assert channel.check_deadline() == "stalled"  # measured from the last good beat


async def test_T21_10_the_executor_stops_between_actions_once_lost(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    clock = FakeClock()
    grant = await _granted(cloud, api, account)
    grant.claimed_mono_ms = clock.now
    channel = make_channel(runtime, api, grant, monotonic=clock)
    actions: list[int] = []

    async def executor() -> str:
        for step in range(100):
            if channel.lost.is_set():
                return f"stopped after {len(actions)}"
            actions.append(step)
            if step == 3:
                clock.advance(110_000)  # the laptop slept
            await asyncio.sleep(0)
        return "ran to the end"

    watchdog = asyncio.create_task(channel.watchdog(interval_s=0))
    outcome = await asyncio.wait_for(executor(), 5)
    await channel.close()
    await watchdog
    assert outcome.startswith("stopped")
    assert len(actions) < 10
    assert cloud.intents == []


def test_T21_10_the_heartbeat_task_never_touches_playwright() -> None:
    """tasks/ only signals asyncio Events; no module of the package imports Playwright."""
    for path in TASKS_DIR.glob("*.py"):
        tree = ast.parse(path.read_text("utf-8"))
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            assert not any(n.split(".")[0] == "playwright" for n in names), path.name


async def test_TWK_HEARTBEAT_delivers_cancel_and_resume_requests(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant = await _granted(cloud, api, account)
    channel = make_channel(runtime, api, grant)
    assert await channel.heartbeat_once()
    assert cloud.tasks[grant.task_id]["state"] == "running"  # claimed → running
    assert not channel.cancel_requested.is_set()
    cloud.cancel(grant.task_id)
    cloud.resume(grant.task_id)
    assert await channel.heartbeat_once()
    assert channel.cancel_requested.is_set()
    assert channel.server_cancel
    assert channel.resume_requested.is_set()


async def test_TWK_HEARTBEAT_reports_progress_and_local_state(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant = await _granted(cloud, api, account)
    channel = make_channel(runtime, api, grant)
    await channel.events(
        [{"type": "progress", "progress": {"stage": "uploading", "step": 7, "message": "CV"}}]
    )
    await channel.heartbeat_once()
    beat = cloud.heartbeats[-1]
    assert beat["progress"]["stage"] == "uploading"
    assert beat["progress"]["step"] == 7
    assert beat["local_state"] == "claimed"


async def test_TWK_HEARTBEAT_409_sets_lost(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant = await _granted(cloud, api, account)
    channel = make_channel(runtime, api, grant)
    cloud.lose(grant.task_id)
    assert await channel.heartbeat_once() is False
    assert channel.lost.is_set()
    assert channel.lost_reason == "lease_lost"


async def test_TWK_HEARTBEAT_401_revoked_is_treated_like_lease_lost(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake, fake_api: FakeApi
) -> None:
    grant = await _granted(cloud, api, account)
    channel = make_channel(runtime, api, grant)
    device = fake_api.devices[str(account.device_id)]
    device["revoked_at"] = fake_api.now()
    assert await channel.heartbeat_once() is False
    assert channel.lost.is_set()


async def test_TWK_HEARTBEAT_network_failures_keep_the_lease_until_the_deadline(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake, fake_api: FakeApi
) -> None:
    clock = FakeClock()
    grant = await _granted(cloud, api, account)
    grant.claimed_mono_ms = clock.now
    channel = make_channel(runtime, api, grant, monotonic=clock)
    fake_api.offline = True
    clock.advance(40_000)
    assert await channel.heartbeat_once() is False
    assert channel.heartbeats_failed == 1
    assert not channel.lost.is_set()
    fake_api.offline = False
    assert await channel.heartbeat_once() is True
    assert channel.since_last_ok_ms() == 0


async def test_TWK_HEARTBEAT_observes_server_time_and_poll_interval(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant = await _granted(cloud, api, account)
    seen: list[int] = []
    cloud.poll_interval_ms = 5_000
    channel = make_channel(runtime, api, grant, on_poll_interval=seen.append)
    await channel.heartbeat_once()
    assert seen == [5_000]
    assert runtime.clock.sample is not None
    assert channel.lease_expires_at >= grant.expires_at


async def test_TWK_HEARTBEAT_uses_its_own_client_and_never_the_outbox(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    grant = await _granted(cloud, api, account)
    second = runtime.authenticated_client(allow_personal_token=False)
    try:
        channel = make_channel(runtime, api, grant, heartbeat_api=second)
        assert channel.heartbeat_api is second
        assert channel.api is api
        task = asyncio.create_task(channel.run_heartbeats())
        await asyncio.sleep(0.2)
        await channel.close()
        await task
    finally:
        await second.aclose()
    assert cloud.heartbeats, "at least one heartbeat was sent"
    assert Outbox(runtime.db, runtime.issuer).entries() == []


async def test_TWK_HEARTBEAT_refresh_race_503_is_retryable_not_a_lost_lease(
    runtime: Runtime, api: ApiClient, account: AccountMeta, cloud: CloudFake, fake_api: FakeApi
) -> None:
    grant = await _granted(cloud, api, account)
    channel = make_channel(runtime, api, grant)
    fake_api.expire_access_tokens()
    fake_api.fail_next("POST", "^/oauth/token$", 503, "temporarily_unavailable")
    assert await channel.heartbeat_once() is False
    assert not channel.lost.is_set()
    assert channel.heartbeats_failed == 1
    assert await channel.heartbeat_once() is True  # the next beat refreshes and succeeds
    assert runtime.account() is not None  # never signed out
