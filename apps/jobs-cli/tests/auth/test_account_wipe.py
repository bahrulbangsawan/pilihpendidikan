"""TFIX-ACCOUNT-WIPE: a deleted account's local data is wiped (11 §10 step 6, 20 §5.3).

Regression for the full-stack finding (leaf-5.1 #6, S-33): after an account deletion the
next call got `401 invalid_token` (`reason: revoked_token`), the refresh was refused with
`invalid_grant`, and the CLI only deleted its secrets: `state.db` kept the account's
entity cache, seen postings and outbox, `credentials.json` still named the account, and
`status` reported the cached approvals.

The api marks a deleted account's 401 with `details.revoked_reason = "account_deleted"`.
Then, once the refresh is refused, everything the CLI holds for that issuer goes: entity
cache, seen postings, outbox (deleted, not quarantined, with the staged upload files it
points to), the change-feed cursor, the account binding, the account metadata and every
secret. Any other revocation (device revoked, sign-out elsewhere, refresh reuse) follows
20 §5.3: signed out, outbox `pending` for the next login as the same user, cache kept.
Plain expiry, client errors and network failures wipe nothing either.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.auth import ALL_SCOPES
from pilih_jobs.auth.flow import LoginOptions, login
from pilih_jobs.auth.store import access_account, device_key_account, refresh_account
from pilih_jobs.contracts import ids
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.outbox import Outbox, upload_manifest
from tests.support.fake_api import FakeApi, fake_browser
from tests.support.helpers import CliResult, sign_in
from tests.support.keyring_backends import MemoryKeyring

Cli = Callable[..., CliResult]
ISSUER_TABLES = ("entity_cache", "seen_postings", "outbox", "sync_state", "account")


@dataclass
class Seeded:
    user_id: str
    staged: Path
    kv_key: str


def _counts(issuer: str) -> dict[str, int]:
    rt = Runtime.create()
    try:
        counts: dict[str, int] = {}
        for table in ISSUER_TABLES:  # fixed table names, not input
            row = rt.db.query_one(f"SELECT count(*) AS n FROM {table} WHERE issuer = ?", (issuer,))  # noqa: S608
            counts[table] = int(row["n"]) if row is not None else 0
        return counts
    finally:
        rt.close()


def _seed(cli: Cli, fake_api: FakeApi, user_id: str) -> Seeded:
    """Synced cloud data, a seen posting, a pending write and a staged upload."""
    fake_api.put_entity(
        "approval", {"id": ids.new_id("apr"), "revision": 1, "state": "pending"}, user_id
    )
    fake_api.new_application(user_id)
    assert cli("--json", "sync").code == 0
    rt = Runtime.create()
    try:
        issuer = rt.issuer
        attempt = ids.new_id("att")
        staged = rt.paths.run_dir(attempt) / "steps.jsonl.gz"
        staged.parent.mkdir(parents=True)
        staged.write_bytes(b"\x1f\x8b fixture step log")
        kv_key = f"discovery:last:{issuer}:greenhouse:acme"
        with rt.db.transaction() as conn:
            conn.execute(
                "INSERT INTO seen_postings(issuer, fingerprint, content_hash, posting_id, "
                "last_uploaded_at) VALUES (?, ?, ?, ?, ?)",
                (issuer, "fp1:" + "a" * 64, "b" * 64, ids.new_id("pst"), ids.now_ms()),
            )
        outbox = Outbox(rt.db, issuer)
        outbox.enqueue(
            "POST",
            f"/api/v1/applications/{ids.new_id('app')}/events",
            {"type": "note_added", "data": {"text": "called the recruiter"}},
            ordering_key="app:x",
        )
        outbox.enqueue(
            "POST",
            "/api/v1/files",
            upload_manifest(
                meta={"kind": "run_log"},
                path=str(staged),
                content_type="application/gzip",
                sha256=hashlib.sha256(staged.read_bytes()).hexdigest(),
            ),
            ordering_key="file:x",
            kind="upload",
        )
        rt.db.kv_set(kv_key, "{}")
        rt.db.kv_set("unrelated:cache", "kept")
    finally:
        rt.close()
    counts = _counts(issuer)
    assert counts["entity_cache"] >= 2
    assert counts["seen_postings"] == 1
    assert counts["outbox"] == 2
    assert counts["sync_state"] == 1
    assert counts["account"] == 1
    return Seeded(user_id=user_id, staged=staged, kv_key=kv_key)


def _grant_of(fake_api: FakeApi, user_id: str) -> str:
    (grant,) = [g.id for g in fake_api.grants.values() if g.user_id == user_id and not g.revoked]
    return grant


def _credentials(home: Path) -> dict[str, Any]:
    path = home / "config" / "credentials.json"
    return json.loads(path.read_text("utf-8")) if path.exists() else {}


def _secrets(keyring_backend: MemoryKeyring, issuer: str, user_id: str) -> list[str]:
    keys = (
        access_account(issuer, user_id),
        refresh_account(issuer, user_id),
        device_key_account(issuer, user_id),
    )
    return [k for k in keys if any(k == name for (_svc, name) in keyring_backend.store)]


def _assert_untouched(fake_api: FakeApi, seeded: Seeded) -> None:
    counts = _counts(fake_api.issuer)
    assert counts["entity_cache"] >= 2
    assert counts["seen_postings"] == 1
    assert counts["outbox"] == 2
    assert counts["account"] == 1
    assert seeded.staged.exists()
    rt = Runtime.create()
    try:
        assert {e.state for e in Outbox(rt.db, rt.issuer).entries()} == {"pending"}
        assert rt.db.kv_get(seeded.kv_key) == "{}"
    finally:
        rt.close()


# ------------------------------------------------------------------ account deleted → wiped
def test_TFIX_ACCOUNT_WIPE_deleted_account_and_refused_refresh_wipe_everything(
    cli_signed_in: Cli,
    fake_api: FakeApi,
    user_id: str,
    home: Path,
    keyring_backend: MemoryKeyring,
) -> None:
    seeded = _seed(cli_signed_in, fake_api, user_id)
    issuer = fake_api.issuer
    # 11 §10 step 1: tombstone + every grant and token revoked (`account_deleted`).
    fake_api.delete_account(user_id)

    whoami = cli_signed_in("--json", "whoami")
    assert whoami.code == 3
    assert whoami.json["error"]["code"] == "not_authenticated"

    assert _counts(issuer) == dict.fromkeys(ISSUER_TABLES, 0)
    assert not seeded.staged.exists()
    rt = Runtime.create()
    try:
        assert rt.db.kv_get(seeded.kv_key) is None
        assert rt.db.kv_get("unrelated:cache") == "kept"
    finally:
        rt.close()
    credentials = _credentials(home)
    assert issuer not in credentials.get("accounts", {})
    assert issuer not in credentials.get("devices", {})
    assert _secrets(keyring_backend, issuer, user_id) == []

    status = cli_signed_in("--json", "status").json["data"]
    assert status["auth"]["signed_in"] is False
    assert status["auth"]["user_id"] is None
    assert status["device"] is None
    assert status["approvals_pending"] == 0
    assert status["outbox"] == {"depth": 0, "pending": 0, "conflict": 0, "dead": 0, "stale_24h": 0}
    assert status["last_sync_at"] is None
    assert status["offline"] == "not signed in"
    assert cli_signed_in("--json", "whoami").code == 3


def test_TFIX_ACCOUNT_WIPE_deleted_account_met_by_sync_wipes_too(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str
) -> None:
    """The same wipe whatever command meets the deletion first (here `sync`, mid-flush)."""
    _seed(cli_signed_in, fake_api, user_id)
    fake_api.delete_account(user_id)
    assert cli_signed_in("--json", "sync").code == 3
    assert _counts(fake_api.issuer) == dict.fromkeys(ISSUER_TABLES, 0)


def test_TFIX_ACCOUNT_WIPE_locally_expired_token_of_a_deleted_account_is_probed(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str
) -> None:
    """No 401 to read (the token expired locally): the refusal asks `/api/v1/me` why."""
    _seed(cli_signed_in, fake_api, user_id)
    fake_api.delete_account(user_id)
    fake_api.expire_access_tokens()
    _expire_cached_access_token(fake_api, user_id)
    assert cli_signed_in("--json", "whoami").code == 3
    assert _counts(fake_api.issuer) == dict.fromkeys(ISSUER_TABLES, 0)


# ------------------------------------------------------------------ other revocations (20 §5.3)
def test_TFIX_ACCOUNT_WIPE_revoked_device_signs_out_and_keeps_the_outbox(
    cli_signed_in: Cli,
    fake_api: FakeApi,
    user_id: str,
    home: Path,
    keyring_backend: MemoryKeyring,
) -> None:
    seeded = _seed(cli_signed_in, fake_api, user_id)
    issuer = fake_api.issuer
    grant = _grant_of(fake_api, user_id)
    device_id = fake_api.grants[grant].device_id
    assert device_id is not None
    fake_api.devices[device_id]["revoked_at"] = fake_api.now()
    fake_api.revoke_grant(grant, "device_revoked")

    assert cli_signed_in("--json", "sync").code == 3  # stop flushing
    _assert_untouched(fake_api, seeded)  # outbox pending, cache, seen, binding kept
    assert issuer not in _credentials(home).get("accounts", {})  # marked signed out
    remaining = _secrets(keyring_backend, issuer, user_id)
    assert access_account(issuer, user_id) not in remaining
    assert refresh_account(issuer, user_id) not in remaining
    status = cli_signed_in("--json", "status").json["data"]
    assert status["auth"]["signed_in"] is False
    assert status["outbox"]["pending"] == 2
    assert status["approvals_pending"] == 1  # the cache behaviour is unchanged

    # The next login as the same user re-sends the pending entries.
    sent_before = len(fake_api.requests)
    rt = Runtime.create()
    try:
        sign_in(rt, fake_api, user_id, list(ALL_SCOPES))
    finally:
        rt.close()
    cli_signed_in("--json", "sync")
    resent = [path for _method, path in fake_api.requests[sent_before:]]
    assert any(path.endswith("/events") for path in resent)
    assert "/api/v1/files" in resent


def test_TFIX_ACCOUNT_WIPE_pending_outbox_is_never_sent_as_another_user(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str
) -> None:
    """20 §5.3: re-sent only after a login as the same user; `login` as another quarantines."""
    _seed(cli_signed_in, fake_api, user_id)
    fake_api.revoke_grant(_grant_of(fake_api, user_id), "user")
    assert cli_signed_in("--json", "whoami").code == 3
    other = fake_api.add_user("someone@example.com")
    rt = Runtime.create()
    try:
        result = asyncio.run(
            login(rt, LoginOptions(open_browser=fake_browser(fake_api, other)))  # type: ignore[arg-type]
        )
    finally:
        rt.close()
    assert result.quarantined == 2
    sent_before = len(fake_api.requests)
    cli_signed_in("--json", "sync")
    resent = [path for _method, path in fake_api.requests[sent_before:]]
    assert not any(path.endswith("/events") or path == "/api/v1/files" for path in resent)
    rt = Runtime.create()
    try:
        assert {e.state for e in Outbox(rt.db, rt.issuer).entries()} == {"dead"}
    finally:
        rt.close()


@pytest.mark.parametrize("revoked_reason", ["user", "refresh_reuse", "admin"])
def test_TFIX_ACCOUNT_WIPE_other_revocations_wipe_nothing(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str, home: Path, revoked_reason: str
) -> None:
    seeded = _seed(cli_signed_in, fake_api, user_id)
    fake_api.revoke_grant(_grant_of(fake_api, user_id), revoked_reason)
    assert cli_signed_in("--json", "whoami").code == 3
    _assert_untouched(fake_api, seeded)
    assert fake_api.issuer not in _credentials(home).get("accounts", {})


def test_TFIX_ACCOUNT_WIPE_locally_expired_token_of_a_revoked_device_is_not_wiped(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str
) -> None:
    """The probe answers `revoked_token` without `account_deleted`: nothing is wiped."""
    seeded = _seed(cli_signed_in, fake_api, user_id)
    fake_api.revoke_grant(_grant_of(fake_api, user_id), "device_revoked")
    fake_api.expire_access_tokens()
    _expire_cached_access_token(fake_api, user_id)
    assert cli_signed_in("--json", "whoami").code == 3
    _assert_untouched(fake_api, seeded)


# ------------------------------------------------------------------ expiry / failures
def test_TFIX_ACCOUNT_WIPE_plain_expiry_refreshes_and_wipes_nothing(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str
) -> None:
    seeded = _seed(cli_signed_in, fake_api, user_id)
    fake_api.expire_access_tokens()  # the server answers 401 expired_token
    refreshes = fake_api.refresh_calls
    whoami = cli_signed_in("--json", "whoami")
    assert whoami.code == 0
    assert whoami.json["data"]["user_id"] == user_id
    assert fake_api.refresh_calls == refreshes + 1
    _assert_untouched(fake_api, seeded)


def test_TFIX_ACCOUNT_WIPE_expired_token_and_expired_refresh_sign_out_without_wiping(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str, home: Path
) -> None:
    """401 expired_token, then the refresh token itself has expired: plain expiry."""
    seeded = _seed(cli_signed_in, fake_api, user_id)
    fake_api.expire_access_tokens()
    for refresh in fake_api.refresh_tokens.values():
        refresh.expires_at = fake_api.now() - 1
    assert cli_signed_in("--json", "whoami").code == 3
    _assert_untouched(fake_api, seeded)
    assert fake_api.issuer not in _credentials(home).get("accounts", {})  # signed out


def test_TFIX_ACCOUNT_WIPE_locally_expired_refresh_refused_without_revocation_keeps_data(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str
) -> None:
    """Proactive refresh refused, the probe says `expired_token`: nothing is wiped."""
    seeded = _seed(cli_signed_in, fake_api, user_id)
    fake_api.expire_access_tokens()
    _expire_cached_access_token(fake_api, user_id)
    for refresh in fake_api.refresh_tokens.values():
        refresh.expires_at = fake_api.now() - 1
    assert cli_signed_in("--json", "whoami").code == 3
    _assert_untouched(fake_api, seeded)


def test_TFIX_ACCOUNT_WIPE_network_error_during_refresh_wipes_nothing(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str, home: Path
) -> None:
    seeded = _seed(cli_signed_in, fake_api, user_id)
    fake_api.delete_account(user_id)
    fake_api.fault_plan = lambda request: "down" if request.url.path == "/oauth/token" else None
    whoami = cli_signed_in("--json", "whoami")
    assert whoami.code != 0
    assert whoami.json["error"]["code"] == "network_error"
    _assert_untouched(fake_api, seeded)
    assert fake_api.issuer in _credentials(home)["accounts"]  # still signed in


def test_TFIX_ACCOUNT_WIPE_offline_wipes_nothing(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str
) -> None:
    seeded = _seed(cli_signed_in, fake_api, user_id)
    fake_api.delete_account(user_id)
    fake_api.offline = True
    status = cli_signed_in("--json", "status").json["data"]
    assert status["offline"].startswith("offline")
    assert status["auth"]["signed_in"] is True
    assert status["approvals_pending"] == 1
    _assert_untouched(fake_api, seeded)


@pytest.mark.parametrize("error", ["invalid_client", "unauthorized_client"])
def test_TFIX_ACCOUNT_WIPE_client_errors_sign_out_without_wiping(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str, error: str
) -> None:
    """A refused client (server configuration) is no evidence the grant itself is gone."""
    seeded = _seed(cli_signed_in, fake_api, user_id)
    fake_api.delete_account(user_id)
    fake_api.fail_next("POST", r"^/oauth/token$", 401, error)
    assert cli_signed_in("--json", "whoami").code == 3
    _assert_untouched(fake_api, seeded)


def test_TFIX_ACCOUNT_WIPE_other_users_data_is_never_wiped(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str
) -> None:
    """The local data was re-bound to another user meanwhile: the deletion skips it."""
    seeded = _seed(cli_signed_in, fake_api, user_id)
    fake_api.delete_account(user_id)
    rt = Runtime.create()
    try:
        rt.db.upsert_account(rt.issuer, ids.new_id("usr"), None)
    finally:
        rt.close()
    assert cli_signed_in("--json", "whoami").code == 3
    counts = _counts(fake_api.issuer)
    assert counts["entity_cache"] >= 2
    assert counts["outbox"] == 2
    assert seeded.staged.exists()


def _expire_cached_access_token(fake_api: FakeApi, user_id: str) -> None:
    """Make the CLI's cached access token look expired locally (no request is sent)."""
    rt = Runtime.create()
    try:
        account = rt.account()
        assert account is not None
        store = rt.secret_store(account.credential_store)
        key = access_account(rt.issuer, user_id)
        cached = json.loads(store.get(key) or "{}")
        cached["expires_at"] = fake_api.now() - 1
        store.set(key, json.dumps(cached))
    finally:
        rt.close()
