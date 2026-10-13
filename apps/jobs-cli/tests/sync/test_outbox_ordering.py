"""T20-01: outbox ordering — same ordering_key is sequential, depends_on is respected,
lease reports are prioritized (20 §5.2)."""

from __future__ import annotations

import pytest

from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.outbox import PRIORITY_DISCOVERY, PRIORITY_RESULT, Outbox
from tests.sync.conftest import ManualClock

RUN = "/api/v1/discovery/runs"


def test_T20_01_same_ordering_key_is_strictly_sequential(outbox: Outbox) -> None:
    a1 = outbox.enqueue(
        "PATCH",
        "/api/v1/applications/app_1",
        {"base_revision": 1, "priority": 1},
        ordering_key="app:app_1",
        kind="conditional",
    )
    a2 = outbox.enqueue(
        "PATCH",
        "/api/v1/applications/app_1",
        {"base_revision": 2, "priority": 0},
        ordering_key="app:app_1",
        kind="conditional",
    )
    b1 = outbox.enqueue(
        "PATCH",
        "/api/v1/applications/app_2",
        {"base_revision": 1, "archived": True},
        ordering_key="app:app_2",
        kind="conditional",
    )
    assert [e.id for e in outbox.ready()] == [a1.id, b1.id]
    outbox.mark_inflight([a1.id])
    assert [e.id for e in outbox.ready()] == [b1.id]  # a2 waits for in-flight a1
    outbox.mark_done([a1.id], 200)
    assert a2.id in [e.id for e in outbox.ready()]


@pytest.mark.parametrize("blocking_state", ["pending", "inflight", "conflict"])
def test_T20_01_earlier_open_entry_blocks_its_key(
    outbox: Outbox, clock: ManualClock, blocking_state: str
) -> None:
    first = outbox.enqueue(
        "POST",
        "/api/v1/applications/app_1/move",
        {"base_revision": 1, "stage": "applied"},
        ordering_key="app:app_1",
    )
    second = outbox.enqueue(
        "POST",
        "/api/v1/applications/app_1/events",
        {"type": "note_added"},
        ordering_key="app:app_1",
    )
    if blocking_state == "pending":
        outbox.mark_retry([first.id], status=503, error="busy", next_attempt_at=clock.now + 60_000)
    elif blocking_state == "inflight":
        outbox.mark_inflight([first.id])
    else:
        outbox.mark_conflict([first.id], status=409, error="revision_conflict")
    assert second.id not in [e.id for e in outbox.ready()]
    outbox.mark_dead([first.id], status=409, error="dropped")
    assert [e.id for e in outbox.ready()] == [second.id]


def test_T20_01_depends_on_orders_across_keys(outbox: Outbox) -> None:
    create = outbox.enqueue(
        "POST",
        RUN,
        {"id": "run_1"},
        ordering_key="run:run_1:create",
        idempotency_key="run:run_1:create",
    )
    batch = outbox.enqueue(
        "POST",
        f"{RUN}/run_1/postings:batch",
        {"items": [{"x": 1}]},
        ordering_key="run:run_1:batch:0",
        depends_on=create.idempotency_key,
        priority=PRIORITY_DISCOVERY,
    )
    assert [e.id for e in outbox.ready()] == [create.id]
    outbox.mark_done([create.id], 201)
    assert [e.id for e in outbox.ready()] == [batch.id]


def test_T20_01_dead_dependency_kills_dependents(outbox: Outbox) -> None:
    create = outbox.enqueue(
        "POST", RUN, {"id": "run_2"}, ordering_key="run:run_2", idempotency_key="run:run_2:create"
    )
    batch = outbox.enqueue(
        "POST",
        f"{RUN}/run_2/postings:batch",
        {"items": []},
        ordering_key="run:run_2:b",
        depends_on=create.idempotency_key,
    )
    outbox.mark_dead([create.id], status=422, error="unsupported_source")
    assert outbox.kill_orphans() == 1
    refreshed = outbox.get(batch.id)
    assert refreshed is not None
    assert refreshed.state == "dead"
    assert refreshed.last_error == "dependency failed: run:run_2:create"


def test_T20_01_purged_dependency_counts_as_done(outbox: Outbox, db: StateDB) -> None:
    batch = outbox.enqueue(
        "POST",
        f"{RUN}/run_3/postings:batch",
        {"items": []},
        ordering_key="run:run_3:b",
        depends_on="run:run_3:create",
    )
    assert [e.id for e in outbox.ready()] == [batch.id]


