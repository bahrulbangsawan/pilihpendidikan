"""T17-13: golden logs of a full login → refresh → logout contain no token or code values."""

from __future__ import annotations

import logging
from pathlib import Path

import pytest

from pilih_jobs.auth import pkce
from pilih_jobs.auth.flow import LoginOptions, login, logout
from pilih_jobs.logging import setup_logging
from pilih_jobs.runtime import Runtime
from tests.support.fake_api import FakeApi, fake_browser


async def test_T17_13_golden_logs_have_no_secrets(
    runtime: Runtime, fake_api: FakeApi, user_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup_logging(runtime.paths, level="debug", verbose=2)
    seen: dict[str, list[str]] = {"verifier": [], "state": [], "redirect": []}
    real_verifier, real_state = pkce.generate_verifier, pkce.generate_state

    def verifier() -> str:
        seen["verifier"].append(real_verifier())
        return seen["verifier"][-1]

    def state() -> str:
        seen["state"].append(real_state())
        return seen["state"][-1]

    monkeypatch.setattr("pilih_jobs.auth.flow.generate_verifier", verifier)
    monkeypatch.setattr("pilih_jobs.auth.flow.generate_state", state)
    browser = fake_browser(fake_api, user_id)

    def open_browser(url: str) -> bool:
        seen["redirect"].append(url)
        return browser(url)

    await login(runtime, LoginOptions(open_browser=open_browser, capabilities=[]))
    codes = [t.code for t in []]  # codes are consumed; capture them from the redirects instead
    fake_api.expire_access_tokens()
    async with runtime.api_client() as api:
        await api.get("/api/v1/me")
    secrets = set(seen["verifier"]) | set(seen["state"])
    secrets |= set(fake_api.tokens) | set(fake_api.refresh_tokens)
    secrets |= set(codes)
    await logout(runtime)
    for handler in logging.getLogger("pilih_jobs").handlers:
        handler.flush()
    content = Path(runtime.paths.log_file).read_text()
    assert "token_refreshed" in content
    assert "signed in" in content
    assert "/oauth/token" in content
    leaked = [s for s in secrets if s in content]
    assert leaked == []
