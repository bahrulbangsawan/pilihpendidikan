"""T20-12: property-based convergence of the CLI outbox/change feed against the
in-process fake server built from the real contracts (20 §13 item 12).

Random interleavings of web edits, CLI offline edits (conditional moves, append-only
notes, one automation result under a lease), flushes with injected faults (network
down, lost responses after the server committed, duplicated deliveries), crashes in
the middle of a flush, and pulls. Invariants:

(a) the cloud state equals applying each accepted intent exactly once;
(b) no stage change by automation is applied after a later user stage change;
(c) every event appears exactly once;
(d) the CLI cache converges to the cloud after a final pull.
"""

from __future__ import annotations

import asyncio
import itertools
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from pilih_jobs.api.client import ApiClient, StaticToken
from pilih_jobs.contracts import ids
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.cache import EntityCache
from pilih_jobs.sync.flusher import OutboxFlusher
from pilih_jobs.sync.outbox import PRIORITY_RESULT, Outbox
from pilih_jobs.sync.puller import ChangeFeedPuller
from tests.support.fake_api import FakeApi

STAGES = ["saved", "preparing", "ready", "rejected", "withdrawn"]
FAULTS = [None, "down", "drop_response", "duplicate"]

operations = st.one_of(
    st.tuples(st.just("web_move"), st.integers(0, 1), st.sampled_from(STAGES)),
    st.tuples(st.just("cli_move"), st.integers(0, 1), st.sampled_from(STAGES)),
    st.tuples(st.just("cli_note"), st.integers(0, 1)),
    st.tuples(st.just("result")),
    st.tuples(st.just("flush"), st.sampled_from(FAULTS), st.integers(1, 3)),
    st.tuples(st.just("crash")),
    st.tuples(st.just("pull")),
)


class TickingClock:
    """Strictly increasing milliseconds (every read moves time forward by 1 ms)."""

    def __init__(self) -> None:
        self.now = 1_791_770_000_000

    def __call__(self) -> int:
        self.now += 1
        return self.now

    def advance(self, ms: int) -> None:
        self.now += ms