def test_T20_01_lease_reports_go_first_then_priority_then_age(outbox: Outbox) -> None:
    disc = outbox.enqueue(
        "POST",
        f"{RUN}/run_1/postings:batch",
        {"items": []},
        ordering_key="run:1",
        priority=PRIORITY_DISCOVERY,
    )
    note = outbox.enqueue(
        "POST", "/api/v1/applications/app_1/events", {"t": 1}, ordering_key="app:1"
    )
    result = outbox.enqueue(
        "POST",
        "/api/v1/tasks/tsk_1/lease/lse_1/result",
        {"outcome": "submitted"},
        ordering_key="task:tsk_1",
        priority=PRIORITY_RESULT,
        kind="lease_report",
    )
    heartbeat = outbox.enqueue(
        "POST",
        "/api/v1/tasks/tsk_2/lease/lse_2/events",
        {"events": []},
        ordering_key="task:tsk_2",
        kind="lease_report",
    )
    evidence = outbox.enqueue(
        "POST",
        "/api/v1/applications/app_9/submission",
        {"x": 1},
        ordering_key="app:9",
        priority=PRIORITY_RESULT,
    )
    order = [e.id for e in outbox.ready()]
    assert order == [result.id, heartbeat.id, evidence.id, note.id, disc.id]


def test_T20_01_enqueue_is_idempotent_per_key(outbox: Outbox) -> None:
    first = outbox.enqueue(
        "POST", RUN, {"id": "run_1"}, ordering_key="run:1", idempotency_key="k-1"
    )
    again = outbox.enqueue(
        "POST", RUN, {"id": "run_1"}, ordering_key="run:1", idempotency_key="k-1"
    )
    assert again.id == first.id
    assert len(outbox.entries()) == 1
    with pytest.raises(ValueError, match="different request"):
        outbox.enqueue(
            "POST", RUN, {"id": "run_other"}, ordering_key="run:1", idempotency_key="k-1"
        )
    with pytest.raises(ValueError, match="writes"):
        outbox.enqueue("GET", RUN, None, ordering_key="x")
    with pytest.raises(ValueError, match="/api/v1"):
        outbox.enqueue("POST", "/oauth/token", None, ordering_key="x")


def test_T20_01_crashed_inflight_entries_are_recovered(outbox: Outbox) -> None:
    entry = outbox.enqueue("POST", RUN, {"id": "run_1"}, ordering_key="run:1")
    outbox.mark_inflight([entry.id])
    assert outbox.ready() == []
    assert outbox.recover_inflight() == 1
    assert [e.id for e in outbox.ready()] == [entry.id]


def test_T20_01_quarantine_never_replays_under_another_user(outbox: Outbox) -> None:
    pending = outbox.enqueue("POST", RUN, {"id": "run_1"}, ordering_key="run:1")
    done = outbox.enqueue("POST", RUN, {"id": "run_2"}, ordering_key="run:2")
    outbox.mark_done([done.id], 201)
    assert outbox.quarantine("usr_alice") == 1
    entry = outbox.get(pending.id)
    assert entry is not None
    assert entry.state == "dead"
    assert "usr_alice" in (entry.last_error or "")
    assert outbox.ready() == []


def test_T20_01_rebase_keeps_the_position_with_a_fresh_key(outbox: Outbox) -> None:
    first = outbox.enqueue(
        "PATCH",
        "/api/v1/applications/app_1",
        {"base_revision": 1, "priority": 1},
        ordering_key="app:1",
        kind="conditional",
    )
    later = outbox.enqueue(
        "PATCH",
        "/api/v1/applications/app_1",
        {"base_revision": 2, "archived": True},
        ordering_key="app:1",
        kind="conditional",
    )
    outbox.mark_conflict(
        [first.id], status=409, error='{"code":"revision_conflict","current_revision":4}'
    )
    rebased = outbox.rebase(first.id, {"base_revision": 4, "priority": 1})
    assert rebased.id == first.id
    assert rebased.idempotency_key != first.idempotency_key
    assert rebased.state == "pending"
    assert rebased.json()["base_revision"] == 4
    assert [e.id for e in outbox.ready()] == [first.id]
    assert outbox.discard(later.id)
    assert outbox.get(later.id) is None
