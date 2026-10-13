"""TCLI-OUTBOX-CLOCK: the outbox tolerates the corrected clock stepping back (20 §5.2, §9).

The corrected clock follows the server's `Date` header (1-second resolution), so a response
can move `now_ms()` back by about a second. An entry queued just before the flush (e.g. a
discovery batch that `depends_on` the run create sent in the same flush) must still go out
in the same pass, while retried entries keep their exact backoff.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from pilih_jobs.api.client import ApiClient, StaticToken
from pilih_jobs.clock import ClockSync
from pilih_jobs.contracts import ids
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.flusher import OutboxFlusher
from pilih_jobs.sync.outbox import CLOCK_STEP_TOLERANCE_MS, Outbox
from tests.support.fake_api import FakeApi
from tests.sync.conftest import ISSUER, ManualClock

#: 01:53:20.100 local; the server is 200 ms behind (01:53:19.900, `Date: … 01:53:19`).
LOCAL_START = 1_791_770_000_100
SERVER_BEHIND_MS = 200


@pytest.fixture
def wall() -> ManualClock:
    return ManualClock(LOCAL_START)


@pytest.fixture
def stepping_api(wall: ManualClock) -> Iterator[FakeApi]:
    fake = FakeApi(now_ms=lambda: wall() - SERVER_BEHIND_MS)
    yield fake
    assert fake.contract_errors == [], fake.contract_errors


async def test_TCLI_OUTBOX_CLOCK_dependent_entry_is_sent_in_the_same_flush(
    db: StateDB, wall: ManualClock, stepping_api: FakeApi
) -> None:
    """The leaf-4.2 R1 repro: enqueue A and B (B depends_on A), flush once."""
    clock = ClockSync(wall=wall, monotonic=wall)
    ids.set_time_source(clock.now_ms)
    try:
        user = stepping_api.add_user()
        access, _ = stepping_api.issue_tokens(user)
        app = stepping_api.new_application(user)
        api = ApiClient(
            stepping_api.issuer,
            tokens=StaticToken(access),
            transport=stepping_api.transport,
            clock=clock,
        )
        outbox = Outbox(db, ISSUER, now=clock.now_ms)
        first = outbox.enqueue(
            "PATCH",
            f"/api/v1/applications/{app['id']}",
            {"base_revision": app["revision"], "priority": 1},
            ordering_key=f"app:{app['id']}:a",
            kind="conditional",
        )
        second = outbox.enqueue(
            "PATCH",
            f"/api/v1/applications/{app['id']}",
            {"base_revision": app["revision"] + 1, "archived": True},
            ordering_key=f"app:{app['id']}:b",
            kind="conditional",
            depends_on=first.idempotency_key,
        )
        assert [e.id for e in outbox.ready()] == [first.id]  # B waits for A
        try:
            report = await OutboxFlusher(outbox, api, now=clock.now_ms).flush()
        finally:
            await api.aclose()
        # A's response (`Date: … 01:53:19`) moved the corrected clock back by 1.1 s …
        assert clock.offset_ms == -1_100
        assert clock.now_ms() < second.next_attempt_at
        # … and B, queued at 01:53:20.100, still went out in the same pass.
        assert report.done == 2
        assert outbox.get(second.id).state == "done"  # type: ignore[union-attr]
        assert stepping_api.application(app["id"])["archived"] is True
    finally:
        ids.set_time_source(None)


def test_TCLI_OUTBOX_CLOCK_backoff_is_not_shortened(outbox: Outbox, clock: ManualClock) -> None:
    fresh = outbox.enqueue("POST", "/api/v1/inbox:bulk", {"x": 1}, ordering_key="a")
    retried = outbox.enqueue("POST", "/api/v1/inbox:bulk", {"x": 2}, ordering_key="b")
    outbox.mark_inflight([retried.id])
    outbox.mark_retry([retried.id], status=503, error="busy", next_attempt_at=clock.now + 500)
    clock.advance(-1_500)  # the corrected clock stepped back 1.5 s
    ready = [e.id for e in outbox.ready()]
    assert fresh.id in ready  # never attempted: due within the clock-step tolerance
    assert retried.id not in ready  # a backoff is honoured exactly
    clock.advance(2_000)  # back at the retry time
    assert retried.id in [e.id for e in outbox.ready()]
    # The tolerance is bounded: a fresh entry dated further ahead waits.
    later = outbox.enqueue("POST", "/api/v1/inbox:bulk", {"x": 3}, ordering_key="c")
    clock.advance(-(CLOCK_STEP_TOLERANCE_MS + 1))
    assert later.id not in [e.id for e in outbox.ready()]


def test_TCLI_OUTBOX_CLOCK_a_consistent_date_header_keeps_the_offset() -> None:
    wall = ManualClock(LOCAL_START)
    clock = ClockSync(wall=wall, monotonic=wall)
    clock.observe(LOCAL_START + 250)  # a heartbeat's millisecond server_time
    assert clock.offset_ms == 250
    # `Date: … 01:53:20` covers [01:53:20.000, 01:53:21.000): 01:53:20.450 is inside it.
    wall.advance(100)
    sample = clock.observe_http_date("Mon, 12 Oct 2026 01:53:20 GMT")
    assert sample is not None
    assert clock.offset_ms == 250  # no truncation back to the whole second
    # A header outside the window still corrects the clock.
    clock.observe_http_date("Mon, 12 Oct 2026 01:53:30 GMT")
    assert clock.offset_ms == 1_791_770_010_000 - (LOCAL_START + 100)
