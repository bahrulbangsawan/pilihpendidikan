"""T16-COMPONENT: `login` / `logout` against the contract-validated fake API (17 §6, §8, §10)."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

from pilih_jobs.auth import BASE_SCOPES
from pilih_jobs.auth.flow import LoginError, LoginOptions, login, logout
from pilih_jobs.auth.loopback import AuthorizationDeniedError
from pilih_jobs.auth.store import access_account, refresh_account
from pilih_jobs.errors import NotAuthenticatedError, UsageError
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.outbox import Outbox
from tests.support.fake_api import FakeApi, fake_browser
from tests.support.helpers import CliResult
from tests.support.keyring_backends import MemoryKeyring


def _options(fake: FakeApi, user_id: str, **kw: object) -> LoginOptions:
    return LoginOptions(open_browser=fake_browser(fake, user_id), capabilities=["discover"], **kw)  # type: ignore[arg-type]


async def test_T16_COMPONENT_login_registers_the_device_and_stores_credentials(
    runtime: Runtime, fake_api: FakeApi, user_id: str, keyring_backend: MemoryKeyring
) -> None:
    urls: list[str] = []
    browser = fake_browser(fake_api, user_id)

    def open_browser(url: str) -> bool:
        urls.append(url)
        return browser(url)

    result = await login(
        runtime,
        LoginOptions(
            open_browser=open_browser,
            device_name="Rahma MBP (macOS)",
            capabilities=["discover", "apply"],
        ),
    )
    query = {k: v[0] for k, v in parse_qs(urlsplit(urls[0]).query).items()}
    assert query["client_id"] == "pilih-jobs-cli"
    assert query["code_challenge_method"] == "S256"
    assert len(query["state"]) == 43
    assert len(query["code_challenge"]) == 43
    assert query["scope"].split() == list(BASE_SCOPES)
    assert query["device_name"] == "Rahma MBP (macOS)"
    assert urlsplit(query["redirect_uri"]).hostname == "127.0.0.1"
    device = fake_api.devices[result.device_id]
    assert device["name"] == "Rahma MBP (macOS)"
    assert device["capabilities"] == ["discover", "apply"]
    assert result.email == "rahma@example.com"
    assert not result.device_reused
    assert keyring_backend.get_password("pilih-jobs", refresh_account(runtime.issuer, user_id))
    assert json.loads(
        keyring_backend.get_password("pilih-jobs", access_account(runtime.issuer, user_id))
    )["token"]
    meta = runtime.account()
    assert meta is not None
    assert meta.device_id == result.device_id
    assert meta.user_id == user_id
    row = runtime.db.account(runtime.issuer)
    assert row is not None
    assert row["device_id"] == result.device_id


async def test_T16_COMPONENT_login_completes_from_a_pasted_callback_address(
    runtime: Runtime, fake_api: FakeApi, user_id: str, keyring_backend: MemoryKeyring
) -> None:
    """Chrome's Local Network Access blocks the redirect: the user pastes the address."""
    redirects: list[str] = []
    announced: list[str] = []

    def blocked_browser(url: str) -> bool:
        redirects.append(fake_api.consent(url, user_id=user_id))
        return True

    def paste_reader(on_line: Callable[[str], None]) -> None:
        def run() -> None:
            on_line("http://127.0.0.1:1/callback?code=typo\n")
            on_line(redirects[0] + "\n")

        threading.Thread(target=run, daemon=True).start()

    result = await login(
        runtime,
        LoginOptions(
            open_browser=blocked_browser,
            capabilities=["discover"],
            announce=announced.append,
            paste_reader=paste_reader,
        ),
    )
    assert result.user_id == user_id
    assert any("ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS" in m for m in announced)
    assert any("not this login's callback address" in m for m in announced)
    assert keyring_backend.get_password("pilih-jobs", refresh_account(runtime.issuer, user_id))


async def test_T16_COMPONENT_relogin_reuses_the_device_with_device_hint(
    runtime: Runtime, fake_api: FakeApi, user_id: str
) -> None:
    first = await login(runtime, _options(fake_api, user_id))
    old_grants = {g.id for g in fake_api.grants.values()}
    second = await login(runtime, _options(fake_api, user_id))
    assert second.device_id == first.device_id
    assert second.device_reused
    assert len(fake_api.devices) == 1
    assert all(fake_api.grants[g].revoked for g in old_grants)  # old family revoked (17 §6)


async def test_T16_COMPONENT_step_up_scope_requests_the_union(
    runtime: Runtime, fake_api: FakeApi, user_id: str
) -> None:
    await login(runtime, _options(fake_api, user_id))
    result = await login(runtime, _options(fake_api, user_id, scopes=["automation:manage"]))
    assert "automation:manage" in result.scopes
    assert set(BASE_SCOPES) <= set(result.scopes)
    with pytest.raises(UsageError, match="Unknown scope"):
        await login(runtime, _options(fake_api, user_id, scopes=["admin:everything"]))