async def _run(program: list[tuple[Any, ...]], workdir: Path) -> None:
    clock = TickingClock()
    fake = FakeApi(now_ms=clock)
    user = fake.add_user()
    access, _ = fake.issue_tokens(user, expires_in_ms=30 * 86_400_000)
    device = fake.tokens[access].device_id(fake)
    apps = [fake.new_application(user, stage="ready") for _ in range(2)]
    task = fake.new_task(user, apps[0]["id"], device_id=device)
    fake.tasks[task["id"]]["lease_expires_at"] = clock.now + 30 * 86_400_000
    api = ApiClient(fake.issuer, tokens=StaticToken(access), transport=fake.transport)
    db = StateDB(workdir / "state.db")
    outbox = Outbox(db, fake.issuer, now=clock)
    cache = EntityCache(db, fake.issuer)
    puller = ChangeFeedPuller(db, fake.issuer, api, now=clock)
    note_keys: list[str] = []
    result_sent = False
    counter = itertools.count()

    def cached_revision(app_id: str) -> int:
        return cache.revision("application", app_id) or 1

    async def flush(fault: str | None, rounds: int) -> None:
        fake.fault_plan = (lambda _request: fault) if fault else None
        try:
            await OutboxFlusher(outbox, api, now=clock, rng=lambda: 0.5).flush(max_rounds=rounds)
        finally:
            fake.fault_plan = None
        clock.advance(10 * 60_000)  # every backoff (cap 5 min) is due again

    try:
        await puller.pull()
        for op in program:
            kind = op[0]
            if kind == "web_move":
                fake.web_move(apps[op[1]]["id"], op[2])
            elif kind == "cli_move":
                app_id = apps[op[1]]["id"]
                outbox.enqueue(
                    "POST",
                    f"/api/v1/applications/{app_id}/move",
                    {"base_revision": cached_revision(app_id), "stage": op[2]},
                    ordering_key=f"app:{app_id}",
                    kind="conditional",
                )
            elif kind == "cli_note":
                app_id = apps[op[1]]["id"]
                key = f"note-{next(counter)}"
                note_keys.append(key)
                outbox.enqueue(
                    "POST",
                    f"/api/v1/applications/{app_id}/events",
                    {"type": "note_added", "payload": {"text": key}, "idempotency_key": key},
                    ordering_key=f"app:{app_id}",
                )
            elif kind == "result" and not result_sent:
                result_sent = True
                outbox.enqueue(
                    "POST",
                    f"/api/v1/tasks/{task['id']}/lease/{task['lease_id']}/result",
                    {
                        "outcome": "submitted",
                        "application_update": {
                            "base_revision": cached_revision(apps[0]["id"]),
                            "submission_status": "submitted_verified",
                            "stage": "applied",
                        },
                    },
                    ordering_key=f"task:{task['id']}",
                    kind="lease_report",
                    priority=PRIORITY_RESULT,
                )
            elif kind == "flush":
                await flush(op[1], op[2])
            elif kind == "crash":
                for head in outbox.ready()[:2]:
                    outbox.mark_inflight([head.id])  # the process dies before sending
            elif kind == "pull":
                await puller.pull()
        for attempt in range(30):  # final reconnect: flush until nothing is deliverable
            if attempt and not outbox.ready(now=clock.now + 3_600_000):
                break
            await flush(None, 100)  # the first flush also recovers crashed in-flight entries
        await puller.pull()

        entries = outbox.entries()
        accepted = Counter(a["key"] for a in fake.accepted)
        # (a) every accepted intent was applied exactly once; done ⇔ accepted
        assert all(count == 1 for count in accepted.values()), accepted
        for entry in entries:
            blocked = any(
                other.ordering_key == entry.ordering_key
                and other.id < entry.id
                and other.state == "conflict"
                for other in entries
            )
            # an entry behind an unresolved conflict of its key waits (20 §5.2)
            assert entry.state in ("done", "conflict", "dead") or (
                entry.state == "pending" and blocked
            ), entry.summary()
            assert accepted[entry.idempotency_key] == (1 if entry.state == "done" else 0), (
                entry.summary()
            )
        for app in apps:
            current = fake.application(app["id"])
            stage_events = [
                e
                for e in fake.events
                if e["application_id"] == app["id"]
                and e["type"] == "stage_changed"
                and e["applied_to_state"]
            ]
            expected_stage = stage_events[-1]["to_value"] if stage_events else "ready"
            assert current["stage"] == expected_stage
            bumps = sum(1 for c in fake.change_log if c["entity_id"] == app["id"]) - 1
            assert current["revision"] == 1 + bumps
        # (b) automation never overrides a later user decision
        task_created = task["created_at"]
        for event in fake.events:
            if (
                event["actor_kind"] == "automation"
                and event["type"] == "stage_changed"
                and event["applied_to_state"]
            ):
                earlier_user = [
                    e
                    for e in fake.events
                    if e["application_id"] == event["application_id"]
                    and e["type"] == "stage_changed"
                    and e["actor_kind"] == "user"
                    and task_created <= e["recorded_at"] <= event["recorded_at"]
                ]
                assert earlier_user == [], "automation applied after a user stage change"
        # (c) every note event exists exactly once (once delivered)
        note_counts = Counter(
            e["idempotency_key"] for e in fake.events if e["type"] == "note_added"
        )
        delivered = {
            json_key
            for json_key in note_keys
            if any(
                e.idempotency_key
                and (e.json() or {}).get("idempotency_key") == json_key
                and e.state == "done"
                for e in entries
            )
        }
        for key in note_keys:
            assert note_counts[key] == (1 if key in delivered else 0), key
        # (d) the cache converges to the cloud
        for app in apps:
            assert cache.get("application", app["id"]) == fake.application(app["id"])
        assert fake.contract_errors == []
    finally:
        await api.aclose()
        db.close()
        ids.set_time_source(None)


@settings(
    max_examples=75,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
)
@given(program=st.lists(operations, min_size=1, max_size=24))
def test_T20_12_convergence_under_faults(
    program: list[tuple[Any, ...]], tmp_path_factory: pytest.TempPathFactory
) -> None:
    asyncio.run(_run(program, tmp_path_factory.mktemp("conv")))


def test_T20_12_worked_example_a_user_decision_wins(tmp_path: Path) -> None:
    """20 §6.3 A in miniature: the user rejects before the automation result arrives."""
    program: list[tuple[Any, ...]] = [
        ("result",),
        ("flush", "down", 1),
        ("web_move", 0, "rejected"),
        ("cli_note", 0),
        ("flush", "drop_response", 2),
        ("flush", "duplicate", 2),
    ]
    asyncio.run(_run(program, tmp_path))
