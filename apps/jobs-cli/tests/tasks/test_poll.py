"""TWK-POLL: the adaptive poll interval, `tasks:claim`, backpressure and claim slots
(21 §1.1, §3, §5.1; 16 §7)."""

from __future__ import annotations

import re

from pilih_jobs.api.client import ApiClient
from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.outbox import Outbox
from pilih_jobs.tasks.poll import PollPolicy, claim
from pilih_jobs.tasks.worker import Worker, WorkerOptions
from tests.tasks.fakes import CloudFake
from tests.tasks.fixtures import FakeClock


def _policy(clock: FakeClock, rng: float = 0.5) -> PollPolicy:
    return PollPolicy(monotonic=clock, rng=lambda: rng)


def test_TWK_POLL_idle_interval_is_30_s_with_20_percent_jitter() -> None:
    clock = FakeClock()
    assert _policy(clock, 0.5).next_delay_ms() == 30_000
    assert _policy(clock, 0.0).next_delay_ms() == 24_000
    assert _policy(clock, 1.0).next_delay_ms() == 36_000


def test_TWK_POLL_active_after_a_claim_or_a_task_created_here() -> None:
    clock = FakeClock()
    policy = _policy(clock)
    policy.work_claimed()
    assert policy.next_delay_ms() == 5_000
    clock.advance(5 * 60_000 + 1)
    assert policy.next_delay_ms() == 30_000
    policy.task_created()
    assert policy.next_delay_ms() == 5_000


def test_TWK_POLL_dormant_after_an_hour_without_work() -> None:
    clock = FakeClock()
    policy = _policy(clock)
    clock.advance(3_600_000)
    assert policy.next_delay_ms() == 60_000


def test_TWK_POLL_server_interval_and_retry_after_win() -> None:
    clock = FakeClock()
    policy = _policy(clock)
    policy.observe_server(15_000)
    assert policy.next_delay_ms() == 15_000
    policy.observe_retry_after(42)
    assert policy.next_delay_ms() == 42_000  # obeyed once, without jitter
    assert policy.next_delay_ms() == 15_000


def test_TWK_POLL_never_below_two_seconds() -> None:
    clock = FakeClock()
    policy = _policy(clock, 0.0)
    policy.observe_server(500)
    assert policy.next_delay_ms() == 2_000
    policy.observe_retry_after(0)
    assert policy.next_delay_ms() == 2_000


async def test_TWK_POLL_claim_uses_claim_keys_max_1_and_maps_204(
    api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    empty = await claim(api, str(account.device_id), ["apply"])
    assert empty.grant is None
    app = cloud.add_application()
    task = cloud.queue_task(app_id=app["id"])
    got = await claim(api, str(account.device_id), ["discover", "apply", "apply"])
    assert got.grant is not None
    assert got.grant.task_id == task["id"]
    assert got.poll_interval_ms == 5_000
    assert got.grant.heartbeat_interval_ms == 30_000
    # The lease names its attempt (contract `lease.attempt_id`): no extra GET of the task.
    assert got.grant.attempt_id == cloud.attempts[task["id"]][-1]["id"]
    for record in cloud.claims:
        assert re.fullmatch(rf"claim:{account.device_id}:[0-9A-HJKMNP-TV-Z]{{26}}", record["key"])
    assert cloud.claims[-1]["capabilities"] == ["apply", "discover"]
    cloud.claim_retry_after = "17"
    later = await claim(api, str(account.device_id), ["apply"])
    assert later.grant is None
    assert later.retry_after == 17.0


async def test_TWK_POLL_claim_filters_by_capability_and_target(
    api: ApiClient, account: AccountMeta, cloud: CloudFake
) -> None:
    other = cloud.queue_task(
        "discover", target="dev_01JA6V8M3W8Z1T6Q4Y2B7K9C00", context=cloud.discover_context()
    )
    render = cloud.queue_task(
        "render_cv", context=cloud.render_context("cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C00")
    )
    none = await claim(api, str(account.device_id), ["discover"])
    assert none.grant is None  # the discover task is pinned to another device
    got = await claim(api, str(account.device_id), ["render_cv", "discover"])
    assert got.grant is not None
    assert got.grant.task_id == render["id"]
    assert cloud.tasks[other["id"]]["state"] == "queued"


def test_TWK_POLL_backpressure_blocks_claims(runtime: Runtime, account: AccountMeta) -> None:
    worker = Worker(runtime, WorkerOptions(capabilities=["apply"]))
    assert worker.backpressure() is None
    assert worker.can_claim()
    outbox = Outbox(runtime.db, runtime.issuer)
    with runtime.db.transaction():
        for n in range(501):
            outbox.enqueue("POST", "/api/v1/inbox:bulk", {"n": n}, ordering_key=f"k{n}")
    assert worker.backpressure() is not None
    assert "outbox depth 501" in str(worker.backpressure())
    assert not worker.can_claim()


async def test_TWK_POLL_three_failed_syncs_stop_claims(
    runtime: Runtime, api: ApiClient, account: AccountMeta
) -> None:
    from pilih_jobs.tasks.syncloop import SyncLoop

    worker = Worker(runtime, WorkerOptions(capabilities=["apply"]))
    worker.sync = SyncLoop(runtime.db, runtime.issuer, api, paths=runtime.paths)
    worker.sync.consecutive_failures = 3
    assert worker.backpressure() == "3 failed syncs in a row"
    worker.sync.consecutive_failures = 0
    assert worker.can_claim()


def test_TWK_POLL_claim_capabilities_follow_free_slots(
    runtime: Runtime, account: AccountMeta
) -> None:
    worker = Worker(
        runtime, WorkerOptions(capabilities=["discover", "apply", "render_cv", "headed_browser"])
    )
    worker.capabilities = worker.detect_capabilities()
    assert set(worker.claim_capabilities()) == {"discover", "apply", "render_cv", "headed_browser"}

    class Busy:
        def done(self) -> bool:
            return False

    worker.browser.task = Busy()  # type: ignore[assignment]
    assert worker.claim_capabilities() == ["discover"]
    worker.discover.task = Busy()  # type: ignore[assignment]
    assert worker.claim_capabilities() == []
    restricted = Worker(
        runtime, WorkerOptions(kinds=["discover"], capabilities=["discover", "apply"])
    )
    assert restricted.detect_capabilities() == ["discover"]