async def test_T16_COMPONENT_failed_device_registration_revokes_the_grant(
    runtime: Runtime, fake_api: FakeApi, user_id: str
) -> None:
    fake_api.fail_next("POST", r"^/api/v1/devices$", 503, "upstream_unavailable")
    with pytest.raises(LoginError, match="Device registration failed") as info:
        await login(runtime, _options(fake_api, user_id))
    assert info.value.exit == 1
    assert info.value.details["revoked"] is True
    assert fake_api.revocations
    assert fake_api.revocations[0]["token_type_hint"] == "refresh_token"
    assert runtime.account() is None


async def test_T16_COMPONENT_denied_consent_exits_1(
    runtime: Runtime, fake_api: FakeApi, user_id: str
) -> None:
    options = LoginOptions(open_browser=fake_browser(fake_api, user_id, deny=True), capabilities=[])
    with pytest.raises(AuthorizationDeniedError) as info:
        await login(runtime, options)
    assert info.value.exit == 1
    assert runtime.account() is None


async def test_T16_COMPONENT_code_exchange_failure_is_not_retried(
    runtime: Runtime, fake_api: FakeApi, user_id: str
) -> None:
    fake_api.fail_next("POST", r"^/oauth/token$", 400, "invalid_grant")
    with pytest.raises(LoginError, match="single-use"):
        await login(runtime, _options(fake_api, user_id))
    assert [p for m, p in fake_api.requests if p == "/oauth/token"] == ["/oauth/token"]


async def test_T16_COMPONENT_a_different_user_quarantines_the_outbox(
    runtime: Runtime, fake_api: FakeApi, user_id: str
) -> None:
    await login(runtime, _options(fake_api, user_id))
    outbox = Outbox(runtime.db, runtime.issuer)
    outbox.enqueue(
        "POST",
        "/api/v1/inbox:bulk",
        {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C00"], "action": "dismiss"},
        ordering_key="inbox",
    )
    other = fake_api.add_user("budi@example.com")
    result = await login(runtime, _options(fake_api, other))
    assert result.quarantined == 1
    entry = outbox.entries()[0]
    assert entry.state == "dead"
    assert entry.last_error == f"quarantined: belongs to {user_id}"


async def test_T16_COMPONENT_logout_revokes_and_deletes_credentials(
    runtime: Runtime, fake_api: FakeApi, user_id: str, keyring_backend: MemoryKeyring
) -> None:
    result = await login(runtime, _options(fake_api, user_id))
    outbox = Outbox(runtime.db, runtime.issuer)
    outbox.enqueue(
        "POST",
        "/api/v1/inbox:bulk",
        {"user_job_ids": ["ujb_01JA6V8M3W8Z1T6Q4Y2B7K9C00"], "action": "dismiss"},
        ordering_key="inbox",
    )
    fake_api.offline = False
    out = await logout(runtime, confirm=lambda _q: True, flush=None)
    assert out.revoked
    revoke = fake_api.revocations[-1]
    assert revoke["token_type_hint"] == "refresh_token"
    assert revoke["client_id"] == "pilih-jobs-cli"
    assert keyring_backend.store == {}
    assert runtime.account() is None
    assert out.outbox_remaining == 1  # kept for the next sign-in of the same user
    assert runtime.credentials.last_device(runtime.issuer) == result.device_id
    with pytest.raises(NotAuthenticatedError):
        await logout(runtime)


async def test_T16_COMPONENT_logout_works_offline(
    runtime: Runtime, fake_api: FakeApi, user_id: str, keyring_backend: MemoryKeyring
) -> None:
    await login(runtime, _options(fake_api, user_id))
    fake_api.offline = True
    out = await logout(runtime, discard_outbox=True)
    assert not out.revoked
    assert keyring_backend.store == {}
    assert runtime.account() is None


async def test_T16_COMPONENT_expired_access_token_refreshes_once_and_retries(
    runtime: Runtime, fake_api: FakeApi, user_id: str
) -> None:
    await login(runtime, _options(fake_api, user_id))
    fake_api.expire_access_tokens()
    async with runtime.api_client() as api:
        me = await api.get("/api/v1/me")
    assert me["user_id"] == user_id
    assert fake_api.refresh_calls == 1


def test_T16_COMPONENT_login_command_json(
    cli: Callable[..., CliResult],
    fake_api: FakeApi,
    user_id: str,
    monkeypatch: pytest.MonkeyPatch,
    home: Path,
) -> None:
    import webbrowser

    monkeypatch.setattr(webbrowser, "open", fake_browser(fake_api, user_id))
    result = cli("--json", "login", "--device-name", "CI box (Linux)", "--scopes", "devices:manage")
    assert result.code == 0, result.stderr
    data = result.json["data"]
    assert data["email"] == "rahma@example.com"
    assert data["device_name"] == "CI box (Linux)"
    assert "devices:manage" in data["scopes"]
    assert "http://127.0.0.1" not in result.stdout  # the URL goes to stderr, never into JSON
    whoami = cli("--json", "whoami")
    assert whoami.json["data"]["device"]["name"] == "CI box (Linux)"
    cached = cli("--json", "whoami", "--cached")
    assert cached.json["data"]["cached"] is True
    devices = cli("--json", "devices", "list")
    assert devices.json["data"]["items"][0]["this_device"] is True
    logout_result = cli("--json", "logout")
    assert logout_result.code == 0
    assert logout_result.json["data"]["revoked"] is True
    assert cli("--json", "whoami").code == 3
