"""Fixtures of the discovery tests (no network: every server is local)."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from pytest_httpserver import HTTPServer

from pilih_jobs.adapters import endpoints
from pilih_jobs.discovery.engine import ScraplingJobEngine
from pilih_jobs.storage.db import StateDB
from tests.discovery.support import Site, VirtualClock, make_engine


@pytest.fixture
def vclock() -> VirtualClock:
    return VirtualClock()


@pytest.fixture
def site(httpserver: HTTPServer) -> Site:
    return Site(httpserver)


@pytest.fixture
def test_mode(home: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """PILIH_JOBS_ENV=test (after `home` cleaned the environment)."""
    monkeypatch.setenv("PILIH_JOBS_ENV", "test")
    yield
    endpoints.set_test_base_urls(None)


@pytest.fixture
def ats(test_mode: None, site: Site) -> Site:
    """Every ATS API base URL points at the local site."""
    endpoints.set_test_base_urls(
        dict.fromkeys(
            ("greenhouse", "lever", "lever_eu", "ashby", "smartrecruiters", "workable", "workday"),
            site.base,
        )
    )
    return site


@pytest.fixture
async def engine(tmp_path: Path, vclock: VirtualClock) -> AsyncIterator[ScraplingJobEngine]:
    eng = make_engine(tmp_path, vclock)
    yield eng
    await eng.aclose()


@pytest.fixture
def state_db(tmp_path: Path) -> Iterator[StateDB]:
    db = StateDB(tmp_path / "state" / "state.db")
    yield db
    db.close()


@pytest.fixture
def virtual_time(monkeypatch: pytest.MonkeyPatch) -> VirtualClock:
    """`run_discovery` engines use a virtual clock (politeness waits are recorded, not slept)."""
    from pilih_jobs.discovery import clock

    vc = VirtualClock()
    monkeypatch.setattr(clock, "default_engine_clock", lambda: vc)
    return vc
