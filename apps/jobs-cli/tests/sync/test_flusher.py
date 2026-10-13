"""Flusher behaviour: conflicts, resolvers, hooks, the state lock (20 §5.3, §6, §12 F4)."""

from __future__ import annotations

import json
from pathlib import Path

from pilih_jobs.api.client import ApiClient
from pilih_jobs.storage.locks import FileLock
from pilih_jobs.sync.flusher import FlushHooks, OutboxFlusher, conflict_revision
from pilih_jobs.sync.outbox import Outbox, OutboxEntry
from tests.support.fake_api import FakeApi
from tests.sync.conftest import ManualClock


async def test_revision_conflict_blocks_the_key_until_resolved(
    outbox: Outbox, clock: ManualClock, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, user = api_for
    app = fake_api.new_application(user)
    fake_api.web_move(app["id"], "preparing")  # revision 2 on the server
    stale = outbox.enqueue(
        "POST",
        f"/api/v1/applications/{app['id']}/move",
        {"base_revision": 1, "stage": "withdrawn"},
        ordering_key=f"app:{app['id']}",
        kind="conditional",
    )
    later = outbox.enqueue(
        "PATCH",
        f"/api/v1/applications/{app['id']}",
        {"base_revision": 1, "priority": 0},
        ordering_key=f"app:{app['id']}",
        kind="conditional",
    )
    report = await OutboxFlusher(outbox, api, now=clock).flush()
    assert report.conflicts == 1
    assert report.sent == 1
    entry = outbox.get(stale.id)
    assert entry is not None
    assert entry.state == "conflict"
    assert conflict_revision(entry) == 2
    assert outbox.get(later.id).state == "pending"  # type: ignore[union-attr]
    outbox.rebase(stale.id, {"base_revision": 2, "stage": "withdrawn"})
    await OutboxFlusher(outbox, api, now=clock).flush()
    assert fake_api.application(app["id"])["stage"] == "withdrawn"


async def test_cursor_state_conflicts_keep_the_server_value(
    outbox: Outbox, clock: ManualClock, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, _ = api_for
    fake_api.fail_next(
        "PATCH",
        r"^/api/v1/sources/",
        409,
        "revision_conflict",
        details={"current": {"revision": 9}},
    )
    entry = outbox.enqueue(
        "PATCH",
        "/api/v1/sources/src_01JA6V8M3W8Z1T6Q4Y2B7K9C00",
        {"base_revision": 3, "cursor_state": {"etag": "x"}},
        ordering_key="src:1",
        kind="conditional",
    )
    report = await OutboxFlusher(outbox, api, now=clock).flush()
    stored = outbox.get(entry.id)
    assert report.dead == 1
    assert stored is not None
    assert stored.state == "dead"
    assert (stored.last_error or "").startswith("superseded: the server value was kept")


async def test_success_and_dead_hooks_receive_entries(
    outbox: Outbox, clock: ManualClock, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, _ = api_for
    dead: list[OutboxEntry] = []
    hooks = FlushHooks()
    hooks.on_dead(r"/lease/.+/result$", lambda entry, error: dead.append(entry))
    outbox.enqueue(
        "POST",
        "/api/v1/tasks/tsk_01JA6V8M3W8Z1T6Q4Y2B7K9C00/lease/lse_01JA6V8M3W8Z1T6Q4Y2B7K9C00/result",
        {"outcome": "submitted"},
        ordering_key="task:1",
        kind="lease_report",
    )
    report = await OutboxFlusher(outbox, api, hooks=hooks, now=clock).flush()
    assert report.dead == 1
    assert len(dead) == 1


async def test_second_process_cannot_flush_while_the_state_lock_is_held(
    outbox: Outbox, clock: ManualClock, api_for: tuple[ApiClient, str], tmp_path: Path
) -> None:
    api, _ = api_for
    holder = FileLock(tmp_path / "state.lock")
    assert holder.try_acquire()
    outbox.enqueue(
        "POST",
        "/api/v1/inbox:bulk",
        {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C00"], "action": "seen"},
        ordering_key="i",
    )
    report = await OutboxFlusher(
        outbox, api, state_lock=FileLock(tmp_path / "state.lock"), now=clock
    ).flush()
    assert report.paused == "locked"
    assert report.sent == 0
    holder.release()
    report = await OutboxFlusher(
        outbox, api, state_lock=FileLock(tmp_path / "state.lock"), now=clock
    ).flush()
    assert report.done == 1


async def test_dead_letter_errors_are_redacted(
    outbox: Outbox, clock: ManualClock, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, _ = api_for
    entry = outbox.enqueue(
        "POST",
        "/api/v1/inbox:bulk",
        {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C00"], "action": "seen"},
        ordering_key="i",
    )
    fake_api.fail_next(
        "POST",
        "inbox:bulk",
        422,
        "policy_violation",
        message="contact rahma@example.com Bearer abcdefghijklmnopqrstuvwxyz0123",
    )
    await OutboxFlusher(outbox, api, now=clock).flush()
    stored = outbox.get(entry.id)
    assert stored is not None
    assert "rahma@example.com" not in (stored.last_error or "")
    assert "abcdefghijklmnopqrstuvwxyz0123" not in (stored.last_error or "")
    assert json.dumps(stored.summary())


async def test_upload_entries_send_multipart_from_the_staging_dir(
    outbox: Outbox,
    clock: ManualClock,
    api_for: tuple[ApiClient, str],
    fake_api: FakeApi,
    tmp_path: Path,
) -> None:
    import hashlib

    from pilih_jobs.sync.outbox import upload_manifest

    api, _ = api_for
    staged = tmp_path / "data" / "runs" / "att_1" / "steps.jsonl"
    staged.parent.mkdir(parents=True)
    staged.write_bytes(b'{"event":"step"}\n')
    digest = hashlib.sha256(staged.read_bytes()).hexdigest()
    meta = {
        "kind": "run_log",
        "sha256": digest,
        "content_type": "application/x-ndjson",
        "size_bytes": 17,
    }
    good = outbox.enqueue(
        "POST",
        "/api/v1/files",
        upload_manifest(
            meta=meta, path=str(staged), content_type="application/x-ndjson", sha256=digest
        ),
        ordering_key="att:1",
        kind="upload",
    )
    outside = tmp_path / "elsewhere.txt"
    outside.write_text("x")
    bad = outbox.enqueue(
        "POST",
        "/api/v1/files",
        upload_manifest(meta=meta, path=str(outside), content_type="text/plain", sha256=digest),
        ordering_key="att:2",
        kind="upload",
    )
    link = staged.parent / "link.jsonl"
    link.symlink_to(staged)
    linked = outbox.enqueue(
        "POST",
        "/api/v1/files",
        upload_manifest(meta=meta, path=str(link), content_type="text/plain", sha256=digest),
        ordering_key="att:3",
        kind="upload",
    )
    report = await OutboxFlusher(outbox, api, now=clock, upload_root=tmp_path / "data").flush()
    assert report.done == 1
    assert report.dead == 2
    assert outbox.get(good.id).state == "done"  # type: ignore[union-attr]
    assert "outside" in (outbox.get(bad.id).last_error or "")  # type: ignore[union-attr]
    assert "symlink" in (outbox.get(linked.id).last_error or "")  # type: ignore[union-attr]
    assert [a["op"] for a in fake_api.accepted] == ["upload"]


async def test_upload_of_a_changed_file_is_refused(
    outbox: Outbox, clock: ManualClock, api_for: tuple[ApiClient, str], tmp_path: Path
) -> None:
    from pilih_jobs.sync.outbox import upload_manifest

    api, _ = api_for
    staged = tmp_path / "f.pdf"
    staged.write_bytes(b"%PDF-1")
    entry = outbox.enqueue(
        "POST",
        "/api/v1/files",
        upload_manifest(
            meta={"kind": "cv_pdf"},
            path=str(staged),
            content_type="application/pdf",
            sha256="0" * 64,
        ),
        ordering_key="f",
        kind="upload",
    )
    await OutboxFlusher(outbox, api, now=clock, upload_root=tmp_path).flush()
    assert "sha256 mismatch" in (outbox.get(entry.id).last_error or "")  # type: ignore[union-attr]
