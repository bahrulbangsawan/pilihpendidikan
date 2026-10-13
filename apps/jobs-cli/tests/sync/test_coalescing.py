"""T20-03: coalescing of batchable entries with deterministic batch keys (20 §5.4)."""

from __future__ import annotations

import hashlib
from typing import Any

from pilih_jobs.api.client import ApiClient
from pilih_jobs.sync.flusher import FlushHooks, OutboxFlusher
from pilih_jobs.sync.outbox import Batch, Outbox, batch_key, build_batch
from tests.support.fake_api import FakeApi
from tests.sync.conftest import ManualClock

BULK = "/api/v1/inbox:bulk"
UJB = "ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C{:02d}"


def _bulk(outbox: Outbox, index: int, action: str = "dismiss", key: str = "inbox") -> Any:
    return outbox.enqueue(
        "POST", BULK, {"user_job_ids": [UJB.format(index)], "action": action}, ordering_key=key
    )


def test_T20_03_batch_key_is_sha256_of_sorted_child_keys() -> None:
    expected = hashlib.sha256(b"a\nb\nc").hexdigest()
    assert batch_key(["c", "a", "b"]) == expected == batch_key(["b", "c", "a"])
    assert batch_key(["a", "b"]) != expected


def test_T20_03_same_children_give_the_same_batch(outbox: Outbox) -> None:
    for i in range(3):
        _bulk(outbox, i)
    head = outbox.ready()[0]
    first, second = outbox.batch_for(head), outbox.batch_for(head)
    assert first.coalesced
    assert len(first.entries) == 3
    assert (
        first.idempotency_key
        == second.idempotency_key
        == batch_key(e.idempotency_key for e in first.entries)
    )
    assert first.body is not None
    assert b'"user_job_ids":["' + UJB.format(0).encode() in first.body


def test_T20_03_partial_batch_after_a_crash_gets_a_different_key(outbox: Outbox) -> None:
    entries = [_bulk(outbox, i) for i in range(3)]
    full = outbox.batch_for(outbox.ready()[0])
    outbox.mark_done([entries[0].id], 200)  # crash after the first child was acknowledged
    partial = outbox.batch_for(outbox.ready()[0])
    assert partial.idempotency_key != full.idempotency_key
    assert [e.id for e in partial.entries] == [entries[1].id, entries[2].id]


def test_T20_03_only_compatible_consecutive_entries_merge(outbox: Outbox) -> None:
    _bulk(outbox, 1, "dismiss")
    _bulk(outbox, 2, "dismiss")
    _bulk(outbox, 3, "track")  # different action: stops the batch
    _bulk(outbox, 4, "dismiss")
    batch = outbox.batch_for(outbox.ready()[0])
    assert len(batch.entries) == 2
    other_key = _bulk(outbox, 5, key="inbox-2")
    assert other_key.id not in batch.ids


def test_T20_03_limits_are_respected(outbox: Outbox) -> None:
    for i in range(3):
        outbox.enqueue(
            "POST",
            BULK,
            {"user_job_ids": [UJB.format(10 * i + j) for j in range(90)], "action": "seen"},
            ordering_key="big",
        )
    batch = outbox.batch_for(outbox.ready()[0])
    assert len(batch.entries) == 2  # 180 ids ≤ 200, a third child would exceed the limit
    run = "/api/v1/discovery/runs/run_01JA6V8M3W8Z1T6Q4Y2B7K9C00/postings:batch"
    item = {"client_ref": "x", "blob": "y" * 400_000}
    for _ in range(3):
        outbox.enqueue("POST", run, {"items": [item]}, ordering_key="run")
    postings = outbox.batch_for(next(e for e in outbox.ready() if e.ordering_key == "run"))
    assert len(postings.entries) == 2  # ≤ 1 MB


def test_T20_03_non_batchable_entries_are_sent_alone(outbox: Outbox) -> None:
    for _ in range(2):
        outbox.enqueue(
            "PATCH",
            "/api/v1/applications/app_1",
            {"base_revision": 1},
            ordering_key="app:1",
            kind="conditional",
        )
    batch = outbox.batch_for(outbox.ready()[0])
    assert not batch.coalesced
    assert batch.idempotency_key == batch.head.idempotency_key


def test_T20_03_dedupe_merges_inbox_ids(outbox: Outbox) -> None:
    _bulk(outbox, 1)
    _bulk(outbox, 1)
    batch = build_batch(outbox.entries())
    assert batch.body is not None
    assert batch.body.count(UJB.format(1).encode()) == 1


async def test_T20_03_children_reach_done_together_and_items_are_idempotent(
    outbox: Outbox, clock: ManualClock, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, _ = api_for
    entries = [_bulk(outbox, i) for i in range(3)]
    seen: list[Batch] = []
    hooks = FlushHooks()
    hooks.on_success(r"^/api/v1/inbox:bulk$", lambda batch, response: seen.append(batch))
    fake_api.fault_plan = lambda request: (
        "drop_response" if request.url.path.endswith("inbox:bulk") and not seen else None
    )
    first = await OutboxFlusher(outbox, api, hooks=hooks, rng=lambda: 0.0, now=clock).flush(
        max_rounds=1
    )
    assert first.retried == 3
    assert first.done == 0
    fake_api.fault_plan = None
    clock.advance(10_000)
    second = await OutboxFlusher(outbox, api, hooks=hooks, now=clock).flush()
    assert second.done == 3
    assert second.sent == 1
    assert second.replayed == 1
    assert {outbox.get(e.id).state for e in entries} == {"done"}  # type: ignore[union-attr]
    assert len(seen) == 1
    assert len(seen[0].entries) == 3
    keys = [a["key"] for a in fake_api.accepted if a["op"] == "inbox_bulk"]
    assert keys == [seen[0].idempotency_key]  # applied exactly once despite the lost response
