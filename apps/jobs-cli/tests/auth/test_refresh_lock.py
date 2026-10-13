"""T17-12: concurrent refreshes are serialized by `auth.lock` — exactly one network refresh."""

from __future__ import annotations

import asyncio
import json
import multiprocessing
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.api.client import ApiClient
from pilih_jobs.auth.session import AccessToken, TokenManager
from pilih_jobs.auth.store import AccountMeta, KeyringStore, access_account, refresh_account
from pilih_jobs.storage.locks import FileLock
from tests.support.fake_api import FakeApi
from tests.support.keyring_backends import FileKeyring, MemoryKeyring


def _manager(
    issuer: str, keyring_file: str, lock_file: str, user_id: str, transport: Any = None
) -> TokenManager:
    client = ApiClient(issuer, transport=transport, version_gate=False)
    account = AccountMeta(issuer, user_id, "a@b.co", None, None, [])
    manager = TokenManager(
        client=client,
        account=account,
        store=KeyringStore(FileKeyring(keyring_file)),
        token_endpoint=f"{issuer}/oauth/token",
        auth_lock=FileLock(Path(lock_file)),
    )
    client.tokens = manager
    return manager


def _child(
    issuer: str, keyring_file: str, lock_file: str, user_id: str, stale: str, start: Any, out: Any
) -> None:
    async def run() -> tuple[str, int]:
        manager = _manager(issuer, keyring_file, lock_file, user_id)
        start.wait(20)
        try:
            token = await manager.refresh_access_token(stale)
        finally:
            await manager.client.aclose()
        return token, manager.network_refreshes

    out.put(asyncio.run(run()))


def _seed(path: Path, issuer: str, user_id: str, refresh: str, stale: str) -> None:
    backend = FileKeyring(path)
    backend.set_password("pilih-jobs", refresh_account(issuer, user_id), refresh)
    backend.set_password(
        "pilih-jobs",
        access_account(issuer, user_id),
        AccessToken(stale, 0, ("jobs:read",)).to_json(),
    )


def test_T17_12_two_processes_refresh_once(tmp_path: Path) -> None:
    fake = FakeApi()
    user = fake.add_user()
    with fake.serve() as issuer:
        stale, refresh = fake.issue_tokens(user)
        keyring_file, lock_file = tmp_path / "keyring.json", tmp_path / "auth.lock"
        _seed(keyring_file, issuer, user, refresh, stale)
        ctx = multiprocessing.get_context("spawn")
        start, out = ctx.Event(), ctx.Queue()
        procs = [
            ctx.Process(
                target=_child,
                args=(issuer, str(keyring_file), str(lock_file), user, stale, start, out),
            )
            for _ in range(2)
        ]
        for proc in procs:
            proc.start()
        start.set()
        results = [out.get(timeout=60) for _ in procs]
        for proc in procs:
            proc.join(30)
    assert fake.refresh_calls == 1
    tokens = {token for token, _ in results}
    assert len(tokens) == 1
    assert stale not in tokens
    assert sorted(n for _, n in results) == [0, 1]
    stored = json.loads(
        FileKeyring(keyring_file).get_password("pilih-jobs", access_account(issuer, user))
    )
    assert stored["token"] in tokens
    assert (
        FileKeyring(keyring_file).get_password("pilih-jobs", refresh_account(issuer, user))
        != refresh
    )


async def test_T17_12_concurrent_coroutines_refresh_once(tmp_path: Path) -> None:
    fake = FakeApi()
    user = fake.add_user()
    stale, refresh = fake.issue_tokens(user)
    backend = MemoryKeyring()
    backend.set_password("pilih-jobs", refresh_account(fake.issuer, user), refresh)
    client = ApiClient(fake.issuer, transport=fake.transport, version_gate=False)
    manager = TokenManager(
        client=client,
        account=AccountMeta(fake.issuer, user, "a@b.co", None, None, []),
        store=KeyringStore(backend),
        token_endpoint=f"{fake.issuer}/oauth/token",
        auth_lock=FileLock(tmp_path / "auth.lock"),
    )
    first, second = await asyncio.gather(
        manager.refresh_access_token(stale), manager.refresh_access_token(stale)
    )
    await client.aclose()
    assert first == second
    assert fake.refresh_calls == 1


async def test_T17_12_refresh_rotates_and_reuse_signs_out(tmp_path: Path) -> None:
    fake = FakeApi()
    user = fake.add_user()
    stale, refresh = fake.issue_tokens(user)
    backend = MemoryKeyring()
    backend.set_password("pilih-jobs", refresh_account(fake.issuer, user), refresh)
    client = ApiClient(fake.issuer, transport=fake.transport, version_gate=False)
    signed_out: list[str] = []
    manager = TokenManager(
        client=client,
        account=AccountMeta(fake.issuer, user, "a@b.co", None, None, []),
        store=KeyringStore(backend),
        token_endpoint=f"{fake.issuer}/oauth/token",
        auth_lock=FileLock(tmp_path / "auth.lock"),
        on_signed_out=signed_out.append,
    )
    client.tokens = manager
    await manager.refresh_access_token(stale)
    rotated = backend.get_password("pilih-jobs", refresh_account(fake.issuer, user))
    assert rotated != refresh
    # An attacker replays the old refresh token after the child was used → family revoked.
    fake.refresh_tokens[rotated].used_at = fake.now()
    fake.refresh_tokens[refresh].used_at = fake.now() - 120_000
    from pilih_jobs.errors import NotAuthenticatedError

    backend.set_password("pilih-jobs", refresh_account(fake.issuer, user), refresh)
    manager._memory = None  # pyright: ignore[reportPrivateUsage]
    backend.delete_password("pilih-jobs", access_account(fake.issuer, user))
    with pytest.raises(NotAuthenticatedError) as info:
        await manager.access_token()
    assert info.value.exit == 3
    assert signed_out == ["invalid_grant"]
    assert backend.get_password("pilih-jobs", refresh_account(fake.issuer, user)) is None
    assert all(t.revoked for t in fake.tokens.values())
    await client.aclose()
