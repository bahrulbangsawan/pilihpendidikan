"""Change-feed pull, snapshot on 410 and the sync engine (20 §4)."""

from __future__ import annotations

from pilih_jobs.api.client import ApiClient
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.cache import EntityCache
from pilih_jobs.sync.engine import SyncEngine, sync_status
from pilih_jobs.sync.puller import ChangeFeedPuller
from tests.support.fake_api import FakeApi


async def test_pull_applies_pages_and_advances_the_cursor(
    db: StateDB, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, user = api_for
    apps = [fake_api.new_application(user) for _ in range(3)]
    fake_api.web_move(apps[0]["id"], "applied")
    puller = ChangeFeedPuller(db, fake_api.issuer, api)
    report = await puller.pull()
    assert report.pulled == 3
    assert report.cursor == len(fake_api.change_log)
    cache = EntityCache(db, fake_api.issuer)
    assert cache.get("application", apps[0]["id"])["stage"] == "applied"  # type: ignore[index]
    again = await puller.pull()
    assert again.pulled == 0
    assert again.cursor == report.cursor
    assert puller.state()["last_pull_at"] is not None


async def test_pull_follows_has_more(
    db: StateDB, api_for: tuple[ApiClient, str], fake_api: FakeApi, monkeypatch
) -> None:
    import pilih_jobs.sync.puller as puller_module

    api, user = api_for
    for _ in range(5):
        fake_api.new_application(user)
    monkeypatch.setattr(puller_module, "PAGE_LIMIT", 2)
    report = await ChangeFeedPuller(db, fake_api.issuer, api).pull()
    assert report.pages == 3
    assert report.pulled == 5


async def test_410_cursor_expired_triggers_a_snapshot(
    db: StateDB, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, user = api_for
    keep = fake_api.new_application(user)
    gone = fake_api.new_application(user)
    puller = ChangeFeedPuller(db, fake_api.issuer, api)
    await puller.pull()
    cache = EntityCache(db, fake_api.issuer)
    fake_api.entities.pop(("application", gone["id"]))  # deleted while retention passed
    fresh = fake_api.new_application(user)
    fake_api.retained_from_seq = len(fake_api.change_log)
    db.execute("UPDATE sync_state SET cursor = 1")
    report = await puller.pull()
    assert report.snapshot
    ids_now = {a["id"] for a in cache.list("application")}
    assert ids_now == {keep["id"], fresh["id"]}  # cached data is never trusted across a 410
    assert puller.state()["last_full_sync_at"] is not None


async def test_sync_engine_push_then_pull_and_status(
    db: StateDB, api_for: tuple[ApiClient, str], fake_api: FakeApi
) -> None:
    api, user = api_for
    app = fake_api.new_application(user)
    engine = SyncEngine(db, fake_api.issuer, api)
    engine.outbox.enqueue(
        "POST",
        f"/api/v1/applications/{app['id']}/move",
        {"base_revision": 1, "stage": "applied"},
        ordering_key=f"app:{app['id']}",
        kind="conditional",
    )
    report = await engine.sync()
    data = report.as_dict()
    assert data["pushed"] == 1
    assert data["pulled"] >= 1
    assert data["outbox_depth"] == 0
    cached = EntityCache(db, fake_api.issuer).get("application", app["id"])
    assert cached is not None
    assert cached["stage"] == "applied"
    assert cached["revision"] == 2
    status = sync_status(db, fake_api.issuer)
    assert status["outbox"]["done"] == 1
    assert status["cursor"] == data["cursor"]
    forced = await engine.sync(force=True)
    assert forced.as_dict()["outbox_depth"] == 0
