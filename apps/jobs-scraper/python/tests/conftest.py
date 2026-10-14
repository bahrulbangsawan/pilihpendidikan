from __future__ import annotations

from pathlib import Path

import pytest
from pytest_httpserver import HTTPServer

from pilih_scraper.fetching import EngineFactory
from tests.support import Site, VirtualClock, make_factory


@pytest.fixture
def site(httpserver: HTTPServer) -> Site:
    return Site(httpserver)


@pytest.fixture
def clock() -> VirtualClock:
    return VirtualClock()


@pytest.fixture
def factory(tmp_path: Path, site: Site, clock: VirtualClock) -> EngineFactory:
    return make_factory(tmp_path, site, clock)
