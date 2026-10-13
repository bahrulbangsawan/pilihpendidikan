"""T15-SYNC, S-07, S-29, S-30: run → outbox → FakeApi batch endpoint → item outcomes (20 §7)."""

from __future__ import annotations

import asyncio
import copy
import json
from collections.abc import Callable
from typing import Any

import pytest

from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.discovery import (
    DiscoveryOptions,
    DiscoveryRunResult,
    DiscoveryRuntime,
    run_discovery,
)
from pilih_jobs.discovery.seen import LocalSeenCache
from pilih_jobs.discovery.sync import register_flush_hooks
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.engine import SyncEngine
from pilih_jobs.sync.flusher import FlushHooks
from pilih_jobs.sync.outbox import Outbox
from tests.discovery.fake_discovery import FakeDiscovery
from tests.discovery.support import Site, VirtualClock, fixture_json
from tests.support.fake_api import FakeApi
from tests.support.helpers import CliResult


@pytest.fixture
def backend(fake_api: FakeApi, user_id: str) -> FakeDiscovery:
    return FakeDiscovery(fake_api, user_id)


async def discover(
    rt: Runtime, *, cancel: asyncio.Event | None = None, **options: Any
) -> tuple[DiscoveryRunResult, list[dict[str, Any]]]:
    events: list[dict[str, Any]] = []
    async with rt.api_client() as api:
        ctx = DiscoveryRuntime(
            Outbox(rt.db, rt.issuer), api, events.append, cancel or asyncio.Event(), rt
        )
        result = await run_discovery(DiscoveryOptions(**options), ctx=ctx)
    return result, events


def board(n: int = 3) -> dict[str, Any]:
    data = fixture_json("greenhouse/board.json")
    template = data["jobs"][0]
    jobs = []
    for i in range(n):
        job = copy.deepcopy(data["jobs"][i] if i < 3 else template)
        if i >= 3:
            job["id"] = 5000000 + i
            job["title"] = f"Engineer {i}"
            job["absolute_url"] = f"https://boards.greenhouse.io/acme/jobs/{5000000 + i}"
        jobs.append(job)
    return {"jobs": jobs, "meta": {"total": n}}


def serve_board(site: Site, data: dict[str, Any], *, etag: str | None = None) -> None:
    body = json.dumps(data)

    def respond(request: Any) -> Any:
        from werkzeug import Response

        if etag and request.headers.get("If-None-Match") == etag:
            return Response(status=304, headers={"ETag": etag})
        return Response(
            body, content_type="application/json", headers={"ETag": etag} if etag else None
        )

    site.server.clear_all_handlers()
    site.robots("User-agent: *\nAllow: /\n")
    site.handle("/v1/boards/acme/jobs", respond)


