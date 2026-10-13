"""Local sync data is bound to one account (16 §14, 20 §12 F5)."""

from __future__ import annotations

import pytest

from pilih_jobs.api.client import ApiClient, StaticToken
from pilih_jobs.auth.flow import LoginOptions, login
from pilih_jobs.runtime import Runtime
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.cache import EntityCache
from pilih_jobs.sync.engine import SyncEngine
from pilih_jobs.sync.identity import AccountMismatchError, bind_account
from pilih_jobs.sync.outbox import Outbox
from tests.support.fake_api import FakeApi, fake_browser


async def test_sync_refuses_another_users_data(db: StateDB, fake_api: FakeApi) -> None:
    alice = fake_api.add_user("alice@example.com")
    bob = fake_api.add_user("bob@example.com")
    bind_account(db, fake_api.issuer, alice)
    Outbox(db, fake_api.issuer).enqueue(
        "POST",
        "/api/v1/inbox:bulk",
        {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C00"], "action": "seen"},
        ordering_key="i",
    )
    bob_token = fake_api.personal_token(bob, write=True)
    async with ApiClient(
        fake_api.issuer, tokens=StaticToken(bob_token), transport=fake_api.transport
    ) as api:
        engine = SyncEngine(db, fake_api.issuer, api)
        with pytest.raises(AccountMismatchError) as info:
            await engine.sync()
    assert info.value.exit == 4
    assert [p for _, p in fake_api.requests if "inbox" in p] == []  # nothing sent as bob


async def test_first_sync_binds_the_account(db: StateDB, fake_api: FakeApi) -> None:
    user = fake_api.add_user()
    async with ApiClient(
        fake_api.issuer,
        tokens=StaticToken(fake_api.personal_token(user)),
        transport=fake_api.transport,
    ) as api:
        await SyncEngine(db, fake_api.issuer, api).pull()
    row = db.account(fake_api.issuer)
    assert row is not None
    assert row["user_id"] == user


async def test_login_as_another_user_clears_cached_cloud_data(
    runtime: Runtime, fake_api: FakeApi
) -> None:
    alice = fake_api.add_user("alice@example.com")
    await login(runtime, LoginOptions(open_browser=fake_browser(fake_api, alice), capabilities=[]))
    fake_api.new_application(alice)
    async with runtime.api_client() as api:
        await SyncEngine(runtime.db, runtime.issuer, api).pull()
    cache = EntityCache(runtime.db, runtime.issuer)
    assert cache.count("application") == 1
    bob = fake_api.add_user("bob@example.com")
    await login(runtime, LoginOptions(open_browser=fake_browser(fake_api, bob), capabilities=[]))
    assert cache.count("application") == 0
    assert (
        runtime.db.query_one("SELECT * FROM sync_state WHERE issuer = ?", (runtime.issuer,)) is None
    )
    row = runtime.db.account(runtime.issuer)
    assert row is not None
    assert row["user_id"] == bob
