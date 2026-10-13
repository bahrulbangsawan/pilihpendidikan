"""T20-02: full-jitter backoff bounds, Retry-After, 7-day dead letters, 426 pauses (20 §5.3)."""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from pilih_jobs.api.client import ApiClient
from pilih_jobs.sync.backoff import CAP_MS, backoff_ceiling_ms, full_jitter_ms, retry_delay_ms
from pilih_jobs.sync.flusher import OutboxFlusher
from pilih_jobs.sync.outbox import MAX_AGE_MS, Outbox
from tests.support.fake_api import FakeApi
from tests.sync.conftest import ManualClock


@given(
    attempts=st.integers(min_value=0, max_value=200), r=st.floats(min_value=0, max_value=0.9999999)
)
def test_T20_02_full_jitter_bounds(attempts: int, r: float) -> None:
    delay = full_jitter_ms(attempts, rng=lambda: r)
    ceiling = min(300_000, 1000 * 2 ** min(attempts, 40))
    assert 0 <= delay <= ceiling
    assert backoff_ceiling_ms(attempts) == ceiling


def test_T20_02_ceiling_doubles_then_caps_at_five_minutes() -> None:
    assert [backoff_ceiling_ms(n) for n in range(10)] == [
        1000,
        2000,
        4000,
        8000,
        16000,
        32000,
        64000,
        128000,
        256000,
        CAP_MS,
    ]
    assert full_jitter_ms(3, rng=lambda: 0.0) == 0
    assert full_jitter_ms(3, rng=lambda: 0.5) == 4000


def test_T20_02_retry_after_is_honoured() -> None:
    assert retry_delay_ms(1, retry_after_s=30, rng=lambda: 0.99) == 30_000
    assert retry_delay_ms(9, retry_after_s=1, rng=lambda: 0.5) == 150_000


async def test_T20_02_network_errors_back_off_and_retry(
    outbox: Outbox, clock: ManualClock, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, _user = api_for
    body = {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C00"], "action": "seen"}
    entry = outbox.enqueue("POST", "/api/v1/inbox:bulk", body, ordering_key="inbox")
    fake_api.offline = True
    report = await OutboxFlusher(outbox, api, rng=lambda: 0.5, now=clock).flush()
    stored = outbox.get(entry.id)
    assert report.retried == 1
    assert stored is not None
    assert stored.state == "pending"
    assert stored.attempts == 1
    assert stored.next_attempt_at == clock.now + 1000
    assert "ConnectError" in (stored.last_error or "")
    fake_api.offline = False
    assert (await OutboxFlusher(outbox, api, now=clock).flush()).sent == 0  # not yet due
    clock.advance(1000)
    report = await OutboxFlusher(outbox, api, now=clock).flush()
    stored = outbox.get(entry.id)
    assert report.done == 1
    assert stored is not None
    assert stored.state == "done"
    assert stored.attempts == 2


async def test_T20_02_5xx_is_retryable(
    outbox: Outbox, clock: ManualClock, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, _ = api_for
    entry = outbox.enqueue(
        "POST",
        "/api/v1/inbox:bulk",
        {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C00"], "action": "seen"},
        ordering_key="i",
    )
    fake_api.fail_next("POST", "inbox:bulk", 503, "upstream_unavailable")
    report = await OutboxFlusher(outbox, api, rng=lambda: 0.5, now=clock).flush()
    assert report.retried == 1
    assert report.done == 0
    clock.advance(1000)
    report = await OutboxFlusher(outbox, api, now=clock).flush()
    stored = outbox.get(entry.id)
    assert report.done == 1
    assert stored is not None
    assert stored.state == "done"


async def test_T20_02_429_waits_for_retry_after(
    outbox: Outbox, clock: ManualClock, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, _ = api_for
    entry = outbox.enqueue(
        "POST",
        "/api/v1/inbox:bulk",
        {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C00"], "action": "seen"},
        ordering_key="inbox",
    )
    fake_api.fail_next("POST", "inbox:bulk", 429, "rate_limited", retry_after=45)
    await OutboxFlusher(outbox, api, rng=lambda: 0.0, now=clock).flush()
    stored = outbox.get(entry.id)
    assert stored is not None
    assert stored.state == "pending"
    assert stored.next_attempt_at == clock.now + 45_000


async def test_T20_02_entries_older_than_7_days_are_dead(
    outbox: Outbox, clock: ManualClock, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, _ = api_for
    entry = outbox.enqueue(
        "POST",
        "/api/v1/inbox:bulk",
        {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C00"], "action": "seen"},
        ordering_key="inbox",
    )
    clock.advance(MAX_AGE_MS + 1)
    report = await OutboxFlusher(outbox, api, now=clock).flush()
    stored = outbox.get(entry.id)
    assert report.dead == 1
    assert report.sent == 0
    assert stored is not None
    assert stored.state == "dead"
    assert "7 days" in (stored.last_error or "")
    assert fake_api.requests == []


async def test_T20_02_426_pauses_the_flusher_and_keeps_entries(
    outbox: Outbox, clock: ManualClock, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, _ = api_for
    first = outbox.enqueue(
        "POST",
        "/api/v1/inbox:bulk",
        {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C00"], "action": "seen"},
        ordering_key="a",
    )
    outbox.enqueue(
        "POST",
        "/api/v1/inbox:bulk",
        {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C01"], "action": "seen"},
        ordering_key="b",
    )
    fake_api.min_cli_version = "99.0.0"
    report = await OutboxFlusher(outbox, api, concurrency=1, now=clock).flush()
    assert report.paused == "upgrade"
    assert report.sent == 1
    stored = outbox.get(first.id)
    assert stored is not None
    assert stored.state == "pending"
    assert stored.attempts == 0
    assert outbox.counts()["pending"] == 2


async def test_T20_02_auth_failure_stops_flushing_and_keeps_entries(
    outbox: Outbox, clock: ManualClock, fake_api: FakeApi
) -> None:
    from pilih_jobs.api.client import StaticToken

    api = ApiClient(
        fake_api.issuer, tokens=StaticToken("revoked-or-unknown"), transport=fake_api.transport
    )
    outbox.enqueue(
        "POST",
        "/api/v1/inbox:bulk",
        {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C00"], "action": "seen"},
        ordering_key="a",
    )
    report = await OutboxFlusher(outbox, api, now=clock).flush()
    assert report.paused == "auth"
    assert outbox.counts()["pending"] == 1


@pytest.mark.parametrize(
    ("status", "error"),
    [
        (400, "invalid_request"),
        (403, "insufficient_scope"),
        (404, "not_found"),
        (422, "policy_violation"),
        (409, "idempotency_mismatch"),
        (409, "lease_lost"),
        (410, "task_expired"),
        (413, "payload_too_large"),
    ],
)
async def test_T20_02_non_retryable_errors_dead_letter(
    outbox: Outbox,
    clock: ManualClock,
    api_for: tuple[ApiClient, str],
    fake_api: FakeApi,
    status: int,
    error: str,
) -> None:
    api, _ = api_for
    entry = outbox.enqueue(
        "POST",
        "/api/v1/inbox:bulk",
        {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C00"], "action": "seen"},
        ordering_key="x",
    )
    fake_api.fail_next("POST", "inbox:bulk", status, error, message="server says no")
    report = await OutboxFlusher(outbox, api, now=clock).flush()
    stored = outbox.get(entry.id)
    assert report.dead == 1
    assert stored is not None
    assert stored.state == "dead"
    assert (
        stored.last_status == status and error in (stored.last_error or "")
    ) or "idempotency" in (stored.last_error or "")