# ---------------------------------------------------------------- outbox shape
async def test_T15_SYNC_outbox_entries_create_batches_complete(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    fake_api: FakeApi,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    serve_board(ats, board())
    fake_api.offline = True
    result, events = await discover(runtime, sources=["greenhouse:acme"])
    assert result.status == "completed"
    assert result.stats["sync"]["pending"] == 3
    entries = Outbox(runtime.db, runtime.issuer).entries()
    keys = [e.idempotency_key for e in entries]
    assert keys == [
        f"run:{result.run_id}:create",
        f"run:{result.run_id}:batch:1",
        f"run:{result.run_id}:complete",
    ]
    assert {e.ordering_key for e in entries} == {f"run:{result.run_id}"}
    assert all(e.depends_on == keys[0] for e in entries[1:])
    batch = entries[1].json()
    assert len(batch["items"]) == 3
    complete = entries[2].json()
    assert complete["complete_sources"] == [{"source_kind": "greenhouse", "source_org": "acme"}]
    checkpoint = runtime.db.query_one(
        "SELECT data FROM checkpoints WHERE key = ?", (f"run:{result.run_id}",)
    )
    assert json.loads(checkpoint["data"])["status"] == "completed"
    assert (
        runtime.db.query_one("SELECT status FROM runs WHERE id = ?", (result.run_id,))["status"]
        == "completed"
    )
    types = [e["type"] for e in events]
    assert types[0] == "source_started"
    assert "page_fetched" in types
    assert types[-1] == "run_finished"
    assert next(e for e in events if e["type"] == "sync")["pending"] == 3
    # back online: the flush delivers everything in order
    fake_api.offline = False
    runtime.db.execute("UPDATE outbox SET next_attempt_at = 0")  # the offline backoff has elapsed
    async with runtime.api_client() as api:
        hooks = register_flush_hooks(FlushHooks(), runtime.db, runtime.issuer)
        report = await SyncEngine(runtime.db, runtime.issuer, api, hooks=hooks).push()
    assert report.done == 3
    assert backend.count("new") == 3
    assert backend.runs[result.run_id]["status"] == "completed"


async def test_T15_SYNC_flush_records_item_outcomes(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    serve_board(ats, board())
    result, _ = await discover(runtime, sources=["greenhouse:acme"])
    sync = result.stats["sync"]
    assert sync["sent"] == 3
    assert sync["pending"] == 0
    assert sync["outcomes"] == {"new": 3}
    assert backend.count("invalid") == 0  # the server recomputed every fingerprint identically
    seen = LocalSeenCache(runtime.db, runtime.issuer)
    for posting in backend.postings.values():
        entry = seen.get(posting.fingerprint)
        assert entry is not None
        assert entry.posting_id == posting.id
        assert entry.content_hash == posting.content_hash


async def test_T15_SYNC_batches_at_most_100_items(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    serve_board(ats, board(250))
    result, _ = await discover(runtime, sources=["greenhouse:acme"])
    assert result.stats["batches"] == 3
    assert sorted(len(b) for b in backend.batches) == [50, 100, 100]
    assert backend.count("new") == 250


async def test_T15_SYNC_unknown_fingerprint_is_resent_in_full(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    serve_board(ats, board())
    await discover(runtime, sources=["greenhouse:acme"])
    backend.linked.clear()  # e.g. the user deleted the links on another device
    second, _ = await discover(runtime, sources=["greenhouse:acme"])
    assert second.stats["sync"]["outcomes"] == {"invalid": 3}
    third, _ = await discover(runtime, sources=["greenhouse:acme"])
    assert third.stats["sync"]["outcomes"] == {"new": 3}


async def test_T15_SYNC_dry_run_writes_nothing(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    serve_board(ats, board())
    result, events = await discover(runtime, sources=["greenhouse:acme"], dry_run=True)
    assert result.status == "completed"
    assert result.stats["dry_run"]
    assert result.stats["new"] == 3
    assert Outbox(runtime.db, runtime.issuer).entries() == []
    assert runtime.db.query("SELECT * FROM runs") == []
    assert backend.runs == {}
    assert sum(1 for e in events if e["type"] == "item") == 3


async def test_T15_SYNC_partial_run_lists_only_complete_sources(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    serve_board(ats, board())
    ats.status("/v0/postings/blocked", 403)
    result, events = await discover(runtime, sources=["greenhouse:acme", "lever:blocked"])
    assert result.status == "partial"
    complete = backend.completes[-1]
    assert complete["status"] == "partial"
    assert complete["complete_sources"] == [{"source_kind": "greenhouse", "source_org": "acme"}]
    assert complete["errors"][0]["error_class"] == "access_denied"
    assert complete["errors"][0]["http_status"] == 403
    assert complete["stats"]["errors_by_class"] == {"access_denied": 1}
    stopped = [e for e in events if e["type"] == "source_stopped"]
    assert stopped
    assert stopped[0]["error_class"] == "access_denied"


async def test_T15_SYNC_cancelled_run_still_queues_complete(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    serve_board(ats, board())
    cancel = asyncio.Event()
    cancel.set()
    result, _ = await discover(runtime, sources=["greenhouse:acme"], cancel=cancel)
    assert result.status == "cancelled"
    assert backend.completes[-1]["status"] == "cancelled"
    assert backend.completes[-1]["complete_sources"] == []


async def test_S_07_rediscovery_unchanged_then_closed_after_two_complete_runs(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    data = board(8)
    serve_board(ats, data)
    first, _ = await discover(runtime, sources=["greenhouse:acme"])
    assert first.stats["sync"]["outcomes"] == {"new": 8}
    second, _ = await discover(runtime, sources=["greenhouse:acme"])
    assert second.stats["new"] == 0
    assert second.stats["unchanged"] == 8
    assert second.stats["sync"]["outcomes"] == {"unchanged": 8}
    removed = {j["title"] for j in data["jobs"][:3]}
    serve_board(ats, {"jobs": data["jobs"][3:], "meta": {"total": 5}})
    await discover(runtime, sources=["greenhouse:acme"])
    assert all(p.status == "open" for p in backend.postings.values())
    await discover(runtime, sources=["greenhouse:acme"])
    closed = {p.title for p in backend.postings.values() if p.status == "closed"}
    assert closed == removed


async def test_S_30_workday_denial_stops_without_retry_and_disables_tenant(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    serve_board(ats, board())
    ats.status("/wday/cxs/nvidia/External/jobs", 403, method="POST")
    workday = backend.add_source(
        "workday", {"tenant": "nvidia", "wd_host_number": 5, "site": "External"}, "NVIDIA"
    )
    result, _ = await discover(runtime, sources=["greenhouse:acme", workday["id"]])
    assert result.status == "partial"
    posts = [h for h in ats.log if h[0] == "POST"]
    assert len(posts) == 1  # no retry, no second identity
    assert posts[0][2]["User-Agent"].startswith("pilih-jobs/")
    assert backend.patches == [
        {
            "base_revision": 1,
            "enabled": False,
            "config": {
                "tenant": "nvidia",
                "wd_host_number": 5,
                "site": "External",
                "disabled_reason": "access_denied",
            },
        }
    ]
    with pytest.raises(Exception, match="disabled"):
        await discover(runtime, sources=[workday["id"]])


async def test_S_29_excluded_sources_refused_before_any_request(
    site: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    fake_api: FakeApi,
    backend: FakeDiscovery,
) -> None:
    from pilih_jobs.discovery.errors import ExcludedSourceError

    before = list(fake_api.requests)
    for options in (
        {"sources": ["linkedin:acme"]},
        {"url": "https://www.linkedin.com/jobs/view/1"},
        {"sources": ["custom_url:https://id.indeed.com/viewjob?jk=9"]},
    ):
        with pytest.raises(ExcludedSourceError):
            await discover(runtime, **options)
    assert fake_api.requests == before
    assert site.log == []
    assert Outbox(runtime.db, runtime.issuer).entries() == []


# ---------------------------------------------------------------- the CLI
@pytest.fixture
def cli_env(ats: Site, virtual_time: VirtualClock, monkeypatch: pytest.MonkeyPatch) -> Site:
    monkeypatch.setenv(
        "PILIH_JOBS_TEST_BASE_URLS", json.dumps({"greenhouse": ats.base, "lever": ats.base})
    )
    return ats


def test_T15_SYNC_cli_streams_ndjson_and_result(
    cli_env: Site,
    cli_signed_in: Callable[..., CliResult],
    backend: FakeDiscovery,
) -> None:
    serve_board(cli_env, board())
    result = cli_signed_in("--json", "discover", "--source", "greenhouse:acme")
    assert result.code == 0, result.stderr
    lines = result.ndjson
    types = [line["type"] for line in lines]
    assert types[0] == "source_started"
    assert types[-1] == "result"
    assert types.count("item") == 3
    assert "sync" in types
    assert "run_finished" in types
    final = lines[-1]
    assert final["ok"] is True
    assert final["data"]["status"] == "completed"
    assert final["data"]["stats"]["sync"]["sent"] == 3
    assert backend.count("new") == 3


def test_T15_SYNC_cli_plain_output(
    cli_env: Site, cli_signed_in: Callable[..., CliResult], backend: FakeDiscovery
) -> None:
    serve_board(cli_env, board())
    result = cli_signed_in("discover", "--source", "greenhouse:acme", "--keywords", "engineer")
    assert result.code == 0, result.stderr
    assert "completed" in result.stdout
    assert "greenhouse:acme" in result.stdout
    assert "[source_finished]" in result.stderr
    assert backend.count("new") == 2  # "Account Executive" is filtered out by --keywords
    assert backend.completes[-1]["complete_sources"] == []  # filtered runs never close postings


def test_S_29_cli_refuses_excluded_source(
    cli_env: Site, cli_signed_in: Callable[..., CliResult], fake_api: FakeApi
) -> None:
    before = list(fake_api.requests)
    result = cli_signed_in("--json", "discover", "--source", "linkedin:acme")
    assert result.code == 9
    assert result.json["error"]["code"] == "unsupported_source"
    result = cli_signed_in("--json", "discover", "--url", "https://id.indeed.com/viewjob?jk=1")
    assert result.code == 9
    assert fake_api.requests == before
    assert cli_env.log == []


def test_T15_SYNC_cli_needs_login_unless_dry_run(
    cli_env: Site, cli: Callable[..., CliResult]
) -> None:
    serve_board(cli_env, board())
    assert cli("--json", "discover", "--source", "greenhouse:acme").code == 3
    dry = cli("--json", "discover", "--source", "greenhouse:acme", "--dry-run")
    assert dry.code == 0
    assert dry.ndjson[-1]["data"]["stats"]["new"] == 3


def test_T15_SYNC_cli_usage_errors(cli_env: Site, cli_signed_in: Callable[..., CliResult]) -> None:
    assert cli_signed_in("--json", "discover").code == 2
    assert cli_signed_in("--json", "discover", "--source", "nonsense").code == 2
    assert cli_signed_in("--json", "discover", "--source", "workday:nvidia").code == 9


def test_T15_ADAPTIVE_cli_reset_adaptive(
    cli_env: Site, cli_signed_in: Callable[..., CliResult], home: Any
) -> None:
    import sqlite3

    db = home / "data" / "scrapling" / "adaptive.db"
    db.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db) as conn:
        conn.execute(
            "CREATE TABLE storage (id INTEGER PRIMARY KEY, url TEXT, identifier TEXT, "
            "element_data TEXT, UNIQUE (url, identifier))"
        )
        conn.executemany(
            "INSERT INTO storage(url, identifier, element_data) VALUES('u', ?, '{}')",
            [
                ("career_page:acme.com:title",),
                ("career_page:acme.com:__item__",),
                ("career_page:other.com:title",),
            ],
        )
    result = cli_signed_in(
        "--json", "discover", "--reset-adaptive", "career_page:https://acme.com/careers"
    )
    assert result.code == 0, result.stdout
    assert result.json["data"]["stats"]["adaptive_reset"]["deleted"] == 2
    with sqlite3.connect(db) as conn:
        assert [r[0] for r in conn.execute("SELECT identifier FROM storage")] == [
            "career_page:other.com:title"
        ]


async def test_T15_SYNC_first_ctrl_c_is_graceful_second_aborts() -> None:
    import os
    import signal

    from pilih_jobs.cli.context import CliState
    from pilih_jobs.cli.discover import _signals  # pyright: ignore[reportPrivateUsage]

    cancel = asyncio.Event()
    aborted = False
    try:
        async with _signals(CliState(), cancel):
            os.kill(os.getpid(), signal.SIGINT)
            await asyncio.wait_for(cancel.wait(), 5)
            assert cancel.is_set()
            os.kill(os.getpid(), signal.SIGINT)
            await asyncio.sleep(5)
    except asyncio.CancelledError:
        aborted = True
    assert aborted
