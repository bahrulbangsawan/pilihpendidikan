"""Shared fixtures for the pilih-jobs test suite (all CLI leaves).

- `home` — an isolated `PILIH_JOBS_HOME` (config, data, cache, logs) with a clean env;
- `fake_api` — the contract-validated in-process API (`tests/support/fake_api.py`);
- `keyring_backend` — an in-memory keyring backend (never the OS keychain);
- `runtime` — a `Runtime` wired to both;
- `signed_in` — `runtime` plus stored credentials for a fake user with a device;
- `cli` — run the Typer app in-process: `cli("--json", "status")` → `CliResult`.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.auth import ALL_SCOPES
from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.contracts import ids
from pilih_jobs.runtime import Runtime
from tests.support.fake_api import FakeApi
from tests.support.helpers import CliResult, sign_in
from tests.support.keyring_backends import MemoryKeyring


@pytest.fixture
def home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    for var in list(os.environ):
        if var.startswith("PILIH_JOBS_") or var in (
            "PYTHON_KEYRING_BACKEND",
            "CI",
            "FORCE_COLOR",
            "PY_COLORS",
            "CLICOLOR_FORCE",
        ):
            monkeypatch.delenv(var, raising=False)
    root = tmp_path / "home"
    monkeypatch.setenv("PILIH_JOBS_HOME", str(root))
    monkeypatch.setenv("NO_COLOR", "1")
    monkeypatch.setenv("COLUMNS", "200")
    ids.set_time_source(None)
    yield root
    ids.set_time_source(None)


@pytest.fixture
def fake_api() -> Iterator[FakeApi]:
    fake = FakeApi()
    yield fake
    assert fake.contract_errors == [], fake.contract_errors


@pytest.fixture
def user_id(fake_api: FakeApi) -> str:
    return fake_api.add_user("rahma@example.com")


@pytest.fixture
def keyring_backend() -> MemoryKeyring:
    return MemoryKeyring()


@pytest.fixture
def runtime(home: Path, fake_api: FakeApi, keyring_backend: MemoryKeyring) -> Iterator[Runtime]:
    rt = Runtime.create(api_url=fake_api.issuer)
    rt.transport = fake_api.transport
    rt.keyring_backend = keyring_backend
    yield rt
    rt.close()


@pytest.fixture
def signed_in(runtime: Runtime, fake_api: FakeApi, user_id: str) -> AccountMeta:
    return sign_in(runtime, fake_api, user_id, list(ALL_SCOPES))


@pytest.fixture
def cli(
    home: Path,
    fake_api: FakeApi,
    keyring_backend: MemoryKeyring,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> Callable[..., CliResult]:
    from pilih_jobs.cli.app import run_cli

    original = Runtime.create.__func__  # type: ignore[attr-defined]

    def create(cls: type[Runtime], **kwargs: Any) -> Runtime:
        kwargs.setdefault("api_url", None)
        if kwargs["api_url"] is None and not os.environ.get("PILIH_JOBS_API_URL"):
            kwargs["api_url"] = fake_api.issuer
        rt = original(cls, **kwargs)
        rt.transport = fake_api.transport
        rt.keyring_backend = keyring_backend
        return rt

    monkeypatch.setattr(Runtime, "create", classmethod(create))

    def run(*args: str) -> CliResult:
        capsys.readouterr()
        code = run_cli(list(args))
        out = capsys.readouterr()
        return CliResult(code, out.out, out.err)

    return run


@pytest.fixture
def cli_signed_in(
    cli: Callable[..., CliResult], fake_api: FakeApi, user_id: str, keyring_backend: MemoryKeyring
) -> Callable[..., CliResult]:
    rt = Runtime.create()
    try:
        sign_in(rt, fake_api, user_id, list(ALL_SCOPES))
    finally:
        rt.close()
    return cli
