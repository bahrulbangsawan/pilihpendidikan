"""T17-10: the loopback redirect listener (RFC 8252, 17 §10.1, §13)."""

from __future__ import annotations

import asyncio
import re

import httpx
import pytest

from pilih_jobs.auth.loopback import (
    SUCCESS_PAGE,
    AuthorizationDeniedError,
    LoginTimeoutError,
    LoopbackListener,
    StateMismatchError,
    callback_page,
)
from pilih_jobs.errors import ExitCode

STATE = "s" * 43
ISSUER = "https://api.test"


async def _get(url: str) -> httpx.Response:
    async with httpx.AsyncClient(timeout=5) as client:
        return await client.get(url)


async def test_T17_10_binds_127_0_0_1_only_on_an_ephemeral_port() -> None:
    async with LoopbackListener(expected_state=STATE, issuer=ISSUER) as listener:
        host, port = listener.sockname
        assert host == "127.0.0.1"
        assert port > 0
        assert listener.redirect_uri == f"http://127.0.0.1:{port}/callback"


async def test_T17_10_fixed_port_for_ssh_forwarding() -> None:
    probe = LoopbackListener(expected_state=STATE, issuer=ISSUER)
    await probe.start()
    port = probe.port
    await probe.close()
    async with LoopbackListener(expected_state=STATE, issuer=ISSUER, port=port) as listener:
        assert listener.port == port


async def test_T17_10_one_shot_success_returns_the_code_and_closes() -> None:
    async with LoopbackListener(expected_state=STATE, issuer=ISSUER) as listener:
        url = listener.redirect_uri
        waiter = asyncio.create_task(listener.wait())
        response = await _get(f"{url}?code=abc&state={STATE}&iss={ISSUER}")
        result = await waiter
        assert result.code == "abc"
        assert result.iss == ISSUER
        assert response.status_code == 200
        assert response.text == SUCCESS_PAGE
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert "default-src 'none'" in response.headers["content-security-policy"]
        with pytest.raises(httpx.ConnectError):
            await _get(f"{url}?code=again&state={STATE}&iss={ISSUER}")


async def test_T17_10_wrong_path_is_404_and_ignored() -> None:
    async with LoopbackListener(expected_state=STATE, issuer=ISSUER) as listener:
        base = f"http://127.0.0.1:{listener.port}"
        waiter = asyncio.create_task(listener.wait())
        assert (await _get(f"{base}/favicon.ico")).status_code == 404
        assert (
            await _get(f"{base}/callbackx?code=a&state={STATE}&iss={ISSUER}")
        ).status_code == 404
        assert not waiter.done()
        await _get(f"{base}/callback?code=ok&state={STATE}&iss={ISSUER}")
        assert (await waiter).code == "ok"


async def test_T17_10_state_mismatch_answers_400_and_aborts() -> None:
    async with LoopbackListener(expected_state=STATE, issuer=ISSUER) as listener:
        waiter = asyncio.create_task(listener.wait())
        response = await _get(f"{listener.redirect_uri}?code=abc&state=forged&iss={ISSUER}")
        assert response.status_code == 400
        with pytest.raises(StateMismatchError):
            await waiter


async def test_T17_10_iss_mismatch_or_missing_is_ignored() -> None:
    async with LoopbackListener(expected_state=STATE, issuer=ISSUER) as listener:
        waiter = asyncio.create_task(listener.wait())
        assert (
            await _get(f"{listener.redirect_uri}?code=x&state={STATE}&iss=https://evil.test")
        ).status_code == 400
        assert (await _get(f"{listener.redirect_uri}?code=x&state={STATE}")).status_code == 400
        assert not waiter.done()
        await _get(f"{listener.redirect_uri}?code=good&state={STATE}&iss={ISSUER}")
        assert (await waiter).code == "good"


async def test_T17_10_access_denied_fails_the_login() -> None:
    async with LoopbackListener(expected_state=STATE, issuer=ISSUER) as listener:
        waiter = asyncio.create_task(listener.wait())
        response = await _get(
            f"{listener.redirect_uri}?error=access_denied&state={STATE}&iss={ISSUER}"
        )
        assert response.status_code == 200
        with pytest.raises(AuthorizationDeniedError):
            await waiter


async def test_T17_10_times_out_after_300_seconds_with_a_fake_clock() -> None:
    slept: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    async with LoopbackListener(expected_state=STATE, issuer=ISSUER, sleep=fake_sleep) as listener:
        with pytest.raises(LoginTimeoutError) as info:
            await listener.wait()
    assert slept == [300.0]
    assert info.value.exit == ExitCode.USAGE
    assert "timed out" in info.value.message


def test_T17_10_callback_pages_have_no_external_urls_or_scripts() -> None:
    for page in (SUCCESS_PAGE, callback_page("t", "m")):
        lowered = page.lower()
        assert "<script" not in lowered
        assert "src=" not in lowered
        assert "href=" not in lowered
        assert not re.search(r"https?://|//[a-z0-9]", lowered)
        assert "url(" not in lowered
        assert "@import" not in lowered
